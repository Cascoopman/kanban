import { beforeEach, describe, expect, it, vi } from "vitest";

import { toTelemetrySelectedAgentId, trackTaskCreated, trackTaskResumedFromTrash } from "@/telemetry/events";

const captureMock = vi.hoisted(() => vi.fn());
const isTelemetryEnabledMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("posthog-js", () => ({
	default: {
		capture: captureMock,
	},
}));

vi.mock("@/telemetry/posthog-config", () => ({
	isTelemetryEnabled: isTelemetryEnabledMock,
}));

describe("telemetry events", () => {
	beforeEach(() => {
		captureMock.mockReset();
		isTelemetryEnabledMock.mockReset();
		isTelemetryEnabledMock.mockReturnValue(true);
	});

	it("captures task creation settings", () => {
		trackTaskCreated({
			selected_agent_id: "unknown",
			start_in_plan_mode: true,
		});

		expect(captureMock).toHaveBeenCalledWith("task_created", {
			selected_agent_id: "unknown",
			start_in_plan_mode: true,
		});
	});

	it("captures task creation outside plan mode", () => {
		trackTaskCreated({
			selected_agent_id: "unknown",
			start_in_plan_mode: false,
		});

		expect(captureMock).toHaveBeenCalledWith("task_created", {
			selected_agent_id: "unknown",
			start_in_plan_mode: false,
		});
	});

	it("captures task resume events", () => {
		trackTaskResumedFromTrash();

		expect(captureMock).toHaveBeenCalledWith("task_resumed_from_trash", {});
	});

	it("skips capture when telemetry is disabled", () => {
		isTelemetryEnabledMock.mockReturnValue(false);

		trackTaskResumedFromTrash();

		expect(captureMock).not.toHaveBeenCalled();
	});

	it("normalizes nullable agent ids for telemetry", () => {
		expect(toTelemetrySelectedAgentId("codex")).toBe("codex");
		expect(toTelemetrySelectedAgentId(null)).toBe("unknown");
		expect(toTelemetrySelectedAgentId(undefined)).toBe("unknown");
	});
});
