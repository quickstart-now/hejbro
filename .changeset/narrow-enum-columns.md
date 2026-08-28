---
"@hejbro/core": patch
---

Enum columns type as their declared values. `pgEnum` is now generic over
its values, so `pgEnum(app, "post_status", ["draft", "published"]).
column()` reads back as `"draft" | "published"` and accepts only those
literals as a write — previously it typed as bare `string` in both
directions, and an undeclared value compiled and failed at the database
(#422).
