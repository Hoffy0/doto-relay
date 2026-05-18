import { Command } from 'commander';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

// config.js must be imported before db.js so that env vars (e.g. DOTO_DB_URL)
// are set before db.js evaluates isPostgres at module init time.
import { configExists } from './config.js';
import { runSetup } from './setup.js';

import { isPostgres, getDb, findDbPath, initSchema, run, get } from './db.js';
import { registerAgent, startHeartbeat, setStatus, getAgents, getUsedLabels } from './agents.js';
import { listTasks, getTaskCounts } from './tasks.js';
import { loadTheme, pickAgentName, formatMessage } from './themes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOOKS_DIR = join(ROOT, 'hooks');
const ROLES_DIR = join(ROOT, 'roles');

const newId = () => randomBytes(16).toString('hex');

async function ensureProject(db, cwd) {
  let project = await get(db, `SELECT * FROM projects WHERE root_path = ?`, [cwd]);
  if (!project) {
    const id = newId();
    await run(db, `INSERT INTO projects (id, name, root_path) VALUES (?, ?, ?)`, [id, basename(cwd), cwd]);
    project = await get(db, `SELECT * FROM projects WHERE id = ?`, [id]);
  }
  return project;
}

async function requireDb() {
  if (isPostgres) {
    const db = getDb(null);
    try { await db.query('SELECT 1'); } catch (err) {
      console.error(`[doto] Postgres connection failed: ${err.message}`);
      process.exit(1);
    }
    const project = await get(db, `SELECT * FROM projects WHERE root_path = ?`, [process.cwd()]);
    if (!project) {
      console.error('No project found for this directory. Run `doto init` first.');
      process.exit(1);
    }
    return { db, dbPath: null, project };
  }

  const dbPath = findDbPath();
  if (!dbPath) {
    console.error('No doto.db found. Run `doto init` first.');
    process.exit(1);
  }
  const db = getDb(dbPath);
  const project = await get(db, `SELECT * FROM projects WHERE root_path = ?`, [dbPath.replace(/\/doto\.db$/, '')]);
  if (!project) {
    console.error('No project found in doto.db. Run `doto init` first.');
    process.exit(1);
  }
  return { db, dbPath, project };
}

function closeDb(db) {
  if (isPostgres) return db.end();
  db.close();
}

function writeSettings(projectRoot, agentId) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  let existing = {};
  if (existsSync(settingsPath)) {
    try { existing = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
  }

  const hookCmd = (name) =>
    `DOTO_AGENT_ID=${agentId} node ${join(HOOKS_DIR, name)}`;

  const settings = {
    ...existing,
    hooks: {
      ...(existing.hooks ?? {}),
      UserPromptSubmit: [
        { matcher: '', hooks: [{ type: 'command', command: hookCmd('user-prompt-submit.js') }] }
      ],
      Stop: [
        { matcher: '', hooks: [{ type: 'command', command: hookCmd('stop.js') }] }
      ]
    }
  };

  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function writeClaudeMd(projectRoot, role, agentId, projectId, sessionLabel) {
  const rolePath = join(ROLES_DIR, `${role}.md`);
  if (!existsSync(rolePath)) {
    console.error(`Role file not found: ${rolePath}`);
    process.exit(1);
  }
  let content = readFileSync(rolePath, 'utf8');
  content = content
    .replace(/\{\{agent_id\}\}/g, agentId)
    .replace(/\{\{project_id\}\}/g, projectId)
    .replace(/\{\{session_label\}\}/g, sessionLabel);

  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'CLAUDE.md'), content);
}

const program = new Command();
program.name('doto').description('Multi-agent relay system for Claude Code').version('0.1.0');

// Auto-trigger onboarding before any command if global config doesn't exist yet
program.hook('preAction', async (_thisCmd, actionCmd) => {
  if (actionCmd.name() !== 'setup' && !configExists()) {
    await runSetup({ reexecIfCloud: true });
  }
});

// ── setup ─────────────────────────────────────────────────────────────────────
program.command('setup')
  .description('Configure doto (DB mode, connection string)')
  .action(async () => {
    await runSetup({ reexecIfCloud: false });
  });

// ── init ─────────────────────────────────────────────────────────────────────
program.command('init')
  .description('Initialize doto.db in the current project')
  .action(async () => {
    const cwd = process.cwd();

    if (isPostgres) {
      const db = getDb(null);
      try { await db.query('SELECT 1'); } catch (err) {
        console.error(`[doto] Postgres connection failed: ${err.message}`);
        process.exit(1);
      }
      await initSchema(db);
      await ensureProject(db, cwd);
      const url = process.env.DOTO_DB_URL.replace(/:([^:@]+)@/, ':***@');
      console.log(`Initialized schema in Postgres (${url})`);
      await db.end();
      return;
    }

    const dbPath = join(cwd, 'doto.db');
    if (existsSync(dbPath)) {
      console.log(`doto.db already exists at ${dbPath}`);
      return;
    }
    const db = getDb(dbPath);
    await initSchema(db);
    await ensureProject(db, cwd);
    db.close();
    console.log(`Initialized doto.db at ${dbPath}`);
  });

// ── start ─────────────────────────────────────────────────────────────────────
program.command('start')
  .description('Register agent and launch claude')
  .requiredOption('--role <role>', 'Agent role (orchestrator|worker|reviewer|dba)')
  .option('--theme <theme>', 'Theme name', 'default')
  .action(async (opts) => {
    const validRoles = ['orchestrator', 'worker', 'reviewer', 'dba'];
    if (!validRoles.includes(opts.role)) {
      console.error(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
      process.exit(1);
    }

    const cwd = process.cwd();
    let db, dbPath, projectRoot;

    if (isPostgres) {
      db = getDb(null);
      try { await db.query('SELECT 1'); } catch (err) {
        console.error(`[doto] Postgres connection failed: ${err.message}`);
        process.exit(1);
      }
      await initSchema(db);
      dbPath = null;
      projectRoot = cwd;
    } else {
      dbPath = findDbPath(cwd) ?? join(cwd, 'doto.db');
      db = getDb(dbPath);
      await initSchema(db);
      projectRoot = dirname(dbPath);
    }

    const project = await ensureProject(db, projectRoot);
    const theme = loadTheme(opts.theme);
    const usedLabels = await getUsedLabels(db, project.id);
    const sessionLabel = pickAgentName(theme, usedLabels);
    const agent = await registerAgent(db, project.id, opts.role, sessionLabel);
    console.log(`[doto] ${sessionLabel} (${opts.role}) registered — ${agent.id}`);

    writeSettings(projectRoot, agent.id);
    writeClaudeMd(projectRoot, opts.role, agent.id, project.id, sessionLabel);

    const heartbeatTimer = startHeartbeat(db, agent.id);
    console.log(formatMessage(theme, 'ready', { agent: sessionLabel }));

    const env = { ...process.env, DOTO_AGENT_ID: agent.id, DOTO_PROJECT_ID: project.id };
    if (dbPath) env.DOTO_DB_PATH = dbPath;

    const child = spawn('claude', [], {
      stdio: 'inherit',
      cwd: projectRoot,
      env
    });

    child.on('exit', async (code) => {
      clearInterval(heartbeatTimer);
      await setStatus(db, agent.id, 'offline');
      await closeDb(db);
      process.exit(code ?? 0);
    });

    child.on('error', async (err) => {
      clearInterval(heartbeatTimer);
      await setStatus(db, agent.id, 'offline');
      await closeDb(db);
      console.error(`[doto] Failed to launch claude: ${err.message}`);
      process.exit(1);
    });
  });

// ── status ────────────────────────────────────────────────────────────────────
program.command('status')
  .description('Show active agents and task counts')
  .action(async () => {
    const { db, project } = await requireDb();

    console.log(`\nProject: ${project.name} (${project.root_path})\n`);

    const agents = await getAgents(db, project.id);
    if (agents.length === 0) {
      console.log('No agents registered.');
    } else {
      console.log('Agents:');
      for (const a of agents) {
        const hbStr = a.last_heartbeat ? new Date(a.last_heartbeat).toISOString() : null;
        const hb = hbStr ? hbStr.slice(11, 19) : '—';
        console.log(`  ${a.status.padEnd(8)} ${a.role.padEnd(13)} ${(a.session_label ?? '').padEnd(20)} pid:${a.pid ?? '—'}  hb:${hb}`);
      }
    }

    const counts = await getTaskCounts(db, project.id);
    if (counts.length > 0) {
      console.log('\nTasks:');
      for (const { status, count } of counts) {
        console.log(`  ${status.padEnd(16)} ${count}`);
      }
    } else {
      console.log('\nNo tasks.');
    }

    await closeDb(db);
  });

// ── tasks ─────────────────────────────────────────────────────────────────────
program.command('tasks')
  .description('List project tasks')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    const { db, project } = await requireDb();

    const tasks = await listTasks(db, project.id, { status: opts.status });
    if (tasks.length === 0) {
      console.log(opts.status ? `No tasks with status "${opts.status}".` : 'No tasks.');
      await closeDb(db);
      return;
    }

    console.log(`\n${tasks.length} task(s)${opts.status ? ` [${opts.status}]` : ''}:\n`);
    for (const t of tasks) {
      const role = t.required_role ? `[${t.required_role}]` : '[any]';
      console.log(`  p${t.priority} ${t.status.padEnd(16)} ${role.padEnd(14)} ${t.title}`);
      if (t.output_summary) {
        console.log(`        → ${t.output_summary.slice(0, 80)}`);
      }
    }

    await closeDb(db);
  });

program.parse();
