import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FolderPlus, Layers3, Plus, Settings, Settings2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
	AlertDialog,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import type { RuntimeProjectSummary } from "@/runtime/types";

function ProjectMenuContent({ children }: { children: React.ReactNode }): React.ReactElement {
	return (
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				sideOffset={6}
				align="end"
				className="z-50 min-w-56 rounded-md border border-border-bright bg-surface-2 p-1 shadow-xl"
			>
				{children}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	);
}

const menuItemClassName =
	"flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-text-secondary outline-none hover:bg-surface-3 hover:text-text-primary data-[highlighted]:bg-surface-3 data-[highlighted]:text-text-primary";
const isIsolatedPreview = import.meta.env.VITE_KANBAN_ISOLATED_PREVIEW === "1";

export function ProjectBoardToolbar({
	projects,
	visibleProjectIds,
	onVisibleProjectIdsChange,
	onAddProject,
	onRemoveProject,
	onCreateTask,
	onOpenSettings,
	removingProjectId,
}: {
	projects: RuntimeProjectSummary[];
	visibleProjectIds: ReadonlySet<string>;
	onVisibleProjectIdsChange: (projectIds: Set<string>) => void;
	onAddProject: () => void;
	onRemoveProject: (projectId: string) => Promise<boolean>;
	onCreateTask: (projectId: string) => void;
	onOpenSettings: () => void;
	removingProjectId: string | null;
}): React.ReactElement {
	const [pendingRemoval, setPendingRemoval] = useState<RuntimeProjectSummary | null>(null);
	const sortedProjects = useMemo(() => [...projects].sort((a, b) => a.name.localeCompare(b.name)), [projects]);
	const allProjectsVisible =
		sortedProjects.length > 0 && sortedProjects.every((project) => visibleProjectIds.has(project.id));
	const visibleTaskCount = sortedProjects.reduce((total, project) => {
		if (!visibleProjectIds.has(project.id)) {
			return total;
		}
		return (
			total +
			project.taskCounts.in_progress +
			project.taskCounts.review +
			project.taskCounts.on_hold +
			project.taskCounts.trash
		);
	}, 0);

	const selectProject = (projectId: string) => {
		onVisibleProjectIdsChange(new Set([projectId]));
	};

	return (
		<>
			<div className="flex min-h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-divider bg-surface-0 px-3 py-2">
				<div className="mr-1 flex shrink-0 items-center gap-2">
					<Layers3 size={16} className="text-accent" />
					<div>
						<div className="text-sm font-semibold text-text-primary">All projects</div>
						<div className="text-[11px] text-text-tertiary">{visibleTaskCount} visible tickets</div>
					</div>
				</div>
				{isIsolatedPreview ? (
					<span className="shrink-0 rounded-full border border-status-orange/60 bg-status-orange/15 px-2 py-1 text-[11px] font-semibold text-status-orange">
						Isolated preview
					</span>
				) : null}
				<button
					type="button"
					onClick={() => onVisibleProjectIdsChange(new Set(sortedProjects.map((project) => project.id)))}
					className={cn(
						"shrink-0 cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
						allProjectsVisible
							? "border-accent bg-accent/15 text-accent"
							: "border-border-bright bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary",
					)}
				>
					All
				</button>
				{sortedProjects.map((project) => {
					const isVisible = visibleProjectIds.has(project.id);
					return (
						<button
							key={project.id}
							type="button"
							onClick={() => selectProject(project.id)}
							title={project.path}
							className={cn(
								"flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
								isVisible
									? "border-border-bright bg-surface-3 text-text-primary"
									: "border-border bg-surface-1 text-text-tertiary opacity-65 hover:opacity-100",
							)}
						>
							<span className={cn("h-1.5 w-1.5 rounded-full", isVisible ? "bg-accent" : "bg-text-tertiary")} />
							{project.name}
						</button>
					);
				})}
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger asChild>
							<Button variant="primary" size="sm" icon={<Plus size={14} />}>
								New task <ChevronDown size={12} />
							</Button>
						</DropdownMenu.Trigger>
						<ProjectMenuContent>
							<DropdownMenu.Label className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
								Create in project
							</DropdownMenu.Label>
							{sortedProjects.map((project) => (
								<DropdownMenu.Item
									key={project.id}
									className={menuItemClassName}
									onSelect={() => onCreateTask(project.id)}
								>
									<Layers3 size={14} />
									<span className="flex-1 truncate">{project.name}</span>
								</DropdownMenu.Item>
							))}
						</ProjectMenuContent>
					</DropdownMenu.Root>

					<Button
						variant="default"
						size="sm"
						icon={<Settings size={14} />}
						onClick={onOpenSettings}
						aria-label="Settings"
					/>

					<DropdownMenu.Root>
						<DropdownMenu.Trigger asChild>
							<Button variant="default" size="sm" icon={<Settings2 size={14} />} aria-label="Manage projects" />
						</DropdownMenu.Trigger>
						<ProjectMenuContent>
							<DropdownMenu.Item className={menuItemClassName} onSelect={onAddProject}>
								<FolderPlus size={14} />
								Add project
							</DropdownMenu.Item>
							<DropdownMenu.Separator className="my-1 h-px bg-border" />
							{sortedProjects.map((project) => (
								<DropdownMenu.Item
									key={project.id}
									className={cn(menuItemClassName, "text-status-red data-[highlighted]:text-status-red")}
									onSelect={() => setPendingRemoval(project)}
								>
									<Trash2 size={14} />
									<span className="flex-1 truncate">Remove {project.name}</span>
								</DropdownMenu.Item>
							))}
						</ProjectMenuContent>
					</DropdownMenu.Root>
				</div>
			</div>

			<AlertDialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove project?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						{pendingRemoval
							? `${pendingRemoval.name} will disappear from this board. Its repository files will not be deleted.`
							: "This project will be removed from the board."}
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="default" disabled={removingProjectId !== null}>
							Cancel
						</Button>
					</AlertDialogCancel>
					<Button
						variant="danger"
						disabled={!pendingRemoval || removingProjectId !== null}
						onClick={() => {
							if (!pendingRemoval) {
								return;
							}
							void onRemoveProject(pendingRemoval.id).then((removed) => {
								if (removed) {
									setPendingRemoval(null);
								}
							});
						}}
					>
						Remove project
					</Button>
				</AlertDialogFooter>
			</AlertDialog>
		</>
	);
}
