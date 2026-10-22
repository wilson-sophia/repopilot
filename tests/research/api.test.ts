import { expect, test } from "@playwright/test";
import {
  bootstrapGuest,
  createProject,
  executeRun,
  uploadDocument,
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await bootstrapGuest(request);
});

test("demo mode is explicit and never returns provider secrets", async ({
  request,
}) => {
  const response = await request.get("/api/research/config");
  const config = await response.json();
  expect(config.mode).toBe("demo");
  expect(config.embeddingMode).toBe("local");
  expect(config.user.id).toBeTruthy();
  expect(config.limits.maxSteps).toBeGreaterThan(0);
  expect(config).not.toHaveProperty("apiKey");
  expect(config).not.toHaveProperty("secret");
});

test("browser Origin matching the actual request Host can create a project", async ({
  request,
  baseURL,
}) => {
  const response = await request.post("/api/research/projects", {
    data: { name: "Same-origin browser request", repository: "" },
    headers: { Origin: baseURL ?? "http://127.0.0.1:3100" },
  });
  expect(response.status(), await response.text()).toBe(201);
});

test("foreign browser Origin cannot mutate authenticated user data", async ({
  request,
}) => {
  const response = await request.post("/api/research/projects", {
    data: { name: "Cross-origin request", repository: "" },
    headers: { Origin: "https://foreign-origin.example" },
  });
  expect(response.status()).toBe(403);
});

test("project creation validates name and rejects non-GitHub repositories", async ({
  request,
}) => {
  const responses = await Promise.all(
    [
      { name: "", repository: "" },
      { name: "Bad repository", repository: "http://127.0.0.1/private" },
      {
        name: "Bad repository",
        repository: "https://evil.example/vercel/next.js",
      },
    ].map((data) => request.post("/api/research/projects", { data }))
  );
  for (const response of responses) {
    expect(response.status()).toBe(400);
  }
});

test("new project is listed and survives a second request", async ({
  request,
}) => {
  const project = await createProject(request);
  const response = await request.get("/api/research/projects");
  expect(
    (await response.json()).projects.map((item: { id: string }) => item.id)
  ).toContain(project.id);
  const detail = await request.get(`/api/research/projects/${project.id}`);
  expect(await detail.json()).toMatchObject({
    documents: [],
    project: { id: project.id, name: project.name },
    runs: [],
  });
});

test("Markdown upload persists original content and index metadata", async ({
  request,
}) => {
  const project = await createProject(request);
  const content =
    "# Authentication\nAll project documents must be isolated by their owner.\n";
  const document = await uploadDocument(request, project.id, content);
  expect(document.status).toBe("ready");
  expect(document.chunkCount).toBeGreaterThan(0);
  expect(document.characterCount).toBe(content.length);
  const response = await request.get(`/api/research/documents/${document.id}`);
  expect(await response.json()).toMatchObject({
    content,
    document: { id: document.id },
  });
});

test("rejects unsupported, empty and oversized files", async ({ request }) => {
  const project = await createProject(request);
  const invalidFiles = [
    { content: "<script>alert(1)</script>", name: "payload.html" },
    { content: "   ", name: "empty.md" },
    { content: "a".repeat(1024 * 1024 + 1), name: "large.txt" },
  ];
  const responses = await Promise.all(
    invalidFiles.map((file) =>
      request.post(`/api/research/projects/${project.id}/documents`, {
        multipart: {
          file: {
            buffer: Buffer.from(file.content),
            mimeType: "text/plain",
            name: file.name,
          },
        },
      })
    )
  );
  for (const response of responses) {
    expect([400, 413, 415]).toContain(response.status());
  }
});

test("document search emits trace, cited evidence and persisted report", async ({
  request,
}) => {
  const project = await createProject(request);
  const document = await uploadDocument(
    request,
    project.id,
    "# Deployment\nThe deployment platform is Docker. The project uses PostgreSQL for persistent storage.\n"
  );
  const { run, events } = await executeRun(
    request,
    project.id,
    "What deployment platform and persistent storage does the project use?"
  );
  expect(run.status).toBe("completed");
  expect(run.mode).toBe("demo");
  expect(run.report.length).toBeGreaterThan(30);
  expect(
    run.sources.some((source) => source.documentId === document.id)
  ).toBeTruthy();
  expect(
    run.tools.some(
      (tool) => tool.name === "searchDocuments" && tool.status === "completed"
    )
  ).toBeTruthy();
  expect(events.some((event) => event.type === "text")).toBeTruthy();
  expect(events.some((event) => event.type === "source")).toBeTruthy();
  const persisted = await request.get(`/api/research/runs/${run.id}`);
  expect((await persisted.json()).run).toMatchObject({
    id: run.id,
    report: run.report,
    status: "completed",
  });
  const detail = await request.get(`/api/research/projects/${project.id}`);
  expect(
    (await detail.json()).runs.map((item: { id: string }) => item.id)
  ).toContain(run.id);
});

test("report export preserves the actual report and Markdown content type", async ({
  request,
}) => {
  const project = await createProject(request);
  const { run } = await executeRun(
    request,
    project.id,
    "Evaluate the available evidence."
  );
  const response = await request.get(`/api/research/runs/${run.id}/export`);
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/markdown");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(await response.text()).toContain(run.report);
});

test("empty knowledge base admits insufficient evidence", async ({
  request,
}) => {
  const project = await createProject(request);
  const { run } = await executeRun(
    request,
    project.id,
    "What is the production uptime SLA?"
  );
  expect(run.status).toBe("completed");
  expect(run.sources).toHaveLength(0);
  expect(run.report).toMatch(/不足|缺少|未找到|没有|无法|insufficient/i);
  expect(run.inputTokens).toBe(0);
  expect(run.outputTokens).toBe(0);
});

test("GitHub fixtures exercise repository and issue tools without external network", async ({
  request,
}) => {
  const project = await createProject(request, {
    repository: "https://github.com/vercel/next.js",
  });
  const { run } = await executeRun(
    request,
    project.id,
    "Investigate the repository and open issues for React integration."
  );
  expect(run.status).toBe("completed");
  expect(
    run.tools.some(
      (tool) => tool.name === "getRepository" && tool.status === "completed"
    )
  ).toBeTruthy();
  expect(
    run.tools.some(
      (tool) => tool.name === "searchIssues" && tool.status === "completed"
    )
  ).toBeTruthy();
  expect(run.sources.some((source) => source.kind === "github")).toBeTruthy();
});

test("permanent tool failure remains visible without invented repository evidence", async ({
  request,
}) => {
  const project = await createProject(request, {
    repository: "https://github.com/repopilot-fixtures/not-found",
  });
  const { run } = await executeRun(
    request,
    project.id,
    "Investigate this repository."
  );
  const repositoryTool = run.tools.find(
    (tool) => tool.name === "getRepository"
  );
  expect(repositoryTool?.status).toBe("failed");
  expect(repositoryTool?.error).toBeTruthy();
  expect(run.sources.filter((source) => source.kind === "github")).toHaveLength(
    0
  );
});

test("temporary tool failure is bounded and emits the final error", async ({
  request,
}) => {
  const project = await createProject(request, {
    repository: "https://github.com/repopilot-fixtures/unavailable",
  });
  const started = Date.now();
  const { run } = await executeRun(
    request,
    project.id,
    "Investigate repository availability."
  );
  expect(Date.now() - started).toBeLessThan(30_000);
  const repositoryTool = run.tools.find(
    (tool) => tool.name === "getRepository"
  );
  expect(repositoryTool?.status).toBe("failed");
  expect(repositoryTool?.error).toBeTruthy();
  expect(repositoryTool?.durationMs).toBeGreaterThanOrEqual(0);
});

test("empty prompt and malformed project ids do not start a run", async ({
  request,
}) => {
  const project = await createProject(request);
  const invalidPrompt = await request.post(
    `/api/research/projects/${project.id}/runs`,
    { data: { prompt: " " } }
  );
  expect(invalidPrompt.status()).toBe(400);
  const missing = await request.get("/api/research/projects/not-a-project");
  expect([400, 404]).toContain(missing.status());
});

test("another guest cannot list or read, mutate, export, or run against owned data", async ({
  request,
  playwright,
  baseURL,
}) => {
  const project = await createProject(request);
  const document = await uploadDocument(
    request,
    project.id,
    "# Private\nOwner-only confidential requirement.\n"
  );
  const { run } = await executeRun(
    request,
    project.id,
    "Find the private requirement."
  );
  const attacker = await playwright.request.newContext({ baseURL });
  try {
    await bootstrapGuest(attacker);
    const list = await attacker.get("/api/research/projects");
    expect(
      (await list.json()).projects.map((item: { id: string }) => item.id)
    ).not.toContain(project.id);
    const forbiddenRequests = [
      () => attacker.get(`/api/research/projects/${project.id}`),
      () => attacker.delete(`/api/research/projects/${project.id}`),
      () => attacker.get(`/api/research/documents/${document.id}`),
      () => attacker.delete(`/api/research/documents/${document.id}`),
      () => attacker.get(`/api/research/runs/${run.id}`),
      () => attacker.get(`/api/research/runs/${run.id}/export`),
      () => attacker.post(`/api/research/runs/${run.id}/cancel`),
      () =>
        attacker.post(`/api/research/projects/${project.id}/runs`, {
          data: { prompt: "Read private evidence" },
        }),
    ];
    const forbiddenResponses = await Promise.all(
      forbiddenRequests.map((send) => send())
    );
    for (const response of forbiddenResponses) {
      expect([403, 404]).toContain(response.status());
    }
    const foreignUpload = await attacker.post(
      `/api/research/projects/${project.id}/documents`,
      {
        multipart: {
          file: {
            buffer: Buffer.from("# Attack\nForeign content"),
            mimeType: "text/markdown",
            name: "attack.md",
          },
        },
      }
    );
    expect([403, 404]).toContain(foreignUpload.status());
  } finally {
    await attacker.dispose();
  }
});

test("deleted documents disappear from both library and future retrieval", async ({
  request,
}) => {
  const project = await createProject(request);
  const document = await uploadDocument(
    request,
    project.id,
    "# Secret\nThe specialized deployment marker is lunarbase-741.\n"
  );
  const deleted = await request.delete(
    `/api/research/documents/${document.id}`
  );
  expect(deleted.ok()).toBeTruthy();
  const detail = await request.get(`/api/research/projects/${project.id}`);
  expect((await detail.json()).documents).toHaveLength(0);
  const { run } = await executeRun(
    request,
    project.id,
    "Find lunarbase-741 deployment marker."
  );
  expect(
    run.sources.some((source) => source.documentId === document.id)
  ).toBeFalsy();
});
