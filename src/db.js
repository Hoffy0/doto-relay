import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'schema.sql');

export function findDbPath(startDir = process.cwd()) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'harness.db');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function openDb(dbPath) {
  const db = new Database(dbPath);
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  return db;
}

export function getOrCreateDb(startDir = process.cwd()) {
  let dbPath = findDbPath(startDir);
  const isNew = !dbPath;
  if (isNew) dbPath = join(startDir, 'harness.db');
  return { db: openDb(dbPath), dbPath, isNew };
}
