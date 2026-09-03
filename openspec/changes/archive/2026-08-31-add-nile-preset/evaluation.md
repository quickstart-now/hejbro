# D106 adversarial spec-only evaluation — `add-nile-preset`

**VERDICT: PASS — 0 BLOCKING, 3 MAJOR, 8 MINOR (11 findings).**

Subject: dev `72a99e93`, exported to a git-less whitelist-filtered tree with all seven
packages built. Evidence base: the three delta specs under
`openspec/changes/add-nile-preset/specs/`, the main corpus under `openspec/specs/`,
the public surface (`skills/hejbro/**`, `packages/*/src/index.ts` → public
signatures, `.changeset/add-nile-preset.md`, `README.md`,
`.claude/rules/provider-preset.md`, `scripts/pack-install-smoke.sh`), plus executed
runtime/type probes against the public API (sources in Appendix A) and a CLI-level
probe through the built `hejbro` binary (Appendix B). No `proposal.md`/`tasks.md`/
`design.md`/`blackbox/` content was available or used. The Docker-gated integration
suite was **not** run; it is judged from wiring and text only.

Every delta scenario I could drive was driven; none contradicts shipped behavior
(the full scenario-by-scenario table is in §"Verified, holds"). The findings below
are corpus/public-surface gaps and user surprises, not delta-vs-shipped
contradictions.

---

## Findings

### F1 — MAJOR — The query-layer skill still lists the Nile preset as "Not supported in this version"

- **Citation.** `skills/hejbro/references/query-layer.md` lines 1020–1026:
  > `## Not supported in this version` … `- \`@hejbro/nile\` preset (#301) — \`@hejbro/pg\` (vanilla), \`@hejbro/supabase\`, and \`@hejbro/neon\` exist today.`

  versus `skills/hejbro/SKILL.md` line 35 (`references/nile-preset.md | Using
  \`@hejbro/nile\` — \`nileDriver\`, \`asTenant\`, …`), `README.md` line 135
  (`@hejbro/nile | Nile provider preset …`), and the changeset ("the seventh
  published package").
- **Observed.** The package ships (dist exports `asTenant`, `nileDriver`,
  `nilePreset` — Appendix A, probe P1 and the Node dist probe). The same skill that
  documents it in one file denies it in another.
- **Why MAJOR.** AGENTS.md makes `skills/hejbro` the user contract ("a stale skill is a
  broken user contract"). A reader of `query-layer.md` — the file SKILL.md sends them
  to for "running under an RLS execution context" — is told the preset does not exist.
- **Evidence kind.** Textual derivation.

### F2 — MAJOR — None of the seven Nile error codes is documented on the public surface

- **Citation.** Diagnostics corpus, `openspec/specs/diagnostics/spec.md` lines 11–18:
  > "The code is the machine-readable identity … a consumer branching on a failure SHALL be able to branch on the code alone."

  `skills/hejbro/references/query-layer.md` "## Errors" table (lines 1040–1055) lists
  every query-layer code including the Supabase preset's `claims-subject-missing`.
  `skills/hejbro/references/nile-preset.md` "What this preset refuses" table (lines
  72–79) has columns *Declaration / Refused because / Evidence* and no code column.
- **Observed.** Shipped codes (executed, Appendix A P3/P7 and Appendix B):
  `nile-context-value-invalid` (with `field: "tenant" | "user"`),
  `nile-rls-unsupported`, `nile-function-unsupported`, `nile-trigger-unsupported`,
  `nile-grant-unsupported`, `nile-serial-in-tenant-table`,
  `nile-tenant-primary-key-missing`.
  `grep -rn` for any of the seven over `skills/`, `README.md`, `.changeset/`,
  `packages/skills/` returns **zero** hits.
- **Why MAJOR.** The delta itself promises "an explicit coded error"
  (rls-execution-context delta line 105) and the corpus makes the code the contract
  identity, yet a user relying on docs alone cannot learn a single code to branch on
  — while the neighbouring preset's code is documented in the same table.
- **Evidence kind.** Executed probe (codes) + textual derivation (absence).

### F3 — MAJOR — The Nile rendering is a projection, not a mapping: a validated named role and any non-Nile setting are silently discarded

- **Citation.** Delta `rls-execution-context/spec.md` lines 59–63:
  > "The first declaration is what admits a role-less context; it SHALL NOT be read as an exemption for a context that does name a role, which stays subject to the same declared-role whitelist."

  Skill `nile-preset.md` lines 53–56: "a context that *does* name a role is still
  validated exactly as on any other driver." Corpus `rls-execution-context` lines
  97–103 (scenario "A role-less context is admitted where the platform has none"):
  "the context's settings are applied through the rendering in effect for that
  driver". Corpus lines 70–76: a role must never be "silently applied as 'whatever
  role the connection already holds'".
- **Observed (executed, Appendix A P4).**
  1. `db({widgets}, nileDriver(base), { roles: [roleName("app_admin")] })
     .as({ role: roleName("app_admin"), settings: { "nile.tenant_id": T } }).select(widgets)`
     → whitelist passes, **no `SET LOCAL ROLE` is sent, no error**; the transcript
     is exactly `[set local nile.tenant_id = '…', select …]`. The execution runs under
     whatever role the connection already holds.
  2. `nileDriver(base)` passes the base's `contributedRoles` through untouched
     (delta requires pass-through), so `nileDriver(supabaseDriver(pg))` whitelists
     `anon`/`authenticated`/`service_role` on a platform that "has no roles"; a
     context naming `anon` is admitted and the role is dropped the same way.
  3. `db.as({ settings: { "nile.tenant_id": T, "app.flag": "1", "request.jwt.claims": "{}" } })`
     → only the tenant statement is rendered; the two other settings produce **no
     statement and no error**.
- **Why MAJOR.** Neither the delta nor the skill states what happens to a role or a
  setting that passes validation but is not one of the two Nile keys. The generic
  docs (`query-layer.md` lines 600–618) describe `settings` as applied "one per
  entry", and the skill's "validated exactly as on any other driver" reads as parity.
  The result is the exact fail-open shape the corpus forbids for the role-less case,
  reached through a named role instead. Whether a named role on a role-less platform
  should be *refused* (fail closed) or *applied* is an owner call — the finding is that
  today it is neither, silently, and unspecified.
- **Evidence kind.** Executed probe.

### F4 — MINOR — The "CLI's catalog read" rationale is attached to a command that never sees this driver

- **Citation.** Delta `rls-execution-context/spec.md` lines 68–74 and scenario lines
  93–98: "WHEN the schema check reads the catalog against a database served by this
  driver THEN the read is issued and returns, because it goes through the driver
  session directly rather than through a `db()` execution surface". Skill
  `nile-preset.md` lines 61–64: "This does **not** block `hejbro check`'s schema
  read: that read goes through the driver session directly
  (`packages/cli/src/check/catalog.ts`), never through a `db()` execution surface".
- **Observed.** `hejbro check` always constructs its own undecorated `@hejbro/pg`
  driver from `--url`/`DATABASE_URL` (`packages/cli/src/check/driver.ts` lines 31,
  88–96: `CHECK_DRIVER_PACKAGE = "@hejbro/pg"`, `pgDriver(connectionString)`). A
  user's `nileDriver` never reaches that command, so `contextRequired` is never in
  play there regardless of any `db()` bypass — the scenario's WHEN ("a database
  served by this driver") does not occur for `hejbro check`. The surface the reasoning
  actually fits is `assertSchema(handle)` reading through `handle.driver`
  (`packages/cli/src/assert-schema.ts` line 367), which the corpus and
  `query-layer.md` line 1054 already cover; executed probe P5 confirms
  `handle.driver.execute` reaches the base on a `contextRequired` driver.
- **Why MINOR.** The stated outcome is true; the causal attribution is misdirected,
  and the skill points a published-package user at a repo-internal path.
- **Evidence kind.** Textual derivation + executed probe.

### F5 — MINOR — "Before any statement is sent" is only true of the query layer's own statements; `asTenant` validates nothing at construction

- **Citation.** Delta `rls-execution-context/spec.md` lines 103–105: "The rendering
  SHALL therefore refuse a value that is not a canonical UUID **before any statement
  is sent**". Changeset: "both values are refused before any statement is sent".
  The scenario (lines 109–115) is more careful: "the query layer has already opened
  the wrapping transaction when the rendering runs, and that transaction carries
  none".
- **Observed.** Probe P3: on an adversarial tenant value, `base.transaction` is
  called exactly once (BEGIN happened), the in-transaction transcript is `[]`, and
  `direct` is `[]`. With the shipped `pgDriver` base the sequence is: pool checkout →
  `set intervalstyle…; set bytea_output…` on a fresh connection → `BEGIN` → rendering
  throws → `ROLLBACK` (`packages/pg/src/driver.ts` lines 217–229). Also
  `asTenant("garbage")` does not throw (P3) — the error surfaces at first execution.
- **Why MINOR.** The scenario is accurate and is what ships; the requirement sentence
  and the changeset overstate. A user is still surprised that a bad tenant value
  costs a connection checkout and a BEGIN/ROLLBACK round trip instead of failing at
  `asTenant()`.
- **Evidence kind.** Executed probe + textual derivation from the pg driver source.

### F6 — MINOR — The changeset says the decorator takes "any" driver; the delta restricts it

- **Citation.** `.changeset/add-nile-preset.md` line 6: "`nileDriver(driver)`
  decorates any `@hejbro/query` driver". Delta `driver-contract/spec.md` lines
  51–57: "The preset SHALL therefore support base drivers that pin their session at
  connection checkout … and its documentation SHALL state the unsupported shape".
- **Observed.** Probe P6 ("pooler-shaped base"): over a base that pins inside its own
  transaction, the tenant setting is the third statement in the transaction, not the
  first — the shape the skill documents as unsupported.
- **Evidence kind.** Textual derivation + executed probe.

### F7 — MINOR — The unsupported-shape rationale rests on a platform claim with no evidence grade

- **Citation.** Delta `driver-contract/spec.md` lines 52–54: session statements
  "ahead of the tenant setting, which this platform refuses". Delta
  `rls-execution-context/spec.md` lines 27–30: "the tenant setting is still the first
  statement the query layer sends, and the platform refuses it". Skill
  `nile-preset.md` lines 133–134: "the platform refuses a tenant-scoped statement that
  wasn't first".
- **Observed.** The quoted published limitations table (skill lines 101–105) does not
  state this; the live witness (`packages/nile/test/integration/nile.integration.test.ts`)
  never sends a statement ahead of `SET LOCAL nile.tenant_id` inside a transaction,
  and the container's measured facts listed in the skill (lines 150–169) do not
  include it. The change applies measured-vs-documented grading to every validator
  refusal (preset-validation delta lines 40–58) but not to this behavioral claim in
  the same user document.
- **Why MINOR.** Unverifiable here (Docker suite off-limits); practical impact is low
  since the only shipped in-transaction-pin base is Supabase's pooler. It is still a
  factual platform claim in the user contract with no stated basis.
- **Evidence kind.** Textual derivation.

### F8 — MINOR — A trigger declaration produces a second diagnostic whose `Next:` names a declaration the user never wrote

- **Citation.** Delta `preset-validation/spec.md` lines 89–91: "WHEN a schema
  declares a function or a trigger THEN generation fails naming that declaration".
  Corpus diagnostics: the `Next:` line names "what the user can do about it".
- **Observed (Appendix A, P7 "ALL-REFUSALS").** One `defineTrigger(t, {name:
  "guard", …})` yields both
  `nile-trigger-unsupported` ("guard" on "app"."posts") **and**
  `nile-function-unsupported` for the synthesized `"app"."guard_fn"` with
  `Next: remove the defineFunction() declaration` — there is no `defineFunction()`
  to remove. (Cause: `resolveDeclarations` fans a trigger into
  `[functionDeclaration, trigger]`, and the function validator does not exclude
  trigger-owned functions.)
- **Evidence kind.** Executed probe.

### F9 — MINOR — Identity columns in tenant-aware tables are expressible, sequence-backed, unmeasured, and unmentioned

- **Citation.** Delta `preset-validation/spec.md` lines 71–74 (serial family
  refused because it is "adjacent" to the platform's documented `CREATE SEQUENCE`
  restriction) and lines 79–82 ("Where the platform rejects something the DSL has no
  way to declare, the fact belongs in the preset's documentation"). Skill lines
  83–86 record the no-primary-key shape as "unmeasured".
- **Observed (P7 "IDENTITY-SQL").** `integer().generatedAlwaysAsIdentity()` on a
  table with `tenant_id uuid` generates
  `"id" integer not null generated always as identity` with **no** diagnostic. An
  identity column creates an implicit sequence exactly as `serial` does; hejbro can
  express it (`.generatedAlwaysAsIdentity()`/`.generatedByDefaultAsIdentity()`,
  `packages/core/src/types/column-builder.ts` lines 52–57); neither the refusal list
  nor the "unmeasured" note mentions it.
- **Why MINOR.** Not a delta contradiction (the delta enumerates exactly what is
  refused); a Q4 surprise for a user who reads the serial refusal and reasonably
  reaches for identity as the fix.
- **Evidence kind.** Executed probe.

### F10 — MINOR — The primary-key refusal names the table but not "its key"

- **Citation.** Delta `preset-validation/spec.md` lines 110–115: "generation fails
  naming that table and its key".
- **Observed (P7 "PK-MSG").** `Nile's platform refuses a primary key on the
  tenant-aware table "app"."widgets" that excludes "tenant_id" -- … Next: include
  tenant_id in the primary key.` The key is identified only by kind; its constraint
  name (`widgets_pkey`) and its column set are not named. Arguably "a primary key …
  that excludes tenant_id" is a description of the key; it is not a name.
- **Evidence kind.** Executed probe.

### F11 — MINOR — The "confirmed against a live database" half is discharged only by a suite that never runs in CI, and one witness's premise is assumed

- **Citation.** Delta `rls-execution-context/spec.md` lines 131–133 and 140–145:
  "verified in the preset's own package on both sides: the statement form, and the
  server's own behavior … confirmed against a live database rather than inferred".
- **Observed (wiring/text only).** `packages/nile/vitest.config.ts` excludes
  `test/**/*integration.test.ts`; only `test:integration` (local, Docker) includes it.
  Witness B (integration test lines 251–274) asserts
  `current_setting('nile.tenant_id', true)` is falsy on the *next* `execute()` and
  relies on a comment ("the very next `execute()` reuses the same backend") rather
  than asserting backend identity (e.g. `pg_backend_pid()`), so on a different
  pooled backend it passes vacuously.
- **Evidence kind.** Textual derivation (not executed, by instruction).

---

## Verified, holds (delta scenario → shipped behavior)

All executed against the public API (`@hejbro/nile` barrel via `../src/index`,
`@hejbro/query`'s `db`, `@hejbro/core`'s `generateMigration`) unless marked.

| Delta scenario | Result | Evidence |
|---|---|---|
| rls: tenant setting first, ahead of caller's own | `[set local nile.tenant_id = '…', select …]` | P2 |
| rls: on a checkout-pinning base, first inside the transaction | transcript[0] is the tenant setting; pg/neon pin before `BEGIN` (`pg/src/driver.ts` 217–222, `neon/src/driver.ts` 114–118) | P2 + source |
| rls: tenant before user | positions 0/1 pinned | P2 |
| rls: never `set_config`; every statement `set local` | asserted over all rendered statements | P2 |
| rls: builder names no role; settings identify tenant (+user) | `asTenant(T)` → `{settings:{"nile.tenant_id":T}}`, no `role` key | P2 |
| rls: role-less admitted, no role statement | proceeds, transcript length 2 | P2/P4 |
| rls: named undeclared role refused before any send | sync `undeclared-role`, `transaction` never called | P4 |
| rls: uncontexted refused with `context-required` on `execute`/chain/`transaction`/`fn` | all four refuse, base never called | P5 |
| rls: non-execution `driver` member reaches the base | `handle.driver.execute` hits base | P5 |
| rls: non-UUID never becomes a statement; coded error; transaction carries none | `nile-context-value-invalid`, `field:"tenant"`/`"user"`, transcript `[[]]` | P3 |
| rls: adversarial value never appears raw | message excludes the value; no statement produced | P3 |
| rls: valid value quoted | `set local nile.tenant_id = '<uuid>'`; braces/URN forms refused; uppercase accepted | P3 |
| rls: hand-built `db.as({})`, `db.as({settings:{}})`, `asTenant("")` | all refused by the same gate (fail closed) | P3 |
| driver: `transaction`/`capabilities`/`setupSession`/`execute` forwarded by reference | `toBe` identity | P6 |
| driver: base with interactive-transactions `false` refused; rendering never invoked | `driver-missing-capability`, `transaction` never called | P6 |
| driver: no Nile client dependency (runtime/peer/optional) | `packages/nile/package.json`: deps `@hejbro/core`, `@hejbro/query`; devDeps incl. `@hejbro/pg` (permitted by `.claude/rules/provider-preset.md` lines 31–35) | textual |
| driver: `nileDriver`, `asTenant`, preset importable from the entry | source barrel keys `["asTenant","nileDriver","nilePreset"]`; dist via Node self-reference resolves the same three; smoke script assertion 5 imports both from the installed tarball and registers the preset | P1, dist probe, `pack-install-smoke.sh` 313–371 |
| driver: unsupported shape documented | `nile-preset.md` 121–140; pinned by `packages/skills/test/nile-preset-doc.test.ts` (6/6 pass) | textual + executed |
| validation: refused declaration fails, no SQL written | core: `sql === ""`, `hasChanges === false`; CLI: exit 1, `migrations/` empty, snapshot unchanged | P7, Appendix B |
| validation: accepted declaration identical to no preset | `a.sql === b.sql`; CLI generates + verifies a composite-PK tenant table | P7, Appendix B |
| validation: RLS/policy, function, trigger → platform-documented; grant, serial, PK → measured-only; every message has `Next:` | asserted per code, each message carries exactly one grade clause | P7 |
| validation: grant-set unexpanded (the CLI's own input shape) still refused | `["nile-grant-unsupported"]` | P7 |
| validation: serial ×3 in tenant table refused per column; outside untouched; no-PK tenant table untouched | as specified | P7 |
| validation: preset shape | `name:"nile"`, `kinds:[]`, 5 validators; `presetValidators([nilePreset]).length === 5` | P7 |
| Package's own gates | shipped nile tests 48/48; `tsc --noEmit` clean; skills `nile-preset-doc` 6/6 | executed |

Non-findings worth recording:
- `packages/skills/test/links.test.ts` fails in this export only because `docs/**`
  and `openspec/changes/archive/**` are absent from the whitelist; every path
  `nile-preset.md` cites resolves. Instrument, not evidence.
- My first probe called `h.fn.hello()` with no argument object and got a `TypeError`;
  that is a type error (`Expected 1 arguments`) in the fn surface for every driver,
  not a Nile behavior. `h.fn.hello({})` → `context-required` as specified.
- Corpus consistency checked and holding: the delta ADDs only; "Presets define the
  context type" (Supabase/vanilla), "Presets ship their own driver", "A driver may
  contribute how a context becomes statements" (first-among-its-own, pure mapping,
  value-safety and transaction-locality obligations), and the two new declarations
  are all consistent with the Nile requirements. The value-safety obligation is
  discharged by the UUID gate plus `quoteStringLiteral`; the transaction-locality
  obligation by the `SET LOCAL` form (server half: F11).

---

## Appendix A — vitest probe sources (created in `packages/nile/test/`, deleted after the run)

Run: `pnpm exec vitest run test/d106-probe.test.ts test/d106-probe2.test.ts` →
`Test Files 2 passed (2) / Tests 27 passed (27)`; `pnpm exec tsc --noEmit` clean.

### `test/d106-probe.test.ts`

```ts
/* D106 evaluator scratch probe -- NOT part of the package. Deleted after the run. */
import { appendFileSync } from "node:fs";
import type { Preset } from "@hejbro/core";
import {
	bigserial, defineFunction, defineTrigger, emptySnapshot, eq, generateMigration, grant,
	integer, presetValidators, rls, roleName, schema, select, serial, smallserial, table, uuid,
} from "@hejbro/core";
import type { ContextRendering, DbContext, Driver, DriverRow, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import * as barrel from "../src/index";

const { asTenant, nileDriver, nilePreset } = barrel;

type Sent = { readonly sql: string; readonly params: ReadonlyArray<unknown> };

type BaseOptions = {
	readonly interactiveTransactions?: boolean;
	readonly inTransactionPins?: ReadonlyArray<Sent>;
	readonly contributedRoles?: ReadonlyArray<string>;
	readonly renderContext?: ContextRendering;
};

const recordingBase = (options: BaseOptions = {}) => {
	const perTransaction: Array<Array<Sent>> = [];
	const direct: Array<Sent> = [];
	const driver: Driver = {
		capabilities: { "interactive-transactions": options.interactiveTransactions ?? true, "session-state": true },
		execute: vi.fn(async (c) => { direct.push({ sql: c.sql, params: c.params }); return [] as ReadonlyArray<DriverRow>; }),
		transaction: vi.fn(async (callback) => {
			const sent: Array<Sent> = [];
			perTransaction.push(sent);
			const session: DriverSession = { execute: vi.fn(async (c) => { sent.push({ sql: c.sql, params: c.params }); return []; }) };
			for (const pin of options.inTransactionPins ?? []) { sent.push(pin); }
			return callback(session);
		}),
		setupSession: vi.fn(async () => {}),
		...(options.contributedRoles ? { contributedRoles: options.contributedRoles } : {}),
		...(options.renderContext ? { renderContext: options.renderContext } : {}),
	};
	return { driver, perTransaction, direct };
};

const app = schema("app");
const widgets = table(app, "widgets", { id: uuid().primaryKey(), tenantId: uuid().primaryKey() });
const T = "11111111-1111-1111-1111-111111111111";
const U = "22222222-2222-2222-2222-222222222222";

describe("P1 exports + types", () => {
	it("barrel names", () => {
		expect(Object.keys(barrel).sort()).toEqual(["asTenant", "nileDriver", "nilePreset"]);
	});
	it("types", () => {
		expectTypeOf(asTenant).toEqualTypeOf<(tenantId: string, userId?: string) => DbContext>();
		expectTypeOf(nileDriver).toEqualTypeOf<(driver: Driver) => Driver>();
		expectTypeOf(nilePreset).toEqualTypeOf<Preset>();
		type Wide = Driver & { readonly client: { end(): Promise<void> } };
		expectTypeOf<ReturnType<typeof nileDriver>>().not.toEqualTypeOf<Wide>();
	});
});

describe("P2 rendering through db().as", () => {
	it("tenant only: first statement is SET LOCAL tenant; no set_config; exactly one context stmt before the select", async () => {
		const { driver, perTransaction } = recordingBase();
		const h = db({ widgets }, nileDriver(driver));
		await h.as(asTenant(T)).select(widgets);
		expect(perTransaction).toHaveLength(1);
		const sent = perTransaction[0]!;
		expect(sent[0]).toEqual({ sql: `set local nile.tenant_id = '${T}'`, params: [] });
		expect(sent).toHaveLength(2);
		expect(sent.every((s) => !s.sql.includes("set_config"))).toBe(true);
		expect(sent[1]!.sql.toLowerCase().startsWith("select")).toBe(true);
	});
	it("tenant+user: tenant first, user second, both set local", async () => {
		const { driver, perTransaction } = recordingBase();
		const h = db({ widgets }, nileDriver(driver));
		await h.as(asTenant(T, U)).select(widgets);
		expect(perTransaction[0]!.slice(0, 2)).toEqual([
			{ sql: `set local nile.tenant_id = '${T}'`, params: [] },
			{ sql: `set local nile.user_id = '${U}'`, params: [] },
		]);
	});
	it("asTenant names no role and has exactly the tenant/user keys", () => {
		expect(asTenant(T)).toEqual({ settings: { "nile.tenant_id": T } });
		expect("role" in asTenant(T)).toBe(false);
		expect(asTenant(T, U)).toEqual({ settings: { "nile.tenant_id": T, "nile.user_id": U } });
	});
	it("provider handle: chain member applies the tenant first", async () => {
		const { driver, perTransaction } = recordingBase();
		const h = db({ widgets }, nileDriver(driver), { context: () => asTenant(T) });
		await h.select(widgets);
		expect(perTransaction[0]![0]).toEqual({ sql: `set local nile.tenant_id = '${T}'`, params: [] });
	});
});

describe("P3 UUID gate", () => {
	it("adversarial tenant: coded error, field tenant, transaction opened but carries nothing, no direct execute", async () => {
		const { driver, perTransaction, direct } = recordingBase();
		const h = db({ widgets }, nileDriver(driver));
		let caught: unknown;
		try { await h.as(asTenant("'; drop table widgets; --")).select(widgets); } catch (e) { caught = e; }
		expect(caught).toMatchObject({ code: "nile-context-value-invalid", field: "tenant" });
		expect(String((caught as Error).message)).not.toContain("drop table");
		expect((caught as Error).message).toContain("Next:");
		expect(driver.transaction).toHaveBeenCalledTimes(1); // BEGIN did happen at the base
		expect(perTransaction).toEqual([[]]);
		expect(direct).toEqual([]);
	});
	it("bad user value: field user, tenant statement NOT sent either (whole rendering aborts)", async () => {
		const { driver, perTransaction } = recordingBase();
		const h = db({ widgets }, nileDriver(driver));
		await expect(h.as(asTenant(T, "not-a-uuid")).select(widgets)).rejects.toMatchObject({ code: "nile-context-value-invalid", field: "user" });
		expect(perTransaction).toEqual([[]]);
	});
	it("hand-built contexts: db.as({}) and db.as({settings:{}}) are refused by the same gate (fail closed)", async () => {
		const { driver } = recordingBase();
		const h = db({ widgets }, nileDriver(driver));
		await expect(h.as({}).select(widgets)).rejects.toMatchObject({ code: "nile-context-value-invalid", field: "tenant" });
		await expect(h.as({ settings: {} }).select(widgets)).rejects.toMatchObject({ code: "nile-context-value-invalid", field: "tenant" });
		await expect(h.as(asTenant("")).select(widgets)).rejects.toMatchObject({ code: "nile-context-value-invalid", field: "tenant" });
		await expect(h.as(asTenant(T, "")).select(widgets)).rejects.toMatchObject({ code: "nile-context-value-invalid", field: "user" });
	});
	it("uppercase / braces / urn forms", async () => {
		const { driver, perTransaction } = recordingBase();
		const h = db({ widgets }, nileDriver(driver));
		await h.as(asTenant(T.toUpperCase())).select(widgets);
		expect(perTransaction[0]![0]!.sql).toBe(`set local nile.tenant_id = '${T.toUpperCase()}'`);
		await expect(h.as(asTenant(`{${T}}`)).select(widgets)).rejects.toMatchObject({ code: "nile-context-value-invalid" });
		await expect(h.as(asTenant(`urn:uuid:${T}`)).select(widgets)).rejects.toMatchObject({ code: "nile-context-value-invalid" });
	});
	it("asTenant itself never validates -- the error surfaces only at execution", () => {
		expect(() => asTenant("garbage")).not.toThrow();
	});
});

describe("P4 hand-built context: extra settings and a named role", () => {
	it("extra settings keys are silently dropped -- no statement, no error", async () => {
		const { driver, perTransaction } = recordingBase();
		const h = db({ widgets }, nileDriver(driver));
		await h.as({ settings: { "nile.tenant_id": T, "app.flag": "1", "request.jwt.claims": "{}" } }).select(widgets);
		const sent = perTransaction[0]!;
		expect(sent).toHaveLength(2);
		expect(sent.map((s) => s.sql).join("\n")).not.toContain("app.flag");
		expect(sent.map((s) => s.sql).join("\n")).not.toContain("request.jwt.claims");
	});
	it("a whitelisted named role is validated OK and then silently NOT applied (no SET LOCAL ROLE, no error)", async () => {
		const { driver, perTransaction } = recordingBase();
		const h = db({ widgets }, nileDriver(driver), { roles: [roleName("app_admin")] });
		await h.as({ role: roleName("app_admin"), settings: { "nile.tenant_id": T } }).select(widgets);
		const sent = perTransaction[0]!;
		expect(sent.map((s) => s.sql).join("\n").toLowerCase()).not.toContain("role");
		expect(sent).toHaveLength(2);
	});
	it("a base's contributedRoles pass through nileDriver -- e.g. supabase's anon becomes whitelisted on a role-less platform", async () => {
		const { driver, perTransaction } = recordingBase({ contributedRoles: ["anon", "authenticated", "service_role"] });
		const wrapped = nileDriver(driver);
		expect(wrapped.contributedRoles).toEqual(["anon", "authenticated", "service_role"]);
		const h = db({ widgets }, wrapped);
		await h.as({ role: roleName("anon"), settings: { "nile.tenant_id": T } }).select(widgets);
		expect(perTransaction[0]!.map((s) => s.sql).join("\n").toLowerCase()).not.toContain("role");
	});
	it("undeclared named role is refused synchronously, before any I/O", () => {
		const { driver } = recordingBase();
		const h = db({ widgets }, nileDriver(driver));
		expect(() => h.as({ role: roleName("nope"), settings: { "nile.tenant_id": T } })).toThrow(expect.objectContaining({ code: "undeclared-role" }));
		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

describe("P5 contextRequired across every execution surface + driver member bypass", () => {
	it("execute / select chain / transaction / fn all refuse; base untouched; handle.driver bypasses", async () => {
		const { driver, direct } = recordingBase();
		const fnDecl = defineFunction(app, "hello", { returns: widgets }, (ctx) => { ctx.return(select(widgets)); });
		const h = db({ widgets, hello: fnDecl }, nileDriver(driver));
		await expect(h.execute(select(widgets))).rejects.toMatchObject({ code: "context-required" });
		await expect(h.select(widgets)).rejects.toMatchObject({ code: "context-required" });
		await expect(h.transaction(async () => 1)).rejects.toMatchObject({ code: "context-required" });
		await expect(h.fn.hello({})).rejects.toMatchObject({ code: "context-required" });
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
		await h.driver.execute({ sql: "select 1", params: [], kind: "sql" });
		expect(direct).toEqual([{ sql: "select 1", params: [] }]);
	});
});

describe("P6 pass-through and capability gate", () => {
	it("transaction/capabilities/setupSession/execute by reference; base renderContext replaced", () => {
		const baseRendering: ContextRendering = () => [];
		const { driver } = recordingBase({ renderContext: baseRendering });
		const w = nileDriver(driver);
		expect(w.transaction).toBe(driver.transaction);
		expect(w.capabilities).toBe(driver.capabilities);
		expect(w.setupSession).toBe(driver.setupSession);
		expect(w.execute).toBe(driver.execute);
		expect(w.renderContext).not.toBe(baseRendering);
		expect(w.roleLessPlatform).toBe(true);
		expect(w.contextRequired).toBe(true);
	});
	it("base with interactive-transactions false -> driver-missing-capability, rendering never reached", async () => {
		const { driver } = recordingBase({ interactiveTransactions: false });
		const h = db({ widgets }, nileDriver(driver));
		await expect(h.as(asTenant(T)).select(widgets)).rejects.toMatchObject({ code: "driver-missing-capability" });
		expect(driver.transaction).not.toHaveBeenCalled();
	});
	it("pooler-shaped base (pins inside its own transaction): tenant is first the query layer sends, NOT first in the transaction", async () => {
		const pins: ReadonlyArray<Sent> = [
			{ sql: "set local intervalstyle to 'postgres'", params: [] },
			{ sql: "set local bytea_output to 'hex'", params: [] },
		];
		const { driver, perTransaction } = recordingBase({ inTransactionPins: pins });
		const h = db({ widgets }, nileDriver(driver));
		await h.as(asTenant(T)).select(widgets);
		const sent = perTransaction[0]!;
		expect(sent.slice(0, 2)).toEqual(pins);
		expect(sent[2]).toEqual({ sql: `set local nile.tenant_id = '${T}'`, params: [] });
	});
});

describe("P7 validators via generateMigration (the CLI's own call shape: grant-set unexpanded)", () => {
	const run = (declarations: ReadonlyArray<Parameters<typeof generateMigration>[0]["declarations"][number]>) =>
		generateMigration({ declarations, previousSnapshot: emptySnapshot, validators: nilePreset.validators });
	it("preset shape", () => {
		expect(nilePreset.name).toBe("nile");
		expect(nilePreset.kinds).toEqual([]);
		expect(presetValidators([nilePreset])).toHaveLength(5);
	});
	it("grant-set passed unexpanded is still refused, measured-only", () => {
		const r = run([app, grant(app).usage.to(roleName("reader"))]);
		expect(r.sql).toBe("");
		expect(r.errors.map((e) => e.code)).toEqual(["nile-grant-unsupported"]);
		expect(r.errors[0]!.message).toContain("this refusal rests on a measurement, not on the platform's published limitations");
		expect(r.errors[0]!.message).toContain("Next:");
	});
	it("all refusals + evidence grades in one schema", () => {
		const t = table(app, "posts", { id: bigserial().primaryKey(), tenantId: uuid().notNull() }, (c) => ({
			rls: rls.enabled({ read: rls.policy("posts_read").for("select").to("reader").using(eq(c.id, c.id)) }),
		}));
		const f = defineFunction(app, "hello", { returns: t }, (ctx) => { ctx.return(select(t)); });
		const trg = defineTrigger(t, { name: "guard", timing: "before", events: ["insert"], forEach: "row" }, (ctx, { new: row }) => { ctx.return(row); });
		const r = run([app, t, f, trg, grant(app).usage.to(roleName("reader"))]);
		expect(r.sql).toBe("");
		expect(r.hasChanges).toBe(false);
		const byCode = new Map<string, string[]>();
		for (const e of r.errors) { byCode.set(e.code, [...(byCode.get(e.code) ?? []), e.message]); }
		const documented = "this is documented in the platform's published limitations";
		const measured = "this refusal rests on a measurement, not on the platform's published limitations";
		for (const code of ["nile-rls-unsupported", "nile-function-unsupported", "nile-trigger-unsupported"]) {
			expect(byCode.get(code)!.every((m) => m.includes(documented) && !m.includes(measured))).toBe(true);
		}
		for (const code of ["nile-grant-unsupported", "nile-serial-in-tenant-table", "nile-tenant-primary-key-missing"]) {
			expect(byCode.get(code)!.every((m) => m.includes(measured) && !m.includes(documented))).toBe(true);
		}
		for (const e of r.errors) { expect(e.message).toContain("Next:"); }
		appendFileSync("test/.d106-out.txt", "ALL-REFUSALS " + JSON.stringify(r.errors.map((e) => [e.code, e.message]), null, 1));
	});
	it("PK refusal message content", () => {
		const t = table(app, "widgets", { id: uuid().primaryKey(), tenantId: uuid().notNull() });
		const r = run([app, t]);
		appendFileSync("test/.d106-out.txt", "\nPK-MSG " + r.errors[0]!.message);
		expect(r.errors.map((e) => e.code)).toEqual(["nile-tenant-primary-key-missing"]);
	});
	it("identity column in a tenant-aware table is NOT refused (unmeasured gap); serial outside tenant table OK; no-PK tenant table OK", () => {
		const identityTable = table(app, "counters", { id: integer().generatedAlwaysAsIdentity().primaryKey(), tenantId: uuid().primaryKey() });
		const r1 = run([app, identityTable]);
		appendFileSync("test/.d106-out.txt", "\nIDENTITY-SQL " + r1.sql);
		expect(r1.errors).toEqual([]);
		const plain = table(app, "plain", { id: serial().primaryKey() });
		expect(run([app, plain]).errors).toEqual([]);
		const noPk = table(app, "nopk", { id: uuid(), tenantId: uuid().notNull() });
		expect(run([app, noPk]).errors).toEqual([]);
	});
	it("serial family x3, one diagnostic per column", () => {
		for (const col of [serial, smallserial, bigserial]) {
			const t = table(app, "w", { id: col().primaryKey(), other: col(), tenantId: uuid().primaryKey() });
			const r = run([app, t]);
			expect(r.errors.map((e) => e.code)).toEqual(["nile-serial-in-tenant-table", "nile-serial-in-tenant-table"]);
			expect(r.errors[0]!.message).toContain('"id"');
			expect(r.errors[1]!.message).toContain('"other"');
		}
	});
	it("accepted tenant-aware table: identical SQL with/without preset", () => {
		const a = run([app, widgets]);
		const b = generateMigration({ declarations: [app, widgets], previousSnapshot: emptySnapshot });
		expect(a.errors).toEqual([]);
		expect(a.sql).toBe(b.sql);
		expect(a.sql).toContain("create table");
	});
});
```

### `test/d106-probe2.test.ts`

```ts
/* D106 evaluator scratch probe 2 -- fn surface on plain vs nile driver. Deleted after the run. */
import { appendFileSync } from "node:fs";
import { defineFunction, schema, select, table, uuid } from "@hejbro/core";
import type { Driver, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
import { asTenant, nileDriver } from "../src/index";

const base = (): Driver => ({
	capabilities: { "interactive-transactions": true, "session-state": true },
	execute: vi.fn(async () => []),
	transaction: vi.fn(async (cb) => { const s: DriverSession = { execute: vi.fn(async () => []) }; return cb(s); }),
	setupSession: vi.fn(async () => {}),
});
const app = schema("app");
const widgets = table(app, "widgets", { id: uuid().primaryKey(), tenantId: uuid().primaryKey() });
const hello = defineFunction(app, "hello", { returns: widgets }, (ctx) => { ctx.return(select(widgets)); });
const T = "11111111-1111-1111-1111-111111111111";
const describeErr = (e: unknown): string => `${(e as Error).constructor.name}:${(e as Error & { code?: string }).code ?? (e as Error).message}`;

describe("fn surface", () => {
	it("nile driver: fn.hello({}) uncontexted refuses; scoped runs", async () => {
		const d = base();
		const h = db({ widgets, hello }, nileDriver(d));
		const r2 = await h.fn.hello({}).then(() => "ok", describeErr);
		const r3 = await h.as(asTenant(T)).fn.hello({}).then(() => "ok", describeErr);
		appendFileSync("test/.d106-out.txt", `\nNILE fn.hello({}) uncontexted: ${r2} | scoped: ${r3}`);
		expect(d.execute).not.toHaveBeenCalled();
		expect(r2).toBe("Error:context-required");
		expect(r3).toBe("ok");
	});
});
```

### Recorded probe output (`test/.d106-out.txt`)

```
NILE fn.hello({}) uncontexted: Error:context-required | scoped: ok
ALL-REFUSALS [
 ["nile-rls-unsupported", "Nile's platform does not support row-level security -- \"app\".\"posts\" declares it, and this is documented in the platform's published limitations. Next: remove the rls()/policy() declaration; ..."],
 ["nile-rls-unsupported", "Nile's platform does not support row-level security policies -- \"app\".\"posts\" declares one, and this is documented in the platform's published limitations. Next: remove the policy() declaration; ..."],
 ["nile-function-unsupported", "Nile's platform does not support SQL functions -- \"app\".\"hello\" is declared, and this is documented in the platform's published limitations. Next: remove the defineFunction() declaration; move this logic to application code."],
 ["nile-function-unsupported", "Nile's platform does not support SQL functions -- \"app\".\"guard_fn\" is declared, and this is documented in the platform's published limitations. Next: remove the defineFunction() declaration; move this logic to application code."],
 ["nile-trigger-unsupported", "Nile's platform does not support triggers -- \"guard\" on \"app\".\"posts\" is declared, and this is documented in the platform's published limitations. Next: remove the defineTrigger() declaration; ..."],
 ["nile-grant-unsupported", "Nile's platform refuses GRANT on schema \"app\" to \"reader\" -- this refusal rests on a measurement, not on the platform's published limitations. Next: remove the grant() declaration; ..."],
 ["nile-serial-in-tenant-table", "Nile's platform refuses a serial-family column (\"id\") in the tenant-aware table \"app\".\"posts\" -- this refusal rests on a measurement, not on the platform's published limitations (the platform's published table documents CREATE SEQUENCE as unsupported for tenant tables, an adjacent but not identical declaration). Next: use a uuid primary key instead, ..."],
 ["nile-tenant-primary-key-missing", "Nile's platform refuses a primary key on the tenant-aware table \"app\".\"posts\" that excludes \"tenant_id\" -- this refusal rests on a measurement, not on the platform's published limitations. Next: include tenant_id in the primary key."]
]
PK-MSG Nile's platform refuses a primary key on the tenant-aware table "app"."widgets" that excludes "tenant_id" -- this refusal rests on a measurement, not on the platform's published limitations. Next: include tenant_id in the primary key.
IDENTITY-SQL ... create table "app"."counters" (
	"id" integer not null generated always as identity,
	"tenant_id" uuid not null,
	constraint "counters_pkey" primary key ("id", "tenant_id")
);
```

### Node dist probe (exports map, via Node package self-reference from `packages/nile`)

```sh
node --input-type=module -e "
const m = await import('@hejbro/nile');
console.log('dist exports:', Object.keys(m).sort());
const base = { capabilities: {'interactive-transactions': true, 'session-state': true}, execute: async () => [], transaction: async (cb) => cb({ execute: async () => [] }), setupSession: async () => {} };
const d = m.nileDriver(base);
console.log('decl:', d.roleLessPlatform, d.contextRequired, typeof d.renderContext);
console.log('render:', JSON.stringify(d.renderContext(m.asTenant('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'))));
try { d.renderContext(m.asTenant('x')); } catch (e) { console.log('gate:', e.code, e.field); }
"
# dist exports: [ 'asTenant', 'nileDriver', 'nilePreset' ]
# decl: true true function
# render: [{"sql":"set local nile.tenant_id = '1111…1111'","params":[],"kind":"sql"},{"sql":"set local nile.user_id = '2222…2222'","params":[],"kind":"sql"}]
# gate: nile-context-value-invalid tenant
```

## Appendix B — CLI-level probe (built `hejbro` binary, nile preset registered)

Scratch project `packages/cli/.d106-probe/` with `node_modules/hejbro → packages/cli`
and `node_modules/@hejbro/nile → packages/nile` symlinks; `node ../dist/cli.js init`,
then:

```ts
// hejbro.config.ts
import { defineConfig } from "hejbro";
import { nilePreset } from "@hejbro/nile";
export default defineConfig({ entry: ["src/**/*.schema.ts"], migrationsDir: "migrations",
  snapshotPath: "hejbro.snapshot.json", prefixStrategy: "index", presets: [nilePreset] });
```

Refused schema (`serial` id + `tenant_id uuid` + schema grant) → `node ../dist/cli.js generate`:

```
error[nile-grant-unsupported]: app
  Nile's platform refuses GRANT on schema "app" to "reader" -- this refusal rests on a measurement, not on the platform's published limitations. Next: remove the grant() declaration; ...
  at src/app.schema.ts:11:51
error[nile-serial-in-tenant-table]: app.widgets
  ... Next: use a uuid primary key instead, or drop the tenant_id column if this table is not tenant-scoped.
  at src/app.schema.ts:5:53
error[nile-tenant-primary-key-missing]: app.widgets
  ... Next: include tenant_id in the primary key.
  at src/app.schema.ts:5:53
exit=1
migrations/: (empty)      hejbro.snapshot.json: { "objects": {} }  (unchanged)
```

Accepted schema (`id uuid pk defaultRandom`, `tenant_id uuid pk`, `name text`) →
`generate` exit 0, `wrote migrations/0001_add_app.sql` containing
`constraint "widgets_pkey" primary key ("id", "tenant_id")`; `verify` → `5 checks
passed`, exit 0.

## Appendix C — gates run in this export

- `packages/nile`: shipped tests 5 files / 48 tests pass; `tsc --noEmit` clean.
- `packages/skills`: `nile-preset-doc.test.ts` 6/6; `links.test.ts` fails only on
  `docs/**` and `openspec/changes/archive/**` paths absent from this export.
- Scratch artifacts (`packages/nile/test/d106-probe*.test.ts`,
  `packages/nile/test/.d106-out.txt`, `packages/cli/.d106-probe/`) were removed
  after the run; no tracked-content file was modified.
