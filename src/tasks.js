import { run, get, all } from './db.js'
import { randomBytes } from 'crypto'

const newId = () => randomBytes(16).toString('hex')

export async function claimTask(db, agentId, role) {
  const result = await run(db, `
    UPDATE tasks
    SET status = 'assigned', assigned_to = ?, started_at = datetime('now')
    WHERE id = (
      SELECT id FROM v_ready_tasks
      WHERE required_role = ? OR required_role IS NULL
      LIMIT 1
    ) AND status = 'pending'
  `, [agentId, role])

  if (result.changes !== 1) return null
  return get(db, `
    SELECT * FROM tasks WHERE assigned_to = ? AND status = 'assigned'
    ORDER BY updated_at DESC LIMIT 1
  `, [agentId])
}

export async function createTask(db, projectId, data) {
  const id = newId()
  await run(db, `
    INSERT INTO tasks (id, project_id, title, description, task_type, priority, required_role, created_by, input_context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, projectId,
    data.title,
    data.description,
    data.task_type ?? 'implementation',
    data.priority ?? 5,
    data.required_role ?? null,
    data.created_by ?? null,
    data.input_context ?? null
  ])
  return get(db, `SELECT * FROM tasks WHERE id = ?`, [id])
}

export async function updateTask(db, taskId, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ')
  await run(db, `UPDATE tasks SET ${fields} WHERE id = ?`, [...Object.values(updates), taskId])
  return get(db, `SELECT * FROM tasks WHERE id = ?`, [taskId])
}

export async function listTasks(db, projectId, { status } = {}) {
  if (status) {
    return all(db, `
      SELECT * FROM tasks WHERE project_id = ? AND status = ?
      ORDER BY priority ASC, created_at ASC
    `, [projectId, status])
  }
  return all(db, `
    SELECT * FROM tasks WHERE project_id = ?
    ORDER BY priority ASC, created_at ASC
  `, [projectId])
}

export async function getTaskCounts(db, projectId) {
  return all(db, `
    SELECT status, count(*) as count FROM tasks
    WHERE project_id = ? GROUP BY status
  `, [projectId])
}
