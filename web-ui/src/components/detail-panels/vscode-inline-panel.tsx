import { Code2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface VsCodeWebState {
	status: "unavailable" | "idle" | "starting" | "ready" | "error";
	url: string | null;
	workspacePath: string | null;
	error?: string;
}

export function VscodeInlinePanel({
	taskId,
	baseRef,
	workspaceId,
}: {
	taskId: string;
	baseRef: string;
	workspaceId: string | null;
}): React.ReactElement {
	const requestIdRef = useRef(0);
	const [state, setState] = useState<VsCodeWebState>({
		status: workspaceId ? "starting" : "unavailable",
		url: null,
		workspacePath: null,
		error: workspaceId ? undefined : "No project is selected.",
	});

	const start = useCallback(async () => {
		const requestId = ++requestIdRef.current;
		if (!workspaceId) {
			setState({ status: "unavailable", url: null, workspacePath: null, error: "No project is selected." });
			return;
		}
		setState({ status: "starting", url: null, workspacePath: null });
		try {
			const response = await getRuntimeTrpcClient(workspaceId).runtime.startVsCodeWeb.mutate({
				taskId,
				baseRef,
				acceptLicenseTerms: true,
			});
			if (requestId === requestIdRef.current) {
				setState(response);
			}
		} catch (error) {
			if (requestId === requestIdRef.current) {
				setState({
					status: "error",
					url: null,
					workspacePath: null,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}, [baseRef, taskId, workspaceId]);

	useEffect(() => {
		void start();
	}, [start]);

	if (state.status === "ready" && state.url) {
		return (
			<iframe
				title={`VS Code — ${taskId}`}
				src={state.url}
				className="min-h-0 min-w-0 flex-1 border-0 bg-[#181818]"
				allow="clipboard-read; clipboard-write"
			/>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-surface-0 p-6">
			<div className="flex max-w-md flex-col items-center gap-4 text-center">
				<div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border-bright bg-surface-2 text-accent">
					{state.status === "starting" ? <Spinner size={22} /> : <Code2 size={24} />}
				</div>
				<div>
					<h3 className="text-sm font-semibold text-text-primary">
						{state.status === "starting" ? "Preparing VS Code…" : "VS Code in Kanban"}
					</h3>
					<p className="mt-1 text-xs leading-5 text-text-secondary">
						{state.status === "starting"
							? "Kanban is opening this task’s worktree. The matching server is downloaded automatically when needed."
							: (state.error ?? "Checking the local VS Code installation…")}
					</p>
				</div>
				{state.status === "error" || state.status === "unavailable" ? (
					<Button variant="default" size="sm" icon={<RefreshCw size={14} />} onClick={() => void start()}>
						Try again
					</Button>
				) : null}
			</div>
		</div>
	);
}
