# Console and firm dashboard redesign: design

Date: 22 November 2026. Owner: Hassan. Status: approved by Hassan in the mockup session ("It's good, move forward").

## Why

Hassan finds the current web app (owner console and firm dashboard) "clearly AI made". It uses Tailwind's default slate palette, the system font, identical rounded boxes and a crowded top bar. The firm dashboard is what brokerage firms pay for, so it has to look like a confident property product, not a template.

## Decisions Hassan made (22 Nov 2026, mockups in `.superpowers/brainstorm/`)

- Direction: **bold, like a property site**.
- Colour system: **Bone, Graphite & Lime**, applied with the 60-30-10 rule (60% bone background, 30% graphite structure, 10% lime for what needs action).
- Type: **Manrope** (English) and **Noto Kufi Arabic** (Arabic).
- Scope: **everything** — owner console, login pages and the firm dashboard (English and Arabic, right to left).
- Layouts (approved mockup `layouts.html`): owner console with a dark graphite sidebar; firm dashboard with a graphite search banner and listing cards that lead with area, size, price and a lime payment-plan tag.

## Goals

1. One token system (colours, type, radii, spacing) defined once and used by every screen.
2. Every page restyled to it; no Tailwind default greys or the system font remain.
3. Lime appears only on what needs action or attention: the current page, the Review count, primary buttons, plan tags, "price drop"/"new" markers. Never as decoration.
4. Arabic pages are a true mirror: right-to-left layout, Noto Kufi, Arabic numerals where the page already uses them.
5. Works at phone width (firms use phones), keyboard focus visible, reduced motion respected, all text passing WCAG AA contrast.

## Non-goals

- New features or changed behaviour (every page keeps its data, actions and wording, except copy fixes listed below).
- Dark mode: dropped for now (the current `dark:` classes are removed); the graphite sidebar and banner already give contrast. Can return later.
- Photos for listings (WhatsApp listings rarely have them; cards must look complete without one).

## Anti-goals (the "AI-made" tells to avoid)

- Identical rounded cards with the same soft shadow everywhere: hierarchy uses three radii (8 / 12 / 20) and borders, not shadows; only floating things (menus, dialogs) get a shadow.
- Tracked-out ALL-CAPS labels above every field: field labels are sentence case, medium weight.
- Meta strings joined with middle dots ("Veloria · 2 bed · 95 m²"): use separate, spaced items or a short sentence.
- Gradients as decoration; a "→" on every button; monospace data labels; acid-green on near-black: graphite is olive-tinted (#23271F), never #0B0B0B, and lime stays at ~10%.
- Fade-and-slide animations on everything: no entrance animations; only action feedback (saving, confirmation).

## Tokens

| Token        | Value                     | Use                                                                                 |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------- |
| `bone`       | #F4F5F0                   | page background (60%)                                                               |
| `paper`      | #FFFFFF                   | panels and cards                                                                    |
| `graphite`   | #23271F                   | sidebar, top bar, firm search banner, headings (30%)                                |
| `graphite-2` | #353A2F                   | active nav row, hover on graphite                                                   |
| `ink`        | #1B1F15                   | body text                                                                           |
| `muted`      | #686E60                   | secondary text                                                                      |
| `line`       | #E1E4D8                   | borders, table rules                                                                |
| `lime`       | #B8E04A                   | primary buttons, current page marker, counts that need Hassan, plan tags' dot (10%) |
| `lime-soft`  | #EEF7D4 / text #4B630A    | plan tags, success notes                                                            |
| `warn`       | bg #FFF4DE / text #8A5A00 | review reasons, "check" notes                                                       |
| `danger`     | bg #FDE7E4 / text #A5281B | errors, "Not a listing"                                                             |

Lime text is never used on bone/white (it fails contrast); lime is a fill with ink text, or text on graphite.

Type: Manrope 400/500/700/800 and Noto Kufi Arabic 400/700, self-hosted with `@fontsource` packages (works offline on the laptop, no requests to Google). Scale (px): 12, 14 (body), 16, 20, 24, 32, 40; line height 1.5 for body, 1.15 for headings; prices and figures use tabular numerals, 800 weight. Line length under 80 characters for prose.

Spacing on a 4 px grid; radii 8 (inputs, buttons, tags), 12 (panels, cards), 20 (search banner, big KPI tiles).

## The one memorable thing

Prices and the numbers that need Hassan (Review waiting count, "right first time" this week) are set big in Manrope 800 with tabular numerals; the waiting count sits in a lime tile. Everything around them stays quiet.

## Layout

```
Owner console                         Firm dashboard
+--------+-------------------------+  +--------------------------------------+
|graphite| Page title              |  | graphite top bar: logo · firm · EN/AR|
|sidebar | [KPI tiles row]          |  | graphite banner: headline + search   |
| nav,   | content (tables, forms) |  +--------------------------------------+
| lime   |                         |  | filters (left / right in AR) | cards |
| counts |                         |  |                              | grid  |
+--------+-------------------------+  +--------------------------------------+
```

- Owner console: fixed 232 px graphite sidebar (collapses to a top bar with a menu button under 768 px); content left-aligned, max width 1200 px.
- Firm dashboard: top bar, then on Search a graphite banner with the headline "Find the right unit for your client" and the main search fields; filters beside the results on desktop, in a drawer on phones; listing cards in a responsive grid.
- Listing page: big price, plan table with "≈ X per month", map-free facts grid, share card.

## Approaches considered

|                | What                                                                                                           | Trade-off                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **A (chosen)** | Tokens in Tailwind v4 `@theme`, restyle the shared components in `apps/web/src/ui.tsx`, then pass page by page | Builds on what exists; small risk; every page gets the system                     |
| B              | Adopt a component library (e.g. shadcn/Radix)                                                                  | New dependencies and their default look, which is part of what reads as "AI-made" |
| C              | Rewrite pages from scratch                                                                                     | Highest risk of losing behaviour; no gain over A                                  |

## Copy fixes allowed

Sentence-case labels; buttons say what they do ("Approve", "Save changes"); empty states tell the next action ("Nothing waiting. New listings will appear here as they arrive."). No behaviour changes.

## Left to the builder

Exact class names, component APIs, icon choice (inline SVG only, no icon package), and per-page layout details within the tokens and principles above.
