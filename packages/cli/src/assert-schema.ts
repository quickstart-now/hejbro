import type {
	HejbroInput,
	KindRegistry,
	RegisteredObjectKind,
	Snapshot,
} from "@hejbro/core";
import {
	createDefaultRegistry,
	emptySnapshot,
	generateMigration,
	HejbroError,
	isTable,
} from "@hejbro/core";
import type { DriverSession, Schema } from "@hejbro/query";
import type { Catalog } from "./check/catalog";
import { readCatalog } from "./check/catalog";
import type { Finding } from "./check/compare";
import { compareCatalog } from "./check/compare";

/**
 * The minimal structural surface `assertSchema` reads off a `db()` handle
 * (query-execution delta, "A handle retains the declarations it was built
 * from") — never the full `Db` type, so this module's only dependency on
 * `@hejbro/query` is two already-pure types, not the whole chain surface.
 * `driver` only ever needs `execute` here (readCatalog's own contract), so
 * this is typed as `DriverSession`, not the wider `Driver` — a real
 * handle's `driver: Driver` field structurally satisfies it unchanged.
 */
export type AssertSchemaHandle = {
	readonly schema: Schema;
	readonly driver: DriverSession;
};

export type AssertSchemaOptions = {
	readonly registry?: KindRegistry;
	readonly allowNotCompared?: boolean;
};

/** One declaration `assertSchema` looked at — identity alone, the report's `compared` shape (owner decision, 2.1). */
export type AssertSchemaEntry = {
	readonly identity: string;
};

/**
 * One declaration `assertSchema` could not look at — identity and the
 * reason, in the comparison's own vocabulary (quoted verbatim, never
 * rewritten — a quoted reason may itself reference `hejbro check`'s own
 * workflow, e.g. telling the reader to rerun it; that instruction
 * belongs to the quote, not to this call, owner decision). `code` is
 * present only for a declaration that should have been compared and
 * could not (the comparison's own `check-not-compared` finding, reused
 * verbatim); absent for a declaration whose kind states none of its
 * objects is ever comparable — that fact carries a reason, never a
 * comparison code (owner decision, 2.6): the two share this one place in
 * the report, not an identifier.
 */
export type AssertSchemaNotComparedEntry = AssertSchemaEntry & {
	readonly reason: string;
	readonly code?: string;
};

/** The report `assertSchema` resolves to on success, and that a not-compared throw still carries (spec: "not-compared declarations SHALL still be named in what the caller receives"). */
export type AssertSchemaReport = {
	readonly compared: ReadonlyArray<AssertSchemaEntry>;
	readonly notCompared: ReadonlyArray<AssertSchemaNotComparedEntry>;
};

/**
 * One per-object finding on the `findings` array an `assert-schema-diverged`
 * throw carries (`throwDiverged` below) — a type alias, not a copy: same
 * shape `hejbro check`'s own comparison already produces
 * (`{identity, error}` from `./check/compare`'s `Finding`), never
 * reimplemented here. Named under this surface's own vocabulary rather than
 * re-exported as `Finding` (owner decision): this type has never been
 * published before, so the moment it is exported for the first time fixes
 * its name, and a bare, generic name would let `hejbro check`'s internal
 * vocabulary occupy a slot on the public surface it does not otherwise
 * reach. This is a narrower case than "propagate a `check-`-prefixed code
 * unchanged" above — the prefix-reuse exception exists to protect an
 * *already-public* contract, which this type, before now, was not.
 */
export type AssertSchemaFinding = Finding;

const ASSERT_SCHEMA_DIVERGED = "assert-schema-diverged";
const ASSERT_SCHEMA_NOT_COMPARED = "assert-schema-not-compared";
const ASSERT_SCHEMA_CATALOG_UNREADABLE = "assert-schema-catalog-unreadable";

/** `check-not-compared`'s own code (compare.ts's `notComparedFinding`) — not exported there, so named here once rather than copied at each use below. */
const CHECK_NOT_COMPARED = "check-not-compared";

/** `check-declarations-empty`'s own code (`compareCatalog`'s own refusal for a snapshot with zero declared objects) — same reasoning as {@link CHECK_NOT_COMPARED}. */
const CHECK_DECLARATIONS_EMPTY = "check-declarations-empty";

/** `check-catalog-unreadable`'s own code (`readCatalog`'s own refusal when the catalog reads themselves fail) — same reasoning as {@link CHECK_NOT_COMPARED}. */
const CHECK_CATALOG_UNREADABLE = "check-catalog-unreadable";

/**
 * Every reason/message this module carries verbatim from the comparison
 * is followed by this line — the comparison's own vocabulary includes
 * `hejbro check`'s workflow (a quoted reason may itself say to rerun
 * that command), and a caller who never ran it deserves to know that
 * instruction is a quotation, not this library's own advice (owner
 * decision, error-vocabulary principle).
 */
const QUOTE_ATTRIBUTION =
	'Quoted verbatim from the same comparison "hejbro check" uses — a quoted line may itself say to rerun that command; that instruction belongs to the quote, not to this call.';

const isNotComparedFinding = (finding: Finding): boolean =>
	finding.error.code === CHECK_NOT_COMPARED;

const kindOfKey = (key: string): string => key.slice(0, key.indexOf(":"));
const identityOfKey = (key: string): string => key.slice(key.indexOf(":") + 1);

/** `true` for anything `HejbroInput` accepts — a `Table` (hidden behind its own `tableMeta` symbol) or a plain declaration object (any `declarationKind` string). Mirrors `db.ts`'s own structural classification, not a nominal check, since a schema module's incidental non-declaration exports (a constant, a re-exported type) carry neither shape. */
const isDeclarationLike = (value: unknown): value is HejbroInput =>
	isTable(value) ||
	(typeof value === "object" && value !== null && "declarationKind" in value);

/** Every declaration `handle.schema` exports — tables, functions, enums, views, grants, … — filtered down from the module's own values exactly as `db()`'s own classifiers do (task 1.1's retained module, never a copy). */
const declarationsOf = (schema: Schema): ReadonlyArray<HejbroInput> =>
	Object.values(schema).filter(isDeclarationLike);

const kindLookup = (
	registry: KindRegistry,
): ReadonlyMap<string, RegisteredObjectKind> =>
	new Map(registry.list().map((kind) => [kind.kind, kind]));

/**
 * Cause ⓑ (owner decision, 2.6): a declaration whose kind is registered
 * but has no comparator (`compareCatalog`'s own `check-not-compared`
 * finding, reused verbatim — reason is the finding's message, code is
 * the finding's code). This is the cause that fails the run by default:
 * a comparison that *should* have run and could not. No in-repo kind
 * reaches this today — `compare.ts`'s comparator table matches core's
 * own registered kinds exactly — so this path is kept for the kind that
 * will, not deleted for having no instance yet.
 */
const shouldHaveComparedEntries = (
	findings: ReadonlyArray<Finding>,
): ReadonlyArray<AssertSchemaNotComparedEntry> =>
	findings.filter(isNotComparedFinding).map((finding) => ({
		identity: finding.identity,
		reason: finding.error.message,
		code: finding.error.code,
	}));

/**
 * Cause ⓒ (owner decision, 2.6): a registered kind that declares
 * `noCatalogObjectReason` compares nothing for its objects and returns
 * `[]` for them from `compareCatalog` (compare.ts's own `compareEntry`)
 * — `hejbro check` states this at the kind level
 * (`kindCoverageBoundaryLines`), never per object, and never as a
 * `Finding` at all. `assertSchema` needs per-object identities, so this
 * walks every declared key itself, reusing the registered kind's own
 * stated reason verbatim — and carries no comparison code: this kind
 * never claimed it would compare these objects, so there is no
 * "should have, and could not" to name.
 */
const neverComparableEntries = (
	snapshot: Snapshot,
	registry: KindRegistry,
): ReadonlyArray<AssertSchemaNotComparedEntry> => {
	const kinds = kindLookup(registry);
	return Object.keys(snapshot.objects).flatMap((key) => {
		const reason = kinds.get(kindOfKey(key))?.noCatalogObjectReason;
		if (reason === undefined) {
			return [];
		}
		return [{ identity: identityOfKey(key), reason }];
	});
};

type Classified = {
	readonly report: AssertSchemaReport;
	readonly divergingFindings: ReadonlyArray<Finding>;
	/**
	 * `true` only when cause ⓑ contributed at least one entry — cause ⓒ
	 * never fails the run (owner decision, 2.6): a kind that states none
	 * of its objects is ever comparable has no remedy to name, and
	 * failing on it would leave `allowNotCompared` as the only way
	 * forward, silencing genuine ⓑ gaps along with it.
	 */
	readonly shouldFailOnNotCompared: boolean;
};

/**
 * Splits `compareCatalog`'s flat `Finding[]` into the report's two places
 * (owner decision, 2.1) plus the subset that fails the run outright.
 * `compared`/`notCompared` partition every declared identity exactly
 * once: an identity lands in `notCompared` for cause ⓑ or cause ⓒ, and
 * in `compared` otherwise — whether or not it diverged, since diverging
 * is a separate fact (`divergingFindings`), not a third bucket.
 */
const classify = (
	snapshot: Snapshot,
	findings: ReadonlyArray<Finding>,
	registry: KindRegistry,
): Classified => {
	const shouldHaveCompared = shouldHaveComparedEntries(findings);
	const neverComparable = neverComparableEntries(snapshot, registry);
	const notCompared = [...shouldHaveCompared, ...neverComparable];
	const notComparedIdentities = new Set(
		notCompared.map((entry) => entry.identity),
	);
	const compared = Object.keys(snapshot.objects)
		.map(identityOfKey)
		.filter((identity) => !notComparedIdentities.has(identity))
		.map((identity) => ({ identity }));
	const divergingFindings = findings.filter(
		(finding) => !isNotComparedFinding(finding),
	);
	return {
		report: { compared, notCompared },
		divergingFindings,
		shouldFailOnNotCompared: shouldHaveCompared.length > 0,
	};
};

/**
 * `true` when `error` is exactly the `HejbroError` `code` names — the
 * one question every error this module meets is judged by: does this
 * code name something *this library's own caller* invokes? A `check-`
 * prefixed code never does (it names `hejbro check`'s own vocabulary),
 * so every use below is on the translate side of that line.
 */
const isHejbroErrorWithCode = (
	error: unknown,
	code: string,
): error is HejbroError => error instanceof HejbroError && error.code === code;

// --- assertSchema's own runtime-layer failures --------------------------
//
// Thrown as a plain `Error` carrying `{ code, cause? }` (owner decision,
// error-vocabulary principle) — the same idiom `@hejbro/query`'s own
// `execute.ts` uses for `query-execution-failed`, never `HejbroError`:
// `assertSchema` is a runtime-handle companion, and its caller catches a
// runtime error, not the declaration-time `HejbroError` type. This is
// also why `unowned-declaration` below is propagated with its original
// `HejbroError` class intact rather than rewrapped into this shape —
// propagating means not touching the class either, and a caller that
// branches on `error.code` (the one stable surface every failure this
// module raises carries, regardless of class) sees both kinds alike.

const divergedMessage = (findings: ReadonlyArray<Finding>): string =>
	[
		`assertSchema found ${findings.length} diverging declared object(s):`,
		...findings.map((finding) => finding.error.message),
		QUOTE_ATTRIBUTION,
	].join("\n");

const throwDiverged = (findings: ReadonlyArray<Finding>): never => {
	throw Object.assign(new Error(divergedMessage(findings)), {
		code: ASSERT_SCHEMA_DIVERGED,
		findings,
	});
};

const notComparedMessage = (
	entries: ReadonlyArray<AssertSchemaNotComparedEntry>,
): string =>
	[
		`assertSchema could not compare ${entries.length} declared object(s):`,
		...entries.map((entry) => `"${entry.identity}": ${entry.reason}`),
		"Next: supply the registry that owns them (options.registry), or opt out of this failure with options.allowNotCompared.",
		QUOTE_ATTRIBUTION,
	].join("\n");

const throwNotCompared = (report: AssertSchemaReport): never => {
	throw Object.assign(new Error(notComparedMessage(report.notCompared)), {
		code: ASSERT_SCHEMA_NOT_COMPARED,
		notCompared: report.notCompared,
	});
};

/**
 * A schema module that declares nothing is the same answerlessness as
 * any other unresolvable run (spec: "A module that declares nothing
 * cannot answer either") — `compareCatalog` already refuses this
 * outright (`check-declarations-empty`, a `check-` coded diagnostic in
 * `hejbro check`'s own vocabulary, translated rather than propagated),
 * so this maps it onto `assertSchema`'s own not-compared code, names the
 * actual fix (declarations, never a registry — an empty module has no
 * kind for one to cover), and keeps the original refusal as `cause`
 * rather than discarding it.
 */
const throwEmptyModule = (cause: unknown): never => {
	throw Object.assign(
		new Error(
			"assertSchema could not compare anything: the schema module handed to db() declares no objects at all. Next: pass a schema module that exports at least one declaration (a table, a function, …) — a registry cannot help a module with nothing in it.",
		),
		{ code: ASSERT_SCHEMA_NOT_COMPARED, cause },
	);
};

const compareOrThrowEmptyModule = (
	snapshot: Snapshot,
	catalog: Catalog,
	registry: KindRegistry,
): ReadonlyArray<Finding> => {
	try {
		return compareCatalog(snapshot, catalog, registry);
	} catch (error) {
		if (isHejbroErrorWithCode(error, CHECK_DECLARATIONS_EMPTY)) {
			return throwEmptyModule(error);
		}
		throw error;
	}
};

/**
 * `check-catalog-unreadable` is `readCatalog`'s own `check-` coded
 * refusal when the catalog reads themselves fail — translated the same
 * way `check-declarations-empty` is (a `hejbro check` vocabulary code,
 * never this library's caller's), cause preserved. `readCatalog` always
 * wraps whatever the driver rejected with into this one code, so the
 * `throw error` fallback below is unreached today — kept for the same
 * reason cause ⓑ is: a future change to `readCatalog`'s own wrapping
 * would let a raw driver rejection through, and the vocabulary rule
 * (raw driver error → propagate, since it already speaks this caller's
 * vocabulary) still needs somewhere to land.
 */
const readCatalogOrThrow = async (driver: DriverSession): Promise<Catalog> => {
	try {
		return await readCatalog(driver);
	} catch (error) {
		if (isHejbroErrorWithCode(error, CHECK_CATALOG_UNREADABLE)) {
			throw Object.assign(
				new Error(
					`assertSchema could not read the database catalog. Next: confirm the connected role can read pg_catalog (the standard grant for any login role) — the underlying failure is on "cause".`,
				),
				{ code: ASSERT_SCHEMA_CATALOG_UNREADABLE, cause: error },
			);
		}
		throw error;
	}
};

/**
 * Asserts that the database `handle.driver` is connected to matches every
 * declaration `handle.schema` exports (query-execution delta). Opt-in and
 * explicit — this function is the only thing that ever connects, reads
 * the catalog, or sends a statement; constructing a handle never does.
 *
 * Resolves to a report on success. Every failure carries a `code` a
 * caller reads (the one stable surface — the error's own class is not
 * part of the contract, owner decision): a declaration no registered
 * kind owns at all fails first, before the catalog is ever read,
 * propagated as `generateMigration`'s own `unowned-declaration`
 * `HejbroError`, unwrapped (that failure already speaks this caller's
 * vocabulary — nothing to translate); everything else this function
 * itself decides — a real divergence, an unresolvable "could not
 * compare", a `hejbro check`-vocabulary refusal along the way — throws
 * as a plain `Error` carrying `{ code, cause? }`, this library's own
 * runtime-layer shape.
 */
export const assertSchema = async (
	handle: AssertSchemaHandle,
	options?: AssertSchemaOptions,
): Promise<AssertSchemaReport> => {
	const registry = options?.registry ?? createDefaultRegistry();
	const declarations = declarationsOf(handle.schema);
	const snapshot = generateMigration({
		declarations,
		previousSnapshot: emptySnapshot,
		registry,
	}).snapshot;
	const catalog = await readCatalogOrThrow(handle.driver);
	const findings = compareOrThrowEmptyModule(snapshot, catalog, registry);
	const classified = classify(snapshot, findings, registry);
	if (classified.divergingFindings.length > 0) {
		return throwDiverged(classified.divergingFindings);
	}
	if (
		classified.shouldFailOnNotCompared &&
		options?.allowNotCompared !== true
	) {
		return throwNotCompared(classified.report);
	}
	return classified.report;
};
