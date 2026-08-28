---
"@hejbro/core": patch
---

`generateMigration` now expands a raw `TableDeclaration` input exactly like a whole `Table`: its RLS block, policies, and serial sequences are emitted, and an `existingTable` declaration is rejected — previously the raw form silently dropped all three.
