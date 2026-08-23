This file captures tribal knowledge-the nuanced, non-obvious patterns that make the difference between a quick fix and hours of debugging.
When to add to this file:
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to add something
Proactively suggest additions when any of the above happen-don't wait to be asked.
What NOT to add: Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

---

## MCP account routing

- The Mistral work Notion workspace is `notion` in Codex and `notion_work` in Claude Code.
- `notion_personal` is the personal Notion workspace.
- Use the client-appropriate work alias for company, client, professional, and Mistral-related content.
- Use `notion_personal` for private, household, and personal-project content.
- If the target Notion account is ambiguous, ask before creating, editing, moving, or deleting content.
- Search both Notion accounts only when explicitly requested or when the source workspace is genuinely unknown.
- When mutating Notion content, state which account was used.

## Linear account routing

- `linear_work` is the Mistral work Linear workspace.
- `linear_personal` is the personal Linear workspace.
- Use `linear_work` for Mistral, company, client, and professional work.
- Use `linear_personal` for private and personal-project work.
- If the target Linear account is ambiguous, ask before creating, editing, or deleting content.
- When mutating Linear content, state which account was used.

TypeScript principles
- No any types unless absolutely necessary.
- Check node_modules for external API type definitions instead of guessing.
- Prefer dependency-provided types, schemas, helpers, and metadata over local redefinitions.
- NEVER use inline imports. No await import("./foo.js"), no import("pkg").Type in type positions, and no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies. Upgrade the dependency instead.

Code quality
- Write production-quality code, not prototypes
- Break components into small, single-responsibility files. 
- Extract shared logic into hooks and utilities. 
- Prioritize maintainability and clean architecture over speed. 
- Follow DRY principles and maintain clean architecture with clear separation of concerns.
- In `web-ui`, prefer `react-use` hooks (via `@/kanban/utils/react-use`) whenever possible
- Before adding custom utility code, evaluate whether a well-maintained third-party package can reduce complexity and long-term maintenance cost.

Architecture opinions
- Avoid thin shell wrappers that only forward props or relocate JSX for a single call site.
- Prefer extracting domain logic (state, effects, async orchestration) over presentation-only pass-through layers.
- Do not optimize for line count alone. Optimize for codebase navigability and clarity.

Git guardrails
- NEVER commit unless user asks.

GitHub issues
When reading issues:
- Always read all comments on the issue.
- Use this command to get everything in one call:
  gh issue view <number> --json title,body,comments,labels,state

When closing issues via commit:
- Include fixes #<number> or closes #<number> in the commit message. This automatically closes the issue when the commit is merged.

Kanban task sessions
- When `KANBAN_TASK_ID` is present, begin by running `kanban task current` to identify the card and confirm its current title and state.
- Treat the task title as agent-owned metadata. If it is generic, unclear, or no longer reflects the work, update it early with `kanban task update --title "<concise outcome-oriented title>"`; inside a task session the CLI infers the task and workspace automatically.
- When the user must act within a few minutes, immediately run `kanban task notify --title "<urgent item>" --subtitle "<deadline>" --message "<concrete action>"`. It sends both a Notification Center entry and a modal alert that remains visible under Focus modes. Also report the issue in the conversation, and do not use notifications for routine progress or completion updates.
- Keep the title concise and useful on the board. Do not change the prompt, base ref, agent, or workflow mode unless the user requests it or the task requires it.
- After a substantial user-facing change or fix, launch the repository's fully isolated development preview and include its inspectable URL in the final response. For this repository, use `npm run dev:isolated -- --agent codex` (or `claude`) so preview state cannot affect production data. Keep the preview running for the user unless they ask to stop it; if a preview cannot be launched, state the concrete blocker instead of silently ending with static checks only.

web-ui Stack
- Kanban web-ui uses Tailwind CSS v4 for styling, Radix UI for accessible headless primitives, and Lucide React for icons.
- Custom UI primitives live in `src/components/ui/` (button, dialog, tooltip, kbd, spinner, cn utility).
- Toast notifications use `sonner`. Import `{ toast }` from `"sonner"` or use `showAppToast` from `@/components/app-toaster`.

Styling mental model
- Use Tailwind utility classes as the primary styling system. Prefer `className` over inline `style={{}}`.
- Prefer Tailwind classes over adding custom CSS in `globals.css` when possible. Conditional Tailwind classes via `cn()` are better than CSS overrides for state-driven styling (e.g. selected/active variants). Reserve `globals.css` for things Tailwind can't express: complex selectors (sibling combinators, attribute selectors), app-level layout glue, or styles that genuinely need to cascade.
- Only use inline `style={{}}` for truly dynamic values (colors from props/variables, computed positions from drag-and-drop, runtime-dependent dimensions).
- The design system tokens are defined in `globals.css` inside `@theme { ... }`. Use Tailwind utilities that reference them: `bg-surface-0`, `text-text-primary`, `border-border`, etc.

Design tokens (defined in globals.css @theme)
- Surface hierarchy: `surface-0` (#1F2428, app bg / columns), `surface-1` (#24292E, navbar / project col / raised), `surface-2` (#2D3339, cards/inputs), `surface-3` (#353C43, hover), `surface-4` (#3E464E, pressed/scrollbars)
- Borders: `border` (#30363D, default), `border-bright` (#444C56, more visible), `border-focus` (#0084FF, focus rings)
- Text: `text-primary` (#E6EDF3), `text-secondary` (#8B949E), `text-tertiary` (#6E7681)
- Accent: `accent` (#0084FF), `accent-hover` (#339DFF)
- Status: `status-blue` (#4C9AFF), `status-green` (#3FB950), `status-orange` (#D29922), `status-red` (#F85149), `status-purple` (#A371F7), `status-gold` (#D4A72C)
- Border radius: `rounded-sm` (4px), `rounded-md` (6px), `rounded-lg` (8px), `rounded-xl` (12px)

UI primitives (src/components/ui/)
- `Button` from `@/components/ui/button`: `variant="default"|"primary"|"danger"|"ghost"`, `size="sm"|"md"`, `icon={<LucideIcon />}`, `fill`, children for text content.
- `Dialog`, `DialogHeader`, `DialogBody`, `DialogFooter` from `@/components/ui/dialog`: For modals. `DialogHeader` takes a `title` string.
- `AlertDialog`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` from `@/components/ui/dialog`: For destructive confirmations.
- `Tooltip` from `@/components/ui/tooltip`: `<Tooltip content="text"><trigger/></Tooltip>`.
- `Spinner` from `@/components/ui/spinner`: `size` (number), `className`.
- `Kbd` from `@/components/ui/kbd`: Keyboard shortcut display.
- `cn` from `@/components/ui/cn`: Utility for conditional className joining.

Icons
- Use `lucide-react` for all icons. Import individual icons: `import { Settings, Plus, Play } from "lucide-react"`.
- Standard icon sizes: 14px for small buttons, 16px for default contexts.
- Pass icons as JSX elements to button `icon` prop: `icon={<Settings size={16} />}`.

Radix UI primitives
- Use Radix directly for headless behavior: `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-checkbox`, `@radix-ui/react-switch`, `@radix-ui/react-collapsible`, `@radix-ui/react-select`.
- Style Radix components with Tailwind classes. Use `data-[state=checked]:` for state-driven styling.

Dark theme
- The app is always in dark theme. Colors are set via CSS custom properties in `globals.css`.
- Surface hierarchy: `bg-surface-0` (app background) -> `bg-surface-1` (raised panels) -> `bg-surface-2` (cards/inputs) -> `bg-surface-3` (hover) -> `bg-surface-4` (pressed).
- Do NOT use Blueprint, Tailwind's light-mode defaults, or any `dark:` prefix. The theme is always dark.

Bug reproduction and regression testing
- For a user-reported bug, do not claim a definitive fix until you have either reproduced the reported behavior or clearly stated that reproduction was not possible. First capture the exact user-visible symptom and the sequence of events that produces it.
- Trace the causal path across the real boundaries involved (browser state, HTTP, WebSocket, runtime persistence, subprocesses, and disk as applicable). Explain which ordering or state transition caused the failure and why the change prevents it; passing tests alone are not a root-cause explanation.
- Add a deterministic regression test that follows the production code path. Use focused unit tests for merge/state logic, but for browser/runtime, persistence, timing, or concurrency bugs also add a full-stack Playwright test; mocks alone are insufficient when they bypass the failing boundary.
- Prove that a regression test detects the original bug: run it against the prior behavior or temporarily disable/revert the fix, observe the expected failure and user-visible symptom, then restore the implementation and observe it pass. Remove every temporary probe before handoff and report the red-before/green-after evidence.
- When browser behavior matters, run the test in Chromium and inspect the rendered UI plus relevant console, network, WebSocket, and toast behavior. If Playwright's browser is unavailable, install its managed Chromium with `npx playwright install chromium`; do not substitute a DOM-only test for a browser reproduction.
- Full-stack and browser tests must use a temporary `KANBAN_RUNTIME_HOME`, dedicated runtime/UI ports, and worktree-local assets. Never point automated tests at `~/.kanban`, the user's running production runtime, or its ports. Verify persisted outcomes through the real runtime API or isolated files, not only through visible DOM state.
- Keep the exact reproduction as a named regression test and document the command a developer can run locally. Before handoff, run the new regression test plus the relevant unit, integration, typecheck, and lint suites, and report exact pass/fail counts.

Misc. tribal knowledge
- Use `agent-memory search "<question>"` for semantic recall and `agent-memory grep "<RE2>"` for exact or regex matches across prior coding sessions.
- Open supporting evidence with `agent-memory session <session-id> --ordinal <n> --context 2`; commands are read-only and emit compact JSONL by default (`--raw` is lossless).
- Treat semantic memory results as leads, not evidence. Distinguish "no results" from "results returned but not relevant," and open the source session for any nugget that materially influences a diagnosis or implementation.
- Run `agent-memory --help` for filters and configuration details.
- Kanban is launched from the user's shell and inherits its environment. For agent detection and task-agent startup, prefer direct PATH checks and direct process launches over spawning an interactive shell. Avoid `zsh -i`, shell fallback command discovery, or "launch shell then type command into it" on hot paths. On setups with heavy shell init like `conda` or `nvm`, doing that per task can freeze the runtime and even make new Terminal.app windows feel hung when several tasks start at once. It's fine to use an actual interactive shell for explicit shell terminals, not for normal agent session work.
- If CI hangs on Node 22 after tests seem to finish, suspect a live subprocess before assuming a slow test body. Read `docs/node22-ci-hanging-tests-investigation.md` before repeating that investigation.
- When Kanban runs on a headless remote Linux instance (for example over SSH+tunnel), native folder picker commands may be unavailable (`zenity`/`kdialog`). Treat this as a normal remote-runtime limitation and use manual path entry fallback instead of requiring desktop packages.
- Persisted terminal session summaries are not live PTYs. After a runtime restart, `TerminalSessionManager` has metadata but no active process or terminal mirror. Restart recovery must use a distinct resume-existing flow; do not reuse `resumeFromTrash`, because trash restoration clears task chat state and applies review-oriented session state.
- Board columns are authoritative across runtime shutdown and restart. Snapshot a terminal session's logical state before stopping its PTY, and never interpret an `interrupted` process state as task completion or move its card to Done; interruption is recovery metadata, while Done remains an explicit board workflow.
- Codex `fork` prompts for a working directory when the source session cwd differs from the new task worktree. Spawning Codex with the worktree as the process cwd is not enough to suppress that prompt; pass an explicit `-C <new-worktree>` override for task branching.
- Claude Code conversation branching requires the source session ID and `--resume <session-id> --fork-session`; `--continue` only searches the new task worktree and cannot identify the source conversation.
- Task branching treats committed history as authoritative and working-copy transfer as best-effort. Keep branch patch capture bounded and return a warning with the usable partial branch instead of failing or buffering an arbitrarily large Git diff.
- `react-use` v17's `useLocalStorage` functional setter evaluates updates against a stale captured value. Use Kanban's wrappers in `web-ui/src/utils/react-use.ts`, which track the latest value explicitly, instead of importing `useLocalStorage` directly.
- Terminal links have two independent xterm paths: `WebLinksAddon` handles detected plain-text URLs, while OSC 8 hyperlinks are handled by xterm core through the terminal `linkHandler` option. Changing the addon does not affect OSC 8 behavior; without a custom `linkHandler`, xterm displays its own potentially-dangerous-link confirmation prompt.
- Runtime endpoint tests must derive expected hosts, origins, and ports from `src/core/runtime-endpoint.ts`. Kanban task shells inherit `KANBAN_RUNTIME_PORT`, so hard-coded default ports can make otherwise-correct middleware tests fail only when run inside a Kanban worktree.
- Development HTTP and WebSocket origin checks must use `KANBAN_WEB_UI_PORT`, not a hard-coded Vite port. Playwright and parallel local runtimes intentionally use non-default ports, and a stale `4173` allowlist makes the UI load before its runtime stream fails with a 403.
- The home kanban is a cross-project aggregate, but project persistence, terminals, git actions, and task mutations remain workspace-scoped. Keep aggregate cards tagged with their owning project and route into that workspace before opening or mutating a task; never persist the merged home board as one workspace's state.
- All indexed projects are loaded together: their terminal managers, board snapshots, and live session summaries must be available in the global runtime stream. A selected/current project is only an operation-routing context for workspace-scoped config, metadata, git, and terminal calls; it must never be treated as the only loaded board.
- Agent lifecycle state owns automatic board columns. Persist session and board changes atomically for `review -> in_progress` and `in_progress -> review`; do not reintroduce frontend effects that move cards from session summaries. Manual `on_hold` and `trash` placement remains board-owned and must not be overwritten by lifecycle reconciliation.
- Tasks persist only a required title and task settings; they do not persist prompts or images. Creating a task immediately adds a `New task` placeholder, opens its configured Claude/Codex session, and focuses the live terminal. The user enters the first prompt or slash command directly in the agent TUI; do not insert a pre-terminal prompt dialog into this flow.
- When another workflow supplies initial input programmatically, submit it through the live Claude/Codex PTY after the interactive prompt is visible; do not append it as a process argument. This preserves native slash-command behavior. Keep deferred input blocked while a workspace-trust prompt is visible, then send it after trust is confirmed. Resume and fork launches keep their existing command-line prompt semantics.
- Remote refs for task base resolution are fetched when a workspace first connects and again for each new task. Reuse an OpenSSH control connection across repositories that use the same effective SSH account so Touch ID is requested once per account per runtime. Keep accounts isolated through SSH host aliases, remote users, configured SSH commands, identity options, and SSH agent sockets.
- Persisted state under `~/.kanban` is shared by production runtimes. Use `npm run dev:isolated -- --agent codex` (or `claude`) for manual testing: it sets a temporary `KANBAN_RUNTIME_HOME`, uses a disposable Git project, selects fresh random ports for a distinct browser origin, and shows an `Isolated preview` badge. `npm run dev:full` and Playwright also use isolated runtime homes by default; only opt into production state explicitly. After a persisted-schema migration, never launch an older checkout against shared production state: refresh/rebuild from current `main` first. A stale runtime can otherwise rewrite newer board data using its older schema.
- Browser workspace persistence is a three-way merge between the last server baseline, current local board, and incoming server board. Keep the full server save response as the next baseline, and track the exact in-flight board because its WebSocket update may arrive before the HTTP response; revision-only updates can otherwise ignore server lifecycle reconciliation or overwrite a newer local edit.
- VS Code's outer `code serve-web` CLI does not accept the `--disable-workspace-trust` switch, while the downloaded `code-server` executable does. Bootstrap/download through `code serve-web`, then launch that matching downloaded server directly for the trusted inline editor. Mirrored extension directories must also be represented in the target `extensions.json`; copying folders alone makes VS Code mark and delete them as stale.
- VS Code Web keeps UI settings and workbench layout in browser-origin storage, not in the server's `--user-data-dir`. For deterministic inline startup, pass `skipWelcome` through the URL payload and inject `configurationDefaults` plus a forced `defaultLayout` into the workbench configuration through the local proxy. When proxying, rewrite the generated remote authority to the public proxy authority or VS Code resource requests will be blocked by its `connect-src 'self'` CSP.
- In agent worktrees, verify where `web-ui/dist` points before judging a runtime UI change. It may be a symlink to the main checkout's build, causing an isolated backend to serve stale production assets. For isolated demos, point that worktree-local symlink at its own `dist/web-ui` build so the main running app remains untouched.
- The runtime bundle is ESM, but `jsonc-parser` defaults to a UMD CommonJS entry with relative `require()` calls that break after inlining. Keep it external (or explicitly use its ESM build), and smoke-start `dist/cli.js` after build changes; `--help` alone does not load the affected VS Code profile path.
- Kanban-wide agent instructions live at `~/.kanban/AGENTS.md` and must be injected at agent launch ahead of project instructions. Do not rewrite a task worktree's `AGENTS.md`, because that dirties tracked repositories and creates untracked files in repositories without one. Claude Code receives a generated combined instruction file; Codex receives the global instructions as developer instructions and uses its native project `AGENTS.md` discovery when that file exists in the task worktree.
- Application logging deliberately mirrors existing output instead of adding semantic instrumentation. Keep browser console output and runtime stdout/stderr in separate files under `$KANBAN_RUNTIME_HOME/logs`, expose them through `kanban logs`, and never persist the remote-access passcode.
