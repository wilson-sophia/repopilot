import { ProxyAgent } from "undici";

let cached: { url: string; agent: ProxyAgent } | undefined;
/** Explicit server-side model proxy; leaves local application requests untouched. */
export const modelFetch: typeof fetch = (input, init) => {
  const url = process.env.MODEL_PROXY_URL;
  if (!url) {
    return globalThis.fetch(input, init);
  }
  if (!cached || cached.url !== url) {
    cached?.agent.close().catch(() => {
      /* Closing an old idle proxy must not interrupt a new request. */
    });
    cached = { agent: new ProxyAgent(url), url };
  }
  return globalThis.fetch(input, {
    ...init,
    dispatcher: cached.agent,
  } as RequestInit);
};
