---
name: docs-placement
description: Use when creating, editing, moving, reviewing, or committing documentation in this repository — any docs/** or *.md change, or a 创建文档 / 修改文档 / 写报告 / 文档归档 / 提交 / commit request. Classifies each document as AI-facing, developer-facing, or user-facing and enforces its exclusive folder (.agents/, docs/dev/, or docs/user/), including pre-existing misplaced files.
---

# Docs Placement

Every document in this repository serves exactly one audience. Decide the
audience before writing or moving a file, and never park a document in another
audience's folder. Apply this skill whenever you create a document and again
before every commit.

## Audience routing

| Audience | Destination | Signals |
| --- | --- | --- |
| AI-facing working docs | `.agents/` | Written to help the current agent or developer finish in-progress work: verification reports, development plans, remaining-work/backlog lists, investigation and diagnosis notes, handoff briefs, temporary specs. They are expected to go stale and be replaced. |
| Developer-facing docs | `docs/dev/` | Long-lived reference for maintainers: architecture, design specs, contracts, feature behavior rules, runbooks, integration notes. |
| User-facing docs | `docs/user/` | End-user help: guides, how-to, feature usage, FAQ. Create the folder when the first such document appears. |

Judgement rule: "Would an end user read this?" → `docs/user/`. "Would a
maintainer need this next year?" → `docs/dev/`. "Does this only exist to get
the current task done?" → `.agents/`.

## Mainstream exceptions (do not move)

These keep their conventional location because other tooling or readers expect
them:

- Root `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `LICENSE`
- Agent instruction files (`CLAUDE.md`, `AGENTS.md`, and similar) — exempt from
  audience routing entirely
- `docs/adr/` — architecture decision records
- `docs/openapi.json` — canonical Gateway contract, pinned by `scripts/docs-contract.test.mjs`
- `docs/vendor/` — third-party reference snapshots (not EncoreHub contracts)
- Product resources (`skills/**/SKILL.md`), vendored trees (`engine/vendor/**`),
  and generated files (for example `*.generated.json`)
- `.agents/skills/` — cross-agent skill definitions shared with opencode, Codex,
  and Claude; these are configuration, not audience-routed documents

## Creating a document

1. Classify the audience with the table above.
2. Write it to the destination folder, creating the folder if needed.
3. Use relative links that resolve from the final location.
4. When in doubt between `.agents/` and `docs/dev/`, prefer `.agents/` for
   anything that only serves the current task.

## Before committing

1. List added, renamed, and modified Markdown: `git status --short` and
   `git diff --cached --name-status`.
2. For every path outside the exceptions, confirm the audience classification.
3. If a document is misplaced — including pre-existing ones you notice — move
   it with `git mv` and update every inbound relative link in the same change.
   Do not leave copies behind.
4. Never mix audiences in one folder. Do not create loose `docs/*.md` at the
   `docs/` root; its content lives under `adr/`, `dev/`, `user/`, and `vendor/`.
5. Run `pnpm test:docs` (or `pnpm test:contracts`) so the Markdown link
   contract keeps passing, and record qualifying changes in `CHANGELOG.md`.

## Current layout

- `.agents/` — working docs (`DEVELOPMENT_PLAN.md`, `REMAINING_WORK.md`) and
  cross-agent skills under `skills/`
- `docs/dev/` — `ARCHITECTURE_DIAGRAM.md`, `MEMORY_SYSTEM_DESIGN.md`,
  `RUST_DATA_PIPELINE.md`, `conversation-title.md`
- `docs/user/` — created with the first user-facing document
- `docs/adr/`, `docs/openapi.json`, `docs/vendor/` — mainstream exceptions
