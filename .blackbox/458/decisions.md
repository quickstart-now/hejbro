# Decisions — quickstart-now/hejbro#458

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — hejbro.config.ts gains a driver factory that every connecting command prefers over the dynamic @hejbro/pg import

_lead · extension · basis 412/D24, 412/D25; D95 (any conforming driver executes); the 2026-08-29 add-check-schema ruling that parked this as its own design round; read on 2026-09-05: seven commands connect through check/driver.ts's withCheckConnection, and the loader's z.object strips an unknown driver key silently · 2026-09-05T04:55Z · ratified: pending_

Design (openspec/changes/add-config-driver/design.md Q1-Q5): a factory `(connectionString) => Driver | Promise<Driver>`, never an instance (an instance would open a pool for every command and need the secret at config-evaluation time); the factory receives the resolved --url/DATABASE_URL string only; the CLI closes what it is handed through `client.end()` and refuses, before any statement, a driver with no closing member (`<prefix>-driver-unclosable`, a fourth literal code per call site) rather than widening the driver contract for a CLI-only lifecycle; a throwing factory is the command's own connection-failed; without the field every command is byte-identical to today. Spec: cli-commands MODIFIED (check's driver paragraph) + ADDED (one requirement covering the seven commands). Ratification: owner on return.

