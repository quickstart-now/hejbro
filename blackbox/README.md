# Blackbox — flight recorder for this repository

Full decision records for `hejbro`: what the owner actually asked
for, what the assistant answered and built, why it was built that way, and
the internal processing (tests, measurements, reversals) behind each change.
This is the audit trail a future session reads instead of re-litigating a
rule's origin.

## Conventions

- **One entry per owner-driven change.** Any change to this repository that
  originates from an owner exchange gets a dated entry
  (`YYYY-MM-DD-<slug>.md`) landing in the same PR as the change.
- **Non-summarized.** Entries carry the full exchange — every owner input,
  the assistant's actual responses and proposals, the decision rationale,
  and the internal processing logic. A summary is already an
  interpretation; the blackbox holds the source.
- **English rewrites, not literal translations.** The owner communicates in
  Korean. Inputs are recorded as faithful English *rewrites* — complete in
  content, natural in form — never word-for-word translationese (owner
  rule, 2026-08-26).
- **Content-pinned.** Each entry opens with `Refs:` lines naming the
  changed files and their blob SHAs (`git hash-object <path>`) at the
  recorded state. Blob SHAs are content-addressed, so the pin survives
  squash, rebase, and any history rewrite — provided the pinned content
  is in the final tree: a blob that existed only in an intermediate
  state does not survive a squash. Take Refs after the change's last
  commit (after any rebase), and before declaring done confirm every pin
  matches its path in the final tree
  (`[ "$(git rev-parse HEAD:<path>)" = "<sha>" ]`) — existence in history
  is not enough: run pre-squash, `git log --find-object` still finds
  intermediate blobs and passes stale pins. Use `--find-object` only to
  classify a mismatch (path moved vs. content changed). A stale pin trips
  no gate. No merge-method constraint exists, and the
  entry lands in the same commit or PR as the change. Verify with
  `git hash-object`; retrieve a pinned state with
  `git log --find-object=<sha>` or the GitHub blobs API.
- **Load only on demand.** Never read this directory during normal work.
  It exists for provenance questions — "why does this rule exist?",
  "what did the owner actually ask for?" — and for nothing else.
