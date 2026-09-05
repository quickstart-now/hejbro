# @hejbro/neon

## 0.2.0-pre.2

### Minor Changes

- 8d79eb0: The driver capability set gains a fourth key, `batched-transactions`: a
  driver that declares it can run a pre-assembled list of statements as
  one transaction, in one round trip where possible, returning one row
  list per member. Every `Driver` now implements a mandatory `batch`
  member — a driver declaring the capability `false` still implements it,
  by refusing before sending anything, the same pattern `transaction`
  already uses on a non-interactive driver.
  
  `db.as(context)` picks a driver's declared capability to decide how it
  runs: `interactive-transactions` still wins where declared, otherwise a
  driver declaring `batched-transactions` runs the context and the
  caller's own statement as one batch. This makes `@hejbro/neon`'s HTTP
  path (`neonDriver(sql)`, built from a `neon()` query function) usable
  with `db.as(context)` for the first time — role and settings apply
  transaction-local to that one batch. `db.transaction(callback)` is
  unaffected and still requires `interactive-transactions`, since a
  callback is interactive by definition.
  
  A batch failure is reported as a batch: every member statement, in
  order, with a statement that the driver does not report which member
  failed — never naming only the caller's own statement, which may not
  have been the actual cause. A driver whose `batch` resolves the wrong
  number of row lists (fewer, more, or none) is refused with the new
  `batch-result-count-mismatch`, naming both counts, rather than silently
  handing a context statement's own rows back as the caller's.
  
  A multi-command `sql`-kind text (`select 1; select 2`, only reachable
  through the `sql` escape hatch) now resolves to the **last** command's
  rows — psql's own convention — instead of `undefined` or a crash.
  `@hejbro/pg` and `@hejbro/neon`'s own session-setup statement is itself
  multi-command, so this rule is exercised on every connection. `@hejbro/
  query` exports this fold itself as `lastRows(result)`. It also newly
  exports `preparedStatementName(sql)` — the prepared-statement naming
  rule `@hejbro/pg` and `@hejbro/neon` both call, so neither driver holds
  its own copy of it anymore.
- 6cbedf2: The driver capability set gains a third key, `prepared-statements`, and
  `pgDriver`/`neonDriver`'s session-oriented (`Pool`) path can now name
  every built statement (`select`/`insert`/`update`/`delete`/a set
  operation) it sends, so a connection parses and plans each distinct
  text once instead of on every execution:
  
  ```ts
  const driver = pgDriver(pool, { preparedStatements: true });
  ```
  
  Opt-in, defaulting to `false` — an existing caller's driver sends
  exactly what it always did. A `sql`-kind statement (the escape hatch, a
  context's own applied statements, a migration body) is always sent
  unnamed regardless of the option, since hejbro parses no SQL and a
  `sql`-kind text may carry more than one command. `@hejbro/supabase`'s
  `supabaseDriver` now refuses, at construction, a base driver that
  declares `prepared-statements: true` for its `"transaction-pooler"`
  endpoint — a name prepared on one pooled backend does not exist on the
  next one the pooler hands out for a later transaction. Every other
  existing driver (`@hejbro/nile`'s decorator, `hejbro`'s CLI paths) is
  unaffected and declares `false`.

### Patch Changes

- Updated dependencies [6e2c8ae]
- Updated dependencies [8d79eb0]
- Updated dependencies [6cbedf2]
- Updated dependencies [6ff7b7f]
- Updated dependencies [9e4fd05]
- Updated dependencies [a2ae603]
- Updated dependencies [419c8fa]
- Updated dependencies [700f71f]
- Updated dependencies [98e9965]
- Updated dependencies [30564a6]
- Updated dependencies [116e13f]
- Updated dependencies [31e951f]
- Updated dependencies [761567b]
- Updated dependencies [99b9554]
  - @hejbro/core@0.2.0-pre.2
  - @hejbro/query@0.2.0-pre.2

## 0.2.0-pre.1

### Patch Changes

- Updated dependencies [333dae8]
- Updated dependencies [b02443a]
- Updated dependencies [17f5495]
  - @hejbro/core@0.2.0-pre.1
  - @hejbro/query@0.2.0-pre.1

## 0.2.0-pre.0

### Minor Changes

- 7aa7ffa: Neon provider preset (#300): `neonDriver(pool)` decorates a
  `@neondatabase/serverless` `Pool` (WebSocket, real interactive
  transactions) and `neonDriver(sql)` decorates its `neon()` HTTP
  one-shot function (declares both capabilities `false`, fails its own
  `transaction()` closed rather than pretending to run one). Both paths
  pin `intervalstyle`/`bytea_output` and force builtin oids 1186/1187/
  1231 (`interval`, `interval[]`, `numeric[]`) to raw text so row shapes
  match `@hejbro/pg`'s. `neonAuth("claims")` and `neonAuth("jwt")` each
  return only that mode's context builders (`asUser`/`asAnonymous` vs
  `asJwtUser`/`asAnonymous`) for the `pg_session_jwt` extension's two
  identity sources, plus `authenticatedRole`/`anonymousRole` matching
  Neon's own role names.

### Patch Changes

- Updated dependencies [6b3cc7f]
- Updated dependencies [5aebe5c]
- Updated dependencies [ef12376]
- Updated dependencies [99b659e]
- Updated dependencies [65936ca]
- Updated dependencies [9963d04]
- Updated dependencies [9f58667]
- Updated dependencies [e530909]
- Updated dependencies [27d5554]
- Updated dependencies [31c7ffd]
- Updated dependencies [5f8b97f]
- Updated dependencies [46b902c]
- Updated dependencies [28aec17]
- Updated dependencies [effda0a]
- Updated dependencies [1f459d1]
- Updated dependencies [e6c802c]
- Updated dependencies [2146480]
- Updated dependencies [f2e7781]
- Updated dependencies [70e68cc]
- Updated dependencies [aad5078]
- Updated dependencies [32a8f11]
- Updated dependencies [387a2cc]
- Updated dependencies [19e7aeb]
- Updated dependencies [16e1c92]
- Updated dependencies [fec58f9]
- Updated dependencies [dafb897]
- Updated dependencies [ef00b1b]
- Updated dependencies [0f19390]
- Updated dependencies [1aa05f2]
- Updated dependencies [71033ca]
- Updated dependencies [7bbdc8b]
- Updated dependencies [6345323]
- Updated dependencies [232293e]
- Updated dependencies [43bbebd]
- Updated dependencies [67ebf69]
- Updated dependencies [4be9551]
- Updated dependencies [d3c39bc]
- Updated dependencies [7c472b7]
- Updated dependencies [221d650]
- Updated dependencies [9394b37]
- Updated dependencies [b2be9b9]
- Updated dependencies [34afb30]
  - @hejbro/core@0.2.0-pre.0
  - @hejbro/query@0.2.0-pre.0
