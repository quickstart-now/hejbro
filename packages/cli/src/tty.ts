/**
 * Shared terminal-capability checks (#130 spec §9, §7; R2-G7 7.2 reuses
 * the same explicit-flag-first, TTY-inferred-fallback pattern for
 * `vendor`'s own local/CI boundary). Every check here is re-evaluated
 * per call (not cached at module load) so a test can flip
 * `process.stdout.isTTY`/`process.env.NO_COLOR` between assertions
 * without needing to re-import the module.
 */

export const isInteractive = (): boolean => process.stdout.isTTY === true;

const noColorSet = (): boolean =>
	process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";

/**
 * `restore`'s own file-diff coloring: `true` only in an interactive
 * terminal with `NO_COLOR` unset (no override flag exists for this,
 * by design — spec §0's completion criterion 2 bans adding one).
 */
export const shouldUseColor = (): boolean => isInteractive() && !noColorSet();

export type LinkMode = "plain" | "osc8" | "none";

/**
 * `history`'s own `--links`/`--no-links` mode (§9): an explicit
 * `--links` always renders plain URL columns (a script piping `history`'s
 * output still gets real URLs); an explicit `--no-links` always renders
 * neither column nor inline hyperlink, even in an interactive terminal;
 * with neither flag, an interactive terminal with `NO_COLOR` unset gets
 * OSC8 hyperlinks embedded in the existing commit/date cell text (cell
 * text itself unchanged) — anything else (piped output, `NO_COLOR` set)
 * gets no links at all.
 */
export const shouldUseLinks = (flag: boolean | undefined): LinkMode => {
	if (flag === true) {
		return "plain";
	}
	if (flag === false) {
		return "none";
	}
	if (isInteractive() && !noColorSet()) {
		return "osc8";
	}
	return "none";
};

/**
 * `vendor`'s own local/CI boundary (R2-G7 7.2, members 10 and 11): an
 * explicit `--strict` always fails on the boundary; an explicit
 * `--no-strict` always only warns; with neither flag, a non-interactive
 * terminal (CI, or output piped to a file) fails by default — nobody is
 * watching to notice a warning scroll by — while an interactive terminal
 * only warns, since a developer sees it live and can act on it. Mirrors
 * {@link shouldUseLinks}'s explicit-flag-first, TTY-inferred-fallback
 * shape; this repo has never read a `CI` environment variable and its
 * own habit is explicit flags over env-var inference.
 */
export const resolveStrictMode = (flag: boolean | undefined): boolean => {
	if (flag === true) {
		return true;
	}
	if (flag === false) {
		return false;
	}
	return !isInteractive();
};

export type DiffLineColor = "green" | "yellow" | "red";

const ANSI_CODES: Record<DiffLineColor, string> = {
	green: "[32m",
	yellow: "[33m",
	red: "[31m",
};

const ANSI_RESET = "[0m";

/** Wraps `text` in `color`'s ANSI SGR code, reset at the end — the caller decides whether to call this at all ({@link shouldUseColor}). */
export const colorize = (text: string, color: DiffLineColor): string =>
	`${ANSI_CODES[color]}${text}${ANSI_RESET}`;
