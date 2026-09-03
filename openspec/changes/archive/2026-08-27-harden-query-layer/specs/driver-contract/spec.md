# Delta: driver-contract

## Purpose

Extends the vanilla driver's row arrival-shape contract to array
columns (closing the gap the previous change deliberately scoped out as
#320) and makes the checkout pin honor the driver value's own
session-setup hook (closing #323).

## MODIFIED Requirements

### Requirement: Vanilla driver row arrival shapes
For an `interval` column — single or array — `@hejbro/pg`'s per-query
type override SHALL deliver Postgres's raw text for that value to the
query layer's own conversion, never the underlying client library's own
pre-parsed interval object(s) — that object has no lossless way back to
text (its default string conversion discards all structure, and its own
text-rendering method reorders and reformats fields rather than
reproducing the original). The override SHALL intercept both the
scalar `interval` oid and the `interval` array oid; an interval array
therefore arrives as Postgres's raw array text. The override SHALL
additionally intercept the `numeric` array oid, delivering Postgres's
raw array text for it too: the client library's own default array
parser for that oid returns already-numeric-parsed JS numbers per
element, silently destroying the scale and precision a
`'string'`/`'bigint'`-mode `numeric` column's declared conversion
needs — unlike scalar `numeric`, which the client library already
leaves as raw text, and unlike `bigint` arrays, whose own default array
parser already returns text elements and therefore need no override.
Every other declared column type — every array oid other than
`interval`'s and `numeric`'s included — SHALL arrive in whatever shape
the underlying client library's own defaults produce, `format` argument
included; the override delegates to that default parser unchanged.

#### Scenario: A single interval column arrives as raw Postgres text
- **WHEN** a table declares a non-array `interval` column and a row
  is read through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw interval text, not a pre-parsed object

#### Scenario: An interval array column arrives as raw array text
- **WHEN** a table declares an `interval` array column and a row is
  read through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw array text (element parsing is the query layer's
  job), never an array of pre-parsed objects

#### Scenario: A numeric array column arrives as raw array text
- **WHEN** a table declares a `numeric` array column and a row is read
  through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw array text (element parsing is the query layer's
  job), never an array of already-parsed JS numbers — scale and
  precision (e.g. trailing zeros, or digits beyond
  `Number.MAX_SAFE_INTEGER`'s own limit) survive intact

#### Scenario: bigint, numeric, and timestamptz are read back in their declared shapes through a real db() handle
- **WHEN** a table declares a `bigint` column (default mode), a
  `numeric` column (`'string'` mode), and a `timestamptz` column, a row
  containing them exists in a real Postgres, and that row is read back
  through `@hejbro/pg` and a real `db()` handle
- **THEN** the `bigint` column reads back as a JS `bigint` exact beyond
  `Number.MAX_SAFE_INTEGER`, the `numeric` column reads back as the
  exact decimal text stored, and the `timestamptz` column reads back as
  a `Date` instance at the stored instant

#### Scenario: Other oids keep the client library's defaults
- **WHEN** a row carries columns of types other than `interval` or
  `numeric` (arrays included — `bigint` arrays included)
- **THEN** each value arrives in the underlying client library's own
  default shape for that oid, `format` argument respected — the
  override intercepts nothing else

### Requirement: Vanilla driver pins IntervalStyle at checkout
`@hejbro/pg`'s driver SHALL pin a physical connection it has not
successfully pinned before, before any caller-supplied statement runs
on it, on both the direct-execute path and the transaction path. It
SHALL NOT repeat the pin on a later checkout of a connection it has
already pinned successfully. A pin attempt that itself fails SHALL NOT
be treated as pinned — the same physical connection SHALL be pinned
again the next time it is checked out. The checkout path SHALL invoke
the session-setup hook through the driver value's own hook member —
late-bound, so a decorator that replaces or wraps that member takes
effect on every subsequent checkout — never through a captured
internal reference that bypasses the driver value.

#### Scenario: The pin precedes the first caller statement, on either path
- **WHEN** `@hejbro/pg`'s driver checks out a physical connection it has
  not seen before, whether for a direct `execute` or for a `transaction`
- **THEN** it sends the IntervalStyle pin before any caller-supplied
  statement on that connection

#### Scenario: A reused connection is not pinned twice
- **WHEN** the same physical connection is checked out again after
  having already been pinned successfully
- **THEN** the pin is not sent again on that checkout

#### Scenario: A failed pin attempt is retried on the next checkout
- **WHEN** a pin attempt on a physical connection itself fails
- **THEN** that connection is not recorded as pinned, and the next
  checkout of the same physical connection attempts the pin again
  before any caller-supplied statement

#### Scenario: A wrapped session-setup hook takes effect at checkout
- **WHEN** the driver value's session-setup hook member is wrapped or
  replaced (for example by a preset decorator) and a fresh physical
  connection is checked out
- **THEN** the wrapped hook — not the original internal one — runs for
  that checkout's session setup
