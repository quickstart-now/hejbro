import { describe, expect, it } from "vitest";
import { identityFromMessage } from "../src/identity";

describe("identityFromMessage", () => {
	it("prefers an adjacent quoted pair, joined with a dot", () => {
		const message = 'table "app"."posts" is exposed. Next: declare rls(...).';
		expect(identityFromMessage(message, "fallback")).toBe("app.posts");
	});

	it("falls back to the first bare quoted token when there is no adjacent pair", () => {
		const message = 'unknown flag "--bogus" — check the spelling.';
		expect(identityFromMessage(message, "fallback")).toBe("--bogus");
	});

	it("falls back to the supplied identity when the message has no quoted substring", () => {
		const message = "something went wrong with no quotes at all";
		expect(identityFromMessage(message, "fallback")).toBe("fallback");
	});

	// Review round 1, B1: ADJACENT_QUOTED_PAIR used to let a "pair" span
	// whitespace and parentheses -- for a message quoting a single "."
	// value, the closing quote of the field name and the closing quote of
	// the "." value were close enough (through "names a directory (")
	// that the regex paired them, and identityFromMessage returned a
	// multi-sentence fragment as the header instead of "snapshotPath".
	describe("does not read a quoted dot between two quoted words as a schema.table pair (#846 review B1)", () => {
		type Row = {
			readonly label: string;
			readonly message: string;
			readonly identity: string;
		};

		const rows: ReadonlyArray<Row> = [
			{
				label: "control: a real schema.table pair",
				message: '"app"."posts" is exposed. Next: declare rls(...).',
				identity: "app.posts",
			},
			{
				label: "a snapshotPath directory-spelling message quoting a bare '.'",
				message:
					'config field "snapshotPath" names a directory ("."), but the snapshot is a file. Next: point snapshotPath at a file path (e.g. "hejbro.snapshot.json").',
				identity: "snapshotPath",
			},
			{
				label: "control: the real pair is found wherever it sits",
				message: '"x" and "y"."z"',
				identity: "y.z",
			},
			{
				label:
					"a quoted group containing a space no longer pairs (fact, not a requirement)",
				message: '"a b"."c"',
				identity: "a b",
			},
		];

		it.each(rows)("$label", ({ message, identity }) => {
			expect(identityFromMessage(message, "fallback")).toBe(identity);
		});
	});
});
