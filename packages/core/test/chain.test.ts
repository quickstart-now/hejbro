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

	// #129: reports whichever problem is encountered *first* in file order
	// -- not "diverged-migrations always wins regardless of position". The
	// old algorithm's global fork pre-scan (before any walk) made diverged
	// look like it always took priority, but that was never a declared
	// rule -- it was a side effect of scanning for forks globally before
	// walking at all. Pinned both directions below so this is a decision,
	// not an accident, going forward (main-confirmed, #129 review).
	it("reports the fork when it's encountered before a later broken-chain", () => {
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

	it("reports the broken-chain when it's encountered before a later fork", () => {
		const entries = [
			entry("001.sql", "sha256:root", "sha256:a"),
			entry("002.sql", "sha256:nowhere", "sha256:b"),
			entry("003.sql", "sha256:a", "sha256:c1"),
			entry("004.sql", "sha256:a", "sha256:c2"),
		];
		expect(checkChain(entries).ok).toBe(false);
		expect((checkChain(entries) as { code: string }).code).toBe("broken-chain");
	});

	it("flags a three-way fork, naming every participant (not just the first pair)", () => {
		const entries = [
			entry("001.sql", "sha256:root", "sha256:a"),
			entry("002.sql", "sha256:a", "sha256:b"),
			entry("003.sql", "sha256:a", "sha256:c"),
			entry("004.sql", "sha256:a", "sha256:d"),
		];
		expect(checkChain(entries)).toEqual({
			ok: false,
			code: "diverged-migrations",
			details: ["002.sql", "003.sql", "004.sql"],
		});
	});

	// #129: the false positive this fix closes -- rewinding to an earlier
	// snapshot state (a legitimate "roll back by re-declaring" history)
	// used to be flagged as a fork, because the old algorithm grouped
	// entries by parent value globally, with no notion of position: two
	// entries sharing a parent value looked identical whether they were
	// racing for the same slot (a real fork) or the same value simply
	// recurring later after an explicit rollback entry returned to it.
	// checkChain now walks strict positional adjacency (does this entry's
	// parent match the *immediately preceding* entry's current?) instead
	// of "does it match any current seen so far" -- a real rollback entry
	// (0003 below) makes the very next entry's parent match immediately,
	// so the walk never even reaches the point where the old algorithm's
	// global grouping would have misfired.
	it("accepts a chain that rolls back to an earlier state, then continues (#129)", () => {
		const entries = [
			entry("0001.sql", "sha256:empty", "sha256:a"),
			entry("0002.sql", "sha256:a", "sha256:b"),
			entry("0003.sql", "sha256:b", "sha256:a"), // rollback: B -> A
			entry("0004.sql", "sha256:a", "sha256:d"), // continues from A
		];
		expect(checkChain(entries)).toEqual({ ok: true, tip: "sha256:d" });
	});

	it("accepts a chain that rolls back several steps, then continues (#129)", () => {
		const entries = [
			entry("0001.sql", "sha256:empty", "sha256:a"),
			entry("0002.sql", "sha256:a", "sha256:b"),
			entry("0003.sql", "sha256:b", "sha256:c"),
			entry("0004.sql", "sha256:c", "sha256:a"), // rollback all the way to A
			entry("0005.sql", "sha256:a", "sha256:d"), // continues from A
		];
		expect(checkChain(entries)).toEqual({ ok: true, tip: "sha256:d" });
	});

	it("still flags a genuine fork with no rollback entry between the two claimants (#129 control)", () => {
		const entries = [
			entry("0001.sql", "sha256:empty", "sha256:a"),
			entry("0002.sql", "sha256:a", "sha256:b"),
			entry("0003.sql", "sha256:a", "sha256:c"), // directly claims A too, no rollback in between
		];
		expect(checkChain(entries)).toEqual({
			ok: false,
			code: "diverged-migrations",
			details: ["0002.sql", "0003.sql"],
		});
	});

	// #129: legacy-prefix independence. `checkChain` only ever sees
	// already-filtered, hash-bearing entries (ChainEntry's own doc
	// comment) -- however many hash-less legacy files preceded the first
	// hashed one in the real directory has zero effect here, since only
	// entries[0] (whatever it is) gets the unconditional root exemption.
	// This chain has three post-legacy entries (not just the two the
	// "legacy-prefix chain root" test above already covers), confirming
	// the strict-adjacency walk introduced for the rollback fix doesn't
	// need more than one entry's worth of leniency.
	it("keeps legacy-prefix tolerance independent of how many post-legacy entries follow", () => {
		const entries = [
			entry("010_legacy_start.sql", "sha256:unverifiable", "sha256:x"),
			entry("011.sql", "sha256:x", "sha256:y"),
			entry("012.sql", "sha256:y", "sha256:z"),
		];
		expect(checkChain(entries)).toEqual({ ok: true, tip: "sha256:z" });
	});

	// #129 review: a deleted middle file (e.g. the rollback entry itself,
	// removed after the fact) leaves a chain that is *provably*
	// indistinguishable, from the surviving hash chain alone, from a
	// genuine fork -- deleting a file removes every trace of it, so
	// nothing about the remaining entries can tell "this parent value is
	// contested because a file is missing" apart from "this parent value
	// is contested because two branches both claim it". This is not a
	// regression: the pre-existing (pre-#129) algorithm already classified
	// this exact shape as diverged-migrations too (confirmed by running
	// this same entry set through the unmodified checkChain before this
	// fix) -- #129 doesn't make it better or worse, only rollback-tolerant
	// chains that were never missing a file are affected.
	it("classifies a deleted rollback step as diverged-migrations -- indistinguishable from a fork by hashes alone, same as before #129", () => {
		const entries = [
			entry("0001.sql", "sha256:empty", "sha256:a"),
			entry("0002.sql", "sha256:a", "sha256:b"),
			// 0003.sql (would-be "sha256:b" -> "sha256:a" rollback) deleted
			entry("0004.sql", "sha256:a", "sha256:d"),
		];
		expect(checkChain(entries)).toEqual({
			ok: false,
			code: "diverged-migrations",
			details: ["0002.sql", "0004.sql"],
		});
	});

	// Not implemented on purpose -- see the doc comment above `checkChain`
	// in chain.ts. Distinguishing "a file was deleted" from "a genuine
	// fork" needs information the hash chain alone doesn't carry (e.g.
	// prefix-sequence gaps, which only `index`-strategy migrations even
	// have -- `timestamp`/`unix` strategies have no meaningful "gap"
	// concept, and checkChain is a pure engine function with no view of
	// CLI config anyway). Left as a todo, not attempted, so the next
	// person doesn't re-derive "why not" from scratch.
	it.todo(
		"distinguish a deleted middle file from a genuine fork -- structurally impossible from the hash chain alone (#129)",
	);
});
