BEGIN;

CREATE OR REPLACE FUNCTION transcript_fingerprint(content TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
    normalized TEXT := replace(content, E'\r', '');
    spoken TEXT := '';
    block TEXT;
    lines TEXT[];
    cue INTEGER;
    i INTEGER;
BEGIN
    IF ltrim(normalized) ~ '^WEBVTT(\s|$)' THEN
        FOREACH block IN ARRAY regexp_split_to_array(normalized, E'\n\n+') LOOP
            IF btrim(block) = '' OR ltrim(block) ~ '^(WEBVTT|NOTE(\s|$)|STYLE(\s|$)|REGION(\s|$))' THEN
                CONTINUE;
            END IF;
            lines := string_to_array(block, E'\n');
            cue := 0;
            FOR i IN 1..array_length(lines, 1) LOOP
                IF lines[i] ~ '^\s*([0-9]{2}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3}\s+-->' THEN
                    cue := i;
                    EXIT;
                END IF;
            END LOOP;
            IF cue > 0 THEN
                FOR i IN cue+1..array_length(lines, 1) LOOP
                    spoken := spoken || ' ' || lines[i];
                END LOOP;
            END IF;
        END LOOP;
        IF btrim(spoken) <> '' THEN
            normalized := regexp_replace(spoken, '<[^>]*>', '', 'g');
            normalized := replace(replace(replace(replace(replace(replace(
                normalized, '&amp;', '&'), '&lt;', '<'), '&gt;', '>'),
                '&nbsp;', ' '), '&quot;', '"'), '&#39;', '''');
        END IF;
    END IF;
    normalized := normalize(btrim(regexp_replace(normalized, '\s+', ' ', 'g')), NFC);
    RETURN encode(sha256(convert_to(normalized, 'UTF8')), 'hex');
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_id_project_id_idx ON sessions(id, project_id);
CREATE TABLE IF NOT EXISTS workshop_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    storage_path TEXT,
    content TEXT NOT NULL CHECK (length(content) > 0),
    content_hash TEXT GENERATED ALWAYS AS (transcript_fingerprint(content)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (session_id, project_id) REFERENCES sessions(id, project_id) ON DELETE CASCADE,
    UNIQUE (session_id, content_hash)
);
CREATE INDEX IF NOT EXISTS workshop_transcripts_project_idx ON workshop_transcripts(project_id);

INSERT INTO workshop_transcripts(id, project_id, session_id, title, filename, storage_path, content)
SELECT s.id, s.project_id, s.id,
       coalesce(s.transcript_filename, nullif(regexp_replace(s.transcript_path, '^.*/', ''), ''), 'Workshop transcript'),
       coalesce(s.transcript_filename, nullif(regexp_replace(s.transcript_path, '^.*/', ''), ''), 'workshop-transcript.txt'),
       s.transcript_path, s.transcript_vtt
FROM sessions s
WHERE s.transcript_vtt IS NOT NULL AND btrim(s.transcript_vtt) <> ''
  AND (s.transcript_path IS NOT NULL OR s.video_path IS NULL OR lower(s.video_path) NOT LIKE '%.mp4')
  AND NOT EXISTS (SELECT 1 FROM workshop_transcripts t WHERE t.session_id=s.id)
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS workshop_transcripts_updated_at ON workshop_transcripts;
CREATE TRIGGER workshop_transcripts_updated_at BEFORE UPDATE ON workshop_transcripts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMIT;
