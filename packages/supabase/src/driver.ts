import type { Driver } from "@hejbro/query";
import { poolerDriver } from "./pooler";
import { anonRole, authenticatedRole, serviceRole } from "./roles";

/**
 * Every value {@link SupabaseDriverEndpoint} names, declared once as a
 * `readonly` tuple -- the type below is *derived* from this array, never
 * declared independently of it. A union declared separately from its
 * own runtime recognized-set can drift: a third value added to only one
 * of the two still type-checks, producing a type-valid `endpoint` this
 * file's own runtime check then rejects as unrecognized (or the
 * reverse) -- exactly the confusing-failure shape a third preset
 * (Nile) would be the first to hit. Deriving the type from this array
 * makes the natural edit path drift-free -- a new endpoint has exactly
 * one place to go -- though not drift-proof against someone deliberately
 * widening the derived type on its own.
 */
const RECOGNIZED_ENDPOINTS = ["session", "transaction-pooler"] as const;

/**
 * The two Supabase connection paths this preset's own driver factory can
 * build for (task 2.1, tasks.md "Settled contract details" ③) -- derived
 * from {@link RECOGNIZED_ENDPOINTS}, never a boolean: a boolean's name
 * becomes a lie the moment a third endpoint exists, and the union reads
 * at the call site as the fact it states. `"session"` is the
 * session-keeping endpoint (a direct connection or a session-mode
 * pooler) the vanilla driver's own capabilities already describe;
 * `"transaction-pooler"` is Supabase's transaction-mode pooler
 * (Supavisor, port 6543), measured in design.md to lose session state
 * across separate transactions.
 */
export type SupabaseDriverEndpoint = (typeof RECOGNIZED_ENDPOINTS)[number];

/**
 * `supabaseDriver`'s own second, optional argument (task 2.1). Omitting
 * `endpoint` (or this whole argument) means `"session"` -- an existing
 * one-argument caller's behavior and capability declaration are
 * unaffected by this change (task 2.2).
 */
export type SupabaseDriverOptions = {
	readonly endpoint?: SupabaseDriverEndpoint;
};

/** Narrows `value` (a plain `string` -- the type a caller without type checking actually hands this function) to {@link SupabaseDriverEndpoint} by membership in {@link RECOGNIZED_ENDPOINTS}. */
const isKnownEndpoint = (value: string): value is SupabaseDriverEndpoint =>
	(RECOGNIZED_ENDPOINTS as ReadonlyArray<string>).includes(value);

/**
 * Builds and throws the `unknown-pooler-mode`-coded, enriched plain
 * `Error` (D57) — a `function` declaration, not `const f = (): never =>
 * …` (handoff note, g2/g3, mirrored from `db/context.ts`'s own
 * `throwUndeclaredRole`). Lists every recognized value by name so the
 * caller sees what *is* valid, not just that their own value wasn't
 * (task 2.4).
 */
function throwUnknownPoolerMode(endpoint: string): never {
	const recognized = RECOGNIZED_ENDPOINTS.map((value) => `"${value}"`).join(
		", ",
	);
	throw Object.assign(
		new Error(
			`"${endpoint}" is not a recognized Supabase driver endpoint. Recognized values: ${recognized}. Next: use one of those, or omit the option entirely for "session".`,
		),
		{ code: "unknown-pooler-mode" },
	);
}

/**
 * Fail-closed, checked once, at construction (task 2.4): an
 * unrecognized `endpoint` value is refused immediately, before
 * {@link applyEndpoint} ever runs — this is the only check a caller
 * without type checking (plain JS, or an untyped upstream) gets, and
 * without it a misspelling would silently fall through to the session
 * path, reproducing for that caller exactly the silent
 * wrong-value-shape failure this whole change exists to remove. Never
 * run again after construction — the execution path carries no
 * equivalent check.
 */
const assertKnownEndpoint = (endpoint: string): void => {
	if (!isKnownEndpoint(endpoint)) {
		throwUnknownPoolerMode(endpoint);
	}
};

/**
 * Resolves `driver` for the declared `endpoint` (task 2.1): the
 * transaction-pooler path is `poolerDriver`'s own capability
 * replacement and transaction-local pin wiring; `"session"` passes
 * `driver` through unchanged. Only ever called with an
 * {@link assertKnownEndpoint}-checked value.
 */
const applyEndpoint = (
	driver: Driver,
	endpoint: SupabaseDriverEndpoint,
): Driver => {
	if (endpoint === "transaction-pooler") {
		return poolerDriver(driver);
	}
	return driver;
};

/**
 * Decorates any contract {@link Driver} with Supabase's own role
 * contribution (owner decision ③, tasks.md group 6 header) — `anon`,
 * `authenticated`, and `service_role`, exactly, always overwritten
 * regardless of what `driver` already carries — so a grant-less schema
 * still unlocks `db.as(asAnon())`/`db.as(asUser(...))` (task 6.3). Every
 * other member of `driver` passes through by reference (object spread),
 * so a future contract addition to {@link Driver} is carried automatically
 * for **own enumerable** properties — object spread's own boundary; a
 * prototype-chain or non-enumerable member would not be copied, and
 * neither this decorator nor its test would catch that (reviewer note,
 * batch A review).
 *
 * `options.endpoint` (task 2.1) selects the connection path before the
 * role contribution is applied, so the pooler path's own capability
 * replacement is never itself overwritten by this decorator's spread --
 * checked once against the recognized set first (task 2.4), so an
 * unrecognized value throws before either happens. This file still
 * imports no concrete driver implementation (e.g. `@hejbro/pg`) -- only
 * the `@hejbro/query` contract type and this package's own
 * `poolerDriver` -- parallel-safe with group 5 by construction (owner
 * decision ①).
 */
export const supabaseDriver = (
	driver: Driver,
	options?: SupabaseDriverOptions,
): Driver => {
	const endpoint = options?.endpoint ?? "session";
	assertKnownEndpoint(endpoint);
	return {
		...applyEndpoint(driver, endpoint),
		contributedRoles: [anonRole, authenticatedRole, serviceRole],
	};
};
