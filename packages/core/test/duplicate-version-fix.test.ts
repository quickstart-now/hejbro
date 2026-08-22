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
