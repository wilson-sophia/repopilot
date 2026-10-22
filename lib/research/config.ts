export const limits = {
  maxChunks: 256,
  maxDocuments: 20,
  maxFileBytes: 1_048_576,
  maxPromptCharacters: 3000,
  maxSteps: 6,
} as const;

export function researchMode(): "demo" | "live" {
  return process.env.RESEARCH_MODE === "live" ? "live" : "demo";
}
export function modelName() {
  return researchMode() === "live"
    ? process.env.MODEL_NAME || "gpt-4.1-mini"
    : "本地证据演示（非大模型）";
}
export function embeddingSpace() {
  return researchMode() === "live"
    ? `provider:${process.env.EMBEDDING_BASE_URL || process.env.MODEL_BASE_URL || "https://api.openai.com/v1"}:${process.env.EMBEDDING_MODEL || "text-embedding-3-small"}`
    : "local-feature-hash-v1:384";
}

export class ResearchError extends Error {
  readonly status: number;
  constructor(message: string, status = 400, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

export function safeError(error: unknown) {
  if (error instanceof ResearchError) {
    return error.message;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "执行已取消";
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "请求超时，请稍后重试";
  }
  return "服务暂时不可用，请检查服务端配置或稍后重试";
}
