# Console and firm dashboard redesign: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restyle the whole web app (owner console, login pages, firm dashboard EN/AR) to the Bone, Graphite & Lime system with Manrope + Noto Kufi Arabic.

**Architecture:** Tokens in `apps/web/src/index.css` (`@theme`), shared components in `apps/web/src/ui.tsx`, two shells (owner sidebar in `App.tsx` or a new `Shell` component; firm `firm/Shell.tsx`), then page passes. No behaviour changes.

**Tech Stack:** React 19, Tailwind CSS v4 (`@tailwindcss/vite`), React Router, Vite; fonts via `@fontsource-variable/manrope` and `@fontsource/noto-kufi-arabic` (self-hosted).

**Spec:** `docs/superpowers/specs/2026-11-22-console-redesign-design.md`

## Global Constraints

- Every token value, rule and anti-goal in the spec applies to every task (copy them from the spec's Tokens and Anti-goals sections).
- No behaviour changes: same routes, data, API calls, form fields and actions; existing web tests keep passing.
- No `dark:` classes remain; no Tailwind default palette colour names (slate, gray, zinc, emerald, …) remain in `apps/web/src` after Task 6.
- Arabic (firm dashboard) mirrors right-to-left using logical properties (`ms-`/`me-`/`ps-`/`pe-`, `start`/`end`), not left/right.
- Lime is a fill with ink text, or text on graphite; never lime text on bone/white.
- Visible keyboard focus (2 px lime ring on graphite, 2 px graphite ring on light), `prefers-reduced-motion` respected.
- Checks: `pnpm --filter @reb/web build` (via the Docker image build), web tests, lint, format, typecheck — run in Docker in pieces (small VM). Max two implementers at once.

## Review Focus

1. Arabic right-to-left on the firm dashboard: sidebar/filters on the right, numbers and plan tags read correctly.
2. Phone width (375 px): owner sidebar becomes a top bar with a menu; firm filters in a drawer; no sideways scrolling.
3. Long Arabic and English project names in cards and tables wrap, never overflow.
4. Keyboard: every action reachable, focus ring visible on graphite and on light.
5. Empty and error states on each page use the new styles and clear copy.

---

### Task 1: Tokens, fonts and shared components

**Files:** `apps/web/package.json` (add `@fontsource-variable/manrope`, `@fontsource/noto-kufi-arabic`; update `pnpm-lock.yaml` via `pnpm install` in Docker), `apps/web/src/main.tsx` (font imports), `apps/web/src/index.css` (tokens per spec as `@theme` colours `--color-bone`, `--color-paper`, `--color-graphite`, `--color-graphite-2`, `--color-ink`, `--color-muted`, `--color-line`, `--color-lime`, `--color-lime-soft`, `--color-lime-ink`, `--color-warn`, `--color-warn-ink`, `--color-danger`, `--color-danger-ink`; `--font-sans: 'Manrope Variable', 'Noto Kufi Arabic', …`; `[dir=rtl]` uses Noto Kufi first; base body styles; focus ring; tabular-nums utility), `apps/web/src/ui.tsx` (Button variants primary=lime / secondary=graphite outline / quiet / danger; Input; Select; Label sentence case; Card radius 12, border, no shadow; Badge tones neutral / lime / warn / danger; PageTitle; ErrorNote; Loading; Table with bone header row; `td`), `apps/web/src/pages/Login.tsx`, `apps/web/src/pages/SetPassword.tsx` (graphite left panel with the product name, form on bone).

- [ ] Build and web tests pass; screenshot Login at 1280 and 375 px; commit `design: tokens, fonts and shared components`.

### Task 2: Owner console shell and Overview

**Files:** `apps/web/src/App.tsx` (or new `apps/web/src/AdminShell.tsx`): graphite sidebar per mockup (232 px; nav items Overview, Review with lime count of waiting listings from the existing review query, Places & names, Groups, WhatsApp, Firms, Listings, Failed jobs with lime count if any, Settings; Sign out at the bottom; active row graphite-2 with a lime start marker; collapses to a top bar with a menu button under 768 px). `apps/web/src/pages/Overview.tsx`: KPI row (waiting for review in a lime tile; active listings; right first time this week), the "Is the bot learning?" table with small inline bars, existing daily stats restyled.

- [ ] Commit `design: owner console sidebar and overview`.

### Task 3: Review

**Files:** `apps/web/src/pages/Review.tsx`, `ReviewLearning.tsx`, `ReviewPlans.tsx`: two-column layout (message and flyer on the left, fields on the right; one column on phones); reason box in warn tone; "Gemini thinks" hint in muted with a quiet "Use" button; plans table on paper with bone header; sticky action bar at the bottom of the fields panel with Approve (lime), Not a listing (danger quiet), Skip (quiet); confirmation notes in lime-soft.

- [ ] Commit `design: review page`.

### Task 4: Remaining owner pages

**Files:** `apps/web/src/pages/Entities.tsx` (Places & names), `Groups.tsx`, `WhatsApp.tsx` (pairing QR centred on paper), `Firms.tsx`, `Jobs.tsx` (Failed jobs), `Settings.tsx`.

- [ ] Remove all `dark:` classes and default palette names in these files; commit `design: places, groups, WhatsApp, firms, jobs, settings`.

### Task 5: Firm shell and search

**Files:** `apps/web/src/firm/Shell.tsx` (graphite top bar with logo, firm name, EN/عربي switch, user menu; phone menu), `firm/Search.tsx` (graphite banner with headline "Find the right unit for your client" / Arabic equivalent in `i18n.tsx`, main search fields and lime Search button; results as listing cards: location tag, size, big price, project and bedrooms, lime-soft plan tag with "≈ X per month" when known; "Price drop" marker), `firm/Filters.tsx` (beside results on desktop, drawer on phones), `firm/MultiPick.tsx`, `apps/web/src/i18n.tsx` (only new strings).

- [ ] RTL check in Arabic; commit `design: firm dashboard shell and search`.

### Task 6: Firm listing, saved searches, team, share card

**Files:** `firm/Listing.tsx` (big price, facts grid, payment plans table with "≈ X per month", price history, notes), `firm/Saved.tsx`, `firm/Team.tsx`, `firm/ShareCard.tsx` (share image keeps its own fixed layout but adopts the palette and fonts), `firm/format.ts` if needed.

- [ ] No `dark:` or default palette names left anywhere in `apps/web/src`; commit `design: firm listing, saved searches, team, share card`.

### Task 7: Visual check and polish (controller)

- [ ] Deploy locally (`docker compose up -d --build`), screenshot every page in English and Arabic at 1280 and 375 px in the built-in browser, fix what looks off (one fix agent), update `PROJECT.md` (interfaces chapter: look and tokens), `PITCH.md` (one line), `docs/HANDOFF.md`; push to `main`.
