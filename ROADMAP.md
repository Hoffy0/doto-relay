# Roadmap

doto-relay follows a clear versioning strategy. Each version solves a specific problem and unblocks the next.

---

## v1: Manual Coordination (Current - May 2026)

**Status:** Stable and working  
**Use case:** Personal/team workflows where you orchestrate manually

### Completed

- [x] Multi-agent architecture (Orchestrator, Worker, Reviewer, DBA)
- [x] SQLite coordination
- [x] Supabase/Postgres support
- [x] Hook-based context persistence (snapshots)
- [x] Atomic task claiming (no race conditions)
- [x] TUI onboarding (`doto setup`)
- [x] Theme system (easter egg included)

### What works

```bash
doto start --role orchestrator    # You give instructions
doto start --role worker          # Takes a task, waits for input
doto start --role reviewer        # Reviews manually
```

### Limitation

Workers and Reviewer require you to manually trigger them. No loops yet.

---

## v1.5: Autonomous Agents (June 15, 2026)

**Status:** Scheduled  
**Trigger:** Claude Agent SDK gets monthly credit on all Pro+ plans ($20 Pro, $100 Max 5x, $200 Max 20x)

### Planned

- [ ] Migrate Workers to Agent SDK
- [ ] Migrate Reviewer to Agent SDK
- [ ] Replace Stop hook with Agent SDK loop detection
- [ ] True autonomy: agents run in parallel, claim work atomically, no human intervention needed

### What changes

```bash
doto start --role orchestrator    # You give instructions (same)
doto start --role worker          # Runs autonomous loop, claims tasks, executes, repeats
doto start --role reviewer        # Runs autonomous loop, validates work, approves/rejects
```

### After June 15

Agent SDK usage flows from your Pro/Max monthly credit ($20/$100/$200).
No additional billing needed for basic autonomous operation.

---

## v2: Multi-Model Ecosystem (Conditional)

**Status:** Pending real adoption  
**Trigger:** v1.5 reaches 100+ GitHub stars or 10+ active users

### Scope

- [ ] Abstract agent interface (today: Claude only)
- [ ] Support Gemini, OpenAI, local models
- [ ] Plugin system for custom agent types
- [ ] Advanced scheduling, priority queues, retry policies
- [ ] Marketplace for shareable task libraries

### Philosophy

v2 only ships if there's real demand. No premature generalization.
Right now, being the best Claude coordination tool matters more than being a generic tool.

---

## Decision framework

Each version is independently useful:

| Version | Ship when          | For whom                              | Effort   |
| ------- | ------------------ | ------------------------------------- | -------- |
| v1      | Now                | Developers wanting manual control     | Done ✅  |
| v1.5    | June 15            | Developers wanting hands-off autonomy | ~8 hours |
| v2      | If v1.5 + adoption | Teams using multiple models           | TBD      |

If v1.5 never ships, v1 is still a working coordination system.
If v2 never ships, v1.5 is sufficient for 90% of use cases.

---

## How to help

- **v1 feedback:** Use it, report bugs, suggest clarity improvements
- **v1.5 prep:** Help design the Agent SDK migration strategy
- **v2 ideas:** Star the repo if you'd use multi-model support

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

_Doto didn't win through speed. She won through persistence._
