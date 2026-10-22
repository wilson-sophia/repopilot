import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { setupDatabase } from "./setup-local";

/** One process owns local Postgres. Next workers only use the PG wire protocol. */
async function serve() {
  let localDatabase: PGlite | undefined;
  let socket: PGLiteSocketServer | undefined;
  let lockFile: string | undefined;
  let lockOwned = false;
  let shuttingDown = false;
  let localURL = process.env.POSTGRES_URL;
  const cleanup = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await socket?.stop();
    await localDatabase?.close();
    if (lockFile && lockOwned) {
      rmSync(lockFile, { force: true });
    }
  };
  try {
    if (localURL) {
      await setupDatabase();
    } else {
      const directory = resolve(
        process.env.PGLITE_DATA_DIR || ".data/local-postgres"
      );
      process.env.PGLITE_DATA_DIR = directory;
      mkdirSync(directory, { recursive: true });
      lockFile = resolve(directory, "repopilot.owner");
      try {
        const pid = Number(readFileSync(lockFile, "utf8"));
        if (pid > 0) {
          try {
            process.kill(pid, 0);
            throw new Error(
              "数据库已由其他开发实例持有，请先停止该实例或使用独立的 PGLITE_DATA_DIR"
            );
          } catch (error) {
            if (
              !(
                error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "ESRCH"
              )
            ) {
              throw error;
            }
          }
        }
        rmSync(lockFile, { force: true });
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          throw error;
        }
      }
      writeFileSync(lockFile, String(process.pid), { flag: "wx", mode: 0o600 });
      lockOwned = true;
      await setupDatabase();
      localDatabase = await PGlite.create(directory, {
        extensions: { vector },
      });
      socket = new PGLiteSocketServer({
        db: localDatabase,
        host: "127.0.0.1",
        maxConnections: 32,
        port: 0,
      });
      await socket.start();
      localURL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
      console.log(
        `Local PostgreSQL ready on ${socket.getServerConn()} (single database owner)`
      );
    }
    const arguments_ = process.argv.slice(2);
    const child = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", ...arguments_],
      {
        env: {
          ...process.env,
          POSTGRES_URL: localURL,
          RESEARCH_LOCAL_DB: localDatabase ? "1" : "0",
        },
        stdio: "inherit",
      }
    );
    const stop = () => {
      child.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("error", async () => {
      await cleanup();
      process.exitCode = 1;
    });
    child.once("exit", async (code) => {
      await cleanup();
      process.exitCode = code ?? 0;
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
}
serve().catch((error: unknown) => {
  console.error(
    "启动失败：",
    error instanceof Error ? error.message : "unknown error"
  );
  process.exitCode = 1;
});
