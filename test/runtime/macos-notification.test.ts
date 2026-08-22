import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
	MACOS_NOTIFICATION_APPLESCRIPT,
	type NotificationCommandRunner,
	sendMacOsNotification,
} from "../../src/core/macos-notification";
import { createTempDir } from "../utilities/temp-dir";

function successfulRunner(): NotificationCommandRunner {
	return vi.fn(() => ({ status: 0, stdout: "button returned:Dismiss, gave up:false", stderr: "" }));
}

describe("sendMacOsNotification", () => {
	it.runIf(process.platform === "darwin")("contains valid AppleScript", () => {
		const temporaryDirectory = createTempDir("kanban-notification-script-");
		try {
			const result = spawnSync(
				"osacompile",
				["-e", MACOS_NOTIFICATION_APPLESCRIPT, "-o", join(temporaryDirectory.path, "notification.scpt")],
				{ encoding: "utf8" },
			);
			expect(result.status, result.stderr).toBe(0);
		} finally {
			temporaryDirectory.cleanup();
		}
	});

	it("passes notification content as argv without shell interpolation", () => {
		const runCommand = successfulRunner();
		const result = sendMacOsNotification(
			{
				title: 'Reservation "La Plage"',
				subtitle: "Pay within 5 minutes",
				message: "Complete payment now; total is $120.",
				sound: "none",
			},
			{ platform: "darwin", runCommand },
		);

		expect(runCommand).toHaveBeenCalledOnce();
		expect(runCommand).toHaveBeenCalledWith("osascript", [
			"-e",
			expect.stringContaining("display notification notificationMessage"),
			"--",
			'Reservation "La Plage"',
			"Pay within 5 minutes",
			"Complete payment now; total is $120.",
			"",
			"true",
		]);
		expect(result).toEqual({
			title: 'Reservation "La Plage"',
			subtitle: "Pay within 5 minutes",
			message: "Complete payment now; total is $120.",
			sound: null,
			modal: true,
			acknowledged: true,
		});
	});

	it("uses urgent defaults", () => {
		const runCommand = successfulRunner();

		expect(
			sendMacOsNotification({ message: "Approve the payment now." }, { platform: "darwin", runCommand }),
		).toEqual({
			title: "Urgent Kanban alert",
			subtitle: "Action needed",
			message: "Approve the payment now.",
			sound: "Basso",
			modal: true,
			acknowledged: true,
		});
	});

	it("can send a banner without a modal dialog", () => {
		const runCommand = successfulRunner();

		expect(
			sendMacOsNotification({ message: "Build finished.", modal: false }, { platform: "darwin", runCommand }),
		).toMatchObject({ modal: false, acknowledged: null });
		expect(runCommand).toHaveBeenCalledWith(
			"osascript",
			expect.arrayContaining(["Build finished.", "Basso", "false"]),
		);
	});

	it("rejects empty messages before launching osascript", () => {
		const runCommand = successfulRunner();

		expect(() => sendMacOsNotification({ message: "   " }, { platform: "darwin", runCommand })).toThrow(
			"Notification message is required.",
		);
		expect(runCommand).not.toHaveBeenCalled();
	});

	it("rejects unsupported platforms", () => {
		const runCommand = successfulRunner();

		expect(() => sendMacOsNotification({ message: "Act now." }, { platform: "linux", runCommand })).toThrow(
			"macOS notifications are only available on macOS.",
		);
		expect(runCommand).not.toHaveBeenCalled();
	});

	it("reports osascript failures", () => {
		const runCommand = vi.fn(() => ({ status: 1, stdout: "", stderr: "notifications are disabled" }));

		expect(() => sendMacOsNotification({ message: "Act now." }, { platform: "darwin", runCommand })).toThrow(
			"Could not send macOS notification: notifications are disabled",
		);
	});
});
