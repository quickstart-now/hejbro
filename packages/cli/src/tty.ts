/**
 * `history`/`restore`'s shared terminal-capability checks (#130 spec §9,
 * §7). Both are re-evaluated per call (not cached at module load) so a
 * test can flip `process.stdout.isTTY`/`process.env.NO_COLOR` between
 * assertions without needing to re-import the module.
 */

const isInteractive = (): boolean => process.stdout.isTTY === true;

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
