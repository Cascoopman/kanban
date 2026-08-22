import { request as createHttpRequest, createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { Duplex } from "node:stream";

import {
	DEFAULT_VSCODE_COLOR_THEME,
	isSupportedVsCodeColorTheme,
	VSCODE_COLOR_THEME_QUERY_PARAMETER,
	type VsCodeColorTheme,
} from "../core/theme-appearance";

const WORKBENCH_CONFIGURATION_META_PATTERN =
	/(<meta id="vscode-workbench-web-configuration" data-settings=")([^"]*)(">)/u;

export interface VsCodeWebProxy {
	port: number;
	close: () => Promise<void>;
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

function encodeHtmlAttribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function customizeVsCodeWorkbenchHtml(options: {
	html: string;
	upstreamAuthority: string;
	publicAuthority: string;
	configurationDefaults: Record<string, unknown>;
	colorTheme?: VsCodeColorTheme;
}): string {
	return options.html.replace(
		WORKBENCH_CONFIGURATION_META_PATTERN,
		(match, prefix: string, encodedSettings: string, suffix: string) => {
			try {
				const upstreamConfiguration: unknown = JSON.parse(decodeHtmlAttribute(encodedSettings));
				if (!isRecord(upstreamConfiguration)) {
					return match;
				}
				const rewrittenConfiguration: unknown = JSON.parse(
					JSON.stringify(upstreamConfiguration).replaceAll(options.upstreamAuthority, options.publicAuthority),
				);
				if (!isRecord(rewrittenConfiguration)) {
					return match;
				}
				const existingDefaults = isRecord(rewrittenConfiguration.configurationDefaults)
					? rewrittenConfiguration.configurationDefaults
					: {};
				rewrittenConfiguration.configurationDefaults = {
					...existingDefaults,
					...options.configurationDefaults,
					"workbench.colorTheme": options.colorTheme ?? DEFAULT_VSCODE_COLOR_THEME,
					"workbench.secondarySideBar.defaultVisibility": "hidden",
					"workbench.startupEditor": "none",
				};
				rewrittenConfiguration.defaultLayout = {
					force: true,
					views: [{ id: "workbench.view.explorer" }],
					editors: [],
				};
				return `${prefix}${encodeHtmlAttribute(JSON.stringify(rewrittenConfiguration))}${suffix}`;
			} catch {
				return match;
			}
		},
	);
}

function getRequestedColorTheme(url: string | undefined): VsCodeColorTheme {
	if (!url) {
		return DEFAULT_VSCODE_COLOR_THEME;
	}
	try {
		const requestedTheme = new URL(url, "http://localhost").searchParams.get(VSCODE_COLOR_THEME_QUERY_PARAMETER);
		return isSupportedVsCodeColorTheme(requestedTheme) ? requestedTheme : DEFAULT_VSCODE_COLOR_THEME;
	} catch {
		return DEFAULT_VSCODE_COLOR_THEME;
	}
}

function isWorkbenchDocumentRequest(url: string | undefined): boolean {
	if (!url) {
		return false;
	}
	try {
		const pathname = new URL(url, "http://localhost").pathname;
		return pathname === "/vscode" || pathname === "/vscode/";
	} catch {
		return false;
	}
}

function proxyHttpRequest(options: {
	request: IncomingMessage;
	response: ServerResponse;
	upstreamPort: number;
	publicAuthority: string;
	configurationDefaults: Record<string, unknown>;
}): void {
	const upstreamAuthority = `127.0.0.1:${options.upstreamPort}`;
	const headers = { ...options.request.headers, host: upstreamAuthority };
	if (isWorkbenchDocumentRequest(options.request.url)) {
		delete headers["accept-encoding"];
	}

	const upstreamRequest = createHttpRequest(
		{
			host: "127.0.0.1",
			port: options.upstreamPort,
			path: options.request.url,
			method: options.request.method,
			headers,
		},
		(upstreamResponse) => {
			const contentType = upstreamResponse.headers["content-type"];
			if (!contentType?.includes("text/html")) {
				options.response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
				upstreamResponse.pipe(options.response);
				return;
			}

			const chunks: Buffer[] = [];
			upstreamResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
			upstreamResponse.on("end", () => {
				const html = customizeVsCodeWorkbenchHtml({
					html: Buffer.concat(chunks).toString("utf8"),
					upstreamAuthority,
					publicAuthority: options.publicAuthority,
					configurationDefaults: options.configurationDefaults,
					colorTheme: getRequestedColorTheme(options.request.url),
				});
				const responseHeaders = { ...upstreamResponse.headers };
				delete responseHeaders["content-encoding"];
				delete responseHeaders["content-length"];
				delete responseHeaders["transfer-encoding"];
				options.response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
				options.response.end(html);
			});
			upstreamResponse.on("error", () => options.response.destroy());
		},
	);
	upstreamRequest.on("error", () => {
		if (!options.response.headersSent) {
			options.response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
		}
		options.response.end("VS Code Web is unavailable.");
	});
	options.request.pipe(upstreamRequest);
}

function proxyWebSocketUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, upstreamPort: number): void {
	const upstreamSocket = new Socket();
	upstreamSocket.connect(upstreamPort, "127.0.0.1", () => {
		const requestLine = `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
		const headers: string[] = [];
		for (let index = 0; index < request.rawHeaders.length; index += 2) {
			const name = request.rawHeaders[index];
			const originalValue = request.rawHeaders[index + 1];
			if (!name || originalValue === undefined) {
				continue;
			}
			const value = name.toLowerCase() === "host" ? `127.0.0.1:${upstreamPort}` : originalValue;
			headers.push(`${name}: ${value}`);
		}
		upstreamSocket.write(`${requestLine}${headers.join("\r\n")}\r\n\r\n`);
		if (head.length > 0) {
			upstreamSocket.write(head);
		}
		socket.pipe(upstreamSocket).pipe(socket);
	});
	upstreamSocket.on("error", () => socket.destroy());
	socket.on("error", () => upstreamSocket.destroy());
}

export async function startVsCodeWebProxy(options: {
	upstreamPort: number;
	configurationDefaults: Record<string, unknown>;
}): Promise<VsCodeWebProxy> {
	let port = 0;
	const sockets = new Set<Duplex>();
	const server = createServer((request, response) => {
		proxyHttpRequest({
			request,
			response,
			upstreamPort: options.upstreamPort,
			publicAuthority: request.headers.host ?? `127.0.0.1:${port}`,
			configurationDefaults: options.configurationDefaults,
		});
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	server.on("upgrade", (request, socket, head) => {
		proxyWebSocketUpgrade(request, socket, head, options.upstreamPort);
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("Could not start the VS Code Web proxy."));
				return;
			}
			port = address.port;
			resolve();
		});
	});

	return {
		port,
		close: async () => {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
