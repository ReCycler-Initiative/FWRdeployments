BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS active_delivery_id UUID;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS delivery_id UUID;
CREATE INDEX IF NOT EXISTS agent_tasks_delivery_idx ON agent_tasks(project_id, delivery_id);

COMMIT;
