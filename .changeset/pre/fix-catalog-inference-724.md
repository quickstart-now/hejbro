---
"hejbro": patch
---

`import`/`pull`'s loss report no longer announces an approximation for
a UNIQUE constraint or a `nextval` default that its own report already
says was omitted for its name. A UNIQUE constraint whose catalog name
isn't a valid hejbro identifier, or a column of that same kind holding
a `nextval` default, now gets only its omission line -- an ordinary
UNIQUE constraint or `nextval` default elsewhere on the same table is
still announced as before.
