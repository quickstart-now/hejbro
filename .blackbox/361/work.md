# Work — quickstart-now/hejbro#361

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — fix-gate-roots — the diagnostic gates learn to see query and pg (#361)

_2026-08-28T00:00Z_

Plain-cycle tooling fix (gate scripts only, no published package
touched, no changeset), executed by the lead session directly in
worktree `fix-gate-roots` off dev `fdf6fa6`. First item after the
add-array-ergonomics archive; the issue was filed from the g3 piece's
"four signals that never reached their target" pattern.

### What the measurement changed about the plan

The issue's fix direction anticipated bringing query/pg error messages
into `Next:` compliance after expanding the roots. The audit found
**16/16 sites already conforming** — every enriched-plain-Error site in
`packages/query/src` carries a literal `Next:` clause (and
`packages/pg/src` has no error sites at all today). The piece teams had
been following the convention without a gate. So the entire fix is the
gates themselves; zero production-message edits, zero new exemptions.

### The fix

- Both scripts' `SOURCE_ROOTS` gain `packages/query/src` and
  `packages/pg/src`. For `check-diagnostic-xref` that alone was
  sufficient (defined codes 107 → 122, all citations still resolve).
- `check-next-marker` needed three things to make the new roots real
  rather than a never-fires no-op (the exact failure mode its own
  header warns about, and the reason #361 exists):
  1. grep exit 1 (a root with no candidates — pg today) is "no
     candidates", not a crash; previously it killed the script.
  2. A second extraction path for the enriched-plain-Error idiom
     (`throw Object.assign(new Error(…), { code: "…" })`) — normalized
     into the same `{filePath, lineNo, args}` shape so the existing
     validation loop (exemptions, mixed-reachability patterns, message
     resolution) applies unchanged. A site with no literal `code:` (the
     `{ code }` shorthand inside a thrower helper, or non-error
     `Object.assign` like sql.ts's tag composition) is skipped exactly
     like a dynamic-code `throwHejbroError` call.
  3. Same-file thrower helpers wrapping the idiom with a forwarded code
     (compile.ts's `throwQueryError(code, message)`) join the call-site
     scan by name, under the same (code, message) convention — their
     own assign site is dynamic and skipped, so the original messages
     at their call sites are what get checked.

### Evidence shape

Red (pre-fix, measured): expanding the roots alone crashed next-marker
on pg (grep exit 1) and changed nothing for query — a violating tree
and a clean tree produced identical output. Green: both gates pass on
the clean tree with the new roots. The never-fires proof ran as four
violation probes, each inserted, observed, and reverted:

1. A `Next:`-less assign-site planted in query src → FAIL naming the
   file, line, and code (re-run on the final bytes after the biome
   reflow — gate judgment binds to bytes).
2. The `Next:` clause stripped from compile.ts's `empty-sql-statement`
   message → FAIL (the local-thrower call-site path fires).
3. An `error[no-such-code-zzz]` citation planted in query src → xref
   FAIL (the new root is actually scanned).
4. A `Next:` corrupted in a core site → FAIL exit 1 flagging exactly
   that site (the original scope is unharmed).

Clean-tree exit 0 re-confirmed after each revert; `git status` clean.

### Gates

biome 413 clean (one round: the repo bans ternaries even in scripts,
and useOptionalChain applies — both fixed) · check-types 13/13
`Cached: 0` · test 14/14 `Cached: 0` · CRAP 0/1190, README numbers
unchanged · both diagnostic gates ok with the expanded roots. No
changeset: internal tooling only.

Migrated from the single-file entry `.blackbox/2026-08-28-fix-gate-roots.md`, kept verbatim at `.blackbox/361/artifacts/2026-08-28-fix-gate-roots.md`.

