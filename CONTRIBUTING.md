# Contributing to doto-relay

Thanks for your interest in doto-relay. Here's how to contribute.

---

## Issues

### Reporting bugs

- **Title:** Clear and specific (e.g., "`doto start` fails if `doto.db` exists")
- **Reproduction steps:** Minimal example that breaks it
- **Environment:** OS, Node version, Claude Code version
- **Expected vs actual:** What should happen vs what actually happens

### Feature requests

- **Problem:** What's the use case? What does this unblock?
- **Solution:** Your idea (not required, just context)
- **Alternatives:** What workarounds exist?

---

## Pull Requests

Before submitting code:

1. **Check ROADMAP.md** — is this aligned with the current version plan?
2. **Open an issue first** — discuss the change before implementing
3. **Fork and branch** — `git checkout -b fix/your-issue-name`
4. **Test locally** — `doto init` + `doto start` in a real project
5. **Keep it focused** — one change per PR

### Code style

- Node.js: ES modules (import/export)
- Format: Readable > clever. Comments for "why", not "what"
- SQL: Well-formed, readable. Check against both SQLite and Postgres syntax

---

## What we're looking for

**Good contributions:**

- Bug fixes with reproduction steps
- Documentation improvements (README, ROADMAP, code comments)
- Performance improvements with benchmarks
- Test coverage

**Not right now:**

- Large architectural rewrites (discuss in an issue first)
- Multi-model support (that's v2, not v1)
- Dependencies that aren't strictly necessary

---

## Development setup

```bash
git clone https://github.com/Hoffy0/doto-relay
cd doto-relay
npm install
npm link

# Test in a real project
cd ../my-project
doto init
doto start --role orchestrator
```

---

## Questions?

Open an issue with the `question` label or check existing discussions.

---

_She never crossed first. But she crossed._
