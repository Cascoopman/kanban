import { useEffect, useReducer, useRef } from "react";

import type {
	RuntimeProjectBoardSnapshot,
	RuntimeProjectSummary,
	RuntimeStateStreamMessage,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamTaskReadyForReviewMessage,
	RuntimeStateStreamWorkspaceSelectedMessage,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceMetadata,
	RuntimeWorkspaceStateResponse,
} from "@/runtime/types";

const STREAM_RECONNECT_BASE_DELAY_MS = 500;
const STREAM_RECONNECT_MAX_DELAY_MS = 5_000;

function mergeTaskSessionSummaries(
	currentSessions: Record<string, RuntimeTaskSessionSummary>,
	summaries: RuntimeTaskSessionSummary[],
): Record<string, RuntimeTaskSessionSummary> {
	if (summaries.length === 0) {
		return currentSessions;
	}
	const nextSessions = { ...currentSessions };
	for (const summary of summaries) {
		const existing = nextSessions[summary.taskId];
		if (!existing || existing.updatedAt <= summary.updatedAt) {
			nextSessions[summary.taskId] = summary;
		}
	}
	return nextSessions;
}

function getRuntimeStreamUrl(workspaceId: string | null): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/api/runtime/ws`);
	if (workspaceId) {
		url.searchParams.set("workspaceId", workspaceId);
	}
	return url.toString();
}

export interface UseRuntimeStateStreamResult {
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
	projectBoards: RuntimeProjectBoardSnapshot[];
	workspaceState: RuntimeWorkspaceStateResponse | null;
	workspaceMetadata: RuntimeWorkspaceMetadata | null;
	latestTaskReadyForReview: RuntimeStateStreamTaskReadyForReviewMessage | null;
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
}

interface RuntimeStateStreamStore {
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
	projectBoards: RuntimeProjectBoardSnapshot[];
	workspaceState: RuntimeWorkspaceStateResponse | null;
	workspaceMetadata: RuntimeWorkspaceMetadata | null;
	latestTaskReadyForReview: RuntimeStateStreamTaskReadyForReviewMessage | null;
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
}

type RuntimeStateStreamAction =
	| { type: "requested_workspace_changed" }
	| { type: "stream_connected" }
	| { type: "snapshot"; payload: RuntimeStateStreamSnapshotMessage }
	| { type: "workspace_selected"; payload: RuntimeStateStreamWorkspaceSelectedMessage }
	| {
			type: "projects_updated";
			payload: RuntimeStateStreamProjectsMessage;
			nextProjectId: string | null;
	  }
	| { type: "workspace_metadata_updated"; workspaceMetadata: RuntimeWorkspaceMetadata }
	| { type: "task_ready_for_review"; payload: RuntimeStateStreamTaskReadyForReviewMessage }
	| { type: "workspace_state_updated"; workspaceId: string; workspaceState: RuntimeWorkspaceStateResponse }
	| { type: "task_sessions_updated"; workspaceId: string; summaries: RuntimeTaskSessionSummary[] }
	| { type: "stream_error"; message: string }
	| { type: "stream_disconnected"; message: string };

function createInitialRuntimeStateStreamStore(requestedWorkspaceId: string | null): RuntimeStateStreamStore {
	return {
		currentProjectId: requestedWorkspaceId,
		projects: [],
		projectBoards: [],
		workspaceState: null,
		workspaceMetadata: null,
		latestTaskReadyForReview: null,
		streamError: null,
		isRuntimeDisconnected: false,
		hasReceivedSnapshot: false,
	};
}

function updateProjectBoardState(
	projectBoards: RuntimeProjectBoardSnapshot[],
	workspaceId: string,
	workspaceState: RuntimeWorkspaceStateResponse,
): RuntimeProjectBoardSnapshot[] {
	return projectBoards.map((snapshot) =>
		snapshot.project.id === workspaceId
			? {
					...snapshot,
					board: workspaceState.board,
					sessions: mergeTaskSessionSummaries(snapshot.sessions, Object.values(workspaceState.sessions ?? {})),
				}
			: snapshot,
	);
}

function updateProjectBoardSessions(
	projectBoards: RuntimeProjectBoardSnapshot[],
	workspaceId: string,
	summaries: RuntimeTaskSessionSummary[],
): RuntimeProjectBoardSnapshot[] {
	return projectBoards.map((snapshot) =>
		snapshot.project.id === workspaceId
			? {
					...snapshot,
					sessions: mergeTaskSessionSummaries(snapshot.sessions, summaries),
				}
			: snapshot,
	);
}

function resolveProjectIdAfterProjectsUpdate(
	currentProjectId: string | null,
	payload: RuntimeStateStreamProjectsMessage,
): string | null {
	if (currentProjectId && payload.projects.some((project) => project.id === currentProjectId)) {
		return currentProjectId;
	}
	return payload.currentProjectId;
}

function runtimeStateStreamReducer(
	state: RuntimeStateStreamStore,
	action: RuntimeStateStreamAction,
): RuntimeStateStreamStore {
	if (action.type === "requested_workspace_changed") {
		return {
			...state,
			workspaceState: null,
			workspaceMetadata: null,
			streamError: null,
			isRuntimeDisconnected: false,
			hasReceivedSnapshot: false,
		};
	}
	if (action.type === "stream_connected") {
		return {
			...state,
			streamError: null,
			isRuntimeDisconnected: false,
		};
	}
	if (action.type === "snapshot") {
		const nextWorkspaceState = action.payload.workspaceState
			? {
					...action.payload.workspaceState,
					sessions: mergeTaskSessionSummaries(
						state.workspaceState?.sessions ?? {},
						Object.values(action.payload.workspaceState.sessions ?? {}),
					),
				}
			: null;
		return {
			currentProjectId: action.payload.currentProjectId,
			projects: action.payload.projects,
			projectBoards: action.payload.projectBoards,
			workspaceState: nextWorkspaceState,
			workspaceMetadata: action.payload.workspaceMetadata,
			latestTaskReadyForReview: state.latestTaskReadyForReview,
			streamError: null,
			isRuntimeDisconnected: false,
			hasReceivedSnapshot: true,
		};
	}
	if (action.type === "workspace_selected") {
		const nextWorkspaceState = action.payload.workspaceState
			? {
					...action.payload.workspaceState,
					sessions: mergeTaskSessionSummaries({}, Object.values(action.payload.workspaceState.sessions ?? {})),
				}
			: null;
		return {
			...state,
			currentProjectId: action.payload.currentProjectId,
			workspaceState: nextWorkspaceState,
			workspaceMetadata: action.payload.workspaceMetadata,
			latestTaskReadyForReview: null,
			streamError: null,
			isRuntimeDisconnected: false,
			hasReceivedSnapshot: true,
		};
	}
	if (action.type === "projects_updated") {
		const didProjectChange = action.nextProjectId !== state.currentProjectId;
		return {
			...state,
			currentProjectId: action.nextProjectId,
			projects: action.payload.projects,
			projectBoards: action.payload.projectBoards,
			workspaceState: didProjectChange ? null : state.workspaceState,
			workspaceMetadata: didProjectChange ? null : state.workspaceMetadata,
			latestTaskReadyForReview: didProjectChange ? null : state.latestTaskReadyForReview,
			hasReceivedSnapshot: true,
		};
	}
	if (action.type === "workspace_metadata_updated") {
		return {
			...state,
			workspaceMetadata: action.workspaceMetadata,
		};
	}
	if (action.type === "task_ready_for_review") {
		return {
			...state,
			latestTaskReadyForReview: action.payload,
		};
	}
	if (action.type === "workspace_state_updated") {
		const isSelectedWorkspace = action.workspaceId === state.currentProjectId;
		const mergedWorkspaceState = {
			...action.workspaceState,
			sessions: mergeTaskSessionSummaries(
				isSelectedWorkspace ? (state.workspaceState?.sessions ?? {}) : {},
				Object.values(action.workspaceState.sessions ?? {}),
			),
		};
		return {
			...state,
			projectBoards: updateProjectBoardState(state.projectBoards, action.workspaceId, action.workspaceState),
			workspaceState: isSelectedWorkspace ? mergedWorkspaceState : state.workspaceState,
		};
	}
	if (action.type === "task_sessions_updated") {
		const isSelectedWorkspace = action.workspaceId === state.currentProjectId;
		return {
			...state,
			projectBoards: updateProjectBoardSessions(state.projectBoards, action.workspaceId, action.summaries),
			workspaceState:
				isSelectedWorkspace && state.workspaceState
					? {
							...state.workspaceState,
							sessions: mergeTaskSessionSummaries(state.workspaceState.sessions, action.summaries),
						}
					: state.workspaceState,
		};
	}
	if (action.type === "stream_error") {
		return {
			...state,
			streamError: action.message,
			isRuntimeDisconnected: false,
		};
	}
	if (action.type === "stream_disconnected") {
		return {
			...state,
			streamError: action.message,
			isRuntimeDisconnected: true,
		};
	}
	return state;
}

export function useRuntimeStateStream(requestedWorkspaceId: string | null): UseRuntimeStateStreamResult {
	const [state, dispatch] = useReducer(
		runtimeStateStreamReducer,
		requestedWorkspaceId,
		createInitialRuntimeStateStreamStore,
	);
	const requestedWorkspaceIdRef = useRef(requestedWorkspaceId);
	const activeWorkspaceIdRef = useRef(requestedWorkspaceId);
	const socketRef = useRef<WebSocket | null>(null);
	const nextSelectionRequestIdRef = useRef(0);
	const latestSelectionRequestIdRef = useRef<number | null>(null);
	const pendingWorkspaceSelectionRef = useRef<{ requestId: number; workspaceId: string | null } | null>(null);
	const selectWorkspaceRef = useRef<(workspaceId: string | null) => void>(() => undefined);
	const previousRequestedWorkspaceIdRef = useRef(requestedWorkspaceId);

	useEffect(() => {
		let cancelled = false;
		let reconnectTimer: number | null = null;
		let reconnectAttempt = 0;

		const cleanupSocket = () => {
			const socket = socketRef.current;
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
				socketRef.current = null;
			}
		};

		const sendPendingWorkspaceSelection = () => {
			const socket = socketRef.current;
			const pendingSelection = pendingWorkspaceSelectionRef.current;
			if (!socket || socket.readyState !== WebSocket.OPEN || !pendingSelection) {
				return;
			}
			try {
				socket.send(
					JSON.stringify({
						type: "select_workspace",
						requestId: pendingSelection.requestId,
						workspaceId: pendingSelection.workspaceId,
					}),
				);
			} catch {
				// A reconnect will retry the pending workspace selection.
			}
		};

		const scheduleReconnect = () => {
			if (cancelled) {
				return;
			}
			if (reconnectTimer !== null) {
				return;
			}
			const delay = Math.min(STREAM_RECONNECT_MAX_DELAY_MS, STREAM_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt);
			reconnectAttempt += 1;
			reconnectTimer = window.setTimeout(() => {
				connect();
			}, delay);
		};

		const connect = () => {
			if (cancelled) {
				return;
			}
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			cleanupSocket();
			try {
				const socket = new WebSocket(getRuntimeStreamUrl(requestedWorkspaceIdRef.current));
				socketRef.current = socket;
				socket.onopen = () => {
					reconnectAttempt = 0;
					dispatch({ type: "stream_connected" });
					sendPendingWorkspaceSelection();
				};
				socket.onmessage = (event) => {
					try {
						const payload = JSON.parse(String(event.data)) as RuntimeStateStreamMessage;
						if (payload.type === "snapshot") {
							activeWorkspaceIdRef.current = payload.currentProjectId;
							dispatch({ type: "snapshot", payload });
							return;
						}
						if (payload.type === "workspace_selected") {
							if (payload.requestId !== latestSelectionRequestIdRef.current) {
								return;
							}
							pendingWorkspaceSelectionRef.current = null;
							activeWorkspaceIdRef.current = payload.currentProjectId;
							dispatch({ type: "workspace_selected", payload });
							return;
						}
						if (payload.type === "projects_updated") {
							const previousWorkspaceId = activeWorkspaceIdRef.current;
							const nextProjectId = resolveProjectIdAfterProjectsUpdate(previousWorkspaceId, payload);
							dispatch({
								type: "projects_updated",
								payload,
								nextProjectId,
							});
							if (nextProjectId !== previousWorkspaceId) {
								requestedWorkspaceIdRef.current = nextProjectId;
								selectWorkspaceRef.current(nextProjectId);
							}
							return;
						}
						if (payload.type === "workspace_state_updated") {
							dispatch({
								type: "workspace_state_updated",
								workspaceId: payload.workspaceId,
								workspaceState: payload.workspaceState,
							});
							return;
						}
						if (payload.type === "workspace_metadata_updated") {
							if (payload.workspaceId !== activeWorkspaceIdRef.current) {
								return;
							}
							dispatch({
								type: "workspace_metadata_updated",
								workspaceMetadata: payload.workspaceMetadata,
							});
							return;
						}
						if (payload.type === "task_sessions_updated") {
							dispatch({
								type: "task_sessions_updated",
								workspaceId: payload.workspaceId,
								summaries: payload.summaries,
							});
							return;
						}
						if (payload.type === "task_ready_for_review") {
							dispatch({
								type: "task_ready_for_review",
								payload,
							});
							return;
						}
						if (payload.type === "error") {
							dispatch({
								type: "stream_error",
								message: payload.message,
							});
						}
					} catch {
						// Ignore malformed stream messages.
					}
				};
				socket.onclose = () => {
					if (socketRef.current === socket) {
						socketRef.current = null;
					}
					if (cancelled) {
						return;
					}
					dispatch({
						type: "stream_disconnected",
						message: "Runtime stream disconnected.",
					});
					scheduleReconnect();
				};
				socket.onerror = () => {
					if (cancelled) {
						return;
					}
					dispatch({
						type: "stream_disconnected",
						message: "Runtime stream connection failed.",
					});
				};
			} catch (error) {
				dispatch({
					type: "stream_disconnected",
					message: error instanceof Error ? error.message : String(error),
				});
				scheduleReconnect();
				return;
			}
		};

		selectWorkspaceRef.current = (workspaceId) => {
			const pendingSelection = pendingWorkspaceSelectionRef.current;
			if (
				pendingSelection?.workspaceId === workspaceId ||
				(!pendingSelection && activeWorkspaceIdRef.current === workspaceId)
			) {
				return;
			}
			const requestId = nextSelectionRequestIdRef.current + 1;
			nextSelectionRequestIdRef.current = requestId;
			latestSelectionRequestIdRef.current = requestId;
			pendingWorkspaceSelectionRef.current = { requestId, workspaceId };
			dispatch({ type: "requested_workspace_changed" });
			sendPendingWorkspaceSelection();
		};

		connect();

		return () => {
			cancelled = true;
			if (reconnectTimer != null) {
				window.clearTimeout(reconnectTimer);
			}
			cleanupSocket();
			selectWorkspaceRef.current = () => undefined;
		};
	}, []);

	useEffect(() => {
		if (previousRequestedWorkspaceIdRef.current === requestedWorkspaceId) {
			return;
		}
		previousRequestedWorkspaceIdRef.current = requestedWorkspaceId;
		requestedWorkspaceIdRef.current = requestedWorkspaceId;
		selectWorkspaceRef.current(requestedWorkspaceId);
	}, [requestedWorkspaceId]);

	return {
		currentProjectId: state.currentProjectId,
		projects: state.projects,
		projectBoards: state.projectBoards,
		workspaceState: state.workspaceState,
		workspaceMetadata: state.workspaceMetadata,
		latestTaskReadyForReview: state.latestTaskReadyForReview,
		streamError: state.streamError,
		isRuntimeDisconnected: state.isRuntimeDisconnected,
		hasReceivedSnapshot: state.hasReceivedSnapshot,
	};
}
