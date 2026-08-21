---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

`registry.register()` now requires a namespace prefix (a hyphen) from
every kind id it doesn't already own itself -- previously this was
only advice inside `duplicate-kind`'s message, surfaced solely once
two kind ids actually collided. A preset registering an unprefixed
kind id now fails immediately with `preset-kind-needs-prefix` instead
of silently succeeding until a future collision. `@hejbro/supabase`'s
own kind (`supabase-storage-bucket`) already satisfies this and needs
no change.

This is a new registration-time check a preset could start failing
under, hence `minor` rather than `patch`. It buys predictable preset
kind ids and an earlier, clearer error -- it does not make
`unknown-kind`'s classification sound (see #196/#199): the reverse
direction, "a core kind id never carries a hyphen," can't be enforced
the same way, so `unknown-kind` still states both possible causes
rather than guessing from a kind id's shape.
