import type { ChainEntry } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { LedgerState } from "../src/apply/ledger";
import { planApply } from "../src/apply/plan";

const NOT_APPLIED: LedgerState = { exists: true, applied: [] };

const applied = (filenames: ReadonlyArray<string>): LedgerState => ({
	exists: true,
	applied: filenames,
});

describe("planApply / 2.1", () => {
	it("orders pending migrations by the chain, not by filename sort", () => {
		// Spec scenario: "a database's ledger records the first two
		// migrations of a chain of four" -- filenames are deliberately
		// *not* in alphabetical/version order, so a implementation that
		// re-sorted by name instead of preserving chain order would pass
		// a naive fixture and fail this one.
		const chain: ReadonlyArray<ChainEntry> = [
			{ fileName: "0004_first.sql", parent: "root", current: "h1" },
			{ fileName: "0001_second.sql", parent: "h1", current: "h2" },
			{ fileName: "0003_third.sql", parent: "h2", current: "h3" },
			{ fileName: "0002_fourth.sql", parent: "h3", current: "h4" },
		];
		const ledger = applied(["0004_first.sql", "0001_second.sql"]);

		const result = planApply(chain, ledger);

		expect(result).toEqual({
			ok: true,
			pending: ["0003_third.sql", "0002_fourth.sql"],
		});
	});

	it("an unbootstrapped ledger (exists: false) leaves every migration pending", () => {
		const chain: ReadonlyArray<ChainEntry> = [
			{ fileName: "0001_init.sql", parent: "root", current: "h1" },
		];

		const result = planApply(chain, { exists: false });

		expect(result).toEqual({ ok: true, pending: ["0001_init.sql"] });
	});
});

describe("planApply / 2.2", () => {
	it("reports a ledger row with no file on disk", () => {
		const chain: ReadonlyArray<ChainEntry> = [
			{ fileName: "0001_init.sql", parent: "root", current: "h1" },
		];
		const ledger = applied(["0001_init.sql", "0002_ghost.sql"]);

		const result = planApply(chain, ledger);

		expect(result.ok).toBe(false);
		if (result.ok || result.reason !== "ledger-disagreement") {
			throw new Error("expected a ledger-disagreement result");
		}
		expect(result.disagreements).toHaveLength(1);
		expect(result.disagreements[0]?.identity).toBe("0002_ghost.sql");
		expect(result.disagreements[0]?.error.code).toBe(
			"migrate-ledger-orphan-row",
		);
		expect(result.disagreements[0]?.error.message).toMatch(/Next:/);
	});

	it("reports a recorded migration that the chain orders after an unrecorded one", () => {
		const chain: ReadonlyArray<ChainEntry> = [
			{ fileName: "0001_init.sql", parent: "root", current: "h1" },
			{ fileName: "0002_add_column.sql", parent: "h1", current: "h2" },
			{ fileName: "0003_add_index.sql", parent: "h2", current: "h3" },
		];
		// 0002 was never recorded -- 0001 and 0003 were.
		const ledger = applied(["0001_init.sql", "0003_add_index.sql"]);

		const result = planApply(chain, ledger);

		expect(result.ok).toBe(false);
		if (result.ok || result.reason !== "ledger-disagreement") {
			throw new Error("expected a ledger-disagreement result");
		}
		expect(result.disagreements).toHaveLength(1);
		expect(result.disagreements[0]?.identity).toBe("0003_add_index.sql");
		expect(result.disagreements[0]?.error.code).toBe(
			"migrate-ledger-out-of-order",
		);
		expect(result.disagreements[0]?.error.message).toContain(
			"0002_add_column.sql",
		);
		expect(result.disagreements[0]?.error.message).toMatch(/Next:/);
	});

	it("reports every disagreement at once, not just the first (batch, matching check's precedent)", () => {
		const chain: ReadonlyArray<ChainEntry> = [
			{ fileName: "0001_init.sql", parent: "root", current: "h1" },
			{ fileName: "0002_add_column.sql", parent: "h1", current: "h2" },
			{ fileName: "0003_add_index.sql", parent: "h2", current: "h3" },
		];
		const ledger = applied([
			"0001_init.sql",
			"0003_add_index.sql", // out of order (0002 unrecorded)
			"0009_ghost.sql", // orphan row
		]);

		const result = planApply(chain, ledger);

		expect(result.ok).toBe(false);
		if (result.ok || result.reason !== "ledger-disagreement") {
			throw new Error("expected a ledger-disagreement result");
		}
		const codes = result.disagreements.map((d) => d.error.code).sort();
		expect(codes).toEqual([
			"migrate-ledger-orphan-row",
			"migrate-ledger-out-of-order",
		]);
	});
});

describe("planApply / 2.3", () => {
	it("refuses to plan against a chain whose hashes do not verify", () => {
		const chain: ReadonlyArray<ChainEntry> = [
			{ fileName: "0001_init.sql", parent: "root", current: "h1" },
			// parent should be "h1" -- this is a broken link.
			{ fileName: "0002_add_column.sql", parent: "wrong", current: "h2" },
		];

		const result = planApply(chain, NOT_APPLIED);

		expect(result.ok).toBe(false);
		if (result.ok || result.reason !== "chain-invalid") {
			throw new Error("expected a chain-invalid result");
		}
		// Reuses checkChain's own code -- never a migrate-specific one for
		// the same underlying fact.
		expect(result.error.code).toBe("broken-chain");
		expect(result.error.message).toMatch(/Next:/);
	});

	it("a broken chain refuses even when the ledger also disagrees with it (chain check runs first)", () => {
		const chain: ReadonlyArray<ChainEntry> = [
			{ fileName: "0001_init.sql", parent: "root", current: "h1" },
			{ fileName: "0002_add_column.sql", parent: "wrong", current: "h2" },
		];
		const ledger = applied(["0009_ghost.sql"]);

		const result = planApply(chain, ledger);

		expect(result.ok).toBe(false);
		if (result.ok) {
			throw new Error("expected a failure");
		}
		expect(result.reason).toBe("chain-invalid");
	});
});
