# Loom Design System

The single source of truth for how Loom looks. Token, rule, and rationale
live together here. Every UI change derives from this file. If a choice is
not in here, add it here first, then build it.

## 1. Visual theme and atmosphere

Loom is a **precise, warm instrument**. Calm, technical, and quiet. It
recedes so the web can breathe. The reference cluster is Raycast, Warp,
Linear, and Vercel/Geist: developer-grade tools that are beautiful without
shouting. Warmth lives in the paper and the greys; precision lives in the
monospace details. Nothing is loud.

The single most important rule, the one that kills the generic "AI" look:
**borders-only depth, no drop shadows, one restrained accent used rarely.**

## 2. Color palette and roles

Warm-neutral, near-monochrome, light. Ink on warm paper does the work.

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#faf9f5` | App canvas |
| `--field` | `#fffdf9` | Inputs and raised cards |
| `--raised` | `#f3f1eb` | Panel surface |
| `--raised-2` | `#eae7df` | Hover / active fill |
| `--ink` | `#262420` | Primary text |
| `--muted` | `#6b675e` | Secondary text |
| `--faint` | `#9c978b` | Placeholder / tertiary |
| `--border` | `#e6e3d9` | Hairline divider |
| `--border-strong` | `#d7d3c7` | Input / overlay edge |
| `--accent` | `#a8734f` | Muted clay. Rare, one per screen |
| `--accent-hover` | `#946239` | Accent pressed |
| `--accent-soft` | `rgba(168,115,79,0.12)` | Focus tint, active fill |
| `--on-accent` | `#fbfaf6` | Text on accent |

**Accent budget:** at most one accented element per screen state. Allowed
uses: focus ring, the active tab, the send button, an active picker
segment. Never accent body text, borders at rest, or whole surfaces.

## 3. Typography

Bundled IBM Plex (OFL). Intentional sans + mono pairing: mono carries every
technical truth.

- **Sans** (`Plex Sans`): UI labels, body, buttons, chat text.
- **Mono** (`Plex Mono`): URLs, the wordmark, `CLI`/`API` tags, API-key
  fields, tiny uppercase labels. If it is a machine fact, it is mono.
- No serif. The wordmark is lowercase mono `loom` with a caret.

Scale (px): 30 wordmark / 16 hero input / 14 body / 13 controls + url /
11 mono labels (uppercase, 0.5 tracking).
Weights: 400 default, 500 emphasis, 600 headings. Never 700.

## 4. Components and states

Every interactive element defines: default, hover, active, focus-visible,
disabled.

- **Button (icon):** 34px square, `--radius`, transparent, `--raised-2` on
  hover. Ink icon.
- **Button (primary):** accent bg, `--on-accent` text, `--accent-hover`
  pressed, `--radius`.
- **Input / omnibox:** `--field` bg, 1px `--border`, `--radius`, mono. Focus
  = `--accent` border + 3px `--accent-soft` ring. Height 36.
- **Chip / tag:** mono 11px, `--raised-2` bg, `--radius-sm`.
- **Overlay (menu, popover):** `--field` bg, 1px `--border-strong`,
  `--radius`. Separated by border, not shadow.

Focus is always visible (`:focus-visible`), never removed.

## 5. Layout and spacing

Strict 4px grid. Allowed steps: 4, 8, 12, 16, 24, 32, 48.
Toolbar height 60. AI panel width 400. Generous negative space over density
on the hero; tighter density in the chrome and panel.

## 6. Depth and elevation

**Borders-only.** No `box-shadow` anywhere. Surfaces are distinguished by a
1px hairline and a small lightness step (`paper` to `field` to `raised`).
This is the core anti-generic decision; do not reintroduce shadows.

## 7. Do and do not

Do:
- Reuse the exact tokens. Same radius, same border, same spacing, everywhere.
- Keep one depth strategy (borders) and one accent, used rarely.
- Use mono for machine facts, sans for human words.

Do not:
- No drop shadows. No gradients (one faint paper wash on the hero is the only
  exception). No fat pills (`border-radius` over 8px on controls).
- No second accent hue. No pure black (`#000`) or pure white (`#fff`).
- No system-default font fallbacks as the primary face.

## 8. Responsive

Single desktop window. The AI panel never exceeds 50% width and hides below
its content width. Toolbar items collapse into an overflow before wrapping.

## 9. Agent prompt guide

When building UI, state the choice before the code: which token, which
state, which spacing step. Specific beats vague ("border, not shadow";
"`--radius` 6px"; "accent only on the send button"). Verify against sections
2, 4, and 6 before claiming done.
