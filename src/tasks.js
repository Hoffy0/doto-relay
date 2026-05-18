import { randomBytes } from 'crypto';

const newId = () => randomBytes(16).toString('hex');

export function claimTask(db, agentId, role) {
  const result = db.prepare(`
    UPDATE tasks
    SET status = 'assigned', assigned_to = ?, started_at = datetime('now')
    WHERE id = (
      SELECT id FROM v_ready_tasks
      WHERE required_role = ? OR required_role IS NULL
      LIMIT 1
    ) AND status = 'pending'
  `).run(agentId, role);

  if (result.changes !== 1) return null;
  return db.prepare(`
    SELECT * FROM tasks WHERE assigned_to = ? AND status = 'assigned'
    ORDER BY updated_at DESC LIMIT 1
  `).get(agentId);
}

export function createTask(db, projectId, data) {
  const id = newId();
  db.prepare(`
    INSERT INTO tasks (id, project_id, title, description, task_type, priority, required_role, created_by, input_context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, projectId,
    data.title,
    data.description,
    data.task_type ?? 'implementation',
    data.priority ?? 5,
    data.required_role ?? null,
    data.created_by ?? null,
    data.input_context ?? null
  );
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
}

export function updateTask(db, taskId, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${fields} WHERE id = ?`).run(...Object.values(updates), taskId);
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
}

export function listTasks(db, projectId, { status } = {}) {
  if (status) {
    return db.prepare(`
      SELECT * FROM tasks WHERE project_id = ? AND status = ?
      ORDER BY priority ASC, created_at ASC
    `).all(projectId, status);
  }
  return db.prepare(`
    SELECT * FROM tasks WHERE project_id = ?
    ORDER BY priority ASC, created_at ASC
  `).all(projectId);
}

export function getTaskCounts(db, projectId) {
  return db.prepare(`
    SELECT status, count(*) as count FROM tasks
    WHERE project_id = ? GROUP BY status
  `).all(projectId);
}
