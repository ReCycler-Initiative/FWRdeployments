BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS agenda_mode VARCHAR(4)
    CHECK (agenda_mode IN ('mock', 'ai'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agenda_mode VARCHAR(4)
    CHECK (agenda_mode IN ('mock', 'ai'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS analysis_mode VARCHAR(4)
    CHECK (analysis_mode IN ('mock', 'ai'));
ALTER TABLE solution_candidates ADD COLUMN IF NOT EXISTS generation_mode VARCHAR(4)
    CHECK (generation_mode IN ('mock', 'ai'));
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS generation_mode VARCHAR(4)
    CHECK (generation_mode IN ('mock', 'ai'));

-- Only recognize known demo markers; unrecorded provenance must not imply real AI.
UPDATE projects SET agenda_mode = 'mock'
WHERE agenda_mode IS NULL AND (workshop_agenda LIKE '%SIMULOITU valmistelurunko%'
    OR workshop_agenda LIKE '%SIMULATED preparation draft%');
UPDATE sessions SET agenda_mode = 'mock'
WHERE agenda_mode IS NULL AND (agenda LIKE '%SIMULOITU valmistelurunko%'
    OR agenda LIKE '%SIMULATED preparation draft%');
UPDATE sessions SET analysis_mode = 'mock'
WHERE analysis_mode IS NULL AND jsonb_typeof(pain_points_json) = 'array'
    AND (pain_points_json::text LIKE '%[SIMULOITU LAINAUS]%'
         OR pain_points_json::text LIKE '%[SIMULATED QUOTE]%');
UPDATE solution_candidates SET generation_mode = 'mock'
WHERE generation_mode IS NULL AND (architecture_spec LIKE 'SIMULOITU arvio,%'
    OR architecture_spec LIKE 'SIMULATED estimate,%');
UPDATE agent_tasks SET generation_mode = 'mock'
WHERE generation_mode IS NULL AND (output_log LIKE '%MOCK_AI=True%'
    OR output_log LIKE '%SIMULOITU %' OR output_log LIKE '%SIMULATED %');

COMMIT;
