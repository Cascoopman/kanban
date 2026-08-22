import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareVsCodeWebProfile, resolveVsCodeDesktopProfilePaths } from "../../src/server/vscode-web-profile";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "kanban-vscode-profile-"));
	temporaryDirectories.push(path);
	return path;
}

async function createExtension(directory: string, name: string): Promise<void> {
	const extensionDirectory = join(directory, name);
	await mkdir(extensionDirectory, { recursive: true });
	await writeFile(
		join(extensionDirectory, "package.json"),
		JSON.stringify({ name: name.split(".").at(-1), publisher: name.split(".")[0], version: "1.0.0" }),
	);
}

async function writeExtensionRegistry(directory: string, extensionDirectories: string[]): Promise<void> {
	await writeFile(
		join(directory, "extensions.json"),
		JSON.stringify(
			extensionDirectories.map((relativeLocation) => ({
				identifier: { id: relativeLocation.split("-")[0] },
				version: "1.0.0",
				location: { $mid: 1, path: join(directory, relativeLocation), scheme: "file" },
				relativeLocation,
			})),
		),
	);
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("VS Code Web profile", () => {
	it("resolves the desktop VS Code profile for each platform", () => {
		expect(resolveVsCodeDesktopProfilePaths("/Users/test", "darwin", {})).toEqual({
			settingsPath: "/Users/test/Library/Application Support/Code/User/settings.json",
			extensionsDirectory: "/Users/test/.vscode/extensions",
		});
		expect(resolveVsCodeDesktopProfilePaths("/home/test", "linux", {})).toEqual({
			settingsPath: "/home/test/.config/Code/User/settings.json",
			extensionsDirectory: "/home/test/.vscode/extensions",
		});
	});

	it("uses desktop settings as inline defaults while applying the clean workspace defaults", async () => {
		const root = await createTemporaryDirectory();
		const settingsPath = join(root, "desktop-settings.json");
		const extensionsDirectory = join(root, "desktop-extensions");
		const serverDataDirectory = join(root, "server");
		await mkdir(extensionsDirectory, { recursive: true });
		await writeFile(
			settingsPath,
			`{
				// Desktop preferences remain available inline.
				"editor.fontSize": 15,
				"security.workspace.trust.enabled": true,
			}`,
		);

		const profile = await prepareVsCodeWebProfile({
			serverDataDirectory,
			env: {
				KANBAN_VSCODE_DESKTOP_SETTINGS_PATH: settingsPath,
				KANBAN_VSCODE_DESKTOP_EXTENSIONS_DIR: extensionsDirectory,
			},
		});

		expect(profile.configurationDefaults).toEqual({
			"editor.fontSize": 15,
			"security.workspace.trust.enabled": false,
			"workbench.secondarySideBar.defaultVisibility": "hidden",
			"workbench.startupEditor": "none",
		});
	});

	it("mirrors desktop extensions without deleting extensions installed only inline", async () => {
		const root = await createTemporaryDirectory();
		const settingsPath = join(root, "desktop-settings.json");
		const extensionsDirectory = join(root, "desktop-extensions");
		const serverDataDirectory = join(root, "server");
		const targetExtensionsDirectory = join(serverDataDirectory, "extensions");
		await mkdir(extensionsDirectory, { recursive: true });
		await mkdir(targetExtensionsDirectory, { recursive: true });
		await writeFile(settingsPath, "{}");
		await createExtension(extensionsDirectory, "publisher.first-1.0.0");
		await createExtension(targetExtensionsDirectory, "inline.only-1.0.0");
		await writeExtensionRegistry(extensionsDirectory, ["publisher.first-1.0.0"]);
		await writeExtensionRegistry(targetExtensionsDirectory, ["inline.only-1.0.0"]);

		const options = {
			serverDataDirectory,
			env: {
				KANBAN_VSCODE_DESKTOP_SETTINGS_PATH: settingsPath,
				KANBAN_VSCODE_DESKTOP_EXTENSIONS_DIR: extensionsDirectory,
			},
		};
		await prepareVsCodeWebProfile(options);
		expect(await readdir(targetExtensionsDirectory)).toContain("publisher.first-1.0.0");

		await rm(join(extensionsDirectory, "publisher.first-1.0.0"), { recursive: true });
		await createExtension(extensionsDirectory, "publisher.second-1.0.0");
		await writeExtensionRegistry(extensionsDirectory, ["publisher.second-1.0.0"]);
		await prepareVsCodeWebProfile(options);

		const targetEntries = await readdir(targetExtensionsDirectory);
		expect(targetEntries).toContain("publisher.second-1.0.0");
		expect(targetEntries).toContain("inline.only-1.0.0");
		expect(targetEntries).not.toContain("publisher.first-1.0.0");
		const registry = JSON.parse(await readFile(join(targetExtensionsDirectory, "extensions.json"), "utf8")) as Array<{
			location: { path: string };
			relativeLocation: string;
		}>;
		expect(registry.map((entry) => entry.relativeLocation)).toEqual(["inline.only-1.0.0", "publisher.second-1.0.0"]);
		expect(registry[1]?.location.path).toBe(join(targetExtensionsDirectory, "publisher.second-1.0.0"));
	});
});
