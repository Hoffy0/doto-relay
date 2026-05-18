import { randomBytes } from 'crypto';

const newId = () => randomBytes(16).toString('hex');

export function registerAgent(db, projectId, role, sessionLabel) {
  const id = newId();
  db.prepare(`
    INSERT INTO agents (id, project_id, role, session_label, status, pid)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).run(id, projectId, role, sessionLabel, process.pid);
  return db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id);
}

export function startHeartbeat(db, agentId) {
  const stmt = db.prepare(`UPDATE agents SET last_heartbeat = datetime('now') WHERE id = ?`);
  return setInterval(() => stmt.run(agentId), 30000);
}

export function setStatus(db, agentId, status) {
  db.prepare(`UPDATE agents SET status = ? WHERE id = ?`).run(status, agentId);
}

export function getAgents(db, projectId) {
  return db.prepare(`
    SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC
  `).all(projectId);
}

export function getUsedLabels(db, projectId) {
  return db.prepare(`
    SELECT session_label FROM agents WHERE project_id = ? AND session_label IS NOT NULL
  `).all(projectId).map(r => r.session_label);
}
