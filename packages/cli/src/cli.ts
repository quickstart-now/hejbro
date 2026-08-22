#!/usr/bin/env node
import {
	type ArgsDef,
	type CommandDef,
	type CommandMeta,
	type Resolvable,
	renderUsage,
	runMain,
	type SubCommandsDef,
	showUsage,
} from "citty";
import { main } from "./main";

/**
 * First paragraph of a description, joined onto one line — what the root
 * `COMMANDS` table shows (Task 14, #264); `<cmd> --help` still prints the
 * full owner-approved text unchanged (`generate`'s two paragraphs stay
 * intact there).
 */
const firstParagraph = (description: string): string =>
	description.split("\n\n")[0]?.replace(/\n/g, " ") ?? "";

// citty types `subCommands`/each subcommand/its `meta` as `Resolvable<…>`
// (also resolvable via a function or a Promise) even though every
// subcommand in this codebase (`main.ts`) is a plain object literal —
// these guards narrow that union without a cast. A resolvable value
// (function/Promise) is passed through unshortened; `main.ts` never
// produces one, so the branch is defensive only.
const isPlainObject = (value: unknown): boolean =>
	typeof value === "object" && value !== null && !(value instanceof Promise);

const isPlainSubCommandsDef = (
	value: Resolvable<SubCommandsDef> | undefined,
): value is SubCommandsDef => isPlainObject(value);

const isPlainCommandDef = (
	value: Resolvable<CommandDef>,
): value is CommandDef => isPlainObject(value);

const isPlainCommandMeta = (
	value: Resolvable<CommandMeta> | undefined,
): value is CommandMeta => isPlainObject(value);

/** Shortens one subcommand's table cell to its first paragraph; passes anything else through unchanged. */
const shortenSubCommand = (
	name: string,
	sub: Resolvable<CommandDef>,
): readonly [string, Resolvable<CommandDef>] => {
	if (!isPlainCommandDef(sub) || !isPlainCommandMeta(sub.meta)) {
		return [name, sub];
	}
	return [
		name,
		{
			...sub,
			meta: {
				...sub.meta,
				description: firstParagraph(sub.meta.description ?? ""),
			},
		},
	];
};

/**
 * citty's `renderUsage` puts each subcommand's full `meta.description`
 * into the root `COMMANDS` table (0.2.2) — `generate`'s owner-approved
 * two-paragraph text then pads every other row to its width. This copy
 * shortens only the table cell; the subcommand's own `meta.description`
 * (and therefore `<cmd> --help`) is untouched.
 */
const withOneLineSubcommands = <T extends ArgsDef = ArgsDef>(
	cmd: CommandDef<T>,
): CommandDef<T> => {
	if (!isPlainSubCommandsDef(cmd.subCommands)) {
		return cmd;
	}
	return {
		...cmd,
		subCommands: Object.fromEntries(
			Object.entries(cmd.subCommands).map(([name, sub]) =>
				shortenSubCommand(name, sub),
			),
		),
	};
};

/**
 * `resolveSubCommand` hands the root command back unchanged and only
 * attaches a `parent` once it has recursed into a subcommand (citty
 * `index.mjs:255`) — so `cmd === main` is true exactly when `--help` is
 * the root's own. That reference comparison is what the runtime does;
 * but with `exactOptionalPropertyTypes` on, TS still rejects `cmd ===
 * main` at the type level ("`CommandDef<T>` and `CommandDef<ArgsDef>`
 * have no overlap" — tried both inferred and an explicit `: typeof
 * showUsage` annotation, same error either way). `parent === undefined`
 * is the type-checkable form of the identical runtime condition. citty's
 * own `showUsage` appends a trailing blank line after `renderUsage`'s
 * output — mirrored here so the root's output shape matches every other
 * command's.
 */
const rootAwareShowUsage: typeof showUsage = async (cmd, parent) => {
	if (parent === undefined) {
		console.log(`${await renderUsage(withOneLineSubcommands(cmd), parent)}\n`);
		return;
	}
	await showUsage(cmd, parent);
};

runMain(main, { showUsage: rootAwareShowUsage });
