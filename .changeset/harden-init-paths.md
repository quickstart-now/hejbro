---
"hejbro": patch
---

`hejbro init` now honours `--config <path>` exactly as `generate` does, reading or scaffolding the configuration file it names instead of always the default `hejbro.config.ts` at the working directory. An absolute-looking `migrationsDir` or `snapshotPath` (e.g. `"/db/migrations"`) is refused with `invalid-config` instead of being silently re-rooted under the working directory. `init` refuses, before creating anything, a configuration whose snapshot path would have to hold the migrations directory. A directory sitting at the configured snapshot path is now refused by `generate`/`verify`/`check` with the new error code `snapshot-not-a-file`, instead of a raw `EISDIR` crash. A permission-denied check during `init` now names the directory that actually blocks it, instead of the leaf path or an unrelated ancestor.
