import { mkdir, writeFile } from "node:fs/promises";
import { request } from "@playwright/test";
import { runEvaluation } from "../tests/research/evaluation";

async function main() {
  const baseURL = process.env.RESEARCH_BASE_URL ?? "http://127.0.0.1:3100";
  const context = await request.newContext({ baseURL });
  try {
    const report = await runEvaluation(context);
    await mkdir("test-results", { recursive: true });
    await writeFile(
      "test-results/research-evaluation.json",
      JSON.stringify({ baseURL, ...report }, null, 2)
    );
    console.log(
      `Engineering/retrieval evaluation: ${report.passed}/${report.total} passed; mean duration ${report.meanDurationMs}ms.`
    );
    console.log(
      "Scope: explicit demo mode with GitHub fixtures. This does not test a live model's reasoning quality."
    );
    for (const result of report.results.filter((item) => !item.passed)) {
      console.error(`${result.id}: ${result.failures.join("; ")}`);
    }
    if (report.passed !== report.total) {
      process.exitCode = 1;
    }
  } finally {
    await context.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
