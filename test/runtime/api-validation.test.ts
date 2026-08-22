import { describe, expect, it } from "vitest";

import { runtimeBoardCardSchema, runtimeTaskSessionSummarySchema } from "../../src/core/api-contract";
import {
	parseHookIngestRequest,
	parseTaskSessionStartRequest,
	parseWorkspaceFileSearchRequest,
} from "../../src/core/api-validation";

describe("parseWorkspaceFileSearchRequest", () => {
	it("parses q and limit", () => {
		const parsed = parseWorkspaceFileSearchRequest(new URLSearchParams({ q: "  src/runtime ", limit: "25" }));
		expect(parsed).toEqual({
			query: "src/runtime",
			limit: 25,
		});
	});

	it("treats missing q as empty query", () => {
		const parsed = parseWorkspaceFileSearchRequest(new URLSearchParams({ limit: "10" }));
		expect(parsed).toEqual({
			query: "",
		});
	});

	it("does not accept legacy query alias", () => {
		const parsed = parseWorkspaceFileSearchRequest(new URLSearchParams({ query: "legacy" }));
		expect(parsed).toEqual({
			query: "",
		});
	});

	it("throws when limit is invalid", () => {
		expect(() => {
			parseWorkspaceFileSearchRequest(new URLSearchParams({ q: "board", limit: "0" }));
		}).toThrow("Invalid file search limit parameter.");
	});
});

describe("parseHookIngestRequest", () => {
	it("parses and trims task and workspace identifiers", () => {
		const parsed = parseHookIngestRequest({
			taskId: "  task-123  ",
			workspaceId: "  workspace-456  ",
			event: "to_review",
			metadata: {
				source: " claude ",
				activityText: " Using Read ",
			},
		});
		expect(parsed).toEqual({
			taskId: "task-123",
			workspaceId: "workspace-456",
			event: "to_review",
			metadata: {
				source: "claude",
				activityText: "Using Read",
				hookEventName: undefined,
				toolName: undefined,
				finalMessage: undefined,
				notificationType: undefined,
			},
		});
	});

	it("throws when workspaceId is missing", () => {
		expect(() => {
			parseHookIngestRequest({
				taskId: "task-1",
				workspaceId: "   ",
				event: "to_review",
			});
		}).toThrow("Missing workspaceId");
	});
});

describe("parseTaskSessionStartRequest", () => {
	it("parses session resume flags and trims task identifiers", () => {
		const parsed = parseTaskSessionStartRequest({
			taskId: "  task-1  ",
			prompt: "",
			baseRef: "  main  ",
			resumeFromTrash: true,
			resumeExistingSession: "running",
		});
		expect(parsed).toEqual({
			taskId: "task-1",
			prompt: "",
			baseRef: "main",
			resumeFromTrash: true,
			resumeExistingSession: "running",
		});
	});
});

describe("persisted agent normalization", () => {
	it("discards unsupported card agent IDs and unknown retired settings", () => {
		const parsed = runtimeBoardCardSchema.parse({
			id: "task-1",
			title: "Continue task",
			startInPlanMode: false,
			agentId: "retired-agent",
			retiredProviderSettings: {
				providerId: "anthropic",
				modelId: "legacy-model",
			},
			baseRef: "main",
			createdAt: 1,
			updatedAt: 2,
		});

		expect(parsed.agentId).toBeUndefined();
		expect(parsed).not.toHaveProperty("retiredProviderSettings");
	});

	it("normalizes unsupported persisted session agent IDs to null", () => {
		const parsed = runtimeTaskSessionSummarySchema.parse({
			taskId: "task-1",
			state: "interrupted",
			agentId: "retired-agent",
			workspacePath: "/tmp/worktree",
			pid: null,
			startedAt: 1,
			updatedAt: 2,
			lastOutputAt: 2,
			reviewReason: "interrupted",
			exitCode: null,
		});

		expect(parsed.agentId).toBeNull();
	});
});
