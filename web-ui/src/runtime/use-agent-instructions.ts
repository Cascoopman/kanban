import { useCallback, useState } from "react";

import { fetchGlobalAgentInstructions, saveGlobalAgentInstructions } from "@/runtime/agent-instructions-query";
import type { RuntimeAgentInstructionsResponse } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

export interface UseAgentInstructionsResult {
	instructions: RuntimeAgentInstructionsResponse | null;
	isLoading: boolean;
	isSaving: boolean;
	loadError: Error | null;
	save: (content: string) => Promise<RuntimeAgentInstructionsResponse>;
}

export function useGlobalAgentInstructions(open: boolean): UseAgentInstructionsResult {
	const [isSaving, setIsSaving] = useState(false);
	const query = useTrpcQuery<RuntimeAgentInstructionsResponse>({
		enabled: open,
		queryFn: fetchGlobalAgentInstructions,
		retainDataOnError: true,
	});
	const setData = query.setData;

	const save = useCallback(
		async (content: string): Promise<RuntimeAgentInstructionsResponse> => {
			setIsSaving(true);
			try {
				const saved = await saveGlobalAgentInstructions(content);
				setData(saved);
				return saved;
			} finally {
				setIsSaving(false);
			}
		},
		[setData],
	);

	return {
		instructions: query.data,
		isLoading: open && query.isLoading,
		isSaving,
		loadError: query.error,
		save,
	};
}
