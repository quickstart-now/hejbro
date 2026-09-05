#!/usr/bin/env node
// #278: keeps README.md's CRAP-gate item and shields badge always current
// by construction -- rewritten from the exact same `computeCrapReport()`
// results `check-crap.mjs` gates on (`./crap-report.mjs`), so the two can
// never drift apart.
//
// Idempotency design (owner-approved #278 asked for `git diff --exit-code
// README.md` in CI; refined during implementation, reported to main):
// naively re-stamping the current sha/date on every run would make that
// CI step fail on every single commit, since the sha changes every time
// even when the *numbers* (scanned count / violations / highest score)
// didn't move. So: the sha/date only refresh when one of those three
// numbers differs from what is already recorded in the README's block --
// otherwise this script's output (and the README) is a byte-for-byte
// no-op. This keeps `git diff --exit-code README.md` meaningful (it
// catches a stale block after a real change) without making it
// permanently red. The previous numbers are parsed back out of the
// rendered sentence itself (not kept in a second stored copy), so there
// is exactly one place they live -- and that place is the sentence as
// *committed* (`git show HEAD:README.md`), not the working copy (#574).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CRAP_THRESHOLD,
	computeCrapReport,
	REPO_ROOT,
	TARGET_PACKAGES,
} from "./crap-report.mjs";

const README_PATH = join(REPO_ROOT, "README.md");
const BLOCK_START = "<!-- crap:start -->";
const BLOCK_END = "<!-- crap:end -->";
const BADGE_START = "<!-- crap-badge:start -->";
const BADGE_END = "<!-- crap-badge:end -->";

// shields.io's static-badge path segments: `-` is the segment separator,
// so a literal `-` inside a label/message must be doubled first (shields'
// own escaping rule) before the rest is percent-encoded.
const shieldsSegment = (text) => encodeURIComponent(text.replaceAll("-", "--"));

const badgeColor = (violationCount) => {
	if (violationCount === 0) {
		return "brightgreen";
	}
	return "red";
};

const badgeUrl = (scanned, violationCount) => {
	const label = shieldsSegment(`CRAP ≤ ${CRAP_THRESHOLD}`);
	const message = shieldsSegment(`${violationCount} / ${scanned}`);
	return `https://img.shields.io/badge/${label}-${message}-${badgeColor(violationCount)}`;
};

const badgeMarkdown = (scanned, violationCount) =>
	`[![CRAP ≤ ${CRAP_THRESHOLD} · ${violationCount} / ${scanned}](${badgeUrl(scanned, violationCount)})](#status)`;

const currentShortSha = () =>
	execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT })
		.toString()
		.trim();

const today = () => new Date().toISOString().slice(0, 10);

// Same derivation `check-crap.mjs:25` uses for its own scan-line, so the
// README sentence can never name a different package set than the gate.
const blockText = (scanned, violationCount, highest, sha, date) =>
	`**Code quality gate:** every named function in ${TARGET_PACKAGES.map((pkg) => `\`${pkg.name}\``).join(", ")} must score **CRAP ≤ ${CRAP_THRESHOLD}** (CRAP = CC² × (1 − coverage)³ + CC; gated in CI). Current: **${violationCount} of ${scanned} functions** over the threshold, highest score ${highest} — measured at \`${sha}\` (${date}).`;

// Matches exactly what `blockText` renders -- the read side of the one
// place these numbers live (see the file comment above).
const PREVIOUS_BLOCK_RE =
	/Current: \*\*(\d+) of (\d+) functions\*\* over the threshold, highest score ([\d.]+) — measured at `([0-9a-f]+)` \((\d{4}-\d{2}-\d{2})\)/;

const parsePreviousBlock = (readme) => {
	const between = readme.split(BLOCK_START)[1]?.split(BLOCK_END)[0];
	if (between === undefined) {
		return null;
	}
	const match = PREVIOUS_BLOCK_RE.exec(between);
	if (!match) {
		return null;
	}
	const [, violationCount, scanned, highest, sha, date] = match;
	return {
		violationCount: Number(violationCount),
		scanned: Number(scanned),
		highest,
		sha,
		date,
	};
};

const replaceBetween = (text, startMarker, endMarker, replacement) => {
	const start = text.indexOf(startMarker);
	const end = text.indexOf(endMarker);
	if (start === -1 || end === -1) {
		throw new Error(
			`update-crap-readme: README.md is missing ${startMarker}/${endMarker} -- see #278.`,
		);
	}
	return `${text.slice(0, start + startMarker.length)}\n${replacement}\n${text.slice(end)}`;
};

const { results, violations } = computeCrapReport();
const scanned = results.length;
const violationCount = violations.length;
const highest = results
	.reduce((max, entry) => Math.max(max, entry.crap), 0)
	.toFixed(2);

const readme = readFileSync(README_PATH, "utf8");
// The baseline is the *committed* README, never the working tree: a run
// before committing leaves a fresh stamp in the working copy, and reading
// that copy back as "previous" would make every later run merely confirm
// it -- the badge then points at a commit that never carried those
// numbers (#574). HEAD's copy is what CI's `git diff --exit-code` compares
// against, so it is the only baseline that keeps that check meaningful --
// which also means every run, the no-op one included, needs a repository
// with README.md committed (a `git archive` export tree cannot run this).
const committedReadme = () => {
	try {
		return execFileSync("git", ["show", "HEAD:README.md"], {
			cwd: REPO_ROOT,
			stdio: ["ignore", "pipe", "pipe"],
		}).toString();
	} catch (error) {
		throw new Error(
			`update-crap-readme: cannot read README.md at HEAD (${failureReason(error)}) -- the committed README is the baseline (#574); run inside the repository with README.md committed.`,
		);
	}
};
const failureReason = (error) => {
	if (error instanceof Error) {
		return error.message.trim();
	}
	return String(error).trim();
};
const previous = parsePreviousBlock(committedReadme());
const numbersUnchanged =
	previous !== null &&
	previous.scanned === scanned &&
	previous.violationCount === violationCount &&
	previous.highest === highest;

// `computeFresh` is a thunk, not a value, so the unchanged path never
// shells out to `git rev-parse` (or reformats today's date); the one git
// call every path makes is the HEAD baseline read above.
const stampFor = (unchanged, previousValue, computeFresh) => {
	if (unchanged) {
		return previousValue;
	}
	return computeFresh();
};

const sha = stampFor(numbersUnchanged, previous?.sha, currentShortSha);
const date = stampFor(numbersUnchanged, previous?.date, today);

const withBlock = replaceBetween(
	readme,
	BLOCK_START,
	BLOCK_END,
	blockText(scanned, violationCount, highest, sha, date),
);
const withBadge = replaceBetween(
	withBlock,
	BADGE_START,
	BADGE_END,
	badgeMarkdown(scanned, violationCount),
);

// Three outcomes, not two: numbers unchanged and the file already says so;
// numbers unchanged but the working copy carried a different stamp (the
// #574 case -- the block is restored from HEAD); numbers changed.
// #497: the verb states what this run DID to the file, never what it
// found -- "unchanged" once read as "nothing to do" when the file had in
// fact just been written to the same bytes, and "refreshed" hid which
// numbers moved. The movement is spelled out so the reader never has to
// diff the block to learn it.
const movement = () => {
	if (previous === null) {
		return `no committed block to compare against; now ${scanned} scanned, ${violationCount} over, highest ${highest}`;
	}
	return `scanned ${previous.scanned}->${scanned}, over ${previous.violationCount}->${violationCount}, highest ${previous.highest}->${highest}`;
};

const changeVerb = () => {
	if (numbersUnchanged && withBadge === readme) {
		return "left byte-identical (numbers unchanged; nothing to commit)";
	}
	if (numbersUnchanged) {
		return "REWRITTEN to HEAD's block (numbers unchanged; the working copy carried a different stamp -- commit or discard README.md)";
	}
	return `REWRITTEN (${movement()} -- commit README.md)`;
};

const summaryLine = (verb) =>
	`update-crap-readme: README.md ${verb} -- ${violationCount} of ${scanned} functions over CRAP ${CRAP_THRESHOLD}, highest ${highest}, measured at ${sha} (${date}).`;

// #336 (review-gate fidelity): `--check` reports what the write would do
// without touching the tree. A verdict run at a frozen SHA must be able
// to cite this gate without dirtying README.md as a side effect. The
// write path stays the default -- CI's `git diff --exit-code README.md`
// and the done-checklist refresh both rely on it.
if (process.argv.includes("--check")) {
	if (withBadge === readme) {
		console.log(summaryLine("current (--check: no write needed)"));
	} else {
		console.log(summaryLine("STALE (--check: not written)"));
		console.log("update-crap-readme: would-be block:");
		console.log(blockText(scanned, violationCount, highest, sha, date));
	}
} else {
	writeFileSync(README_PATH, withBadge);
	console.log(summaryLine(changeVerb()));
}
