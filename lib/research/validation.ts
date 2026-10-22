import { z } from "zod";

export function normalizeRepository(value: string): string {
  const normalized = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  if (!normalized) {
    return "";
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(normalized)
  ) {
    throw new Error("请填写 GitHub 仓库地址或 owner/repository");
  }
  return normalized;
}
export const projectInput = z.object({
  description: z.string().trim().max(2000).default(""),
  name: z.string().trim().min(1).max(100),
  repository: z
    .string()
    .max(200)
    .default("")
    .transform((value, context) => {
      try {
        return normalizeRepository(value);
      } catch {
        context.addIssue({
          code: "custom",
          message: "仓库格式应为 GitHub 地址或 owner/repository",
        });
        return z.NEVER;
      }
    }),
});
export const runInput = z.object({
  prompt: z.string().trim().min(2).max(3000),
});
export const identifier = z.uuid();
