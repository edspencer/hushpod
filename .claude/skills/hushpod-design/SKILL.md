---
name: hushpod-design
description: HushPod's visual design system — "warm editorial". READ THIS BEFORE building or changing any UI (components, pages, colors, type, layout). It defines the identity that keeps the app from looking like generic AI-generated output. Tokens give exact values; the prose tells you why and how to apply them.
---

# HushPod Design System — Warm Editorial

> Tokens give you exact values. The prose tells you why those values exist and how to apply them. When in doubt, follow the prose.

Source of truth for the actual values: `src/client/index.css` (`@theme` + `.dark`). This doc explains and constrains how to use them. Tailwind v4: design tokens are CSS variables in `@theme`; every color is a semantic utility (`bg-bg`, `text-fg`, `bg-surface`, `border-border`, `text-brand-400`, `bg-danger`…). **Never hardcode hex in components — always use the token utilities** so light/dark and future re-skins keep working.

## 1. Overview

HushPod is a calm, self-hosted reading-room for your podcasts. The feel is **printed magazine, not SaaS dashboard**: warm paper, ink, a single confident terracotta accent, and an expressive serif for headlines. Light "paper" is the default; dark is a warm "espresso", never cold black.

Adjectives: warm, editorial, considered, quiet, tactile. **Not**: techy, neon, corporate, purple, glassy.

## 2. Colors

A dominant warm-neutral canvas + one sharp accent (≈ 60/30/10). Earthy semantics live inside that world. Tokens (light → dark):

| Token                               | Light                        | Dark               | Use                                            |
| ----------------------------------- | ---------------------------- | ------------------ | ---------------------------------------------- |
| `bg`                                | `#faf6ee` paper              | `#17130f` espresso | app canvas                                     |
| `surface`                           | `#fffdf8`                    | `#1f1a15`          | cards, raised panels                           |
| `surface-2`                         | `#f1eadc`                    | `#29221b`          | insets, tracks, hover fills                    |
| `border`                            | `#e6ddcc`                    | `#382f26`          | hairlines, dividers                            |
| `muted`                             | `#786d5b`                    | `#a59a86`          | secondary text, meta                           |
| `fg`                                | `#232019` warm ink           | `#f1e9da` cream    | primary text                                   |
| `brand-500`                         | `#bd5836` terracotta         | (same)             | primary actions, accents                       |
| `brand-400`/`300`                   | dark terracotta              | lifted terracotta  | **link/accent text** (mode-tuned for contrast) |
| `success`/`warning`/`danger`/`info` | olive / ochre / brick / teal | lifted variants    | status + ad labels                             |

Rules:

- **Refined ink, never `#000`.** `fg` is a warm near-black. Pure black/white are banned.
- **One accent.** Terracotta (`brand-*`) is the only chromatic brand color. Don't introduce blues/purples/extra accents for decoration.
- **Earthy semantics.** Ad-label + status colors map to: ad→`danger` (brick), promo→`warning` (ochre), intro→`info` (teal), outro→`brand-400` (terracotta), content→warm stone. Keep this mapping.
- **Contrast.** Body/UI text ≥ 4.5:1; large/secondary ≥ 3:1. Accent _text_ uses `brand-300/400` (these are tuned per-mode); accent _fills_ (buttons) use `brand-500/600` with cream/white text.

## 3. Typography

Three self-hosted families (Fontsource, offline-friendly — do **not** add Google-CDN font links):

- **Display — Fraunces Variable** (`font-display`): all headings (`h1–h4` get it automatically) and any expressive number/stat. Soft, optical, editorial. Tight tracking (`-0.015em`).
- **Text — Hanken Grotesk Variable** (`font-sans`, the default): body, labels, tables, controls. Warm, legible, not Inter.
- **Numerals — JetBrains Mono Variable** (`font-mono`): timestamps, durations, byte sizes (use `tabular-nums`).

**Banned fonts (the "AI-slop" tells): Inter, Roboto, Open Sans, Lato, Space Grotesk, system-ui as a brand choice.** Headlines should feel set, not typed — lean on Fraunces with size + weight contrast rather than many weights.

## 4. Layout

- Content column maxes at `max-w-6xl`, generous gutters (`px-4`), vertical rhythm in `space-y-6`.
- Whitespace is a feature — let the paper breathe; don't fill every pixel.
- Information-dense where it must be (episode rows, tables), airy everywhere else.

## 5. Elevation & Depth

Quiet depth. Prefer **surface contrast over borders and over heavy shadows**: a `surface` card on `bg`, or `surface-2` inset, reads as separation. Shadows are subtle (`shadow-sm`), warm, never the default cold blue glow. No glassmorphism.

## 6. Shapes

Rounded but not pill-everything: `rounded-md`/`rounded-lg` for cards and controls, full-round only for the play button and small dots/badges. Consistent radius across a view.

## 7. Components

- **Buttons** — primary = solid terracotta (`brand-500/600`) + cream text; secondary/outline = `border` on `surface`; ghost for tertiary. One primary action per view.
- **Cards** — `surface` + hairline `border`, `rounded-lg`, modest padding. Titles in Fraunces.
- **Badges / status** — use the earthy semantic tints (`bg-danger/15 text-danger` etc.). Keep the ad-label color mapping.
- **Tables / episode rows** — quiet hairlines, hover = `surface-2`; the whole row is the link.
- **Timelines / charts** — earthy label palette; content = warm stone. Color carries meaning, not decoration.
- **Motion** — restrained: short transitions on hover/active; at most one orchestrated, staggered reveal on a page load. No bouncing, no parallax.

## 8. Do's and Don'ts

**Do**

- Use semantic token utilities everywhere; let light/dark flow from `@theme` + `.dark`.
- Set headlines in Fraunces; keep one terracotta accent; prefer surface contrast to borders/shadows.
- Keep numerals in JetBrains Mono with `tabular-nums`.

**Don't**

- Don't hardcode hex in components. Don't add a second accent color or any purple/indigo/blue brand.
- Don't use Inter/Roboto/system as a brand font, or pure `#000`/`#fff`.
- Don't reach for gradients-on-white, glassmorphism, neon, or heavy drop shadows.

## Responsive & a11y

- Mobile-first; episode rows/cards collapse gracefully; touch targets ≥ 40px.
- Visible focus rings (`focus-visible:ring-brand-500`), labeled controls, semantic `button` vs `a`. (Consider pairing with Vercel's `web-design-guidelines` skill for an a11y/correctness audit.)

## Working notes for the agent

- The whole theme is token-driven, so a re-skin = edit `@theme`/`.dark` in `index.css`, not the components.
- Fonts are bundled via `@fontsource-variable/*` imported in `main.tsx` — keep it that way (self-hosted, works offline).
- After a visual change, build and look at it; verify both light and dark, and check text contrast on the warm backgrounds.
