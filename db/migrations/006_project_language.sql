BEGIN;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS language VARCHAR(2) NOT NULL DEFAULT 'fi'
    CHECK (language IN ('fi', 'en'));
COMMIT;
