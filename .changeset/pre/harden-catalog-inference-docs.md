---
"hejbro": patch
---

`hejbro import`/`pull`'s brownfield-adoption reference now names three
losses its loss report already made: an enum type whose own name is
not a valid hejbro SQL identifier is omitted along with every column
typed by it; a primary key whose own catalog constraint name is not
the one the DSL derives is approximated under the derived name; and a
foreign key at a column omitted for its own name, or for the enum type
that typed it, is itself omitted and named on its own line (one line
even when both of its columns were lost at once). The roles sentence
now says grants and policies name a role, not grants alone, and the
reference notes that a dropped primary-key name's own finding prints
to stderr while its inventory line prints to stdout.
