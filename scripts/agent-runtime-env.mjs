import { delimiter } from "node:path";

function normalizePathEntry(entry) {
	return entry
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+$/u, "")
		.toLowerCase();
}

export function stripLocalBinPathsFromPath(pathValue, localBinPaths) {
	if (typeof pathValue !== "string" || pathValue.length === 0) {
		return pathValue;
	}
	// Remove only this checkout's executable directory. Agent CLIs may
	// legitimately live in another node_modules/.bin, including an npx cache.
	const normalizedLocalBinPaths = new Set(localBinPaths.map(normalizePathEntry));
	return pathValue
		.split(delimiter)
		.filter((entry) => !normalizedLocalBinPaths.has(normalizePathEntry(entry)))
		.join(delimiter);
}

export function buildAgentRuntimeEnv(baseEnv, localBinPaths) {
	const runtimeEnv = { ...baseEnv };
	for (const key of Object.keys(runtimeEnv)) {
		if (key.toUpperCase() !== "PATH") {
			continue;
		}
		runtimeEnv[key] = stripLocalBinPathsFromPath(runtimeEnv[key], localBinPaths);
		break;
	}
	return runtimeEnv;
}
