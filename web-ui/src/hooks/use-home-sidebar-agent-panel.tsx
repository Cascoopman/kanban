// Composes the terminal-backed sidebar agent surface for the current workspace.
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { Spinner } from "@/components/ui/spinner";
import { selectNewestTaskSessionSummary } from "@/hooks/home-sidebar-agent-panel-session-summary";
import { useHomeAgentSession } from "@/hooks/use-home-agent-session";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { RuntimeConfigResponse, RuntimeGitRepositoryInfo, RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTerminalThemeColors } from "@/terminal/theme-colors";

interface UseHomeSidebarAgentPanelInput {
	currentProjectId: string | null;
	hasNoProjects: boolean;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	workspaceGit: RuntimeGitRepositoryInfo | null;
}

export function useHomeSidebarAgentPanel({
	currentProjectId,
	hasNoProjects,
	runtimeProjectConfig,
	taskSessions,
	workspaceGit,
}: UseHomeSidebarAgentPanelInput): ReactElement | null {
	const isMobile = useIsMobile();
	const terminalThemeColors = useTerminalThemeColors();
	const [sessionSummaries, setSessionSummaries] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const upsertSessionSummary = useCallback((summary: RuntimeTaskSessionSummary) => {
		setSessionSummaries((currentSessions) => {
			const newestSummary = selectNewestTaskSessionSummary(currentSessions[summary.taskId] ?? null, summary);
			return newestSummary === summary ? { ...currentSessions, [summary.taskId]: summary } : currentSessions;
		});
	}, []);
	const effectiveSessionSummaries = useMemo(() => {
		const merged = { ...taskSessions };
		for (const [taskId, summary] of Object.entries(sessionSummaries)) {
			const newest = selectNewestTaskSessionSummary(merged[taskId] ?? null, summary);
			if (newest) merged[taskId] = newest;
		}
		return merged;
	}, [sessionSummaries, taskSessions]);
	const taskId = useHomeAgentSession({
		currentProjectId,
		runtimeProjectConfig,
		workspaceGit,
		setSessionSummaries,
		upsertSessionSummary,
	});

	if (hasNoProjects || !currentProjectId) return null;
	if (!runtimeProjectConfig) {
		return (
			<div className="flex w-full items-center justify-center rounded-md border border-border bg-surface-2 px-3 py-6">
				<Spinner size={20} />
			</div>
		);
	}
	if (!taskId) {
		const selectedAgentLabel =
			runtimeProjectConfig.agents.find((agent) => agent.id === runtimeProjectConfig.selectedAgentId)?.label ??
			"selected agent";
		return (
			<div className="flex w-full items-center justify-center rounded-md border border-border bg-surface-2 px-3 text-center text-sm text-text-secondary">
				No runnable {selectedAgentLabel} command is configured. Open Settings, install the CLI, and select it.
			</div>
		);
	}

	return (
		<AgentTerminalPanel
			key={taskId}
			taskId={taskId}
			workspaceId={currentProjectId}
			summary={effectiveSessionSummaries[taskId] ?? null}
			onSummary={upsertSessionSummary}
			showSessionToolbar={false}
			autoFocus={!isMobile}
			panelBackgroundColor="var(--color-surface-1)"
			terminalBackgroundColor={terminalThemeColors.surfaceRaised}
			cursorColor={terminalThemeColors.textPrimary}
		/>
	);
}
