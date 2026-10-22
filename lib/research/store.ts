import { randomUUID } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { database as db } from "../db/connection";
import {
  embeddingSpace,
  limits,
  modelName,
  ResearchError,
  researchMode,
} from "./config";
import { chunkDocument, embedTexts } from "./embeddings";
import {
  researchChunks as chunks,
  researchDocuments as documents,
  researchProjects as projects,
  researchRuns as runs,
} from "./schema";
import type {
  ResearchDocument,
  ResearchProject,
  ResearchRun,
  ResearchSource,
} from "./types";

function documentView(row: typeof documents.$inferSelect): ResearchDocument {
  return {
    characterCount: row.characterCount,
    chunkCount: row.chunkCount,
    createdAt: row.createdAt,
    error: row.error ?? undefined,
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    status: row.status,
  };
}
function runView(row: typeof runs.$inferSelect): ResearchRun {
  return {
    ...row,
    error: row.error ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
  };
}
export async function listProjects(
  ownerId: string
): Promise<ResearchProject[]> {
  return await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.updatedAt));
}
export async function requireProject(
  ownerId: string,
  id: string
): Promise<ResearchProject> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)));
  if (!project) {
    throw new ResearchError("项目不存在或无权访问", 404);
  }
  return project;
}
export async function createProject(
  ownerId: string,
  input: { name: string; description: string; repository: string }
) {
  const [project] = await db
    .insert(projects)
    .values({ id: randomUUID(), ownerId, ...input })
    .returning();
  return project;
}
export async function deleteProject(ownerId: string, id: string) {
  await requireProject(ownerId, id);
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)));
}
export async function projectDetail(ownerId: string, id: string) {
  const project = await requireProject(ownerId, id);
  const [documentRows, runRows] = await Promise.all([
    db
      .select()
      .from(documents)
      .where(eq(documents.projectId, id))
      .orderBy(desc(documents.createdAt)),
    db
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, id), eq(runs.ownerId, ownerId)))
      .orderBy(desc(runs.createdAt))
      .limit(50),
  ]);
  return {
    documents: documentRows.map(documentView),
    project,
    runs: runRows.map(runView),
  };
}
export async function getDocument(ownerId: string, id: string) {
  const [row] = await db
    .select({ document: documents })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(and(eq(documents.id, id), eq(projects.ownerId, ownerId)));
  if (!row) {
    throw new ResearchError("资料不存在或无权访问", 404);
  }
  return {
    content: row.document.content,
    document: documentView(row.document),
  };
}
export async function removeDocument(ownerId: string, id: string) {
  await getDocument(ownerId, id);
  await db.delete(documents).where(eq(documents.id, id));
}
export async function importDocument(
  ownerId: string,
  projectId: string,
  name: string,
  content: string,
  signal?: AbortSignal
): Promise<ResearchDocument> {
  await requireProject(ownerId, projectId);
  const [{ total }] = await db
    .select({ total: count() })
    .from(documents)
    .where(eq(documents.projectId, projectId));
  if (total >= limits.maxDocuments) {
    throw new ResearchError(`每个项目最多 ${limits.maxDocuments} 份资料`);
  }
  const parts = chunkDocument(content);
  if (!parts.length) {
    throw new ResearchError("资料内容不能为空");
  }
  if (parts.length > limits.maxChunks) {
    throw new ResearchError("资料过长，请拆分成较小的文件");
  }
  const id = randomUUID();
  try {
    const embeddings = await embedTexts(parts, signal);
    signal?.throwIfAborted();
    const row = await db.transaction(async (transaction) => {
      const [document] = await transaction
        .insert(documents)
        .values({
          characterCount: content.length,
          chunkCount: parts.length,
          content,
          id,
          name,
          projectId,
          status: "ready",
        })
        .returning();
      await transaction.insert(chunks).values(
        parts.map((part, position) => ({
          content: part,
          documentId: id,
          embedding: embeddings[position],
          embeddingSpace: embeddingSpace(),
          id: randomUUID(),
          position,
          projectId,
        }))
      );
      await transaction
        .update(projects)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(projects.id, projectId));
      return document;
    });
    return documentView(row);
  } catch (error) {
    if (error instanceof ResearchError) {
      const [document] = await db
        .insert(documents)
        .values({
          characterCount: content.length,
          content,
          error: error.message,
          id,
          name,
          projectId,
          status: "failed",
        })
        .returning();
      return documentView(document);
    }
    throw error;
  }
}
export async function searchDocuments(
  ownerId: string,
  projectId: string,
  query: string,
  signal?: AbortSignal
): Promise<ResearchSource[]> {
  await requireProject(ownerId, projectId);
  const [embedding] = await embedTexts([query], signal);
  const similarity = sql<number>`1 - (${chunks.embedding} <=> ${JSON.stringify(embedding)}::vector)`;
  const result = await db
    .select({
      content: chunks.content,
      documentId: chunks.documentId,
      id: chunks.id,
      name: documents.name,
      position: chunks.position,
      similarity,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(
      and(
        eq(chunks.projectId, projectId),
        eq(chunks.embeddingSpace, embeddingSpace())
      )
    )
    .orderBy(desc(similarity))
    .limit(5);
  return result
    .filter(
      (row) =>
        Number(row.similarity) > (researchMode() === "demo" ? 0.08 : 0.25)
    )
    .map((row) => ({
      documentId: row.documentId,
      excerpt: row.content,
      id: row.id,
      kind: "document",
      retrievedAt: new Date().toISOString(),
      title: `${row.name} · 片段 ${row.position + 1}`,
    }));
}
export async function createRun(
  ownerId: string,
  projectId: string,
  prompt: string
): Promise<ResearchRun> {
  await requireProject(ownerId, projectId);
  const [{ total }] = await db
    .select({ total: count() })
    .from(runs)
    .where(
      and(
        eq(runs.ownerId, ownerId),
        sql`${runs.createdAt} > now() - interval '1 minute'`
      )
    );
  if (total >= 10) {
    throw new ResearchError("请求过于频繁，请一分钟后重试", 429);
  }
  try {
    const [run] = await db
      .insert(runs)
      .values({
        id: randomUUID(),
        mode: researchMode(),
        model: modelName(),
        ownerId,
        projectId,
        prompt,
        status: "running",
      })
      .returning();
    return runView(run);
  } catch (error) {
    const cause =
      error instanceof Error && "cause" in error ? error.cause : error;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505"
    ) {
      // biome-ignore lint/style/useErrorCause: ResearchError accepts ErrorOptions as its third argument.
      throw new ResearchError(
        "这个项目已有正在执行的任务，请先停止或等待结束",
        409,
        { cause: error }
      );
    }
    throw error;
  }
}
export async function getRun(
  ownerId: string,
  id: string
): Promise<ResearchRun> {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.ownerId, ownerId)));
  if (!row) {
    throw new ResearchError("任务不存在或无权访问", 404);
  }
  return runView(row);
}
export async function saveRun(
  ownerId: string,
  run: ResearchRun
): Promise<ResearchRun> {
  const { id, projectId: _projectId, ...values } = run;
  const [updated] = await db
    .update(runs)
    .set({
      ...values,
      error: values.error ?? null,
      finishedAt: values.finishedAt ?? null,
    })
    .where(
      and(
        eq(runs.id, id),
        eq(runs.ownerId, ownerId),
        eq(runs.status, "running")
      )
    )
    .returning();
  return updated ? runView(updated) : getRun(ownerId, id);
}
export async function cancelRun(
  ownerId: string,
  id: string
): Promise<ResearchRun> {
  const run = await getRun(ownerId, id);
  if (run.status !== "running") {
    return run;
  }
  return saveRun(ownerId, {
    ...run,
    durationMs: Date.now() - new Date(run.createdAt).getTime(),
    error: "执行已取消，可查看已保存的部分结果或重新发起",
    finishedAt: new Date().toISOString(),
    status: "cancelled",
    tools: run.tools.map((entry) =>
      entry.status === "running"
        ? {
            ...entry,
            durationMs: Date.now() - new Date(entry.startedAt).getTime(),
            error: "执行已取消",
            finishedAt: new Date().toISOString(),
            status: "failed",
          }
        : entry
    ),
  });
}
