/** biome-ignore-all lint/suspicious/useAwait: HTTP mocks intentionally expose Promise-based fetch behavior. */
/** biome-ignore-all lint/performance/noAwaitInLoops: Ordered migrations must complete before the next SQL statement. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { sql } from "drizzle-orm";
import type { ResearchEvent } from "../../lib/research/types";

function completionStream(
  delta: Record<string, unknown>,
  finishReason: "tool_calls" | "stop"
) {
  const frame = (data: Record<string, unknown>) =>
    `data: ${JSON.stringify(data)}\n\n`;
  const envelope = {
    created: 1_790_000_000,
    id: "chatcmpl-unit",
    model: "unit-chat",
    object: "chat.completion.chunk",
  };
  return new Response(
    [
      frame({
        ...envelope,
        choices: [{ delta, finish_reason: null, index: 0 }],
      }),
      frame({
        ...envelope,
        choices: [{ delta: {}, finish_reason: finishReason, index: 0 }],
        usage: { completion_tokens: 6, prompt_tokens: 12, total_tokens: 18 },
      }),
      "data: [DONE]\n\n",
    ].join(""),
    { headers: { "content-type": "text/event-stream" }, status: 200 }
  );
}

test("live tool loop returns canonical source IDs to the model and persists a cited completion", async () => {
  const dataDirectory = await mkdtemp(
    join(tmpdir(), "repopilot-live-contract-")
  );
  const keys = [
    "RESEARCH_MODE",
    "RESEARCH_FIXTURES",
    "PGLITE_DATA_DIR",
    "POSTGRES_URL",
    "MODEL_API_KEY",
    "MODEL_BASE_URL",
    "MODEL_NAME",
    "EMBEDDING_API_KEY",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  process.env.RESEARCH_MODE = "live";
  process.env.RESEARCH_FIXTURES = "0";
  process.env.PGLITE_DATA_DIR = dataDirectory;
  delete process.env.POSTGRES_URL;
  process.env.MODEL_API_KEY = "unit-live-model-key";
  process.env.MODEL_BASE_URL = "https://model-unit.example/v1";
  process.env.MODEL_NAME = "unit-chat";
  process.env.EMBEDDING_API_KEY = "unit-live-embedding-key";
  process.env.EMBEDDING_BASE_URL = "https://embedding-unit.example/v1";
  process.env.EMBEDDING_MODEL = "unit-embedding";

  const { database, closeDatabase } = await import("../../lib/db/connection");
  try {
    for (const file of [
      "lib/db/migrations/0000_initial.sql",
      "lib/research/migration.sql",
    ]) {
      const statements = (await readFile(file, "utf8"))
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await database.execute(sql.raw(statement));
      }
    }
    let chatRequests = 0;
    let toolPayload: Record<string, unknown> | undefined;
    mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (url.endsWith("/embeddings")) {
          const values = Array.isArray(body.input) ? body.input : [body.input];
          return Response.json({
            data: values.map((_, index) => ({
              embedding: [1, 0, 0],
              index,
              object: "embedding",
            })),
            model: "unit-embedding",
            object: "list",
            usage: { prompt_tokens: 2, total_tokens: 2 },
          });
        }
        assert.equal(url, "https://model-unit.example/v1/chat/completions");
        assert.equal(body.model, "unit-chat");
        chatRequests += 1;
        if (chatRequests === 1) {
          return completionStream(
            {
              role: "assistant",
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({ query: "deployment platform" }),
                    name: "searchDocuments",
                  },
                  id: "call_unit_docs",
                  index: 0,
                  type: "function",
                },
              ],
            },
            "tool_calls"
          );
        }
        const messages = body.messages as Record<string, unknown>[];
        const toolMessage = messages.find((message) => message.role === "tool");
        assert.ok(
          toolMessage,
          "The second model step must receive the executed tool result"
        );
        toolPayload = JSON.parse(String(toolMessage.content)) as Record<
          string,
          unknown
        >;
        return completionStream(
          {
            content: "# 部署调研\n项目文档要求使用 Docker Compose。[S1]\n",
            role: "assistant",
          },
          "stop"
        );
      }
    );

    const ownerId = randomUUID();
    await database.execute(
      sql`INSERT INTO "User" (id, email) VALUES (${ownerId}, ${`unit-${ownerId.slice(0, 8)}@example.com`})`
    );
    const { createProject, createRun, getRun, importDocument } = await import(
      "../../lib/research/store"
    );
    const project = await createProject(ownerId, {
      description: "Verify the tool/model boundary",
      name: "Live contract",
      repository: "",
    });
    await importDocument(
      ownerId,
      project.id,
      "deployment.md",
      "# Deployment\nThe deployment platform is Docker Compose."
    );
    const initial = await createRun(
      ownerId,
      project.id,
      "What is the deployment platform?"
    );
    const { executeResearch } = await import("../../lib/research/agent");
    const events: ResearchEvent[] = [];
    await executeResearch(
      ownerId,
      initial,
      new AbortController().signal,
      (event) => events.push(event)
    );
    const stored = await getRun(ownerId, initial.id);
    assert.equal(stored.status, "completed");
    assert.equal(stored.mode, "live");
    assert.equal(chatRequests, 2);
    assert.match(stored.report, /Docker Compose.*\[S1\]/);
    assert.equal(stored.sources[0].id, "S1");
    assert.ok(stored.inputTokens > 0);
    assert.ok(stored.outputTokens > 0);
    assert.ok(
      events.some(
        (event) => event.type === "source" && event.source.id === "S1"
      )
    );
    const matches = toolPayload?.matches as
      | Array<{ id: string; excerpt: string }>
      | undefined;
    assert.equal(
      matches?.[0]?.id,
      "S1",
      "The live model must receive the same canonical citation ID shown in the UI"
    );
    assert.match(matches?.[0]?.excerpt ?? "", /Docker Compose/);
  } finally {
    mock.restoreAll();
    await closeDatabase();
    await rm(dataDirectory, { force: true, recursive: true });
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});
