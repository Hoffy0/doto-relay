# doto-relay

Multi-agent relay system for Claude Code. Run specialized agents — Orchestrator, Worker, Reviewer, DBA — in separate terminals, coordinated through a shared SQLite database.

Each agent picks up exactly where the last one left off.

---

## Setup

```bash
npm install
npm link          # makes `doto` available globally
```

## Usage

```bash
# In your project directory:
doto init

# In separate terminals:
doto start --role orchestrator
doto start --role worker
doto start --role worker --theme uma
doto start --role reviewer
doto start --role dba

# Monitor:
doto status
doto tasks
doto tasks --status pending
```

## How it works

- The DB (`harness.db`) is the only communication channel between agents
- `doto start` registers the agent, writes `.claude/settings.json` with hooks, and launches `claude`
- On each prompt, the `UserPromptSubmit` hook injects fresh context from the DB (last snapshot + unread messages)
- On session end, the `Stop` hook saves a snapshot and marks the agent idle
- Workers claim tasks atomically — no double-claiming even with concurrent agents

## Themes

| Theme     | Agent names                                   |
|-----------|-----------------------------------------------|
| `default` | agent-1, agent-2, ...                         |
| `uma`     | Special Week, Silence Suzuka, Tokai Teio, ... |

```bash
doto start --role worker --theme uma
```

## Environment variables

| Variable             | Purpose                     |
|----------------------|-----------------------------|
| `HARNESS_AGENT_ID`   | Agent UUID in the DB        |
| `HARNESS_DB_PATH`    | Absolute path to harness.db |
| `HARNESS_PROJECT_ID` | Project UUID in the DB      |

---

*Named after Meisho Doto — always second, never stopped running.*
