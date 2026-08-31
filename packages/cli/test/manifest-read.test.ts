import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { readNewestManifestRow } from "../src/manifest-read";

/** A fake single-connection session that answers with `rows` and records every query it was sent -- reused by both tests below so a call's exact shape (parameterless, ordered by `seq` descending) stays pinned. */
const makeFakeSession = (
	rows: ReadonlyArray<DriverRow>,
): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			return rows;
		},
	};
	return { session, calls };
};

describe("readNewestManifestRow", () => {
	it("reads the newest row and nothing else", async () => {
		const { session, calls } = makeFakeSession([
			{
				manifestFormat: 1,
				snapshotFormat: 3,
				snapshotHash: "sha256:newest",
				manifest: '{"tables":{}}',
				// Extra columns a real driver row could carry (`seq`,
				// `applied_at`) -- proving the reader picks its four fields
				// and no others, not merely that it doesn't crash on them.
				seq: 2,
				appliedAt: "2026-08-31T00:00:00.000Z",
			},
		]);

		const row = await readNewestManifestRow(session);

		expect(row).toEqual({
			manifestFormat: 1,
			snapshotFormat: 3,
			snapshotHash: "sha256:newest",
			manifest: '{"tables":{}}',
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.params).toEqual([]);
		expect(calls[0]?.sql).toContain('order by "seq" desc');
		expect(calls[0]?.sql).toContain("limit 1");
	});

	it("returns null when the table has no rows", async () => {
		const { session } = makeFakeSession([]);

		const row = await readNewestManifestRow(session);

		expect(row).toBeNull();
	});
});
