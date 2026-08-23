import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { quoteShellArg } from "./shell";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const OPENSSH_VARIANT = "ssh";
const CONTROL_PERSIST_DURATION = "8h";
const CONTROL_SCOPE_HASH_LENGTH = 16;
const UNSUPPORTED_SSH_COMMAND_PATTERN = /(?:^|[\\/])(plink|tortoiseplink)(?:\.exe)?(?:\s|$)/iu;

interface GitSshMultiplexingState {
	controlDirectory: string;
}

interface GitSshProjectProfile {
	configuredCommand: string | null;
	configuredVariant: string | null;
}

let state: GitSshMultiplexingState | null = null;
const projectProfileByCwd = new Map<string, Promise<GitSshProjectProfile>>();

export function initializeGitSshMultiplexing(): boolean {
	if (process.platform === "win32") {
		return false;
	}
	if (state) {
		return true;
	}

	const temporaryRoot = existsSync("/tmp") ? "/tmp" : process.cwd();
	// Keep this prefix extremely short. OpenSSH appends a temporary suffix while
	// creating a control socket, and macOS limits Unix socket paths to 103 bytes.
	// The directory is already uniquely and securely created by mkdtemp, so a
	// process ID and a descriptive prefix only consume scarce pathname space.
	const controlDirectory = mkdtempSync(join(temporaryRoot, "k"));
	chmodSync(controlDirectory, 0o700);
	state = { controlDirectory };
	return true;
}

export function isGitSshMultiplexingActive(): boolean {
	return state !== null;
}

function createControlScopeHash(baseCommand: string, env: NodeJS.ProcessEnv): string {
	return createHash("sha256")
		.update(baseCommand)
		.update("\0")
		.update(env.SSH_AUTH_SOCK?.trim() ?? "")
		.digest("hex")
		.slice(0, CONTROL_SCOPE_HASH_LENGTH);
}

export function buildMultiplexedGitSshCommand(
	configuredCommand: string | null,
	env: NodeJS.ProcessEnv,
	configuredVariant: string | null = null,
): string | null {
	if (!state) {
		return null;
	}

	const resolvedVariant = env.GIT_SSH_VARIANT?.trim().toLowerCase() || configuredVariant?.trim().toLowerCase();
	if (resolvedVariant && resolvedVariant !== OPENSSH_VARIANT) {
		return null;
	}

	const environmentCommand = env.GIT_SSH_COMMAND?.trim();
	const environmentBinary = env.GIT_SSH?.trim();
	const baseCommand =
		environmentCommand || (environmentBinary ? quoteShellArg(environmentBinary) : configuredCommand) || "ssh";
	if (UNSUPPORTED_SSH_COMMAND_PATTERN.test(baseCommand)) {
		return null;
	}

	const scopeHash = createControlScopeHash(baseCommand, env);
	// %C separates effective host/user/port/proxy-jump combinations. %k also
	// keeps SSH Host aliases distinct when several accounts target one provider.
	// The command and agent hash lets repositories using the same account reuse
	// startup authentication without crossing account configurations.
	const controlPath = quoteShellArg(join(state.controlDirectory, `${scopeHash}-%C-%k`));
	return [
		baseCommand,
		"-o ControlMaster=auto",
		`-o ControlPersist=${CONTROL_PERSIST_DURATION}`,
		`-o ControlPath=${controlPath}`,
	].join(" ");
}

async function readGitConfigValue(cwd: string, key: string, env: NodeJS.ProcessEnv): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["config", "--get", key], {
			cwd,
			encoding: "utf8",
			maxBuffer: GIT_MAX_BUFFER_BYTES,
			env,
		});
		return String(stdout ?? "").trim() || null;
	} catch {
		return null;
	}
}

async function readProjectProfile(cwd: string, env: NodeJS.ProcessEnv): Promise<GitSshProjectProfile> {
	const cacheKey = resolve(cwd);
	const existing = projectProfileByCwd.get(cacheKey);
	if (existing) {
		return await existing;
	}

	const profile = (async () => {
		const [configuredCommand, configuredVariant] = await Promise.all([
			readGitConfigValue(cwd, "core.sshCommand", env),
			readGitConfigValue(cwd, "ssh.variant", env),
		]);
		return {
			configuredCommand,
			configuredVariant,
		};
	})();
	projectProfileByCwd.set(cacheKey, profile);
	return await profile;
}

export async function applyGitSshMultiplexing(cwd: string, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
	if (!state) {
		return env;
	}

	const profile = await readProjectProfile(cwd, env);
	const hasEnvironmentCommand = Boolean(env.GIT_SSH_COMMAND?.trim() || env.GIT_SSH?.trim());
	const multiplexedCommand = buildMultiplexedGitSshCommand(
		hasEnvironmentCommand ? null : profile.configuredCommand,
		env,
		profile.configuredVariant,
	);
	if (!multiplexedCommand) {
		return env;
	}
	return {
		...env,
		GIT_SSH_COMMAND: multiplexedCommand,
		GIT_SSH_VARIANT: OPENSSH_VARIANT,
	};
}

export async function closeGitSshMultiplexing(): Promise<void> {
	const currentState = state;
	state = null;
	projectProfileByCwd.clear();
	if (!currentState) {
		return;
	}

	try {
		const entries = await readdir(currentState.controlDirectory);
		await Promise.all(
			entries.map(async (entry) => {
				try {
					await execFileAsync(
						"ssh",
						["-S", join(currentState.controlDirectory, entry), "-O", "exit", "kanban.invalid"],
						{ timeout: 2_000 },
					);
				} catch {
					// A stale socket or an already-closed master does not need cleanup.
				}
			}),
		);
	} finally {
		await rm(currentState.controlDirectory, { recursive: true, force: true });
	}
}
