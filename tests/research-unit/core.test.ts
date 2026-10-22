import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chunkDocument,
  localEmbedding,
  terms,
} from "../../lib/research/embeddings";
import {
  normalizeRepository,
  projectInput,
  runInput,
} from "../../lib/research/validation";

test("repository input normalizes GitHub URLs without allowing arbitrary fetch destinations", () => {
  assert.equal(
    normalizeRepository("https://github.com/vercel/next.js.git"),
    "vercel/next.js"
  );
  assert.equal(normalizeRepository("vercel/next.js"), "vercel/next.js");
  assert.equal(normalizeRepository("  "), "");
  for (const value of [
    "http://localhost/admin",
    "https://github.com.evil.example/owner/repo",
    "https://github.com/owner/repo/../../secret",
    "https://user:pass@github.com/owner/repo",
    "file:///etc/passwd",
    "owner/repo?token=secret",
  ]) {
    assert.throws(() => normalizeRepository(value), value);
  }
});

test("validation rejects blank and oversized project and run data", () => {
  assert.equal(projectInput.safeParse({ name: "  " }).success, false);
  assert.equal(
    projectInput.safeParse({ name: "a".repeat(101) }).success,
    false
  );
  assert.equal(runInput.safeParse({ prompt: " " }).success, false);
  assert.equal(runInput.safeParse({ prompt: "a".repeat(3001) }).success, false);
  assert.deepEqual(projectInput.parse({ name: " valid " }), {
    description: "",
    name: "valid",
    repository: "",
  });
});

test("chunking preserves long text content with bounded overlap and sanitized null characters", () => {
  const text = `${"section alpha ".repeat(100)}\n${"section beta ".repeat(100)}`;
  const chunks = chunkDocument(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 900));
  assert.match(chunks[0], /^section alpha/);
  assert.match(chunks.at(-1) ?? "", /section beta$/);
  assert.deepEqual(chunkDocument(" \r\n \u0000 "), []);
  assert.deepEqual(chunkDocument("a\r\nb\u0000c"), ["a\nbc"]);
});

test("demo feature hashing is deterministic, normalized and supports Chinese token overlap", () => {
  const first = localEmbedding("React deployment requirements");
  assert.deepEqual(first, localEmbedding("React deployment requirements"));
  assert.equal(first.length, 384);
  assert.ok(
    Math.abs(
      Math.sqrt(first.reduce((sum, value) => sum + value * value, 0)) - 1
    ) < 1e-10
  );
  assert.deepEqual(terms("文档检索"), ["文档", "档检", "检索"]);
  assert.ok(localEmbedding("部署需求").every(Number.isFinite));
});
