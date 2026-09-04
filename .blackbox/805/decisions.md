# Decisions — quickstart-now/hejbro#805

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — The bot avatar must not show a square photo floating in a white badge circle

_owner · 2026-09-04T08:25Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#46_

"Seeing it like this looks cheap — in the avatar circle there is just a white disc with the photo floating in it." (with a screenshot of the App's Display information page: a square photo inside the white badge circle)

The owner then uploaded the circle-masked PNG the lead prepared and sent a second screenshot ("this is how it comes out"): the badge preview still shows the cat small inside a white ring, because GitHub scales the logo inside the badge and fills the rest with the badge background color (#ffffff). Remedy proposed to the owner: badge background color sampled from the image (App #a78769, org #b09378). To be finished after 0.2.0-pre.1 ships (D in #412).

