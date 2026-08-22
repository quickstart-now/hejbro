---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

`defineFunction` now takes the declared schema object as its first argument, like `table`/`defineView`/`grant` (#269) --
`defineFunction(app, "archive_project", …)` instead of `defineFunction("app", "archive_project", …)`. The string form is still accepted on the 0.1.x line for compatibility (deprecated in JSDoc) and will be removed in 0.2.0.
