---
"hejbro": minor
---

`hejbro check` compares your declarations against a live database's
catalog, object by object, without ever writing to it — read-only, no
transaction, no migration applied. It resolves a connection from `--url`
or `DATABASE_URL` (never `hejbro.config.ts`) and needs `@hejbro/pg`
installed — declared as no dependency kind at all, not a dependency and
not a peer, optional or otherwise, so installing `hejbro` never pulls in
a Postgres client for the commands that never connect. Every declared kind is checked for existence
by identity; a column's type, `notNull`, and default are compared with
the measured display normalizations (`format_type`'s long names, a
default's trailing cast, a negative literal's quoting); primary keys,
unique constraints, foreign keys, and indexes are checked for existence
only; a check constraint's expression is compared by rendering the
declared and the catalog's own text through the server in one
statement, so a rewrite-on-write (`in (...)` becoming `= ANY(...)`, for
instance) never false-positives, and a constraint the database is not
enforcing on existing rows (`NOT VALID`) is reported even when its
expression matches. Every catalog read is role-independent (grants read
through `aclexplode(coalesce(relacl, acldefault(...)))`, never a
role-filtered `information_schema` view), and a read that fails outright
is a coded error, never silently read as "the object does not exist".

The exit code answers three questions, not two: `0` everything compared
agreed, `1` at least one declared object is missing or differs (the
stronger fact, so it wins even alongside something else that could not
be compared), `2` the run could not answer — something could not be
compared (e.g. a role without EXPLAIN privilege on a table), or the
declaration set was empty. `2` is never folded into `0` or `1`, so a
read-only CI role's "could not compare" never reads as either a false
pass or indistinguishable real drift. The report always states its own
coverage boundary (view bodies are not compared; several axes are
existence-only; its reads are not one snapshot) and prints an inventory
of tables inside your declared schemas that no declaration covers, and
the database's installed extensions — informational, never a finding,
never affecting the exit code.
