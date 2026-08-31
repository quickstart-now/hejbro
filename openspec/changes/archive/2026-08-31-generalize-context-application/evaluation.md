# D106 adversarial spec-only evaluation — `generalize-context-application`

**VERDICT: BLOCK — 1 BLOCKING, 2 MAJOR, 5 MINOR (8 findings).**

Evaluator: isolated, spec-only, zero team context. Evidence base: the two
delta spec files, the main corpus (`openspec/specs/**`), the public
surface (`packages/*/src/index.ts` exports, built `@hejbro/query` dist via
the package specifier, `skills/hejbro/**`,
`.changeset/generalize-context-application.md`, README), and executed
runtime probes against the public API. Probe environment: the git-less
export at `scratchpad/d106-gca-eval` (dependencies installed, packages
built). Probe suites written for this evaluation:

- `packages/query/test/d106-probe.test.ts` — 25 probes, all passing
  (vitest, source alias per the package's own config; the public barrel
  `src/index.ts` is the import target).
- `packages/pg/d106-entry-probe.mjs` — plain `node`, imports
  `@hejbro/query` through the **built dist** via the package specifier
  from a dependent package's own resolution (no alias, no deep path).
- `packages/neon/test/d106-probe.test.ts` — 1 probe, passing.

Repo's own paired suites were also run green for corroboration:
`test/db/context.test.ts`, `context-provider.test.ts`,
`context-required.test.ts`, `test/driver/contract.test.ts`,
`test/exports.test.ts` (107 tests total incl. probes), and
`packages/supabase/test/driver.test.ts` (the transaction-pooler baseline
pin). Probe sources are inline at the end of this report.

---

## Findings

### F1 — BLOCKING — Two delta scenarios claim contributed statements are "the first statements inside the transaction"; the same delta's own requirement text, and shipped behavior, say they are not

**Category:** delta scenario contradicts shipped behavior (quantifier
defect: the universal fails for a contract-sanctioned instance class).

**Citations:**

- `openspec/changes/generalize-context-application/specs/driver-contract/spec.md`,
  Scenario "The query layer sends what the driver returned" (lines 53–57):
  > **THEN** the statements the driver returned are the first statements
  > inside that execution's transaction, in the driver's own order, sent
  > through the query layer's own execution path
- Same file, requirement body paragraph 1 (lines 10–13) uses the same
  unqualified phrase: "…the query layer SHALL be the one that sends the
  returned statements, **as the first statements inside the transaction
  it opens** for that execution, in the order given."
- `openspec/changes/generalize-context-application/specs/rls-execution-context/spec.md`,
  Scenario "A driver's contributed statements are what gets sent"
  (lines 31–36):
  > **THEN** exactly that driver's statements are sent, in exactly its
  > order, **as the first statements inside the wrapping transaction**,
  > and the default rendering appears nowhere
- **The contradiction is internal to the same delta.** The driver-contract
  delta's fourth paragraph (lines 27–37) states the qualified — and
  correct — rule:
  > The statements the query layer sends first are first **among its
  > own**: a driver may already send session statements of its own inside
  > the transaction it opens, before the query layer sends anything (a
  > transaction-mode pooler pinning output formats is the shipped
  > example, **and its pins do precede the context statements today**).

**Observed behavior (executed probes):**

1. The delta's own named shipped example is real: on the Supabase
   transaction-pooler driver, `poolerDriver`'s `transaction` member sends
   `set local intervalstyle…` / `set local bytea_output…` **inside the
   transaction, before the callback** (`packages/supabase/src/pooler.ts`
   lines 99–103), so the rendered context statements are *not* first
   inside the wrapping transaction. The repository's own baseline pin
   test asserts exactly this transcript and passes
   (`packages/supabase/test/driver.test.ts` lines 269–277: pins → `set
   local role "anon"` → `set_config` → caller, in one transaction; run
   green in this evaluation).
2. Probe **P4** drives the same shape through a *contributing* driver —
   the instance the two scenarios quantify over. A driver whose
   `transaction` member sends one setup statement after `BEGIN` (a shape
   the driver-contract corpus itself *requires* of `session-state:
   false` drivers whose settings are not part of their rendering — main
   corpus, "A driver that keeps transactions but not sessions carries
   its settings inside one") and that also declares a `renderContext`
   yields the transcript:
   `<begin>` → `set local intervalstyle to 'postgres'` →
   `select platform_ctx()` (the contributed statement) → caller.
   The contributed statements are **not** "the first statements inside
   that execution's transaction". The shipped query layer guarantees
   order-preservation and before-the-caller placement only — exactly
   what the requirement's "first among its own" paragraph says, and
   nothing more.

**Why BLOCKING:** each scenario is the testable unit that the archive
will sync into the main corpus. Both quantify over "a contributing
driver" with no restriction, and the requirement's own prose names the
instance class (in-transaction driver setup sends) for which the THEN is
false — a class the contract elsewhere *mandates* for session-state-less
drivers, and one constructible today through the public `Driver` type.
A conforming test built from the scenario's own words, using the
requirement's own named example as the base driver, fails against the
shipped query layer. The failure is in the spec text, not the code: the
fix is to requalify both scenarios (and the requirement's opening
paragraph) to the "first among the statements the query layer sends /
before any caller-supplied statement" form that paragraph 4 already
states and that shipped behavior honors.

**Evidence kind:** executed probe (P4; supabase baseline pin test run) +
textual derivation (delta-internal contradiction).

---

### F2 — MAJOR — The role-less admission scenario attributes settings application to "the driver's own rendering"; on a role-less-platform driver that contributes no rendering, the default rendering applies

**Citation:**
`openspec/changes/generalize-context-application/specs/rls-execution-context/spec.md`,
Scenario "A role-less context is admitted where the platform has none"
(lines 89–93):
> **WHEN** `db.as(context)` is called with a context naming no role, on a
> driver that declares its platform has no roles
> **THEN** the call succeeds, no role statement is sent at all, and the
> context's settings are applied **through the driver's own rendering**

**Observed behavior (executed probe P5):** `roleLessPlatform` and
`renderContext` are independent optionals on the public `Driver` type
(`packages/query/src/driver/contract.ts` lines 140, 149); the delta's
driver-contract file treats them as independent declarations. A driver
declaring `roleLessPlatform: true` with `renderContext` **undefined** is
admissible, and on it `db.as({ settings: { k: "v" } })` succeeds with
transcript `<begin>` → `select set_config($1, $2, true)` → caller — the
settings are applied by the **query layer's default rendering** (which
accepts the role-less shape and emits no role statement), while the
driver observably has no rendering of its own. The scenario's observable
safety claims ("the call succeeds, no role statement is sent at all")
hold; the mechanism clause is false for this admissible instance.

An alternative reading — "the driver's own rendering" as "the rendering
in effect for that driver" — would save the scenario, but the delta's own
vocabulary consistently uses "its own rendering" for a *contributed* one
("a driver whose platform needs the ordinary statements plus **its own**
can compose them"), so the natural reading is contradicted. Same defect
class as F1 with a smaller blast radius (no guarantee rides on the
clause). Fix: "…applied through the rendering in effect for that driver
— its own contribution, or the default rendering, which accepts a
role-less context" or simply "…are still applied".

**Evidence kind:** executed probe (P5) + type derivation (independent
optionals on the public `Driver` type).

---

### F3 — MAJOR — The modified mechanism requirement keeps the corpus's "nothing persists on the connection afterwards" guarantee (and its scenario verbatim) while removing what enforced it, and transfers no transaction-locality obligation to contributed renderings

**Citations:**

- Main corpus, `openspec/specs/rls-execution-context/spec.md` (lines
  12–16), the guarantee's original grounding:
  > Executing under a context SHALL wrap the statements in a transaction
  > that applies the role and settings **with transaction-local scope
  > (`SET LOCAL` semantics)** before they run, so nothing persists on the
  > connection afterwards.
- Delta MODIFIED "Generic context mechanism" (rls delta, lines 12–15)
  keeps the conclusion, drops the premise:
  > …opens the wrapping transaction, and sends the rendered statements
  > itself — first, in the given order, before any caller-supplied
  > statement — **so nothing persists on the connection afterwards**.
- The corpus scenario is retained verbatim and universally quantified
  (rls delta, lines 24–29): "**WHEN** a statement is executed under a
  context on a pooled connection **THEN** the role and settings are
  applied transaction-locally before the statement, and a subsequent
  statement on the same connection without a context observes none of
  them."
- The obligation transferred to contributing drivers covers **injection
  safety only** (rls delta, lines 105–111: "where its platform's
  statement form cannot accept a bind parameter, the driver … SHALL be
  responsible for escaping or otherwise constraining the value it
  interpolates"). Nothing in either delta obliges a contributed
  rendering's statements to be transaction-local.

**Derived behavior:** the query layer applies contributed statements "as
given without inspecting or rewriting them" (delta's own scenario, rls
lines 124–129; confirmed by probe P3 — statements pass through
byte-identical in SQL and params). A contributed rendering that emits a
session-scoped form (`set search_path to …` rather than `set local …`,
or `set_config(key, value, false)`) therefore leaves state on the pooled
connection after commit — plain Postgres semantics — and the query layer
neither prevents nor detects it. Post-generalization, "nothing persists
on the connection afterwards" and the retained scenario are guarantees
the specified system can no longer make unconditionally; they are true
of the default rendering and *contingent* for contributed ones, yet the
delta states them as unconditional while explicitly forbidding the query
layer from inspecting the statements. The safety-transfer paragraph
shows the change knew obligations must move to contributing drivers —
transaction-locality is the one it forgot to move. Fix: state the
locality obligation on contributed renderings (mirroring the injection
paragraph), or condition the persistence claim on it.

**Evidence kind:** textual derivation (spec-to-spec) + executed probe
(P3 passthrough) + standard Postgres `SET`/`SET LOCAL` semantics.

---

### F4 — MINOR — The role-less refusal ships and is user-documented under `context-role-missing`, but neither delta names the code

**Citation:** rls delta lines 66–68 ("…it SHALL be rejected before any
statement is sent, **with an explicit error**") and the scenario at lines
82–87 name no code, while the *same change's* sibling refusal is pinned
to `context-required` by name (rls delta line 158). Shipped:
`code: "context-role-missing"` (`packages/query/src/db/context.ts` line
123; probe P6/P6b), and `skills/hejbro/references/query-layer.md` line
1053 promises that exact code to users. The corpus convention pins codes
in scenarios (`context-provider-empty`, `concurrent-nested-transaction`,
the `assert-schema-*` family). The public surface therefore promises an
identifier the spec does not specify — a compatibility-relevant token
users are told to branch on lives only in docs.

**Evidence kind:** executed probe (P6) + textual derivation.

### F5 — MINOR — The skills reference documents the new mechanism descriptively but names neither the new public exports (`defaultContextRendering`, `ContextRendering`) nor the `renderContext`/`contextRequired` member names

**Citation:** `skills/hejbro/references/query-layer.md` "Driver-owned
context application" (lines 733–770) describes all three declarations
but names only `Driver.roleLessPlatform` (line 1053). Grep over
`skills/hejbro/**` finds no occurrence of `renderContext`,
`contextRequired` (the member), `defaultContextRendering`, or
`ContextRendering`. The delta makes composability a requirement ("The
default rendering SHALL be reachable by a driver package … importable
from `@hejbro/query`'s public entry point"), and it ships (entry probe
below; also pinned by the repo's own `packages/pg` test), but a driver
author relying on the skill — which has a dedicated
"Writing your own `Driver`" section (lines 1058–1075) — is never told
the export exists or what the members are called. The changeset names
`renderContext`/`roleLessPlatform`/`contextRequired` but also omits the
`defaultContextRendering` export. Direction: behavior ships beyond the
docs (no over-promise found), but AGENTS.md's own rule is "the skill
documents the surface; a stale skill is a broken user contract".

**Evidence kind:** executed probe (entry probe) + textual derivation.

### F6 — MINOR — The mandatory-context declaration is satisfiable vacuously; the specs are silent

Two adjacent surprises a user relying only on specs+docs would hit
(question 4), both probed:

- **Empty contributed rendering:** a driver whose `renderContext` returns
  `[]` "applies" a context with zero statements — the transaction opens
  and the caller's statement runs with no context statement at all
  (probe P10a). No delta text addresses an empty list; "in the order
  given" is trivially satisfied.
- **`contextRequired` + `roleLessPlatform` + `db.as({})`:** an entirely
  empty context (`{}` — no role, no settings; both members of the public
  `DbContext` are optional) counts as "an explicitly named context",
  renders zero statements under the default rendering, and satisfies the
  fail-closed mandatory-context declaration (probe P10b). The rls delta's
  rationale ("an unapplied context is a data-exposure outcome") is
  defeated by a context that applies nothing, yet the requirement's
  satisfaction clause ("runs under an explicitly named context") makes
  this literal-true rather than contradicted.

Not contradictions; unstated boundary behavior worth a sentence in the
spec or the skill before a role-less-platform preset ships.

**Evidence kind:** executed probes (P10a/P10b).

### F7 — MINOR — The `context-required` refusal names its operation `db.context` on chain/execute/fn surfaces — a member that does not exist on the handle

**Citation:** rls delta scenario "Every execution surface refuses alike"
(lines 161–165: "each fails with the same error"). Shipped: every surface
refuses with the same **code** (`context-required`; probe P8 across
execute, all five chain members, `db.fn.*`, `transaction`), satisfying
the scenario at the code level, but the message's operation token is
`"this driver requires an execution context for db.context…"` for
execute/chain/fn (from `PROVIDER_OPERATION = "db.context"`,
`packages/query/src/db/db.ts` line 356) and `for transaction` for the
transaction API (probe P10c). `db.context` names the `db()` *option*,
not any surface the caller invoked — a user reading the error cannot map
it to their call site the way `driver-missing-capability`'s operation
names do.

**Evidence kind:** executed probe (P10c) + textual derivation.

### F8 — MINOR — The skills reference still asserts `@hejbro/neon` does not exist, in the same file this change extended

**Citation:** `skills/hejbro/references/query-layer.md` lines 1025–1026:
> `@hejbro/neon` and `@hejbro/nile` presets (#300, #301) — only
> `@hejbro/pg` (vanilla) and `@hejbro/supabase` exist today.

Contradicted by the same skill's own `references/neon-preset.md`, by
AGENTS.md's fixed six-package group, by the changeset ("`@hejbro/neon`
… contribute[s] no rendering"), and by the delta's own Neon one-shot
scenario. Almost certainly pre-existing staleness rather than this
change's regression (unverifiable here — the export is git-less), but a
user relying only on specs+docs meets a reference that both documents
the Neon preset and denies it exists. Flagged for the archive gate since
this change edited the same file.

**Evidence kind:** textual derivation.

---

## What was checked and held (the PASS side of the ledger)

Every claim below was verified against shipped behavior; evidence kind in
brackets. Probes are in the suites listed at the top.

**driver-contract delta:**
- Contribution is not a capability; `DriverCapabilityKey` still exactly
  the two names; `renderContext`/`roleLessPlatform`/`contextRequired`
  are separate optional data members [type derivation on the public
  `Driver` type + repo's contract tests run green].
- A contributing driver's rendering fully replaces the default, is
  invoked exactly once with the context value, its statements are sent in
  its order before the caller's, through the query layer's own execution
  path (a failing contributed statement surfaces as
  `query-execution-failed`) [executed probes P3].
- Contributing nothing keeps the existing statements — verified for the
  quantified set: `@hejbro/pg`, `@hejbro/supabase`, `@hejbro/neon`
  declare none of the three members (source grep over all three
  packages) and each carries a pre-generalization baseline pin test
  (#557: `packages/pg/test/driver.test.ts` line 767,
  `packages/supabase/test/driver.test.ts` line 247,
  `packages/neon/test/driver.test.ts` line 315), all run green here; a
  non-contributing fake receives byte-exactly
  `defaultContextRendering(ctx)` then the caller's statement [executed
  probes P2 + repo suites].
- Default rendering importable from `@hejbro/query`'s public entry, no
  deep path: `import { defaultContextRendering } from "@hejbro/query"`
  resolves through the built dist from a dependent package and produces
  exactly the statements the layer applies (`set local role "…"`, then
  `select set_config($1, $2, true)` per setting) [executed probe,
  `d106-entry-probe.mjs`; `ContextRendering` type on the barrel —
  type derivation, pinned by `test/exports.test.ts`].
- Role-less declaration: absence means "platform has roles" (the type
  admits only `true`); silence refuses a role-less context exactly like
  a declaring-has-roles driver; a named role is still whitelist-validated
  on a role-less platform (`undeclared-role`) [executed probes P6, P7 +
  type derivation].
- Mandatory context is data, not capability, not inferable; the driver's
  own `execute` member is unchanged by it (`handle.driver` is the same
  object; direct `driver.execute` reaches the recorder uncontexted)
  [executed probe P8].
- Contributing a rendering does not widen who may run a context:
  `driver-missing-capability` fires before the rendering is invoked and
  before the resolver is called, nothing sent [executed probes P9]; the
  Neon one-shot HTTP driver still fails `db.as(context)` with exactly
  `driver-missing-capability`/`interactive-transactions`, zero HTTP
  calls, and declares none of the three new members [executed probe,
  neon suite].

**rls-execution-context delta:**
- Default rendering statement forms and order (role first, one
  parameterized `set_config` per setting, declaration order); adversarial
  role quote escaped (`"evil""role"`), raw name never a substring;
  setting values travel only as bind parameters [executed probes P1].
- Role-less context is not a whitelist bypass: refused synchronously at
  `db.as(...)` call time on an ordinary driver, and refused before the
  transaction opens on the provider path, `context-role-missing`,
  nothing sent [executed probes P6, P6b].
- Mandatory context refuses every execution surface — statement
  execution, all five thenable chain members (`select`/`insert`/
  `update`/`deleteFrom`/`with`), a declared-function call (`db.fn.*`),
  and the transaction API (callback never runs) — with coded
  `context-required`, nothing reaching the driver; an explicit
  `db.as(context)` and a registered provider each satisfy it; a
  non-declaring driver runs uncontexted with no transaction, exactly as
  before [executed probes P8 + repo's `context-required.test.ts`].
- The "Declared roles:" listing never appears on the role-less refusal —
  `context-role-missing` carries its own message naming the two actual
  remedies; the empty-whitelist `undeclared-role` case prints
  "(none declared)" rather than an empty list [source + probes].
- Changeset claims all verified: surface list, `handle.driver`
  exemption, capability gate before rendering/resolver, three drivers
  pinned, optional role semantics [executed probes + suites above].

**Interplay checks (question 4):** provider registered on a
`contextRequired` driver wins and executes under the resolved context
[probe P8]; explicit `.as()` never consults the provider [repo suite,
corpus-unchanged]; a role named on a role-less platform driver is
admitted when (and only when) the schema/options/driver whitelist
declares it — the declaration grants no exemption and no extra refusal
[probe P7 + textual].

---

## Probe sources

### `packages/query/test/d106-probe.test.ts` (25 probes, all green)

```ts
/**
 * D106 adversarial probes for generalize-context-application.
 * Scratch file — not part of the repository's own suite. All assertions
 * drive the public barrel (`../src/index`) plus core's public factories.
 */
import {
	defineFunction,
	grant,
	roleName,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import type {
	CompileResult,
	ContextRendering,
	DbContext,
	Driver,
	DriverSession,
} from "../src/index";
import { db, defaultContextRendering } from "../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});
const readerGrant = grant(app).usage.to("app_reader");
const listPosts = defineFunction(app, "list_posts", { returns: posts }, (ctx) => {
	ctx.return(select(posts));
});
const appSchema = { posts, readerGrant, listPosts };

type Recorded = { sql: string; params: ReadonlyArray<unknown> };

/** Minimal recording driver: `transaction` marks begin/commit, every send lands in `sent`. */
const makeRecordingDriver = (
	overrides: Partial<Driver> & Record<string, unknown> = {},
	transactionSetup: ReadonlyArray<CompileResult> = [],
) => {
	const sent: Recorded[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			sent.push({ sql: compiled.sql, params: compiled.params });
			return [];
		},
	};
	const driver: Driver = {
		capabilities: { "interactive-transactions": true, "session-state": true },
		execute: vi.fn(async (compiled: CompileResult) => {
			sent.push({ sql: compiled.sql, params: compiled.params });
			return [];
		}),
		transaction: async (callback) => {
			sent.push({ sql: "<begin>", params: [] });
			for (const setup of transactionSetup) {
				await session.execute(setup);
			}
			const result = await callback(session);
			sent.push({ sql: "<commit>", params: [] });
			return result;
		},
		setupSession: async () => {},
		...overrides,
	};
	return { driver, sent };
};

const sqlsOf = (sent: ReadonlyArray<Recorded>) => sent.map((entry) => entry.sql);

describe("P1: defaultContextRendering is the exported, composable default", () => {
	it("renders role first, then one parameterized set_config per setting, in declaration order", () => {
		const statements = defaultContextRendering({
			role: roleName("app_reader"),
			settings: { "a.first": "1", "b.second": "2" },
		});
		expect(statements.map((s) => ({ sql: s.sql, params: s.params }))).toEqual([
			{ sql: 'set local role "app_reader"', params: [] },
			{ sql: "select set_config($1, $2, true)", params: ["a.first", "1"] },
			{ sql: "select set_config($1, $2, true)", params: ["b.second", "2"] },
		]);
	});
	it("accepts a role-less context (no role statement)", () => {
		const statements = defaultContextRendering({ settings: { k: "v" } });
		expect(statements.map((s) => s.sql)).toEqual([
			"select set_config($1, $2, true)",
		]);
	});
	it("renders an entirely empty context to zero statements", () => {
		expect(defaultContextRendering({})).toEqual([]);
	});
	it("escapes an embedded double quote in the role name", () => {
		const statements = defaultContextRendering({
			role: roleName('evil"role'),
		});
		expect(statements[0]?.sql).not.toContain('"evil"role"');
		expect(statements[0]?.sql).toBe('set local role "evil""role"');
	});
});

describe("P2: a non-contributing driver gets exactly the default rendering's statements", () => {
	it("transcript = begin, default rendering, caller, commit", async () => {
		const { driver, sent } = makeRecordingDriver();
		const handle = db(appSchema, driver);
		const ctx: DbContext = {
			role: roleName("app_reader"),
			settings: { "request.k": "v" },
		};
		await handle.as(ctx).execute(select(posts));
		const expected = defaultContextRendering(ctx).map((s) => s.sql);
		expect(sqlsOf(sent).slice(0, 1 + expected.length)).toEqual([
			"<begin>",
			...expected,
		]);
		expect(sqlsOf(sent).at(-1)).toBe("<commit>");
		// exactly one caller statement between context and commit
		expect(sent.length).toBe(1 + expected.length + 1 + 1);
	});
});

describe("P3: a contributing driver's rendering fully replaces the default", () => {
	it("sends exactly the driver's statements, in its order, before the caller's; default appears nowhere", async () => {
		const rendering = vi.fn<ContextRendering>(() => [
			{ sql: "select platform_ctx($1)", params: ["one"], kind: "sql" },
			{ sql: "select platform_ctx($1)", params: ["two"], kind: "sql" },
		]);
		const { driver, sent } = makeRecordingDriver({ renderContext: rendering });
		const handle = db(appSchema, driver);
		const ctx: DbContext = {
			role: roleName("app_reader"),
			settings: { k: "v" },
		};
		await handle.as(ctx).execute(select(posts));
		expect(rendering).toHaveBeenCalledExactlyOnceWith(ctx);
		const sqls = sqlsOf(sent);
		expect(sqls[0]).toBe("<begin>");
		expect(sqls[1]).toBe("select platform_ctx($1)");
		expect(sqls[2]).toBe("select platform_ctx($1)");
		expect(sent[1]?.params).toEqual(["one"]);
		expect(sent[2]?.params).toEqual(["two"]);
		expect(sqls.some((sql) => sql.startsWith("set local role"))).toBe(false);
		expect(sqls.some((sql) => sql.includes("set_config"))).toBe(false);
	});
	it("a failing contributed statement surfaces through the query layer's own error path", async () => {
		const failing: ContextRendering = () => [
			{ sql: "select platform_ctx()", params: [], kind: "sql" },
		];
		const sentCount = { n: 0 };
		const driver: Driver = {
			capabilities: { "interactive-transactions": true, "session-state": true },
			execute: async () => [],
			transaction: async (callback) =>
				callback({
					execute: async () => {
						sentCount.n += 1;
						throw new Error("platform said no");
					},
				}),
			setupSession: async () => {},
			renderContext: failing,
		};
		const handle = db(appSchema, driver);
		await expect(
			handle.as({ role: roleName("app_reader") }).execute(select(posts)),
		).rejects.toMatchObject({ code: "query-execution-failed" });
	});
});

describe("P4: 'first statements inside the transaction' vs a driver with its own transaction-setup sends", () => {
	it("a contract-sanctioned driver that pins inside its transaction puts its pins BEFORE the contributed statements", async () => {
		const rendering: ContextRendering = () => [
			{ sql: "select platform_ctx()", params: [], kind: "sql" },
		];
		const { driver, sent } = makeRecordingDriver({ renderContext: rendering }, [
			{ sql: "set local intervalstyle to 'postgres'", params: [], kind: "sql" },
		]);
		const handle = db(appSchema, driver);
		await handle.as({ role: roleName("app_reader") }).execute(select(posts));
		const sqls = sqlsOf(sent);
		// the driver's own setup statement is inside the transaction, ahead
		// of the contributed statements — the contributed statements are NOT
		// "the first statements inside that execution's transaction"
		expect(sqls[0]).toBe("<begin>");
		expect(sqls[1]).toBe("set local intervalstyle to 'postgres'");
		expect(sqls[2]).toBe("select platform_ctx()");
	});
});

describe("P5/P6/P7: role-optionality", () => {
	it("P5: role-less context on a roleLessPlatform driver WITHOUT a rendering applies settings via the DEFAULT rendering", async () => {
		const { driver, sent } = makeRecordingDriver({ roleLessPlatform: true });
		expect(driver.renderContext).toBeUndefined();
		const handle = db(appSchema, driver);
		await handle.as({ settings: { k: "v" } }).execute(select(posts));
		const sqls = sqlsOf(sent);
		expect(sqls[0]).toBe("<begin>");
		expect(sqls[1]).toBe("select set_config($1, $2, true)");
		expect(sqls.some((sql) => sql.includes("role"))).toBe(false);
	});
	it("P6: role-less context on an ordinary driver is refused synchronously, before any send", () => {
		const { driver, sent } = makeRecordingDriver();
		const handle = db(appSchema, driver);
		expect(() => handle.as({ settings: { k: "v" } })).toThrowError(
			expect.objectContaining({ code: "context-role-missing" }),
		);
		expect(sent).toEqual([]);
	});
	it("P6b: a provider-resolved role-less context on an ordinary driver is refused before the transaction opens", async () => {
		const { driver, sent } = makeRecordingDriver();
		const handle = db(appSchema, driver, {
			context: () => ({ settings: { k: "v" } }),
		});
		await expect(handle.execute(select(posts))).rejects.toMatchObject({
			code: "context-role-missing",
		});
		expect(sent).toEqual([]);
	});
	it("P7: a named role is still whitelist-validated on a roleLessPlatform driver", () => {
		const { driver, sent } = makeRecordingDriver({ roleLessPlatform: true });
		const handle = db(appSchema, driver);
		expect(() => handle.as({ role: roleName("not_declared") })).toThrowError(
			expect.objectContaining({ code: "undeclared-role" }),
		);
		expect(sent).toEqual([]);
	});
});

describe("P8: contextRequired refuses every execution surface, exempts non-execution members", () => {
	const makeHandle = () => {
		const { driver, sent } = makeRecordingDriver({ contextRequired: true });
		return { driver, sent, handle: db(appSchema, driver) };
	};
	it("statement execution refuses", async () => {
		const { handle, sent } = makeHandle();
		await expect(handle.execute(select(posts))).rejects.toMatchObject({
			code: "context-required",
		});
		expect(sent).toEqual([]);
	});
	it("thenable chain members refuse (select/insert/update/deleteFrom/with)", async () => {
		const { handle, sent } = makeHandle();
		await expect(handle.select(posts)).rejects.toMatchObject({
			code: "context-required",
		});
		await expect(
			handle.insert(posts).values({ id: crypto.randomUUID(), status: "x" }),
		).rejects.toMatchObject({ code: "context-required" });
		await expect(
			handle.update(posts).set({ status: "y" }),
		).rejects.toMatchObject({ code: "context-required" });
		await expect(handle.deleteFrom(posts)).rejects.toMatchObject({
			code: "context-required",
		});
		await expect(
			handle.with((w) => {
				const p = w.as("p", select(posts));
				return select({ id: p.id }, p);
			}),
		).rejects.toMatchObject({ code: "context-required" });
		expect(sent).toEqual([]);
	});
	it("a declared-function call refuses", async () => {
		const { handle, sent } = makeHandle();
		await expect(handle.fn.listPosts({})).rejects.toMatchObject({
			code: "context-required",
		});
		expect(sent).toEqual([]);
	});
	it("the transaction API refuses and the callback never runs", async () => {
		const { handle, sent } = makeHandle();
		const callback = vi.fn(async () => {});
		await expect(handle.transaction(callback)).rejects.toMatchObject({
			code: "context-required",
		});
		expect(callback).not.toHaveBeenCalled();
		expect(sent).toEqual([]);
	});
	it("the driver member is exempt: driver.execute is unchanged by the declaration", async () => {
		const { handle, driver, sent } = makeHandle();
		expect(handle.driver).toBe(driver);
		await handle.driver.execute({
			sql: "select 1",
			params: [],
			kind: "sql",
		});
		expect(sqlsOf(sent)).toEqual(["select 1"]);
	});
	it("an explicit context satisfies the requirement", async () => {
		const { handle, sent } = makeHandle();
		await handle.as({ role: roleName("app_reader") }).execute(select(posts));
		expect(sqlsOf(sent)[0]).toBe("<begin>");
		expect(sqlsOf(sent)[1]).toBe('set local role "app_reader"');
	});
	it("a registered provider satisfies the requirement", async () => {
		const { driver, sent } = makeRecordingDriver({ contextRequired: true });
		const handle = db(appSchema, driver, {
			context: () => ({ role: roleName("app_reader") }),
		});
		await handle.execute(select(posts));
		expect(sqlsOf(sent)[0]).toBe("<begin>");
		expect(sqlsOf(sent)[1]).toBe('set local role "app_reader"');
	});
	it("a driver that does not declare it runs uncontexted with no transaction", async () => {
		const { driver, sent } = makeRecordingDriver();
		const handle = db(appSchema, driver);
		await handle.execute(select(posts));
		expect(sqlsOf(sent).some((sql) => sql === "<begin>")).toBe(false);
		expect(sent.length).toBe(1);
	});
});

describe("P9: the capability gate precedes both the resolver and the contribution", () => {
	it("db.as on a contributing, transactionless driver refuses with driver-missing-capability; the rendering is never invoked", async () => {
		const rendering = vi.fn<ContextRendering>(() => []);
		const { driver, sent } = makeRecordingDriver({
			capabilities: {
				"interactive-transactions": false,
				"session-state": false,
			},
			renderContext: rendering,
		});
		const handle = db(appSchema, driver);
		await expect(
			handle.as({ role: roleName("app_reader") }).execute(select(posts)),
		).rejects.toMatchObject({
			code: "driver-missing-capability",
			capability: "interactive-transactions",
		});
		expect(rendering).not.toHaveBeenCalled();
		expect(sent).toEqual([]);
	});
	it("on a provider handle the failure fires before the resolver is called", async () => {
		const rendering = vi.fn<ContextRendering>(() => []);
		const resolver = vi.fn(() => ({ role: roleName("app_reader") }));
		const { driver, sent } = makeRecordingDriver({
			capabilities: {
				"interactive-transactions": false,
				"session-state": false,
			},
			renderContext: rendering,
		});
		const handle = db(appSchema, driver, { context: resolver });
		await expect(handle.execute(select(posts))).rejects.toMatchObject({
			code: "driver-missing-capability",
		});
		expect(resolver).not.toHaveBeenCalled();
		expect(rendering).not.toHaveBeenCalled();
		expect(sent).toEqual([]);
	});
});

describe("P10: surprise probes", () => {
	it("an empty contributed rendering applies a context with zero statements", async () => {
		const { driver, sent } = makeRecordingDriver({
			renderContext: () => [],
		});
		const handle = db(appSchema, driver);
		await handle.as({ role: roleName("app_reader") }).execute(select(posts));
		// transaction opens, caller statement runs, no context statement at all
		expect(sqlsOf(sent)[0]).toBe("<begin>");
		expect(sent.length).toBe(3);
	});
	it("contextRequired + roleLessPlatform is satisfied by an entirely empty context", async () => {
		const { driver, sent } = makeRecordingDriver({
			contextRequired: true,
			roleLessPlatform: true,
		});
		const handle = db(appSchema, driver);
		await handle.as({}).execute(select(posts));
		expect(sqlsOf(sent)).toEqual([
			"<begin>",
			expect.stringContaining("select"),
			"<commit>",
		]);
	});
	it("context-required error operation naming across surfaces", async () => {
		const { driver } = makeRecordingDriver({ contextRequired: true });
		const handle = db(appSchema, driver);
		const executeError = await handle.execute(select(posts)).catch((e) => e);
		const transactionError = await handle
			.transaction(async () => {})
			.catch((e) => e);
		expect(executeError.code).toBe("context-required");
		expect(transactionError.code).toBe("context-required");
		expect({
			execute: executeError.operation,
			transaction: transactionError.operation,
		}).toEqual({ execute: "db.context", transaction: "transaction" });
	});
});
```

### `packages/pg/d106-entry-probe.mjs` (public dist entry, plain node — green)

```js
// D106 scratch probe: the default rendering is importable from
// `@hejbro/query`'s PUBLIC entry (the built dist, via the package
// specifier a driver package uses) — no deep or internal module path.
import { defaultContextRendering } from "@hejbro/query";

const rendered = defaultContextRendering({
	role: "app_reader",
	settings: { "request.k": "v" },
});
console.log(JSON.stringify(rendered, null, 1));
console.log("typeof:", typeof defaultContextRendering);
```

Output:

```
[
 { "sql": "set local role \"app_reader\"", "params": [], "kind": "sql" },
 { "sql": "select set_config($1, $2, true)", "params": ["request.k", "v"], "kind": "sql" }
]
typeof: function
```

### `packages/neon/test/d106-probe.test.ts` (green)

```ts
/**
 * D106 scratch probe: the Neon one-shot (HTTP) path is unchanged by the
 * contribution point — db.as(context) fails with the missing-capability
 * error, nothing reaches the database, no rendering is applied, and the
 * driver itself declares none of the three new contract members.
 */
import { roleName, schema, select, table, uuid } from "@hejbro/core";
import { db } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
import type { HttpQueryable } from "../src/http";
import { neonDriver } from "../src/driver";

const app = schema("app");
const posts = table(app, "posts", { id: uuid().primaryKey() });

describe("D106: Neon HTTP one-shot driver under db.as(context)", () => {
	it("fails with driver-missing-capability, nothing sent, no rendering members declared", async () => {
		const queryCalls = vi.fn();
		const transactionCalls = vi.fn();
		const fakeSql = Object.assign(
			(() => {
				throw new Error("template-tag path must never be reached");
			}) as unknown as HttpQueryable,
			{
				query: (...args: ReadonlyArray<unknown>) => {
					queryCalls(args);
					return { queryData: args };
				},
				transaction: async (...args: ReadonlyArray<unknown>) => {
					transactionCalls(args);
					return [[]];
				},
			},
		);
		const driver = neonDriver(fakeSql);

		expect(driver.renderContext).toBeUndefined();
		expect(driver.roleLessPlatform).toBeUndefined();
		expect(driver.contextRequired).toBeUndefined();
		expect(driver.capabilities).toEqual({
			"interactive-transactions": false,
			"session-state": false,
		});

		// role whitelisted via the handle's own opt-in list, so the failure
		// is attributable to the capability alone
		const handle = db({ posts }, driver, {
			roles: [roleName("authenticated")],
		});
		await expect(
			handle.as({ role: roleName("authenticated") }).execute(select(posts)),
		).rejects.toMatchObject({
			code: "driver-missing-capability",
			capability: "interactive-transactions",
		});
		expect(queryCalls).not.toHaveBeenCalled();
		expect(transactionCalls).not.toHaveBeenCalled();
	});
});
```

---

## Closing note

The shipped implementation is in good shape: every behavioral guarantee I
could execute holds, fail-closed everywhere the deltas demand it, and the
three shipped drivers are provably untouched. All three non-MINOR
findings are defects in the **spec text**, not the code — F1 and F2 are
scenario prose asserting universals the same delta's requirement text
already (and correctly) denies, and F3 is a guarantee whose enforcement
moved out from under its unchanged wording. The block is against
archiving these sentences into the main corpus as written; requalifying
them costs a few lines and no implementation change.
