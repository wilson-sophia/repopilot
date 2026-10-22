/** biome-ignore-all lint/performance/noAwaitInLoops: Startup polling and restart verification are intentionally sequential. */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { request } from "@playwright/test";
import {
  bootstrapGuest,
  createProject,
  executeRun,
  uploadDocument,
} from "../tests/research/helpers";

interface Service {
  child: ChildProcess;
  exited: Promise<number | null>;
  output: () => string;
}

const port = Number(process.env.RESEARCH_PERSISTENCE_PORT ?? "3111");
const baseURL = `http://127.0.0.1:${port}`;
const directory = `.data/test-restart-${process.pid}-${Date.now()}`;
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  AUTH_SECRET: "restart-persistence-test-only-not-a-production-secret",
  AUTH_URL: baseURL,
  NEXT_DIST_DIR: ".next-restart-test",
  NODE_ENV: "development",
  PGLITE_DATA_DIR: directory,
  POSTGRES_URL: "",
  RESEARCH_FIXTURES: "1",
  RESEARCH_MODE: "demo",
};

function launch(servicePort = port): Service {
  let output = "";
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/serve.ts",
      "dev",
      "--turbo",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(servicePort),
    ],
    { env: environment, stdio: ["ignore", "pipe", "pipe"] }
  );
  child.stdout?.on("data", (data: Buffer) => {
    output = `${output}${data.toString()}`.slice(-40_000);
  });
  child.stderr?.on("data", (data: Buffer) => {
    output = `${output}${data.toString()}`.slice(-40_000);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", reject);
  });
  return { child, exited, output: () => output };
}

async function stop(service: Service) {
  if (service.child.exitCode !== null) {
    return;
  }
  service.child.kill("SIGTERM");
  await Promise.race([
    service.exited,
    delay(15_000, undefined, { ref: false }).then(() => {
      service.child.kill("SIGKILL");
      throw new Error("Development service did not shut down cleanly");
    }),
  ]);
}

async function ready(service: Service) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null) {
      throw new Error(
        `Service exited before readiness: ${service.output().slice(-2000)}`
      );
    }
    try {
      const response = await fetch(`${baseURL}/ping`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.text()) === "pong") {
        return;
      }
    } catch {
      /* The server is still starting. */
    }
    await delay(250);
  }
  throw new Error(
    `Service readiness timed out: ${service.output().slice(-2000)}`
  );
}

async function main() {
  await mkdir("test-results", { recursive: true });
  const context = await request.newContext({ baseURL });
  let service: Service | undefined;
  let competing: Service | undefined;
  const logs: string[] = [];
  try {
    service = launch();
    await ready(service);
    const before = await bootstrapGuest(context);
    const project = await createProject(context, {
      name: "Restart durability proof",
    });
    const document = await uploadDocument(
      context,
      project.id,
      "# Persistence\nThe durability marker is restart-proof-2026.\n",
      "persistence.md"
    );
    const { run } = await executeRun(
      context,
      project.id,
      "What is the durability marker?"
    );
    assert.equal(run.status, "completed");
    assert.match(run.report, /restart-proof-2026/);

    competing = launch(port + 1);
    const competingExit = await Promise.race([
      competing.exited,
      delay(15_000, undefined, { ref: false }).then(() => {
        throw new Error("Concurrent owner was not rejected promptly");
      }),
    ]);
    assert.notEqual(competingExit, 0);
    assert.match(competing.output(), /数据库已由其他开发实例持有/);
    assert.equal(
      (await context.get(`/api/research/projects/${project.id}`)).status(),
      200
    );

    await stop(service);
    logs.push(service.output());
    service = launch();
    await ready(service);
    const configuration = await context.get("/api/research/config");
    assert.equal(
      (await configuration.json()).user.id,
      before.user.id,
      "The same signed-in guest session must survive process restart"
    );
    const detailResponse = await context.get(
      `/api/research/projects/${project.id}`
    );
    assert.equal(detailResponse.status(), 200);
    const detail = await detailResponse.json();
    assert.ok(
      detail.documents.some((item: { id: string }) => item.id === document.id)
    );
    assert.ok(
      detail.runs.some(
        (item: { id: string; report: string }) =>
          item.id === run.id && item.report === run.report
      )
    );
    const exported = await context.get(`/api/research/runs/${run.id}/export`);
    assert.equal(await exported.text(), run.report);
    const afterRestart = await executeRun(
      context,
      project.id,
      "Find the durability marker from the stored document."
    );
    assert.equal(afterRestart.run.status, "completed");
    assert.ok(
      afterRestart.run.sources.some(
        (source) => source.documentId === document.id
      )
    );
    assert.match(afterRestart.run.report, /restart-proof-2026/);

    const result = {
      checkedAt: new Date().toISOString(),
      concurrentOwnerRejected: true,
      documentIndexSurvived: true,
      projectId: project.id,
      reportSurvived: true,
      sessionSurvived: true,
      status: "passed",
    };
    await writeFile(
      "test-results/research-persistence.json",
      JSON.stringify(result, null, 2)
    );
    console.log(
      "Persistence smoke passed: session, project, document vectors and exported report survived a full service restart; concurrent owner was rejected."
    );
  } finally {
    if (competing) {
      await stop(competing);
      logs.push(competing.output());
    }
    if (service) {
      await stop(service);
      logs.push(service.output());
    }
    await context.dispose();
    await writeFile(
      "test-results/research-persistence.log",
      logs.join("\n--- Service lifecycle ---\n")
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
