/** biome-ignore-all lint/performance/noAwaitInLoops: Schema statements have foreign-key and extension dependencies. */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });
if (!process.env.AUTH_SECRET) {
  const existing = existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
    : "RESEARCH_MODE=demo\n";
  const secret = randomBytes(32).toString("base64url");
  writeFileSync(".env.local", `${existing}\nAUTH_SECRET=${secret}\n`, {
    mode: 0o600,
  });
  process.env.AUTH_SECRET = secret;
  console.log("Created ignored .env.local with a local authentication secret.");
}

export async function setupDatabase() {
  if (!process.env.POSTGRES_URL) {
    // Runtime setup must migrate the persistent directory, including NODE_ENV=production.
    // Production build workers without the launcher may still use isolated memory.
    process.env.RESEARCH_LOCAL_DB = "1";
    const lock = resolve(
      process.env.PGLITE_DATA_DIR || ".data/local-postgres",
      "repopilot.owner"
    );
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8"));
      if (pid > 0 && pid !== process.pid) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ESRCH"
          ) {
            /* stale lock is handled by the launcher */
          } else {
            throw error;
          }
        }
        if (existsSync(lock)) {
          throw new Error(
            "本地数据库正在使用中，请停止开发服务后再执行 setup:local"
          );
        }
      }
    }
  }
  const { database, closeDatabase } = await import("../lib/db/connection");
  try {
    for (const file of [
      "lib/db/migrations/0000_initial.sql",
      "lib/research/migration.sql",
    ]) {
      const statements = readFileSync(file, "utf8")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await database.execute(sql.raw(statement));
      }
    }
    // A process restart cannot resume a request-bound agent. Preserve evidence
    // and make the interrupted status explicit rather than pretending it ran.
    await database.execute(
      sql`UPDATE research_run SET status='failed', error='服务重启，执行已中断，请重新发起', finished_at=now() WHERE status='running'`
    );
    console.log(
      `Database ready: ${process.env.POSTGRES_URL ? "external PostgreSQL" : "local PGlite PostgreSQL + pgvector"}`
    );
  } finally {
    await closeDatabase();
  }
}
if (process.argv[1]?.endsWith("setup-local.ts")) {
  setupDatabase().catch((error: unknown) => {
    console.error(
      "Database setup failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    process.exitCode = 1;
  });
}
