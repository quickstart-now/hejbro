import { describe, expect, it } from "vitest";
import type { ChainEntry } from "../src";
import { checkChain } from "../src";

const entry = (
	fileName: string,
	parent: string,
	current: string,
): ChainEntry => ({ fileName, parent, current });

describe("checkChain", () => {
	it("returns ok with a null tip for an empty entry list", () => {
		expect(checkChain([])).toEqual({ ok: true, tip: null });
	});

	it("accepts a linear chain and returns the tip hash", () => {
		const entries = [
			entry("001.sql", "sha256:root", "sha256:a"),
			entry("002.sql", "sha256:a", "sha256:b"),
			entry("003.sql", "sha256:b", "sha256:c"),
		];
		expect(checkChain(entries)).toEqual({ ok: true, tip: "sha256:c" });
	});

	it("accepts a single entry as root regardless of its parent (root rule)", () => {
		const entries = [
			entry("050.sql", "sha256:some-arbitrary-value", "sha256:a"),
		];
		expect(checkChain(entries)).toEqual({ ok: true, tip: "sha256:a" });
	});

	it("accepts a legacy-prefix chain root — parent doesn't need to be the empty-snapshot hash", () => {
		// parseBannerHashes-null files (no hash lines at all, pre-chain
		// history) are filtered out by the caller before building
		// ChainEntry[] — this confirms the first *hashed* file's parent is
		// still accepted unconditionally as root, even mid-history, since
		// core has no way to verify it against an empty-snapshot hash it
		// never computes.
		const entries = [
			entry(
				"010_legacy_start.sql",
				"sha256:unverifiable-legacy-parent",
				"sha256:x",
			),
			entry("011.sql", "sha256:x", "sha256:y"),
		];
		expect(checkChain(entries)).toEqual({ ok: true, tip: "sha256:y" });
	});

	it("flags two entries sharing a parent as diverged-migrations (fork), naming both files", () => {
		const entries = [
			entry("001.sql", "sha256:root", "sha256:a"),
			entry("003.sql", "sha256:a", "sha256:b2"),
			entry("002.sql", "sha256:a", "sha256:b1"),
		];
		expect(checkChain(entries)).toEqual({
			ok: false,
			code: "diverged-migrations",
			details: ["002.sql", "003.sql"],
		});
	});

	it("flags a parent with no matching prior current as broken-chain (hole), naming the file", () => {
		const entries = [
			entry("001.sql", "sha256:root", "sha256:a"),
			entry("002.sql", "sha256:does-not-match-a", "sha256:b"),
		];
		expect(checkChain(entries)).toEqual({
			ok: false,
			code: "broken-chain",
			details: ["002.sql"],
		});
	});

	it("diverged-migrations takes priority over a later broken-chain in the same entry set", () => {
		const entries = [
			entry("001.sql", "sha256:root", "sha256:a"),
			entry("002.sql", "sha256:a", "sha256:b1"),
			entry("003.sql", "sha256:a", "sha256:b2"),
			entry("004.sql", "sha256:nowhere", "sha256:c"),
		];
		expect(checkChain(entries).ok).toBe(false);
		expect((checkChain(entries) as { code: string }).code).toBe(
			"diverged-migrations",
		);
	});
});
