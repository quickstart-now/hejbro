---
"hejbro": patch
---

A schema whose only objects were omitted for their own name (a table
or enum whose catalog name no declaration can carry) now prints its
loss report and refuses as `import-nothing-declarable`/
`pull-nothing-declarable`, naming that schema, instead of falling
through to `*-nothing-to-infer` with an empty stdout; a schema holding
only a standalone sequence or a function keeps `*-nothing-to-infer`
(no rename could have saved it either way), alongside its own
`Not inferred:` line, rather than being silently discarded. Neither
refusal ever suppresses the report that precedes it. The
`*-nothing-to-infer` message and the per-schema `Not inferred:` line
now say "no table or enum to declare" rather than promising a
"sequence" check the classification never actually made. `hejbro
pull`'s own primary-key approximation line now names its own way out
(rename the constraint to the derived name), matching what `import`'s
line already did, without promising a `check` consequence a pull
consumer never sees. A foreign key bound to a generated column whose
own root cause is a type no column builder expresses (`point`,
`money`, ...) now renders under that type-cause wording instead of
falling back to the name-cause one.
