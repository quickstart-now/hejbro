---
"@hejbro/nile": patch
---

The Nile identity-column refusal's message no longer embeds a measurement
date and now states a way forward for a non-key counter column as well as
for a key. The package's Docker-gated integration suite re-measures all
four measured-only refusals (serial, tenant-less primary key, both
identity kinds) and the no-primary-key acceptance against the pinned
container image.
