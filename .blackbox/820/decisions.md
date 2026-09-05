# Decisions — quickstart-now/hejbro#820

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — OD2: migrations-dir-not-a-directory / migrations-dir-unreadable before the list is read; listMigrationFiles(cwd, migrationsDir)

_lead · extension · basis D1 · 2026-09-04T20:16Z · ratified: pending_

OD2 — codes `migrations-dir-not-a-directory` (a file or dangling link at the path) and `migrations-dir-unreadable` (cannot be checked or listed: permission, file ancestor, link ancestor, unreadable directory), the symmetric pair of the snapshot codes, refused before the list is read by every command that lists migrations (generate, baseline, verify, history, migrate, status, restore — one `listMigrationFiles`; status and migrate list before they connect, measured). Signature `listMigrationFiles(cwd, migrationsDir)` so the message names the configured spelling; six call sites change one line each. An absent directory stays "zero migrations".

