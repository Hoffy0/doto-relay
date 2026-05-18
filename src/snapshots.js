import { randomBytes } from 'crypto';

const newId = () => randomBytes(16).toString('hex');

export function writeSnapshot(db, {
  projectId, agentId, taskId,
  type = 'session_end',
  roleContext, taskContext, relevantFiles,
  decisionsMade, openQuestions, nextAction,
  estimatedTokens, contextPct
}) {
  const id = newId();
  db.prepare(`
    INSERT INTO context_snapshots (
      id, project_id, agent_id, task_id, snapshot_type,
      role_context, task_context, relevant_files,
      decisions_made, open_questions, next_action,
      estimated_tokens, context_pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, projectId, agentId ?? null, taskId ?? null, type,
    roleContext ?? null, taskContext ?? null, relevantFiles ?? null,
    decisionsMade ?? null, openQuestions ?? null, nextAction ?? null,
    estimatedTokens ?? null, contextPct ?? null
  );
  return id;
}

export function getLatestSnapshot(db, agentId, taskId = null) {
  if (taskId) {
    return db.prepare(`
      SELECT * FROM v_latest_snapshots WHERE agent_id = ? AND task_id = ?
    `).get(agentId, taskId);
  }
  return db.prepare(`
    SELECT * FROM v_latest_snapshots WHERE agent_id = ? AND task_id IS NULL
  `).get(agentId);
}
