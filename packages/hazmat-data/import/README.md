# `@hazmat/data` maintenance scripts (Node-only, not part of the published surface)

These scripts build a new versioned dataset JSON from the primary source (eCFR) and a licensed second
source (D5), diff it against the prior release, and require human review before publish (D9). Excluded
from the package `files` allow-list and from `tsconfig` so nothing here can leak into a bundle.

Populated in Phase H1.
