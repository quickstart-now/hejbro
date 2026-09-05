# Work — quickstart-now/hejbro#726

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — loss report's column promise is now true by check's behavior; index/check lines stop over-promising

_2026-09-05T00:22Z · per R1_

The loss report's `Omitted: column …` line already promised "`check`
reports this column until it is renamed in the database" -- that
promise is now true, by `check`'s own new column-level inventory
(#707), not by rewording the sentence.

The omitted-index and omitted-check lines previously said the opposite
kind of wrong thing: "hejbro will not mention it again," which was
accurate before #707 and became false once `check`'s inventory started
naming those objects too. Both consequence sentences now read "`check`
keeps listing it as unmanaged until it is renamed in the database,"
matching the column line's own phrasing.

The brownfield corpus witness (`examples/brownfield`) proves this
end-to-end against a real database: the same `import` run's loss
report and the same run's `hejbro check` output are asserted together,
so a promise the loss report makes and `check`'s real behavior are
checked against each other, not separately.

