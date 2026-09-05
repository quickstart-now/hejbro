# Decisions — quickstart-now/hejbro#458

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — hejbro.config.ts gains a driver factory that every connecting command prefers over the dynamic @hejbro/pg import

_lead · extension · basis 412/D24, 412/D25; D95 (any conforming driver executes); the 2026-08-29 add-check-schema ruling that parked this as its own design round; read on 2026-09-05: seven commands connect through check/driver.ts's withCheckConnection, and the loader's z.object strips an unknown driver key silently · 2026-09-05T04:55Z · ratified: pending_

Design (openspec/changes/add-config-driver/design.md Q1-Q5): a factory `(connectionString) => Driver | Promise<Driver>`, never an instance (an instance would open a pool for every command and need the secret at config-evaluation time); the factory receives the resolved --url/DATABASE_URL string only; the CLI closes what it is handed through `client.end()` and refuses, before any statement, a driver with no closing member (`<prefix>-driver-unclosable`, a fourth literal code per call site) rather than widening the driver contract for a CLI-only lifecycle; a throwing factory is the command's own connection-failed; without the field every command is byte-identical to today. Spec: cli-commands MODIFIED (check's driver paragraph) + ADDED (one requirement covering the seven commands). Ratification: owner on return.

<a id="r2"></a>
## R2 — raise, import and pull read the configuration leniently: an absent file means no factory; any other load failure refuses; pull's flag is --db-url

_lead · interpretation · basis 458/R1 (every connecting command prefers the factory); cd-planner's measurement (three commands never call loadConfig; import/pull bootstrap projects that have no declarations yet); design Q4 (a misspelled driver is never ignored silently) · 2026-09-05T06:50Z · ratified: pending_

(a): the three commands load hejbro.config.ts when it exists and treat config-not-found alone as "no factory configured" -- byte-identical to today for a project without a configuration; invalid-config, config-not-a-file and config-unreadable refuse as they do elsewhere (a present-but-broken configuration is never ignored). The delta's ADDED requirement gains that sentence and a scenario (no configuration: import/pull/raise proceed through the vanilla driver; a broken one: refused); the seven-command scenario names each command's own connection flag (`--db-url` for pull). loader.ts joins the file list (intent unchanged). Interaction noted for harden-config-root: once these three read the configuration they take --config too. Ratification: owner on return.

<a id="r3"></a>
## R3 — neonDriver(pool) exposes its Pool as client so the configured driver closes on every shipped preset (task 1.10); design Q2 restated

_lead · extension · basis 412/D24, D25, D13 (complete within the purpose: a shipped preset must satisfy the delta's own closing promise); cd 1.6 measurement (buildWebSocketDriver carries no client member) · 2026-09-05T09:10Z · ratified: pending_

Option (c) inside this change rather than a documented workaround: buildWebSocketDriver exposes the Pool it was handed as `client`, the delta states which drivers expose it, the preset doc's hand-wrapped object is removed, red tests pin `neonDriver(pool).client === pool` and the documented one-liner reaching close in e2e. design.md Q2's premise sentence becomes the measured fact. Reviewer's re-check gains the neon close path. Ratification: owner on return.

<a id="r4"></a>
## R4 — The Neon HTTP driver exposes a no-op close so read-only CLI commands run over HTTP (task 1.11)

_lead · extension · basis 412/D24, D25, D13; 458/R3; cd planner measurement (buildHttpDriver has no client; nothing is held open) · 2026-09-05T09:15Z · ratified: pending_

Option (b): the delta returns to the universal sentence — every driver hejbro ships exposes the member; for a driver that holds nothing open (Neon HTTP) closing does nothing and is documented so. The member's shape is settled as [design] in 1.11 consistently with 1.10. Ratification: owner on return.

<a id="r5"></a>
## R5 — R5 — D106 round 1 B1: the no-factory parity scenario carves out pull's corrected --db-url hints

_lead · interpretation · 2026-09-05T12:15Z · ratified: pending_

D106 round 1 (context-free session, fable; evaluation.md) found the delta scenario "No factory, no change" ("behaves byte-for-byte as before") contradicted by the shipped pull command: with no factory configured, pull's two connection diagnostics (pull-connection-missing, pull-connection-failed) now name --db-url where the parent build (99b9554d) said --url; the other six connecting commands are byte-identical with and without @hejbro/pg present (161 input rows, 167 CLI runs). The new text is the correct one and the delta's own ADDED requirement ("fails naming both ways", pull's flag being --db-url) demands it, so the delta was internally inconsistent about pull rather than the code wrong. Ruling: repair the scenario text with a carve-out naming exactly those two diagnostics and that one byte class; no code change. Basis: D106 R1 report; owner ratification pending.

