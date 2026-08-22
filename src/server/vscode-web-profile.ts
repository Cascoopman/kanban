import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { type ParseError, parse } from "jsonc-parser";

const EXTENSION_SYNC_STATE_FILENAME = ".kanban-desktop-extension-sync.json";

interface ExtensionSyncState {
	sourceDirectory: string;
	extensionDirectories: string[];
}

export interface VsCodeDesktopProfilePaths {
	settingsPath: string;
	extensionsDirectory: string;
}

export interface PrepareVsCodeWebProfileOptions {
	serverDataDirectory: string;
	homeDirectory?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
}

export interface PreparedVsCodeWebProfile {
	configurationDefaults: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsoncObject(path: string): Promise<Record<string, unknown> | null> {
	const value = await readJsoncValue(path);
	return isRecord(value) ? value : null;
}

async function readJsoncValue(path: string): Promise<unknown> {
	try {
		const errors: ParseError[] = [];
		const value: unknown = parse(await readFile(path, "utf8"), errors, {
			allowTrailingComma: true,
			disallowComments: false,
		});
		return errors.length === 0 ? value : null;
	} catch {
		return null;
	}
}

async function readExtensionSyncState(path: string): Promise<ExtensionSyncState | null> {
	const value = await readJsoncObject(path);
	if (
		!value ||
		typeof value.sourceDirectory !== "string" ||
		!Array.isArray(value.extensionDirectories) ||
		!value.extensionDirectories.every((entry) => typeof entry === "string")
	) {
		return null;
	}
	return {
		sourceDirectory: value.sourceDirectory,
		extensionDirectories: value.extensionDirectories,
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await readFile(join(path, "package.json"));
		return true;
	} catch {
		return false;
	}
}

async function listExtensionDirectories(sourceDirectory: string): Promise<string[]> {
	try {
		const entries = await readdir(sourceDirectory, { withFileTypes: true });
		const candidates = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
		const results = await Promise.all(
			candidates.map(async (entry) => ((await pathExists(join(sourceDirectory, entry.name))) ? entry.name : null)),
		);
		return results.filter((entry): entry is string => entry !== null).sort();
	} catch {
		return [];
	}
}

async function copyExtensionDirectory(sourcePath: string, targetPath: string): Promise<void> {
	const temporaryPath = `${targetPath}.kanban-sync-${randomUUID()}`;
	try {
		await cp(sourcePath, temporaryPath, { recursive: true, errorOnExist: true, force: false });
		await rename(temporaryPath, targetPath);
	} finally {
		await rm(temporaryPath, { recursive: true, force: true });
	}
}

function getExtensionRelativeLocation(value: unknown): string | null {
	if (!isRecord(value) || typeof value.relativeLocation !== "string" || !value.relativeLocation) {
		return null;
	}
	return value.relativeLocation;
}

function relocateExtensionRecord(value: unknown, targetDirectory: string): Record<string, unknown> | null {
	const relativeLocation = getExtensionRelativeLocation(value);
	if (!relativeLocation || !isRecord(value)) {
		return null;
	}
	const targetPath = join(targetDirectory, relativeLocation);
	return {
		...value,
		location: {
			$mid: 1,
			fsPath: targetPath,
			external: pathToFileURL(targetPath).href,
			path: targetPath,
			scheme: "file",
		},
	};
}

async function synchronizeExtensionRegistry(options: {
	sourceDirectory: string;
	targetDirectory: string;
	previouslySynchronized: Set<string>;
}): Promise<void> {
	const sourceValue = await readJsoncValue(join(options.sourceDirectory, "extensions.json"));
	if (!Array.isArray(sourceValue)) {
		return;
	}
	const desktopRecords = sourceValue
		.map((entry) => relocateExtensionRecord(entry, options.targetDirectory))
		.filter((entry): entry is Record<string, unknown> => entry !== null);
	const targetManifestPath = join(options.targetDirectory, "extensions.json");
	const targetValue = await readJsoncValue(targetManifestPath);
	const inlineRecords = Array.isArray(targetValue)
		? targetValue.filter((entry) => {
				const relativeLocation = getExtensionRelativeLocation(entry);
				return relativeLocation !== null && !options.previouslySynchronized.has(relativeLocation);
			})
		: [];
	await writeFile(targetManifestPath, JSON.stringify([...inlineRecords, ...desktopRecords]), "utf8");
}

export function resolveVsCodeDesktopProfilePaths(
	homeDirectory = homedir(),
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): VsCodeDesktopProfilePaths {
	const settingsPath =
		env.KANBAN_VSCODE_DESKTOP_SETTINGS_PATH?.trim() ||
		(platform === "darwin"
			? join(homeDirectory, "Library", "Application Support", "Code", "User", "settings.json")
			: platform === "win32"
				? join(env.APPDATA?.trim() || join(homeDirectory, "AppData", "Roaming"), "Code", "User", "settings.json")
				: join(homeDirectory, ".config", "Code", "User", "settings.json"));
	return {
		settingsPath,
		extensionsDirectory:
			env.KANBAN_VSCODE_DESKTOP_EXTENSIONS_DIR?.trim() || join(homeDirectory, ".vscode", "extensions"),
	};
}

async function prepareConfigurationDefaults(desktopSettingsPath: string): Promise<Record<string, unknown>> {
	const desktopSettings = await readJsoncObject(desktopSettingsPath);
	return {
		...(desktopSettings ?? {}),
		"security.workspace.trust.enabled": false,
		"workbench.secondarySideBar.defaultVisibility": "hidden",
		"workbench.startupEditor": "none",
	};
}

async function synchronizeExtensions(serverDataDirectory: string, sourceDirectory: string): Promise<void> {
	const extensionDirectories = await listExtensionDirectories(sourceDirectory);
	if (extensionDirectories.length === 0) {
		return;
	}

	const targetDirectory = join(serverDataDirectory, "extensions");
	const statePath = join(targetDirectory, EXTENSION_SYNC_STATE_FILENAME);
	await mkdir(targetDirectory, { recursive: true });
	const previousState = await readExtensionSyncState(statePath);
	const targetEntries = new Set(await readdir(targetDirectory));

	for (const extensionDirectory of extensionDirectories) {
		if (targetEntries.has(extensionDirectory)) {
			continue;
		}
		await copyExtensionDirectory(
			join(sourceDirectory, extensionDirectory),
			join(targetDirectory, extensionDirectory),
		);
	}

	if (previousState?.sourceDirectory === sourceDirectory) {
		const currentExtensions = new Set(extensionDirectories);
		for (const staleDirectory of previousState.extensionDirectories) {
			if (!currentExtensions.has(staleDirectory)) {
				await rm(join(targetDirectory, staleDirectory), { recursive: true, force: true });
			}
		}
	}
	await synchronizeExtensionRegistry({
		sourceDirectory,
		targetDirectory,
		previouslySynchronized: new Set(previousState?.extensionDirectories ?? []),
	});

	const state: ExtensionSyncState = { sourceDirectory, extensionDirectories };
	await writeFile(statePath, `${JSON.stringify(state, null, "\t")}\n`, "utf8");
}

export async function prepareVsCodeWebProfile(
	options: PrepareVsCodeWebProfileOptions,
): Promise<PreparedVsCodeWebProfile> {
	const profile = resolveVsCodeDesktopProfilePaths(options.homeDirectory, options.platform, options.env);
	const configurationDefaults = await prepareConfigurationDefaults(profile.settingsPath);
	await synchronizeExtensions(options.serverDataDirectory, profile.extensionsDirectory);
	return { configurationDefaults };
}
