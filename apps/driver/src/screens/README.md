# `src/screens/`

Composition that belongs to ONE screen and reaches across features.

A tab like Today is not a feature: it has no data of its own, and its entire job is to arrange
duty, loads, notifications, messages, score and sync into the order that suits the driver's current
situation. Put that under `src/features/today/` and it immediately violates the rule that a feature
may not import a sibling's internals (`lint:boundaries`) — correctly, because a feature that needs
five siblings is not a feature.

The gate's own note says the fix for a cross-feature import is to PROMOTE the shared thing out of
`features/`, never to allow-list the leak. For a composer, promotion means moving the composer:
`src/features/*` own their data and rules; `src/screens/*` arrange them; routes under `app/` stay
thin. Anything genuinely shared between two features still goes to `src/session`, `src/lib`,
`src/data` or `src/components` as before.
