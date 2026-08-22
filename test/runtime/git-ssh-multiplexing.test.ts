import { afterEach, describe, expect, it } from "vitest";

import {
	buildMultiplexedGitSshCommand,
	closeGitSshMultiplexing,
	initializeGitSshMultiplexing,
} from "../../src/core/git-ssh-multiplexing";

describe("Git SSH multiplexing", () => {
	afterEach(async () => {
		await closeGitSshMultiplexing();
	});

	it.runIf(process.platform !== "win32")("adds an app-scoped persistent OpenSSH control connection", () => {
		expect(initializeGitSshMultiplexing()).toBe(true);
		const command = buildMultiplexedGitSshCommand("ssh -i ~/.ssh/work", {}, "/repos/work/.git");

		expect(command).toContain("ssh -i ~/.ssh/work");
		expect(command).toContain("ControlMaster=auto");
		expect(command).toContain("ControlPersist=8h");
		expect(command).toContain("ControlPath=");
		expect(command).toContain("%C-%k");
		expect(command).not.toContain("/repos/work/.git");
	});

	it.runIf(process.platform !== "win32")("isolates control sockets by project and SSH command", () => {
		expect(initializeGitSshMultiplexing()).toBe(true);
		const workCommand = buildMultiplexedGitSshCommand("ssh -i ~/.ssh/work", {}, "/repos/work/.git");
		const personalCommand = buildMultiplexedGitSshCommand("ssh -i ~/.ssh/personal", {}, "/repos/personal/.git");
		const otherProjectCommand = buildMultiplexedGitSshCommand("ssh -i ~/.ssh/work", {}, "/repos/other/.git");
		const otherAgentCommand = buildMultiplexedGitSshCommand(
			"ssh -i ~/.ssh/work",
			{ SSH_AUTH_SOCK: "/tmp/other-agent.sock" },
			"/repos/work/.git",
		);

		expect(personalCommand).not.toBe(workCommand);
		expect(otherProjectCommand).not.toBe(workCommand);
		expect(otherAgentCommand).not.toBe(workCommand);
	});

	it.runIf(process.platform !== "win32")("does not add OpenSSH options to a configured PuTTY transport", () => {
		expect(initializeGitSshMultiplexing()).toBe(true);

		expect(buildMultiplexedGitSshCommand("plink.exe", { GIT_SSH_VARIANT: "plink" }, "/repos/work/.git")).toBeNull();
	});
});
