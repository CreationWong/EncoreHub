---
name: ponytail-bootstrap
description: Use at the start of every coding session in this repository — when first reading or exploring the project, and again before the first code write or edit — to make sure Ponytail (the "lazy senior dev" minimal-code mode) is installed and active. 本项目第一次读项目、写代码时调用。If an agent runs in a project without Ponytail installed, ask the user for confirmation first and only install after they agree. Also use when the user says "ponytail", "be lazy", "lazy mode", "minimal solution", "simplest solution", "yagni", "do less", or complains about over-engineering, bloat, boilerplate, or unnecessary dependencies. Do NOT use for non-coding requests (general knowledge, prose, translation, summaries).
license: MIT
---

# Ponytail Bootstrap

Ponytail makes the agent build the smallest solution that actually works. The
upstream project is <https://github.com/DietrichGebert/ponytail> (npm package
`@dietrichgebert/ponytail`, MIT). This skill runs in two moments — when the
project is first read and before code is written — and does two jobs: make sure
Ponytail is installed, then hold the ladder until the installed plugin takes
over the system prompt.

## Step 1 — Check whether Ponytail is installed

Ponytail counts as installed when any of these is true:

- `opencode.json` at the repo root lists `@dietrichgebert/ponytail` in `plugin`
- `.opencode/plugins/ponytail.mjs` exists (local/checkout plugin form)
- the active system prompt already carries the ruleset — it will mention
  "lazy senior developer" or the YAGNI ladder. That means the plugin is
  live for this session, so skip straight to Step 4.

A quick check before doing anything else:

```bash
grep -n "ponytail" opencode.json 2>/dev/null; ls .opencode/plugins/ 2>/dev/null
```

## Step 2 — If missing, ask before installing

Never install silently. Ask the user with the `question` tool: install Ponytail
for this project, or skip. State in the question that it adds the opencode
plugin entry and takes effect after an opencode restart.

- Ask at most once per project per session.
- If the user declines, go to Step 4 and follow the ladder manually. Do not ask
  again in this session.
- If the user agrees, continue to Step 3.

## Step 3 — Install after consent

opencode (this repository's default host): add the plugin entry to the project's
`opencode.json`, creating the file if it does not exist.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@dietrichgebert/ponytail"]
}
```

opencode fetches and installs npm plugins automatically with Bun at startup
(cached under `~/.cache/opencode/node_modules/`). Config is loaded once at
startup and is not hot-reloaded, so tell the user to quit and restart opencode;
until then this skill's Step 4 applies. After restart the plugin injects the
ruleset every turn and registers `/ponytail`, `/ponytail-review`,
`/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, `/ponytail-help`.

Other hosts, only when the user asks for them:

| Host | Install |
| --- | --- |
| Claude Code | `/plugin marketplace add DietrichGebert/ponytail`, then `/plugin install ponytail@ponytail` |
| Codex | `codex plugin marketplace add DietrichGebert/ponytail`, then `codex plugin add ponytail@ponytail` |
| Cursor | `git clone https://github.com/DietrichGebert/ponytail` then `node ponytail/scripts/cursor-hooks.js install` |
| Instruction-only fallback | copy the upstream ruleset from the repo's `AGENTS.md` into this project's `AGENTS.md` / `CLAUDE.md` |

To undo: remove the `plugin` entry from `opencode.json` and restart.

## Step 4 — Apply the ladder

Until the plugin activates (and it stays true after), stop at the first rung
that holds:

1. Does this need to exist at all? No → skip it and say so in one line. (YAGNI)
2. Already in this codebase? Reuse the existing helper, type, or pattern.
3. Standard library does it? Use it.
4. Native platform feature covers it? Use it.
5. Already-installed dependency solves it? Use it; never add a new one for a
   few lines of code.
6. One line? One line.
7. Only then: the minimum code that works.

The ladder runs after understanding the problem, not instead of it: read the
task and every file the change touches, trace the real flow, then climb. A bug
fix targets the root cause: grep every caller of the function you touch and fix
it once where all callers route through.

Rules: no unrequested abstractions, no scaffolding "for later", deletion over
addition, fewest files, shortest working diff. Mark a deliberate simplification
that cuts a real corner with a `ponytail:` comment naming its ceiling and the
upgrade path.

Never lazy about: input validation at trust boundaries, error handling that
prevents data loss, security, accessibility, anything explicitly requested — or
this repository's standing conventions (`CLAUDE.md`: file headers, doc comments,
per-file comment coverage, CHANGELOG entries, dependency policy, docs
placement). Ponytail shortens solutions, never requirements and never the
reading. Output stays code-first with at most a few short lines on what was
skipped and when to add it.
