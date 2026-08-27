// Keep this aligned with `git rev-parse --local-env-vars`. Git hooks inherit
// these variables from the checkout that invoked them, so passing them to a
// Git subprocess for another workspace can redirect its index, object store,
// or work tree into the hook's checkout.
const GIT_REPOSITORY_ENV_KEYS = new Set([
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CONFIG",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_DIR",
	"GIT_COMMON_DIR",
	"GIT_GRAFT_FILE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_OBJECT_DIRECTORY",
	"GIT_PREFIX",
	"GIT_REPLACE_REF_BASE",
	"GIT_SHALLOW_FILE",
	"GIT_WORK_TREE",
]);

function isRepositoryScopedGitEnvironmentKey(key: string): boolean {
	return GIT_REPOSITORY_ENV_KEYS.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key);
}

export function createGitProcessEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const sanitized: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		// Prevent parent git hook context from hijacking repository-scoped git commands.
		if (isRepositoryScopedGitEnvironmentKey(key)) {
			continue;
		}
		sanitized[key] = value;
	}
	return {
		...sanitized,
		...overrides,
	};
}
