# Work — quickstart-now/hejbro#788

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Sixty-four legacy entries migrated into fifty-six issue folders

_2026-09-04T04:55Z_

Every pre-folder-form record (64 dated single files, 2026-08-26 … 2026-09-04) was migrated with `blackbox migrate`: owner-input sections became `D#` entries dated from the file name, the remaining sections and preamble one `W#` per entry, and each entry's `Refs:` pins became the PR block of the PR that landed it (mapping reviewed by hand: entry → tracking issue → merged PR, 64 rows). Folders were opened for fifty-six issues that had none, closed folders dated from the tracker, the originals kept verbatim under `<folder>/artifacts/`. Entries of the same change (add-query-layer's seven groups, the proposals) share the change's tracking issue folder; the generated `.blackbox/README.md` no longer lists any legacy entry. Caveat carried from the tool's guide: the owner-input split is by heading, so a legacy entry that narrated several issues sits in the folder of its primary issue with the others linked in prose.

