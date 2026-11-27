BEGIN;

CREATE TABLE IF NOT EXISTS baseline_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number >= 0),
    summary TEXT NOT NULL,
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, version_number),
    UNIQUE (id, project_id)
);

CREATE TABLE IF NOT EXISTS ooda_iterations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    iteration_number INTEGER NOT NULL CHECK (iteration_number > 0),
    status TEXT NOT NULL DEFAULT 'OBSERVE' CHECK (status IN ('OBSERVE', 'ORIENT', 'ACT', 'COMPLETED')),
    baseline_version_id UUID NOT NULL,
    selected_solution_id UUID,
    decision_rationale TEXT,
    hypothesis TEXT,
    decided_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    accepted_delivery_id UUID,
    UNIQUE (project_id, iteration_number),
    UNIQUE (id, project_id),
    FOREIGN KEY (baseline_version_id, project_id) REFERENCES baseline_versions(id, project_id),
    CHECK (CASE WHEN status IN ('ACT', 'COMPLETED') THEN
        selected_solution_id IS NOT NULL AND COALESCE(btrim(decision_rationale), '') <> ''
        AND COALESCE(btrim(hypothesis), '') <> '' AND decided_at IS NOT NULL
        ELSE selected_solution_id IS NULL AND decision_rationale IS NULL
        AND hypothesis IS NULL AND decided_at IS NULL END),
    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
    CHECK ((status = 'COMPLETED') = (accepted_delivery_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ooda_iterations_open_idx ON ooda_iterations(project_id) WHERE status <> 'COMPLETED';

INSERT INTO baseline_versions(project_id, version_number, summary, snapshot)
SELECT p.id, 0, concat_ws(E'\n', p.title, p.description), '{"documents":[],"accepted_deliveries":[]}'
FROM projects p WHERE NOT EXISTS (SELECT 1 FROM baseline_versions b WHERE b.project_id=p.id);

INSERT INTO ooda_iterations(project_id, iteration_number, baseline_version_id)
SELECT p.id, 1, (SELECT b.id FROM baseline_versions b WHERE b.project_id=p.id ORDER BY version_number DESC LIMIT 1)
FROM projects p WHERE NOT EXISTS (SELECT 1 FROM ooda_iterations i WHERE i.project_id=p.id);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS iteration_id UUID;
ALTER TABLE solution_candidates ADD COLUMN IF NOT EXISTS iteration_id UUID;
UPDATE sessions s SET iteration_id=(SELECT i.id FROM ooda_iterations i WHERE i.project_id=s.project_id ORDER BY iteration_number DESC LIMIT 1)
WHERE iteration_id IS NULL;
UPDATE solution_candidates c SET iteration_id=(SELECT i.id FROM ooda_iterations i WHERE i.project_id=c.project_id ORDER BY iteration_number DESC LIMIT 1)
WHERE iteration_id IS NULL;
ALTER TABLE sessions ALTER COLUMN iteration_id SET NOT NULL;
ALTER TABLE solution_candidates ALTER COLUMN iteration_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS candidates_cycle_identity_idx ON solution_candidates(id, project_id, iteration_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sessions'::regclass AND conname='sessions_cycle_fk') THEN
        ALTER TABLE sessions ADD CONSTRAINT sessions_cycle_fk FOREIGN KEY (iteration_id, project_id) REFERENCES ooda_iterations(id, project_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='solution_candidates'::regclass AND conname='candidates_cycle_fk') THEN
        ALTER TABLE solution_candidates ADD CONSTRAINT candidates_cycle_fk FOREIGN KEY (iteration_id, project_id) REFERENCES ooda_iterations(id, project_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ooda_iterations'::regclass AND conname='ooda_selected_candidate_fk') THEN
        ALTER TABLE ooda_iterations ADD CONSTRAINT ooda_selected_candidate_fk
            FOREIGN KEY (selected_solution_id, project_id, id) REFERENCES solution_candidates(id, project_id, iteration_id);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION seed_initial_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO baseline_versions(project_id,version_number,summary,snapshot)
    VALUES (NEW.id,0,concat_ws(E'\n',NEW.title,NEW.description),'{"documents":[],"accepted_deliveries":[]}');
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS projects_seed_baseline ON projects;
CREATE TRIGGER projects_seed_baseline AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION seed_initial_baseline();

CREATE OR REPLACE FUNCTION assign_open_iteration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active UUID;
BEGIN
    PERFORM 1 FROM projects WHERE id=NEW.project_id FOR UPDATE;
    SELECT id INTO active FROM ooda_iterations WHERE project_id=NEW.project_id AND status <> 'COMPLETED';
    IF active IS NULL OR (NEW.iteration_id IS NOT NULL AND NEW.iteration_id <> active) THEN
        RAISE EXCEPTION 'An open iteration in this project is required' USING ERRCODE = '23514';
    END IF;
    NEW.iteration_id := active;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sessions_assign_iteration ON sessions;
CREATE TRIGGER sessions_assign_iteration BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION assign_open_iteration();
DROP TRIGGER IF EXISTS candidates_assign_iteration ON solution_candidates;
CREATE TRIGGER candidates_assign_iteration BEFORE INSERT ON solution_candidates FOR EACH ROW EXECUTE FUNCTION assign_open_iteration();

CREATE OR REPLACE FUNCTION lock_ooda_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.decided_at IS NOT NULL AND (OLD.status='COMPLETED' OR NEW.status NOT IN ('ACT','COMPLETED') OR
       (OLD.selected_solution_id, OLD.decision_rationale, OLD.hypothesis, OLD.decided_at)
       IS DISTINCT FROM (NEW.selected_solution_id, NEW.decision_rationale, NEW.hypothesis, NEW.decided_at)) THEN
        RAISE EXCEPTION 'Decision is already locked' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ooda_lock_decision ON ooda_iterations;
CREATE TRIGGER ooda_lock_decision BEFORE UPDATE ON ooda_iterations FOR EACH ROW EXECUTE FUNCTION lock_ooda_decision();

COMMIT;
