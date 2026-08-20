---
name: mac-agent-setup
description: Set up or diagnose a reliable macOS development environment for coding agents. Use when configuring shell tools, AeroSpace, external displays, sleep behavior, Docker, or Kanban-style agent orchestration on a Mac.
---

# macOS Agent Setup

Build a reliable, keyboard-driven macOS environment for coding agents. Treat
this skill as an operational specification, not as a dotfiles bundle: inspect
the machine, use current official installation guidance, and keep all
machine-specific state out of version control.

## Guardrails

- Inspect existing configuration before changing it. Prefer small, reversible
  changes and verify each affected behavior.
- Keep credentials, SSH material, provider endpoints, secret-manager
  configuration, application exports, display IDs, and personal data local.
- Use a Keychain-backed secret manager such as secretspec for local secrets.
  Inject secrets into child processes only; never commit values or export them
  globally.
- Use OrbStack for Docker unless the user explicitly chooses a different
  runtime.
- Detect the architecture and installed tools. Do not assume a fixed Homebrew
  prefix, display resolution, application bundle ID, or package version.

## Setup order

### 1. Establish the base environment

Install and verify the current supported versions of:

- Homebrew and Zsh;
- Oh My Zsh for prompt and Git integration;
- a Keychain-backed SSH agent, if SSH authentication is needed;
- Rust and Google Cloud SDK when the project needs them;
- AeroSpace and JankyBorders for window management;
- displayplacer for monitor configuration;
- Amphetamine for keep-awake behavior;
- OrbStack for Docker;
- Ghostty and Emacs when those workflows are used.

Open a fresh login shell after installation. Confirm that developer tools are
available without startup errors, and load optional integrations only when
their installation exists.

### 2. Configure the shell

Keep the shell predictable:

- Give package-manager tools, user-local executables, and language-toolchain
  executables a deliberate PATH order.
- Keep the shell prompt and Git integration lightweight.
- Load SSH-agent state only when the socket is present.
- Use a local, ignored extension point for machine-specific settings.
- Configure cloud SDK paths and completions defensively so an absent SDK does
  not break new shells.
- Run secret-dependent tools through the secret manager, in a subprocess.

Verify a new shell, SSH authentication, one secret-injected test command, and
the absence of secret values in diagnostics or Git status.

### 3. Configure AeroSpace

Grant Accessibility permission and start AeroSpace at login. Prefer a simple
tiled layout with automatic orientation, modest gaps, keyboard focus and move
bindings, and a dedicated service mode for reset and floating-layout actions.

Use application rules by stable bundle identifier only after confirming the
identifier on the target machine. Keep system utilities and modal-heavy tools
floating. If adding a terminal shortcut that calls a helper script, create and
test the helper locally or remove the shortcut; never leave a dead binding.

Use JankyBorders, if installed, to make the focused tiled window obvious.
Treat Emacs specially only when the user actively uses it: focus or hide an
existing frame instead of creating duplicate windows.

Verify navigation, moving, resizing, layouts, workspace routing, floating
rules, and configuration reload before relying on the setup.

### 4. Configure external displays

Use displayplacer to make display behavior dynamic rather than serial-number
specific. For a laptop plus one external display:

1. detect enabled screens and identify the built-in display by type;
2. keep the external display's active mode and place it at the origin;
3. centre the laptop display directly below the external display; and
4. use a supported docked laptop resolution selected for that machine.

Do not alter the layout when the laptop is undocked or when multiple external
displays are connected. If a watcher is needed, log its work locally and use
the current macOS launch mechanism rather than checking in a machine-specific
agent.

Verify the one-monitor arrangement, undocked behavior, and multi-monitor
no-op behavior separately.

### 5. Configure sleep behavior for agents

Set a conservative battery policy and an AC policy that allows the display to
sleep while preserving work when appropriate. Review system power settings
before changing privileged options; do not alter hibernation settings without
a measured need.

Create an Amphetamine Trigger that prevents system sleep while allowing the
display to sleep whenever coding agents, builds, or local services must
continue unattended. Test it with a harmless long-running process after the
screen sleeps. Do not keep the display awake merely to keep an agent running.

### 6. Run agent work reliably

Use Kanban-style orchestration to give each task isolated worktree state and a
clear lifecycle. Persist the objective, decisions, and next action in the task
before a long run or possible compaction; an agent session can be interrupted
or resume in a new context.

Known recovery pattern: if a laptop sleep event ends a ticket's coding-agent
session, moving the ticket to Done and then back to its active state can
restore the session. Confirm the behavior in the installed Kanban version
before relying on it.

For design and technical choices, show rather than merely tell: produce
reviewable HTML alternatives, prototypes, product surfaces, SDK examples, API
examples, or short demonstrations when they make tradeoffs clearer.

### 7. Add optional productivity tools deliberately

Consider a usage reporter, a portable prompt, directory-jump tooling, fuzzy
finding, and CLI-queryable meeting-note sources when they improve the active
workflow. Verify each tool adds more value than shell startup cost or
maintenance burden before making it part of the default environment.

Prefer approved search or connector surfaces for task, meeting, and
communication context rather than reconstructing context from memory.

## Acceptance checklist

Complete the setup only when all of the following are true:

- A fresh Zsh login has the intended tools and no startup errors.
- Secret values are local, injected only into child processes, and absent from
  source control.
- AeroSpace starts, manages windows, and reloads correctly.
- The display workflow works for exactly one external monitor and declines to
  rewrite other layouts.
- The display can sleep while an Amphetamine-protected agent continues.
- Docker runs through OrbStack.
- Agent tasks have isolated worktrees and durable task state.

## Report

State what you inspected, what you changed, the verification results, and any
machine-specific settings the user must choose. Never copy private
configuration into a shared repository.
