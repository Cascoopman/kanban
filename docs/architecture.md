# Architecture Overview

Kanban is a local Node runtime plus a React app for running Claude Code and OpenAI Codex tasks in parallel.

The browser is a control surface. The local runtime owns projects, worktrees, PTY sessions, git operations, persisted board state, and live state streaming. Both supported coding agents run as CLI processes attached to PTYs; there is no separate native-agent execution path.

## System Diagram

```text
+------------------------------+
| Browser UI                   |
| web-ui/src                   |
+---------------+--------------+
                |
                | TRPC requests and websocket updates
                v
+------------------------------+
| Local runtime                |
| src/trpc and src/server      |
+---------------+--------------+
                |
                v
+------------------------------+
| PTY runtime                  |
| src/terminal                 |
| Claude Code and Codex        |
+---------------+--------------+
                |
                v
+------------------------------+
| Task worktrees and processes |
+------------------------------+
```

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Workspace | An indexed git repository opened by Kanban. |
| Task card | A prompt, base ref, agent override, and review settings. |
| Worktree | An isolated git worktree created for a task. |
| Task session | A Claude Code or Codex process attached to a task PTY. |
| Home agent session | A synthetic project-scoped PTY session used by the sidebar. |
| Runtime summary | The lightweight session state streamed to the board and detail view. |

## Backend Responsibilities

- `src/core/agent-catalog.ts` is the source of truth for the two supported agents.
- `src/config/runtime-config.ts` persists the selected agent, autonomous-mode preference, shortcuts, and review prompt templates.
- `src/terminal/agent-registry.ts` detects installed CLIs and resolves launch commands.
- `src/terminal/agent-session-adapters.ts` applies Claude Code- or Codex-specific arguments, hooks, resume behavior, and prompt handling.
- `src/terminal/session-manager.ts` owns PTY process lifecycle, terminal output, session summaries, and terminal persistence.
- `src/trpc/app-router.ts` defines the typed browser/runtime boundary.
- `src/trpc/runtime-api.ts` coordinates config and session operations without owning low-level process behavior.
- `src/server/runtime-state-hub.ts` streams terminal summaries, output, workspace metadata, and board state to browsers.
- `src/workspace/` owns task worktrees, checkpoints, git changes, and cleanup.

## Frontend Responsibilities

`web-ui/src/App.tsx` is the composition root. Domain orchestration belongs primarily in hooks, while components render board, settings, terminal, diff, and navigation state. Runtime requests should go through helpers in `web-ui/src/runtime/` rather than creating TRPC clients throughout the component tree.

Task details and the home sidebar both render terminal-backed agent sessions. Switching projects or agents rotates the synthetic home session; switching sidebar tabs does not.

## Session Flow

1. The browser asks the runtime to start a task session.
2. The runtime resolves or creates the task worktree.
3. The selected task override or workspace default chooses Claude Code or Codex.
4. The agent adapter prepares arguments, hooks, environment variables, resume metadata, and the prompt.
5. The session manager starts the process in a PTY and emits output and summary changes.
6. The runtime state hub broadcasts updates to the browser.
7. The board, terminal panel, and diff view update from streamed runtime state.

## Configuration and Compatibility

Only `claude` and `codex` are valid runtime agent IDs. Persisted configuration or board data containing a retired agent ID is normalized to a supported default or treated as having no task override so older workspaces remain readable.

Kanban continues to use `.cline/kanban` and `.cline/worktrees` as existing storage locations. Those paths are compatibility names for Kanban data and do not indicate support for the Cline coding agent.

## Design Rules

- Keep agent-specific behavior in the catalog, registry, and session adapters.
- Keep `runtime-api.ts` as a coordinator rather than a process implementation.
- Treat the runtime as the source of truth for long-running sessions.
- Use streamed state instead of browser polling for terminal and board updates.
- Preserve task worktree isolation and persisted-session recovery semantics.
- Add a new coding agent only through an explicit product decision that updates the catalog, contract, adapters, UI, tests, and documentation together.
