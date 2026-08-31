# hejbro

> hej (Swedish: "hello") + bro (Swedish: "bridge") — hello, bridge.

**TypeScript-native Postgres schema & RPC management.** Declare everything in
your database — tables, RLS, functions, triggers, views, grants — in
TypeScript, and generate deterministic migration SQL from the diff.

This package is the user-facing surface: the DSL re-exported from
`@hejbro/core`, plus the CLI (`hejbro init`, `hejbro generate`, `hejbro
baseline`, `hejbro verify`, `hejbro history`, `hejbro restore`).

```bash
hejbro init       # scaffold hejbro.config.ts, migrations/, an empty snapshot
hejbro generate   # diff declarations against the last snapshot, write a migration
hejbro baseline   # adopt an existing database: write the first migration as already-applied
hejbro verify     # re-derive the migration chain from checked-out files, no live DB
hejbro history    # list every migration and whether its declaration state still exists in git
hejbro restore    # restore the declarations to a past migration's own recorded state
```

Provider presets (Supabase first) live in separate packages, e.g.
`@hejbro/supabase`.

## Docs

The full README, design spec, decision log, and guides live in the
[source repository](https://github.com/quickstart-now/hejbro).

## License

[Apache-2.0](LICENSE)
