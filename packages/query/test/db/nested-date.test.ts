// TZ is pinned BEFORE any Date use: the F1 finding is invisible on a UTC
// runner (utc-midnight === local-midnight there), so the test forces a
// negative-offset zone where the wrong parse lands on the PREVIOUS day.
process.env.TZ = "America/New_York";

// ⚠ process.env.TZ is PROCESS-GLOBAL and leaks into files sharing this
// worker — any future TZ-sensitive test must pin its own TZ the same way.

import { date as dateColumn, schema, table, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

const app = schema("app");
const posts = table(app, "posts", { id: uuid().primaryKey() });
const milestones = table(app, "milestones", {
	id: uuid().primaryKey(),
	postId: uuid()
		.notNull()
		.references(() => posts.id),
	day: dateColumn(),
});

describe("nested date columns parse as local midnight (g3 review F1)", () => {
	it("a nested date lands on the same calendar day a top-level read gives", async () => {
		const raw = {
			id: "0b0e5b3e-0000-4000-8000-000000000001",
			milestones: [
				{
					id: "0b0e5b3e-0000-4000-8000-000000000006",
					// biome-ignore lint/style/useNamingConvention: models the real json child key (the derived table snake alias).
					post_id: "0b0e5b3e-0000-4000-8000-000000000001",
					day: "2026-08-28",
				},
			],
		};
		const { driver } = recordingTransactionalDriver({ rows: [raw] });
		const rows = await db({ app, posts, milestones }, driver)
			.select(posts)
			.related({ milestones: true });
		const day = rows[0]?.milestones[0]?.day;
		// the pg driver parses a top-level `date` as LOCAL midnight -- the
		// nested revive must agree, or the same column reads a different
		// instant depending on nesting (the F1 real-server measurement).
		expect(day?.getFullYear()).toBe(2026);
		expect(day?.getMonth()).toBe(7);
		expect(day?.getDate()).toBe(28);
	});
});
