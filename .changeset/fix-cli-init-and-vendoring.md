---
"hejbro": patch
---

Fixes three silent failures: `hejbro init` now honours an existing `hejbro.config.ts`'s `migrationsDir`/`snapshotPath` instead of always scaffolding the default paths, a vendored contract no longer silently drops a table, column, or function named `__proto__`, and `db.fn` now refuses a pre-built argument object that names a key its declaration doesn't, instead of silently sending `null`/`undefined` for the misspelled argument.
