# Proposal: harden-check-expressions (#778, #779, #781)

## Why

Three findings against `hejbro check`, all in one defect family: the
expression comparison the `cli-commands` spec promises is implemented for
check constraints only.

- **#778** — the spec's comparison-surface list says an expression-bearing
  object (a check constraint, an index predicate, a generated column) is
  compared "through the server's own rendering", but the requirement that
  defines that rendering says, in its own text, that an index is compared
  by its existence and a generated column by its default text. Shipped
  behavior is the latter: `compareIndexes` (`compare.ts`) checks that a
  same-named index exists and never reads its predicate or expression
  columns, so a partial index whose predicate the database has changed —
  or a `lower(email)` index the database holds as `upper(email)` — passes
  as present. A checker that reports agreement on something it never looked
  at is the failure this command exists to end.
- **#781** — a generated column's declared side carries `generated`, never
  `default`; the catalog side is read from `pg_attrdef` as `catalogDefault`,
  because Postgres stores a generation expression there too. The two never
  meet, so every matching generated column is reported
  `check-object-differs: … has no default, but the database has one
  ("lower(email)")` on every run, in both comparison modes (measured in
  fix-nile-findings' D106 review, rounds 1 and 2). A project with one
  generated column can never see `check` exit 0.
- **#779** — the not-compared diagnostic wraps the expression texts in
  the same double quote SQL uses for identifiers:
  `Declared expression: ""probe"."role" = 'owner'"`. The delimiter and the
  content collide the moment a table-bound expression starts with a quoted
  identifier — which, since fix-nile-findings, every column reference does.

Judged against hejbro's purpose (a check must tell the truth about whether
the database matches the declaration), the fix is not three patches but one
rule: every table-bound expression `check` knows about — a check
constraint's expression, an index's predicate, an index's expression
columns, a generated column's expression — is compared the same way, with
the same one-statement server rendering, the same text fallback under a
preset that declares no planning, and the same not-compared reporting.

## What Changes

- **`check` compares four expression surfaces, not one.** An index's
  predicate and its expression columns, and a generated column's
  expression, are compared through the server's rendering of both sides
  from one statement — the check-constraint probe, generalized — and by
  normalized text where a registered preset declares the platform cannot
  plan a statement. Existence keeps precedence: a missing index or column
  is reported once, as missing. An index's plain columns, uniqueness and
  access method stay compared by existence only, and the spec now says so
  where it previously claimed otherwise.
- **A generated column is compared as a generated column.** The catalog
  read tells a generation expression apart from a default
  (`pg_attribute.attgenerated`); a column generated on both sides has its
  expression compared, a column generated on one side only is reported as
  differing on that axis, and the default axis is never reported for a
  generated column on either side. A matching generated column produces no
  finding.
- **Expression texts in a diagnostic are delimited apart from SQL's own
  quotes** — every site that quotes a declared or catalog expression text
  (the not-compared findings and the differs finding) uses a delimiter
  that cannot appear as a SQL quote character. Codes and `Next:` lines are
  unchanged.
- **The text-mode coverage-boundary line names expressions, not
  check-constraint expressions.**
- One `patch` changeset; `skills/hejbro`'s check section (`brownfield-adoption.md`,
  `nile-preset.md`) says which expression surfaces `check` compares and
  what an index's existence-only remainder is.

## Capabilities

- `cli-commands` — MODIFIED: "Declarations can be checked against a live
  database" (the comparison-surface list: a generated column's axes), and
  "An expression is compared through the server's own rendering" (the
  four surfaces, the generated-column axis, the delimiter rule, the
  boundary line).
- `diagnostics` — no delta: every code stays, only prose moves.

## Impact

- `packages/cli/src/check/expression.ts` (the probe and the text
  comparison generalized over a surface; index and generated-column
  comparators; delimiter), `packages/cli/src/check/catalog.ts` (the
  `columns` query gains the generation expression as its own field, the
  `indexes` query gains the predicate and expression-column texts),
  `packages/cli/src/check/compare.ts` (generated-column axis, default axis
  skipped for a generated column), `packages/cli/src/commands/check.ts`
  (the declared-expression walk over indexes and generated columns, the
  boundary line).
- Tests: `packages/cli/test/check-expression.test.ts`,
  `check-compare.test.ts`, `check-catalog.test.ts`,
  `check-command.test.ts`, `check-live.integration.test.ts` (Docker).
- `skills/hejbro/references/brownfield-adoption.md`,
  `skills/hejbro/references/nile-preset.md`;
  `.changeset/harden-check-expressions.md` (`patch`).
