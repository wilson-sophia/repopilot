/** biome-ignore-all lint/performance/noAwaitInLoops: Polling and process restarts are ordered. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

test("killed process resumes after a committed model/tool step without reexecuting it", {
  timeout: 90_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "repopilot-checkpoint-"));
  let requests = 0;
  let reachedSecond: () => void = () => {
    /* Assigned by the promise executor below. */
  };
  const second = new Promise<void>((resolve) => {
    reachedSecond = resolve;
  });
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) {
      body += part;
    }
    const payload = JSON.parse(body);
    requests += 1;
    if (requests === 2) {
      reachedSecond();
      return;
    }
    if (requests === 3) {
      assert.ok(
        payload.messages.some(
          (message: { role: string }) => message.role === "tool"
        ),
        "Recovered model request must contain the committed tool result"
      );
    }
    const envelope = {
      created: 1,
      id: "restart",
      model: "mock",
      object: "chat.completion.chunk",
    };
    const delta =
      requests === 1
        ? {
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments: '{"query":"stream"}',
                  name: "analyzeRepository",
                },
                id: "analysis-once",
                index: 0,
                type: "function",
              },
            ],
          }
        : { content: "恢复后从源码结果生成报告。[S1]", role: "assistant" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ ...envelope, choices: [{ delta, finish_reason: null, index: 0 }] })}\n\ndata: ${JSON.stringify({ ...envelope, choices: [{ delta: {}, finish_reason: requests === 1 ? "tool_calls" : "stop", index: 0 }], usage: { completion_tokens: 6, prompt_tokens: 12, total_tokens: 18 } })}\n\ndata: [DONE]\n\n`
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const owner = crypto.randomUUID(),
    project = crypto.randomUUID(),
    id = crypto.randomUUID();
  const seed = await PGlite.create(directory, { extensions: { vector } });
  await seed.exec('CREATE TABLE "User" (id uuid PRIMARY KEY)');
  await seed.exec(await readFile("lib/research/migration.sql", "utf8"));
  await seed.query('INSERT INTO "User" (id) VALUES ($1)', [owner]);
  await seed.query(
    "INSERT INTO research_project(id,owner_id,name,repository) VALUES ($1,$2,'Checkpoint','test/recovery')",
    [project, owner]
  );
  await seed.query(
    "INSERT INTO research_run(id,project_id,owner_id,prompt,mode,model,status) VALUES ($1,$2,$3,'分析stream源码','live','mock','running')",
    [id, project, owner]
  );
  await seed.close();
  const launch = () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/recover-research.ts"],
      {
        env: {
          ...process.env,
          MODEL_API_KEY: "mock",
          MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          MODEL_PROXY_URL: "",
          PGLITE_DATA_DIR: directory,
          POSTGRES_URL: "",
          RESEARCH_FIXTURES: "1",
          RESEARCH_MODE: "live",
        },
        stdio: "pipe",
      }
    );
    let output = "";
    child.stderr.on("data", (data) => {
      output += data;
    });
    const exit = new Promise<number | null>((resolve) =>
      child.once("exit", resolve)
    );
    return { child, exit, output: () => output };
  };
  let worker = launch();
  try {
    await Promise.race([
      second,
      delay(30_000).then(() => {
        throw new Error("First tool checkpoint was not reached");
      }),
    ]);
    worker.child.kill("SIGKILL");
    await worker.exit;
    const interrupted = await PGlite.create(directory, {
      extensions: { vector },
    });
    const [before] = (
      await interrupted.query<{
        checkpoint: { steps: number };
        tools: { id: string; status: string }[];
        sources: { id: string }[];
      }>("SELECT checkpoint,tools,sources FROM research_run WHERE id=$1", [id])
    ).rows;
    assert.equal(before.checkpoint.steps, 1);
    assert.equal(before.tools[0].status, "completed");
    await interrupted.close();
    worker = launch();
    const code = await Promise.race([
      worker.exit,
      delay(30_000).then(() => {
        throw new Error("Recovery timed out");
      }),
    ]);
    assert.equal(code, 0, worker.output());
    const afterDB = await PGlite.create(directory, { extensions: { vector } });
    const [after] = (
      await afterDB.query<{
        status: string;
        report: string;
        tools: { id: string }[];
        sources: { id: string }[];
        checkpoint: { steps: number };
      }>(
        "SELECT status,report,tools,sources,checkpoint FROM research_run WHERE id=$1",
        [id]
      )
    ).rows;
    await afterDB.close();
    assert.equal(after.status, "completed");
    assert.equal(after.tools.length, 1);
    assert.equal(after.tools[0].id, before.tools[0].id);
    assert.deepEqual(after.sources, before.sources);
    assert.equal(after.checkpoint.steps, 2);
    assert.match(after.report, /恢复后/);
    assert.equal(requests, 3);
  } finally {
    worker.child.kill("SIGKILL");
    server.closeAllConnections();
    server.close();
    await rm(directory, { force: true, recursive: true });
  }
});
