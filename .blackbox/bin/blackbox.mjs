#!/usr/bin/env node
// blackbox — flight recorder for AI-built work, one folder per work item.
//
// Vendored copy: `blackbox init` installs this file as
// `<repo>/.blackbox/bin/blackbox.mjs` from the `dd-blackbox` skill
// (quickstart-now/agent-skills). Zero dependencies; Node 20+; needs `git`
// and `gh` on PATH. The same `check` serves the pre-merge hook and CI, so
// the two cannot disagree.
//
// Layout, per item (a repository, or one directory of a multi-item repo):
//   <item>/.blackbox/<key>/meta.json      machine-owned: kind, ref, status,
//                                         decisions, work, prs with pins
//   <item>/.blackbox/<key>/decisions.md   every decision: owner D#, AI R#
//   <item>/.blackbox/<key>/work.md        the work that followed: W#
//   <item>/.blackbox/<key>/README.md      generated timeline
//   <item>/.blackbox/README.md            generated index
// <key> is the tracker number (`752`), or `<repo>-<n>` when the tracker
// repository differs from the code repository.
import { spawnSync } from "node:child_process";
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "1.0.0";
const META_VERSION = 1;
const RULING_KINDS = ["interpretation", "extension", "stop"];
const STATUSES = ["open", "merged-pending", "closed"];
const INTEGRATION_BRANCHES = ["dev", "develop", "development", "staging"];
const RAW_DIR = ".blackbox-raw";

class BlackboxError extends Error {}

const fail = (message) => {
	throw new BlackboxError(message);
};

/** `text` when `condition` holds, otherwise nothing — for optional fragments. */
const iff = (condition, text) => {
	if (condition) {
		return text;
	}
	return "";
};

// ---------------------------------------------------------------- process

const run = (cmd, args, options = {}) => {
	const result = spawnSync(cmd, args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});
	return {
		ok: result.status === 0,
		out: String(result.stdout ?? ""),
		err: String(result.stderr ?? "").trim(),
	};
};

const git = (args, cwd) => {
	const result = run("git", args, { cwd });
	if (!result.ok) {
		fail(`git ${args.join(" ")}: ${result.err}`);
	}
	return result.out.replace(/\n$/, "");
};

const gh = (args) => {
	const result = run("gh", args);
	if (!result.ok) {
		fail(`gh ${args.slice(0, 2).join(" ")}: ${result.err || result.out}`);
	}
	return result.out;
};

const ghJson = (path, extra = []) => JSON.parse(gh(["api", path, ...extra]));

const ghPaginated = (path) =>
	JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

/** A JSON-bodied request (POST/PATCH) through `gh api --input`. */
const ghSend = (method, path, body) => {
	const file = join(tmpdir(), `blackbox-${process.pid}-${Date.now()}.json`);
	writeFileSync(file, JSON.stringify(body));
	try {
		return JSON.parse(gh(["api", "-X", method, "--input", file, path]));
	} finally {
		rmSync(file, { force: true });
	}
};

// ------------------------------------------------------------------- git

const repoRoot = (cwd = process.cwd()) =>
	git(["rev-parse", "--show-toplevel"], cwd);

const commonGitDir = (cwd = process.cwd()) =>
	git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);

const mainRoot = (cwd = process.cwd()) => dirname(commonGitDir(cwd));

const worktreePaths = (cwd = process.cwd()) =>
	git(["worktree", "list", "--porcelain"], cwd)
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice("worktree ".length));

const REMOTE_PATTERN = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/;

/** owner/name of the code repository: `upstream` wins over `origin` (fork flows). */
const repoSlug = (cwd = process.cwd()) => {
	const remotes = git(["remote"], cwd).split("\n").filter(Boolean);
	const preferred = ["upstream", "origin", ...remotes].filter((name) =>
		remotes.includes(name),
	);
	const found = preferred
		.map((name) => git(["remote", "get-url", name], cwd).match(REMOTE_PATTERN))
		.find((match) => match !== null);
	if (!found) {
		fail("no GitHub remote found (need `upstream` or `origin`)");
	}
	return `${found[1]}/${found[2]}`;
};

const listedPaths = (root) =>
	git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root)
		.split("\0")
		.filter(Boolean);

// ------------------------------------------------------------------- refs

const parseRef = (text, defaultRepo) => {
	const url = text.match(/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/);
	if (url) {
		return { repo: url[1], number: Number(url[2]) };
	}
	const full = text.match(/^([^/#\s]+\/[^/#\s]+)#(\d+)$/);
	if (full) {
		return { repo: full[1], number: Number(full[2]) };
	}
	const bare = text.match(/^#?(\d+)$/);
	if (bare) {
		return { repo: defaultRepo, number: Number(bare[1]) };
	}
	return fail(`not a work-item reference: ${text}`);
};

const refString = (ref) => `${ref.repo}#${ref.number}`;

const folderNameFor = (ref, codeRepo) => {
	if (ref.repo === codeRepo) {
		return String(ref.number);
	}
	return `${ref.repo.split("/")[1]}-${ref.number}`;
};

const shortRef = (ref) => `#${ref.split("#")[1]}`;

// ------------------------------------------------------------------- time

const nowIso = () => new Date().toISOString().replace(/:\d\d\.\d{3}Z$/, "Z");
const today = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------ tree readers
// A reader is "the repository content at some state": the working tree, a
// local commit, or a remote commit through the API. Every inspection of
// records goes through one, so the merge check can look at the PR's head
// rather than at whatever the local checkout happens to be.

const isBlackboxPath = (path) =>
	path === ".blackbox" ||
	path.startsWith(".blackbox/") ||
	path.includes("/.blackbox/");

/** A file deleted from a pre-folder-form `blackbox/` directory is a record, not content. */
const isLegacyRecordRemoval = (path, removed) =>
	removed && /(^|\/)blackbox\/[^/]+\.md$/.test(path);

const fsReader = (root) => {
	const paths = listedPaths(root);
	return {
		label: "working tree",
		paths: () => paths,
		has: (path) => existsSync(join(root, path)),
		read: (path) => readFileSync(join(root, path), "utf8"),
		blob: (path) => git(["hash-object", "--", path], root),
	};
};

const localCommitReader = (root, commit) => {
	const blobs = new Map(
		git(["ls-tree", "-r", "-z", commit], root)
			.split("\0")
			.filter(Boolean)
			.map((line) => {
				const [info, path] = line.split("\t");
				return [path, info.split(" ")[2]];
			}),
	);
	return {
		label: `commit ${commit.slice(0, 8)} (local)`,
		paths: () => [...blobs.keys()],
		has: (path) => blobs.has(path),
		read: (path) => {
			const shown = run("git", ["show", `${commit}:${path}`], { cwd: root });
			if (!shown.ok) {
				fail(`git show ${commit.slice(0, 8)}:${path}: ${shown.err}`);
			}
			return shown.out;
		},
		blob: (path) => blobs.get(path),
	};
};

const apiCommitReader = (repo, commit) => {
	const tree = ghJson(`repos/${repo}/git/trees/${commit}?recursive=1`);
	if (tree.truncated) {
		fail(
			`tree of ${commit.slice(0, 8)} is truncated by the API; fetch the commit locally (git fetch) and re-run`,
		);
	}
	const blobs = new Map(
		tree.tree
			.filter((entry) => entry.type === "blob")
			.map((entry) => [entry.path, entry.sha]),
	);
	return {
		label: `commit ${commit.slice(0, 8)} (api)`,
		paths: () => [...blobs.keys()],
		has: (path) => blobs.has(path),
		read: (path) => {
			const blob = ghJson(`repos/${repo}/git/blobs/${blobs.get(path)}`);
			return Buffer.from(blob.content, "base64").toString("utf8");
		},
		blob: (path) => blobs.get(path),
	};
};

const commitReader = (root, repo, commit) => {
	const local = run("git", ["cat-file", "-e", `${commit}^{commit}`], {
		cwd: root,
	});
	if (local.ok) {
		return localCommitReader(root, commit);
	}
	return apiCommitReader(repo, commit);
};

// ------------------------------------------------------------ record state

const parseMeta = (text, path) => {
	try {
		return JSON.parse(text);
	} catch (error) {
		return fail(`${path}: invalid JSON (${error.message})`);
	}
};

const itemRelOf = (path) => {
	const parts = path.split("/");
	return parts.slice(0, parts.indexOf(".blackbox")).join("/");
};

/** Items (directories owning a `.blackbox/`) and their folders, from a reader. */
const loadState = (reader) => {
	const paths = reader.paths().filter(isBlackboxPath);
	const itemRels = [...new Set(paths.map(itemRelOf))].sort();
	const items = itemRels.map((rel) => {
		const bb = `${iff(rel !== "", `${rel}/`)}.blackbox`;
		const inside = paths
			.filter((path) => path.startsWith(`${bb}/`))
			.map((path) => path.slice(bb.length + 1));
		const folderNames = [
			...new Set(
				inside
					.map((rest) => rest.split("/"))
					.filter((parts) => parts.length === 2 && parts[1] === "meta.json")
					.map((parts) => parts[0]),
			),
		].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
		const folders = folderNames.map((name) => {
			const dir = `${bb}/${name}`;
			const metaPath = `${dir}/meta.json`;
			return {
				name,
				dir,
				metaPath,
				item: rel,
				meta: parseMeta(reader.read(metaPath), metaPath),
			};
		});
		const legacy = inside
			.filter((rest) => !rest.includes("/") && rest.endsWith(".md"))
			.filter((rest) => rest !== "README.md")
			.sort();
		return { rel, bb, folders, legacy };
	});
	return { items, folders: items.flatMap((item) => item.folders) };
};

const findFolder = (state, key, context = {}) => {
	const wanted = String(key).replace(/^#/, "").replace(/\/$/, "");
	const byPath = state.folders.find((folder) => folder.dir === wanted);
	if (byPath) {
		return byPath;
	}
	const matches = state.folders.filter(
		(folder) =>
			folder.name === wanted ||
			folder.name.endsWith(`-${wanted}`) ||
			folder.meta.ref === wanted,
	);
	if (matches.length === 0) {
		fail(`no work-item folder for ${key}`);
	}
	if (matches.length === 1) {
		return matches[0];
	}
	const nearest = matches
		.filter((folder) => {
			const itemDir = join(context.root ?? "", folder.item);
			return (
				context.cwd === itemDir || String(context.cwd).startsWith(`${itemDir}/`)
			);
		})
		.sort((a, b) => b.item.length - a.item.length)[0];
	if (nearest) {
		return nearest;
	}
	return fail(
		`ambiguous key ${key}: ${matches.map((folder) => folder.dir).join(", ")} — pass the folder path`,
	);
};

// -------------------------------------------------------------- rendering

const rulingsOf = (meta) =>
	meta.decisions.filter((entry) => entry.id.startsWith("R"));

const isPendingExtension = (entry) =>
	entry.kind === "extension" && entry.ratified === null;

const kindCounts = (meta) => {
	const rulings = rulingsOf(meta);
	const count = (kind) => rulings.filter((entry) => entry.kind === kind).length;
	return {
		owner: meta.decisions.filter((entry) => entry.by === "owner").length,
		rulings: rulings.length,
		interpretation: count("interpretation"),
		extension: count("extension"),
		stop: count("stop"),
		pendingExtensions: rulings.filter(isPendingExtension).length,
		rejected: rulings.filter(
			(entry) =>
				entry.ratified !== null && entry.ratified.verdict === "rejected",
		).length,
	};
};

const mergedPrs = (meta) => meta.prs.filter((pr) => pr.merged);

const anchor = (file, id) => `[${id}](${file}#${id.toLowerCase()})`;

const ratificationState = (entry) => {
	if (entry.ratified === null) {
		return "pending";
	}
	return `${entry.ratified.verdict} by ${entry.ratified.by}`;
};

const describeDecision = (entry) => {
	if (entry.by === "owner") {
		return "owner decision";
	}
	return `${entry.by} ruling · ${entry.kind}${iff(
		entry.basis.length > 0,
		` · basis ${entry.basis.join(", ")}`,
	)} · ${ratificationState(entry)}`;
};

const timelineRows = (meta) => {
	const rows = [[meta.opened, "opened"]];
	meta.decisions.forEach((entry) => {
		rows.push([
			entry.at,
			`${anchor("decisions.md", entry.id)} ${entry.title} — ${describeDecision(entry)}`,
		]);
		if (entry.ratified) {
			rows.push([
				entry.ratified.at,
				`${entry.id} ${entry.ratified.verdict} by ${entry.ratified.by}${iff(
					entry.ratified.decision !== null,
					` (${anchor("decisions.md", entry.ratified.decision ?? "")})`,
				)}`,
			]);
		}
	});
	meta.work.forEach((entry) => {
		rows.push([
			entry.at,
			`${anchor("work.md", entry.id)} ${entry.title}${iff(entry.pr !== null, ` · PR #${entry.pr}`)}`,
		]);
	});
	meta.prs.forEach((pr) => {
		rows.push([
			pr.pinnedAt,
			`PR #${pr.number} pinned · ${pr.refs.length} file(s) · head ${pr.head.slice(0, 8)}`,
		]);
		if (pr.merged) {
			rows.push([pr.merged, `PR #${pr.number} merged`]);
		}
	});
	if (meta.closed) {
		rows.push([meta.closed, "closed"]);
	}
	return rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
};

const countsLine = (counts) =>
	`Owner decisions ${counts.owner} · rulings ${counts.rulings} (interpretation ${counts.interpretation}, extension ${counts.extension}, stop ${counts.stop}) · pending extensions ${counts.pendingExtensions} · rejected ${counts.rejected}`;

const renderFolderReadme = (folder) => {
	const { meta } = folder;
	const pending = rulingsOf(meta)
		.filter(isPendingExtension)
		.map((entry) => entry.id);
	const lines = [
		`# ${meta.ref} — ${meta.title}`,
		"",
		`${iff(meta.parent !== null, `Parent: ${meta.parent} · `)}Kind: ${meta.kind} · Status: ${meta.status}`,
		"",
		"Generated by `blackbox index` from `meta.json`; do not edit.",
		"",
		"| When | Entry |",
		"|---|---|",
		...timelineRows(meta).map(([when, what]) => `| ${when} | ${what} |`),
		"",
		countsLine(kindCounts(meta)),
		"",
	];
	if (pending.length > 0) {
		lines.push(`Pending ratification: ${pending.join(", ")}`, "");
	}
	return lines.join("\n");
};

const itemRows = (item) => {
	const refs = new Set(item.folders.map((folder) => folder.meta.ref));
	const hasParentHere = (folder) =>
		folder.meta.parent !== null && refs.has(folder.meta.parent);
	const row = (folder, indent) => {
		const { meta } = folder;
		const counts = kindCounts(meta);
		const prs = meta.prs.map((pr) => `#${pr.number}`).join(" ");
		return `| ${indent}[${shortRef(meta.ref)}](${folder.name}/) | ${meta.title} | ${meta.status} | ${prs} | ${counts.owner} | ${counts.rulings} (${counts.pendingExtensions} pending) |`;
	};
	if (!item.folders.some(hasParentHere)) {
		return item.folders.map((folder) => row(folder, ""));
	}
	return item.folders
		.filter((folder) => !hasParentHere(folder))
		.flatMap((root) => [
			row(root, ""),
			...item.folders
				.filter((folder) => folder.meta.parent === root.meta.ref)
				.map((folder) => row(folder, "↳ ")),
		]);
};

const sumCounts = (folders) => {
	const all = folders.map((folder) => kindCounts(folder.meta));
	const sum = (key) => all.reduce((acc, counts) => acc + counts[key], 0);
	return {
		owner: sum("owner"),
		rulings: sum("rulings"),
		interpretation: sum("interpretation"),
		extension: sum("extension"),
		stop: sum("stop"),
		pendingExtensions: sum("pendingExtensions"),
		rejected: sum("rejected"),
	};
};

const renderItemReadme = (item, itemLabel) => {
	const stalled = item.folders.filter(
		(folder) =>
			folder.meta.status !== "closed" && mergedPrs(folder.meta).length > 0,
	);
	const lines = [
		`# Blackbox — ${itemLabel}`,
		"",
		"Flight recorder: one folder per work item, keyed by its tracker number. Each holds `meta.json` (machine-owned, with per-PR content pins), `decisions.md` (every decision — owner `D#`, AI `R#`), `work.md` (the work that followed, `W#`). Generated by `blackbox index`; do not edit. Read only for provenance questions.",
		"",
		"## Work items",
		"",
		"| Item | Title | Status | PRs | Owner decisions | Rulings |",
		"|---|---|---|---|---|---|",
		...itemRows(item),
		"",
		"## Totals",
		"",
		countsLine(sumCounts(item.folders)),
		"",
		"## Conventions",
		"",
		"- One folder per work item, named by its tracker number; a follow-up is a new number linked through `meta.json`, never a second folder.",
		"- `decisions.md` records every decision as it is made: owner decisions (`D#`) as faithful English rewrites of the owner's words, AI rulings (`R#`) with kind (interpretation, extension, stop), basis and ratification. `work.md` (`W#`) records what was built, measured and reversed. Both are append-only; a correction is a new entry.",
		"- Every PR is pinned before merge: each changed file's blob SHA, checked both ways (every pin matches the PR head, every changed file is pinned) by the pre-merge hook and by CI.",
		"- Never read this directory during normal work. It answers provenance questions only.",
		"",
	];
	if (stalled.length > 0) {
		lines.push(
			`Merged but not closed: ${stalled.map((folder) => shortRef(folder.meta.ref)).join(", ")}`,
			"",
		);
	}
	if (item.legacy.length > 0) {
		lines.push(
			"## Legacy entries",
			"",
			"Single-file records from before the folder form. Kept as written.",
			"",
			...item.legacy.map((name) => `- [${name}](${name})`),
			"",
		);
	}
	return lines.join("\n");
};

const itemLabelFor = (item, repo) => {
	if (item.rel === "") {
		return repo.split("/")[1];
	}
	return item.rel.split("/").pop();
};

/** Expected README paths and contents for every item and folder. */
const expectedReadmes = (state, repo) =>
	state.items.flatMap((item) => [
		[`${item.bb}/README.md`, renderItemReadme(item, itemLabelFor(item, repo))],
		...item.folders.map((folder) => [
			`${folder.dir}/README.md`,
			renderFolderReadme(folder),
		]),
	]);

// -------------------------------------------------------------- validation

const validateMeta = (folder, problems) => {
	const { meta, dir } = folder;
	const problem = (text) => problems.push(`${dir}: ${text}`);
	if (meta.version !== META_VERSION) {
		problem(`meta version ${meta.version}, expected ${META_VERSION}`);
	}
	if (!["issue", "pr"].includes(meta.kind)) {
		problem(`kind must be issue or pr (got ${meta.kind})`);
	}
	if (!STATUSES.includes(meta.status)) {
		problem(`status must be ${STATUSES.join("|")} (got ${meta.status})`);
	}
	if (typeof meta.ref !== "string" || !/^[^/#]+\/[^/#]+#\d+$/.test(meta.ref)) {
		problem(`ref must look like owner/repo#N (got ${meta.ref})`);
	}
	rulingsOf(meta).forEach((entry) => {
		if (!RULING_KINDS.includes(entry.kind)) {
			problem(`${entry.id}: kind must be ${RULING_KINDS.join("|")}`);
		}
	});
};

const validateAnchors = (folder, reader, problems) => {
	const check = (file, ids) => {
		const path = `${folder.dir}/${file}`;
		if (!reader.has(path)) {
			problems.push(`${path}: missing`);
			return;
		}
		const text = reader.read(path);
		ids.forEach((id) => {
			if (!text.includes(`<a id="${id.toLowerCase()}"></a>`)) {
				problems.push(`${path}: no entry for ${id} (meta lists it)`);
			}
		});
	};
	check(
		"decisions.md",
		folder.meta.decisions.map((entry) => entry.id),
	);
	check(
		"work.md",
		folder.meta.work.map((entry) => entry.id),
	);
};

/** One folder per ref within an item; the same ref may recur across items. */
const validateUniqueness = (state, problems) => {
	state.items.forEach((item) => {
		const seen = new Map();
		item.folders.forEach((folder) => {
			const prior = seen.get(folder.meta.ref);
			if (prior) {
				problems.push(
					`${folder.meta.ref} recorded twice in one item: ${prior} and ${folder.dir}`,
				);
			}
			seen.set(folder.meta.ref, folder.dir);
		});
	});
};

const validateReadmes = (state, reader, repo, problems) => {
	expectedReadmes(state, repo).forEach(([path, expected]) => {
		if (!reader.has(path)) {
			problems.push(`${path}: missing (run blackbox index)`);
			return;
		}
		if (reader.read(path) !== expected) {
			problems.push(`${path}: stale (run blackbox index)`);
		}
	});
};

/** Structural checks shared by every mode. */
const validateState = (state, reader, repo) => {
	const problems = [];
	state.folders.forEach((folder) => {
		validateMeta(folder, problems);
		validateAnchors(folder, reader, problems);
	});
	validateUniqueness(state, problems);
	validateReadmes(state, reader, repo, problems);
	return problems;
};

// ------------------------------------------------------------- PR helpers

const prInfo = (repo, number) => {
	const pr = ghJson(`repos/${repo}/pulls/${number}`);
	return {
		number: pr.number,
		title: pr.title,
		head: pr.head.sha,
		headRef: pr.head.ref,
		base: pr.base.ref,
		baseSha: pr.base.sha,
		merged: pr.merged_at,
		author: pr.user.login,
		bot: pr.user.type === "Bot" || /\[bot\]$/.test(pr.user.login),
		body: pr.body ?? "",
	};
};

const PR_KEYWORDS =
	/\b(closes?|closed|fix(?:es|ed)?|resolves?|resolved|refs?)\s*:?\s*(?:#|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/)(\d+)/gi;

/** Issue numbers a PR body links, and whether the keyword closes them (Closes/Fixes/Resolves) or only refers (Refs). */
const referencedIssues = (body) => {
	const seen = new Map();
	[...body.matchAll(PR_KEYWORDS)].forEach((match) => {
		const number = Number(match[2]);
		const closes = !/^refs?$/i.test(match[1]);
		seen.set(number, Boolean(seen.get(number)) || closes);
	});
	return [...seen.entries()].map(([number, closes]) => ({ number, closes }));
};

const referencedNumbers = (body) =>
	referencedIssues(body).map((entry) => entry.number);

/** Changed paths of a PR as {path, blob|null}; a rename contributes both
 * paths. Record files are never pinned — a file whose current path is a
 * record (including one renamed into `.blackbox/`) drops out here. */
const prFiles = (repo, number) =>
	ghPaginated(`repos/${repo}/pulls/${number}/files`)
		.filter((file) => !isBlackboxPath(file.filename))
		.filter(
			(file) =>
				!isLegacyRecordRemoval(file.filename, file.status === "removed"),
		)
		.flatMap((file) => {
			const current = { path: file.filename, blob: file.sha };
			if (file.status === "removed") {
				return [{ path: file.filename, blob: null }];
			}
			if (file.status === "renamed" && file.previous_filename) {
				return [current, { path: file.previous_filename, blob: null }];
			}
			return [current];
		});

/** What the local HEAD changed against the PR base, as {path, blob|null};
 * pins are taken here, after the last commit, so they describe what is
 * about to be pushed rather than what GitHub has seen so far. */
const localChangedFiles = (root, baseSha) => {
	const present = run("git", ["cat-file", "-e", `${baseSha}^{commit}`], {
		cwd: root,
	});
	if (!present.ok) {
		fail(
			`the PR base commit ${baseSha.slice(0, 8)} is not available locally; fetch the base branch and retry`,
		);
	}
	const mergeBase = git(["merge-base", baseSha, "HEAD"], root);
	const head = localCommitReader(root, "HEAD");
	const tokens = git(
		["diff", "--name-status", "-M", "-z", `${mergeBase}..HEAD`],
		root,
	)
		.split("\0")
		.filter(Boolean);
	const walk = (index, acc) => {
		if (index >= tokens.length) {
			return acc;
		}
		const status = tokens[index][0];
		if (status === "R" || status === "C") {
			const [from, to] = [tokens[index + 1], tokens[index + 2]];
			return walk(index + 3, [
				...acc,
				{ path: to, blob: head.blob(to) },
				{ path: from, blob: null },
			]);
		}
		const path = tokens[index + 1];
		if (status === "D") {
			return walk(index + 2, [...acc, { path, blob: null }]);
		}
		return walk(index + 2, [...acc, { path, blob: head.blob(path) }]);
	};
	return walk(0, [])
		.filter((file) => !isBlackboxPath(file.path))
		.filter((file) => !isLegacyRecordRemoval(file.path, file.blob === null));
};

const underRel = (path, rel) =>
	rel === "" || path === rel || path.startsWith(`${rel}/`);

/** The item that owns a path: the deepest item directory containing it. */
const ownerItemOf = (path, itemRels) =>
	itemRels
		.filter((rel) => underRel(path, rel))
		.sort((a, b) => b.length - a.length)[0];

const ownedBy = (path, itemRel, itemRels) =>
	ownerItemOf(path, itemRels) === itemRel;

const defaultBranch = (repo) => ghJson(`repos/${repo}`).default_branch;

/** dev → main (and the like) is a release; a feature branch into the default branch is not. */
const isReleasePr = (repo, pr) =>
	pr.base === defaultBranch(repo) && INTEGRATION_BRANCHES.includes(pr.headRef);

/** Release conditions read merge state live: pins were taken before the merge. */
const validateRelease = (state, repo) => {
	const problems = [];
	state.folders.forEach((folder) => {
		if (folder.meta.status !== "closed") {
			const merged = folder.meta.prs.filter(
				(pr) => pr.merged || prInfo(repo, pr.number).merged,
			);
			if (merged.length > 0) {
				problems.push(
					`${folder.meta.ref} has merged PRs (${merged.map((pr) => `#${pr.number}`).join(", ")}) but is not closed (status ${folder.meta.status})`,
				);
			}
		}
		rulingsOf(folder.meta)
			.filter(isPendingExtension)
			.forEach((entry) => {
				problems.push(
					`${folder.meta.ref}/${entry.id} is an extension ruling without ratification: ${entry.title}`,
				);
			});
	});
	return problems;
};

// -------------------------------------------------------- check (the gate)

const checkPins = ({ state, reader, holders, number, changed, problems }) => {
	const itemRels = state.items.map((item) => item.rel);
	const pinned = new Map();
	holders.forEach((folder) => {
		const block = folder.meta.prs.find((entry) => entry.number === number);
		if (!block) {
			problems.push(
				`${folder.dir}: no pin block for PR #${number}. Next: blackbox pin ${folder.name} --pr ${number}`,
			);
			return;
		}
		block.refs.forEach((ref) => {
			if (!ownedBy(ref.path, folder.item, itemRels)) {
				problems.push(
					`${folder.dir}: pin ${ref.path} belongs to item "${ownerItemOf(ref.path, itemRels) ?? "(none)"}", not "${folder.item}"`,
				);
			}
			pinned.set(ref.path, ref.blob);
			const actual = (() => {
				if (reader.has(ref.path)) {
					return reader.blob(ref.path);
				}
				return null;
			})();
			if (actual !== ref.blob) {
				problems.push(
					`${folder.dir}: stale pin ${ref.path} (pinned ${String(ref.blob).slice(0, 8)}, head has ${String(actual).slice(0, 8)}). Next: blackbox pin ${folder.name} --pr ${number}`,
				);
			}
		});
	});
	if (holders.length === 0) {
		return;
	}
	const changedPaths = new Set(changed.map((file) => file.path));
	changed.forEach((file) => {
		if (!pinned.has(file.path)) {
			const owner = ownerItemOf(file.path, itemRels);
			problems.push(
				`unpinned change in PR #${number}: ${file.path} (item "${owner ?? "(none — run blackbox init at the root)"}"). Next: blackbox pin <that item's folder> --pr ${number}`,
			);
		}
	});
	[...pinned.keys()].forEach((path) => {
		if (!changedPaths.has(path)) {
			problems.push(`pin without a change in PR #${number}: ${path}`);
		}
	});
};

const checkPr = ({ root, repo, number, release, head, readerOverride }) => {
	const pr = prInfo(repo, number);
	if (pr.bot) {
		return {
			problems: [],
			notes: [`PR #${number} by ${pr.author} (bot): exempt`],
		};
	}
	const releaseMode = release || isReleasePr(repo, pr);
	const reader = readerOverride ?? commitReader(root, repo, head ?? pr.head);
	const state = loadState(reader);
	const problems = validateState(state, reader, repo);
	const holders = state.folders.filter(
		(folder) =>
			folder.meta.prs.some((entry) => entry.number === number) ||
			(folder.meta.kind === "pr" && folder.meta.ref === `${repo}#${number}`),
	);
	if (holders.length === 0) {
		problems.push(
			`PR #${number} is recorded in no work-item folder. Next: blackbox new <issue> (if missing), then blackbox pin <folder> --pr ${number}, commit and push`,
		);
	}
	const changed = prFiles(repo, number);
	checkPins({ state, reader, holders, number, changed, problems });
	if (releaseMode) {
		problems.push(...validateRelease(state, repo));
	}
	return {
		problems,
		notes: [
			`PR #${number} (${pr.headRef} → ${pr.base}) at ${reader.label}${iff(releaseMode, " · release mode")}`,
			`folders: ${holders.map((folder) => folder.dir).join(", ") || "none"} · changed files ${changed.length}`,
		],
	};
};

const checkLocal = ({ root, repo, release }) => {
	const reader = fsReader(root);
	const state = loadState(reader);
	const problems = validateState(state, reader, repo);
	if (release) {
		problems.push(...validateRelease(state, repo));
	}
	return {
		problems,
		notes: [
			`${state.items.length} item(s), ${state.folders.length} folder(s) at ${reader.label}`,
		],
	};
};

const report = ({ problems, notes }, write) => {
	notes.forEach((note) => {
		write(`blackbox: ${note}\n`);
	});
	if (problems.length === 0) {
		write("blackbox check: ok\n");
		return true;
	}
	write(`blackbox check: ${problems.length} problem(s)\n`);
	problems.forEach((problem) => {
		write(`  - ${problem}\n`);
	});
	return false;
};

// ------------------------------------------------------------- raw inputs
// Owner inputs are saved verbatim at the keystroke (UserPromptSubmit) in
// the main checkout, outside every worktree, so a deleted worktree or a
// compacted session loses nothing. Kept out of the repository through
// .git/info/exclude, never through a committed .gitignore.

const rawDir = (cwd) => join(mainRoot(cwd), RAW_DIR);

const ensureExcluded = (cwd) => {
	const exclude = join(commonGitDir(cwd), "info", "exclude");
	mkdirSync(dirname(exclude), { recursive: true });
	const current = (() => {
		if (existsSync(exclude)) {
			return readFileSync(exclude, "utf8");
		}
		return "";
	})();
	if (!current.split("\n").includes(`${RAW_DIR}/`)) {
		const separator = iff(current !== "" && !current.endsWith("\n"), "\n");
		appendFileSync(exclude, `${separator}${RAW_DIR}/\n`);
	}
};

const readRaw = (file) => {
	if (!existsSync(file)) {
		return [];
	}
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
};

const unrecorded = (entries) => {
	const acked = new Set(
		entries.filter((entry) => entry.ack).flatMap((entry) => entry.ack),
	);
	return entries.filter(
		(entry) => entry.n !== undefined && !entry.command && !acked.has(entry.n),
	);
};

const parseRawRefs = (text) => {
	const match = text.match(/^([^#\s]+)#([\d,]+)$/);
	if (!match) {
		fail(`raw reference must look like <session>#3,4 (got ${text})`);
	}
	return { session: match[1], numbers: match[2].split(",").map(Number) };
};

const appendRaw = (cwd, session, record) => {
	ensureExcluded(cwd);
	mkdirSync(rawDir(cwd), { recursive: true });
	appendFileSync(
		join(rawDir(cwd), `${session}.jsonl`),
		`${JSON.stringify(record)}\n`,
	);
};

/** Open folders across every worktree of this repository. */
const openFoldersEverywhere = (cwd) =>
	worktreePaths(cwd).flatMap((path) =>
		loadState(fsReader(path))
			.folders.filter((folder) => folder.meta.status !== "closed")
			.map((folder) => ({ ...folder, worktree: path })),
	);

const statusLine = (cwd, session) => {
	const open = openFoldersEverywhere(cwd);
	if (open.length === 0) {
		return null;
	}
	const base = dirname(mainRoot(cwd));
	const openText = open
		.map(
			(folder) =>
				`${shortRef(folder.meta.ref)} (${relative(base, join(folder.worktree, folder.dir))})`,
		)
		.join(", ");
	const pending = (() => {
		if (session === null) {
			return [];
		}
		return unrecorded(readRaw(join(rawDir(cwd), `${session}.jsonl`)));
	})();
	const numbers = pending.map((entry) => entry.n).join(",");
	const pendingText = (() => {
		if (pending.length === 0) {
			return "unrecorded owner inputs 0";
		}
		return `unrecorded owner inputs ${pending.length} (#${numbers.replaceAll(",", ",#")}) → blackbox add decision <folder> --title "…" --raw ${session}#${numbers} <<'EOF' … EOF  or  blackbox ack ${session}#${numbers} --why "…"`;
	})();
	return `[blackbox] session ${session ?? "-"} · open: ${openText} · ${pendingText}`;
};

// -------------------------------------------------------------- mutations

const writeMeta = (root, folder) => {
	writeFileSync(
		join(root, folder.metaPath),
		`${JSON.stringify(folder.meta, null, 2)}\n`,
	);
};

const appendEntry = (root, folder, file, block) => {
	appendFileSync(join(root, `${folder.dir}/${file}`), block);
};

const entryBlock = (id, title, metaLine, body) =>
	`<a id="${id.toLowerCase()}"></a>\n## ${id} — ${title}\n\n_${metaLine}_\n\n${body.trim()}\n\n`;

const nextId = (entries, prefix) =>
	`${prefix}${entries.filter((entry) => entry.id.startsWith(prefix)).length + 1}`;

const writeIndex = (root, repo) => {
	const state = loadState(fsReader(root));
	expectedReadmes(state, repo).forEach(([path, content]) => {
		writeFileSync(join(root, path), content);
	});
	return state;
};

const readBody = (opts) => {
	if (opts["body-file"]) {
		return readFileSync(opts["body-file"], "utf8");
	}
	if (process.stdin.isTTY) {
		return "";
	}
	try {
		return readFileSync(0, "utf8");
	} catch {
		return "";
	}
};

const requireOpt = (opts, name) => {
	if (!opts[name]) {
		fail(`--${name} is required`);
	}
	return opts[name];
};

const listOpt = (text) => {
	if (!text) {
		return [];
	}
	return String(text)
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
};

const refreshMerges = (folder, repo) => {
	folder.meta.prs.forEach((pr) => {
		if (!pr.merged) {
			pr.merged = prInfo(repo, pr.number).merged;
		}
	});
};

// --------------------------------------------------------------- commands

const cmdInit = (positional, opts) => {
	const target = resolve(positional[0] ?? process.cwd());
	const root = repoRoot(target);
	const repo = repoSlug(root);
	const bb = join(target, ".blackbox");
	mkdirSync(bb, { recursive: true });
	const readme = join(bb, "README.md");
	if (!existsSync(readme)) {
		writeFileSync(readme, "");
	}
	const self = resolve(fileURLToPath(import.meta.url));
	const vendored = join(root, ".blackbox", "bin", "blackbox.mjs");
	// A repository that carries the script itself (the skill repo) runs it
	// in place; every other repository gets a vendored copy.
	const inRepo = self.startsWith(`${root}/`);
	if (!inRepo && (!existsSync(vendored) || opts.update)) {
		mkdirSync(dirname(vendored), { recursive: true });
		copyFileSync(self, vendored);
		process.stdout.write(`vendored ${relative(root, vendored)}\n`);
	}
	ensureExcluded(root);
	writeIndex(root, repo);
	const scriptRel = (() => {
		if (inRepo) {
			return relative(root, self);
		}
		return relative(root, vendored);
	})();
	process.stdout.write(
		`initialized ${relative(root, bb) || ".blackbox"} for ${repo}\n\n${snippets(scriptRel)}\n`,
	);
};

const nearestItemDir = (state, root, cwd) =>
	state.items
		.map((item) => join(root, item.rel))
		.filter((dir) => cwd === dir || cwd.startsWith(`${dir}/`))
		.sort((a, b) => b.length - a.length)[0] ?? root;

const lookupParent = (ref) => {
	const result = run("gh", [
		"api",
		`repos/${ref.repo}/issues/${ref.number}/parent`,
	]);
	if (!result.ok) {
		return null;
	}
	return `${ref.repo}#${JSON.parse(result.out).number}`;
};

const cmdNew = (positional, opts) => {
	const cwd = process.cwd();
	const root = repoRoot(cwd);
	const codeRepo = repoSlug(root);
	const ref = parseRef(
		positional[0] ?? fail("usage: blackbox new <ref>"),
		codeRepo,
	);
	const state = loadState(fsReader(root));
	const itemDir = (() => {
		if (opts.item) {
			return resolve(opts.item);
		}
		return nearestItemDir(state, root, cwd);
	})();
	if (!existsSync(join(itemDir, ".blackbox"))) {
		fail(`${itemDir} has no .blackbox/ — run blackbox init there first`);
	}
	const itemRel = relative(root, itemDir);
	const duplicate = state.folders.find(
		(folder) => folder.meta.ref === refString(ref) && folder.item === itemRel,
	);
	if (duplicate) {
		fail(`${refString(ref)} already recorded at ${duplicate.dir}`);
	}
	const issue = ghJson(`repos/${ref.repo}/issues/${ref.number}`);
	const kind =
		opts.kind ??
		(() => {
			if (issue.pull_request) {
				return "pr";
			}
			return "issue";
		})();
	const parent = (() => {
		if (opts.parent) {
			return refString(parseRef(opts.parent, ref.repo));
		}
		return lookupParent(ref);
	})();
	const origin = (() => {
		if (opts.origin) {
			return refString(parseRef(opts.origin, ref.repo));
		}
		return null;
	})();
	const dir = join(itemDir, ".blackbox", folderNameFor(ref, codeRepo));
	mkdirSync(dir);
	const meta = {
		version: META_VERSION,
		kind,
		ref: refString(ref),
		title: opts.title ?? issue.title,
		parent,
		status: "open",
		opened: today(),
		closed: null,
		decisions: [],
		work: [],
		prs: [],
		origin,
		followUps: [],
	};
	writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
	writeFileSync(
		join(dir, "decisions.md"),
		`# Decisions — ${meta.ref}\n\nEvery decision on this work item, appended as it is made: owner decisions (\`D#\`, English rewrites of the owner's words) and AI rulings (\`R#\`, with kind, basis and ratification). Managed by \`blackbox add\`; append-only.\n\n`,
	);
	writeFileSync(
		join(dir, "work.md"),
		`# Work — ${meta.ref}\n\nWhat was built, measured and reversed under the decisions, one entry per PR or group (\`W#\`). Managed by \`blackbox add work\`; append-only.\n\n`,
	);
	writeIndex(root, codeRepo);
	process.stdout.write(
		`created ${relative(root, dir)} for ${meta.ref} (${kind}${iff(parent !== null, `, parent ${parent}`)})\n`,
	);
};

const addDecision = (root, folder, opts, body, at) => {
	const by = opts.by ?? "owner";
	if (by !== "owner") {
		fail("a decision is the owner's; record the AI's as `add ruling`");
	}
	const id = nextId(folder.meta.decisions, "D");
	const raw = String(opts.raw ?? "")
		.split(/\s+/)
		.filter(Boolean);
	folder.meta.decisions.push({ id, by, at, title: opts.title, raw });
	appendEntry(
		root,
		folder,
		"decisions.md",
		entryBlock(
			id,
			opts.title,
			`${by} · ${at}${iff(raw.length > 0, ` · raw ${raw.join(", ")}`)}`,
			body,
		),
	);
	raw.forEach((text) => {
		const { session, numbers } = parseRawRefs(text);
		appendRaw(root, session, {
			ack: numbers,
			as: `${folder.meta.ref}/${id}`,
			at,
		});
	});
	return id;
};

const addRuling = (root, folder, opts, body, at) => {
	const kind = requireOpt(opts, "kind");
	if (!RULING_KINDS.includes(kind)) {
		fail(`--kind must be ${RULING_KINDS.join("|")}`);
	}
	const id = nextId(folder.meta.decisions, "R");
	const by = opts.by ?? "lead";
	const basis = listOpt(opts.basis);
	folder.meta.decisions.push({
		id,
		by,
		kind,
		basis,
		at,
		title: opts.title,
		ratified: null,
	});
	appendEntry(
		root,
		folder,
		"decisions.md",
		entryBlock(
			id,
			opts.title,
			`${by} · ${kind}${iff(basis.length > 0, ` · basis ${basis.join(", ")}`)} · ${at} · ratified: pending`,
			body,
		),
	);
	return id;
};

const addWork = (root, folder, opts, body, at) => {
	const id = nextId(folder.meta.work, "W");
	const pr = (() => {
		if (opts.pr) {
			return Number(opts.pr);
		}
		return null;
	})();
	const decisions = listOpt(opts.decisions);
	folder.meta.work.push({ id, at, title: opts.title, pr, decisions });
	appendEntry(
		root,
		folder,
		"work.md",
		entryBlock(
			id,
			opts.title,
			`${at}${iff(pr !== null, ` · PR #${pr}`)}${iff(decisions.length > 0, ` · per ${decisions.join(", ")}`)}`,
			body,
		),
	);
	return id;
};

const cmdAdd = (positional, opts) => {
	const [what, key] = positional;
	const adders = { decision: addDecision, ruling: addRuling, work: addWork };
	if (!adders[what] || !key) {
		fail(
			"usage: blackbox add decision|ruling|work <folder> --title T [...] < body.md",
		);
	}
	const root = repoRoot();
	const repo = repoSlug(root);
	const folder = findFolder(loadState(fsReader(root)), key, {
		root,
		cwd: process.cwd(),
	});
	requireOpt(opts, "title");
	const body = readBody(opts);
	if (body.trim() === "") {
		fail("entry body is empty (pipe markdown on stdin or pass --body-file)");
	}
	const at = (() => {
		if (!opts.at) {
			return nowIso();
		}
		if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}Z)?$/.test(String(opts.at))) {
			fail("--at must be YYYY-MM-DD or YYYY-MM-DDTHH:MMZ");
		}
		return String(opts.at);
	})();
	const id = adders[what](root, folder, opts, body, at);
	writeMeta(root, folder);
	writeIndex(root, repo);
	process.stdout.write(`${folder.meta.ref}/${id} recorded\n`);
};

const cmdAck = (positional, opts) => {
	const text =
		positional[0] ?? fail("usage: blackbox ack <session>#3,4 --why W");
	const why = requireOpt(opts, "why");
	const { session, numbers } = parseRawRefs(text);
	appendRaw(process.cwd(), session, {
		ack: numbers,
		as: "noise",
		why,
		at: nowIso(),
	});
	process.stdout.write(`acknowledged ${session}#${numbers.join(",")}\n`);
};

const cmdRatify = (positional, opts) => {
	const [key, id] = positional;
	if (!key || !id) {
		fail(
			"usage: blackbox ratify <folder> R# [--reject] [--why W] [--by owner|evaluator] [--decision D#]",
		);
	}
	const root = repoRoot();
	const repo = repoSlug(root);
	const folder = findFolder(loadState(fsReader(root)), key, {
		root,
		cwd: process.cwd(),
	});
	const entry = folder.meta.decisions.find((candidate) => candidate.id === id);
	if (!entry || !id.startsWith("R")) {
		fail(`${folder.meta.ref} has no ruling ${id}`);
	}
	if (entry.ratified !== null) {
		fail(
			`${id} already ${entry.ratified.verdict} by ${entry.ratified.by} at ${entry.ratified.at}`,
		);
	}
	const verdict = (() => {
		if (opts.reject) {
			return "rejected";
		}
		return "accepted";
	})();
	const by = opts.by ?? "owner";
	const at = nowIso();
	entry.ratified = { verdict, by, at, decision: opts.decision ?? null };
	const why = String(opts.why ?? "").trim() || "(no reason recorded)";
	appendEntry(
		root,
		folder,
		"decisions.md",
		`<a id="${id.toLowerCase()}-ratification"></a>\n## ${id} ${verdict}\n\n_${by} · ${at}${iff(Boolean(opts.decision), ` · decision ${opts.decision}`)}_\n\n${why}\n\n`,
	);
	writeMeta(root, folder);
	writeIndex(root, repo);
	process.stdout.write(`${folder.meta.ref}/${id} ${verdict} by ${by}\n`);
};

/** Pin a PR into a folder from the local HEAD; returns whether the block changed. */
const pinFolder = ({
	root,
	repo,
	state,
	folder,
	number,
	pr,
	changed,
	at,
	head,
}) => {
	const itemRels = state.items.map((item) => item.rel);
	const refs = changed.filter((file) =>
		ownedBy(file.path, folder.item, itemRels),
	);
	const existing = folder.meta.prs.find((entry) => entry.number === number);
	if (existing && JSON.stringify(existing.refs) === JSON.stringify(refs)) {
		return { changed: false, refs, head: existing.head };
	}
	const block = {
		number,
		ref: `${repo}#${number}`,
		title: pr.title,
		head: head ?? git(["rev-parse", "HEAD"], root),
		headRef: pr.headRef,
		base: pr.base,
		merged: pr.merged,
		pinnedAt: at,
		refs,
	};
	folder.meta.prs = [
		...folder.meta.prs.filter((entry) => entry.number !== number),
		block,
	].sort((a, b) => a.number - b.number);
	if (pr.merged && folder.meta.status === "open") {
		folder.meta.status = "merged-pending";
	}
	// "Closes #N" in the PR body is the author's declaration that merging this
	// PR finishes the issue, so the record closes with the PR instead of
	// needing a separate commit after the merge.
	const own = Number(folder.meta.ref.split("#")[1]);
	const closesHere = referencedIssues(pr.body).some(
		(entry) => entry.number === own && entry.closes,
	);
	if (
		closesHere &&
		folder.meta.ref.startsWith(`${repo}#`) &&
		folder.meta.status !== "closed"
	) {
		folder.meta.status = "closed";
		folder.meta.closed = at.slice(0, 10);
	}
	writeMeta(root, folder);
	return { changed: true, refs, head: block.head };
};

const cmdPin = (positional, opts) => {
	const key = positional[0] ?? fail("usage: blackbox pin <folder> --pr N");
	const number = Number(requireOpt(opts, "pr"));
	const root = repoRoot();
	const repo = repoSlug(root);
	const state = loadState(fsReader(root));
	const folder = findFolder(state, key, { root, cwd: process.cwd() });
	const pr = prInfo(repo, number);
	// A merged PR is history: its file list and blob SHAs come from the API
	// at its own head, not from a diff against whatever is checked out now.
	const changed = (() => {
		if (pr.merged) {
			return prFiles(repo, number);
		}
		return localChangedFiles(root, pr.baseSha);
	})();
	const result = pinFolder({
		root,
		repo,
		state,
		folder,
		number,
		pr,
		changed,
		at: nowIso(),
		head: (() => {
			if (pr.merged) {
				return pr.head;
			}
			return git(["rev-parse", "HEAD"], root);
		})(),
	});
	writeIndex(root, repo);
	process.stdout.write(
		`${folder.meta.ref}: pinned PR #${number} at ${iff(!pr.merged, "local HEAD ")}${String(result.head).slice(0, 8)} — ${result.refs.length} file(s)${iff(!result.changed, " (unchanged)")}\n`,
	);
};

/** Folders a PR belongs to: pinned already, keyed by the PR, or linked from its body. */
const foldersForPr = (state, repo, number, body) => {
	const referenced = new Set(referencedNumbers(body));
	return state.folders.filter((folder) => {
		if (folder.meta.prs.some((entry) => entry.number === number)) {
			return true;
		}
		if (!folder.meta.ref.startsWith(`${repo}#`)) {
			return false;
		}
		const own = Number(folder.meta.ref.split("#")[1]);
		return (folder.meta.kind === "pr" && own === number) || referenced.has(own);
	});
};

const dirtyRecordPaths = (root) =>
	run("git", ["status", "--porcelain", "-z"], { cwd: root })
		.out.split("\0")
		.filter(Boolean)
		.map((line) => line.slice(3))
		.filter(isBlackboxPath);

/** Commit the dirty record files through the Git Data API: GitHub signs a
 * commit it creates for a GitHub App, and an App-authenticated ref update
 * triggers workflows, so the pin lands verified and CI re-runs on it. */
const apiCommit = ({ root, repo, branch, paths, message }) => {
	const head = git(["rev-parse", "HEAD"], root);
	const baseTree = git(["rev-parse", "HEAD^{tree}"], root);
	const tree = paths.map((path) => ({
		path,
		mode: "100644",
		type: "blob",
		sha: ghSend("POST", `repos/${repo}/git/blobs`, {
			content: readFileSync(join(root, path), "utf8"),
			encoding: "utf-8",
		}).sha,
	}));
	const treeSha = ghSend("POST", `repos/${repo}/git/trees`, {
		base_tree: baseTree,
		tree,
	}).sha;
	const commit = ghSend("POST", `repos/${repo}/git/commits`, {
		message,
		tree: treeSha,
		parents: [head],
	});
	ghSend("PATCH", `repos/${repo}/git/refs/heads/${branch}`, {
		sha: commit.sha,
		force: false,
	});
	return commit.sha;
};

const gitCommitAndPush = ({ root, branch, paths, message }) => {
	git(["add", "-A", "--", ...paths], root);
	git(
		[
			"-c",
			"user.name=blackbox[bot]",
			"-c",
			"user.email=blackbox-bot@users.noreply.github.com",
			"commit",
			"-q",
			"-m",
			message,
		],
		root,
	);
	git(["push", "origin", `HEAD:refs/heads/${branch}`], root);
	return git(["rev-parse", "HEAD"], root);
};

/** How CI may land pins: "api" (GitHub App token, signed), "git" (a PAT
 * that triggers workflows), or "" (verify only). BLACKBOX_TOKEN alone
 * still means "git" for workflows written before BLACKBOX_PUSH existed. */
const pushMode = () => {
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: CI configuration, not a turbo task input
	const explicit = String(process.env.BLACKBOX_PUSH ?? "").trim();
	if (explicit === "api" || explicit === "git") {
		return explicit;
	}
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: CI configuration, not a turbo task input
	if (String(process.env.BLACKBOX_TOKEN ?? "") !== "") {
		return "git";
	}
	return "";
};

/** CI entry point: pin every folder the PR belongs to, land the pins when a
 * credential that triggers workflows is available, then check. */
const cmdCi = (_positional, opts) => {
	const root = repoRoot();
	const repo = opts.repo ?? repoSlug(root);
	const number = Number(requireOpt(opts, "pr"));
	const pr = prInfo(repo, number);
	if (pr.bot) {
		process.stdout.write(
			`blackbox: PR #${number} by ${pr.author} (bot): exempt\n`,
		);
		return;
	}
	const state = loadState(fsReader(root));
	const holders = foldersForPr(state, repo, number, pr.body);
	const changed = localChangedFiles(root, pr.baseSha);
	const at = nowIso();
	const pinned = holders.filter(
		(folder) =>
			pinFolder({ root, repo, state, folder, number, pr, changed, at }).changed,
	);
	writeIndex(root, repo);
	const dirty = dirtyRecordPaths(root);
	const mode = pushMode();
	if (dirty.length > 0 && mode === "") {
		process.stdout.write(
			`blackbox: ${pinned.length} folder(s) need pinning (${dirty.length} record file(s) differ). No credential for CI to land them — run \`blackbox pin <folder> --pr ${number}\` locally, or give the workflow a GitHub App (BLACKBOX_APP_ID + BLACKBOX_APP_PRIVATE_KEY) or a PAT (BLACKBOX_TOKEN).\n`,
		);
	}
	const landed = (() => {
		if (dirty.length === 0 || mode === "") {
			return null;
		}
		const message = `chore(blackbox): pin PR #${number} (${pinned.map((folder) => folder.meta.ref).join(", ")})`;
		if (mode === "api") {
			return apiCommit({
				root,
				repo,
				branch: pr.headRef,
				paths: dirty,
				message,
			});
		}
		return gitCommitAndPush({
			root,
			branch: pr.headRef,
			paths: dirty,
			message,
		});
	})();
	if (landed !== null) {
		process.stdout.write(
			`blackbox: pinned ${pinned.map((folder) => folder.dir).join(", ")} and landed ${landed.slice(0, 8)} on ${pr.headRef} (${mode}); the new commit re-runs CI.\n`,
		);
	}
	// After an API commit the working tree is exactly the committed tree, and
	// the commit may not exist locally yet; after a git push HEAD is it.
	const result = checkPr({
		root,
		repo,
		number,
		release: Boolean(opts.release),
		head: git(["rev-parse", "HEAD"], root),
		readerOverride: (() => {
			if (mode === "api" && landed !== null) {
				return fsReader(root);
			}
			return undefined;
		})(),
	});
	if (!report(result, (text) => process.stdout.write(text))) {
		process.exitCode = 1;
	}
};

const OWNER_HEADING = /\b(owner\s+)?input\b|^owner\b|^input\b/i;

/** A legacy single-file entry split into its owner-input sections and the rest. */
const parseLegacyEntry = (text, fileName) => {
	const date = fileName.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? today();
	const title = text.match(/^# (.+)$/m)?.[1]?.trim() ?? fileName;
	const refs = [...text.matchAll(/^- (\S+) @ (?:blob )?([0-9a-f]{40})/gm)].map(
		(match) => ({ path: match[1], blob: match[2] }),
	);
	const parts = text.split(/^(?=## )/m);
	const sections = parts.slice(1).map((part) => {
		const [heading, ...rest] = part.split("\n");
		return {
			heading: heading.replace(/^## /, "").trim(),
			body: rest.join("\n").trim(),
		};
	});
	const preamble = parts[0]
		.replace(/^# .+$/m, "")
		.replace(/^Refs:\s*$/m, "")
		.replace(/^- \S+ @ (?:blob )?[0-9a-f]{40}.*$/gm, "")
		.trim();
	return {
		date,
		title,
		refs,
		preamble,
		decisions: sections.filter((section) =>
			OWNER_HEADING.test(section.heading),
		),
		work: sections.filter((section) => !OWNER_HEADING.test(section.heading)),
	};
};

const cmdMigrate = (positional, opts) => {
	const file =
		positional[0] ??
		fail(
			"usage: blackbox migrate <legacy.md> --into <folder> [--pr N] [--dry-run]",
		);
	const root = repoRoot();
	const repo = repoSlug(root);
	const state = loadState(fsReader(root));
	const folder = findFolder(state, requireOpt(opts, "into"), {
		root,
		cwd: process.cwd(),
	});
	const rel = relative(root, resolve(file));
	const entry = parseLegacyEntry(
		readFileSync(resolve(file), "utf8"),
		rel.split("/").pop(),
	);
	const at = `${entry.date}T00:00Z`;
	const artifact = `${folder.dir}/artifacts/${rel.split("/").pop()}`;
	const plan = [
		`${rel} → ${folder.dir}`,
		...entry.decisions.map((section) => `  D: ${section.heading}`),
		`  W: ${entry.title} (${entry.work.length} section(s), preamble ${entry.preamble.length} chars)`,
		`  pins: ${entry.refs.length}${iff(entry.refs.length > 0 && !opts.pr, " — kept as text; pass --pr N to attach them as a PR block")}`,
		`  original → ${artifact}`,
	];
	if (opts["dry-run"]) {
		process.stdout.write(`${plan.join("\n")}\n`);
		return;
	}
	entry.decisions.forEach((section) => {
		addDecision(
			root,
			folder,
			{
				title:
					section.heading.replace(/^(owner\s+)?input\s*\d*\s*[—-]?\s*/i, "") ||
					section.heading,
				by: "owner",
			},
			section.body || "(no body in the legacy entry)",
			at,
		);
	});
	const workBody = [
		iff(entry.preamble !== "", `${entry.preamble}\n`),
		...entry.work.map(
			(section) => `### ${section.heading}\n\n${section.body}\n`,
		),
		iff(
			entry.refs.length > 0 && !opts.pr,
			`### Refs (legacy pins)\n\n${entry.refs.map((ref) => `- ${ref.path} @ ${ref.blob}`).join("\n")}\n`,
		),
		`Migrated from the single-file entry \`${rel}\`, kept verbatim at \`${artifact}\`.`,
	]
		.filter(Boolean)
		.join("\n");
	addWork(root, folder, { title: entry.title }, workBody, at);
	if (opts.pr && entry.refs.length > 0) {
		const number = Number(opts.pr);
		const pr = prInfo(repo, number);
		folder.meta.prs = [
			...folder.meta.prs.filter((block) => block.number !== number),
			{
				number,
				ref: `${repo}#${number}`,
				title: pr.title,
				head: pr.head,
				headRef: pr.headRef,
				base: pr.base,
				merged: pr.merged,
				pinnedAt: at,
				migrated: true,
				refs: entry.refs,
			},
		].sort((a, b) => a.number - b.number);
	}
	mkdirSync(join(root, folder.dir, "artifacts"), { recursive: true });
	git(["mv", rel, artifact], root);
	writeMeta(root, folder);
	writeIndex(root, repo);
	process.stdout.write(`${plan.join("\n")}\nmigrated\n`);
};

const cmdClose = (positional, opts) => {
	const key =
		positional[0] ?? fail("usage: blackbox close <folder> [--status S]");
	const root = repoRoot();
	const repo = repoSlug(root);
	const folder = findFolder(loadState(fsReader(root)), key, {
		root,
		cwd: process.cwd(),
	});
	const status = String(opts.status ?? "closed");
	if (!STATUSES.includes(status)) {
		fail(`--status must be ${STATUSES.join("|")}`);
	}
	if (folder.meta.status === status) {
		process.stdout.write(`${folder.meta.ref}: already ${status}\n`);
		return;
	}
	refreshMerges(folder, repo);
	folder.meta.status = status;
	folder.meta.closed = (() => {
		if (status === "closed") {
			return today();
		}
		return null;
	})();
	writeMeta(root, folder);
	writeIndex(root, repo);
	process.stdout.write(`${folder.meta.ref}: ${status}\n`);
};

const cmdIndex = (_positional, opts) => {
	const root = repoRoot();
	const repo = repoSlug(root);
	if (opts.check) {
		const reader = fsReader(root);
		const problems = [];
		validateReadmes(loadState(reader), reader, repo, problems);
		problems.forEach((problem) => {
			process.stderr.write(`  - ${problem}\n`);
		});
		if (problems.length > 0) {
			process.exitCode = 1;
		}
		return;
	}
	const state = writeIndex(root, repo);
	process.stdout.write(
		`indexed ${state.items.length} item(s), ${state.folders.length} folder(s)\n`,
	);
};

const cmdCheck = (_positional, opts) => {
	const root = repoRoot();
	const repo = opts.repo ?? repoSlug(root);
	const release = Boolean(opts.release);
	const result = (() => {
		if (opts.pr) {
			return checkPr({ root, repo, number: Number(opts.pr), release });
		}
		return checkLocal({ root, repo, release });
	})();
	if (!report(result, (text) => process.stdout.write(text))) {
		process.exitCode = 1;
	}
};

const cmdStatus = () => {
	const cwd = process.cwd();
	const dir = rawDir(cwd);
	const sessions = (() => {
		if (!existsSync(dir)) {
			return [];
		}
		return readdirSync(dir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => name.slice(0, -".jsonl".length));
	})();
	const lines = sessions
		.map((session) => statusLine(cwd, session))
		.filter((line) => line !== null);
	if (lines.length > 0) {
		process.stdout.write(`${lines.join("\n")}\n`);
		return;
	}
	process.stdout.write(
		`${statusLine(cwd, null) ?? "[blackbox] no open work items"}\n`,
	);
};

// ------------------------------------------------------------------ hooks

const readStdinJson = () => {
	try {
		return JSON.parse(readFileSync(0, "utf8"));
	} catch {
		return {};
	}
};

/** Slash commands and harness-generated wake-ups are stored but never counted as owner inputs. */
const isHarnessInput = (prompt) =>
	prompt.startsWith("/") ||
	/^(<system-reminder>|<task-notification>|\[SYSTEM NOTIFICATION|<teammate-message)/.test(
		prompt,
	);

const hookPrompt = (input) => {
	const cwd = input.cwd ?? process.cwd();
	const session = input.session_id ?? "unknown";
	const prompt = String(input.prompt ?? input.user_input ?? "").trim();
	if (prompt === "") {
		return;
	}
	const count = readRaw(join(rawDir(cwd), `${session}.jsonl`)).filter(
		(entry) => entry.n !== undefined,
	).length;
	appendRaw(cwd, session, {
		n: count + 1,
		at: nowIso(),
		cwd,
		command: isHarnessInput(prompt),
		prompt,
	});
	const line = statusLine(cwd, session);
	if (line !== null) {
		process.stdout.write(`${line}\n`);
	}
};

const hookStop = (input) => {
	if (input.stop_hook_active) {
		return;
	}
	const cwd = input.cwd ?? process.cwd();
	const session = input.session_id ?? "unknown";
	const pending = unrecorded(readRaw(join(rawDir(cwd), `${session}.jsonl`)));
	if (pending.length === 0 || openFoldersEverywhere(cwd).length === 0) {
		return;
	}
	const numbers = pending.map((entry) => entry.n).join(", #");
	process.stdout.write(
		`${JSON.stringify({
			systemMessage: `[blackbox] ${pending.length} owner input(s) this session are neither a decision nor acknowledged: #${numbers}`,
		})}\n`,
	);
};

const VALUE_FLAGS = new Set([
	"-R",
	"--repo",
	"-t",
	"--subject",
	"-b",
	"--body",
	"-F",
	"--body-file",
	"--match-head-commit",
	"-A",
	"--author-email",
]);

/** The PR selector and repo of a `gh pr merge …` / `gh api …/pulls/N/merge` command, or null. */
export const parseMergeCommand = (command) => {
	// Only a `gh` in command position counts: the phrase inside a heredoc or
	// a quoted string (documentation being written) must not trip the gate.
	const api = command.match(
		/(?:^|[;&|(]|\n)\s*gh\s+api\b[^|;&\n]*?(?:\s|\/)repos\/([^/\s]+\/[^/\s]+)\/pulls\/(\d+)\/merge\b/,
	);
	if (api) {
		return { repo: api[1], selector: api[2] };
	}
	const merge = command.match(/(?:^|[;&|(]|\n)\s*gh\s+pr\s+merge\b([^|;&\n]*)/);
	if (!merge) {
		return null;
	}
	const tokens = merge[1].split(/\s+/).filter(Boolean);
	const walk = (index, acc) => {
		if (index >= tokens.length) {
			return acc;
		}
		const token = tokens[index];
		if (!token.startsWith("-")) {
			if (acc.selector === null) {
				return walk(index + 1, { ...acc, selector: token });
			}
			return walk(index + 1, acc);
		}
		if (!VALUE_FLAGS.has(token)) {
			return walk(index + 1, acc);
		}
		const value = tokens[index + 1] ?? null;
		if (token === "-R" || token === "--repo") {
			return walk(index + 2, { ...acc, repo: value });
		}
		return walk(index + 2, acc);
	};
	return walk(0, { repo: null, selector: null });
};

const resolvePrNumber = (repo, selector) => {
	const args = ["pr", "view"];
	if (selector !== null) {
		args.push(selector);
	}
	const view = run("gh", [...args, "-R", repo, "--json", "number"]);
	if (!view.ok) {
		fail(`cannot resolve PR ${selector ?? "(current branch)"}: ${view.err}`);
	}
	return JSON.parse(view.out).number;
};

const block = (text) => {
	process.stderr.write(`${text}\n`);
	process.exit(2);
};

const gateMerge = ({ root, repo, number }) => {
	const chunks = [];
	const ok = report(checkPr({ root, repo, number, release: false }), (text) =>
		chunks.push(text),
	);
	if (!ok) {
		block(
			`${chunks.join("")}Merge blocked until the blackbox record is complete: fix the items above (record, pin, index), commit and push them to the PR branch, then retry.`,
		);
	}
	process.stdout.write(chunks.join(""));
};

const gateBrief = (cwd, tool, toolInput) => {
	const content = String(toolInput.content ?? toolInput.new_string ?? "");
	const cited = [...content.matchAll(/#(\d+)\/(R\d+)\b/g)].map((match) => ({
		number: match[1],
		id: match[2],
	}));
	if (tool === "Write" && cited.length === 0) {
		block(
			"A team brief must cite the rulings it executes as #<issue>/R<n>. Record each ruling first (blackbox add ruling <folder> --kind interpretation|extension|stop --title \"…\" --basis D1 <<'EOF' … EOF), then cite it.",
		);
	}
	const open = openFoldersEverywhere(cwd);
	const missing = cited.filter(
		(cite) =>
			!open.some(
				(folder) =>
					folder.meta.ref.endsWith(`#${cite.number}`) &&
					folder.meta.decisions.some((entry) => entry.id === cite.id),
			),
	);
	if (missing.length > 0) {
		block(
			`The brief cites rulings that are not recorded in any open work item: ${missing.map((cite) => `#${cite.number}/${cite.id}`).join(", ")}. Record them with blackbox add ruling before briefing.`,
		);
	}
};

const hookPreTool = (input) => {
	const cwd = input.cwd ?? process.cwd();
	const tool = input.tool_name ?? "";
	const toolInput = input.tool_input ?? {};
	if (tool === "Bash") {
		const parsed = parseMergeCommand(String(toolInput.command ?? ""));
		if (parsed === null) {
			return;
		}
		const root = repoRoot(cwd);
		const repo = parsed.repo ?? repoSlug(root);
		gateMerge({ root, repo, number: resolvePrNumber(repo, parsed.selector) });
		return;
	}
	if (/merge_pull_request$/.test(tool)) {
		const root = repoRoot(cwd);
		const repo = (() => {
			if (toolInput.owner && toolInput.repo) {
				return `${toolInput.owner}/${toolInput.repo}`;
			}
			return repoSlug(root);
		})();
		gateMerge({
			root,
			repo,
			number: Number(toolInput.pullNumber ?? toolInput.pull_number),
		});
		return;
	}
	if (
		(tool === "Write" || tool === "Edit") &&
		/(^|\/)\.agents\/brief[^/]*\.md$/.test(String(toolInput.file_path ?? ""))
	) {
		gateBrief(cwd, tool, toolInput);
	}
};

const hookPostTool = (input) => {
	const cwd = input.cwd ?? process.cwd();
	if (!["Write", "Edit", "MultiEdit"].includes(input.tool_name ?? "")) {
		return;
	}
	const filePath = String(input.tool_input?.file_path ?? "");
	if (!/(^|\/)openspec\/task-times\.csv$/.test(filePath)) {
		return;
	}
	const root = repoRoot(dirname(resolve(cwd, filePath)));
	const open = loadState(fsReader(root)).folders.filter(
		(folder) => folder.meta.status !== "closed",
	);
	if (open.length === 0) {
		return;
	}
	block(
		`[blackbox] task-times.csv changed — record the group's build and measurements now: blackbox add work ${open.map((folder) => folder.name).join("|")} --title "group N: …" [--pr N] --decisions D1,R2 <<'EOF' … EOF`,
	);
};

const HOOKS = {
	prompt: hookPrompt,
	stop: hookStop,
	"pre-tool": hookPreTool,
	"post-tool": hookPostTool,
};

const cmdHook = (positional) => {
	const event = positional[0];
	const handler =
		HOOKS[event] ?? fail("usage: blackbox hook prompt|stop|pre-tool|post-tool");
	try {
		handler(readStdinJson());
	} catch (error) {
		if (!(error instanceof BlackboxError)) {
			throw error;
		}
		// The merge gate fails closed; the observers fail open and stay quiet.
		if (event === "pre-tool") {
			block(`blackbox: ${error.message}`);
		}
	}
};

// --------------------------------------------------------------- snippets

const snippets = (
	script,
) => `Register the hooks in the repository's committed .claude/settings.json:

  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \\"$CLAUDE_PROJECT_DIR\\"/${script} hook prompt", "timeout": 20 }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node \\"$CLAUDE_PROJECT_DIR\\"/${script} hook stop", "timeout": 20 }] }],
    "PreToolUse":       [{ "matcher": "Bash|Write|Edit|mcp__.*merge_pull_request", "hooks": [{ "type": "command", "command": "node \\"$CLAUDE_PROJECT_DIR\\"/${script} hook pre-tool", "timeout": 120 }] }],
    "PostToolUse":      [{ "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "node \\"$CLAUDE_PROJECT_DIR\\"/${script} hook post-tool", "timeout": 20 }] }]
  }

CI (GitHub Actions) — run first, make every other job \`needs: blackbox\`, and mark it a required status check.
Bot mode: with a GitHub App (secrets BLACKBOX_APP_ID + BLACKBOX_APP_PRIVATE_KEY) CI commits the pins through the
Git Data API — signed by GitHub, attributed to the App — and the ref update re-runs CI; with only a PAT
(BLACKBOX_TOKEN) it pushes with git, unsigned; with neither it verifies and the lead pins locally.

  blackbox:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: read
    env:
      HAS_APP: \${{ secrets.BLACKBOX_APP_ID != '' }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: \${{ github.event.pull_request.head.ref || github.ref_name }}
          token: \${{ secrets.BLACKBOX_TOKEN || github.token }}
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/create-github-app-token@v2
        id: app
        if: env.HAS_APP == 'true'
        with:
          app-id: \${{ secrets.BLACKBOX_APP_ID }}
          private-key: \${{ secrets.BLACKBOX_APP_PRIVATE_KEY }}
      - if: github.event_name == 'pull_request'
        run: node ${script} ci --pr \${{ github.event.pull_request.number }}
        env:
          GH_TOKEN: \${{ steps.app.outputs.token || github.token }}
          BLACKBOX_PUSH: \${{ steps.app.outputs.token && 'api' || (secrets.BLACKBOX_TOKEN && 'git' || '') }}
      - if: github.event_name != 'pull_request'
        run: node ${script} check
        env:
          GH_TOKEN: \${{ github.token }}

package.json (optional): "check:blackbox": "node ${script} check"`;

const HELP = `blackbox ${VERSION} — flight recorder for AI-built work

  init [dir] [--update]                 create <dir>/.blackbox, vendor this script, print hook + CI snippets
  new <ref> [--item DIR] [--parent REF] [--kind issue|pr] [--title T] [--origin REF]
                                        folder + meta.json for a work item (ref: 752, #752, owner/repo#752, URL)
  add decision <folder> --title T [--raw SESSION#3,4] < body.md
  add ruling   <folder> --title T --kind interpretation|extension|stop [--basis D1,R2] [--by lead] < body.md
  add work     <folder> --title T [--pr N] [--decisions D1,R2] < body.md
                                        every add accepts --at YYYY-MM-DD[THH:MMZ] for migrated history
  ack <SESSION#3,4> --why W             mark owner inputs as non-decisions
  ratify <folder> R# [--reject] [--why W] [--by owner|evaluator] [--decision D#]
  pin <folder> --pr N                   pin the PR's changed files (blob SHAs) into meta.json, from the local HEAD
  ci --pr N                             CI entry: pin every folder the PR belongs to (pinned, keyed, or linked by
                                        Closes/Refs #N in the body); commit + push when BLACKBOX_TOKEN is set; then check
  migrate <legacy.md> --into <folder> [--pr N] [--dry-run]
                                        split a single-file entry into D#/W# entries, keep the original under artifacts/
  close <folder> [--status closed|merged-pending|open]
  index [--check]                       regenerate (or verify) every README
  check [--pr N] [--release] [--repo O/R]
                                        the gate: structure, uniqueness, pins both ways, READMEs; release adds ratification
  status                                open work items and unrecorded owner inputs
  hook prompt|stop|pre-tool|post-tool   Claude Code hook entry points (JSON on stdin)

Bodies are read from stdin (or --body-file). Folder keys accept the number, #number, or owner/repo#number.`;

// ------------------------------------------------------------------- main

export const parseArgv = (argv) => {
	const positional = [];
	const opts = {};
	const walk = (index) => {
		if (index >= argv.length) {
			return;
		}
		const arg = argv[index];
		if (!arg.startsWith("--")) {
			positional.push(arg);
			return walk(index + 1);
		}
		const [name, inlineValue] = arg.slice(2).split(/=(.*)/s);
		if (inlineValue !== undefined) {
			opts[name] = inlineValue;
			return walk(index + 1);
		}
		const next = argv[index + 1];
		if (next !== undefined && !next.startsWith("--")) {
			opts[name] = next;
			return walk(index + 2);
		}
		opts[name] = true;
		return walk(index + 1);
	};
	walk(0);
	return { positional, opts };
};

const COMMANDS = {
	init: cmdInit,
	new: cmdNew,
	add: cmdAdd,
	ack: cmdAck,
	ratify: cmdRatify,
	pin: cmdPin,
	ci: cmdCi,
	migrate: cmdMigrate,
	close: cmdClose,
	index: cmdIndex,
	check: cmdCheck,
	status: cmdStatus,
	hook: cmdHook,
};

export const main = (argv) => {
	const [command, ...rest] = argv;
	if (!command || command === "help" || command === "--help") {
		process.stdout.write(`${HELP}\n`);
		return;
	}
	if (command === "--version") {
		process.stdout.write(`${VERSION}\n`);
		return;
	}
	const handler =
		COMMANDS[command] ?? fail(`unknown command ${command}\n\n${HELP}`);
	const { positional, opts } = parseArgv(rest);
	handler(positional, opts);
};

const isEntry =
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof BlackboxError)) {
			throw error;
		}
		process.stderr.write(`blackbox: ${error.message}\n`);
		process.exit(1);
	}
}
