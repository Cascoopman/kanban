# Kanban MCP

Kanban MCP is the canonical agent-facing interface for task lifecycle actions and persisted logs. It uses stdio, starts locally with the agent host, and communicates with the already-running Kanban runtime over its configured local endpoint.

## Setup

Install Kanban globally or link a checkout, then register the server:

```bash
codex mcp add kanban -- kanban-mcp
```

The `kanban` binary still launches the board UI. `kanban-hooks` is an internal hook runner. Do not use either as an agent task API and do not reintroduce `kanban task` or `kanban logs` commands.

Start or connect to the local Kanban board before using a task tool. In a task session, `KANBAN_TASK_ID` and `KANBAN_WORKSPACE_ID` let the server infer the current task and workspace. Elsewhere, supply `project_path`.

## Tools

| Tool | Purpose | Safety |
| --- | --- | --- |
| `kanban_task_list` | List tasks, optionally by column. | Read-only |
| `kanban_task_current` | Read the calling task-session's task. | Read-only |
| `kanban_task_create` | Create a task and start its agent session. | Mutates board/runtime |
| `kanban_task_branch` | Branch a task worktree and agent conversation. | Mutates board/runtime |
| `kanban_task_update` | Change title, base ref, plan mode, or agent. | Mutates board |
| `kanban_task_start` | Start or restart an in-progress task session. | Mutates runtime |
| `kanban_task_trash` | Move a task/column to Done and remove worktrees. | Destructive; confirm first |
| `kanban_task_delete` | Permanently remove a task/column and worktrees. | Destructive; confirm first |
| `kanban_notify` | Send a time-critical macOS alert. | External user interruption |
| `kanban_logs` | Read a bounded frontend/backend log snapshot. | Read-only |

Inputs use snake_case. `column` accepts `in_progress`, `review`, `on_hold`, `trash`, or `done` (`done` maps to `trash`). `kanban_logs` intentionally does not stream indefinitely; request a bounded `tail` (0–1,000) instead.

## Development and verification

Run the contract and stdio integration coverage with:

```bash
npx vitest run test/runtime/mcp.test.ts test/integration/mcp-task.integration.test.ts --no-file-parallelism --maxWorkers=1
```

`npm run build` produces `dist/mcp.js`, exposed by the `kanban-mcp` executable. The integration test starts a disposable runtime, communicates through the real stdio transport, and verifies create, current-task resolution, update, trash, and permanent deletion against persisted state.
