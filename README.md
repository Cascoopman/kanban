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
Create a task with the new-task shortcut or board controls and describe the outcome you want. Kanban chooses the current branch and default agent, derives the initial title, and immediately opens the agent terminal for follow-up prompts and commands.

### 3. Work in parallel
Every task gets its own worktree so agents can work in parallel without merge conflicts. Under the hood, Kanban also symlinks gitignored files like `node_modules` so you don't have to worry about slow `npm install`s for each copy of your project.

> [!NOTE]
> [Symlinks (symbolic links)](https://en.wikipedia.org/wiki/Symbolic_link) are special "shortcuts" pointing to another file or directory, allowing access to the target from a new location without duplicating data. They work great in this case since you typically don't modify gitignored files in day-to-day work, but for when you do then don't use Kanban.

As agents work, Kanban uses hooks to display the latest message or tool call on each card, so you can monitor hundreds of agents at a glance without opening each one.

### 4. Review changes
Click a card to work with the agent and its VS Code workspace side by side. Use customizable quick prompts for repeated follow-up actions, or open a shell from the task footer when you need direct terminal access.

### 5. Ship it
Review and ship changes with VS Code's Git tools or a quick prompt tailored to your workflow. Move the card to Done when the work is complete; clearing Done removes its worktree, while the saved session can still be restored later.

---

[Apache 2.0](./LICENSE)
