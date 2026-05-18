// Claude Code Stop hook — saves session snapshot and marks agent idle.
// Fail-silent: any error is logged to stderr and does not block stopping.
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

const newId = () => randomBytes(16).toString('hex');

function findDbPath(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'harness.db');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const agentId = process.env.HARNESS_AGENT_ID;
  const dbPath = process.env.HARNESS_DB_PATH ?? findDbPath(process.cwd());

  if (!agentId || !dbPath) return;

  let sessionData = {};
  try { sessionData = JSON.parse(input); } catch {}

  try {
    const db = new Database(dbPath);

    const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId);
    if (!agent) { db.close(); return; }

    // Find current assigned task if any
    const task = db.prepare(`
      SELECT * FROM tasks WHERE assigned_to = ? AND status IN ('assigned','in_progress') LIMIT 1
    `).get(agentId);

    const snapshotId = newId();
    db.prepare(`
      INSERT INTO context_snapshots (
        id, project_id, agent_id, task_id, snapshot_type, role_context, next_action
      ) VALUES (?, ?, ?, ?, 'session_end', ?, ?)
    `).run(
      snapshotId,
      agent.project_id,
      agentId,
      task?.id ?? null,
      `Role: ${agent.role}, session: ${agent.session_label ?? agentId}`,
      task ? `Resume task: ${task.title}` : null
    );

    db.prepare(`UPDATE agents SET status = 'idle' WHERE id = ?`).run(agentId);
    db.close();
  } catch (err) {
    process.stderr.write(`[harness hook] stop error: ${err.message}\n`);
  }
}

main();
