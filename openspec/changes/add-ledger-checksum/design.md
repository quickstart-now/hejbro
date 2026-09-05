# Design: add-ledger-checksum

Settled by the lead under the owner's full delegation for this pass;
recorded as a ruling on the change's issue.

## Q1 — What is hashed

- The body below the banner block: the banner's own lines (`-- hejbro
  migration` through the hash lines) are provenance the offline walk
  already checks and may be rewritten by a format upgrade; the body is
  what ran. Line endings are normalized to `\n` before hashing so a
  checkout on another platform does not read as an edit; nothing else
  is normalized — trailing whitespace inside a body is an edit like any
  other.
- A raised snapshot file has no banner: the whole file is hashed.
- A baseline is registered, not run, but its body is still the text the
  database is assumed to hold: hashed the same way.

## Q2 — When it is compared

Before `migrate` applies anything pending, over every recorded file
present on disk (a recorded file missing from disk is already its own
disagreement). A mismatch refuses the whole run before any statement is
sent: applying later migrations on top of a body that differs from what
ran would build on a history the repository no longer holds. `status`
reports the same finding without refusing anything.

## Q3 — The older ledger

The identity rule keeps its four required columns; `checksum` joins the
bootstrap's `create table` and is added to an existing ledger by
`alter table … add column if not exists` inside the bootstrap, so a
ledger written on a pre-release is upgraded in place. A row with a
`NULL` checksum was recorded before the column existed and is never
compared — the next applied migration records one.

## Q4 — Code and message

`apply-migration-body-changed`: names the file, the recorded and the
current checksum (short form), and the remedy: restore the file from
version control, or if the edit was deliberate, write it as a new
migration — hejbro never rewrites applied history.

## Q5 — A filtered ledger (#865)

The identity judgement already reads the relation's kind, persistence
and columns from the catalog; `relrowsecurity` and `relforcerowsecurity`
sit on the same row. hejbro never enables row-level security on its own
table, so a ledger carrying it is a ledger someone changed — refused
under its own code before any row is read, with the policies named, by
every command that touches the ledger. A row count the catalog
contradicts is not used: `pg_class.reltuples` is an estimate and a
freshly vacuumed ledger has none.
