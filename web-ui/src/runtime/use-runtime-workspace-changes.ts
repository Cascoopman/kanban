import { useCallback, useEffect, useRef } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeWorkspaceChangesMode, RuntimeWorkspaceChangesResponse } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";
import { useInterval, useUnmount } from "@/utils/react-use";

export interface UseRuntimeWorkspaceChangesResult {
	changes: RuntimeWorkspaceChangesResponse | null;
	isLoading: boolean;
	isRuntimeAvailable: boolean;
	refresh: () => Promise<void>;
}

export function useRuntimeWorkspaceChanges(
	taskId: string | null,
	workspaceId: string | null,
	baseRef: string | null,
	mode: RuntimeWorkspaceChangesMode = "working_copy",
	stateVersion = 0,
	pollIntervalMs: number | null = null,
	viewKey: string | null = null,
	clearOnViewTransition = true,
): UseRuntimeWorkspaceChangesResult {
	const hasWorkspaceScope = taskId !== null && workspaceId !== null && baseRef !== null;
	const normalizedViewKey = viewKey ?? "__default__";
	const requestKey = `${workspaceId ?? "__none__"}:${taskId ?? "__none__"}:${baseRef ?? "__none__"}:${mode}:${normalizedViewKey}`;
	const previousRequestKeyRef = useRef(requestKey);
	const requestAbortControllerRef = useRef<AbortController | null>(null);
	const isRequestTransitioning = hasWorkspaceScope && previousRequestKeyRef.current !== requestKey;
	const queryFn = useCallback(async () => {
		if (!taskId || !workspaceId || !baseRef) {
			throw new Error("Missing workspace scope.");
		}
		void normalizedViewKey;
		requestAbortControllerRef.current?.abort();
		const abortController = new AbortController();
		requestAbortControllerRef.current = abortController;
		const trpcClient = getRuntimeTrpcClient(workspaceId);
		try {
			return await trpcClient.workspace.getChanges.query(
				{
					taskId,
					baseRef,
					mode,
				},
				{ signal: abortController.signal },
			);
		} finally {
			if (requestAbortControllerRef.current === abortController) {
				requestAbortControllerRef.current = null;
			}
		}
	}, [baseRef, mode, normalizedViewKey, taskId, workspaceId]);
	const changesQuery = useTrpcQuery<RuntimeWorkspaceChangesResponse>({
		enabled: hasWorkspaceScope,
		queryFn,
	});

	const refresh = useCallback(async () => {
		if (!hasWorkspaceScope) {
			return;
		}
		await changesQuery.refetch();
	}, [changesQuery.refetch, hasWorkspaceScope]);
	const previousStateVersionRef = useRef(stateVersion);

	useEffect(() => {
		if (hasWorkspaceScope) {
			return;
		}
		requestAbortControllerRef.current?.abort();
		requestAbortControllerRef.current = null;
	}, [hasWorkspaceScope]);

	useUnmount(() => {
		requestAbortControllerRef.current?.abort();
		requestAbortControllerRef.current = null;
	});

	useEffect(() => {
		if (!isRequestTransitioning) {
			return;
		}
		previousRequestKeyRef.current = requestKey;
		if (clearOnViewTransition) {
			changesQuery.setData(null);
		}
	}, [changesQuery.setData, clearOnViewTransition, isRequestTransitioning, requestKey]);

	useEffect(() => {
		if (!hasWorkspaceScope) {
			previousRequestKeyRef.current = requestKey;
			previousStateVersionRef.current = stateVersion;
			return;
		}
		if (previousStateVersionRef.current === stateVersion) {
			return;
		}
		previousStateVersionRef.current = stateVersion;
		void changesQuery.refetch();
	}, [changesQuery.refetch, hasWorkspaceScope, requestKey, stateVersion]);

	useInterval(
		() => {
			void changesQuery.refetch();
		},
		hasWorkspaceScope ? pollIntervalMs : null,
	);

	if (!taskId) {
		return {
			changes: null,
			isLoading: false,
			isRuntimeAvailable: true,
			refresh,
		};
	}

	if (!workspaceId) {
		return {
			changes: null,
			isLoading: false,
			isRuntimeAvailable: false,
			refresh,
		};
	}

	const shouldHideDuringTransition = clearOnViewTransition && isRequestTransitioning;
	const visibleChanges = shouldHideDuringTransition ? null : changesQuery.data;
	const visibleIsLoading = shouldHideDuringTransition || changesQuery.isLoading;
	const visibleIsRuntimeAvailable = shouldHideDuringTransition ? true : !changesQuery.isError;

	return {
		changes: visibleChanges,
		isLoading: visibleIsLoading,
		isRuntimeAvailable: visibleIsRuntimeAvailable,
		refresh,
	};
}
