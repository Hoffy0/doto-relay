-- PostgreSQL schema for doto-relay

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,
  root_path  TEXT NOT NULL UNIQUE,
  db_version INTEGER NOT NULL DEFAULT 1,
  meta       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK(role IN ('orchestrator','worker','reviewer','dba')),
  session_label  TEXT,
  status         TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('active','idle','offline')),
  pid            INTEGER,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id   TEXT REFERENCES tasks(id),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  task_type        TEXT NOT NULL DEFAULT 'implementation'
                     CHECK(task_type IN ('implementation','database','review','research','orchestration')),
  priority         INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 10),
  required_role    TEXT CHECK(required_role IN ('orchestrator','worker','reviewer','dba')),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','assigned','in_progress','review_pending','approved','done','rejected','escalated','cancelled')),
  assigned_to      TEXT REFERENCES agents(id),
  created_by       TEXT REFERENCES agents(id),
  input_context    TEXT,
  output_summary   TEXT,
  output_artifacts TEXT,
  rejection_count  INTEGER NOT NULL DEFAULT 0,
  max_rejections   INTEGER NOT NULL DEFAULT 3,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id != depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  reviewer_agent_id TEXT REFERENCES agents(id),
  decision          TEXT NOT NULL CHECK(decision IN ('approved','rejected','escalated')),
  feedback          TEXT,
  checklist         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS context_snapshots (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id         TEXT REFERENCES agents(id),
  task_id          TEXT REFERENCES tasks(id),
  snapshot_type    TEXT NOT NULL DEFAULT 'session_end'
                     CHECK(snapshot_type IN ('session_start','session_end','checkpoint')),
  role_context     TEXT,
  task_context     TEXT,
  relevant_files   TEXT,
  decisions_made   TEXT,
  open_questions   TEXT,
  next_action      TEXT,
  estimated_tokens INTEGER,
  context_pct      REAL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_agent_id TEXT REFERENCES agents(id),
  to_agent_id   TEXT REFERENCES agents(id),
  task_id       TEXT REFERENCES tasks(id),
  type          TEXT NOT NULL DEFAULT 'info'
                  CHECK(type IN ('info','question','answer','status_update','escalation')),
  content       TEXT NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id   TEXT REFERENCES agents(id),
  task_id    TEXT REFERENCES tasks(id),
  event_type TEXT NOT NULL,
  payload    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_project_role ON agents(project_id, role, status);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_required_role ON tasks(project_id, required_role, status);
CREATE INDEX IF NOT EXISTS idx_snapshots_agent_task ON context_snapshots(agent_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at DESC);

-- Trigger functions
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_task_status_changed()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status != NEW.status THEN
    INSERT INTO events (project_id, agent_id, task_id, event_type, payload)
    VALUES (NEW.project_id, NEW.assigned_to, NEW.id, 'task_status_changed',
      json_build_object('from', OLD.status, 'to', NEW.status, 'rejection_count', NEW.rejection_count)::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS trg_tasks_updated ON tasks;
CREATE TRIGGER trg_tasks_updated
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_task_status_event ON tasks;
CREATE TRIGGER trg_task_status_event
AFTER UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION log_task_status_changed();

-- Views
CREATE OR REPLACE VIEW v_ready_tasks AS
SELECT t.* FROM tasks t
WHERE t.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies td
    JOIN tasks dep ON dep.id = td.depends_on_task_id
    WHERE td.task_id = t.id AND dep.status != 'done'
  )
ORDER BY t.priority ASC, t.created_at ASC;

CREATE OR REPLACE VIEW v_latest_snapshots AS
SELECT cs.* FROM context_snapshots cs
INNER JOIN (
  SELECT agent_id, task_id, MAX(created_at) AS max_ts
  FROM context_snapshots GROUP BY agent_id, task_id
) latest ON cs.agent_id = latest.agent_id
  AND (cs.task_id = latest.task_id OR (cs.task_id IS NULL AND latest.task_id IS NULL))
  AND cs.created_at = latest.max_ts;
