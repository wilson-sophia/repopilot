import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

test("interrupted task completes under the same ID after recovery process restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "repopilot-recovery-"));
  const db = await PGlite.create(directory, { extensions: { vector } });
  await db.exec('CREATE TABLE "User" (id uuid PRIMARY KEY)');
  await db.exec(readFileSync("lib/research/migration.sql", "utf8"));
  const owner = crypto.randomUUID(),
    project = crypto.randomUUID(),
    run = crypto.randomUUID();
  await db.query('INSERT INTO "User" (id) VALUES ($1)', [owner]);
  await db.query(
    "INSERT INTO research_project(id,owner_id,name) VALUES ($1,$2,'Recovery')",
    [project, owner]
  );
  await db.query(
    "INSERT INTO research_run(id,project_id,owner_id,prompt,mode,model,status,report) VALUES ($1,$2,$3,'恢复任务','demo','demo','running','partial')",
    [run, project, owner]
  );
  await db.close();
  const env = {
    ...process.env,
    PGLITE_DATA_DIR: directory,
    POSTGRES_URL: "",
    RESEARCH_FIXTURES: "1",
    RESEARCH_MODE: "demo",
  };
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/recover-research.ts"],
    { encoding: "utf8", env, timeout: 60_000 }
  );
  assert.equal(result.status, 0, result.stderr);
  const reopened = await PGlite.create(directory, { extensions: { vector } });
  const rows = await reopened.query<{ status: string; report: string }>(
    "SELECT status,report FROM research_run WHERE id=$1",
    [run]
  );
  assert.equal(rows.rows[0].status, "completed");
  assert.ok(!rows.rows[0].report.startsWith("partial"));
  await reopened.close();
});
