import { expect, test } from "@playwright/test";

test("untrusted document markup never executes as report HTML", async ({
  page,
}) => {
  await page.goto("/research");
  await page.getByRole("button", { exact: true, name: "新建项目" }).click();
  const dialog = page.getByRole("dialog", { name: "新建调研项目" });
  await dialog
    .getByLabel("项目名称", { exact: true })
    .fill("不可信资料渲染验收");
  await dialog.getByRole("button", { exact: true, name: "创建项目" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("上传文档", { exact: true }).setInputFiles({
    buffer: Buffer.from(
      "# Document rendering safety\nThe document rendering requirements contain untrusted content.\n<script>window.__researchXss = true</script>\n[unsafe link](javascript:alert(1))\n"
    ),
    mimeType: "text/markdown",
    name: "untrusted-content.md",
  });
  await expect(
    page.getByText("untrusted-content.md", { exact: true }).first()
  ).toBeVisible();
  await page
    .getByLabel("研究问题", { exact: true })
    .fill("What are the document rendering requirements?");
  await page.getByRole("button", { exact: true, name: "开始调研" }).click();
  await expect(page.getByTestId("research-run")).toHaveAttribute(
    "data-status",
    "completed"
  );
  await expect(page.getByTestId("run-report")).toContainText(
    "document rendering"
  );
  expect(await page.evaluate("Boolean(window.__researchXss)")).toBe(false);
  const unsafeLinks = await page
    .getByTestId("run-report")
    .locator('a[href^="javascript:"]')
    .count();
  expect(unsafeLinks).toBe(0);
});
