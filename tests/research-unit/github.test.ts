/** biome-ignore-all lint/suspicious/useAwait: Fetch mocks intentionally return Promises like native fetch. */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { ResearchError } from "../../lib/research/config";
import { getRepository, searchIssues } from "../../lib/research/github";

const repositoryPayload = {
  description: "A framework",
  full_name: "vercel/next.js",
  language: "TypeScript",
  license: { spdx_id: "MIT" },
  open_issues_count: 4,
  pushed_at: "2026-10-01T00:00:00Z",
  stargazers_count: 123,
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

async function withoutFixtures(run: () => Promise<void>) {
  const previous = process.env.RESEARCH_FIXTURES;
  process.env.RESEARCH_FIXTURES = "0";
  try {
    await run();
  } finally {
    mock.restoreAll();
    if (previous === undefined) {
      delete process.env.RESEARCH_FIXTURES;
    } else {
      process.env.RESEARCH_FIXTURES = previous;
    }
  }
}

test("GitHub adapter queries a fixed API origin and disallows redirects", async () => {
  await withoutFixtures(async () => {
    let target = "";
    let options: RequestInit | undefined;
    mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        target = String(input);
        options = init;
        return json(repositoryPayload);
      }
    );
    const repository = await getRepository(
      "vercel/next.js",
      new AbortController().signal
    );
    assert.equal(target, "https://api.github.com/repos/vercel/next.js");
    assert.equal(options?.redirect, "error");
    assert.equal(repository.license, "MIT");
    assert.equal(repository.stars, 123);
  });
});

test("transient 503 responses retry at most three requests then return successful evidence", async () => {
  await withoutFixtures(async () => {
    let attempts = 0;
    mock.method(globalThis, "fetch", async () => {
      attempts += 1;
      return attempts < 3 ? json({}, 503) : json(repositoryPayload);
    });
    const repository = await getRepository(
      "vercel/next.js",
      new AbortController().signal
    );
    assert.equal(repository.name, "vercel/next.js");
    assert.equal(attempts, 3);
  });
});

test("permanent 404 is never retried", async () => {
  await withoutFixtures(async () => {
    let attempts = 0;
    mock.method(globalThis, "fetch", async () => {
      attempts += 1;
      return json({}, 404);
    });
    await assert.rejects(
      getRepository("missing/repository", new AbortController().signal),
      (error: unknown) => error instanceof ResearchError && error.status === 404
    );
    assert.equal(attempts, 1);
  });
});

test("persistent 503 stops after three requests and sanitizes upstream error details", async () => {
  await withoutFixtures(async () => {
    let attempts = 0;
    mock.method(globalThis, "fetch", async () => {
      attempts += 1;
      return json({ message: "unit-sensitive-debug" }, 503);
    });
    await assert.rejects(
      getRepository("vercel/next.js", new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof ResearchError);
        assert.equal(error.status, 502);
        assert.doesNotMatch(error.message, /unit-sensitive-debug/);
        return true;
      }
    );
    assert.equal(attempts, 3);
  });
});

test("issue query stays scoped to the bound repository when user text contains qualifiers", async () => {
  await withoutFixtures(async () => {
    let target = "";
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      target = String(input);
      return json({
        items: [
          {
            html_url: "https://github.com/vercel/next.js/issues/1",
            state: "open",
            title: "Streaming issue",
            updated_at: "2026-10-01",
          },
        ],
      });
    });
    const issues = await searchIssues(
      "vercel/next.js",
      "is:pr repo:other/secret streaming",
      new AbortController().signal
    );
    const query = new URL(target).searchParams.get("q") ?? "";
    assert.match(query, /^repo:vercel\/next\.js is:issue /);
    assert.doesNotMatch(query, /repo:other|is:pr/);
    assert.equal(issues[0].title, "Streaming issue");
  });
});

test("abort cancels backoff instead of scheduling another network request", async () => {
  await withoutFixtures(async () => {
    const controller = new AbortController();
    let attempts = 0;
    mock.method(globalThis, "fetch", async () => {
      attempts += 1;
      setTimeout(() => controller.abort(), 5);
      return json({}, 503);
    });
    await assert.rejects(
      getRepository("vercel/next.js", controller.signal),
      (error: unknown) => error instanceof Error && error.name === "AbortError"
    );
    assert.equal(attempts, 1);
  });
});

test("malformed upstream JSON cannot be treated as repository data", async () => {
  await withoutFixtures(async () => {
    mock.method(globalThis, "fetch", async () => json([repositoryPayload]));
    await assert.rejects(
      getRepository("vercel/next.js", new AbortController().signal),
      (error: unknown) => error instanceof ResearchError && error.status === 502
    );
  });
});
