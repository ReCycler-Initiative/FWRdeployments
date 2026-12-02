BEGIN;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_delivery_mode_check;
ALTER TABLE projects ADD CONSTRAINT projects_delivery_mode_check
    CHECK (delivery_mode IN ('REPORT', 'RECOMMENDATION', 'PROCESS', 'GUIDE', 'EXPERIMENT',
                             'PROMPTS', 'PLAN', 'AGENTS'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_generation_mode VARCHAR(4)
    CHECK (delivery_generation_mode IN ('mock', 'ai'));
COMMIT;
