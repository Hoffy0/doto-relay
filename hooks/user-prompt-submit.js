// Claude Code UserPromptSubmit hook — injects doto context into each prompt.
// Fail-silent: any error passes the prompt through unchanged.
import { isPostgres, getDb, findDbPath, run, get, all } from '../src/db.js'

async function buildContextBlock(db, agentId) {
  const agent = await get(db, `SELECT * FROM agents WHERE id = ?`, [agentId])
  if (!agent) return null

  const lines = [
    `[DOTO CONTEXT]`,
    `Agent: ${agent.session_label ?? agentId} (${agent.role})`,
    `Project ID: ${agent.project_id}`,
  ]

  const snapshot = await get(db, `
    SELECT * FROM v_latest_snapshots WHERE agent_id = ? AND task_id IS NULL
  `, [agentId])

  if (snapshot) {
    lines.push(`\nLast snapshot (${snapshot.snapshot_type} at ${snapshot.created_at}):`)
    if (snapshot.role_context)    lines.push(`  Role context: ${snapshot.role_context}`)
    if (snapshot.task_context)    lines.push(`  Task context: ${snapshot.task_context}`)
    if (snapshot.decisions_made)  lines.push(`  Decisions made: ${snapshot.decisions_made}`)
    if (snapshot.open_questions)  lines.push(`  Open questions: ${snapshot.open_questions}`)
    if (snapshot.next_action)     lines.push(`  Next action: ${snapshot.next_action}`)
    if (snapshot.relevant_files)  lines.push(`  Relevant files: ${snapshot.relevant_files}`)
  }

  const messages = await all(db, `
    SELECT m.*, a.session_label as from_label, a.role as from_role
    FROM messages m
    LEFT JOIN agents a ON a.id = m.from_agent_id
    WHERE m.to_agent_id = ? AND m.read_at IS NULL
    ORDER BY m.created_at ASC
  `, [agentId])

  if (messages.length > 0) {
    lines.push(`\nUnread messages (${messages.length}):`)
    for (const msg of messages) {
      const from = msg.from_label ? `${msg.from_label} (${msg.from_role})` : 'system'
      lines.push(`  [${msg.type}] from ${from}: ${msg.content}`)
    }
    await run(db, `
      UPDATE messages SET read_at = datetime('now') WHERE to_agent_id = ? AND read_at IS NULL
    `, [agentId])
  }

  const task = await get(db, `
    SELECT * FROM tasks WHERE assigned_to = ? AND status IN ('assigned','in_progress') LIMIT 1
  `, [agentId])

  if (task) {
    lines.push(`\nCurrent task: [${task.status}] ${task.title}`)
    if (task.description) lines.push(`  Description: ${task.description}`)
    if (task.input_context) lines.push(`  Input context: ${task.input_context}`)
  }

  lines.push(`[/DOTO CONTEXT]`)
  return lines.join('\n')
}

async function main() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk

  let data
  try {
    data = JSON.parse(input)
  } catch {
    process.stdout.write(input)
    return
  }

  const agentId = process.env.DOTO_AGENT_ID

  let db = null
  if (isPostgres) {
    if (!agentId) {
      process.stdout.write(JSON.stringify(data))
      return
    }
    db = getDb(null)
  } else {
    const dbPath = process.env.DOTO_DB_PATH ?? findDbPath(process.cwd())
    if (!agentId || !dbPath) {
      process.stdout.write(JSON.stringify(data))
      return
    }
    db = getDb(dbPath)
  }

  try {
    const contextBlock = await buildContextBlock(db, agentId)
    if (contextBlock && data.prompt) {
      data.prompt = `${contextBlock}\n\n${data.prompt}`
    }
  } catch (err) {
    process.stderr.write(`[doto hook] user-prompt-submit error: ${err.message}\n`)
  } finally {
    if (db) {
      if (isPostgres) await db.end().catch(() => {})
      else db.close()
    }
  }

  process.stdout.write(JSON.stringify(data))
}

main()
