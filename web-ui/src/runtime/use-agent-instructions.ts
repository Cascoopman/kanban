import { useCallback, useEffect, useRef, useState } from "react";

import { fetchAgentInstructions, saveAgentInstructions } from "@/runtime/agent-instructions-query";
import type { RuntimeAgentInstructionsResponse } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

export interface UseAgentInstructionsResult {
	instructions: RuntimeAgentInstructionsResponse | null;
	isLoading: boolean;
	isSaving: boolean;
	loadError: Error | null;
	save: (content: string) => Promise<RuntimeAgentInstructionsResponse>;
}

export function useAgentInstructions(open: boolean, workspaceId: string | null): UseAgentInstructionsResult {
	const [isSaving, setIsSaving] = useState(false);
	const previousWorkspaceIdRef = useRef<string | null>(workspaceId);
	const queryFn = useCallback(async () => {
		if (!workspaceId) {
			throw new Error("Select a project to edit AGENTS.md.");
		}
		return await fetchAgentInstructions(workspaceId);
	}, [workspaceId]);
	const query = useTrpcQuery<RuntimeAgentInstructionsResponse>({
		enabled: open && workspaceId !== null,
		queryFn,
		retainDataOnError: true,
	});
	const setData = query.setData;

	useEffect(() => {
		if (previousWorkspaceIdRef.current === workspaceId) {
			return;
		}
		previousWorkspaceIdRef.current = workspaceId;
		setData(null);
	}, [setData, workspaceId]);

	const save = useCallback(
		async (content: string): Promise<RuntimeAgentInstructionsResponse> => {
			if (!workspaceId) {
				throw new Error("Select a project to edit AGENTS.md.");
			}
			setIsSaving(true);
			try {
				const saved = await saveAgentInstructions(workspaceId, content);
				setData(saved);
				return saved;
			} finally {
				setIsSaving(false);
			}
		},
		[setData, workspaceId],
	);

	return {
		instructions: query.data,
		isLoading: open && workspaceId !== null && query.isLoading,
		isSaving,
		loadError: query.error,
		save,
	};
}
