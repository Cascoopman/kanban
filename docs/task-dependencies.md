# Task dependencies

Task dependencies record sequencing constraints without controlling task or agent lifecycle. A directed edge means “this task depends on that prerequisite.” Tasks are still created in In Progress and their agent sessions start immediately.

## Semantics

- A dependency is unresolved until its prerequisite is in Done.
- Moving a prerequisite to Done satisfies the edge; restoring it makes the edge unresolved again.
- Dependencies never move cards, start or stop sessions, or prevent a lifecycle-owned transition.
- A task may be completed while it still has unresolved dependencies. The UI preserves the graph as planning context instead of overriding the explicit workflow state.
- Deleting a task permanently removes every incoming and outgoing edge. Moving it to Done does not.

## Scope and validation

Dependencies are stored in each project board and can only connect tasks in that project. The aggregate board annotates edges with their project ID for display and routes edits through the selected task's project. Cross-project links are intentionally unsupported because project removal and workspace-local persistence would otherwise leave ambiguous ownership.

The runtime rejects self-dependencies, duplicate IDs, duplicate directed links, missing task references, and cycles. Persisted legacy `fromTaskId`/`toTaskId` edges are migrated to `taskId`/`dependsOnTaskId` on read. Invalid legacy edges are removed deterministically so old or partially deleted boards remain loadable.

## Persistence and concurrency

Dependencies are part of `board.json` and the workspace state API. Browser conflict recovery merges independent additions and removals with card changes. If concurrent additions would create a cycle, the normal workspace conflict path refreshes state instead of silently choosing an invalid graph.
