# Slash Design System

The single source of truth for how Slash looks. Token, rule, and rationale
live together here. Every UI change derives from this file. If a choice is
not in here, add it here first, then build it. The live values mirror
`src/theme.css` (canonical tokens) and the locked identity in `SLASH.md`.

## 1. Visual theme and atmosphere

Slash is a **quiet, near-black instrument**. Calm and conventional. It looks
like a real browser (Chrome / Opera GX layout: tab strip, toolbar, bookmarks
bar, no left rail), not a novelty. The chrome recedes to near-black so the
web content carries the color. Warmth comes from one thing only: a soft
yellow accent, used rarely.

The single most important rule, the one that kills the generic "AI" look:
**borders-only depth, no elevation shadows, one restrained accent used
rarely.** The only `box-shadow` in the codebase is the focus ring
(`0 0 0 3px var(--accent-soft)`). Surfaces separate by a hairline border and
a small lightness step, never by a drop shadow.

## 2. Color palette and roles

Dark, near-monochrome. Near-black ink surfaces, light text, one yellow accent.

| Token | Value | Role |
| --- | --- | --- |
| `--titlebar` | `#141416` | OS title bar / deepest chrome |
| `--paper` | `#1c1c1f` | App canvas, window background |
| `--raised` | `#2a2a2e` | Panel / card surface |
| `--field` | `#2a2a2e` | Inputs (omnibox), same step as raised |
| `--raised-2` | `#34343a` | Hover / active fill |
| `--ink` | `#e8e8ec` | Primary text |
| `--muted` | `#9a9aa3` | Secondary text |
| `--faint` | `#6a6a72` | Placeholder / tertiary |
| `--border` | `rgba(255,255,255,0.08)` | Hairline divider at rest |
| `--border-strong` | `rgba(255,255,255,0.14)` | Input / overlay edge |
| `--accent` | `#f1cb53` | Soft yellow. Rare, one per screen. Themeable |
| `--accent-hover` | `#e0b63d` | Accent pressed |
| `--accent-soft` | `rgba(241,203,83,0.16)` | Focus ring, active tint |
| `--on-accent` | `#18181b` | Dark text on the accent |

**Accent is themeable at runtime.** The user's chosen accent is injected into
every chrome view via `webContents.insertCSS` (`applyAccent` /
`broadcastAccent` in `main.js`); `--accent-hover` and `--accent-soft` are
derived from it. The default lives in `lib/settings.js` (`#f1cb53`).

**Accent budget:** at most one accented element per screen state. Allowed
uses: focus ring, the active tab, the AI send button, the `/slash` cursor on
the hero, an active picker segment. Never accent body text, borders at rest,
or whole surfaces. The accent is always paired with `--on-accent` (dark)
text, never light text on yellow.

## 3. Typography

System sans for UI, Space Grotesk for the wordmark only, a system mono stack
for machine facts. No bundled UI face: the chrome should feel native.

- **Sans** (`--font-sans`: `Segoe UI`, `system-ui`): UI labels, body,
  buttons, chat text. The default face everywhere.
- **Brand** (`--font-brand`: `Grotesk` = bundled Space Grotesk): the `/slash`
  wordmark only. Never used for body or controls.
- **Mono** (`--font-mono`: `ui-monospace`, `Cascadia Code`, `Consolas`):
  URLs, the `CLI` / `API` tags, API-key fields, tiny uppercase labels. If it
  is a machine fact, it is mono.

Weights: 400 default, 500 emphasis, 600 headings, 700 for the wordmark only.

## 4. The mark

The wordmark is `/slash` with a **leading yellow slash** in Space Grotesk.
The `/` is the mark AND a real feature: it is the slash-command key (typing
`/` in the hero input flips it into Ask-AI mode). On the hero start page the
`/` reads as a **blinking yellow cursor**. The app icon is a yellow rounded
tile with a dark `/` (`src/icon.png`, regenerated from `mockups/icon.html`).

## 5. Components and states

Every interactive element defines: default, hover, active, focus-visible,
disabled.

- **Button (icon):** square, `--radius`, transparent, `--raised-2` on hover.
  Ink-colored glyph.
- **Button (primary, e.g. AI send):** accent bg, `--on-accent` text,
  `--accent-hover` pressed, `--radius`.
- **Input / omnibox:** `--field` bg, 1px `--border`, `--radius`, mono URL
  text. Focus = `--border-strong`/accent border + the 3px `--accent-soft`
  ring.
- **Tab:** active tab carries the accent marker; inactive tabs are quiet.
  `role="tab"` in a `role="tablist"` strip.
- **Chip / tag (CLI / API):** mono 11px uppercase, `--raised-2` bg,
  `--radius-sm`.
- **Overlay (menu, popover, find bar):** `--raised`/`--field` bg, 1px
  `--border-strong`. Separated by border, not shadow.

Focus is always visible (`:focus-visible`, 2px accent outline), never
removed.

## 6. Layout and spacing

Strict 4px grid. Allowed steps: 4, 8, 12, 16, 24, 32, 48. Live chrome
constants (`main.js`):

- Tab strip height **38**, toolbar **56**, bookmarks bar **34** (chrome total
  128).
- AI panel width **400** (never exceeds 50% of the window).
- Find bar width **360**, docked top-right under the chrome.

Generous negative space on the hero; tighter density in the chrome and the AI
panel.

## 7. Depth and elevation

**Borders-only.** No elevation `box-shadow` anywhere. Surfaces are
distinguished by a 1px hairline (`--border` / `--border-strong`) and a small
lightness step (`titlebar` -> `paper` -> `raised`). This is the core
anti-generic decision; do not reintroduce drop shadows. The single permitted
`box-shadow` is the focus ring, and it is the accent-soft tint, not a
grey blur.

## 8. Do and do not

Do:
- Reuse the exact tokens. Same radius, same border, same spacing, everywhere.
- Keep one depth strategy (borders) and one accent, used rarely.
- Use mono for machine facts, system sans for human words.
- Match real browser references (Chrome, Opera GX). Build from references,
  not from adjectives.

Do not:
- No elevation drop shadows. No gradients (the one faint radial yellow wash +
  vertical dark gradient behind the hero wordmark is the only exception). No
  fat pills (`border-radius` over `--radius-lg` 12px on controls).
- No second accent hue. No pure black (`#000`) or pure white (`#fff`).
- No left rail / vertical sidebar (a rejected direction).
- No bundled UI sans (system font for chrome); Space Grotesk is the wordmark
  only.

## 9. Radius scale

`--radius` 8px (default controls, inputs, buttons), `--radius-sm` 6px (chips,
tags), `--radius-lg` 12px (large cards / panels). Nothing rounder than 12px.

## 10. Responsive

Single desktop window. The AI panel never exceeds 50% width
(`Math.min(AI_WIDTH, width * 0.5)` in `main.js`). Toolbar items collapse into
an overflow before wrapping.

## 11. Agent prompt guide

When building UI, state the choice before the code: which token, which state,
which spacing step. Specific beats vague ("border, not shadow"; "`--radius`
8px"; "accent only on the send button"). Verify against sections 2, 5, and 7
before claiming done. Mockup-first: build HTML/CSS in `mockups/`, render to
PNG with headless Edge, show EJ the pixels. No AI image generation for UI.
