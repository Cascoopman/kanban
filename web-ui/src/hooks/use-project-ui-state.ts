import type { ComponentProps } from "react";
import { useMemo } from "react";
import type { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import { countTasksByColumn } from "@/hooks/app-utils";
import type { BoardData } from "@/types";

type ProjectSummaries = ComponentProps<typeof ProjectNavigationPanel>["projects"];

interface UseProjectUiStateInput {
	board: BoardData;
	canPersistWorkspaceState: boolean;
	currentProjectId: string | null;
	projects: ProjectSummaries;
	navigationCurrentProjectId: string | null;
}

interface UseProjectUiStateResult {
	displayedProjects: ProjectSummaries;
	navigationProjectPath: string | null;
}

export function useProjectUiState({
	board,
	canPersistWorkspaceState,
	currentProjectId,
	projects,
	navigationCurrentProjectId,
}: UseProjectUiStateInput): UseProjectUiStateResult {
	const displayedProjects = useMemo(() => {
		if (!canPersistWorkspaceState || !currentProjectId) {
			return projects;
		}
		const localCounts = countTasksByColumn(board);
		return projects.map((project) =>
			project.id === currentProjectId
				? {
						...project,
						taskCounts: localCounts,
					}
				: project,
		);
	}, [board, canPersistWorkspaceState, currentProjectId, projects]);

	const navigationProjectPath = useMemo(() => {
		if (!navigationCurrentProjectId) {
			return null;
		}
		return projects.find((project) => project.id === navigationCurrentProjectId)?.path ?? null;
	}, [navigationCurrentProjectId, projects]);

	return {
		displayedProjects,
		navigationProjectPath,
	};
}
