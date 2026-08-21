import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeAgentInstructionsResponse } from "@/runtime/types";

export async function fetchAgentInstructions(workspaceId: string): Promise<RuntimeAgentInstructionsResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.getAgentInstructions.query();
}

export async function saveAgentInstructions(
	workspaceId: string,
	content: string,
): Promise<RuntimeAgentInstructionsResponse> {
	return await getRuntimeTrpcClient(workspaceId).runtime.saveAgentInstructions.mutate({ content });
}
