# Silvicom 360 Brand System — 2026 Direction

Status: design foundation for review; not a final logo redesign.

This document replaces the assumptions in the first Illustrator boards. The existing Silvicom 360 artwork is the identity source. The work now is to build a modern, production-safe system around it for the dashboard, product marketing, and the automated advertising platform.

## 1. The two-brand architecture

Silvicom 360 operates two related but different visual layers. They must not be collapsed into one logo sheet.

| Layer | Owner | Where it appears | Identity rule |
|---|---|---|---|
| Platform brand | Silvicom 360 | Dashboard, driver app, sign-in, product marketing, sales material, system messages | Use the existing Silvicom 360 logo family and the product design tokens. |
| Campaign brand | The advertising carrier | Generated recruiting ads, job posts, application landing pages, campaign motion | Use the selected carrier brand kit. Silvicom 360 is the system producing the ad, not automatically the advertiser shown inside it. |

For the current reference carrier, Silvicom, Inc., the ad palette is measured from its carrier wordmark and fleet: navy `#0A2144`, cyan `#00B2E3`, white `#FFFFFF`, and steel `#8C8784` only inside the carrier logo. These are not a replacement palette for the Silvicom 360 dashboard.

## 2. Identity source of truth

The following existing vector files are canonical inputs and must be refined/exported, not redrawn from memory:

- `apps/web/public/SilvicomLogo360.svg` — horizontal S + 360 lockup.
- `apps/web/public/SilvicomLogoText.svg` — full Silvicom 360 wordmark.
- `apps/web/public/SilvicomLogoS.svg` — compact S360 mark.

The existing product navy is present in the artwork as approximately `#18274D`; the full wordmark also contains the established deep violet/navy around `#1E1D45` and neutral steel. These values are identity evidence, not permission to invent unrelated accent colors.

Required logo production set:

1. Primary horizontal lockup.
2. Full wordmark lockup.
3. Compact S360 app mark.
4. One-color dark version.
5. One-color white/reversed version.
6. Small-size optical version with simplified internal detail.
7. Social avatar and app-icon crops with documented safe area.
8. SVG, PDF, EPS, transparent PNG, and optimized WebP exports with deterministic names.

Every version must be derived from the existing paths, tested at small size, and have explicit clear-space and minimum-size rules.

## 3. Modernization principle

The 2026 direction is not “add trendy decoration.” It is a more human, specific, and operationally consistent identity:

- Preserve the recognizable Silvicom 360 marks.
- Reduce visual noise around the marks.
- Use stronger editorial hierarchy and fewer simultaneous styles.
- Use real fleet, driver, yard, and road photography rather than generic logistics imagery.
- Use motion and texture through photography, not gradients, glow, glass, pills, or decorative AI artifacts.
- Make every creative rule machine-readable enough for automated generation and checking.

Adobe's 2026 creative research emphasizes human connection, emotional specificity, sensory depth, and authentic local context. For Silvicom 360, the useful interpretation is real Chicago and American trucking environments, real work, real equipment, and honest human moments. Surreal or novelty-first treatments are not appropriate for safety, compliance, or recruiting claims.

## 4. Platform brand layer

### Logo

Use the existing Silvicom 360 logo family. The modernization pass may correct path cleanup, spacing, optical alignment, small-size rendering, and export consistency. It may not silently replace the symbol or typography.

### Typography

- Product and dashboard: Hanken Grotesk, matching the live application.
- Product marketing display: Hanken Grotesk in a stronger editorial scale unless a later type study proves a companion face is needed.
- Data identifiers only: the existing monospaced system role.
- Do not introduce fashionable display fonts into the dashboard merely to make it feel “new.”

### Color behavior

- Treat the established logo navy as identity, not as every UI action or status.
- Keep dashboard colors semantic: surface, ink, action, focus, success, caution, danger, information, and data visualization remain separate roles.
- Do not recolor warnings, errors, charts, or focus states to match a marketing accent.
- Light and dark mode remain first-class outputs.
- Any new marketing accent must pass contrast, color-vision, and UI-role collision tests before adoption. No accent is approved by this document.

### Visual tone

Precise, calm, operational, and human. Silvicom 360 should feel like a serious fleet operating system with an informed point of view, not a generic SaaS template or a trucking flyer.

## 5. Automated advertising layer

The brand kit is an operational contract consumed by the advertising system. A PDF board alone is insufficient.

### Required carrier inputs

- Company name and phone.
- Primary and secondary carrier colors with named roles.
- Dark, light, and compact logo assets.
- Equipment-photo library labeled `truck`, `trailer`, `driver`, `yard`, and `road`.
- People policy and prohibited marks.
- Per-format overlay preferences.
- Approved claims, proof points, and legal footer.
- Language-specific copy limits.

### Supported creative canvases

- `1:1` — 1080 × 1080.
- `4:5` — 1080 × 1350.
- `9:16` — 1080 × 1920 for Stories/Reels and motion.

The existing renderer already protects 9:16 UI zones more aggressively than feed formats. That safe-zone behavior is part of the brand system and must be visible on the Illustrator template artboards.

### Creative grammar

The current renderer has three intentionally restrained looks. The brand kit should demonstrate these instead of inventing unrelated poster styles:

| Look | Purpose | Composition rule |
|---|---|---|
| Field | Clear information | Strong photograph paired with one solid carrier-color field. |
| Number | Pay or proof first | One oversized verified number, then minimal supporting language. |
| Photo | Human or equipment story | Full photograph with type placed only where measured contrast and subject separation allow it. |

One ad carries one message: a 3–6 word headline, no more than one supporting line, and only the required legal line. Meta supplies the CTA; the image should not contain a duplicate fake button.

### Silvicom, Inc. reference treatment

- Navy `#0A2144` as the primary solid field.
- Cyan `#00B2E3` only for a meaningful emphasis such as a verified pay figure or the second field.
- White for primary text on navy.
- Navy text on cyan; white text on cyan is not permitted.
- Big Shoulders Display Black/ExtraBold for recruiting headlines.
- Big Shoulders Text Medium for the one supporting line.
- Carrier logo once, normally top-left, at approximately 8–12% of canvas height including its clear-space box.

### Banned automated-ad artifacts

No decorative dots, hairlines, tracked kicker labels, pills, chips, fake CTA buttons, glass panels, blurred cards, gradient fades, gradient text, glow, text shadows, arrows, chevrons, generic rounded-card layouts, emoji, or unverified AI-rendered letters/logos.

## 6. Photography and motion direction

Photography is the primary modernizing device.

- Favor real white Freightliner Cascadia and International LT tractors, dry van/reefer trailers, US roads, yards, docks, and fuel islands.
- Use natural golden hour, blue hour, rain reflections, practical night light, and believable working environments.
- Compose for text before generation or selection: reserve clean negative space without weakening the truck or person as the subject.
- Avoid cinematic effects that make the fleet look fictitious, luxury-oriented, or unsafe.
- Do not allow image generation to draw company decals, legal text, manufacturer badges, or the logo.
- Show varied, credible drivers without age- or sex-coded casting.

Motion should be short and legible: one hook, one proof point, one brand close. Captions remain inside the 9:16 safe zone and do not compete with platform UI. Movement should come from camera push, parallax, light, road motion, or purposeful type timing—not ornamental transitions.

## 7. Illustrator master structure

The corrected master file should contain these artboards in this order:

1. `01 — Identity inventory` — the three canonical Silvicom 360 assets, path/spacing audit, no new concept logos.
2. `02 — Logo production set` — dark, reversed, compact, small-size, avatar, app icon.
3. `03 — Platform expression` — product marketing hierarchy and dashboard-compatible brand roles.
4. `04 — Campaign brand contract` — carrier logo/color/photo/legal inputs and how they differ from the platform brand.
5. `05 — Automated ad / Field` — 1:1, 4:5, and 9:16.
6. `06 — Automated ad / Number` — 1:1, 4:5, and 9:16.
7. `07 — Automated ad / Photo` — 1:1, 4:5, and 9:16.
8. `08 — Motion system` — caption zones, timing, logo close, and platform-UI exclusion zones.
9. `09 — Asset manifest` — filenames, sizes, formats, color roles, and version.

The Illustrator file is a production source. The machine-readable brand-kit record and renderer tests remain the enforcement layer.

## 8. Approval gates before visual production

The next visual round is acceptable only if all of these are true:

- It uses the existing Silvicom 360 logo artwork rather than a substitute.
- It clearly separates Silvicom 360 platform identity from carrier campaign identity.
- Every proposed color has a source and a defined role.
- Dashboard examples respect the live semantic token system.
- Ad examples map to Field, Number, or Photo and the actual renderer formats.
- 9:16 examples visibly respect platform safe zones.
- The work contains no generic-AI decorative devices.
- Photography feels specific to the carrier, equipment, region, and job.
- Every logo and ad asset has an export and automation purpose.

## 9. What is deliberately not decided yet

- No replacement Silvicom 360 logo has been approved.
- No new platform marketing accent has been approved.
- No dashboard token migration has been approved.
- No carrier logo should be substituted with the Silvicom 360 software logo in generated ads.
- No Illustrator concept is final until the two-brand architecture and the first three ad-system artboards are reviewed together.
