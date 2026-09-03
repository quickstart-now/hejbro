# D106 adversarial spec-only evaluation — `add-context-provider`

**VERDICT: PASS — 0 BLOCKING, 0 MAJOR, 4 MINOR**

Every delta scenario was driven through the public API and shipped behavior
matches all of them (14 executed probes, all passing — sources inline below).
The four findings are spec-text precision gaps, three of them cheaply fixable
in the delta *before* archive, which is exactly the moment this gate exists
for.

## Evaluator integrity disclosure

The brief authorized `npx openspec show add-context-provider --diff` as
delta-rendering. That command rendered the **full proposal body** (it reads
git, not the working tree, where `proposal.md` had been removed for
isolation), so I was involuntarily exposed to the proposal's framing —
including its own argument for omitting a `query-execution` delta. Every
finding below was re-derived independently from the delta text, the main
spec corpus, the public surface, and executed probes; where my conclusion
happens to coincide with the proposal's (F1), I state the independent
derivation in full so it can be audited. Future D106 runs should render the
delta via the working-tree file only.

## Evidence base

- Delta: `openspec/changes/add-context-provider/specs/rls-execution-context/spec.md`
- Main corpus: `openspec/specs/rls-execution-context/spec.md`,
  `openspec/specs/query-execution/spec.md`,
  `openspec/specs/typed-function-execution/spec.md`,
  `openspec/specs/driver-contract/spec.md`
- Public surface: `packages/query/src/index.ts` (exports `ContextProvider`,
  `DbOptions`, `db`), `packages/cli/src/index.ts` (`export * from
  "@hejbro/query"` — the provider surface reaches `hejbro`),
  `.changeset/add-context-provider.md`, `skills/hejbro/SKILL.md`,
  `skills/hejbro/references/query-layer.md`, README.md
- Executed probes: 13 in
  `packages/query/test/d106-probe.test.ts` + 1 in
  `packages/supabase/test/d106-preset-probe.test.ts` (both untracked scratch
  files, left in place for re-running; full source in the appendix).
  All 14 pass (`vitest run`, v4.1.11).

## Delta-scenario vs shipped-behavior matrix (question 1)

| Delta scenario | Probe | Result |
|---|---|---|
| Every surface on a provider handle runs under the resolved context (statement execution, chain member, declared-function call, transaction callback) | P3 | ✅ 4 driver transactions, 4 `SET LOCAL ROLE`, 4 resolver calls |
| Registering a provider wraps executions that were not wrapped before; statement SQL/params unchanged | P2, P11 | ✅ one transaction: role → `set_config` → statement; statement byte-identical to the bare handle's send and to `compile()` preview |
| A handle without a provider is unchanged | P1 | ✅ direct send, no transaction, no context statements |
| A preset supplies context values, not mechanism (`asUser`/`asAnon` per request) | S1 (supabase probe) | ✅ request 1 → `"authenticated"` + one `request.jwt.claims` JSON setting with `sub` and forced `role:"authenticated"`; request 2 → `"anon"` — through the generic mechanism, preset builders unchanged |
| An explicit `as()` never consults the provider | P4 | ✅ resolver call count 0; explicit role applied, provider role absent |
| Two executions resolve twice, each under its own returned context | P5a | ✅ resolver exhausted after 2; first tx role A, second role B |
| One transaction resolves once | P5b | ✅ 1 resolver call, 1 `SET LOCAL ROLE` across 3 statements, applied first |
| An undeclared resolved role is rejected before begin | P6 | ✅ rejection; `driver.transaction` never called, zero statements; **same `code` and identical message** as the explicit `db.as()` path's synchronous throw |
| A resolver yielding nothing sends nothing | P7 | ✅ rejects with `code === "context-provider-empty"`, zero traffic |
| A throwing resolver sends nothing | P8 | ✅ the rejection is the **same object** the resolver threw (`toBe`), zero traffic |
| A missing capability fails before the resolver runs | P9 | ✅ resolver call count 0, zero traffic, same `code` as the `db.as()` path on the same driver |

Type-level delta claim "the type SHALL NOT admit a missing one": verified by
signature — `export type ContextProvider = () => DbContext |
Promise<DbContext>` (`packages/query/src/index.ts` → `db/context.ts` L36),
non-nullable return. (Type derivation.)

Changeset-only claims also probed: the reentrant guard "applies identically
whether or not a provider is registered" — P10: inner `handle.transaction()`
inside its own callback rejects `nested-transaction-unsupported`, the
resolver is **not** consulted a second time, no second driver transaction
opens. The docs claim that a handle chain call inside the callback is "a
genuine second transaction, with the resolver consulted again" (query-layer.md
L686-689) — P12: 2 resolver calls, 2 driver transactions. Both hold.

**No delta scenario contradicts shipped behavior. No BLOCKING finding.**

## Findings

### F1 — MINOR (spec-corpus ambiguity): `query-execution`'s "Executed SQL equals previewed SQL" scenario is left unqualified while a provider handle now wraps

- **Citation**: `openspec/specs/query-execution/spec.md` L14-15: "What is
  sent to the database SHALL be exactly the statement's pure `compile()`
  output." and L17-21, Scenario "Executed SQL equals previewed SQL": "WHEN a
  statement is compiled for preview and then executed on a db handle — THEN
  the SQL text and parameters the driver receives are identical to the
  previewed compile output". Versus the delta (spec.md L28-36): "the
  execution now opens a transaction and runs inside it, with the context's
  role and settings applied first … while the statement's own SQL and
  parameters are unchanged by it."
- **Observed**: probe P2 — on a provider handle the driver receives, inside
  one transaction: `set local role "app_user"`, `select set_config($1, $2,
  true)` (params `["app.tenant","A"]`), then the caller's statement,
  byte-identical (SQL and params) to the bare handle's send and to
  `compile()` (P11). So the driver's *total traffic* is not "identical to
  the previewed compile output"; the *statement's own* send is.
- **Derivation** (textual — the question the brief posed): this is an
  **ambiguity, not a contradiction**, for a reason internal to
  `query-execution` itself: its own scenario "A scoped chain runs inside its
  context-applied transaction" (L97-100) already blesses "the role/setting
  statements that context applies and the chain's own statement all land on
  that one transaction". An exclusive reading of L14-15 would make
  `query-execution` self-contradictory even before this change, so the
  per-statement fidelity reading is the only coherent one, and under it the
  provider complies (probed). What the omitted `query-execution` delta
  leaves behind is *locational*: before, a reader could believe the plain
  `db` handle in the L17 scenario always sends bare; now that is
  construction-option-dependent, and the sentence that says so lives in a
  different capability (`rls-execution-context`, after archive). The corpus
  composes capabilities by design and the delta states the exception
  explicitly and observably, so this does not rise to MAJOR — but the L17
  scenario's THEN is now literally unsatisfiable-as-worded for the whole
  traffic of a provider handle, a WHEN it does not exclude.
- **Recommendation**: next time `query-execution` is touched, qualify the
  scenario ("…identical to the previewed compile output *for that
  statement*; an applied execution context precedes it per
  rls-execution-context"). One clause. Not worth its own change.

### F2 — MINOR (same-file scenario tension after archive): "Scoped and unscoped handles coexist" reads false on a provider handle

- **Citation**: `openspec/specs/rls-execution-context/spec.md` L74-77,
  Scenario "Scoped and unscoped handles coexist": "WHEN `db.as(context)` is
  created and both handles execute statements — THEN only the scoped
  handle's statements run under the context." The delta ADDs (never
  MODIFIES) into this same capability, so after archive this sits beside "every
  execution surface the handle exposes … SHALL run under the resolved
  context" (delta L8-11).
- **Observed/derived**: on a provider handle, *both* handles' statements run
  under a context (P2-P5: base handle wrapped; P4: scoped handle wrapped
  under its own). The old scenario stays true only under the added reading
  that its WHEN implies "a handle without a provider" — which the delta
  states as a requirement (L12-14) but the scenario text never gained.
  Standard scenario-precondition convention resolves it, but the two now
  share one file and the delta chose ADDED-only instead of a MODIFIED
  qualifier on the touched requirement.
- **Recommendation**: acceptable as-is; if the delta is amended before
  archive (see F3), a two-word qualifier on the old scenario's WHEN ("…is
  created **from a provider-less handle** and both handles execute…") would
  close it via a MODIFIED entry.

### F3 — MINOR (docs ahead of spec on an identifier): the user-matchable code `context-provider-empty` is promised by docs and changeset but pinned by no spec text

- **Citation**: delta spec.md L98-113 requires only "an explicit, coded
  failure" / "fails with an explicit coded error" — no identifier. Versus
  `.changeset/add-context-provider.md` L13-15: "fails closed with
  `context-provider-empty`"; `skills/hejbro/references/query-layer.md` L959
  (error table): "`context-provider-empty` | A registered `context`
  provider's resolver yielded no context…".
- **Observed**: probe P7 — the shipped code is `context-provider-empty`, so
  the docs are not ahead of *behavior*, only ahead of *spec*.
- **Derived**: the corpus is split on pinning codes: this same capability
  pins `claims-subject-missing` (main rls spec L108), and `query-execution`
  pins `concurrent-nested-transaction`, `savepoint-release-failed`,
  `assert-schema-not-compared`; but `undeclared-role` and
  `driver-missing-capability` are doc-named only. Since AGENTS.md declares
  the skill docs a user contract, a code users will match on should be
  spec-pinned; a future rename would break users while violating no spec.
- **Recommendation**: this gate is the cheap moment — add the literal
  `context-provider-empty` to the delta's fail-closed requirement (one word)
  before archive.

### F4 — MINOR (overbroad normative sentence): "There is no unscoped path out of a handle that has a provider registered" is false as an absolute

- **Citation**: delta spec.md L102-103 (requirement prose, not a scenario):
  "There is no unscoped path out of a handle that has a provider
  registered." Echoed even more absolutely in
  `skills/hejbro/references/query-layer.md` L659-661: "there is no path out
  of a handle with a registered provider that reaches the database
  uncontexted."
- **Derived** (public types + signatures — no probe needed): the `Db` type
  publicly exposes `readonly driver: Driver` (`packages/query/src/db/db.ts`
  L259, exported via the public `Db` type), and `assertSchema` (exported
  from `hejbro`) accepts `{ schema, driver: DriverSession }` — the handle
  structurally satisfies it and `assertSchema(providerHandle)` sends its
  catalog reads through `handle.driver` with the provider never consulted
  (it cannot even see the `context` option; the assertion spec itself says
  "Every read it performs SHALL go through the driver it was handed"). So
  statements demonstrably leave a provider handle uncontexted via a public
  path. For `assertSchema` this is the *correct* behavior (catalog reads
  under a resolved e.g. anon role would produce spurious divergence), and in
  context the sentence plainly means "no *execution surface* degrades to
  unscoped" — the enumerated-surfaces requirement (L8-11) is precise and
  probed true. But an adversarial reader of the absolute sentence would
  conclude registering a provider contextes *everything* associated with the
  handle, and `handle.driver` / `assertSchema` refute that.
- **Recommendation**: narrow the sentence to its requirement's subject
  ("…no unscoped path out of the handle's execution surfaces") in the delta
  before archive; optionally mirror in query-layer.md L659-661.

## Question 3 sweep (surface vs delta) — no findings beyond F3

- `ContextProvider`/`DbOptions.context` exported from `@hejbro/query` and
  re-exported by `hejbro` via `export *` (cli index L23). ✅
- Changeset claims all probed true (wrapping observable, `as()` precedence,
  exact-error propagation, guard unaffected, preset-zero-code composition —
  P2/P4/P8/P10/S1). ✅
- Note (not a finding): the changeset — a user-facing release note — cites
  `assertDeclaredRole`/`applyContext`, symbols the public API does not
  export; a user cannot resolve them. The observable equivalent (identical
  error object shape/code/message and identical rendered context statements
  between the two paths) is what P2/P4/P6 verified. Cosmetic.
- SKILL.md summary item 10 and the query-layer.md provider section state
  exactly the delta's properties, no more. README does not mention the
  provider (under-promise, not a gap). The supabase-preset reference doesn't
  mention it either; the Supabase adapter example lives in query-layer.md,
  which SKILL.md routes context questions to. Acceptable.

## Question 4 — residual user-surprise notes (no findings)

- The resolver takes **no arguments**: per-request identity must come from
  ambient state (an AsyncLocalStorage-style mechanism or a per-request
  handle). The docs example models this honestly (`verifiedClaims()`), and
  "consulted once per execution and never cached" (probed P5a) keeps it
  sound; a reader skimming only the delta might still expect a
  request-parameterized resolver.
- With a provider, `db.fn.*` and every plain read now cost a transaction
  round-trip envelope per execution. The delta states the wrapping as
  observable; it nowhere frames the throughput implication. Same as
  `db.as()`, so not new.

## Appendix — probe sources

### packages/query/test/d106-probe.test.ts (13 probes, all passing)

```ts
// D106 adversarial spec-only probe — scratch file, NOT part of the repo.
import {
	defineFunction, eq, roleName, schema, select, table, text, uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { CompileResult, Driver, DriverRow, DriverSession } from "../src/index";
import { compile, db } from "../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});
const searchByStatus = defineFunction(
	app, "search_by_status",
	{ args: { status: text() }, returns: posts },
	(ctx, args) => { ctx.return(select(posts).where(eq(posts.status, args.status))); },
);

type LogEntry = {
	readonly via: "direct" | "session";
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};
type Probe = {
	readonly driver: Driver;
	readonly log: Array<LogEntry>;
	readonly txMarkers: Array<string>;
	transactionCalls: number;
};
const makeProbe = (interactive: boolean): Probe => {
	const log: Array<LogEntry> = [];
	const txMarkers: Array<string> = [];
	const probe: Probe = {
		log, txMarkers, transactionCalls: 0,
		driver: {
			capabilities: { "interactive-transactions": interactive, "session-state": true },
			execute: async (c: CompileResult): Promise<ReadonlyArray<DriverRow>> => {
				log.push({ via: "direct", sql: c.sql, params: c.params });
				return [];
			},
			transaction: async <T>(callback: (session: DriverSession) => Promise<T>): Promise<T> => {
				probe.transactionCalls += 1;
				txMarkers.push("begin");
				const session: DriverSession = {
					execute: async (c: CompileResult) => {
						log.push({ via: "session", sql: c.sql, params: c.params });
						return [];
					},
				};
				const result = await callback(session);
				txMarkers.push("commit");
				return result;
			},
			setupSession: async () => {},
			contributedRoles: ["driver_role"],
		},
	};
	return probe;
};

const appUser = roleName("app_user");
const otherUser = roleName("other_user");
const ctxA = { role: appUser, settings: { "app.tenant": "A" } };
const ctxB = { role: otherUser, settings: { "app.tenant": "B" } };

describe("D106 probes", () => {
	it("P1: no provider — statement goes direct, no transaction, no context", async () => {
		const p = makeProbe(true);
		const handle = db({ posts, searchByStatus }, p.driver, { roles: [appUser, otherUser] });
		await handle.select(posts);
		expect(p.transactionCalls).toBe(0);
		expect(p.log).toHaveLength(1);
		expect(p.log[0]?.via).toBe("direct");
		expect(p.log[0]?.sql.toLowerCase()).not.toContain("set local role");
	});

	it("P2: provider wraps the same statement in one transaction, SQL/params unchanged", async () => {
		const bare = makeProbe(true);
		const bareHandle = db({ posts, searchByStatus }, bare.driver, { roles: [appUser, otherUser] });
		await bareHandle.select(posts);
		const bareStatement = bare.log[0];

		const p = makeProbe(true);
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser, otherUser],
			context: () => ctxA,
		});
		await handle.select(posts);
		expect(p.transactionCalls).toBe(1);
		const sqls = p.log.map((e) => e.sql.toLowerCase());
		expect(p.log.every((e) => e.via === "session")).toBe(true);
		expect(sqls[0]).toContain("set local role");
		expect(sqls[0]).toContain('"app_user"');
		expect(sqls[1]).toContain("set_config");
		expect(p.log[1]?.params).toEqual(["app.tenant", "A"]);
		const statement = p.log[p.log.length - 1];
		expect(statement?.sql).toBe(bareStatement?.sql);
		expect(statement?.params).toEqual(bareStatement?.params);
		expect(p.txMarkers).toEqual(["begin", "commit"]);
	});

	it("P3: all four surfaces run under the resolved context", async () => {
		const p = makeProbe(true);
		const calls: Array<string> = [];
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			context: () => { calls.push("resolve"); return ctxA; },
		});
		await handle.select(posts);                                  // chain member
		await handle.execute(select(posts));                          // statement execution
		await handle.fn.searchByStatus({ status: "published" });      // declared-function call
		await handle.transaction(async (tx) => { await tx.select(posts); }); // transaction
		expect(p.transactionCalls).toBe(4);
		const roleStatements = p.log.filter((e) => e.sql.toLowerCase().includes("set local role"));
		expect(roleStatements).toHaveLength(4);
		expect(calls).toHaveLength(4);
	});

	it("P4: explicit as() never consults the provider", async () => {
		const p = makeProbe(true);
		const calls: Array<string> = [];
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser, otherUser],
			context: () => { calls.push("resolve"); return ctxA; },
		});
		await handle.as(ctxB).select(posts);
		expect(calls).toHaveLength(0);
		const roleStatement = p.log.find((e) => e.sql.toLowerCase().includes("set local role"));
		expect(roleStatement?.sql).toContain('"other_user"');
		expect(roleStatement?.sql).not.toContain('"app_user"');
	});

	it("P5a: two executions resolve twice, each under its own returned context", async () => {
		const p = makeProbe(true);
		const contexts = [ctxA, ctxB];
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser, otherUser],
			context: () => {
				const next = contexts.shift();
				if (next === undefined) throw new Error("exhausted");
				return next;
			},
		});
		await handle.select(posts);
		await handle.select(posts);
		expect(contexts).toHaveLength(0);
		const roleStatements = p.log
			.filter((e) => e.sql.toLowerCase().includes("set local role"))
			.map((e) => e.sql);
		expect(roleStatements[0]).toContain('"app_user"');
		expect(roleStatements[1]).toContain('"other_user"');
	});

	it("P5b: one transaction with several statements resolves once, context applied once", async () => {
		const p = makeProbe(true);
		const calls: Array<string> = [];
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			context: () => { calls.push("resolve"); return ctxA; },
		});
		await handle.transaction(async (tx) => {
			await tx.select(posts);
			await tx.select(posts);
			await tx.select(posts);
		});
		expect(calls).toHaveLength(1);
		const roleStatements = p.log.filter((e) => e.sql.toLowerCase().includes("set local role"));
		expect(roleStatements).toHaveLength(1);
		expect(p.log[0]?.sql.toLowerCase()).toContain("set local role");
		expect(p.transactionCalls).toBe(1);
	});

	it("P6: an undeclared resolved role is rejected before begin, same error as explicit path", async () => {
		const p = makeProbe(true);
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			context: () => ({ role: roleName("intruder") }),
		});
		const providerError = await handle.select(posts).then(() => undefined).catch((e: unknown) => e);
		expect(providerError).toBeInstanceOf(Error);
		expect(p.transactionCalls).toBe(0);
		expect(p.log).toHaveLength(0);

		const bare = makeProbe(true);
		const bareHandle = db({ posts, searchByStatus }, bare.driver, { roles: [appUser] });
		const explicitError = (() => {
			try { bareHandle.as({ role: roleName("intruder") }); return undefined; }
			catch (e: unknown) { return e; }
		})();
		const pCode = (providerError as { code?: string }).code;
		const eCode = (explicitError as { code?: string }).code;
		expect(pCode).toBeDefined();
		expect(pCode).toBe(eCode);
		expect((providerError as Error).message).toBe((explicitError as Error).message);
	});

	it("P7: a resolver yielding nothing fails coded, sends nothing", async () => {
		const p = makeProbe(true);
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			// biome-ignore lint/suspicious/noExplicitAny: probing the type bypass
			context: (() => undefined) as any,
		});
		const err = await handle.select(posts).then(() => undefined).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as { code?: string }).code).toBe("context-provider-empty");
		expect(p.transactionCalls).toBe(0);
		expect(p.log).toHaveLength(0);
	});

	it("P8: a throwing resolver propagates its exact error, sends nothing", async () => {
		const p = makeProbe(true);
		const boom = new Error("auth layer down");
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			context: () => { throw boom; },
		});
		const err = await handle.select(posts).then(() => undefined).catch((e: unknown) => e);
		expect(err).toBe(boom);
		expect(p.transactionCalls).toBe(0);
		expect(p.log).toHaveLength(0);
	});

	it("P9: missing capability fails before the resolver runs, same error as db.as", async () => {
		const p = makeProbe(false);
		const calls: Array<string> = [];
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			context: () => { calls.push("resolve"); return ctxA; },
		});
		const err = await handle.select(posts).then(() => undefined).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Error);
		expect(calls).toHaveLength(0);
		expect(p.log).toHaveLength(0);
		expect(p.transactionCalls).toBe(0);

		const bare = makeProbe(false);
		const bareHandle = db({ posts, searchByStatus }, bare.driver, { roles: [appUser] });
		const asErr = await bareHandle.as(ctxA).select(posts).then(() => undefined).catch((e: unknown) => e);
		expect((err as { code?: string }).code).toBe((asErr as { code?: string }).code);
	});

	it("P10: reentrant handle.transaction with a provider still fails the guard", async () => {
		const p = makeProbe(true);
		const calls: Array<string> = [];
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			context: () => { calls.push("resolve"); return ctxA; },
		});
		const err = await handle
			.transaction(async () => { await handle.transaction(async () => {}); })
			.then(() => undefined)
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Error);
		const code = (err as { code?: string }).code;
		expect(code).toBeDefined();
		console.log("P10 code:", code, "resolver calls:", calls.length, "txCalls:", p.transactionCalls);
		// Run output: P10 code: nested-transaction-unsupported resolver calls: 1 txCalls: 1
	});

	it("P12: a handle chain call inside the callback is a second transaction, resolver consulted again", async () => {
		const p = makeProbe(true);
		const calls: Array<string> = [];
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			context: () => { calls.push("resolve"); return ctxA; },
		});
		await handle.transaction(async () => {
			await handle.select(posts); // handle, not tx — docs: second transaction, second resolve
		});
		expect(calls).toHaveLength(2);
		expect(p.transactionCalls).toBe(2);
	});

	it("P11: executed statement SQL equals compile() preview on a provider handle", async () => {
		const p = makeProbe(true);
		const handle = db({ posts, searchByStatus }, p.driver, {
			roles: [appUser],
			context: () => ctxA,
		});
		const statement = select(posts).where(eq(posts.status, "published"));
		const preview = compile(statement);
		await handle.execute(statement);
		const sent = p.log[p.log.length - 1];
		expect(sent?.sql).toBe(preview.sql);
		expect(sent?.params).toEqual(preview.params);
	});
});
```

### packages/supabase/test/d106-preset-probe.test.ts (1 probe, passing)

```ts
// D106 adversarial spec-only probe — scratch file, NOT part of the repo.
import { schema, table, text, uuid } from "@hejbro/core";
import type { CompileResult, Driver, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { asAnon, asUser, supabaseDriver } from "../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

type LogEntry = { readonly sql: string; readonly params: ReadonlyArray<unknown> };

const makeInner = (log: Array<LogEntry>): Driver => ({
	capabilities: { "interactive-transactions": true, "session-state": true },
	execute: async (c: CompileResult) => {
		log.push({ sql: c.sql, params: c.params });
		return [];
	},
	transaction: async <T>(cb: (s: DriverSession) => Promise<T>): Promise<T> =>
		cb({
			execute: async (c: CompileResult) => {
				log.push({ sql: c.sql, params: c.params });
				return [];
			},
		}),
	setupSession: async () => {},
});

describe("D106 preset probe", () => {
	it("asUser/asAnon flow through the provider unchanged", async () => {
		const log: Array<LogEntry> = [];
		const driver = supabaseDriver(makeInner(log));
		const requests: Array<{ sub: string } | undefined> = [
			{ sub: "11111111-1111-1111-1111-111111111111" },
			undefined,
		];
		const handle = db({ posts }, driver, {
			context: () => {
				const claims = requests.shift();
				return claims === undefined ? asAnon() : asUser(claims);
			},
		});
		await handle.select(posts); // request 1: authenticated
		await handle.select(posts); // request 2: anon
		const roleStatements = log
			.filter((e) => e.sql.toLowerCase().includes("set local role"))
			.map((e) => e.sql);
		expect(roleStatements[0]).toContain('"authenticated"');
		expect(roleStatements[1]).toContain('"anon"');
		const settings = log.filter((e) => e.sql.includes("set_config"));
		expect(settings).toHaveLength(2);
		expect(settings[0]?.params[0]).toBe("request.jwt.claims");
		const claimsJson = JSON.parse(String(settings[0]?.params[1])) as {
			sub?: string; role?: string;
		};
		expect(claimsJson.sub).toBe("11111111-1111-1111-1111-111111111111");
		expect(claimsJson.role).toBe("authenticated");
	});
});
```
