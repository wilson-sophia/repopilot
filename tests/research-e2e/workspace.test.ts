import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

async function createWorkspace(page: Page, name: string, repository = "") {
  await page.goto("/research");
  if ((page.viewportSize()?.width ?? 1000) < 760) {
    await page
      .getByRole("button", { exact: true, name: "打开项目导航" })
      .click();
  }
  await page.getByRole("button", { exact: true, name: "新建项目" }).click();
  const dialog = page.getByRole("dialog", { name: "新建调研项目" });
  await dialog.getByLabel("项目名称", { exact: true }).fill(name);
  if (repository) {
    await dialog.getByLabel("GitHub 仓库", { exact: true }).fill(repository);
  }
  await dialog
    .getByLabel("项目描述", { exact: true })
    .fill("验证真实文档检索、来源核验和调研报告。");
  await dialog.getByRole("button", { exact: true, name: "创建项目" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1000) > 700) {
    await expect(
      page.getByTestId("project-card").filter({ hasText: name })
    ).toBeVisible();
  }
}

test("new guest sees an explicit demo mode and can create a project", async ({
  page,
}) => {
  await createWorkspace(page, "浏览器项目验收");
  await expect(
    page.getByText(/演示模式|演示运行|离线演示|Demo/).first()
  ).toBeVisible();
  await expect(page.getByLabel("研究问题", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "开始调研" })
  ).toBeDisabled();
});

test("upload → research → source inspection → export → reload works end to end", async ({
  page,
}) => {
  await createWorkspace(page, "完整调研流程");
  await page.getByLabel("上传文档", { exact: true }).setInputFiles({
    buffer: Buffer.from(
      "# Deployment requirements\nThe deployment platform is Docker. PostgreSQL stores persistent project data.\n",
      "utf8"
    ),
    mimeType: "text/markdown",
    name: "deployment-requirements.md",
  });
  await expect(
    page.getByText("deployment-requirements.md", { exact: true }).first()
  ).toBeVisible();
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("What deployment platform and persistent storage are required?");
  await page.getByRole("button", { exact: true, name: "开始调研" }).click();
  await expect(page.getByTestId("run-report")).toContainText("Docker");
  await expect(
    page.getByRole("link", { exact: true, name: "导出报告" })
  ).toBeVisible();
  await expect(page.getByTestId("tool-card").first()).toBeVisible();
  await page.getByTestId("source-button").first().click();
  await expect(page.getByTestId("source-drawer")).toBeVisible();
  await expect(page.getByTestId("source-drawer")).toContainText("Docker");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("source-drawer")).not.toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { exact: true, name: "导出报告" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  if (!downloadPath) {
    throw new Error("The report download did not produce a file");
  }
  expect(await readFile(downloadPath, "utf8")).toContain("Docker");

  await page.reload();
  await expect(
    page.getByTestId("project-card").filter({ hasText: "完整调研流程" })
  ).toBeVisible();
  await expect(
    page.getByText("deployment-requirements.md", { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByTestId("run-report")).toContainText("Docker");
});

test("no-evidence report explains the gap instead of showing fabricated sources", async ({
  page,
}) => {
  await createWorkspace(page, "资料不足验收");
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("What is the audited production uptime SLA?");
  await page.getByRole("button", { exact: true, name: "开始调研" }).click();
  await expect(page.getByTestId("run-report")).toContainText("资料不足");
  await expect(
    page.getByRole("link", { exact: true, name: "导出报告" })
  ).toBeVisible();
});

test("project creation remains usable at a 360px viewport without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 360 });
  await createWorkspace(page, "移动端项目");
  await expect(page.getByLabel("研究问题", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("stream cancellation leaves a saved terminal state and permits retry", async ({
  page,
}) => {
  await createWorkspace(
    page,
    "取消任务验收",
    "https://github.com/repopilot-fixtures/slow"
  );
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("Explain the project requirements in detail.");
  await page.getByRole("button", { exact: true, name: "开始调研" }).click();
  await expect(page.getByTestId("research-run")).toHaveAttribute(
    "data-status",
    "running"
  );
  await page.getByRole("button", { exact: true, name: "停止" }).click();
  await expect(
    page.getByRole("button", { exact: true, name: "停止" })
  ).not.toBeVisible();
  await expect(page.getByText(/已取消|已停止|取消完成/).first()).toBeVisible();
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("What evidence is available?");
  await page.getByRole("button", { exact: true, name: "开始调研" }).click();
  await expect(page.getByTestId("run-report")).toContainText("资料不足");
});
