# Decisions — quickstart-now/hejbro#570

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-31T00:00Z_

1. "Add a work item to #282: change the license to the Apache License."
   (2026-08-31, in session) — filed as #570 with the measured inventory,
   defaults, and sequencing.
2. "Sorry — first explain the difference between MIT and Apache."
   — answered with the six practical differences (patent grant and
   retaliation, contribution terms in §5, NOTICE and modification
   notices, trademark, GPLv2 incompatibility, length), the project-side
   considerations, the dual-license alternative, and one measured fact:
   every commit on dev has a single human author, so relicensing needs
   no third-party consent.
3. "Let's go with Apache. Proceed with #570 as filed."
4. "But if I am on Apache and Drizzle is Apache too — is it actually
   fine for me to build an ORM with AI?" — answered in three layers,
   with a measurement first: the shipped source (`packages/*/src`)
   carries no Drizzle code, dependency, or third-party license header;
   the seven mentions of the name are design comments about mirroring an
   option's shape (`mode: 'bigint' | 'number'`) or recording a deliberate
   difference (`$type<T>()`). Layer one: licenses govern copying code,
   not building a tool in the same category, and API shape is not
   protected (Google v. Oracle); with both projects on Apache-2.0 even
   the compatibility question is moot, and the attribution duties would
   arise only if code were actually copied. Layer two: AI output has two
   distinct risks — memorized training data (rare for ordinary code, and
   lowered structurally by spec-first work: red test from a delta,
   implementation, review, mutation) and copyrightability (the US
   Copyright Office and Korea's guidance protect the human-directed
   parts; the decision log and this directory are the record of that
   direction); Anthropic's commercial terms assign output rights to the
   customer, with plan-dependent indemnity the owner should confirm.
   Layer three: do not use the Drizzle name or marks in hejbro's own
   branding, and if a specific algorithm is ever knowingly ported from an
   Apache project it becomes a derivative — keep its headers and NOTICE
   and log the decision. Not legal advice; a lawyer's pass is sensible
   once commercial exposure grows. Nothing in the current structure is
   blocked.
5. "Did you review the license blackbox entry too?" — the one-shot
   reviewer had verified only its pins (28/28); the body had not been
   read against the conventions by anyone but its author. This section
   and the two fixes around it (inputs 4–5 added under the
   non-summarized rule; the pin note corrected from "single commit" to
   per-commit) are the result of that question.

