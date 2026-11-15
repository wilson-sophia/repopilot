/** biome-ignore-all lint/performance/noAwaitInLoops: Recover tasks sequentially to bound provider load. */
import { eq } from "drizzle-orm";
import { closeDatabase, database } from "../lib/db/connection";
import { executeResearch } from "../lib/research/agent";
import { researchRuns } from "../lib/research/schema";
import { getRun } from "../lib/research/store";

async function recover() {
  const rows = await database
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.status, "running"));
  for (const row of rows) {
    const run = await getRun(row.ownerId, row.id);
    if (run.status !== "running") {
      continue;
    }
    await executeResearch(
      row.ownerId,
      run,
      new AbortController().signal,
      () => {
        /* Recovery is observed through persisted-state polling. */
      }
    );
  }
}
recover()
  .catch((error) => {
    console.error("任务恢复失败", error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
