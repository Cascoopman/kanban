import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildDetailTaskUrl, parseDetailTaskIdFromSearch } from "@/hooks/app-utils";
import { findCardSelection } from "@/state/board-state";
import type { BoardData } from "@/types";
import { getPreferredTaskIdForProjectSwitch } from "@/utils/detail-view-task-order";
import { useWindowEvent } from "@/utils/react-use";

interface UseDetailTaskNavigationInput {
	board: BoardData;
	currentProjectId: string | null;
	isAwaitingWorkspaceSnapshot: boolean;
	isInitialRuntimeLoad: boolean;
	isProjectSwitching: boolean;
	isWorkspaceMetadataPending: boolean;
	onSelectProject: (projectId: string) => void;
	onDetailClosed?: () => void;
}

export interface UseDetailTaskNavigationResult {
	selectedTaskId: string | null;
	selectedCard: ReturnType<typeof findCardSelection>;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	handleProjectSelect: (projectId: string) => void;
	handleProjectTaskSelect: (projectId: string, taskId: string) => void;
	handleBack: () => void;
}

export function useDetailTaskNavigation({
	board,
	currentProjectId,
	isAwaitingWorkspaceSnapshot,
	isInitialRuntimeLoad,
	isProjectSwitching,
	isWorkspaceMetadataPending,
	onSelectProject,
	onDetailClosed,
}: UseDetailTaskNavigationInput): UseDetailTaskNavigationResult {
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return parseDetailTaskIdFromSearch(window.location.search);
	});
	const previousProjectIdRef = useRef<string | null | undefined>(undefined);
	const pendingDetailProjectIdRef = useRef<string | null>(null);
	const pendingDetailTaskIdRef = useRef<string | null>(null);
	const onDetailClosedRef = useRef(onDetailClosed);
	const selectedCard = useMemo(() => {
		if (!selectedTaskId) {
			return null;
		}
		return findCardSelection(board, selectedTaskId);
	}, [board, selectedTaskId]);

	useEffect(() => {
		onDetailClosedRef.current = onDetailClosed;
	}, [onDetailClosed]);

	const closeDetail = useCallback(() => {
		setSelectedTaskId(null);
		onDetailClosedRef.current?.();
	}, []);

	const handleProjectSelect = useCallback(
		(projectId: string) => {
			if (!projectId || projectId === currentProjectId) {
				return;
			}
			const shouldKeepDetailOpen = selectedCard !== null || pendingDetailProjectIdRef.current !== null;
			pendingDetailProjectIdRef.current = shouldKeepDetailOpen ? projectId : null;
			pendingDetailTaskIdRef.current = null;
			if (shouldKeepDetailOpen) {
				closeDetail();
			}
			onSelectProject(projectId);
		},
		[closeDetail, currentProjectId, onSelectProject, selectedCard],
	);

	const handleProjectTaskSelect = useCallback(
		(projectId: string, taskId: string) => {
			if (!projectId || !taskId) {
				return;
			}
			if (projectId === currentProjectId) {
				setSelectedTaskId(taskId);
				return;
			}
			pendingDetailProjectIdRef.current = projectId;
			pendingDetailTaskIdRef.current = taskId;
			closeDetail();
			onSelectProject(projectId);
		},
		[closeDetail, currentProjectId, onSelectProject],
	);

	useEffect(() => {
		const previousProjectId = previousProjectIdRef.current;
		previousProjectIdRef.current = currentProjectId;
		if (previousProjectId === undefined) {
			return;
		}
		if (previousProjectId === currentProjectId) {
			return;
		}
		closeDetail();
	}, [closeDetail, currentProjectId]);

	useEffect(() => {
		const pendingProjectId = pendingDetailProjectIdRef.current;
		if (!pendingProjectId) {
			return;
		}
		if (pendingProjectId !== currentProjectId) {
			if (!isProjectSwitching) {
				pendingDetailProjectIdRef.current = null;
				pendingDetailTaskIdRef.current = null;
			}
			return;
		}
		if (isInitialRuntimeLoad || isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending) {
			return;
		}

		pendingDetailProjectIdRef.current = null;
		const pendingTaskId = pendingDetailTaskIdRef.current;
		pendingDetailTaskIdRef.current = null;
		setSelectedTaskId(
			pendingTaskId && findCardSelection(board, pendingTaskId)
				? pendingTaskId
				: getPreferredTaskIdForProjectSwitch(board),
		);
	}, [
		board,
		currentProjectId,
		isAwaitingWorkspaceSnapshot,
		isInitialRuntimeLoad,
		isProjectSwitching,
		isWorkspaceMetadataPending,
	]);

	useEffect(() => {
		if (
			selectedTaskId &&
			(isInitialRuntimeLoad || isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending)
		) {
			return;
		}
		if (selectedTaskId && !selectedCard) {
			closeDetail();
		}
	}, [
		closeDetail,
		isAwaitingWorkspaceSnapshot,
		isInitialRuntimeLoad,
		isProjectSwitching,
		isWorkspaceMetadataPending,
		selectedCard,
		selectedTaskId,
	]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const currentUrl = new URL(window.location.href);
		const currentTaskIdInUrl = parseDetailTaskIdFromSearch(currentUrl.search);
		if (currentTaskIdInUrl === selectedTaskId) {
			return;
		}
		const nextUrl = buildDetailTaskUrl({
			pathname: currentUrl.pathname,
			search: currentUrl.search,
			hash: currentUrl.hash,
			taskId: selectedTaskId,
		});
		if (selectedTaskId && !currentTaskIdInUrl) {
			window.history.pushState(window.history.state, "", nextUrl);
			return;
		}
		window.history.replaceState(window.history.state, "", nextUrl);
	}, [selectedTaskId]);

	const handleTaskDetailPopState = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		setSelectedTaskId(parseDetailTaskIdFromSearch(window.location.search));
		onDetailClosedRef.current?.();
	}, []);
	useWindowEvent("popstate", handleTaskDetailPopState);

	return {
		selectedTaskId,
		selectedCard,
		setSelectedTaskId,
		handleProjectSelect,
		handleProjectTaskSelect,
		handleBack: closeDetail,
	};
}
