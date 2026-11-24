# Operations dashboard design audit

Date: 2026-10-15

## Scope

- Audited surface: the authenticated Operations tab at `https://360.silvicominc.com/?tab=ops`, backed by `origin/main`.
- Reference surface: the adjacent Fleet overview tab at `?tab=fleet`.
- Primary user: a fleet manager or administrator responsible for whether the fleet can operate today.
- Primary task: understand what is ready, what needs action now, and open the exact queue behind a count.
- Constraints: preserve Silvicom 360 brand tokens, Vue/Tailwind/component stack, permission-aware cards, dark/light themes, and one-click filtered drill-downs; WCAG AA minimum.
- Explicit secondary scope: replace action/navigation text arrows with the existing curated icon vocabulary without changing arrows that express data transformation or a from/to relationship.

## Inputs

- Live authenticated desktop screenshots and accessibility trees for Operations and Fleet overview at 2482 x 1367.
- Source on local `origin/main` (the checked-out feature branch predates Operations).
- Existing Fleet overview v3 layout and shared dashboard primitives.

## Limits

- Desktop dark mode was inspected live; mobile was source-reviewed but not rendered.
- Runtime weight is build/source-derived rather than a production DevTools trace.

