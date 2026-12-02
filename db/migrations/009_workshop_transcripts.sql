BEGIN;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS transcript_path TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS transcript_filename TEXT;
ALTER TABLE solution_candidates ADD COLUMN IF NOT EXISTS is_superseded BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE sessions SET transcript_path=video_path
WHERE transcript_path IS NULL AND (lower(video_path) LIKE '%.vtt' OR lower(video_path) LIKE '%.txt');

COMMIT;
