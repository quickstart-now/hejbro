# Decisions — quickstart-now/hejbro#687

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — init reads the existing configuration and creates only what is missing there

_lead · interpretation · 2026-09-03T00:00Z · ratified: pending_

Ledger R7.

#687: `init` reads an existing configuration, creates only the missing artifacts at the configured paths, reports the actual paths, never overwrites an existing file, and keeps today's behaviour when no configuration exists. The `cli-commands` spec gains an ADDED init requirement.

<a id="r2"></a>
## R2 — init keeps its output shape and resolves paths like generate

_lead · interpretation · 2026-09-03T07:40Z · ratified: pending_

Ledger R15.

init keeps its output format and prints actual paths (a directory with exactly one trailing slash); path resolution is `join(cwd, value)`, the same as generate; when reading the configuration fails nothing is created and the existing error code is used (`runInit` becomes async with a result type — internal surface).

<a id="r3"></a>
## R3 — cl adds the assertBuiltCli guard in this PR; init option 1

_lead · interpretation · 2026-09-03T08:50Z · ratified: pending_

Ledger R25.

`status-command.test.ts`, red only because the worktree had no dist, gets the one-line `assertBuiltCli` guard in this PR without an issue (restoring the house rule). init takes option 1: a failed configuration load fails with the same code as generate.

<a id="r4"></a>
## R4 — Constructor-review findings on init are fixed in the same piece

_lead · interpretation · basis D110 · 2026-09-03T11:25Z · ratified: pending_

Ledger R29.

Findings of cl's constructor review: a node of another kind on path C is refused with a code (no skipping); an empty or `.` migrationsDir (D) resolves and labels like generate; `validate-export.ts`'s `z.record` drops a `__proto__` own key (E) and is fixed in the same piece with the real pipeline input table. B's requirement-sentence conflict is corrected with the clause "repair happens in a project whose configuration can be read".

<a id="r5"></a>
## R5 — With a configuration file, init creates only the configured artifacts

_lead · extension · 2026-09-03T11:35Z · ratified: pending_

Ledger R30.

When a configuration file exists, init creates only the configured artifacts and reports omitted fields as "not configured", so a consumer-only repository never grows migration artifacts. No configuration means template plus both, as today.

<a id="r6"></a>
## R6 — init's path invariant is generate's resolution function

_lead · interpretation · 2026-09-03T11:50Z · ratified: pending_

Ledger R32.

init's path invariant: the same resolution function as generate, no init-side normalisation; a file artifact whose path is spelled as a directory is `init-path-conflict`.

<a id="r7"></a>
## R7 — The d106 round-1 correction group of six tasks is approved

_lead · interpretation · 2026-09-03T14:20Z · ratified: pending_

Ledger R45.

cc's correction group is approved: a non-ENOENT stat failure is also `init-path-conflict`; the N2 pair comparison includes the configuration file; the N8 `hasOwn` guard lets protocol names through (then/toString/valueOf/constructor/toJSON), no delta (the client guard surface is unspecified); a new patch changeset; task-times group 3.

<a id="r8"></a>
## R8 — init-path-conflict's Next names the real node; the first line keeps the user's spelling

_lead · interpretation · 2026-09-03T15:25Z · ratified: pending_

Ledger R48.

The `Next:` clause of `init-path-conflict` names the actual node path (trailing separator removed); the first line and the expectation sentence keep the user's spelling. Extended later: ancestor messages are unified without a trailing slash.

