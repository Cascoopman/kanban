#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";
const CLAUDE_NOTION_PLUGIN = "notion@claude-plugins-official";

export const MCP_ACCOUNT_ALIASES = {
	codex: [
		{ name: "notion", url: NOTION_MCP_URL },
		{ name: "notion_personal", url: NOTION_MCP_URL },
		{ name: "linear_work", url: LINEAR_MCP_URL },
		{ name: "linear_personal", url: LINEAR_MCP_URL },
	],
	claude: [
		{ name: "notion_work", url: NOTION_MCP_URL },
		{ name: "notion_personal", url: NOTION_MCP_URL },
		{ name: "linear_work", url: LINEAR_MCP_URL },
		{ name: "linear_personal", url: LINEAR_MCP_URL },
	],
};

function usage() {
	return `Usage: setup-mcp-account-aliases.mjs [options]

Configure work and personal Notion and Linear aliases in Codex and Claude Code.

Options:
  --client <both|codex|claude>   Configure both clients or only one (default: both)
  --dry-run                      Inspect and print changes without writing configuration
  --replace                      Replace aliases whose configured URL differs
  --login                        Run OAuth login for aliases using the expected URL
  --keep-claude-notion-plugin    Keep Claude's official single-account Notion plugin enabled
  -h, --help                     Show this help
`;
}

export function parseArguments(argv) {
	const options = {
		client: "both",
		dryRun: false,
		replace: false,
		login: false,
		keepClaudeNotionPlugin: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		switch (argument) {
			case "--client": {
				const client = argv[index + 1];
				if (!client || !["both", "codex", "claude"].includes(client)) {
					throw new Error("--client must be one of: both, codex, claude");
				}
				options.client = client;
				index += 1;
				break;
			}
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--replace":
				options.replace = true;
				break;
			case "--login":
				options.login = true;
				break;
			case "--keep-claude-notion-plugin":
				options.keepClaudeNotionPlugin = true;
				break;
			case "-h":
			case "--help":
				options.help = true;
				break;
			default:
				throw new Error(`Unknown argument: ${argument}`);
		}
	}

	return options;
}

function runProcess(command, args) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "pipe"],
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		error: result.error,
	};
}

function formatCommand(command, args) {
	return [command, ...args]
		.map((part) => (/^[A-Za-z0-9_./:=@-]+$/u.test(part) ? part : JSON.stringify(part)))
		.join(" ");
}

function runRequired(run, command, args) {
	const result = run(command, args);
	if (result.status !== 0) {
		const detail = [result.stderr, result.stdout].find((value) => value.trim().length > 0)?.trim();
		throw new Error(`${formatCommand(command, args)} failed${detail ? `: ${detail}` : ""}`);
	}
	return result;
}

function configuredUrl(output) {
	return output.match(/^\s*(?:url|URL):\s*(\S+)\s*$/imu)?.[1] ?? null;
}

function normalizedUrl(url) {
	return url.replace(/\/+$/u, "");
}

function aliasesForClient(client) {
	return client === "both" ? ["codex", "claude"] : [client];
}

function addArguments(client, alias) {
	if (client === "codex") {
		return ["mcp", "add", alias.name, "--url", alias.url];
	}
	return ["mcp", "add", "--scope", "user", "--transport", "http", alias.name, alias.url];
}

function removeArguments(client, aliasName) {
	if (client === "codex") {
		return ["mcp", "remove", aliasName];
	}
	return ["mcp", "remove", "--scope", "user", aliasName];
}

function logMutation({ dryRun, log, run }, command, args) {
	log(`${dryRun ? "Would run" : "Running"}: ${formatCommand(command, args)}`);
	if (!dryRun) {
		runRequired(run, command, args);
	}
}

function ensureAlias(client, alias, context) {
	const existing = context.run(client, ["mcp", "get", alias.name]);
	if (existing.status !== 0) {
		logMutation(context, client, addArguments(client, alias));
		return true;
	}

	const currentUrl = configuredUrl(existing.stdout);
	if (currentUrl && normalizedUrl(currentUrl) === normalizedUrl(alias.url)) {
		context.log(`Keeping ${client} ${alias.name}: ${currentUrl}`);
		return true;
	}

	const currentDescription = currentUrl ?? "an unrecognized configuration";
	if (!context.replace) {
		context.log(
			`Keeping custom ${client} ${alias.name} (${currentDescription}); use --replace to change it to ${alias.url}.`,
		);
		return false;
	}

	logMutation(context, client, removeArguments(client, alias.name));
	logMutation(context, client, addArguments(client, alias));
	return true;
}

function disableClaudeNotionPlugin(context) {
	if (context.keepClaudeNotionPlugin) {
		return;
	}
	const result = context.run("claude", ["plugin", "list"]);
	if (result.status !== 0 || !result.stdout.includes(CLAUDE_NOTION_PLUGIN)) {
		return;
	}
	const pluginStart = result.stdout.indexOf(CLAUDE_NOTION_PLUGIN);
	const nextPluginStart = result.stdout.indexOf("\n\n  ❯ ", pluginStart);
	const pluginSection = result.stdout.slice(
		pluginStart,
		nextPluginStart === -1 ? undefined : nextPluginStart,
	);
	if (!/^\s*Status:\s*.*enabled\s*$/imu.test(pluginSection)) {
		return;
	}
	logMutation(context, "claude", ["plugin", "disable", CLAUDE_NOTION_PLUGIN, "--scope", "user"]);
}

export function setupMcpAccountAliases(options, dependencies = {}) {
	const run = dependencies.run ?? runProcess;
	const log = dependencies.log ?? console.log;
	const context = { ...options, run, log };
	const clients = aliasesForClient(options.client);
	const loginTargets = [];

	for (const client of clients) {
		const version = run(client, ["--version"]);
		if (version.status !== 0) {
			throw new Error(`${client} CLI is not installed or not available on PATH`);
		}
		let claudeNotionAliasesReady = true;
		for (const alias of MCP_ACCOUNT_ALIASES[client]) {
			const aliasReady = ensureAlias(client, alias, context);
			if (aliasReady) {
				loginTargets.push({ client, name: alias.name });
			}
			if (client === "claude" && alias.name.startsWith("notion") && !aliasReady) {
				claudeNotionAliasesReady = false;
			}
		}
		if (client === "claude" && claudeNotionAliasesReady) {
			disableClaudeNotionPlugin(context);
		}
	}

	if (options.login) {
		for (const target of loginTargets) {
			logMutation(context, target.client, ["mcp", "login", target.name]);
		}
		return;
	}

	if (loginTargets.length > 0) {
		log("\nAuthenticate any alias that is not already connected:");
		for (const target of loginTargets) {
			log(`  ${target.client} mcp login ${target.name}`);
		}
	}
}

async function main() {
	try {
		const options = parseArguments(process.argv.slice(2));
		if (options.help) {
			process.stdout.write(usage());
			return;
		}
		setupMcpAccountAliases(options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${message}\n\n${usage()}`);
		process.exitCode = 1;
	}
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
	await main();
}
