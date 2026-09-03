---
"hejbro": minor
---

The apply engine (#603, D12 amended): hejbro now owns applying a
migration chain to a database, production included. `hejbro migrate`
applies every pending migration in chain order, each inside its own
transaction with a transaction-scoped advisory lock
(`pg_advisory_xact_lock`) serializing concurrent runs — a runner that
has to wait rechecks the ledger inside that same lock before sending
anything, so it applies only what the winner did not already commit,
and neither run fails. `hejbro status` reports what the ledger records
and what is pending, read-only. `hejbro reset` destroys only what the
declarations manage and clears the ledger, refusing without an exact
`<database>:<count>` confirmation naming what it would drop. `hejbro
raise` stands an empty database up from a snapshot SQL file (a vendored
one, or any other) in one transaction, refusing a database that already
has hejbro history. A migration that fails reports the database's own
code and message plus the next command to rerun; one that adds an enum
value and uses it in the same run is split across two migration files
at the transaction boundary Postgres itself requires
(`generateMigrations`, `@hejbro/core`'s new plural entry point). The
supported Postgres floor is now an explicit, tested policy — currently
15, for `security_invoker` on views.

The ledger now records how each row entered it, and `hejbro status`
reports what that history shows: which migrations it applied, which
baseline migration it registered without running, and — told apart —
a ledger table that has never existed versus one that exists with no
rows yet. `hejbro migrate` verifies the migration chain before it opens
a database connection at all, so an unverifiable chain is refused
without sending anything. `hejbro reset` refuses a declaration set that
exports nothing, before touching the database, the same way `check` and
`baseline` already do for a misconfigured entry point. A migration run
that adds a value to an existing enum type and also spells that value
inside a `sql` template or `sql.raw` — a check constraint, a policy
expression, an index predicate — is now split the same way a typed
column default already was, instead of shipping one migration that
fails against the database after passing every check hejbro has.
