## npx kanban

<p align="center">
  <img src="https://github.com/user-attachments/assets/2aa3dcc7-94e3-4076-bcfe-6d0272007cfe" width="100%" />
</p>

A workspace for running many coding agents in parallel. Each task card gets its own terminal and worktree, all handled for you automatically.

<div align="left">
<table>
<tbody>
<td align="center">
<a href="https://www.npmjs.com/package/kanban" target="_blank">NPM</a>
</td>
</tbody>
</table>
</div>

### 1. Open kanban
```bash
# Run directly (no install required)
npx kanban

# Or install globally
npm i -g kanban
kanban
```
Run this from the root of any git repo. Kanban detects Claude Code or OpenAI Codex and launches a local webserver in your browser. No account or setup is required.

### 2. Create tasks
Create a task with the new-task shortcut or board controls. Kanban immediately creates a placeholder task on the current branch, opens the configured agent's live terminal, and focuses it so your first prompt or native slash command is typed directly into Codex or Claude.

### 3. Work in parallel
Every task gets its own worktree so agents can work in parallel without merge conflicts. Under the hood, Kanban also symlinks gitignored files like `node_modules` so you don't have to worry about slow `npm install`s for each copy of your project.

> [!NOTE]
> [Symlinks (symbolic links)](https://en.wikipedia.org/wiki/Symbolic_link) are special "shortcuts" pointing to another file or directory, allowing access to the target from a new location without duplicating data. They work great in this case since you typically don't modify gitignored files in day-to-day work, but for when you do then don't use Kanban.

As agents work, Kanban uses hooks to display the latest message or tool call on each card, so you can monitor hundreds of agents at a glance without opening each one.

### 4. Review changes
Click a card to work with the agent and its VS Code workspace side by side. Use customizable quick prompts for repeated follow-up actions, or open a shell from the task footer when you need direct terminal access.

Dependencies can be managed from a task's detail sidebar. They provide visible sequencing context and are satisfied when prerequisite tasks reach Done, without delaying task startup or overriding agent-owned lifecycle transitions.

### 5. Ship it
Review and ship changes with VS Code's Git tools or a quick prompt tailored to your workflow. Move the card to Done when the work is complete; clearing Done removes its worktree, while the saved session can still be restored later.

### Isolated development and browser testing

When developing Kanban itself, use the isolated preview instead of starting another runtime against your production data:

```bash
npm run dev:isolated -- --agent codex
# or
npm run dev:isolated -- --agent claude
```

The command starts the runtime and Vite on fresh random localhost ports, opens a browser directly on the test board without first-run onboarding, and clearly labels the UI as an isolated preview. Each launch gets a separate browser origin as well as a temporary runtime home and disposable Git repository, so it does not read or write production `~/.kanban` state, production task worktrees, project-level Kanban settings, browser storage, or service workers. Stop it with `Ctrl+C`; temporary data is removed automatically. Add `--no-open` to print the URL without opening it, or `--keep-data` to preserve the temporary directory for debugging.

For ordinary development, `npm run dev:full` also defaults to a worktree-specific runtime directory under `~/.kanban-dev/`. Use `npm run dev:full -- --runtime-home /path/to/state` to select another isolated directory. Only use `npm run dev:full:prod-state` when you intentionally want the development checkout to operate on production `~/.kanban` state.

Browser tests launch an isolated full stack instead of connecting to an existing local runtime:

```bash
npm --prefix web-ui exec playwright install chromium # first run only
npm run test:e2e
```

Each browser run creates and removes its own temporary `KANBAN_RUNTIME_HOME` and disposable Git project, uses dedicated runtime and web ports, and refuses to reuse an already-running server. It does not read or write production state or repositories.

The browser suite also exercises workspace concurrency end to end: it pauses a browser save, applies a separate lifecycle update through the runtime API, then verifies both changes are merged and persisted without showing the workspace-conflict warning.

### Logs

Kanban mirrors its existing runtime output and browser console output into separate files under `$KANBAN_RUNTIME_HOME/logs` (normally `~/.kanban/logs`):

```text
backend.log
frontend.log
```

Read them through the CLI:

```bash
kanban logs backend
kanban logs frontend --tail 200
kanban logs --all --follow
```

---

[Apache 2.0](./LICENSE)
