---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

`HejbroError` is now a real `Error` subclass instead of a plain object
type. `code`, `message`, and `declaredAt` remain accessible the same way,
but the CLI's `catch`-clause discriminator now checks `instanceof
HejbroError` instead of duck-typing on "has a `code` and a `message`" —
the old check misidentified any Node runtime error carrying a `.code`
(e.g. `ERR_MODULE_NOT_FOUND`) as a HejbroError (#125). A plain object
literal shaped like `{ code, message, declaredAt }` no longer satisfies
the `HejbroError` type; build `HejbroError`s via the `hejbroError`
factory instead — this can break consumer code that constructed one by
hand rather than through the factory, hence `minor`, not `patch`.
