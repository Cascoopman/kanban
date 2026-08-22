import { describe, expect, it } from "vitest";

import { buildVsCodeServerCommand } from "../../src/server/vscode-web-manager";

const commonOptions = {
	port: 41001,
	token: "secret-token",
	serverDataDirectory: "/tmp/kanban-vscode",
	workspacePath: "/tmp/project",
};

describe("VS Code Web manager", () => {
	it("runs the supported VS Code CLI serve-web command without standalone-only flags", () => {
		const command = buildVsCodeServerCommand({
			...commonOptions,
			launch: {
				executable: "/usr/local/bin/code",
				argumentPrefix: ["serve-web"],
				standalone: false,
			},
		});

		expect(command.executable).toBe("/usr/local/bin/code");
		expect(command.args[0]).toBe("serve-web");
		expect(command.args).not.toContain("--extensions-dir");
		expect(command.args).not.toContain("--user-data-dir");
		expect(command.args).not.toContain("--disable-workspace-trust");
		expect(command.args).toContain("--server-data-dir");
		expect(command.args).toContain("--accept-server-license-terms");
	});

	it("keeps standalone server options for an explicitly configured server executable", () => {
		const command = buildVsCodeServerCommand({
			...commonOptions,
			launch: {
				executable: "/usr/local/bin/code-server",
				argumentPrefix: [],
				standalone: true,
			},
		});

		expect(command.executable).toBe("/usr/local/bin/code-server");
		expect(command.args[0]).toBe("--host");
		expect(command.args).toContain("--extensions-dir");
		expect(command.args).toContain("--user-data-dir");
		expect(command.args).toContain("--disable-workspace-trust");
	});
});
