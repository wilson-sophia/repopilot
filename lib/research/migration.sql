CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS research_project (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES "User"(id), name varchar(100) NOT NULL,
 description text NOT NULL DEFAULT '', repository text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_project_owner_idx ON research_project(owner_id);
CREATE TABLE IF NOT EXISTS research_document (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES research_project(id) ON DELETE CASCADE,
 name text NOT NULL, content text NOT NULL, status varchar NOT NULL, chunk_count integer NOT NULL DEFAULT 0,
 character_count integer NOT NULL, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research_chunk (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES research_document(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES research_project(id) ON DELETE CASCADE,
 content text NOT NULL, position integer NOT NULL, embedding vector NOT NULL, embedding_space text NOT NULL
);
CREATE INDEX IF NOT EXISTS research_chunk_project_idx ON research_chunk(project_id, embedding_space);
CREATE TABLE IF NOT EXISTS research_run (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES research_project(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES "User"(id), prompt text NOT NULL, status varchar NOT NULL,
 mode varchar NOT NULL, model text NOT NULL, report text NOT NULL DEFAULT '',
 tools jsonb NOT NULL DEFAULT '[]', sources jsonb NOT NULL DEFAULT '[]',
 input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
 duration_ms integer NOT NULL DEFAULT 0, error text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS research_run_active_project_idx ON research_run(project_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS research_run_owner_idx ON research_run(owner_id, created_at);
