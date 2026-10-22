export interface ResearchProject {
  createdAt: string;
  description: string;
  id: string;
  name: string;
  repository: string;
  updatedAt: string;
}

export interface ResearchDocument {
  characterCount: number;
  chunkCount: number;
  createdAt: string;
  error?: string;
  id: string;
  name: string;
  projectId: string;
  status: "ready" | "failed";
}

export interface ResearchSource {
  documentId?: string;
  excerpt: string;
  id: string;
  kind: "document" | "github";
  retrievedAt: string;
  title: string;
  url?: string;
}

export interface ToolExecution {
  description: string;
  durationMs?: number;
  error?: string;
  finishedAt?: string;
  id: string;
  input: unknown;
  name: "searchDocuments" | "getRepository" | "searchIssues";
  output?: unknown;
  startedAt: string;
  status: "running" | "completed" | "failed";
}

export interface ResearchRun {
  createdAt: string;
  durationMs: number;
  error?: string;
  finishedAt?: string;
  id: string;
  inputTokens: number;
  mode: "demo" | "live";
  model: string;
  outputTokens: number;
  projectId: string;
  prompt: string;
  report: string;
  sources: ResearchSource[];
  status: "running" | "completed" | "failed" | "cancelled";
  tools: ToolExecution[];
}

export type ResearchEvent =
  | { type: "run"; run: ResearchRun }
  | { type: "tool"; tool: ToolExecution }
  | { type: "source"; source: ResearchSource }
  | { type: "text"; delta: string }
  | { type: "done"; run: ResearchRun }
  | { type: "error"; message: string; run?: ResearchRun };

export interface ResearchConfig {
  embeddingMode: "local" | "provider";
  limits: { maxFileBytes: number; maxDocuments: number; maxSteps: number };
  mode: "demo" | "live";
  model: string;
  user: { id: string; email: string };
}
