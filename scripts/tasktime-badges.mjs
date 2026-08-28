#!/usr/bin/env node
// #305: keeps README.md's task-time badge block always current by
// construction -- rendered from `openspec/task-times.csv` (the D88
// ledger), the same file the numbers live in, so the two cannot drift
// apart. Output is a pure function of the ledger: an unchanged ledger
// re-renders byte-identically, which is what keeps CI's
// `git diff --exit-code README.md` step meaningful.
//
// Metric definitions (owner-approved #305, full 4-badge set):
// a ledger row with a positive `est_min` is an estimated task; a row
// without one is overhead (rework, coordination, process cost) recorded
// in its own right. `waited_user_min` is excluded by construction --
// the ledger keeps owner-decision wait in its own column, so pure work
// time is what every metric reads (owner rule).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README_PATH = join(REPO_ROOT, "README.md");
const LEDGER_PATH = join(REPO_ROOT, "openspec", "task-times.csv");
const BADGE_START = "<!-- tasktime-badges:start -->";
const BADGE_END = "<!-- tasktime-badges:end -->";

// `notes` is the last column and free text -- split each line on the
// first seven commas only, so a comma inside a note cannot shift fields.
const FIELD_COUNT = 8;
const parseRow = (line) => {
	const parts = line.split(",");
	const head = parts.slice(0, FIELD_COUNT - 1);
	const notes = parts.slice(FIELD_COUNT - 1).join(",");
	return [...head, notes];
};

const parseMinutes = (raw) => {
	if (raw.trim() === "") {
		return 0;
	}
	return Number(raw);
};

const readLedger = () => {
	const lines = readFileSync(LEDGER_PATH, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "");
	return lines.slice(1).map(parseRow);
};

const computeMetrics = (rows) => {
	const estimated = rows.filter((row) => parseMinutes(row[4]) > 0);
	const overhead = rows.filter((row) => parseMinutes(row[4]) === 0);
	const actualSum = estimated.reduce(
		(sum, row) => sum + parseMinutes(row[5]),
		0,
	);
	const estimateSum = estimated.reduce(
		(sum, row) => sum + parseMinutes(row[4]),
		0,
	);
	const overheadSum = overhead.reduce(
		(sum, row) => sum + parseMinutes(row[5]),
		0,
	);
	return {
		taskCount: estimated.length,
		averageMinutes: Math.round(actualSum / estimated.length),
		multiplier: (actualSum / estimateSum).toFixed(2),
		overheadPercent: Math.round(
			(overheadSum / (overheadSum + actualSum)) * 100,
		),
	};
};

// shields.io's static-badge path segments: `-` is the segment separator,
// so a literal `-` inside a label/message must be doubled first (shields'
// own escaping rule) before the rest is percent-encoded.
const shieldsSegment = (text) => encodeURIComponent(text.replaceAll("-", "--"));

const badge = (label, message) => {
	const url = `https://img.shields.io/badge/${shieldsSegment(label)}-${shieldsSegment(message)}-blue`;
	return `[![${label} · ${message}](${url})](openspec/task-times.csv)`;
};

const renderBlock = (metrics) => {
	const badges = [
		badge("tasks", `${metrics.taskCount} done`),
		badge("avg task", `${metrics.averageMinutes}m`),
		badge("estimate", `${metrics.multiplier}x`),
		badge("overhead", `${metrics.overheadPercent}%`),
	];
	return `${BADGE_START}\n${badges.join("\n")}\n${BADGE_END}`;
};

const replaceBlock = (readme, block) => {
	const start = readme.indexOf(BADGE_START);
	const end = readme.indexOf(BADGE_END);
	if (start === -1 || end === -1) {
		console.error(
			`error[check-tasktime-readme]: README.md is missing the ${BADGE_START} block. Next: restore the marker pair and re-run pnpm check:tasktime`,
		);
		process.exit(1);
	}
	return readme.slice(0, start) + block + readme.slice(end + BADGE_END.length);
};

const checkOnly = process.argv.slice(2).includes("--check");
const readme = readFileSync(README_PATH, "utf8");
const next = replaceBlock(readme, renderBlock(computeMetrics(readLedger())));

if (next === readme) {
	console.log("check-tasktime: README task-time badges are current");
	process.exit(0);
}
if (checkOnly) {
	console.error(
		"error[check-tasktime-readme]: README's task-time badges are stale. Next: run pnpm check:tasktime and commit README.md",
	);
	process.exit(1);
}
writeFileSync(README_PATH, next);
console.log("check-tasktime: README task-time badges rewritten");
