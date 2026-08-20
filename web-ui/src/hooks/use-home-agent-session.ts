// Manages the terminal-backed synthetic home agent session lifecycle.
import { createHomeAgentSessionId, isHomeAgentSessionIdForWorkspace } from "@runtime-home-agent-session";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef } from "react";

import { notifyError } from "@/components/app-toaster";
import { isSupportedAgentId } from "@/runtime/supported-agents";
import { estimateTaskSessionGeometry } from "@/runtime/task-session-geometry";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeConfigResponse, RuntimeGitRepositoryInfo, RuntimeTaskSessionSummary } from "@/runtime/types";

interface UseHomeAgentSessionInput {
	currentProjectId: string | null;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	workspaceGit: RuntimeGitRepositoryInfo | null;
	setSessionSummaries: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
	upsertSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
}

interface HomeAgentSessionIdentity {
	workspaceId: string;
	taskId: string;
}

function resolveHomeAgentBaseRef(workspaceGit: RuntimeGitRepositoryInfo | null): string {
	return workspaceGit?.currentBranch ?? workspaceGit?.defaultBranch ?? "HEAD";
}

function pruneWorkspaceHomeAgentSessions(
	setSessionSummaries: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>,
	workspaceId: string,
	keepTaskId: string | null,
): void {
	setSessionSummaries((currentSessions) => {
		const nextSessions = Object.fromEntries(
			Object.entries(currentSessions).filter(
				([taskId]) => !isHomeAgentSessionIdForWorkspace(taskId, workspaceId) || taskId === keepTaskId,
			),
		);
		return Object.keys(nextSessions).length === Object.keys(currentSessions).length ? currentSessions : nextSessions;
	});
}

async function stopHomeAgentSession(session: HomeAgentSessionIdentity | null): Promise<void> {
	if (!session) return;
	try {
		await getRuntimeTrpcClient(session.workspaceId).runtime.stopTaskSession.mutate({ taskId: session.taskId });
	} catch {
		// Ignore stop errors during cleanup.
	}
}

export function useHomeAgentSession({
	currentProjectId,
	runtimeProjectConfig,
	workspaceGit,
	setSessionSummaries,
	upsertSessionSummary,
}: UseHomeAgentSessionInput): string | null {
	const latestBaseRefRef = useRef("HEAD");
	const desiredSessionRef = useRef<HomeAgentSessionIdentity | null>(null);
	const startedSessionKeyRef = useRef<string | null>(null);
	const pendingSessionKeyRef = useRef<string | null>(null);
	const disposedRef = useRef(false);

	useEffect(() => {
		latestBaseRefRef.current = resolveHomeAgentBaseRef(workspaceGit);
	}, [workspaceGit?.currentBranch, workspaceGit?.defaultBranch]);

	const session = useMemo<HomeAgentSessionIdentity | null>(() => {
		if (
			!currentProjectId ||
			!runtimeProjectConfig?.effectiveCommand ||
			!isSupportedAgentId(runtimeProjectConfig.selectedAgentId)
		) {
			return null;
		}
		return {
			workspaceId: currentProjectId,
			taskId: createHomeAgentSessionId(currentProjectId, runtimeProjectConfig.selectedAgentId),
		};
	}, [currentProjectId, runtimeProjectConfig?.effectiveCommand, runtimeProjectConfig?.selectedAgentId]);

	const sessionKey = session ? `${session.workspaceId}:${session.taskId}` : null;

	useEffect(() => {
		const previousSession = desiredSessionRef.current;
		desiredSessionRef.current = session;
		if (currentProjectId) {
			pruneWorkspaceHomeAgentSessions(setSessionSummaries, currentProjectId, session?.taskId ?? null);
		}
		if (previousSession && previousSession.taskId !== session?.taskId) {
			if (startedSessionKeyRef.current === `${previousSession.workspaceId}:${previousSession.taskId}`) {
				startedSessionKeyRef.current = null;
			}
			void stopHomeAgentSession(previousSession);
		}
	}, [currentProjectId, session, setSessionSummaries]);

	useEffect(() => {
		if (
			!session ||
			!sessionKey ||
			startedSessionKeyRef.current === sessionKey ||
			pendingSessionKeyRef.current === sessionKey
		) {
			return;
		}
		pendingSessionKeyRef.current = sessionKey;
		void (async () => {
			try {
				const geometry = estimateTaskSessionGeometry(window.innerWidth, window.innerHeight);
				const response = await getRuntimeTrpcClient(session.workspaceId).runtime.startTaskSession.mutate({
					taskId: session.taskId,
					prompt: "",
					baseRef: latestBaseRefRef.current,
					cols: geometry.cols,
					rows: geometry.rows,
				});
				if (!response.ok || !response.summary) {
					throw new Error(response.error ?? "Could not start home agent session.");
				}
				if (disposedRef.current || desiredSessionRef.current?.taskId !== session.taskId) {
					await stopHomeAgentSession(session);
					return;
				}
				startedSessionKeyRef.current = sessionKey;
				upsertSessionSummary(response.summary);
			} catch (error) {
				if (!disposedRef.current && desiredSessionRef.current?.taskId === session.taskId) {
					notifyError(error instanceof Error ? error.message : String(error));
				}
			} finally {
				if (pendingSessionKeyRef.current === sessionKey) pendingSessionKeyRef.current = null;
			}
		})();
	}, [session, sessionKey, upsertSessionSummary]);

	useEffect(
		() => () => {
			disposedRef.current = true;
		},
		[],
	);

	return session?.taskId ?? null;
}
