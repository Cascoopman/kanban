import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";

import type { RuntimeAgentDefinition, RuntimeAgentId, RuntimeConfigResponse } from "@/runtime/types";

export type SupportedAgentId = Extract<RuntimeAgentId, "claude" | "codex">;

const SUPPORTED_AGENT_IDS: readonly SupportedAgentId[] = ["claude", "codex"];

export function isSupportedAgentId(agentId: RuntimeAgentId | string | null | undefined): agentId is SupportedAgentId {
	return agentId === "claude" || agentId === "codex";
}

export function getSupportedAgentCatalog() {
	return SUPPORTED_AGENT_IDS.map((agentId) => getRuntimeAgentCatalogEntry(agentId)).filter(
		(entry): entry is NonNullable<ReturnType<typeof getRuntimeAgentCatalogEntry>> => entry !== null,
	);
}

export function filterSupportedAgentDefinitions(agents: readonly RuntimeAgentDefinition[]): RuntimeAgentDefinition[] {
	return agents.filter((agent) => isSupportedAgentId(agent.id));
}

export function resolveSupportedAgentId(
	agentId: RuntimeAgentId | string | null | undefined,
	fallback: SupportedAgentId = "claude",
): SupportedAgentId {
	return isSupportedAgentId(agentId) ? agentId : fallback;
}

function isTaskAgentSetupSatisfied(config: Pick<RuntimeConfigResponse, "agents"> | null | undefined): boolean | null {
	if (!config) {
		return null;
	}
	return filterSupportedAgentDefinitions(config.agents).some((agent) => agent.installed);
}

export function getTaskAgentNavbarHint(
	config: Pick<RuntimeConfigResponse, "agents"> | null | undefined,
	options?: { shouldUseNavigationPath?: boolean },
): string | undefined {
	if (options?.shouldUseNavigationPath || isTaskAgentSetupSatisfied(config) !== false) {
		return undefined;
	}
	return "No agent configured";
}
