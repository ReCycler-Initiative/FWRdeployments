BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    language VARCHAR(2) NOT NULL DEFAULT 'fi' CHECK (language IN ('fi', 'en')),
    description TEXT,
    target_systems JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PREPARATION'
        CHECK (status IN ('PREPARATION', 'WORKSHOP_UPLOADED', 'CANDIDATES_READY',
                          'BUILDING', 'READY_FOR_REVIEW')),
    workshop_agenda TEXT,
    agenda_mode VARCHAR(4) CHECK (agenda_mode IN ('mock', 'ai')),
    active_delivery_id UUID,
    delivery_mode VARCHAR(16) CHECK (delivery_mode IN ('PROMPTS', 'PLAN', 'AGENTS')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE context_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_text TEXT,
    embedding VECTOR(1536),
    source_type VARCHAR(16) NOT NULL DEFAULT 'text' CHECK (source_type IN ('text', 'file', 'github')),
    source_url TEXT,
    source_revision TEXT,
    storage_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    video_path TEXT,
    transcript_vtt TEXT,
    transcript_path TEXT,
    transcript_filename TEXT,
    pain_points_json JSONB,
    current_state_mermaid TEXT,
    title TEXT NOT NULL DEFAULT 'Työpaja',
    agenda TEXT,
    agenda_mode VARCHAR(4) CHECK (agenda_mode IN ('mock', 'ai')),
    analysis_mode VARCHAR(4) CHECK (analysis_mode IN ('mock', 'ai')),
    notes TEXT NOT NULL DEFAULT '',
    scheduled_at TIMESTAMPTZ,
    meeting_url TEXT,
    uploaded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE solution_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT,
    benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
    risks JSONB NOT NULL DEFAULT '[]'::jsonb,
    estimated_cost NUMERIC(12, 2) CHECK (estimated_cost >= 0),
    architecture_spec TEXT,
    generation_mode VARCHAR(4) CHECK (generation_mode IN ('mock', 'ai')),
    is_selected BOOLEAN NOT NULL DEFAULT false,
    is_superseded BOOLEAN NOT NULL DEFAULT FALSE,
    solution_type VARCHAR(16) NOT NULL DEFAULT 'TECHNICAL'
        CHECK (solution_type IN ('TECHNICAL', 'PROCESS', 'HYBRID')),
    implementation_status VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED'
        CHECK (implementation_status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'COMPLETED')),
    implementation_notes TEXT NOT NULL DEFAULT '',
    implementation_url TEXT,
    implementation_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, project_id)
);

CREATE TABLE agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL,
    agent_role VARCHAR(16) NOT NULL CHECK (agent_role IN ('architect', 'coder', 'data', 'qa')),
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    output_log TEXT,
    generation_mode VARCHAR(4) CHECK (generation_mode IN ('mock', 'ai')),
    artifacts_path TEXT,
    delivery_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (candidate_id, project_id)
        REFERENCES solution_candidates(id, project_id) ON DELETE CASCADE
);

CREATE INDEX projects_status_idx ON projects(status);
CREATE INDEX context_documents_project_id_idx ON context_documents(project_id);
CREATE INDEX context_documents_embedding_idx
    ON context_documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX sessions_project_id_idx ON sessions(project_id);
CREATE INDEX solution_candidates_project_id_idx ON solution_candidates(project_id);
CREATE UNIQUE INDEX solution_candidates_selected_idx
    ON solution_candidates(project_id) WHERE is_selected;
CREATE INDEX agent_tasks_project_id_idx ON agent_tasks(project_id);
CREATE INDEX agent_tasks_delivery_idx ON agent_tasks(project_id, delivery_id);
CREATE INDEX agent_tasks_candidate_id_idx ON agent_tasks(candidate_id);
CREATE INDEX agent_tasks_status_idx ON agent_tasks(status);

CREATE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER agent_tasks_updated_at BEFORE UPDATE ON agent_tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
