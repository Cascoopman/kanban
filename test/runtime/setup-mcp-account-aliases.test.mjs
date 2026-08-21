import { describe, expect, it } from "vitest";
import {
	MCP_ACCOUNT_ALIASES,
	parseArguments,
	setupMcpAccountAliases,
} from "../../.agents/skills/mac-agent-setup/scripts/setup-mcp-account-aliases.mjs";

function createRunner(responses = new Map()) {
	const calls = [];
	const invocations = [];
	const run = (command, args, options) => {
		const key = [command, ...args].join(" ");
		calls.push(key);
		invocations.push({ key, options });
		return responses.get(key) ?? { status: 0, stdout: "", stderr: "" };
	};
	return { calls, invocations, run };
}

function missingAliasResponses(client) {
	return new Map(
		MCP_ACCOUNT_ALIASES[client].map((alias) => [
			`${client} mcp get ${alias.name}`,
			{ status: 1, stdout: "", stderr: "missing" },
		]),
	);
}

describe("setup MCP account aliases", () => {
	it("uses the established Codex and Claude alias names", () => {
		expect(MCP_ACCOUNT_ALIASES.codex.map((alias) => alias.name)).toEqual([
			"notion",
			"notion_personal",
			"linear_work",
			"linear_personal",
		]);
		expect(MCP_ACCOUNT_ALIASES.claude.map((alias) => alias.name)).toEqual([
			"notion_work",
			"notion_personal",
			"linear_work",
			"linear_personal",
		]);
	});

	it("adds missing aliases for both clients and disables the duplicate Claude Notion plugin", () => {
		const responses = new Map([
			...missingAliasResponses("codex"),
			...missingAliasResponses("claude"),
			[
				"claude plugin list",
				{
					status: 0,
					stdout: "notion@claude-plugins-official\n  Status: ✔ enabled\n",
					stderr: "",
				},
			],
		]);
		const runner = createRunner(responses);

		setupMcpAccountAliases(
			{
				client: "both",
				dryRun: false,
				replace: false,
				login: false,
				keepClaudeNotionPlugin: false,
			},
			{ run: runner.run, log: () => undefined },
		);

		expect(runner.calls).toContain(
			"claude plugin disable notion@claude-plugins-official --scope user",
		);
		expect(runner.calls).toContain(
			"codex mcp add notion_personal --url https://mcp.notion.com/mcp",
		);
		expect(runner.calls).toContain(
			"claude mcp add --scope user --transport http linear_work https://mcp.linear.app/mcp",
		);
	});

	it("keeps matching and custom aliases unless replacement is requested", () => {
		const responses = missingAliasResponses("codex");
		responses.set("codex mcp get notion", {
			status: 0,
			stdout: "notion\n  url: https://mcp.notion.com/mcp\n",
			stderr: "",
		});
		responses.set("codex mcp get linear_work", {
			status: 0,
			stdout: "linear_work\n  url: https://gateway.example/mcp\n",
			stderr: "",
		});
		const runner = createRunner(responses);
		const messages = [];

		setupMcpAccountAliases(
			{
				client: "codex",
				dryRun: false,
				replace: false,
				login: false,
				keepClaudeNotionPlugin: false,
			},
			{ run: runner.run, log: (message) => messages.push(message) },
		);

		expect(runner.calls).not.toContain("codex mcp remove linear_work");
		expect(runner.calls).not.toContain(
			"codex mcp add notion --url https://mcp.notion.com/mcp",
		);
		expect(messages).toContain(
			"Keeping custom codex linear_work (https://gateway.example/mcp); use --replace to change it to https://mcp.linear.app/mcp.",
		);
	});

	it("supports dry-run replacement without mutating configuration", () => {
		const responses = missingAliasResponses("claude");
		responses.set("claude plugin list", { status: 0, stdout: "", stderr: "" });
		responses.set("claude mcp get notion_work", {
			status: 0,
			stdout: "notion_work:\n  URL: https://old.example/mcp\n",
			stderr: "",
		});
		const runner = createRunner(responses);
		const messages = [];

		setupMcpAccountAliases(
			{
				client: "claude",
				dryRun: true,
				replace: true,
				login: false,
				keepClaudeNotionPlugin: false,
			},
			{ run: runner.run, log: (message) => messages.push(message) },
		);

		expect(runner.calls).not.toContain("claude mcp remove --scope user notion_work");
		expect(messages).toContain("Would run: claude mcp remove --scope user notion_work");
		expect(messages).toContain(
			"Would run: claude mcp add --scope user --transport http notion_work https://mcp.notion.com/mcp",
		);
	});

	it("does not disable an already disabled Notion plugin when another plugin is enabled", () => {
		const responses = missingAliasResponses("claude");
		responses.set("claude plugin list", {
			status: 0,
			stdout: [
				"  ❯ notion@claude-plugins-official",
				"    Status: ✘ disabled",
				"",
				"  ❯ slack@claude-plugins-official",
				"    Status: ✔ enabled",
			].join("\n"),
			stderr: "",
		});
		const runner = createRunner(responses);

		setupMcpAccountAliases(
			{
				client: "claude",
				dryRun: false,
				replace: false,
				login: false,
				keepClaudeNotionPlugin: false,
			},
			{ run: runner.run, log: () => undefined },
		);

		expect(runner.calls).not.toContain(
			"claude plugin disable notion@claude-plugins-official --scope user",
		);
	});

	it("passes OAuth login through as an interactive subprocess", () => {
		const responses = new Map([
			...MCP_ACCOUNT_ALIASES.claude.map((alias) => [
				`claude mcp get ${alias.name}`,
				{
					status: 0,
					stdout: `${alias.name}:\n  URL: ${alias.url}\n`,
					stderr: "",
				},
			]),
			["claude plugin list", { status: 0, stdout: "", stderr: "" }],
		]);
		const runner = createRunner(responses);
		const messages = [];

		setupMcpAccountAliases(
			{
				client: "claude",
				dryRun: false,
				replace: false,
				login: true,
				keepClaudeNotionPlugin: false,
			},
			{ run: runner.run, log: (message) => messages.push(message) },
		);

		const loginInvocations = runner.invocations.filter(({ key }) => key.includes(" mcp login "));
		expect(loginInvocations).toHaveLength(4);
		expect(loginInvocations.map(({ key }) => key)).toEqual([
			"claude mcp login --no-browser notion_work",
			"claude mcp login --no-browser notion_personal",
			"claude mcp login --no-browser linear_work",
			"claude mcp login --no-browser linear_personal",
		]);
		expect(loginInvocations.every(({ options }) => options?.interactive === true)).toBe(true);
		expect(messages).toContain(
			"1. Copy the authorization URL printed below into your work browser profile.",
		);
		expect(messages).toContain(
			"1. Copy the authorization URL printed below into your personal browser profile.",
		);
	});

	it("parses client and safety options", () => {
		expect(
			parseArguments([
				"--client",
				"claude",
				"--dry-run",
				"--replace",
				"--login",
				"--keep-claude-notion-plugin",
			]),
		).toMatchObject({
			client: "claude",
			dryRun: true,
			replace: true,
			login: true,
			keepClaudeNotionPlugin: true,
		});
	});
});
