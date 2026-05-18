import { Command } from 'commander';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

import { findDbPath, openDb, getOrCreateDb } from './db.js';
import { registerAgent, startHeartbeat, setStatus, getAgents, getUsedLabels } from './agents.js';
import { listTasks, getTaskCounts } from './tasks.js';
import { loadTheme, pickAgentName, formatMessage } from './themes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = join(__dirname, '..');
const HOOKS_DIR = join(HARNESS_ROOT, 'hooks');
const ROLES_DIR = join(HARNESS_ROOT, 'roles');

const newId = () => randomBytes(16).toString('hex');

function ensureProject(db, cwd) {
  let project = db.prepare(`SELECT * FROM projects WHERE root_path = ?`).get(cwd);
  if (!project) {
    const id = newId();
    db.prepare(`INSERT INTO projects (id, name, root_path) VALUES (?, ?, ?)`).run(id, basename(cwd), cwd);
    project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  }
  return project;
}

function requireDb() {
  const dbPath = findDbPath();
  if (!dbPath) {
    console.error('No harness.db found. Run `doto init` first.');
    process.exit(1);
  }
  const db = openDb(dbPath);
  const project = db.prepare(`SELECT * FROM projects WHERE root_path = ?`).get(
    dbPath.replace(/\/harness\.db$/, '')
  );
  if (!project) {
    console.error('No project found in harness.db. Run `doto init` first.');
    process.exit(1);
  }
  return { db, dbPath, project };
}

function writeSettings(projectRoot, agentId) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  let existing = {};
  if (existsSync(settingsPath)) {
    try { existing = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
  }

  const hookCmd = (name) =>
    `HARNESS_AGENT_ID=${agentId} node ${join(HOOKS_DIR, name)}`;

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

// ── init ─────────────────────────────────────────────────────────────────────
program.command('init')
  .description('Initialize harness.db in the current project')
  .action(() => {
    const cwd = process.cwd();
    const dbPath = join(cwd, 'harness.db');
    if (existsSync(dbPath)) {
      console.log(`harness.db already exists at ${dbPath}`);
      return;
    }
    const db = openDb(dbPath);
    ensureProject(db, cwd);
    db.close();
    console.log(`Initialized harness.db at ${dbPath}`);
  });

// ── start ─────────────────────────────────────────────────────────────────────
program.command('start')
  .description('Register agent and launch claude')
  .requiredOption('--role <role>', 'Agent role (orchestrator|worker|reviewer|dba)')
  .option('--theme <theme>', 'Theme name', 'default')
  .action((opts) => {
    const validRoles = ['orchestrator', 'worker', 'reviewer', 'dba'];
    if (!validRoles.includes(opts.role)) {
      console.error(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
      process.exit(1);
    }

    const cwd = process.cwd();
    const { db, dbPath } = getOrCreateDb(cwd);
    const projectRoot = dirname(dbPath);
    const project = ensureProject(db, projectRoot);

    const theme = loadTheme(opts.theme);
    const usedLabels = getUsedLabels(db, project.id);
    const sessionLabel = pickAgentName(theme, usedLabels);

    const agent = registerAgent(db, project.id, opts.role, sessionLabel);
    console.log(`[doto] ${sessionLabel} (${opts.role}) registered — ${agent.id}`);

    writeSettings(projectRoot, agent.id);
    writeClaudeMd(projectRoot, opts.role, agent.id, project.id, sessionLabel);

    const heartbeatTimer = startHeartbeat(db, agent.id);

    console.log(formatMessage(theme, 'ready', { agent: sessionLabel }));

    const child = spawn('claude', [], {
      stdio: 'inherit',
      cwd: projectRoot,
      env: {
        ...process.env,
        HARNESS_AGENT_ID: agent.id,
        HARNESS_DB_PATH: dbPath,
        HARNESS_PROJECT_ID: project.id
      }
    });

    child.on('exit', (code) => {
      clearInterval(heartbeatTimer);
      setStatus(db, agent.id, 'offline');
      db.close();
      process.exit(code ?? 0);
    });

    child.on('error', (err) => {
      clearInterval(heartbeatTimer);
      setStatus(db, agent.id, 'offline');
      db.close();
      console.error(`[doto] Failed to launch claude: ${err.message}`);
      process.exit(1);
    });
  });

// ── status ────────────────────────────────────────────────────────────────────
program.command('status')
  .description('Show active agents and task counts')
  .action(() => {
    const { db, project } = requireDb();

    console.log(`\nProject: ${project.name} (${project.root_path})\n`);

    const agents = getAgents(db, project.id);
    if (agents.length === 0) {
      console.log('No agents registered.');
    } else {
      console.log('Agents:');
      for (const a of agents) {
        const hb = a.last_heartbeat ? a.last_heartbeat.slice(11, 19) : '—';
        console.log(`  ${a.status.padEnd(8)} ${a.role.padEnd(13)} ${(a.session_label ?? '').padEnd(20)} pid:${a.pid ?? '—'}  hb:${hb}`);
      }
    }

    const counts = getTaskCounts(db, project.id);
    if (counts.length > 0) {
      console.log('\nTasks:');
      for (const { status, count } of counts) {
        console.log(`  ${status.padEnd(16)} ${count}`);
      }
    } else {
      console.log('\nNo tasks.');
    }

    db.close();
  });

// ── tasks ─────────────────────────────────────────────────────────────────────
program.command('tasks')
  .description('List project tasks')
  .option('--status <status>', 'Filter by status')
  .action((opts) => {
    const { db, project } = requireDb();

    const tasks = listTasks(db, project.id, { status: opts.status });
    if (tasks.length === 0) {
      console.log(opts.status ? `No tasks with status "${opts.status}".` : 'No tasks.');
      db.close();
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

    db.close();
  });

program.parse();
