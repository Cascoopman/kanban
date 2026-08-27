import { Command } from "commander";

import packageJson from "../package.json" with { type: "json" };
import { registerHooksCommand } from "./commands/hooks";

const KANBAN_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

async function main(): Promise<void> {
	const program = new Command()
		.name("kanban-hooks")
		.description("Internal Kanban runtime hook helpers.")
		.version(KANBAN_VERSION, "-v, --version", "Output the version number");
	registerHooksCommand(program, { standalone: true });
	await program.parseAsync(process.argv.slice(2), { from: "user" });
}

void main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Kanban hook helper failed: ${message}\n`);
	process.exitCode = 1;
});
