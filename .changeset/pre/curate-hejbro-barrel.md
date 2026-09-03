---
"hejbro": minor
---

The `hejbro` barrel now re-exports `@hejbro/core`'s declaration and
query vocabulary only — schema and table builders, column types,
expression, aggregate and window helpers, the query builders, the
banner readers, `HejbroError` and the user-facing utilities — plus every
core type. Core's engine (renderers, codecs, the diff and generation
machinery, kind definitions, the snapshot codec, traversal tables,
internal brands and helpers) no longer appears on `hejbro`; import it
from `@hejbro/core`, where presets and sibling packages always did. The
classification is complete by construction: a core export in neither
list fails `hejbro`'s own tests, and the barrel's runtime export set is
pinned by set equality.
