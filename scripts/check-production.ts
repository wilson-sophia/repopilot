/** biome-ignore-all lint/performance/noAwaitInLoops: Readiness checks and manual redirect following must preserve order. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { request } from "@playwright/test";

const port = Number(process.env.RESEARCH_PRODUCTION_TEST_PORT ?? "3113");
const baseURL = `http://127.0.0.1:${port}`;
const maxRedirects = 5;

async function findBuildTraces(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return findBuildTraces(path);
      }
      return Promise.resolve(
        entry.isFile() && entry.name.endsWith(".nft.json") ? [path] : []
      );
    })
  );
  return files.flat();
}

async function inspectBuildTraces() {
  const projectRoot = resolve(process.cwd());
  const traces = await findBuildTraces(resolve(projectRoot, ".next/server"));
  assert.ok(
    traces.length > 0,
    "No production NFT manifests found; run pnpm build first"
  );
  let referenceCount = 0;
  let sensitiveReferenceCount = 0;
  const uniqueFiles = new Set<string>();
  const violations: { manifest: string; reference: string }[] = [];
  for (const tracePath of traces) {
    const manifest: unknown = JSON.parse(await readFile(tracePath, "utf8"));
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !("files" in manifest) ||
      !Array.isArray(manifest.files)
    ) {
      throw new Error(
        `Invalid NFT manifest: ${relative(projectRoot, tracePath)}`
      );
    }
    for (const file of manifest.files) {
      if (typeof file !== "string") {
        throw new Error(
          `Invalid file reference in ${relative(projectRoot, tracePath)}`
        );
      }
      const target = resolve(dirname(tracePath), file);
      const relativeTarget = relative(projectRoot, target);
      const segments = relativeTarget.split(sep);
      referenceCount += 1;
      uniqueFiles.add(target);
      // Match only the project's top-level private paths, never a dependency
      // whose package name or nested fixture happens to contain these words.
      const sensitiveDirectory =
        segments[0] === ".data" || segments[0] === "test-results";
      const sensitiveEnvironment =
        segments.length === 1 &&
        (relativeTarget === ".env" || relativeTarget.startsWith(".env."));
      if (sensitiveDirectory || sensitiveEnvironment) {
        sensitiveReferenceCount += 1;
        if (violations.length < 20) {
          violations.push({
            manifest: relative(projectRoot, tracePath),
            reference: relativeTarget,
          });
        }
      }
    }
  }
  const evidence = {
    manifestCount: traces.length,
    referenceCount,
    sensitiveReferenceCount,
    uniqueReferencedFiles: uniqueFiles.size,
    violations,
  };
  await writeFile(
    "test-results/research-build-artifacts.json",
    JSON.stringify(evidence, null, 2)
  );
  assert.equal(
    sensitiveReferenceCount,
    0,
    `Production NFT manifests reference ${sensitiveReferenceCount} private project files; see research-build-artifacts.json`
  );
  return {
    manifestCount: traces.length,
    referenceCount,
    sensitiveReferenceCount,
    uniqueReferencedFiles: uniqueFiles.size,
  };
}

async function main() {
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/research-production.json",
    JSON.stringify({ status: "running" })
  );
  const buildArtifacts = await inspectBuildTraces();
  let output = "";
  let summary:
    | {
        redirectCount: number;
        cookie: { httpOnly: boolean; name: string; secure: boolean };
      }
    | undefined;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/serve.ts",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        AUTH_SECRET: "production-http-smoke-only-not-a-deployment-secret",
        AUTH_URL: baseURL,
        NEXT_DIST_DIR: ".next",
        NODE_ENV: "production",
        PGLITE_DATA_DIR: `.data/test-production-${process.pid}-${Date.now()}`,
        POSTGRES_URL: "",
        RESEARCH_FIXTURES: "0",
        RESEARCH_MODE: "demo",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  child.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  const exited = new Promise<number | null>((complete, reject) => {
    // close follows exit and drains stdout/stderr, including late shutdown errors.
    child.once("close", (code) => complete(code));
    child.once("error", reject);
  });
  const context = await request.newContext({ baseURL });
  try {
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Production service exited: ${output.slice(-2000)}`);
      }
      try {
        const response = await fetch(`${baseURL}/ping`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok && (await response.text()) === "pong") {
          ready = true;
          break;
        }
      } catch {
        /* The production server is still starting. */
      }
      await delay(250);
    }
    assert.ok(
      ready,
      "Production application did not become ready; build it with pnpm build first"
    );

    let nextURL = `${baseURL}/research`;
    let redirectCount = 0;
    let finalStatus = 0;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await context.get(nextURL, { maxRedirects: 0 });
      if (![301, 302, 303, 307, 308].includes(response.status())) {
        finalStatus = response.status();
        break;
      }
      redirectCount += 1;
      assert.ok(
        redirectCount <= maxRedirects,
        "Production session bootstrap entered a redirect loop"
      );
      const { location } = response.headers();
      assert.ok(location, "Redirect response is missing a Location header");
      const destination = new URL(location, nextURL);
      assert.equal(
        destination.origin,
        baseURL,
        "Session bootstrap must stay on the configured application origin"
      );
      nextURL = destination.toString();
    }
    assert.equal(
      finalStatus,
      200,
      "Production research workspace must resolve to a successful response"
    );
    assert.ok(
      redirectCount > 0,
      "A fresh anonymous HTTP client should bootstrap its guest session"
    );

    const state = await context.storageState();
    const sessionCookie = state.cookies.find((cookie) =>
      /^authjs\.session-token(?:\.\d+)?$/.test(cookie.name)
    );
    assert.ok(
      sessionCookie,
      "HTTP production must issue the same unprefixed session cookie that getToken reads"
    );
    assert.equal(sessionCookie.secure, false);
    assert.equal(sessionCookie.httpOnly, true);
    assert.ok(
      !state.cookies.some((cookie) =>
        cookie.name.startsWith("__Secure-authjs.session-token")
      )
    );

    const configuration = await context.get("/api/research/config", {
      maxRedirects: 0,
    });
    assert.equal(configuration.status(), 200);
    const userId = (await configuration.json()).user.id;
    assert.equal(typeof userId, "string");
    const createdResponse = await context.post("/api/research/projects", {
      data: {
        description: "Verify production cookie and ownership behavior",
        name: "Production HTTP session smoke",
        repository: "",
      },
      headers: { Origin: baseURL },
    });
    assert.equal(createdResponse.status(), 201, await createdResponse.text());
    const { project } = await createdResponse.json();
    const listResponse = await context.get("/api/research/projects", {
      maxRedirects: 0,
    });
    assert.equal(listResponse.status(), 200);
    assert.ok(
      (await listResponse.json()).projects.some(
        (item: { id: string }) => item.id === project.id
      )
    );
    assert.equal(
      (await context.get("/research", { maxRedirects: 0 })).status(),
      200,
      "An established production session must not redirect back through guest login"
    );
    const removed = await context.delete(
      `/api/research/projects/${project.id}`,
      { headers: { Origin: baseURL } }
    );
    assert.equal(removed.status(), 200);

    summary = {
      cookie: {
        httpOnly: sessionCookie.httpOnly,
        name: sessionCookie.name,
        secure: sessionCookie.secure,
      },
      redirectCount,
    };
  } finally {
    let exitCode: number | null | undefined;
    try {
      try {
        await context.dispose();
      } finally {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
        }
        exitCode = await Promise.race([
          exited,
          delay(15_000, undefined, { ref: false }).then(() => {
            child.kill("SIGKILL");
            throw new Error(
              "Production test service did not shut down cleanly"
            );
          }),
        ]);
      }
    } finally {
      // Keep the full output for diagnostics and a readable version that omits
      // massive minified source lines without discarding early error messages.
      const readable = output
        .split(/\r?\n/)
        .map((line) =>
          line.length > 2000
            ? `${line.slice(0, 240)} … [omitted long source line: ${line.length} characters; see raw log]`
            : line
        )
        .join("\n");
      await writeFile("test-results/research-production.raw.log", output);
      await writeFile("test-results/research-production.log", readable);
    }
    assert.equal(
      exitCode,
      0,
      "Production service must exit successfully after cleanup; see research-production.log"
    );
    assert.doesNotMatch(
      output,
      /\bTypeError\b|unhandled[\s_-]*rejection|(?:RuntimeError:\s*)?Aborted\(\)/i,
      "Production lifecycle emitted a runtime error; see research-production.log and raw log"
    );
  }
  assert.ok(summary, "Functional production checks did not complete");
  await writeFile(
    "test-results/research-production.json",
    JSON.stringify(
      {
        ...summary,
        buildArtifacts,
        checkedAt: new Date().toISOString(),
        cleanExit: true,
        projectCreation: "passed",
        projectListing: "passed",
        runtimeErrors: 0,
        status: "passed",
      },
      null,
      2
    )
  );
  console.log(
    `Production HTTP smoke passed: ${buildArtifacts.manifestCount} NFT manifests / ${buildArtifacts.referenceCount} file references contain no private project data; guest session established after ${summary.redirectCount} redirects; project APIs and clean error-free shutdown verified.`
  );
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  await writeFile(
    "test-results/research-production.json",
    JSON.stringify(
      { checkedAt: new Date().toISOString(), error: message, status: "failed" },
      null,
      2
    )
  );
  process.exitCode = 1;
});
