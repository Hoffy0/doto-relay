# doto-relay

Coordinate multiple Claude Code agents without losing context.
One Orchestrator decomposed tasks into atomic work, multiple Workers execute in parallel,
a Reviewer validates everything — all coordinated through a shared database.
No context anxiety. No manual handoffs.

Built on [Anthropic's harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps) for long-running agentic applications.

---

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────────┐
│                         You (User)                          │
│                      Talk here only                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
                    [Orchestrator]
                  (decomposes work)
                         │
                         ↓
          ┌──────────────────────────┐
          │    doto.db / Supabase    │
          │  (single source of truth)│
          └─────┬──────────────────┬─┘
                │                  │
                ↓                  ↓
            [Worker]          [Reviewer]
         (executes tasks)  (validates work)
                │                  │
                └──────────────────┘
                         ↓
                    [Next cycle]
```

Each agent picks up exactly where the last one left off. Context resets cleanly between sessions,
snapshots carry work forward. No context window bloat. No lost state.

---

## Setup

```bash
npm install
npm link          # makes `doto` available globally
```

## First run

The first time you run any `doto` command, it asks you to choose a database mode:

```
  doto — setup
? Database mode?
  › Local — SQLite per project
    Cloud — Supabase or any Postgres
```

Your choice is saved to `~/.config/doto/config.env`. Subsequent runs start immediately without asking.

To reconfigure at any time:

```bash
doto setup
```

---

## Usage

```bash
# In your project directory:
doto init

# In separate terminals:
doto start --role orchestrator    # You talk here
doto start --role worker          # Autonomous (v1.5+)
doto start --role reviewer        # Autonomous (v1.5+)
doto start --role dba             # For database tasks

# Monitor:
doto status
doto tasks
doto tasks --status pending
```

---

## How it works

- **The DB is the only communication channel.** SQLite locally or Postgres (Supabase) in the cloud.
- **`doto start` registers the agent,** writes `.claude/settings.json` with hooks, and launches Claude Code.
- **`UserPromptSubmit` hook injects fresh context** before each prompt (last snapshot + unread messages from the DB).
- **`Stop` hook saves a snapshot** when the session ends, capturing decisions and next steps.
- **Workers claim tasks atomically** — no double-claiming even with concurrent agents.
- **Reviewer validates independently** — detects bugs the generator missed.

---

## Cloud mode (Supabase / Postgres)

Run `doto setup` and choose **Cloud**, then paste your connection string. Or set it directly:

```bash
export DOTO_DB_URL=postgresql://postgres:[PASSWORD]@pooler.supabase.com:5432/postgres
doto init   # runs schema.postgres.sql against your DB
doto start --role orchestrator
```

Agents on different machines sharing the same `DOTO_DB_URL` coordinate automatically.

---

## Environment variables

| Variable          | Purpose                                               |
| ----------------- | ----------------------------------------------------- |
| `DOTO_DB_URL`     | Postgres connection string (activates cloud mode)     |
| `DOTO_AGENT_ID`   | Agent UUID in the DB (set automatically by `start`)   |
| `DOTO_DB_PATH`    | Absolute path to doto.db (set automatically)          |
| `DOTO_PROJECT_ID` | Project UUID in the DB (set automatically by `start`) |

**Precedence:** shell export > project `.env` > `~/.config/doto/config.env`

---

## Status: v1 (Manual coordination)

**Current:**

- ✅ Multi-agent coordination via SQLite
- ✅ Claude Code integration with hooks
- ✅ Supabase/Postgres support
- ✅ TUI onboarding
- ⏳ Autonomous Workers (coming v1.5, June 15)

See [ROADMAP.md](ROADMAP.md) for the full plan.

---

## Contributing

This is early-stage work. Feedback, issues, and PRs welcome.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

_Named after Meisho Doto — always second, never stopped running._
