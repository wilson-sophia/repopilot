/** biome-ignore-all lint/performance/noAwaitInLoops: Schema initialization is ordered. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";

async function main() {
  config({ path: ".env.local", quiet: true });
  if (!process.env.MODEL_API_KEY) {
    throw new Error("Configure MODEL_API_KEY before the live smoke test");
  }
  const directory = await mkdtemp(join(tmpdir(), "repopilot-live-hybrid-"));
  process.env.PGLITE_DATA_DIR = directory;
  process.env.RESEARCH_MODE = "live";
  process.env.RESEARCH_FIXTURES = "0";
  delete process.env.POSTGRES_URL;
  const { database, closeDatabase } = await import("../lib/db/connection");
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
    const {
      createProject,
      importDocument,
      searchDocuments,
      createRun,
      getRun,
    } = await import("../lib/research/store");
    const owner = randomUUID();
    await database.execute(
      sql`INSERT INTO "User" (id, email) VALUES (${owner}, ${`${owner}@test.local`})`
    );
    const project = await createProject(owner, {
      description: "根据上传的验收资料回答，不猜测外部信息。",
      name: "Hybrid live verification",
      repository:
        process.env.RESEARCH_CODE_SMOKE === "1"
          ? "wilson-sophia/repopilot"
          : "",
    });
    const imported = await importDocument(
      owner,
      project.id,
      "requirements.md",
      "# 部署需求\n前端使用 React 与 TypeScript。数据库必须使用 PostgreSQL，部署采用 Docker Compose。验收标识为 RP-HYBRID-7429。系统只允许项目所有者读取资料。请求超时为8秒。"
    );
    assert.equal(imported.status, "ready", imported.error);
    const { researchChunks } = await import("../lib/research/schema");
    const rows = await database
      .select({ metadata: researchChunks.retrievalMetadata })
      .from(researchChunks)
      .where(eq(researchChunks.documentId, imported.id));
    const metadata = rows[0].metadata as {
      keywords: string[];
      questions: string[];
      enrichment: string;
    };
    assert.equal(
      metadata.enrichment,
      "model",
      "Real model enrichment degraded to fallback"
    );
    assert.ok(metadata.keywords.length && metadata.questions.length);
    const hits = await searchDocuments(
      owner,
      project.id,
      metadata.questions[0]
    );
    assert.equal(hits[0]?.documentId, imported.id);
    assert.match(hits[0].excerpt, /RP-HYBRID-7429/);
    const { executeResearch } = await import("../lib/research/agent");
    const initial = await createRun(
      owner,
      project.id,
      process.env.RESEARCH_CODE_SMOKE === "1"
        ? "请调用analyzeRepository分析绑定仓库，再调用readRepositoryFile读取lib/research/store.ts第197行附近的源码，说明文档检索实现（引用源码路径和行号）；另外检索项目需求资料，列出数据库、部署方案和验收标识。未读到的代码不能猜测。"
        : "请先检索项目文档，说明数据库和部署方案，并给出验收标识与引用。"
    );
    await executeResearch(owner, initial, new AbortController().signal, () => {
      /* Verify the final persisted record below. */
    });
    const run = await getRun(owner, initial.id);
    assert.equal(run.status, "completed", run.error);
    assert.ok(
      run.tools.some(
        (tool) => tool.name === "searchDocuments" && tool.status === "completed"
      )
    );
    assert.ok(run.sources.some((source) => source.documentId === imported.id));
    assert.match(run.report, /RP-HYBRID-7429/);
    assert.match(run.report, /\[S\d+\]/);
    if (process.env.RESEARCH_CODE_SMOKE === "1") {
      assert.ok(
        run.sources.some(
          (source) =>
            source.filePath && source.commit && source.url?.includes("#L")
        )
      );
      assert.ok(
        run.tools.some(
          (tool) =>
            tool.name === "readRepositoryFile" && tool.status === "completed"
        )
      );
    }
    console.log(
      JSON.stringify(
        {
          citedSources: run.sources.length,
          codeSources: run.sources.filter((source) => source.filePath).length,
          enrichment: metadata.enrichment,
          hits: hits.length,
          hypotheticalQuestions: metadata.questions.length,
          inputTokens: run.inputTokens,
          keywords: metadata.keywords.length,
          outputTokens: run.outputTokens,
          status: "passed",
        },
        null,
        2
      )
    );
  } finally {
    await closeDatabase();
    await rm(directory, { force: true, recursive: true });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Live hybrid verification failed"
  );
  process.exitCode = 1;
});
