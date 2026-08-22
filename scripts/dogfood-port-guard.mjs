import { connect } from "node:net";

export function parseFixedRuntimePort(value) {
	if (!/^\d+$/.test(value)) {
		return null;
	}
	const port = Number.parseInt(value, 10);
	return port >= 1 && port <= 65_535 ? port : null;
}

export function isTcpPortReachable(port, options = {}) {
	const host = options.host ?? "127.0.0.1";
	const timeoutMs = options.timeoutMs ?? 500;

	return new Promise((resolve) => {
		const socket = connect({ host, port });
		let settled = false;
		const finish = (reachable) => {
			if (settled) {
				return;
			}
			settled = true;
			socket.destroy();
			resolve(reachable);
		};

		socket.setTimeout(timeoutMs);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(false));
		socket.once("error", () => finish(false));
	});
}
