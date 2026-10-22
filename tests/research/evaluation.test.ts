import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { runEvaluation } from "./evaluation";

test("20 fixed cases cover evidence retrieval, missing evidence, GitHub tools and tool failure", async ({
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const report = await runEvaluation(request);
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/research-evaluation.json",
    JSON.stringify(report, null, 2)
  );
  await testInfo.attach("engineering-retrieval-evaluation", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });
  expect(report.total).toBe(20);
  expect(
    report.results.filter((result) => !result.passed),
    JSON.stringify(
      report.results.filter((result) => !result.passed),
      null,
      2
    )
  ).toEqual([]);
});
