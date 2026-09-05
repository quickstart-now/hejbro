# Design: add-config-driver

Open decisions, each as background → options → ruling. Settled by the
lead under the owner's full delegation for this pass and recorded as
rulings on the change's issue.

## Q1 — Factory or instance

- (i) `driver: Driver` — an instance built when the configuration
  module is evaluated.
- (ii) `driver: (connectionString: string) => Driver | Promise<Driver>`.
- **Ruling (ii).** An instance would open a pool for every command,
  including the ones that never connect, and would need the connection
  string at configuration-evaluation time — which is exactly where the
  contract says a secret must not live. A factory is called only by a
  command that connects, with the string the command resolved. Promises
  are accepted so a preset can import its driver lazily, as the CLI
  itself does.

## Q2 — Closing

**Background.** The vanilla driver's connection-string form never
closes its pool; the CLI closes it through `driver.client.end()`, the
one non-contract member it relies on today. A contract `Driver` has no
close member.

- (i) Require the factory's driver to carry `client.end()` (the shape
  `pgDriver`, `neonDriver(pool)` and every decorator that spreads its
  base already have); refuse one that does not, at use, with
  `<command>-driver-unclosable` naming the `driver` field and the
  missing member.
- (ii) Add a close member to the driver contract.
- **Ruling (i).** The contract is the query layer's; a CLI-only
  lifecycle need does not widen it. The refusal is coded and named per
  command like the three connection codes, and it fires before any
  statement is sent — a driver that would hang the process is refused
  before it can.

## Q3 — What the factory receives and when it runs

- It receives the resolved connection string only — never the
  configuration, never the environment. `--url`/`DATABASE_URL`
  resolution and its `*-connection-missing` refusal run first,
  unchanged; the factory runs after, once per command; the `select 1`
  probe and `*-connection-failed` run on whatever it returned.
- A factory that throws surfaces as `*-connection-failed` with the
  thrown error described, the same way a refused connection does:
  from the command's point of view the driver could not be opened.

## Q4 — Validation

- The schema accepts a function and nothing else for `driver`; the
  shape hint names it. Unknown keys were stripped silently before —
  the field's absence from the schema was the reason a misspelled
  `driver` would have been ignored, which this change removes for this
  field only.

## Q5 — Not in scope

- A per-command driver, or a driver keyed by endpoint: one factory, the
  project's own runtime driver.
- Reading credentials from the configuration: unchanged and refused.
