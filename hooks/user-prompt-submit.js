// Claude Code UserPromptSubmit hook — injects Harness context into each prompt.
// Fail-silent: any error passes the prompt through unchanged.
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

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

function buildContextBlock(db, agentId) {
  const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(agentId);
  if (!agent) return null;

  const lines = [
    `[HARNESS CONTEXT]`,
    `Agent: ${agent.session_label ?? agentId} (${agent.role})`,
    `Project ID: ${agent.project_id}`,
  ];

  // Latest snapshot
  const snapshot = db.prepare(`
    SELECT * FROM v_latest_snapshots WHERE agent_id = ? AND task_id IS NULL
  `).get(agentId);

  if (snapshot) {
    lines.push(`\nLast snapshot (${snapshot.snapshot_type} at ${snapshot.created_at}):`);
    if (snapshot.role_context)    lines.push(`  Role context: ${snapshot.role_context}`);
    if (snapshot.task_context)    lines.push(`  Task context: ${snapshot.task_context}`);
    if (snapshot.decisions_made)  lines.push(`  Decisions made: ${snapshot.decisions_made}`);
    if (snapshot.open_questions)  lines.push(`  Open questions: ${snapshot.open_questions}`);
    if (snapshot.next_action)     lines.push(`  Next action: ${snapshot.next_action}`);
    if (snapshot.relevant_files)  lines.push(`  Relevant files: ${snapshot.relevant_files}`);
  }

  // Unread messages
  const messages = db.prepare(`
    SELECT m.*, a.session_label as from_label, a.role as from_role
    FROM messages m
    LEFT JOIN agents a ON a.id = m.from_agent_id
    WHERE m.to_agent_id = ? AND m.read_at IS NULL
    ORDER BY m.created_at ASC
  `).all(agentId);

  if (messages.length > 0) {
    lines.push(`\nUnread messages (${messages.length}):`);
    for (const msg of messages) {
      const from = msg.from_label ? `${msg.from_label} (${msg.from_role})` : 'system';
      lines.push(`  [${msg.type}] from ${from}: ${msg.content}`);
    }
    // Mark as read
    db.prepare(`
      UPDATE messages SET read_at = datetime('now') WHERE to_agent_id = ? AND read_at IS NULL
    `).run(agentId);
  }

  // Current assigned task
  const task = db.prepare(`
    SELECT * FROM tasks WHERE assigned_to = ? AND status IN ('assigned','in_progress') LIMIT 1
  `).get(agentId);

  if (task) {
    lines.push(`\nCurrent task: [${task.status}] ${task.title}`);
    if (task.description) lines.push(`  Description: ${task.description}`);
    if (task.input_context) lines.push(`  Input context: ${task.input_context}`);
  }

  lines.push(`[/HARNESS CONTEXT]`);
  return lines.join('\n');
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.stdout.write(input);
    return;
  }

  const agentId = process.env.HARNESS_AGENT_ID;
  const dbPath = process.env.HARNESS_DB_PATH ?? findDbPath(process.cwd());

  if (!agentId || !dbPath) {
    process.stdout.write(JSON.stringify(data));
    return;
  }

  try {
    const db = new Database(dbPath, { readonly: false });
    const contextBlock = buildContextBlock(db, agentId);
    db.close();

    if (contextBlock && data.prompt) {
      data.prompt = `${contextBlock}\n\n${data.prompt}`;
    }
  } catch (err) {
    process.stderr.write(`[harness hook] user-prompt-submit error: ${err.message}\n`);
  }

  process.stdout.write(JSON.stringify(data));
}

main();
