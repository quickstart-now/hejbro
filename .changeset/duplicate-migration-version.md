---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

`hejbro verify` gains a fifth check (#220): two migration files sharing
the same version prefix are now a hard error, caught before the chain
walk (chain order is undefined when versions collide) — Supabase
applies migrations by this exact prefix, so a collision means one of
them silently never runs. `Next:` gives a computed `mv` command per
extra file rather than asking you to work it out. `diverged-migrations`'
own `Next:` is rewritten the same way: one fully computed
`rm ... && hejbro generate` option per candidate file, instead of prose.
