import { run, get, all } from './db.js'
import { randomBytes } from 'crypto'

const newId = () => randomBytes(16).toString('hex')

export async function registerAgent(db, projectId, role, sessionLabel) {
  const id = newId()
  await run(db, `
    INSERT INTO agents (id, project_id, role, session_label, status, pid)
    VALUES (?, ?, ?, ?, 'active', ?)
  `, [id, projectId, role, sessionLabel, process.pid])
  return get(db, `SELECT * FROM agents WHERE id = ?`, [id])
}

export function startHeartbeat(db, agentId) {
  return setInterval(async () => {
    await run(db, `UPDATE agents SET last_heartbeat = datetime('now') WHERE id = ?`, [agentId])
  }, 30000)
}

export async function setStatus(db, agentId, status) {
  await run(db, `UPDATE agents SET status = ? WHERE id = ?`, [status, agentId])
}

export async function getAgents(db, projectId) {
  return all(db, `SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC`, [projectId])
}

export async function getUsedLabels(db, projectId) {
  const rows = await all(db, `
    SELECT session_label FROM agents WHERE project_id = ? AND session_label IS NOT NULL
  `, [projectId])
  return rows.map(r => r.session_label)
}
