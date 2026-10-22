/** biome-ignore-all lint/performance/noAwaitInLoops: Retries must wait for the prior attempt and bounded backoff. */
import { setTimeout as delay } from "node:timers/promises";
import { ResearchError } from "./config";

export interface RepositoryInfo {
  description: string;
  language: string;
  license: string;
  name: string;
  openIssues: number;
  stars: number;
  updatedAt: string;
  url: string;
}
export interface RepositoryIssue {
  state: string;
  title: string;
  updatedAt: string;
  url: string;
}

async function githubJSON(
  path: string,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/${path}`, {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "RepoPilot",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      });
    } catch (error) {
      signal.throwIfAborted();
      if (attempt < 2) {
        await delay(250 * 2 ** attempt, undefined, { signal });
        continue;
      }
      // biome-ignore lint/style/useErrorCause: ResearchError accepts ErrorOptions as its third argument.
      throw new ResearchError("GitHub 请求超时或网络不可用，请稍后重试", 502, {
        cause: error,
      });
    }
    if (response.ok) {
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new ResearchError("GitHub 返回了无法识别的数据", 502);
      }
      return data as Record<string, unknown>;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await delay(250 * 2 ** attempt, undefined, { signal });
      continue;
    }
    if (response.status === 404) {
      throw new ResearchError("GitHub 仓库不存在或无权访问", 404);
    }
    if (response.status === 403 || response.status === 429) {
      throw new ResearchError(
        "GitHub API 配额不足，请稍后重试或配置 GITHUB_TOKEN",
        429
      );
    }
    throw new ResearchError("GitHub 服务暂时不可用，请稍后重试", 502);
  }
  throw new ResearchError("GitHub 请求失败", 502);
}

async function fixture(repository: string, signal: AbortSignal) {
  // Startup-only test fixture. Never selected via an HTTP request parameter.
  if (process.env.RESEARCH_FIXTURES !== "1") {
    return false;
  }
  await delay(repository === "repopilot-fixtures/slow" ? 3000 : 60, undefined, {
    signal,
  });
  if (repository === "repopilot-fixtures/not-found") {
    throw new ResearchError("GitHub 仓库不存在或无权访问", 404);
  }
  if (repository === "repopilot-fixtures/unavailable") {
    throw new ResearchError("GitHub 服务暂时不可用，请稍后重试", 502);
  }
  return true;
}

export async function getRepository(
  repository: string,
  signal: AbortSignal
): Promise<RepositoryInfo> {
  if (await fixture(repository, signal)) {
    return {
      description: "自动化测试专用仓库元数据 fixture，不代表实时 GitHub 数据",
      language: "TypeScript",
      license: "MIT",
      name: repository,
      openIssues: 3,
      stars: 100,
      updatedAt: "2026-10-01T00:00:00Z",
      url: `https://github.com/${repository}`,
    };
  }
  const data = await githubJSON(
    `repos/${repository.split("/").map(encodeURIComponent).join("/")}`,
    signal
  );
  const license =
    data.license &&
    typeof data.license === "object" &&
    "spdx_id" in data.license
      ? String(data.license.spdx_id || "未声明")
      : "未声明";
  return {
    description: String(data.description || "未提供描述"),
    language: String(data.language || "未标注"),
    license,
    name: String(data.full_name || repository),
    openIssues: Number(data.open_issues_count || 0),
    stars: Number(data.stargazers_count || 0),
    updatedAt: String(data.pushed_at || ""),
    url: `https://github.com/${repository}`,
  };
}

export async function searchIssues(
  repository: string,
  query: string,
  signal: AbortSignal
): Promise<RepositoryIssue[]> {
  if (await fixture(repository, signal)) {
    return [
      {
        state: "open",
        title: "测试 fixture：React integration and streaming compatibility",
        updatedAt: "2026-10-01T00:00:00Z",
        url: `https://github.com/${repository}/issues/1`,
      },
    ];
  }
  const keywords = query
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .trim()
    .slice(0, 120);
  const data = await githubJSON(
    `search/issues?q=${encodeURIComponent(`repo:${repository} is:issue ${keywords}`)}&per_page=5&sort=updated`,
    signal
  );
  if (!Array.isArray(data.items)) {
    return [];
  }
  return data.items
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object")
    )
    .map((item) => ({
      state: String(item.state || "unknown"),
      title: String(item.title || "Issue"),
      updatedAt: String(item.updated_at || ""),
      url: String(item.html_url || `https://github.com/${repository}/issues`),
    }));
}
