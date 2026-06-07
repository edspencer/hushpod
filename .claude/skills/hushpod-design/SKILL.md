---
name: hushpod-design
description: HushPod's visual design system — "newspaper" (red / white / blue editorial). READ THIS BEFORE building or changing any UI (components, pages, colors, type, layout). It defines the identity that keeps the app from looking like generic AI-generated output. Tokens give exact values; the prose tells you why and how to apply them.
---

# HushPod Design System — Red / White / Blue Editorial

> Tokens give you exact values. The prose tells you why those values exist and how to apply them. When in doubt, follow the prose.

Source of truth for the actual values: `src/client/index.css` (`@theme` + `.dark`). This doc explains and constrains how to use them. Tailwind v4: design tokens are CSS variables in `@theme`; every color is a semantic utility (`bg-bg`, `text-fg`, `bg-surface`, `border-border`, `text-brand-400`, `bg-danger`…). **Never hardcode hex in components — always use the token utilities** so light/dark and future re-skins keep working.

## 1. Overview

HushPod reads like a **broadsheet newspaper**: a crisp white page, deep-navy ink, an expressive serif for headlines, and a two-color accent system — **navy blue** (primary) with **flag red** (highlight). Light "paper" is the default; dark is a deep **navy**, never cold black.

Adjectives: editorial, crisp, civic, considered. **Not**: techy, neon, gradient-y, purple/indigo "AI default", glassy.

## 2. Colors

A clean white/navy canvas with **two** accents — navy blue carries the brand, flag red highlights. Earthy-but-saturated semantics round it out. Tokens (light → dark):

| Token                      | Light               | Dark           | Use                                            |
| -------------------------- | ------------------- | -------------- | ---------------------------------------------- |
| `bg`                       | `#f7f8fa` white     | `#0b1626` navy | app canvas                                     |
| `surface`                  | `#ffffff`           | `#122138`      | cards, raised panels                           |
| `surface-2`                | `#eef1f6`           | `#1a2c47`      | insets, tracks, hover fills                    |
| `border`                   | `#d8dee7`           | `#28395a`      | hairlines, dividers                            |
| `muted`                    | `#5a6678`           | `#94a4bd`      | secondary text, meta                           |
| `fg`                       | `#0f1b2e` navy ink  | `#eef3fb`      | primary text                                   |
| `brand-500`                | `#1e4488` navy blue | lifted         | primary actions, links, accents                |
| `brand-400`/`300`          | navy blue           | lifted blue    | **link/accent text** (mode-tuned for contrast) |
| `danger`                   | `#c8102e` flag red  | `#e85d70`      | the red accent: ad label, errors, "removed"    |
| `success`/`warning`/`info` | green / gold / teal | lifted         | status + ad labels                             |

Rules:

- **Two accents, no more.** Navy `brand-*` (blue) is primary; `danger` (flag red) is the highlight. Don't add a third chromatic accent, and never reintroduce purple/indigo.
- **Refined ink, never `#000`/`#fff`.** `fg` is a deep navy; the canvas is an off-white.
- **Semantic mapping (keep it):** ad→`danger` (red), promo→`warning` (gold), intro→`info` (teal), outro→`brand` (blue), content→warm stone. This is what makes the ad timeline read red/white/blue.
- **Contrast.** Body/UI text ≥ 4.5:1; large/secondary ≥ 3:1. Accent _text_ uses `brand-300/400` and `danger` (tuned per-mode); accent _fills_ (buttons) use `brand-500/600` with white text.

## 3. Typography

Four self-hosted families (Fontsource, offline-friendly — do **not** add Google-CDN font links):

- **Display — Fraunces Variable** (`font-display`): all headings (`h1–h4` get it automatically) + expressive stats. Tight tracking (`-0.015em`).
- **Reading — Newsreader Variable** (`font-serif`): long-form prose — episode descriptions, transcripts, show blurbs. Set with `font-serif text-[15px] leading-7`. This is what makes it feel like a printed page.
- **Text/UI — Hanken Grotesk Variable** (`font-sans`, the default): labels, tables, controls, nav.
- **Numerals — JetBrains Mono Variable** (`font-mono`): timestamps, durations, sizes (with `tabular-nums`).

**Banned fonts (the "AI-slop" tells): Inter, Roboto, Open Sans, Lato, Space Grotesk, system-ui as a brand choice.** Headlines should feel set, not typed.

## 4. Layout

- Content column maxes at `max-w-6xl`, generous gutters (`px-4`), vertical rhythm in `space-y-6`.
- Whitespace is a feature — let the page breathe; don't fill every pixel.
- Dense where it must be (episode rows, tables), airy everywhere else.

## 5. Elevation & Depth

Quiet depth. Prefer **surface contrast over borders and over heavy shadows**: a white `surface` card on the off-white `bg`, or `surface-2` inset, reads as separation. Shadows are subtle (`shadow-sm`), never a cold blue glow. No glassmorphism.

## 6. Shapes

Rounded but not pill-everything: `rounded-md`/`rounded-lg` for cards and controls, full-round only for the play button and small dots/badges. Consistent radius across a view.

## 7. Components

- **Buttons** — primary = solid navy (`brand-500/600`) + white text; secondary/outline = `border` on `surface`; ghost for tertiary. One primary action per view.
- **Cards** — `surface` + hairline `border`, `rounded-lg`, modest padding. Titles in Fraunces.
- **Badges / status** — earthy-saturated semantic tints (`bg-danger/15 text-danger` etc.). Keep the ad-label color mapping.
- **Long-form** — descriptions/transcripts in `font-serif` (Newsreader), clamped with a measured "Show more".
- **Tables / episode rows** — quiet hairlines, hover = `surface-2`; the whole row is the link.
- **Timelines / charts** — the semantic palette (red/gold/teal/blue); content = warm stone. Color carries meaning, not decoration.
- **Motion** — restrained: short transitions on hover/active; at most one orchestrated, staggered reveal on a page load. No bouncing/parallax.

## 8. Do's and Don'ts

**Do**

- Use semantic token utilities everywhere; let light/dark flow from `@theme` + `.dark`.
- Set headlines in Fraunces, long-form in Newsreader; keep the two-accent (navy + red) system; prefer surface contrast to borders/shadows.
- Keep numerals in JetBrains Mono with `tabular-nums`.

**Don't**

- Don't hardcode hex in components. Don't add a third accent color, and never revert to a purple/indigo default.
- Don't use Inter/Roboto/system as a brand font, or pure `#000`/`#fff`.
- Don't reach for gradients-on-white, glassmorphism, neon, or heavy drop shadows.

## Responsive & a11y

- Mobile-first; episode rows/cards collapse gracefully; touch targets ≥ 40px.
- Visible focus rings (`focus-visible:ring-brand-500`), labeled controls, semantic `button` vs `a`. (Consider pairing with Vercel's `web-design-guidelines` skill for an a11y/correctness audit.)

## Working notes for the agent

- The whole theme is token-driven, so a re-skin = edit `@theme`/`.dark` in `index.css`, not the components.
- Fonts are bundled via `@fontsource-variable/*` imported in `main.tsx` — keep it that way (self-hosted, works offline).
- After a visual change, build and look at it; verify both light and dark, and check text contrast on both backgrounds.
