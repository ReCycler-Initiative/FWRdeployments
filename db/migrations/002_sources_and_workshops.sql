BEGIN;
ALTER TABLE context_documents
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(16) NOT NULL DEFAULT 'text'
        CHECK (source_type IN ('text', 'file', 'github')),
    ADD COLUMN IF NOT EXISTS source_url TEXT,
    ADD COLUMN IF NOT EXISTS source_revision TEXT,
    ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Työpaja',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
COMMIT;
