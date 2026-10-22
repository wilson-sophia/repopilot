/** biome-ignore-all lint/suspicious/useAwait: Fetch mocks intentionally return Promises like native fetch. */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { ResearchError } from "../../lib/research/config";
import { embedTexts } from "../../lib/research/embeddings";

async function inLiveMode(run: () => Promise<void>) {
  const keys = [
    "RESEARCH_MODE",
    "MODEL_API_KEY",
    "MODEL_BASE_URL",
    "EMBEDDING_API_KEY",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  process.env.RESEARCH_MODE = "live";
  process.env.MODEL_API_KEY = "unit-test-key";
  process.env.EMBEDDING_API_KEY = "unit-test-key";
  process.env.EMBEDDING_BASE_URL = "https://embedding-unit.example/v1";
  process.env.EMBEDDING_MODEL = "unit-embedding";
  try {
    await run();
  } finally {
    mock.restoreAll();
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test("live embedding adapter sends configured model and returns real provider vectors", async () => {
  await inLiveMode(async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          url: String(input),
        });
        return new Response(
          JSON.stringify({
            data: [
              { embedding: [0.1, 0.2, 0.3], index: 0, object: "embedding" },
              { embedding: [0.4, 0.5, 0.6], index: 1, object: "embedding" },
            ],
            model: "unit-embedding",
            object: "list",
            usage: { prompt_tokens: 4, total_tokens: 4 },
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        );
      }
    );
    assert.deepEqual(await embedTexts(["first text", "second text"]), [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://embedding-unit.example/v1/embeddings"
    );
    assert.equal(requests[0].body.model, "unit-embedding");
    assert.deepEqual(requests[0].body.input, ["first text", "second text"]);
  });
});

test("live mode refuses missing credentials instead of silently generating local vectors", async () => {
  await inLiveMode(async () => {
    delete process.env.MODEL_API_KEY;
    delete process.env.EMBEDDING_API_KEY;
    await assert.rejects(
      embedTexts(["text"]),
      (error: unknown) => error instanceof ResearchError && error.status === 503
    );
  });
});

test("provider errors are sanitized rather than exposing upstream response content", async () => {
  await inLiveMode(async () => {
    mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Sensitive provider debug: unit-secret-should-not-leak",
              type: "invalid_request_error",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 401 }
        )
    );
    await assert.rejects(embedTexts(["text"]), (error: unknown) => {
      assert.ok(error instanceof ResearchError);
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /unit-secret|Sensitive provider/);
      return true;
    });
  });
});

test("malformed provider vector counts cannot be inserted as successful embeddings", async () => {
  await inLiveMode(async () => {
    mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2], index: 0, object: "embedding" }],
            model: "unit-embedding",
            object: "list",
            usage: { prompt_tokens: 4, total_tokens: 4 },
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
    );
    await assert.rejects(
      embedTexts(["one", "two"]),
      (error: unknown) => error instanceof ResearchError && error.status === 502
    );
  });
});
