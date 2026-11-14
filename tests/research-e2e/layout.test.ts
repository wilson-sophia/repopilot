import { expect, test } from "@playwright/test";
import { bootstrapGuest, createProject, executeRun } from "../research/helpers";

test("desktop reply scrolls independently while navigation and composer stay visible", async ({
  page,
}) => {
  await bootstrapGuest(page.request);
  const project = await createProject(page.request, { name: "布局验收项目" });
  await executeRun(
    page.request,
    project.id,
    "梳理项目功能和风险，并说明资料不足的部分"
  );
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/research");
  await page.getByTestId("run-report").waitFor();
  const sidebar = page.locator(".research-sidebar");
  const before = await sidebar.boundingBox();
  const thread = page.locator(".research-thread");
  await thread.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const after = await sidebar.boundingBox();
  expect(after?.y).toBe(before?.y);
  expect(after?.y).toBe(0);
  expect(after?.height).toBe(900);
  expect(await thread.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const composer = await page
    .getByLabel("研究问题", { exact: true })
    .boundingBox();
  if (!composer) {
    throw new Error("输入框不可见");
  }
  expect(composer.y + composer.height).toBeLessThan(900);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight)
  ).toBeLessThanOrEqual(901);
  await page.screenshot({ path: "work/workspace-layout-desktop.png" });
});
test("auth pages show Chinese content and fit a mobile screen", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "欢迎回到调研工作台" })
  ).toBeVisible();
  await expect(page.getByLabel("邮箱", { exact: true })).toBeVisible();
  await page.screenshot({ fullPage: true, path: "work/login-desktop.png" });
  await page.setViewportSize({ height: 800, width: 360 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(360);
  await expect(
    page.getByRole("button", { exact: true, name: "登录" })
  ).toBeVisible();
  await page.screenshot({ fullPage: true, path: "work/login-mobile.png" });
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "创建你的调研空间" })
  ).toBeVisible();
});
