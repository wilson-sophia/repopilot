import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle as localDrizzle } from "drizzle-orm/pglite";
import { drizzle as remoteDrizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// The app launcher supplies POSTGRES_URL for both local socket Postgres and
// external Postgres. Direct PGlite is only used by setup and isolated unit tests.
const state = globalThis as typeof globalThis & {
  repopilotLocalDatabase?: PGlite;
  repopilotRemoteDatabase?: ReturnType<typeof postgres>;
};

function localConnection() {
  if (!state.repopilotLocalDatabase) {
    const directory =
      process.env.NODE_ENV === "production" &&
      process.env.RESEARCH_LOCAL_DB !== "1"
        ? "memory://"
        : resolve(
            /* turbopackIgnore: true */ process.env.PGLITE_DATA_DIR ||
              ".data/local-postgres"
          );
    if (directory !== "memory://") {
      mkdirSync(directory, { recursive: true });
    }
    state.repopilotLocalDatabase = new PGlite(directory, {
      extensions: { vector },
    });
  }
  return state.repopilotLocalDatabase;
}

function remoteConnection() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is required for remote storage");
  }
  state.repopilotRemoteDatabase ??= postgres(url, {
    idle_timeout: 10,
    max: process.env.RESEARCH_LOCAL_DB === "1" ? 1 : 5,
    prepare: false,
  });
  return state.repopilotRemoteDatabase;
}

export const database = process.env.POSTGRES_URL
  ? remoteDrizzle(remoteConnection())
  : localDrizzle(localConnection());

export async function closeDatabase() {
  await state.repopilotLocalDatabase?.close();
  await state.repopilotRemoteDatabase?.end();
  state.repopilotLocalDatabase = undefined;
  state.repopilotRemoteDatabase = undefined;
}
