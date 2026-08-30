---
"@hejbro/query": minor
---

`@hejbro/query` exports `throwMissingCapability(capability, operation)`
(#490): a driver constructs the contract's own missing-capability error
by calling it, never by reproducing its message text, so every driver's
refusal reads identically — `@hejbro/neon`'s HTTP driver now constructs
it this way instead of carrying its own copy.

`hejbro check` no longer hardcodes any preset's kind (#482):
`@hejbro/supabase`'s storage bucket kind now declares that no catalog
object backs it, stated once in `check`'s coverage-boundary section
rather than silently reported as agreeing. A declared object of a kind
this build does not recognize is now reported as **not compared**, with
the reason — never as a false difference — and the run cannot exit `0`
on the strength of a comparison that never ran.
