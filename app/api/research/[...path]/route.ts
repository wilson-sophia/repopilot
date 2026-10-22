import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { abortResearch, executeResearch } from "@/lib/research/agent";
import {
  limits,
  modelName,
  ResearchError,
  researchMode,
  safeError,
} from "@/lib/research/config";
import {
  cancelRun,
  createProject,
  createRun,
  deleteProject,
  getDocument,
  getRun,
  importDocument,
  listProjects,
  projectDetail,
  removeDocument,
} from "@/lib/research/store";
import type { ResearchEvent } from "@/lib/research/types";
import { identifier, projectInput, runInput } from "@/lib/research/validation";

export const maxDuration = 300;

type Context = { params: Promise<{ path: string[] }> };

function json(value: unknown, status = 200) {
  return Response.json(value, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

async function boundedBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) {
    throw new ResearchError("请求内容过大", 413);
  }
  const reader = request.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  if (!reader) {
    return new Uint8Array();
  }
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: Enforce the byte limit while consuming sequential stream chunks.
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ResearchError("请求内容过大", 413);
    }
    parts.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return body;
}
async function bodyJSON(request: Request): Promise<unknown> {
  try {
    return JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 32_768))
    );
  } catch (error) {
    if (error instanceof ResearchError) {
      throw error;
    }
    // biome-ignore lint/style/useErrorCause: ResearchError accepts ErrorOptions as its third argument.
    throw new ResearchError("请求 JSON 格式不正确", 400, { cause: error });
  }
}

async function handler(request: Request, context: Context) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new ResearchError("请先打开工作台建立会话", 401);
    }
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      // Next may normalize request.url to localhost. Host is the browser-facing
      // authority; a deployment behind a proxy may set an explicit APP_ORIGIN.
      const expectedOrigin =
        process.env.APP_ORIGIN ||
        `${new URL(request.url).protocol}//${request.headers.get("host") || new URL(request.url).host}`;
      if (origin && origin !== expectedOrigin) {
        throw new ResearchError("请求来源不匹配", 403);
      }
    }
    const ownerId = session.user.id;
    const { path } = await context.params;
    const [resource, rawId, child] = path;
    const id = rawId ? identifier.parse(rawId) : undefined;
    if (resource === "config" && request.method === "GET") {
      return json({
        embeddingMode: researchMode() === "live" ? "provider" : "local",
        limits: {
          maxDocuments: limits.maxDocuments,
          maxFileBytes: limits.maxFileBytes,
          maxSteps: limits.maxSteps,
        },
        mode: researchMode(),
        model: modelName(),
        user: { email: session.user.email || "", id: ownerId },
      });
    }
    if (resource === "projects" && !id) {
      if (request.method === "GET") {
        return json({ projects: await listProjects(ownerId) });
      }
      if (request.method === "POST") {
        return json(
          {
            project: await createProject(
              ownerId,
              projectInput.parse(await bodyJSON(request))
            ),
          },
          201
        );
      }
    }
    if (resource === "projects" && id) {
      if (!child && request.method === "GET") {
        return json(await projectDetail(ownerId, id));
      }
      if (!child && request.method === "DELETE") {
        await deleteProject(ownerId, id);
        return json({ ok: true });
      }
      if (child === "documents" && request.method === "POST") {
        const body = await boundedBody(request, limits.maxFileBytes + 16_384);
        let form: FormData;
        try {
          form = await new Response(body, {
            headers: {
              "content-type": request.headers.get("content-type") || "",
            },
          }).formData();
        } catch (error) {
          // biome-ignore lint/style/useErrorCause: ResearchError accepts ErrorOptions as its third argument.
          throw new ResearchError("请使用文件上传表单", 400, { cause: error });
        }
        const file = form.get("file");
        if (!(file instanceof File)) {
          throw new ResearchError("请选择一个 Markdown 或 TXT 文件");
        }
        if (!/\.(md|markdown|txt)$/i.test(file.name)) {
          throw new ResearchError("仅支持 Markdown / TXT 文件", 415);
        }
        if (file.size > limits.maxFileBytes) {
          throw new ResearchError("单份资料不能超过 1 MB", 413);
        }
        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(
            await file.arrayBuffer()
          );
        } catch (error) {
          // biome-ignore lint/style/useErrorCause: ResearchError accepts ErrorOptions as its third argument.
          throw new ResearchError("文件应为 UTF-8 文本", 400, { cause: error });
        }
        const name = file.name
          // biome-ignore lint/suspicious/noControlCharactersInRegex: Scrub untrusted filenames, including NUL and ASCII controls.
          .replace(/[/\\\u0000-\u001f]/g, "_")
          .slice(0, 200);
        return json(
          {
            document: await importDocument(
              ownerId,
              id,
              name,
              content,
              request.signal
            ),
          },
          201
        );
      }
      if (child === "runs" && request.method === "POST") {
        const { prompt } = runInput.parse(await bodyJSON(request));
        const run = await createRun(ownerId, id, prompt);
        const controller = new AbortController();
        let open = true;
        const stream = new ReadableStream<Uint8Array>({
          cancel() {
            open = false;
            controller.abort();
          },
          start(streamController) {
            const encoder = new TextEncoder();
            const emit = (event: ResearchEvent) => {
              if (!open) {
                return;
              }
              try {
                streamController.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                );
              } catch {
                open = false;
                controller.abort();
              }
            };
            executeResearch(
              ownerId,
              run,
              AbortSignal.any([request.signal, controller.signal]),
              emit
            )
              .catch(() => {
                emit({
                  message: "任务保存失败，请刷新历史记录",
                  type: "error",
                });
              })
              .finally(() => {
                if (open) {
                  open = false;
                  streamController.close();
                }
              });
          },
        });
        return new Response(stream, {
          headers: {
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "Content-Type": "text/event-stream; charset=utf-8",
            "X-Accel-Buffering": "no",
          },
        });
      }
    }
    if (resource === "documents" && id) {
      if (request.method === "GET") {
        return json(await getDocument(ownerId, id));
      }
      if (request.method === "DELETE") {
        await removeDocument(ownerId, id);
        return json({ ok: true });
      }
    }
    if (resource === "runs" && id) {
      if (child === "cancel" && request.method === "POST") {
        const run = await cancelRun(ownerId, id);
        abortResearch(id);
        return json({ run });
      }
      if (!child && request.method === "GET") {
        return json({ run: await getRun(ownerId, id) });
      }
      if (child === "export" && request.method === "GET") {
        const run = await getRun(ownerId, id);
        return new Response(run.report, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="repopilot-${run.id}.md"`,
            "Content-Type": "text/markdown; charset=utf-8",
          },
        });
      }
    }
    return json({ error: "接口不存在" }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(
        { error: "输入不符合要求，请检查名称、仓库地址或问题长度" },
        400
      );
    }
    return json(
      { error: safeError(error) },
      error instanceof ResearchError ? error.status : 500
    );
  }
}

export { handler as GET, handler as POST, handler as DELETE };
