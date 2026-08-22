import { spawnSync } from "node:child_process";

const DEFAULT_NOTIFICATION_TITLE = "Urgent Kanban alert";
const DEFAULT_NOTIFICATION_SUBTITLE = "Action needed";
const DEFAULT_NOTIFICATION_SOUND = "Basso";

export const MACOS_NOTIFICATION_APPLESCRIPT = `
on run argv
	set notificationTitle to item 1 of argv
	set notificationSubtitle to item 2 of argv
	set notificationMessage to item 3 of argv
	set notificationSound to item 4 of argv

	if notificationSubtitle is "" then
		if notificationSound is "" then
			display notification notificationMessage with title notificationTitle
		else
			display notification notificationMessage with title notificationTitle sound name notificationSound
		end if
	else
		if notificationSound is "" then
			display notification notificationMessage with title notificationTitle subtitle notificationSubtitle
		else
			display notification notificationMessage with title notificationTitle subtitle notificationSubtitle sound name notificationSound
		end if
	end if
end run
`.trim();

export interface MacOsNotificationInput {
	message: string;
	title?: string;
	subtitle?: string;
	sound?: string;
}

export interface MacOsNotificationResult {
	title: string;
	subtitle: string;
	message: string;
	sound: string | null;
}

export interface NotificationCommandResult {
	status: number | null;
	stderr: string;
	error?: Error;
}

export type NotificationCommandRunner = (command: string, args: string[]) => NotificationCommandResult;

function runNotificationCommand(command: string, args: string[]): NotificationCommandResult {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "ignore", "pipe"],
	});
	return {
		status: result.status,
		stderr: result.stderr ?? "",
		error: result.error,
	};
}

function normalizeSound(sound: string | undefined): string {
	const normalized = sound === undefined ? DEFAULT_NOTIFICATION_SOUND : sound.trim();
	return normalized.toLowerCase() === "none" ? "" : normalized;
}

export function sendMacOsNotification(
	input: MacOsNotificationInput,
	dependencies: {
		platform?: NodeJS.Platform;
		runCommand?: NotificationCommandRunner;
	} = {},
): MacOsNotificationResult {
	const message = input.message.trim();
	if (!message) {
		throw new Error("Notification message is required.");
	}

	const platform = dependencies.platform ?? process.platform;
	if (platform !== "darwin") {
		throw new Error("macOS notifications are only available on macOS.");
	}

	const title = input.title?.trim() || DEFAULT_NOTIFICATION_TITLE;
	const subtitle = input.subtitle === undefined ? DEFAULT_NOTIFICATION_SUBTITLE : input.subtitle.trim();
	const sound = normalizeSound(input.sound);
	const runCommand = dependencies.runCommand ?? runNotificationCommand;
	const commandResult = runCommand("osascript", [
		"-e",
		MACOS_NOTIFICATION_APPLESCRIPT,
		"--",
		title,
		subtitle,
		message,
		sound,
	]);

	if (commandResult.error || commandResult.status !== 0) {
		const detail = commandResult.error?.message || commandResult.stderr.trim();
		throw new Error(`Could not send macOS notification${detail ? `: ${detail}` : "."}`);
	}

	return {
		title,
		subtitle,
		message,
		sound: sound || null,
	};
}
