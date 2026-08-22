import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeAgentInstructionsResponse } from "@/runtime/types";

export async function fetchGlobalAgentInstructions(): Promise<RuntimeAgentInstructionsResponse> {
	return await getRuntimeTrpcClient(null).runtime.getGlobalAgentInstructions.query();
}

export async function saveGlobalAgentInstructions(content: string): Promise<RuntimeAgentInstructionsResponse> {
	return await getRuntimeTrpcClient(null).runtime.saveGlobalAgentInstructions.mutate({ content });
}
