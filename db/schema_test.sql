BEGIN;

DO $$
DECLARE
    project UUID;
    other_project UUID;
    candidate UUID;
    workshop UUID;
    original_updated_at TIMESTAMPTZ;
BEGIN
    INSERT INTO projects (title) VALUES ('Schema test')
        RETURNING id, updated_at INTO project, original_updated_at;
    INSERT INTO projects (title) VALUES ('Other project') RETURNING id INTO other_project;
    INSERT INTO context_documents (project_id, filename) VALUES (project, 'context.txt');
    INSERT INTO sessions (project_id, video_path) VALUES (project, '/app/media/test.mp4') RETURNING id INTO workshop;
    INSERT INTO workshop_transcripts(project_id,session_id,title,filename,content)
        VALUES(project,workshop,'First source','source.txt','Original evidence');
    BEGIN
        INSERT INTO workshop_transcripts(project_id,session_id,title,filename,content)
            VALUES(other_project,workshop,'Foreign source','foreign.txt','Other evidence');
        RAISE EXCEPTION 'Cross-project workshop reference accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;
    BEGIN
        INSERT INTO workshop_transcripts(project_id,session_id,title,filename,content)
            VALUES(project,workshop,'Duplicate source','copy.vtt',
                   E'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nOriginal evidence\n\n');
        RAISE EXCEPTION 'Duplicate VTT/TXT evidence accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
    INSERT INTO solution_candidates (project_id, title, is_selected)
        VALUES (project, 'Selected candidate', true) RETURNING id INTO candidate;
    INSERT INTO agent_tasks (project_id, candidate_id, agent_role)
        VALUES (project, candidate, 'architect');

    BEGIN
        UPDATE solution_candidates SET generation_mode = 'real' WHERE id = candidate;
        RAISE EXCEPTION 'Invalid generation provenance accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        UPDATE projects SET status = 'INVALID' WHERE id = project;
        RAISE EXCEPTION 'Invalid project status accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO solution_candidates (project_id, title, is_selected)
            VALUES (project, 'Second selected candidate', true);
        RAISE EXCEPTION 'Multiple selected candidates accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO agent_tasks (project_id, candidate_id, agent_role)
            VALUES (other_project, candidate, 'qa');
        RAISE EXCEPTION 'Cross-project candidate reference accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO context_documents (project_id, filename, embedding)
            VALUES (project, 'invalid.txt', '[1,2,3]'::vector);
        RAISE EXCEPTION 'Wrong embedding dimensions accepted';
    EXCEPTION WHEN data_exception THEN
        NULL;
    END;

    PERFORM pg_sleep(0.01);
    UPDATE projects SET title = 'Updated schema test' WHERE id = project;
    IF NOT EXISTS (
        SELECT 1 FROM projects WHERE id = project AND updated_at > original_updated_at
    ) THEN
        RAISE EXCEPTION 'updated_at trigger did not advance timestamp';
    END IF;

    DELETE FROM projects WHERE id = project;
    IF EXISTS (SELECT 1 FROM context_documents WHERE project_id = project)
       OR EXISTS (SELECT 1 FROM sessions WHERE project_id = project)
       OR EXISTS (SELECT 1 FROM workshop_transcripts WHERE project_id = project)
       OR EXISTS (SELECT 1 FROM solution_candidates WHERE project_id = project)
       OR EXISTS (SELECT 1 FROM agent_tasks WHERE project_id = project) THEN
        RAISE EXCEPTION 'Project deletion left dependent records behind';
    END IF;
END;
$$;

ROLLBACK;
