import {
  type APIRequestContext,
  request as playwrightRequest,
} from "@playwright/test";
import {
  bootstrapGuest,
  createProject,
  executeRun,
  uploadDocument,
} from "./helpers";

export interface EvaluationCase {
  category:
    | "retrieval"
    | "insufficient-evidence"
    | "github-tools"
    | "tool-failure";
  document?: string;
  expectedEvidence?: string;
  id: string;
  prompt: string;
  repository?: string;
}

// These tasks measure deterministic retrieval and engineering behavior. They do
// not score model reasoning or imply that the live provider has been tested.
export const evaluationCases: EvaluationCase[] = [
  {
    category: "retrieval",
    document: "# Deployment\nThe deployment platform is Docker Compose.",
    expectedEvidence: "Docker Compose",
    id: "R01",
    prompt: "What deployment platform is required?",
  },
  {
    category: "retrieval",
    document:
      "# Database\nThe database is PostgreSQL with the pgvector extension for persistent project data.",
    expectedEvidence: "PostgreSQL",
    id: "R02",
    prompt: "Which database stores persistent data?",
  },
  {
    category: "retrieval",
    document:
      "# Frontend\nThe frontend framework is React with TypeScript and Next.js.",
    expectedEvidence: "React",
    id: "R03",
    prompt: "What frontend framework is used?",
  },
  {
    category: "retrieval",
    document:
      "# Authentication\nAuthentication must isolate documents by owner userId on every server request.",
    expectedEvidence: "userId",
    id: "R04",
    prompt: "What authentication rule applies to documents?",
  },
  {
    category: "retrieval",
    document:
      "# Upload\nUpload accepts Markdown and TXT file formats. PDF upload is outside the current scope.",
    expectedEvidence: "Markdown and TXT",
    id: "R05",
    prompt: "Which upload file formats are supported?",
  },
  {
    category: "retrieval",
    document:
      "# Timeout\nThe repository request timeout limit is eight seconds.",
    expectedEvidence: "eight seconds",
    id: "R06",
    prompt: "What timeout limit applies to the repository request?",
  },
  {
    category: "retrieval",
    document:
      "# Streaming\nThe streaming protocol emits run, tool, source, text, done and error events.",
    expectedEvidence: "source, text, done",
    id: "R07",
    prompt: "Which events describe the streaming protocol?",
  },
  {
    category: "retrieval",
    document:
      "# Export\nThe report export format is Markdown and includes citation sources.",
    expectedEvidence: "Markdown",
    id: "R08",
    prompt: "What export format must the report support?",
  },
  {
    category: "retrieval",
    document:
      "# Accessibility\nAccessibility requirements include keyboard access, visible focus and labeled controls.",
    expectedEvidence: "visible focus",
    id: "R09",
    prompt: "What accessibility requirements apply to controls?",
  },
  {
    category: "retrieval",
    document:
      "# Retry\nThe retry policy uses bounded backoff for rate limits and transient server errors.",
    expectedEvidence: "bounded backoff",
    id: "R10",
    prompt: "What retry policy applies to rate limits?",
  },
  {
    category: "retrieval",
    document:
      "# Source metadata\nSource metadata retains title, original URL, retrieval timestamp and an evidence excerpt.",
    expectedEvidence: "retrieval timestamp",
    id: "R11",
    prompt: "Which source metadata must be retained?",
  },
  {
    category: "retrieval",
    document:
      "# Testing\nTesting scenarios cover a successful report, insufficient evidence, tool failure and cancellation.",
    expectedEvidence: "cancellation",
    id: "R12",
    prompt: "Which testing scenarios are required?",
  },
  {
    category: "insufficient-evidence",
    id: "N01",
    prompt: "What is the independently audited uptime SLA?",
  },
  {
    category: "insufficient-evidence",
    id: "N02",
    prompt: "How many paying production customers exist?",
  },
  {
    category: "insufficient-evidence",
    id: "N03",
    prompt: "What third-party security certification has been obtained?",
  },
  {
    category: "insufficient-evidence",
    id: "N04",
    prompt: "What measured production latency guarantees are available?",
  },
  {
    category: "github-tools",
    id: "G01",
    prompt: "Inspect the repository metadata and current integration issues.",
    repository: "https://github.com/vercel/next.js",
  },
  {
    category: "github-tools",
    id: "G02",
    prompt:
      "Check React compatibility using the repository and issue evidence.",
    repository: "https://github.com/facebook/react",
  },
  {
    category: "tool-failure",
    id: "F01",
    prompt: "Inspect this unavailable repository without fabricating details.",
    repository: "https://github.com/repopilot-fixtures/not-found",
  },
  {
    category: "tool-failure",
    id: "F02",
    prompt:
      "Inspect this temporarily unavailable repository and explain failures.",
    repository: "https://github.com/repopilot-fixtures/unavailable",
  },
];

export interface CaseResult {
  category: EvaluationCase["category"];
  durationMs: number;
  failures: string[];
  id: string;
  passed: boolean;
  runId?: string;
}

export async function evaluateResearchCase(
  request: APIRequestContext,
  task: EvaluationCase
): Promise<CaseResult> {
  const started = Date.now();
  const failures: string[] = [];
  let runId: string | undefined;
  try {
    const project = await createProject(request, {
      name: `评测 ${task.id}`,
      repository: task.repository ?? "",
    });
    if (task.document) {
      await uploadDocument(request, project.id, task.document, `${task.id}.md`);
    }
    const { run, events } = await executeRun(request, project.id, task.prompt);
    runId = run.id;
    if (run.mode !== "demo") {
      failures.push("Expected explicit demo mode");
    }
    if (!["completed", "failed"].includes(run.status)) {
      failures.push(`Unexpected terminal status: ${run.status}`);
    }
    if (run.status === "failed" && task.category !== "tool-failure") {
      failures.push("Run failed");
    }
    if (!events.some((event) => event.type === "run")) {
      failures.push("Missing initial run event");
    }
    if (
      task.category !== "tool-failure" &&
      !events.some((event) => event.type === "text")
    ) {
      failures.push("Missing report stream");
    }

    const storedResponse = await request.get(`/api/research/runs/${run.id}`);
    if (!storedResponse.ok()) {
      failures.push("Run was not persisted");
    } else if ((await storedResponse.json()).run.report !== run.report) {
      failures.push("Persisted report differs from streamed result");
    }

    if (task.category === "retrieval") {
      if (
        !run.sources.some(
          (source) =>
            source.kind === "document" &&
            source.excerpt.includes(task.expectedEvidence ?? "")
        )
      ) {
        failures.push(
          `Expected evidence not retrieved: ${task.expectedEvidence}`
        );
      }
      if (!/\[S\d+\]/.test(run.report)) {
        failures.push("Report does not cite evidence identifiers");
      }
    }
    if (task.category === "insufficient-evidence") {
      if (run.sources.length > 0) {
        failures.push("Invented a source for an empty knowledge base");
      }
      if (!run.report.includes("资料不足")) {
        failures.push("Did not disclose insufficient evidence");
      }
    }
    if (task.category === "github-tools") {
      for (const name of ["getRepository", "searchIssues"]) {
        if (
          !run.tools.some(
            (tool) => tool.name === name && tool.status === "completed"
          )
        ) {
          failures.push(`Missing successful ${name} execution`);
        }
      }
      if (!run.sources.some((source) => source.kind === "github")) {
        failures.push("Missing repository evidence");
      }
    }
    if (task.category === "tool-failure") {
      if (
        !run.tools.some(
          (tool) =>
            tool.name === "getRepository" &&
            tool.status === "failed" &&
            tool.error
        )
      ) {
        failures.push("Tool failure was not surfaced");
      }
      if (run.sources.some((source) => source.kind === "github")) {
        failures.push("Invented repository evidence after failure");
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  return {
    category: task.category,
    durationMs: Date.now() - started,
    failures,
    id: task.id,
    passed: failures.length === 0,
    runId,
  };
}

export async function runEvaluation(request: APIRequestContext) {
  const config = await bootstrapGuest(request);
  if (config.mode !== "demo") {
    throw new Error(
      "Fixed fixture evaluation requires RESEARCH_MODE=demo; refusing paid live-model calls."
    );
  }
  const configurationResponse = await request.get("/api/research/config");
  const baseURL = new URL(configurationResponse.url()).origin;
  const results: CaseResult[] = [];
  // Each case has its own owner. This also exercises session isolation without
  // disabling the application's real per-user request limit for test runs.
  for (const task of evaluationCases) {
    // biome-ignore lint/performance/noAwaitInLoops: Sequential cases keep measured latency independent of evaluation concurrency.
    const isolated = await playwrightRequest.newContext({ baseURL });
    try {
      await bootstrapGuest(isolated);
      results.push(await evaluateResearchCase(isolated, task));
    } finally {
      await isolated.dispose();
    }
  }
  const retrieval = results.filter((result) => result.category === "retrieval");
  return {
    engineeringSuccessRate:
      results.filter((result) => result.passed).length / results.length,
    evidenceRetrievalPassRate:
      retrieval.filter((result) => result.passed).length / retrieval.length,
    generatedAt: new Date().toISOString(),
    meanDurationMs: Math.round(
      results.reduce((sum, result) => sum + result.durationMs, 0) /
        results.length
    ),
    passed: results.filter((result) => result.passed).length,
    results,
    scope:
      "Deterministic engineering and retrieval evaluation; GitHub fixture mode required. Not a live LLM quality benchmark.",
    total: results.length,
  };
}
