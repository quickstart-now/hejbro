---
"@hejbro/core": patch
---

`defineFunction`/`defineTrigger`'s reserved-name check now also refuses
Postgres's category-C column-name keywords (`int`, `row`, `values`,
`time`, `json`, `out`, `trim`, and the rest of the category) as a body
local, in every position a body renders one — an argument, a
`ctx.forEach` loop's record name, or a `ctx.row`/`ctx.rowOrNull` read's
derived scalar. Postgres accepts most of these in a loop or a
row-declared local; hejbro refuses them there too, since the
reserved-name refusal is uniform (#832).

A `ctx.forEach` loop's record name and a `ctx.row`/`ctx.rowOrNull`
read's own name now take the same hejbro-SQL-name check
(`invalid-sql-name`) an argument key's derived name already does, before
any duplicate check — a loop or row name with a hyphen, an upper-case
letter, a leading digit or a non-ASCII letter is refused at declaration
time instead of reaching Postgres unquoted (#817).

A loop's record name or a row read's derived scalar that carries an
already-declared argument's name is now refused with
`duplicate-local-name`, naming the argument it would shadow — previously
the loop or row variable silently won, and the argument was unreachable
for the rest of the body (#816). Two loops, or a loop and a row read,
sharing one name are refused the same way, naming both constructs.

`duplicate-column` now names both colliding TypeScript keys and their
shared derived SQL name, the same way `duplicate-argument` already does,
instead of naming only the derived name (#818).
