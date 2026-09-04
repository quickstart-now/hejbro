---
"hejbro": patch
---

`hejbro init` now refuses, with a coded diagnostic instead of a raw filesystem crash or a silent partial run: a configured migrations directory or snapshot path spelled with a trailing separator that holds a file, a file sitting in a configured artifact's own ancestor directory chain, two configured fields that resolve to the same path, and a directory sitting where `hejbro.config.ts` itself belongs. The name-keyed vendored client (`createDb`) also now refuses a table or function lookup by an inherited `Object.prototype` name (`__proto__`, `hasOwnProperty`, ...) the contract doesn't actually vendor, instead of silently resolving to `Object.prototype` and throwing an uncoded error on the call.
