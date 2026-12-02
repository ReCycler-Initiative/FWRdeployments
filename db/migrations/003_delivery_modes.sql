BEGIN;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(16)
    CHECK (delivery_mode IN ('PROMPTS', 'PLAN', 'AGENTS'));
UPDATE projects SET delivery_mode = 'AGENTS'
    WHERE delivery_mode IS NULL AND status IN ('BUILDING', 'READY_FOR_REVIEW');
COMMIT;
