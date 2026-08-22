---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

`hejbro verify --fix` (#220) automatically resolves a
`duplicate-migration-version` collision it can actually order by chain
history: it renames every "later" file in a resolvable group to a version
after the directory's current latest (staggered a second apart for a
3+-way collision), leaving migration content and the checked-in snapshot
untouched, prints each `<before> -> <after>` rename, then continues into
the normal five checks against the refreshed file listing.

A group `--fix` can't safely reorder — a genuine fork (two migrations
sharing the same parent snapshot), or a member with no readable
hash-chain banner — is left untouched (`--fix` prints a `skipped: ...
chain order undetermined, see Next` line for it, never silent), and
`duplicate-migration-version`'s `Next:` offers one full `mv` option per
group member instead ("assume this one is later; rename it; rerun
verify") rather than a single confident guess, since hejbro genuinely
doesn't know the order. Both the resolvable-group `(a) hejbro verify
--fix` / `(b) mv ...` pick and the unresolvable-group per-member `mv`
options are computed from the exact same chain-order check `--fix`
itself runs, so the diagnostic text and what `--fix` actually does can
never disagree.
