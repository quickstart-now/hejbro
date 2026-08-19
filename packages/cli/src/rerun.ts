const RENAME_FLAG_NAMES = new Set(["--rename", "--confirm-drop"]);

type ArgvPair = { readonly flag: string; readonly value: string };

/** Chunks `argv` into consecutive `[flag, value]` pairs — every flag `hejbro generate` accepts (`--config`, `--name`, `--rename`, `--confirm-drop`) takes exactly one value. */
const pairArgv = (argv: ReadonlyArray<string>): ReadonlyArray<ArgvPair> =>
	Array.from({ length: Math.floor(argv.length / 2) }, (_, index) => ({
		flag: argv[index * 2] ?? "",
		value: argv[index * 2 + 1] ?? "",
	}));

const isRenameFlagName = (flag: string): boolean => RENAME_FLAG_NAMES.has(flag);

const renderPair = (pair: ArgvPair): string => `${pair.flag} ${pair.value}`;

const stripFlagName = (flag: string): string => {
	const firstSpace = flag.indexOf(" ");
	if (firstSpace === -1) {
		return flag;
	}
	return flag.slice(firstSpace + 1);
};

/** The sortable "target identity" portion of a new flag string (`"--rename a.b.c=d"` → `"a.b.c"`, `"--confirm-drop a.b.c"` → `"a.b.c"`). */
const newFlagSortKey = (flag: string): string => {
	const value = stripFlagName(flag);
	const equalsIndex = value.indexOf("=");
	if (equalsIndex === -1) {
		return value;
	}
	return value.slice(0, equalsIndex);
};

/** `"hejbro generate"` alone, on one line with a single segment, or multi-line (` \\\n  `-joined) with 2+. */
const renderCommand = (segments: ReadonlyArray<string>): string => {
	if (segments.length === 0) {
		return "hejbro generate";
	}
	if (segments.length === 1) {
		return `hejbro generate ${segments[0]}`;
	}
	return `hejbro generate \\\n  ${segments.join(" \\\n  ")}`;
};

/**
 * Assembles the exact rerun command a rename/confirm-drop error suggests
 * (decision D32): the all-or-nothing rule — every non-rename arg from the
 * original `argv` in its original order, then the original run's
 * `--rename`/`--confirm-drop` flags in their original order, then
 * `newFlags` (each a complete `"--rename <spec>"`/`"--confirm-drop <spec>"`
 * string) sorted by target identity (byte order). Multi-flag results join
 * with `" \\\n  "` (shell line continuation); a single flag stays on one
 * line.
 */
export const assembleRerunCommand = (
	argv: ReadonlyArray<string>,
	newFlags: ReadonlyArray<string>,
): string => {
	const pairs = pairArgv(argv);
	const nonRenameSegments = pairs
		.filter((pair) => !isRenameFlagName(pair.flag))
		.map((pair) => renderPair(pair));
	const existingRenameSegments = pairs
		.filter((pair) => isRenameFlagName(pair.flag))
		.map((pair) => renderPair(pair));
	const sortedNewFlags = [...newFlags].sort((a, b) => {
		const keyA = newFlagSortKey(a);
		const keyB = newFlagSortKey(b);
		if (keyA < keyB) {
			return -1;
		}
		if (keyA > keyB) {
			return 1;
		}
		return 0;
	});
	return renderCommand([
		...nonRenameSegments,
		...existingRenameSegments,
		...sortedNewFlags,
	]);
};
