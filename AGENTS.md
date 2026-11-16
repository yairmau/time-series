# AGENTS.md

Instructions for AI coding agents (Claude Code or otherwise) working in this repository.

## What this repo is

A [Quarto](https://quarto.org) book/course site for a Time Series Analysis class. Each top-level
topic directory (`stationarity/`, `smoothing/`, `outliers/`, `frequency/`, ...) holds `.qmd`
chapter sources, notebooks, and any supporting data/assets for that topic. `_quarto.yml` defines
the book structure and render options. `docs/` is the rendered, committed build output served by
GitHub Pages — it is generated, not hand-edited.

## Rendering

- Render a single changed file with `quarto render path/to/file.qmd`, not a full-book render,
  unless you specifically intend to rebuild everything.
- A render — even of a single file — can touch repo-wide generated files that have nothing to do
  with your change: `docs/index.html`, `docs/search.json`, and new hashed files under
  `docs/site_libs/`. Check `git status` after rendering and revert anything unrelated to your
  edit (`git checkout -- <file>`, `rm` for new untracked lib files) so the diff stays scoped to
  the actual change.
- Treat `docs/` as build output: if you edit a `.qmd`, re-render it so the corresponding
  `docs/**/*.html` stays in sync, but don't hand-edit files under `docs/` directly.

## Interactive widgets

Before building any interactive widget, lab, or visualization for a page, read the skill at
[archive/agent-notes/skills/widget-making/SKILL.md](archive/agent-notes/skills/widget-making/SKILL.md)
(also reachable via `.claude/skills/widget-making`). It documents the two widget patterns already
used across this site (inline `{=html}` demos vs. standalone iframe-embedded labs), their file
layout, styling and accessibility conventions, and the engine/app/data separation used for
anything complex enough to need tests.

## Agent notes and skills

`archive/agent-notes/` is where durable, repo-specific notes for agents — including skills — are
kept so future sessions don't have to rediscover them by re-reading the whole site. Skills live
under `archive/agent-notes/skills/<name>/SKILL.md`; `.claude/skills/<name>` is a symlink into that
directory so Claude Code can discover and load them. When you learn something broadly useful
about this repo's conventions while doing a task, consider writing it up there rather than letting
it live only in conversation.

## Git conventions

- Only commit when the user explicitly asks.
- Create new commits rather than amending, unless told otherwise.
- Keep commits scoped: don't bundle incidental re-render artifacts (see above) into a commit about
  content changes.
