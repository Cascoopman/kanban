## npx kanban

<p align="center">
  <img src="https://github.com/user-attachments/assets/2aa3dcc7-94e3-4076-bcfe-6d0272007cfe" width="100%" />
</p>

A replacement for your IDE better suited for running many agents in parallel and reviewing diffs. Each task card gets its own terminal and worktree, all handled for you automatically. Enable auto-commit or auto-PR to let agents ship completed work autonomously.

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
Click a card to view the agent's TUI and a diff of all the changes in that worktree. Kanban includes its own checkpointing system so you can also see a diff from the last messages you've sent. Click on lines to leave comments and send them back to the agent.

To easily test and debug your app, create a Script Shortcut in settings. Use a command like `npm run dev` so that all you have to do is hit a play button in the navbar instead of remembering commands or asking your agent to do it.

### 5. Ship it
When the work looks good, hit **Commit** or **Open PR**. Kanban sends a dynamic prompt to the agent to convert the worktree into a commit on your base ref or a new PR branch, and work through any merge conflicts intelligently. Or skip review by enabling auto-commit / auto-PR and the agent ships as soon as it's done. Move the card to trash to clean up the worktree (you can always resume later since Kanban tracks the resume ID).

### 6. Keep track with git interface
Click the branch name in the navbar to open a full git interface to browse commit history, switch branches, fetch, pull, push, and visualize your git all without leaving Kanban. Keep track of everything your agents are doing across branches as work is completed.

---

[Apache 2.0](./LICENSE)
