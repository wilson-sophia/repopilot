import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany } from "ai";
import { ResearchError, researchMode } from "./config";

export function terms(text: string): string[] {
  const result =
    text.toLowerCase().match(/[a-z0-9][a-z0-9_+.-]{1,}|[\p{Script=Han}]+/gu) ??
    [];
  return result.flatMap((term) =>
    /\p{Script=Han}/u.test(term)
      ? [...Array.from(term)].flatMap((_, index, characters) =>
          index < characters.length - 1
            ? [characters.slice(index, index + 2).join("")]
            : []
        )
      : [term]
  );
}

/** 演示模式的特征哈希向量；不是语义 Embedding。 / Demo-only feature hashing. */
export function localEmbedding(text: string): number[] {
  const vector = new Array<number>(384).fill(0);
  for (const term of terms(text)) {
    let hash = 2_166_136_261;
    for (const character of term) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
    }
    vector[(hash >>> 0) % vector.length] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) {
    vector[0] = 1;
  }
  return norm ? vector.map((value) => value / norm) : vector;
}

export async function embedTexts(
  texts: string[],
  signal?: AbortSignal
): Promise<number[][]> {
  if (researchMode() === "demo") {
    return texts.map(localEmbedding);
  }
  const apiKey = process.env.EMBEDDING_API_KEY || process.env.MODEL_API_KEY;
  if (!apiKey) {
    throw new ResearchError("真实模型模式尚未配置 Embedding API 密钥", 503);
  }
  const provider = createOpenAICompatible({
    apiKey,
    baseURL:
      process.env.EMBEDDING_BASE_URL ||
      process.env.MODEL_BASE_URL ||
      "https://api.openai.com/v1",
    name: "research-embeddings",
  });
  try {
    const result = await embedMany({
      abortSignal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
      maxRetries: 1,
      model: provider.embeddingModel(
        process.env.EMBEDDING_MODEL || "text-embedding-3-small"
      ),
      values: texts,
    });
    if (
      result.embeddings.length !== texts.length ||
      result.embeddings.some(
        (vector) =>
          !vector.length || vector.some((value) => !Number.isFinite(value))
      )
    ) {
      throw new Error("Invalid embedding response");
    }
    return result.embeddings;
  } catch (error) {
    signal?.throwIfAborted();
    // biome-ignore lint/style/useErrorCause: ResearchError accepts ErrorOptions as its third argument.
    throw new ResearchError(
      "Embedding 请求失败，请检查模型配置与服务状态",
      502,
      { cause: error }
    );
  }
}

export function chunkDocument(
  content: string,
  size = 900,
  overlap = 120
): string[] {
  const text = content.replace(/\r\n/g, "\n").replaceAll("\u0000", "").trim();
  if (!text) {
    return [];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + size / 2) {
        end = boundary;
      }
    }
    chunks.push(text.slice(start, end));
    if (end === text.length) {
      break;
    }
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
