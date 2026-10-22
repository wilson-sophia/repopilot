import { type APIRequestContext, expect } from "@playwright/test";
import type {
  ResearchDocument,
  ResearchEvent,
  ResearchProject,
  ResearchRun,
} from "../../lib/research/types";

export async function bootstrapGuest(request: APIRequestContext) {
  const response = await request.get("/research");
  expect(response.ok(), await response.text()).toBeTruthy();
  const config = await request.get("/api/research/config");
  expect(config.ok(), await config.text()).toBeTruthy();
  return config.json();
}

export async function createProject(
  request: APIRequestContext,
  overrides: Partial<
    Pick<ResearchProject, "name" | "description" | "repository">
  > = {}
): Promise<ResearchProject> {
  const response = await request.post("/api/research/projects", {
    data: {
      description: "用于验证检索、工具执行、结果持久化和用户隔离。",
      name: `验收项目 ${crypto.randomUUID().slice(0, 8)}`,
      repository: "",
      ...overrides,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).project;
}

export async function uploadDocument(
  request: APIRequestContext,
  projectId: string,
  content: string,
  name = "requirements.md"
): Promise<ResearchDocument> {
  const response = await request.post(
    `/api/research/projects/${projectId}/documents`,
    {
      multipart: {
        file: {
          buffer: Buffer.from(content, "utf8"),
          mimeType: name.endsWith(".md") ? "text/markdown" : "text/plain",
          name,
        },
      },
    }
  );
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).document;
}

export function parseEvents(body: string): ResearchEvent[] {
  return body.split(/\r?\n\r?\n/).flatMap((frame) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data && data !== "[DONE]" ? [JSON.parse(data) as ResearchEvent] : [];
  });
}

export async function executeRun(
  request: APIRequestContext,
  projectId: string,
  prompt: string
): Promise<{ run: ResearchRun; events: ResearchEvent[] }> {
  const response = await request.post(
    `/api/research/projects/${projectId}/runs`,
    {
      data: { prompt },
      timeout: 60_000,
    }
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/event-stream");
  const events = parseEvents(await response.text());
  const final = [...events]
    .reverse()
    .find((event) => event.type === "done" || event.type === "error");
  if (!final || !("run" in final) || !final.run) {
    throw new Error(
      `Run did not emit a terminal event: ${JSON.stringify(events)}`
    );
  }
  return { events, run: final.run };
}
