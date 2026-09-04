# Work — quickstart-now/hejbro#743

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — absolute-looking artifact paths refused at parse

_2026-09-04T14:11Z_

Absolute-looking artifact paths refused at parse.

Commit: a04ad48f.

`parseConfig` (`config.ts`) refuses a `migrationsDir`/`snapshotPath`
value `isAbsolute` accepts, right after the zod parse and before the
existing `findInvalidPresetIndex` check. The first offending field wins
(the loader's established one-failure-at-a-time habit). The message
names the field and suggests the relative spelling (leading `/`s
stripped) but carries no configuration path — that text is #745's own,
next batch. A relative spelling (`./x`, `x/`, `../x`, `""`) still passes
unchanged.

This replaces a test-only pin the previous change (`fix-cli-init-and-
vendoring`) left in `init.test.ts` (`migrationsDir: "/db/migrations"` ->
"created db/migrations/", relying on `join(cwd, value)` silently
swallowing the leading `/`) with an explicit refusal — the previous pin
was in a test, never a spec scenario, so nothing archived needed
re-opening. `generate-command.test.ts` gained one subprocess case
confirming `generate` refuses the same way, before writing anything.

As a side effect of the refusal existing at all, `verify`'s own `Next:`
lines (which embed the configured spelling directly in a shell command)
can no longer receive an absolute-looking value that would resolve at
the filesystem root — fixed by construction, not by touching verify.ts.

Full gate sweep green at commit time (91 files / 956 tests). One `biome
format` fixup needed (a multi-line return-type wrap) before `check`
passed clean.

