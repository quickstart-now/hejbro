---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Fix `hejbro verify`'s chain-linearity check (#129): a rollback that
re-declares an earlier schema state was misclassified as
`diverged-migrations` (a fork), because the old check grouped entries
by parent value globally with no notion of position. `checkChain` now
walks strict positional adjacency instead, so a rollback's own
`current` returning to an earlier state satisfies the very next
entry's `parent` immediately and never trips the fork check.
