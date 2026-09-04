# Decisions — quickstart-now/hejbro#357

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-28T00:00Z_

No new owner decisions inside the piece; the operative contracts were
D99 and the three settled surfaces. Lead rulings during the piece, all
derived from standing owner rules and reported with veto: shared files
(README CRAP block, `.changeset/`) are lead-closing artifacts that
piece teams never touch — refined mid-piece from "write once at
integration" to "write at each piece's closing after rebase", because
each piece PR must pass CI's `git diff --exit-code README.md` backstop
itself; the change carries ONE change-level changeset on the
first-landing piece (this one, as built order turned out), per the
harden precedent where hg1/hg2 merged changeset-less under pending
coverage; and `undefined` handling (strict `=== null` passes it
through) stays unpinned — a test would extend the contract past what
D99 says, so it is JSDoc + this record only, a natural rider for
whichever future change touches the file.

