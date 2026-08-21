---
"@hejbro/core": minor
---

Snapshot format version bumped to `5` (D68). This PR only moves the
version marker — no snapshot shape changed yet, so every existing
declaration renders an identical snapshot object graph, just under
`formatVersion: 5`. The actual shape changes this version opens the
door for (structured expression nodes, primary key/unique constraint
names) land in later PRs of the same wave without needing their own
version bump. A snapshot written by a prior build (`formatVersion`
4 or older) is rejected with the existing `unsupported-snapshot-version`
diagnostic, same as any other format bump.
