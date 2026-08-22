---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

Every migration generated from now on records the hejbro version that
wrote it: a `-- hejbro: <version>` line directly below `-- hejbro
migration` (#229). `@hejbro/core`'s `renderBanner` takes the version as
an optional third argument (`undefined` by default, so every existing
call site and golden fixture is unaffected) and `parseBannerVersion`
reads it back; the CLI reads its own `package.json` at runtime to supply
the string, so core never touches the filesystem or knows its own
version. Pre-#229 migration files (no version line) keep parsing
unchanged.
