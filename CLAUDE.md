# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Communication Style

**Be concise**: Avoid repetitive announcements. Don't say "I will now..." then "Now writing..." then "Completed...". Just do the work and report results once.

**No pre-edit diffs**: If you have permission to edit a file, make the edit directly. Don't show the user what you're about to change - just do it and report the result.

## Project Governance

Project principles, development standards, workflow rules, security requirements, testing requirements, and quality gates are governed by `.specify/memory/constitution.md`. **Read it before making any development decisions.**

## GitHub Integration

- Use `gh` CLI for all GitHub operations
- Ask for confirmation on what branch to use before creating PR
- Main branch: `main` (production-ready code only)
- Development workflow: GitHub Flow (feature branches)
- Source of truth: GitHub repository
- Always note in commit and PR that it was co-authored by you
- Never work directly on `main`. All changes go on branches.
- Agents are not allowed to merge. Merge is always manual by user.

**Branch naming**:
- `feature/description-of-feature`
- `bugfix/description-of-bug`
- `chore/description-of-task`
- `hotfix/critical-issue`

**PR title format**: Conventional Commits — `type(scope): description` (e.g. `feat: add login`, `fix(auth): handle timeout`). The PR title becomes the squash commit message on `main`.

## Project Status

### Current Status

Early-stage open-source port from an enterprise version. v0.0.0. Functional MVP with three synchronized views (Canvas, Tables, YAML). Active feature porting from enterprise is ongoing.

### Known Issues
None currently.

## Recent Changes

- Port #4 from enterprise
- Port #3 from enterprise: Tutorials, Tab Layout
- Port #2 from enterprise: MVP version
- Added issue templates
- Genericized deploy workflow using GitHub Actions context

## Active Technologies

- **Framework**: React 19, TypeScript 5, Vite 7
- **Diagram/Canvas**: `@xyflow/react` (React Flow v12)
- **Drag-and-drop**: `@dnd-kit`
- **State**: `immer` (immutable updates), custom hooks — no Redux/Zustand
- **YAML**: `js-yaml` + `ajv` (parse + validate)
- **Storage**: `idb-keyval` (IndexedDB), `lz-string` (URL share), `jszip` (ZIP export)
- **Routing**: `react-router-dom` v7
- **Testing**: `vitest` + `@testing-library/react`
- **Deploy**: GitHub Pages via `gh-pages`
