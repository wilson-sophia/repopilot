/** biome-ignore-all lint/performance/noAwaitInLoops: Bound source reads and retain ordered evidence. */
import { ResearchError } from "./config";
import { githubJSON } from "./github";
import type { ResearchSource } from "./types";
import { normalizeRepository } from "./validation";

interface CodeFile {
  path: string;
  sha: string;
  size: number;
}
export interface CodeSnapshot {
  commit: string;
  files: CodeFile[];
  repository: string;
  truncated: boolean;
}
const fixtureCommit = "a".repeat(40);
const fixtureCode =
  "export async function streamResponse(signal: AbortSignal) {\n  signal.throwIfAborted();\n  return new ReadableStream({ start(controller) {\n    controller.enqueue(new TextEncoder().encode('data: response\\n\\n'));\n    controller.close();\n  } });\n}\n";

export function allowedCodePath(path: string) {
  return (
    path.length <= 300 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path
      .split("/")
      .some(
        (part) =>
          part === ".." ||
          part === "." ||
          part === ".git" ||
          part === "node_modules" ||
          part === "vendor" ||
          part === "dist" ||
          part.startsWith(".env")
      ) &&
    /(?:\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|c|h|cpp|hpp|cs|vue|svelte|json|toml|ya?ml|sql)|(?:^|\/)(?:Dockerfile|go\.mod|Cargo\.toml))$/i.test(
      path
    ) &&
    !/(?:lock\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.[jt]s|\.d\.ts)$/i.test(
      path
    )
  );
}

export async function repositorySnapshot(
  repositoryInput: string,
  signal: AbortSignal
): Promise<CodeSnapshot> {
  const repository = normalizeRepository(repositoryInput);
  if (!repository) {
    throw new ResearchError("项目尚未绑定 GitHub 仓库");
  }
  signal.throwIfAborted();
  if (process.env.RESEARCH_FIXTURES === "1") {
    // Reuse fixture errors/timeouts without creating a production network path.
    const { getRepository } = await import("./github");
    await getRepository(repository, signal);
    return {
      commit: fixtureCommit,
      files: [
        {
          path: "src/stream.ts",
          sha: "b".repeat(40),
          size: fixtureCode.length,
        },
      ],
      repository,
      truncated: false,
    };
  }
  const prefix = `repos/${repository.split("/").map(encodeURIComponent).join("/")}`;
  const info = await githubJSON(prefix, signal);
  if (info.private === true) {
    throw new ResearchError("当前源码分析仅支持公开仓库", 403);
  }
  const head = await githubJSON(
    `${prefix}/commits/${encodeURIComponent(String(info.default_branch || "HEAD"))}`,
    signal
  );
  const commit = String(head.sha || "");
  if (!/^[a-f0-9]{40}$/i.test(commit)) {
    throw new ResearchError("仓库提交标识无效", 502);
  }
  const tree = await githubJSON(
    `${prefix}/git/trees/${commit}?recursive=1`,
    signal
  );
  const entries = Array.isArray(tree.tree) ? tree.tree : [];
  const files = entries.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Record<string, unknown>;
    if (
      row.type !== "blob" ||
      !["100644", "100755"].includes(String(row.mode)) ||
      !allowedCodePath(String(row.path)) ||
      !/^[a-f0-9]{40}$/i.test(String(row.sha))
    ) {
      return [];
    }
    return [
      {
        path: String(row.path),
        sha: String(row.sha),
        size: Number(row.size || 0),
      },
    ];
  });
  return {
    commit,
    files: files.slice(0, 10_000),
    repository,
    truncated: tree.truncated === true || files.length > 10_000,
  };
}

export async function readCode(
  snapshot: CodeSnapshot,
  path: string,
  startLine: number,
  signal: AbortSignal
): Promise<ResearchSource> {
  signal.throwIfAborted();
  if (!allowedCodePath(path) || !Number.isInteger(startLine) || startLine < 1) {
    throw new ResearchError("源码路径或起始行无效");
  }
  const file = snapshot.files.find((entry) => entry.path === path);
  if (!file) {
    throw new ResearchError("文件不在本次仓库快照的可读源码范围内", 404);
  }
  if (file.size > 200_000) {
    throw new ResearchError("源码文件超过200KB读取限制，请选择较小文件");
  }
  let content: string;
  if (process.env.RESEARCH_FIXTURES === "1") {
    content = fixtureCode;
  } else {
    const prefix = `repos/${snapshot.repository.split("/").map(encodeURIComponent).join("/")}`;
    const blob = await githubJSON(`${prefix}/git/blobs/${file.sha}`, signal);
    if (
      blob.encoding !== "base64" ||
      typeof blob.content !== "string" ||
      blob.content.length > 300_000
    ) {
      throw new ResearchError("源码编码不受支持或内容过大", 502);
    }
    const buffer = Buffer.from(blob.content, "base64");
    if (buffer.length > 200_000 || buffer.includes(0)) {
      throw new ResearchError("文件不是可读取的文本源码");
    }
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  }
  signal.throwIfAborted();
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (startLine > lines.length) {
    throw new ResearchError("起始行超过文件行数");
  }
  const selected: string[] = [];
  let length = 0;
  for (
    let i = startLine - 1;
    i < Math.min(lines.length, startLine + 149);
    i += 1
  ) {
    const line = `${i + 1}: ${lines[i]}`;
    if (length + line.length > 12_000) {
      break;
    }
    selected.push(line);
    length += line.length + 1;
  }
  if (!selected.length) {
    throw new ResearchError("单行源码过长，无法提供完整行证据");
  }
  const endLine = startLine + selected.length - 1;
  return {
    commit: snapshot.commit,
    endLine,
    excerpt: selected.join("\n"),
    filePath: path,
    id: "",
    kind: "github",
    retrievedAt: new Date().toISOString(),
    startLine,
    title: `${path}:${startLine}-${endLine}`,
    url: `https://github.com/${snapshot.repository}/blob/${snapshot.commit}/${path.split("/").map(encodeURIComponent).join("/")}#L${startLine}-L${endLine}`,
  };
}

export function selectCodeFiles(snapshot: CodeSnapshot, query: string) {
  const keywords = query.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  return snapshot.files
    .map((file) => ({
      file,
      score:
        keywords.reduce(
          (sum, word) => sum + (file.path.toLowerCase().includes(word) ? 5 : 0),
          0
        ) +
        (/^(src|lib|app|server|backend)\//.test(file.path) ? 2 : 0) +
        (/(package\.json|go\.mod|main\.|index\.|route\.|auth|search|retriev|stream)/i.test(
          file.path
        )
          ? 1
          : 0),
    }))
    .filter(({ file }) => file.size <= 200_000)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, 4)
    .map(({ file }) => file);
}
