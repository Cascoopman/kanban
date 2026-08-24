import { CheckCircle2, CircleDashed, Link2, X } from "lucide-react";
import { useMemo } from "react";

import { SearchSelectDropdown } from "@/components/search-select-dropdown";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
	canAddBoardTaskDependency,
	findBoardTask,
	getTaskDependencies,
	getTaskDependents,
	isTaskDone,
} from "@/state/task-dependency-state";
import type { BoardCard, BoardData, BoardDependency } from "@/types";

function DependencyRow({
	dependency,
	linkedTask,
	isSatisfied,
	direction,
	disabled,
	onSelectTask,
	onRemove,
}: {
	dependency: BoardDependency;
	linkedTask: BoardCard;
	isSatisfied: boolean;
	direction: "depends_on" | "blocks";
	disabled: boolean;
	onSelectTask: (taskId: string) => void;
	onRemove: (dependencyId: string) => void;
}): React.ReactElement {
	return (
		<div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5">
			{isSatisfied ? (
				<CheckCircle2 size={14} className="shrink-0 text-status-green" aria-label="Satisfied dependency" />
			) : (
				<CircleDashed size={14} className="shrink-0 text-status-orange" aria-label="Unresolved dependency" />
			)}
			<button
				type="button"
				className="min-w-0 flex-1 truncate text-left text-xs text-text-primary hover:text-accent"
				onClick={() => onSelectTask(linkedTask.id)}
				title={linkedTask.title}
			>
				{linkedTask.title}
			</button>
			<span className="shrink-0 text-[10px] text-text-tertiary">
				{direction === "depends_on" ? (isSatisfied ? "Done" : "Blocking") : isSatisfied ? "Done" : "Waiting"}
			</span>
			<Tooltip content="Remove dependency">
				<Button
					variant="ghost"
					size="sm"
					icon={<X size={12} />}
					className="h-6 w-6 p-0"
					disabled={disabled}
					aria-label={`Remove dependency ${linkedTask.title}`}
					onClick={() => onRemove(dependency.id)}
				/>
			</Tooltip>
		</div>
	);
}

export function TaskDependenciesPanel({
	task,
	board,
	disabled = false,
	onAdd,
	onRemove,
	onSelectTask,
}: {
	task: BoardCard;
	board: BoardData;
	disabled?: boolean;
	onAdd: (dependsOnTaskId: string) => void;
	onRemove: (dependencyId: string) => void;
	onSelectTask: (taskId: string) => void;
}): React.ReactElement {
	const dependencies = useMemo(() => getTaskDependencies(board, task), [board, task]);
	const dependents = useMemo(() => getTaskDependents(board, task), [board, task]);
	const candidates = useMemo(
		() =>
			board.columns
				.flatMap((column) => column.cards)
				.filter((candidate) => canAddBoardTaskDependency(board, task, candidate.id))
				.sort((left, right) => {
					const doneDifference = Number(isTaskDone(board, left.id)) - Number(isTaskDone(board, right.id));
					return doneDifference || left.title.localeCompare(right.title);
				})
				.map((candidate) => ({ value: candidate.id, label: candidate.title })),
		[board, task],
	);

	const renderRows = (items: BoardDependency[], direction: "depends_on" | "blocks") =>
		items.map((dependency) => {
			const linkedTaskId = direction === "depends_on" ? dependency.dependsOnTaskId : dependency.taskId;
			const linkedTask = findBoardTask(board, linkedTaskId, task.projectId);
			if (!linkedTask) return null;
			return (
				<DependencyRow
					key={dependency.id}
					dependency={dependency}
					linkedTask={linkedTask}
					isSatisfied={isTaskDone(board, dependency.dependsOnTaskId, task.projectId)}
					direction={direction}
					disabled={disabled}
					onSelectTask={onSelectTask}
					onRemove={onRemove}
				/>
			);
		});

	return (
		<section className="shrink-0 rounded-lg border border-border bg-surface-1 p-2" aria-label="Task dependencies">
			<div className="mb-2 flex items-center gap-2">
				<Link2 size={14} className="text-text-secondary" />
				<h2 className="text-xs font-semibold text-text-primary">Dependencies</h2>
				<div className="ml-auto">
					<SearchSelectDropdown
						options={candidates}
						onSelect={onAdd}
						disabled={disabled || candidates.length === 0}
						size="sm"
						buttonText="Add"
						placeholder="Search tasks..."
						emptyText="No eligible tasks"
						noResultsText="No matching tasks"
						matchTargetWidth={false}
						dropdownStyle={{ width: 320 }}
					/>
				</div>
			</div>
			<p className="mb-2 text-[11px] leading-4 text-text-tertiary">
				Tasks start immediately. A dependency remains unresolved until its prerequisite is in Done.
			</p>
			<div className="flex flex-col gap-2">
				<div>
					<p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Depends on</p>
					<div className="flex flex-col gap-1">
						{dependencies.length > 0 ? (
							renderRows(dependencies, "depends_on")
						) : (
							<p className="text-xs text-text-tertiary">None</p>
						)}
					</div>
				</div>
				{dependents.length > 0 ? (
					<div>
						<p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Blocks</p>
						<div className="flex flex-col gap-1">{renderRows(dependents, "blocks")}</div>
					</div>
				) : null}
			</div>
		</section>
	);
}
