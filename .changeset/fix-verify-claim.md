---
"hejbro": patch
---

`verify`'s documented contract now says what its hashes cover: the
declaration snapshot before and after each migration, never a file's SQL
body. A hand-edited banner line, a hand-edited snapshot, or a missing or
reordered file is still reported; a body edit that leaves the banner
lines intact passes `verify`, and the requirement and the renames guide
now say so instead of implying the opposite. No behaviour changes.
