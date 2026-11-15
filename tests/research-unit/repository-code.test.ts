/** biome-ignore-all lint/suspicious/useAwait: Fetch stubs use the asynchronous transport contract. */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  allowedCodePath,
  readCode,
  repositorySnapshot,
  selectCodeFiles,
} from "../../lib/research/repository-code";

test("code paths exclude traversal, secrets, dependencies and generated files", () => {
  for (const path of [
    "../secret.ts",
    "/app.ts",
    "src\\a.ts",
    ".env.json",
    "src/.env.local",
    "node_modules/a.ts",
    "dist/a.js",
    "package-lock.json",
    "img.png",
  ]) {
    assert.equal(allowedCodePath(path), false, path);
  }
  assert.equal(allowedCodePath("src/auth/session.ts"), true);
});

test("source reads are pinned to a commit, exclude symlinks and preserve real line ranges", async () => {
  const previous = process.env.RESEARCH_FIXTURES;
  process.env.RESEARCH_FIXTURES = "0";
  const commit = "a".repeat(40);
  const blob = "b".repeat(40);
  const requests: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/repos/test/code")) {
      return Response.json({ default_branch: "feature/main" });
    }
    if (url.includes("/commits/feature%2Fmain")) {
      return Response.json({ sha: commit });
    }
    if (url.includes("/git/trees/")) {
      return Response.json({
        tree: [
          {
            mode: "100644",
            path: "src/auth.ts",
            sha: blob,
            size: 100,
            type: "blob",
          },
          {
            mode: "120000",
            path: "link.ts",
            sha: blob,
            size: 10,
            type: "blob",
          },
          {
            mode: "100644",
            path: ".env.json",
            sha: blob,
            size: 10,
            type: "blob",
          },
        ],
        truncated: true,
      });
    }
    assert.ok(url.endsWith(`/git/blobs/${blob}`));
    return Response.json({
      content: Buffer.from("line one\nline two\nline three").toString("base64"),
      encoding: "base64",
    });
  });
  try {
    const { signal } = new AbortController();
    const snapshot = await repositorySnapshot("test/code", signal);
    assert.equal(snapshot.commit, commit);
    assert.equal(snapshot.truncated, true);
    assert.deepEqual(
      snapshot.files.map((file) => file.path),
      ["src/auth.ts"]
    );
    const source = await readCode(snapshot, "src/auth.ts", 2, signal);
    assert.equal(source.excerpt, "2: line two\n3: line three");
    assert.equal(source.startLine, 2);
    assert.equal(source.endLine, 3);
    assert.ok(source.url?.includes(`/blob/${commit}/src/auth.ts#L2-L3`));
    assert.ok(
      requests.some((url) => url.includes(`/git/trees/${commit}?recursive=1`))
    );
    const count = requests.length;
    await assert.rejects(readCode(snapshot, "other.ts", 1, signal), /范围/);
    await assert.rejects(readCode(snapshot, "../secret.ts", 1, signal), /无效/);
    assert.equal(requests.length, count);
  } finally {
    mock.restoreAll();
    if (previous === undefined) {
      delete process.env.RESEARCH_FIXTURES;
    } else {
      process.env.RESEARCH_FIXTURES = previous;
    }
  }
});

test("oversized files and cancellation fail before network access; file selection is bounded", async () => {
  const snapshot = {
    commit: "a".repeat(40),
    files: Array.from({ length: 8 }, (_, i) => ({
      path: `src/auth${i}.ts`,
      sha: "b".repeat(40),
      size: 200_001,
    })),
    repository: "test/code",
    truncated: false,
  };
  await assert.rejects(
    readCode(snapshot, snapshot.files[0].path, 1, new AbortController().signal),
    /200KB/
  );
  assert.equal(selectCodeFiles(snapshot, "auth").length, 0);
  for (const file of snapshot.files) {
    file.size = 20;
  }
  assert.equal(selectCodeFiles(snapshot, "auth").length, 4);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(repositorySnapshot("test/code", controller.signal), {
    name: "AbortError",
  });
});
