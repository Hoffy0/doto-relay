// Claude Code Stop hook — saves session snapshot and marks agent idle.
// Fail-silent: any error is logged to stderr and does not block stopping.
import { isPostgres, getDb, findDbPath, run, get } from '../src/db.js'
import { randomBytes } from 'crypto'

const newId = () => randomBytes(16).toString('hex')

async function main() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk

  const agentId = process.env.DOTO_AGENT_ID

  let db = null
  if (isPostgres) {
    if (!agentId) return
    db = getDb(null)
  } else {
    const dbPath = process.env.DOTO_DB_PATH ?? findDbPath(process.cwd())
    if (!agentId || !dbPath) return
    db = getDb(dbPath)
  }

  try {
    const agent = await get(db, `SELECT * FROM agents WHERE id = ?`, [agentId])
    if (!agent) return

    const task = await get(db, `
      SELECT * FROM tasks WHERE assigned_to = ? AND status IN ('assigned','in_progress') LIMIT 1
    `, [agentId])

    const snapshotId = newId()
    await run(db, `
      INSERT INTO context_snapshots (
        id, project_id, agent_id, task_id, snapshot_type, role_context, next_action
      ) VALUES (?, ?, ?, ?, 'session_end', ?, ?)
    `, [
      snapshotId,
      agent.project_id,
      agentId,
      task?.id ?? null,
      `Role: ${agent.role}, session: ${agent.session_label ?? agentId}`,
      task ? `Resume task: ${task.title}` : null
    ])

    await run(db, `UPDATE agents SET status = 'idle' WHERE id = ?`, [agentId])
  } catch (err) {
    process.stderr.write(`[doto hook] stop error: ${err.message}\n`)
  } finally {
    if (db) {
      if (isPostgres) await db.end().catch(() => {})
      else db.close()
    }
  }
}

main()
