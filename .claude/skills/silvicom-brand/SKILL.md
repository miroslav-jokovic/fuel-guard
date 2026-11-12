---
name: silvicom-brand
description: "Silvicom, Inc.'s brand for anything a driver or customer sees: recruiting ads (Meta stills, the overlay renderer, art-director prompts), job posts, the apply page. Palette, typefaces, logo rules, truck photography and the list of generic-AI devices that are banned. Read before designing or judging any ad, and before changing apps/api/src/modules/ads/creative/overlay/."
---

# Silvicom brand

Silvicom, Inc. — USDOT 1864495, 1301 W Armitage Ave, Melrose Park, IL (Chicago). A truckload carrier
with a strong hazmat focus, running dry van and reefer in all 48 states, on Freightliner Cascadia and
International LT tractors. Source: silvicominc.com and the fleet photo shoot of 2026-01 on it.

Silvicom 360 (this repo's product) has its own navy logo; that is the SOFTWARE's mark. Ads carry the
CARRIER's mark below, never the Silvicom 360 one.

## Colour — taken from the logo and the trucks, not chosen

| Token | Hex | Where it comes from | Used for |
|---|---|---|---|
| Navy | `#0A2144` | the wordmark (measured from the logo file) | the brand field; text on cyan |
| Cyan | `#00B2E3` | the "silvicom" decal on the trailers and cab doors | the second field; the pay figure on navy |
| White | `#FFFFFF` | the fleet is white | text on navy; the trucks |
| Steel | `#8C8784` | the truck drawn in the logo | the logo's truck only |

Rules:
- Two brand colours plus white. Never a third accent, never orange, green or mustard.
- A colour is a **solid flat field**. No gradients, fades, glows, scrims that read as a fade, or
  transparency over the photo.
- Navy field: white text, the figure in cyan. Cyan field: navy text only (white on cyan fails contrast).
- Never grey text on a colour field.

## Type

- **Big Shoulders Display** (OFL, Google Fonts). Designed for the City of Chicago, where Silvicom is
  based. Headline in Black (900) or ExtraBold (800), ALL CAPS, set tight, leading 0.88–0.92.
- **Big Shoulders Text** (same family) Medium (500) for the one supporting line, sentence case.
- Two weights per ad. Headline at least 3× the supporting line.
- Not Inter, Geist, Space Grotesk, Poppins, Anton or Barlow in an ad.

## Logo

- The carrier wordmark with its truck: navy on light/cyan, the white version on navy or on a photo.
- Top-left, 8–12% of the canvas height in its clear-space box, once. Never centred, never repeated,
  never redrawn by the image model.

## Photography

- Current white Freightliner Cascadia or International LT tractors, dry van or reefer trailers, real
  US roads, yards and fuel islands. 2027 model year look. Natural light; golden hour, blue hour, after rain.
- The image model draws no text, logos, badges or decals (D-AD9). A manufacturer badge on the grille is
  a foreign logo to the checker: prompt for a badge-free grille.
- People, when shown, look like the drivers we hire: no age- or sex-coded casting (EEOC).

## Layout

- One message per ad: a headline of 3–6 words, at most one supporting line.
- Text covers at most about a fifth of the ad. Detail goes in the post text, not the picture.
- No call-to-action button in the picture: Meta's own "Apply now" button is the action.
- Separate things with space and size, never with lines.
- The equal-opportunity line is the only small print.

## Banned (each is a generic-AI tell)

Dots or bullets as ornament, divider lines and hairlines, kicker labels in tracked small caps above the
headline, pills, chips and badges, glass or blurred panels, gradient fades over the photo, gradient
text, glow, drop shadows on text, arrows and chevrons as decoration, rounded "card" panels, emoji,
one font family for everything at one weight, buzzword copy ("unlock", "elevate", "journey").

## Checking work

Render the ad, then judge it against this file and with the `impeccable` skill's critique. Any banned
device present is a fail, whatever else is good.
