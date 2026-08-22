import { describe, expect, it } from "vitest";
import type { ChainEntry, DuplicateVersionGroup } from "../src";
import {
	duplicateVersionFallbackOptions,
	orderGroupByChain,
	planDuplicateVersionFix,
} from "../src";

const entry = (
	fileName: string,
	parent: string,
	current: string,
): ChainEntry => ({ fileName, parent, current });

const group = (
	version: string,
	fileNames: ReadonlyArray<string>,
): DuplicateVersionGroup => ({ version, fileNames });

describe("orderGroupByChain", () => {
	it("orders a 2-member group earliest-first by their own parent/current links", () => {
		const entries = [
			entry("20260822010000_b.sql", "sha256:a-current", "sha256:b-current"),
			entry("20260822010000_a.sql", "sha256:root", "sha256:a-current"),
		];
		expect(orderGroupByChain(entries)).toEqual([entries[1], entries[0]]);
	});

	it("orders a 3-member group earliest-first", () => {
		const entryA = entry("20260822010000_a.sql", "sha256:root", "sha256:a");
		const entryB = entry("20260822010000_b.sql", "sha256:a", "sha256:b");
		const entryC = entry("20260822010000_c.sql", "sha256:b", "sha256:c");
		expect(orderGroupByChain([entryC, entryA, entryB])).toEqual([
			entryA,
			entryB,
			entryC,
		]);
	});

	it("returns null for a genuine fork — two members sharing the exact same parent", () => {
		const entries = [
			entry("20260822010000_a.sql", "sha256:root", "sha256:a"),
			entry("20260822010000_b.sql", "sha256:root", "sha256:b"),
		];
		expect(orderGroupByChain(entries)).toBeNull();
	});

	it("returns null for a 3-way fork sharing the same parent", () => {
		const entries = [
			entry("20260822010000_a.sql", "sha256:root", "sha256:a"),
			entry("20260822010000_b.sql", "sha256:root", "sha256:b"),
			entry("20260822010000_c.sql", "sha256:root", "sha256:c"),
		];
		expect(orderGroupByChain(entries)).toBeNull();
	});

	// #154 ratchet-5: a fork one level *into* the chain (not at the root)
	// has a single, well-defined root (r) -- the root-count check alone
	// wouldn't reject it. It's still rejected: walkGroup consumes exactly
	// one of {a, b} when stepping off r (an arbitrary pick via .find()),
	// then finds nothing whose parent matches that pick's own current, so
	// the walk fails to consume every entry. This is the case removing
	// the former hasFork pre-check depends on walkGroup already covering.
	it("returns null for a fork one level into the chain, not at the root", () => {
		const root = entry("20260822010000_r.sql", "sha256:external", "sha256:r");
		const entries = [
			root,
			entry("20260822010000_a.sql", "sha256:r", "sha256:a"),
			entry("20260822010000_b.sql", "sha256:r", "sha256:b"),
		];
		expect(orderGroupByChain(entries)).toBeNull();
	});
});

describe("planDuplicateVersionFix", () => {
	it("plans a rename for the later member of a resolvable 2-member group (positive control)", () => {
		const duplicateGroup = group("20260822010000", [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
		]);
		const groupEntries = [
			entry("20260822010000_a.sql", "sha256:root", "sha256:a"),
			entry("20260822010000_b.sql", "sha256:a", "sha256:b"),
		];
		const allFileNames = ["20260822010000_a.sql", "20260822010000_b.sql"];
		const plan = planDuplicateVersionFix(
			duplicateGroup,
			groupEntries,
			allFileNames,
			"timestamp",
		);
		expect(plan).toEqual([
			{
				fileName: "20260822010000_b.sql",
				newFileName: "20260822010001_b.sql",
			},
		]);
	});

	it("stays clear of the current directory maximum, not just this group's own version", () => {
		const duplicateGroup = group("20260822010000", [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
		]);
		const groupEntries = [
			entry("20260822010000_a.sql", "sha256:mid", "sha256:a"),
			entry("20260822010000_b.sql", "sha256:a", "sha256:b"),
		];
		const allFileNames = [
			"20260822005900_earlier.sql",
			"20260822010000_a.sql",
			"20260822010000_b.sql",
			"20260822020000_later.sql",
		];
		const plan = planDuplicateVersionFix(
			duplicateGroup,
			groupEntries,
			allFileNames,
			"timestamp",
		);
		expect(plan).toEqual([
			{
				fileName: "20260822010000_b.sql",
				newFileName: "20260822020001_b.sql",
			},
		]);
	});

	it("stages a 3-way collision's renames a second apart from each other", () => {
		const duplicateGroup = group("20260822010000", [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
			"20260822010000_c.sql",
		]);
		const groupEntries = [
			entry("20260822010000_a.sql", "sha256:root", "sha256:a"),
			entry("20260822010000_b.sql", "sha256:a", "sha256:b"),
			entry("20260822010000_c.sql", "sha256:b", "sha256:c"),
		];
		const allFileNames = [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
			"20260822010000_c.sql",
		];
		const plan = planDuplicateVersionFix(
			duplicateGroup,
			groupEntries,
			allFileNames,
			"timestamp",
		);
		expect(plan).toEqual([
			{
				fileName: "20260822010000_b.sql",
				newFileName: "20260822010001_b.sql",
			},
			{
				fileName: "20260822010000_c.sql",
				newFileName: "20260822010002_c.sql",
			},
		]);
	});

	// #154 ratchet-5: every test above used strategy: "timestamp" -- the
	// "unix" strategy (parseUnixVersion) had zero coverage, both its happy
	// path and its defensive non-finite fallback.
	it("plans a rename using the unix strategy's own seconds-since-epoch clock", () => {
		const duplicateGroup = group("1700000000", [
			"1700000000_a.sql",
			"1700000000_b.sql",
		]);
		const groupEntries = [
			entry("1700000000_a.sql", "sha256:root", "sha256:a"),
			entry("1700000000_b.sql", "sha256:a", "sha256:b"),
		];
		const allFileNames = ["1700000000_a.sql", "1700000000_b.sql"];
		const plan = planDuplicateVersionFix(
			duplicateGroup,
			groupEntries,
			allFileNames,
			"unix",
		);
		expect(plan).toEqual([
			{
				fileName: "1700000000_b.sql",
				newFileName: "1700000001_b.sql",
			},
		]);
	});

	it("treats a unix-strategy version that overflows Number as unparseable (defensive)", () => {
		const hugeVersion = "9".repeat(400);
		const duplicateGroup = group(hugeVersion, [
			`${hugeVersion}_a.sql`,
			`${hugeVersion}_b.sql`,
		]);
		const groupEntries = [
			entry(`${hugeVersion}_a.sql`, "sha256:root", "sha256:a"),
			entry(`${hugeVersion}_b.sql`, "sha256:a", "sha256:b"),
		];
		const allFileNames = [`${hugeVersion}_a.sql`, `${hugeVersion}_b.sql`];
		const plan = planDuplicateVersionFix(
			duplicateGroup,
			groupEntries,
			allFileNames,
			"unix",
		);
		expect(plan).toBeNull();
	});

	it("returns null (no-op) for a diverged group — same parent, a genuine fork", () => {
		const duplicateGroup = group("20260822010000", [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
		]);
		const groupEntries = [
			entry("20260822010000_a.sql", "sha256:root", "sha256:a"),
			entry("20260822010000_b.sql", "sha256:root", "sha256:b"),
		];
		const allFileNames = ["20260822010000_a.sql", "20260822010000_b.sql"];
		expect(
			planDuplicateVersionFix(
				duplicateGroup,
				groupEntries,
				allFileNames,
				"timestamp",
			),
		).toBeNull();
	});

	it("returns null when a group member has no chain-hash entry at all (unparseable banner)", () => {
		const duplicateGroup = group("20260822010000", [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
		]);
		// Only one entry for a 2-member group — the caller couldn't parse
		// the other file's banner hashes.
		const groupEntries = [
			entry("20260822010000_a.sql", "sha256:root", "sha256:a"),
		];
		const allFileNames = ["20260822010000_a.sql", "20260822010000_b.sql"];
		expect(
			planDuplicateVersionFix(
				duplicateGroup,
				groupEntries,
				allFileNames,
				"timestamp",
			),
		).toBeNull();
	});

	// #154 ratchet-5: DuplicateVersionGroup's own doc comment says a real
	// group always has 2+ members (this rest.length === 0 branch "never
	// actually reachable" from there) -- but the type itself (fileNames:
	// ReadonlyArray<string>) doesn't enforce that, so this pins the
	// defensive branch directly rather than leaving it permanently
	// unreachable from any test.
	it("returns null for a single-member group (defensive -- never produced by a real duplicate-version collision)", () => {
		const duplicateGroup = group("20260822010000", ["20260822010000_a.sql"]);
		const groupEntries = [
			entry("20260822010000_a.sql", "sha256:root", "sha256:a"),
		];
		const allFileNames = ["20260822010000_a.sql"];
		expect(
			planDuplicateVersionFix(
				duplicateGroup,
				groupEntries,
				allFileNames,
				"timestamp",
			),
		).toBeNull();
	});
});

describe("duplicateVersionFallbackOptions", () => {
	it("offers one option per member of a 2-member group, each renaming just that member past the current max", () => {
		const duplicateGroup = group("20260822010000", [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
		]);
		const allFileNames = ["20260822010000_a.sql", "20260822010000_b.sql"];
		const options = duplicateVersionFallbackOptions(
			duplicateGroup,
			allFileNames,
			"timestamp",
		);
		expect(options).toEqual([
			{
				renamed: {
					fileName: "20260822010000_a.sql",
					newFileName: "20260822010001_a.sql",
				},
				assumedEarlier: ["20260822010000_b.sql"],
			},
			{
				renamed: {
					fileName: "20260822010000_b.sql",
					newFileName: "20260822010001_b.sql",
				},
				assumedEarlier: ["20260822010000_a.sql"],
			},
		]);
	});

	it("targets the exact same version for every option — only one is ever meant to run", () => {
		const duplicateGroup = group("20260822010000", [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
			"20260822010000_c.sql",
		]);
		const allFileNames = [
			"20260822010000_a.sql",
			"20260822010000_b.sql",
			"20260822010000_c.sql",
		];
		const options = duplicateVersionFallbackOptions(
			duplicateGroup,
			allFileNames,
			"timestamp",
		);
		const versions = (options ?? []).map((option) =>
			option.renamed.newFileName.split("_", 1),
		);
		expect(versions).toEqual([
			["20260822010001"],
			["20260822010001"],
			["20260822010001"],
		]);
	});
});
