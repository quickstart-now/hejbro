# Security Policy

## Supported versions

hejbro is pre-1.0 (`0.x`). Only the **latest published minor version** is
supported. There is no back-porting of fixes to older `0.x` releases —
upgrade to the latest minor to pick up a security fix.

## Reporting a vulnerability

Please report security vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/quickstart-now/hejbro/security/advisories/new),
rather than filing a public issue. This opens a private advisory visible
only to the maintainer and you, so a fix can land before the details are
public.

Please include:

- The affected package (`@hejbro/core`, `hejbro`, or `@hejbro/supabase`)
  and version.
- Steps to reproduce, or a minimal example declaration/generated SQL that
  shows the issue.
- The impact you'd expect (e.g. arbitrary SQL generation, a privilege
  escalation path in generated RLS/grants, a supply-chain concern in the
  release pipeline).

## What to expect

- We aim to acknowledge reports promptly.
- A plan for a fix, or a request for more information, following that
  acknowledgement. Timeline depends on severity and complexity, but you
  will hear back rather than the report going silent.
- Credit in the advisory and release notes, if you'd like it, once a fix
  ships.
