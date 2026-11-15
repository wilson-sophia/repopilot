import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  ResearchCheckpoint,
  ResearchMemory,
  ResearchSource,
  ToolExecution,
} from "./types";

const embedding = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  fromDriver: (value) => JSON.parse(value) as number[],
  toDriver: (value) => JSON.stringify(value),
});

export const researchProjects = pgTable(
  "research_project",
  {
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
    description: text("description").notNull().default(""),
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    ownerId: uuid("owner_id").notNull(),
    repository: text("repository").notNull().default(""),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("research_project_owner_idx").on(table.ownerId)]
);

export const researchDocuments = pgTable("research_document", {
  characterCount: integer("character_count").notNull(),
  chunkCount: integer("chunk_count").notNull().default(0),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  error: text("error"),
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => researchProjects.id, { onDelete: "cascade" }),
  status: varchar("status", { enum: ["ready", "failed"] }).notNull(),
});

export const researchChunks = pgTable("research_chunk", {
  content: text("content").notNull(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => researchDocuments.id, { onDelete: "cascade" }),
  embedding: embedding("embedding").notNull(),
  embeddingSpace: text("embedding_space").notNull(),
  id: uuid("id").primaryKey(),
  position: integer("position").notNull(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => researchProjects.id, { onDelete: "cascade" }),
  retrievalMetadata: jsonb("retrieval_metadata")
    .$type<{ keywords: string[]; questions: string[]; enrichment: string }>()
    .notNull()
    .default({ enrichment: "legacy", keywords: [], questions: [] }),
  searchText: text("search_text").notNull().default(""),
});

export const researchRuns = pgTable("research_run", {
  checkpoint: jsonb("checkpoint").$type<ResearchCheckpoint>(),
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  durationMs: integer("duration_ms").notNull().default(0),
  error: text("error"),
  finishedAt: timestamp("finished_at", { mode: "string", withTimezone: true }),
  id: uuid("id").primaryKey(),
  inputTokens: integer("input_tokens").notNull().default(0),
  memory: jsonb("memory").$type<ResearchMemory>(),
  memoryScope: text("memory_scope").notNull().default(""),
  mode: varchar("mode", { enum: ["demo", "live"] }).notNull(),
  model: text("model").notNull(),
  outputTokens: integer("output_tokens").notNull().default(0),
  ownerId: uuid("owner_id").notNull(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => researchProjects.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  report: text("report").notNull().default(""),
  sources: jsonb("sources").$type<ResearchSource[]>().notNull().default([]),
  status: varchar("status", {
    enum: ["running", "completed", "failed", "cancelled"],
  }).notNull(),
  tools: jsonb("tools").$type<ToolExecution[]>().notNull().default([]),
});
