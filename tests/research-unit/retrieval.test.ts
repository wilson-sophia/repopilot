/** biome-ignore-all lint/performance/noAwaitInLoops: Migrations have ordered schema dependencies. */
/** biome-ignore-all lint/suspicious/useAwait: Async model stubs implement the provider contract. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import {
  chunkSearchText,
  enrichChunk,
  extractKeywords,
  fuseCandidates,
  planRetrieval,
  type RetrievalCandidate,
  rerankCandidates,
} from "../../lib/research/retrieval";

const candidate = (id: string, content = id): RetrievalCandidate => ({
  content,
  documentId: "doc",
  id,
  name: "requirements.md",
  position: 0,
});

test("RRF promotes dual-route evidence without adding incompatible scores and deduplicates", () => {
  const result = fuseCandidates([
    [candidate("a"), candidate("b"), candidate("a")],
    [candidate("b"), candidate("c", "a")],
  ]);
  assert.deepEqual(
    result.map((item) => item.id),
    ["b", "a"]
  );
});

test("chunk enrichment validates model output, keeps questions separate from original evidence", async () => {
  const metadata = await enrichChunk(
    "The request timeout is 8 seconds.",
    undefined,
    async () =>
      JSON.stringify({
        keywords: ["timeout", "timeout"],
        questions: ["What is the timeout?"],
      })
  );
  assert.equal(metadata.enrichment, "model");
  assert.deepEqual(metadata.keywords, ["timeout"]);
  assert.match(chunkSearchText("original", metadata), /What is the timeout/);
  assert.equal(candidate("x", "original").content, "original");
});

test("malformed enrichment falls back; planning failure retains the original query", async () => {
  const metadata = await enrichChunk(
    "React and PostgreSQL",
    undefined,
    async () => '{"keywords":[1],"questions":[]}'
  );
  assert.equal(metadata.enrichment, "fallback");
  assert.deepEqual(metadata.questions, []);
  const plan = await planRetrieval(
    "Which database is used?",
    undefined,
    async () => "invalid"
  );
  assert.equal(plan.query, "Which database is used?");
  assert.ok(plan.keywords.includes("database"));
  assert.ok(!extractKeywords("What is the database?").includes("what"));
});

test("reranking honors an explicit empty result; invalid indices fall back and duplicates are removed", async () => {
  const items = [candidate("a"), candidate("b")];
  assert.deepEqual(
    await rerankCandidates("q", items, undefined, async () => '{"indices":[]}'),
    []
  );
  assert.deepEqual(
    await rerankCandidates(
      "q",
      items,
      undefined,
      async () => '{"indices":[99]}'
    ),
    items
  );
  assert.deepEqual(
    await rerankCandidates(
      "q",
      items,
      undefined,
      async () => '{"indices":[1,1]}'
    ),
    [items[1]]
  );
});

test("cancellation is propagated instead of swallowed by model fallback", async () => {
  const controller = new AbortController();
  const model = async () => {
    controller.abort();
    throw new Error("cancelled");
  };
  await assert.rejects(enrichChunk("text", controller.signal, model), {
    name: "AbortError",
  });
  await assert.rejects(
    rerankCandidates("q", [candidate("a")], controller.signal),
    { name: "AbortError" }
  );
});

test("hybrid search recalls keyword-only chunks, persists enrichment and isolates projects and owners", async () => {
  const directory = await mkdtemp(join(tmpdir(), "repopilot-hybrid-"));
  const keys = ["RESEARCH_MODE", "PGLITE_DATA_DIR", "POSTGRES_URL"];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  process.env.RESEARCH_MODE = "demo";
  process.env.PGLITE_DATA_DIR = directory;
  delete process.env.POSTGRES_URL;
  const { database, closeDatabase } = await import("../../lib/db/connection");
  try {
    for (const file of [
      "lib/db/migrations/0000_initial.sql",
      "lib/research/migration.sql",
    ]) {
      for (const statement of (await readFile(file, "utf8"))
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await database.execute(sql.raw(statement));
      }
    }
    const { createProject, importDocument, searchDocuments } = await import(
      "../../lib/research/store"
    );
    const owner = crypto.randomUUID();
    await database.execute(
      sql`INSERT INTO "User" (id, email) VALUES (${owner}, ${`${owner}@test.local`})`
    );
    const project = await createProject(owner, {
      description: "",
      name: "Target",
      repository: "",
    });
    const other = await createProject(owner, {
      description: "",
      name: "Other",
      repository: "",
    });
    const imported = await importDocument(
      owner,
      project.id,
      "requirements.txt",
      "The deployment uses Docker Compose."
    );
    await importDocument(
      owner,
      other.id,
      "secret.txt",
      "Docker Compose secret-project-content"
    );
    // An orthogonal vector removes the dense route: metadata alone must rescue the hit.
    const vector = new Array(384).fill(0);
    vector[383] = 1;
    await database.execute(
      sql`UPDATE research_chunk SET embedding = ${JSON.stringify(vector)}::vector, search_text = 'launch orchestration', retrieval_metadata = '{"keywords":["orchestration"],"questions":["How to launch?"],"enrichment":"model"}'::jsonb WHERE document_id = ${imported.id}`
    );
    const hits = await searchDocuments(owner, project.id, "orchestration");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].excerpt, "The deployment uses Docker Compose.");
    assert.equal(hits[0].documentId, imported.id);
    await assert.rejects(
      searchDocuments(crypto.randomUUID(), project.id, "orchestration"),
      /无权访问/
    );
    const rows = await database.execute(
      sql`SELECT retrieval_metadata FROM research_chunk WHERE document_id = ${imported.id}`
    );
    assert.ok(JSON.stringify(rows).includes("How to launch?"));
    await database.execute(
      sql`UPDATE research_chunk SET embedding_space = 'different-space' WHERE document_id = ${imported.id}`
    );
    assert.deepEqual(
      await searchDocuments(owner, project.id, "orchestration"),
      []
    );
  } finally {
    await closeDatabase();
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    await rm(directory, { force: true, recursive: true });
  }
});
