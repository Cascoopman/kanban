import { describe, expect, it } from "vitest";

import { customizeVsCodeWorkbenchHtml } from "../../src/server/vscode-web-proxy";

function encodeHtmlAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function readWorkbenchConfiguration(html: string): Record<string, unknown> {
	const encoded = /data-settings="([^"]*)"/u.exec(html)?.[1];
	if (!encoded) {
		throw new Error("Workbench configuration was not found.");
	}
	return JSON.parse(encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&")) as Record<string, unknown>;
}

describe("VS Code Web proxy", () => {
	it("forces a clean initial layout while preserving manual access to registered views", () => {
		const upstreamAuthority = "127.0.0.1:41001";
		const publicAuthority = "127.0.0.1:41002";
		const configuration = {
			remoteAuthority: upstreamAuthority,
			folderUri: { scheme: "vscode-remote", authority: upstreamAuthority, path: "/tmp/project" },
			configurationDefaults: { "editor.fontSize": 13 },
		};
		const html = `<meta id="vscode-workbench-web-configuration" data-settings="${encodeHtmlAttribute(JSON.stringify(configuration))}">`;

		const customized = customizeVsCodeWorkbenchHtml({
			html,
			upstreamAuthority,
			publicAuthority,
			configurationDefaults: { "editor.fontSize": 15 },
		});
		const result = readWorkbenchConfiguration(customized);

		expect(result.remoteAuthority).toBe(publicAuthority);
		expect(result.folderUri).toEqual({
			scheme: "vscode-remote",
			authority: publicAuthority,
			path: "/tmp/project",
		});
		expect(result.configurationDefaults).toEqual({
			"editor.fontSize": 15,
			"workbench.secondarySideBar.defaultVisibility": "hidden",
			"workbench.startupEditor": "none",
		});
		expect(result.defaultLayout).toEqual({
			force: true,
			views: [{ id: "workbench.view.explorer" }],
			editors: [],
		});
	});

	it("leaves unexpected HTML unchanged", () => {
		const html = "<html><body>VS Code</body></html>";
		expect(
			customizeVsCodeWorkbenchHtml({
				html,
				upstreamAuthority: "127.0.0.1:41001",
				publicAuthority: "127.0.0.1:41002",
				configurationDefaults: {},
			}),
		).toBe(html);
	});
});
