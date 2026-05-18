import Database from 'better-sqlite3'
import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

export const isPostgres = !!process.env.DOTO_DB_URL

let _pool = null
let _sqlite = null

export function getDb(dbPath) {
  if (isPostgres) {
    if (!_pool) {
      _pool = new Pool({ connectionString: process.env.DOTO_DB_URL })
    }
    return _pool
  } else {
    if (!_sqlite) {
      _sqlite = new Database(dbPath)
      _sqlite.pragma('journal_mode = WAL')
      _sqlite.pragma('foreign_keys = ON')
      _sqlite.pragma('busy_timeout = 5000')
    }
    return _sqlite
  }
}

// Convert SQLite-flavored SQL to Postgres: ? → $N, datetime('now') → now()
function pgify(sql) {
  let i = 0
  return sql
    .replace(/datetime\('now'\)/g, 'now()')
    .replace(/\?/g, () => `$${++i}`)
}

export async function run(db, sql, params = []) {
  if (isPostgres) {
    const result = await db.query(pgify(sql), params)
    return { changes: result.rowCount, lastInsertRowid: null }
  }
  return db.prepare(sql).run(...params)
}

export async function get(db, sql, params = []) {
  if (isPostgres) {
    const result = await db.query(pgify(sql), params)
    return result.rows[0] ?? null
  }
  return db.prepare(sql).get(...params) ?? null
}

export async function all(db, sql, params = []) {
  if (isPostgres) {
    const result = await db.query(pgify(sql), params)
    return result.rows
  }
  return db.prepare(sql).all(...params)
}

export async function initSchema(db) {
  const schemaFile = isPostgres ? 'schema.postgres.sql' : 'schema.sql'
  const schema = readFileSync(join(ROOT, schemaFile), 'utf8')
  if (isPostgres) {
    await db.query(schema)
  } else {
    db.exec(schema)
  }
}

export function findDbPath(startDir = process.cwd()) {
  let dir = startDir
  while (true) {
    const candidate = join(dir, 'doto.db')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
