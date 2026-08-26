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
// is exactly one place they live.
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
const previous = parsePreviousBlock(readme);
const numbersUnchanged =
	previous !== null &&
	previous.scanned === scanned &&
	previous.violationCount === violationCount &&
	previous.highest === highest;

// `computeFresh` is a thunk, not a value, so the unchanged path never
// shells out to `git rev-parse` (or reformats today's date) at all.
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

writeFileSync(README_PATH, withBadge);

const changeVerb = () => {
	if (numbersUnchanged) {
		return "unchanged (numbers match)";
	}
	return "refreshed";
};

console.log(
	`update-crap-readme: README.md ${changeVerb()} -- ${violationCount} of ${scanned} functions over CRAP ${CRAP_THRESHOLD}, highest ${highest}, measured at ${sha} (${date}).`,
);
