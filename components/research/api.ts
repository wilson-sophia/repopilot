import type { ResearchEvent } from "@/lib/research/types";

export async function researchRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`/api/research${path}`, {
    ...init,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    let message = `请求失败（${response.status}）`;
    if (payload && typeof payload === "object") {
      if ("error" in payload && typeof payload.error === "string") {
        message = payload.error;
      } else if ("message" in payload && typeof payload.message === "string") {
        ({ message } = payload);
      }
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

/** 按完整 SSE 帧解码，避免 UTF-8 与 JSON 被网络分包截断。 Decode complete SSE frames. */
export async function readResearchStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ResearchEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (frame: string) => {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") {
      return;
    }
    onEvent(JSON.parse(data) as ResearchEvent);
  };
  try {
    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: Stream reads must preserve network frame order.
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) {
        break;
      }
    }
    if (buffer.trim()) {
      consume(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "暂时无法完成，请重试。";
}
