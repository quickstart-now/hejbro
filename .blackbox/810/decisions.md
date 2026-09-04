# Decisions — quickstart-now/hejbro#810

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — The ci-approval step must be reachable from the PR, not hidden on the run page

_owner · 2026-09-04T09:27Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#88_

"I could not see `ci-approval` anywhere. When I press 'Approve and run', something like a comment with a button that starts the ci-approval step should appear."

Read by the lead as: the approval must be reachable from the PR itself. GitHub offers no button in a comment, so the closest thing is a comment with the direct link to the waiting run's review banner plus the terminal one-liner, kept current as the head moves.

