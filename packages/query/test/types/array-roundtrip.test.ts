import { insert, schema, table, text, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";
import { parseArrayText } from "../../src/types/array-text";

/**
 * The shared inverse property the Postgres array-literal grammar's two
 * implementations were built without (#342): the *writer* lives in
 * `@hejbro/core` (`serializeArrayLiteral`, harden-query-layer group 2's
 * write-side lift) and the *parser* lives here in `@hejbro/query`
 * (`types/array-text.ts`, group 1's read-side conversion) — deliberately
 * file-disjoint while the two groups ran in parallel, each side pinning
 * its own corner cases. This file is the single place that proves they
 * stay inverse: `parse(write(xs)) = xs` over a corner-case table plus a
 * deterministic sweep, and `write(parse(s)) = s` for canonical text
 * (including the server-measured strings #341's raw capture recorded).
 *
 * The domain-generation style (hand-curated table + `hash32`-seeded
 * deterministic sweep, no property-testing library) mirrors
 * `interval-serialize.test.ts`'s own round-trip property — same
 * rationale: no `fast-check` exists in this monorepo, and one file is
 * not a justification to add it.
 */

const app = schema("array_roundtrip");
const holder = table(app, "holder", {
	id: uuid().primaryKey(),
	tags: text().array(),
});

/**
 * The canonical array-literal text core's writer produces for
 * `elements`, extracted through the public write pipeline rather than a
 * deep import: `insert().values()` lifts the array via
 * `liftColumnValue` → `serializeArrayLiteral` (deliberately not exported
 * from core's barrel — see `column-value.ts`'s own doc), and the
 * compiler binds the literal text as its own parameter (`params[0]` is
 * the id, `params[1]` the array text).
 */
const writeArrayText = (elements: ReadonlyArray<string | null>): string => {
	const compiled = compile(
		insert(holder).values({
			id: "00000000-0000-0000-0000-000000000000",
			// #349: the write-side element type carries `| null`, so the
			// null-element corner flows through .values() with no assertion
			// (this exact site carried a documented mis-assertion until then).
			tags: [...elements],
		}),
	);
	const literalText = compiled.params[1];
	if (typeof literalText !== "string") {
		throw new Error(
			`the array value did not compile to literal text: ${JSON.stringify(compiled.params)}`,
		);
	}
	return literalText;
};

/** The corner cases both sides pinned separately while file-disjoint (#342): quoting triggers, escapes, the `"NULL"`-string-vs-`null`-element distinction, empty array, empty string, structural characters inside elements. */
const cornerDomain: ReadonlyArray<
	readonly [string, ReadonlyArray<string | null>]
> = [
	["empty array", []],
	["single plain element", ["plain"]],
	["single null element", [null]],
	['the string "NULL" stays a string next to a real null', ["NULL", null]],
	[
		'lower- and mixed-case "null" strings stay strings',
		["null", "NuLl", "NULLs"],
	],
	["empty-string element", [""]],
	[
		"whitespace-bearing elements",
		["a b", " leading", "trailing ", "tab\there"],
	],
	[
		"comma and brace structural characters inside elements",
		["a,b", "{brace}", "}", "{", ","],
	],
	[
		"quotes and backslashes, alone and adjacent",
		['say "hi"', "back\\slash", "\\", '"', '\\"'],
	],
	[
		"every corner mixed in one array",
		[null, "NULL", "", "a,b", '"{', "c\\d e"],
	],
];

/** A pure 32-bit integer hash (murmurhash3-finalizer shape) — deterministic, not a stateful PRNG (house style: no `let`/`for`); same helper `interval-serialize.test.ts` uses, so a sweep failure names an exact, re-runnable input via its sample index alone. */
const hash32 = (seed: number): number => {
	const a = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
	const b = Math.imul(a ^ (a >>> 16), 0x45d9f3b) >>> 0;
	return (b ^ (b >>> 16)) >>> 0;
};

/** The fragment vocabulary every sweep element is concatenated from — each entry is a quoting/escaping/`NULL`-detection trigger on its own, so concatenation reaches the adjacent-corner combinations (`\\"`, `,{`, `NULL` mid-word, …) a hand-curated table undersamples. */
const FRAGMENTS: ReadonlyArray<string> = [
	"a",
	"b c",
	",",
	"{",
	"}",
	'"',
	"\\",
	"NULL",
	"",
	" ",
];

/** One sweep element — roughly one in seven is a SQL `null`; the rest concatenate 1–3 vocabulary fragments. */
const sweepElement = (
	sampleIndex: number,
	elementOrdinal: number,
): string | null => {
	const seed = sampleIndex * 104_729 + elementOrdinal * 7_919;
	if (hash32(seed) % 7 === 0) {
		return null;
	}
	const fragmentCount = 1 + (hash32(seed + 1) % 3);
	return Array.from(
		{ length: fragmentCount },
		(_fragment, fragmentIndex) =>
			FRAGMENTS[hash32(seed + 2 + fragmentIndex) % FRAGMENTS.length] ?? "a",
	).join("");
};

/** One deterministic sweep sample: 0–4 elements. */
const sweepSample = (index: number): ReadonlyArray<string | null> =>
	Array.from({ length: hash32(index * 31 + 7) % 5 }, (_element, ordinal) =>
		sweepElement(index, ordinal),
	);

const SWEEP_SAMPLE_COUNT = 256;

const sweepSamples: ReadonlyArray<
	readonly [number, ReadonlyArray<string | null>]
> = Array.from({ length: SWEEP_SAMPLE_COUNT }, (_entry, index) => [
	index,
	sweepSample(index),
]);

describe("parseArrayText(write(xs)) = xs — the read side inverts the write side (#342)", () => {
	it.each(cornerDomain)("%s", (_label, elements) => {
		expect(parseArrayText(writeArrayText(elements))).toEqual(elements);
	});

	it(`round-trips ${SWEEP_SAMPLE_COUNT} deterministic sweep samples over the fragment vocabulary`, () => {
		sweepSamples.forEach(([index, elements]) => {
			expect(
				parseArrayText(writeArrayText(elements)),
				`sweep sample ${index}`,
			).toEqual(elements);
		});
	});
});

describe("write(parseArrayText(s)) = s — canonical text is a fixed point (#342)", () => {
	// Canonical = the writer's own output form: an element is quoted
	// exactly when its text needs it. The last two strings are the
	// server-measured captures from packages/pg/test/integration.test.ts's
	// raw-grammar assertions (#341), verbatim — the writer's canonical
	// form and postgres:17's own print form agree on them, which is what
	// lets `write ∘ parse` treat server output as already-canonical.
	const canonicalTexts: ReadonlyArray<string> = [
		"{}",
		"{1,2,3}",
		'{"a,b","c}d"}',
		'{NULL,"NULL"}',
		'{-00:05:00,"-3 days"}',
		'{"1 day","2 days 03:00:00"}',
	];

	it.each(canonicalTexts)("%s", (canonicalText) => {
		expect(writeArrayText(parseArrayText(canonicalText))).toBe(canonicalText);
	});

	it("write ∘ parse fixes every written form (idempotence over both domains)", () => {
		const allDomains: ReadonlyArray<ReadonlyArray<string | null>> = [
			...cornerDomain.map(([, elements]) => elements),
			...sweepSamples.map(([, elements]) => elements),
		];
		allDomains.forEach((elements) => {
			const written = writeArrayText(elements);
			expect(writeArrayText(parseArrayText(written))).toBe(written);
		});
	});
});
