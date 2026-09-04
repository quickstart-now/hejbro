import { lstatSync, readlinkSync, type Stats, statSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";

/** The two kinds of node a configured artifact can be (#846 D2, moved
 * from `commands/init.ts` -- shared by every module that judges a
 * configured path). */
export type NodeKind = "file" | "directory";

const kindOfStat = (stat: Stats): NodeKind => {
	if (stat.isDirectory()) {
		return "directory";
	}
	return "file";
};

/** A configured path's trailing `/`s dropped before it is stat'd -- POSIX
 * `stat()` on a path spelled with a trailing separator refuses with
 * `ENOTDIR` when the node there is a file (D106 R1 B1), which made
 * `existsSync` report "nothing there" and let a later write throw a
 * raw, uncoded stack instead of a command's own diagnostic. Shared by
 * `commands/init.ts` and `snapshot-file.ts` (#767 review, D7 -- moved
 * here so both read the same rule instead of keeping two copies). */
export const stripTrailingSeparators = (path: string): string =>
	path.replace(/\/+$/, "");

/** The operating system's own error code off a caught `fs` failure, or
 * `"unknown"` when the thrown value carries none -- never the raw error
 * object, which a diagnostic must not print (D57). */
export const errorCode = (error: unknown): string => {
	if (error !== null && typeof error === "object" && "code" in error) {
		return String((error as NodeJS.ErrnoException).code);
	}
	return "unknown";
};

/** `path`'s own chain of parents, one level up (never `path` itself). */
const parentOf = (path: string): string => dirname(path);

/** `readlinkSync(path)`'s own target, printed relative to `cwd` when the
 * link was written as an absolute path (D57 -- this CLI's diagnostics
 * never print an absolute path); a relative target is printed exactly
 * as the link spells it, which is also how POSIX resolves it (from the
 * link's own directory, not `cwd`). */
export const symlinkTargetLabel = (cwd: string, path: string): string => {
	const target = readlinkSync(path);
	if (isAbsolute(target)) {
		return relative(cwd, target);
	}
	return target;
};

/** A dangling symbolic link at `path`, or `null` when `path` isn't one
 * (including "nothing there at all") -- {@link walkAncestors}'s own
 * probe for the same fault a leaf-level kind check detects, since
 * `statSync` alone can't tell "dangling link" from "absent" (#767
 * review, D8). */
const danglingLinkTargetAt = (cwd: string, path: string): string | null => {
	try {
		const lstat = lstatSync(path);
		if (!lstat.isSymbolicLink()) {
			return null;
		}
		return symlinkTargetLabel(cwd, path);
	} catch {
		return null;
	}
};

export type AncestorOutcome =
	| { readonly kind: "ok"; readonly path: string }
	| {
			readonly kind: "conflict";
			readonly path: string;
			readonly actualKind: "file";
	  }
	| {
			readonly kind: "dangling";
			readonly path: string;
			readonly target: string;
	  }
	| {
			readonly kind: "stat-failed";
			readonly path: string;
			readonly code: string;
	  }
	| {
			readonly kind: "blocked";
			readonly culprit: string;
			readonly code: string;
	  };

/** Walks `path`'s own chain of parents upward (never `path` itself --
 * callers pass a leaf's `dirname`), continuing past `ENOENT` ("nothing
 * there yet", unless a dangling symbolic link sits there -- #767
 * review, D8, which conflicts instead), `ENOTDIR` (a `stat` below a
 * file ancestor fails this way too, D106 R1 N1 -- stopping there
 * instead of continuing up would name the deepest segment tried, not
 * the file actually blocking the chain) and `EACCES`/`EPERM` (#768, D4
 * -- `stat` fails this way for a directory it cannot search into,
 * never for the leaf itself, so the node it finally does stat
 * successfully is the one that blocks the lookup) until a `stat`
 * succeeds. `permissionCode` carries the first permission failure seen
 * on the way up (or is seeded by a caller that already knows its own
 * leaf failed that way); once a `stat` succeeds while carrying one,
 * that node is the blocking one, not an "ok" ancestor. Recursive, never
 * a loop (`check:bans`); `dirname` of the filesystem root is itself,
 * which ends the recursion even when nothing on the way up ever
 * exists. Shared by `commands/init.ts` and `snapshot-file.ts` (#767
 * review, D7 -- a pure move, no behaviour change; every label and
 * message stays with its own caller). */
export const walkAncestors = (
	cwd: string,
	path: string,
	permissionCode?: string,
): AncestorOutcome => {
	try {
		const stat = statSync(path);
		if (stat.isDirectory()) {
			if (permissionCode !== undefined) {
				return { kind: "blocked", culprit: path, code: permissionCode };
			}
			return { kind: "ok", path };
		}
		return { kind: "conflict", path, actualKind: "file" };
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT") {
			const danglingTarget = danglingLinkTargetAt(cwd, path);
			if (danglingTarget !== null) {
				return { kind: "dangling", path, target: danglingTarget };
			}
			const parent = parentOf(path);
			if (parent === path) {
				if (permissionCode !== undefined) {
					return { kind: "blocked", culprit: path, code: permissionCode };
				}
				return { kind: "ok", path };
			}
			return walkAncestors(cwd, parent, permissionCode);
		}
		if (code === "ENOTDIR") {
			const parent = parentOf(path);
			if (parent === path) {
				if (permissionCode !== undefined) {
					return { kind: "blocked", culprit: path, code: permissionCode };
				}
				return { kind: "ok", path };
			}
			return walkAncestors(cwd, parent, permissionCode);
		}
		if (code === "EACCES" || code === "EPERM") {
			const parent = parentOf(path);
			if (parent === path) {
				return { kind: "blocked", culprit: path, code };
			}
			return walkAncestors(cwd, parent, code);
		}
		return { kind: "stat-failed", path, code };
	}
};

/** The raw path of the node whose permissions actually block a leaf's
 * own failed `stat` (#768, D4; shared by `commands/init.ts` and
 * `snapshot-file.ts`, #767 review D7 -- "one fact, one answer on both
 * sides"): for `EACCES`/`EPERM`, walk upward from `dirname(leafPath)`,
 * seeded with the leaf's own code, to find the ancestor that blocks it
 * -- `stat`'s `EACCES` is always a directory on the way, never the
 * leaf. `null` for any other code, or on the (untested) chance the
 * seeded walk doesn't resolve to a blocked ancestor; callers fall back
 * to naming the leaf itself in that case. Returns the raw filesystem
 * path -- never a label -- so every caller renders it in its own style. */
export const permissionCulpritFor = (
	cwd: string,
	leafPath: string,
	code: string,
): string | null => {
	if (code !== "EACCES" && code !== "EPERM") {
		return null;
	}
	const outcome = walkAncestors(cwd, dirname(leafPath), code);
	if (outcome.kind === "blocked") {
		return outcome.culprit;
	}
	return null;
};

/** One judgement of a configured path (#846 D2), shared by every module
 * that scaffolds or reads a configured artifact: ancestors first (a
 * file, a dangling link, or a blocked directory on the way is named as
 * that node, never as the leaf with a bare operating-system code), then
 * the leaf itself, judged by what it points at when it is a symbolic
 * link. `absent` carries the deepest existing ancestor (`parent`) --
 * the node a caller's own writability check and first-node-to-create
 * both need, so neither re-walks. */
export type PathOutcome =
	| { readonly kind: "absent"; readonly parent: string }
	| { readonly kind: "present"; readonly actualKind: NodeKind }
	| { readonly kind: "dangling"; readonly target: string }
	| { readonly kind: "ancestor-file"; readonly path: string }
	| {
			readonly kind: "ancestor-dangling";
			readonly path: string;
			readonly target: string;
	  }
	| {
			readonly kind: "blocked";
			readonly culprit: string;
			readonly code: string;
	  }
	| {
			readonly kind: "stat-failed";
			readonly path: string;
			readonly code: string;
	  };

/** `leafPath`'s own outcome once its ancestors are already known "ok"
 * (`parent` is that deepest existing ancestor, for an absent leaf) --
 * `lstat`s first: a non-link node's `lstat` already carries its kind, so
 * only a link needs the second, following `stat` (#767 review, D8). */
const leafOutcomeAt = (
	cwd: string,
	path: string,
	parent: string,
): PathOutcome => {
	try {
		const lstat = lstatSync(path);
		if (!lstat.isSymbolicLink()) {
			return { kind: "present", actualKind: kindOfStat(lstat) };
		}
		try {
			return { kind: "present", actualKind: kindOfStat(statSync(path)) };
		} catch (error) {
			const code = errorCode(error);
			if (code === "ENOENT") {
				return { kind: "dangling", target: symlinkTargetLabel(cwd, path) };
			}
			return { kind: "stat-failed", path, code };
		}
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT") {
			return { kind: "absent", parent };
		}
		return { kind: "stat-failed", path, code };
	}
};

/** Judges `leafPath` (already trailing-separator-stripped by the caller,
 * D106 R1 B1) by its ancestors, then by itself (#846 D2): the one
 * judgement `commands/init.ts` applies to every planned artifact,
 * including the configuration artifact, and the read side applies to
 * the paths it consumes. */
export const probePath = (cwd: string, leafPath: string): PathOutcome => {
	const ancestorOutcome = walkAncestors(cwd, dirname(leafPath));
	if (ancestorOutcome.kind === "conflict") {
		return { kind: "ancestor-file", path: ancestorOutcome.path };
	}
	if (ancestorOutcome.kind === "dangling") {
		return {
			kind: "ancestor-dangling",
			path: ancestorOutcome.path,
			target: ancestorOutcome.target,
		};
	}
	if (ancestorOutcome.kind === "blocked") {
		return {
			kind: "blocked",
			culprit: ancestorOutcome.culprit,
			code: ancestorOutcome.code,
		};
	}
	if (ancestorOutcome.kind === "stat-failed") {
		return {
			kind: "stat-failed",
			path: ancestorOutcome.path,
			code: ancestorOutcome.code,
		};
	}
	return leafOutcomeAt(cwd, leafPath, ancestorOutcome.path);
};
