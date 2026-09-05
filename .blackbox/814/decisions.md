# Decisions — quickstart-now/hejbro#814

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — A pre-mode publish passes --tag pre; the change is owner-gated and PR #893 waits for the owner

_lead · interpretation · basis run 33868831782 (four young packages landed on latest); OIDC trusted publishing leaves no credential for a post-publish dist-tag step; changesets' own pre-mode tagging for packages with a stable history · 2026-09-05T06:31Z · ratified: pending_

Fix at publish time (`changeset publish --tag pre` while .changeset/pre.json exists) rather than a post-publish dist-tag step that cannot authenticate. Open question for the owner, stated in the PR: whether npm creates `latest` on a package's first publish under --tag pre. The manual repair stays the checklist fallback until the owner merges. Ratification: owner (release gate).

