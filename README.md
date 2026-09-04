# LFF 2026 Planner

A small visualization tool for planning your BFI London Film Festival 2026 schedule
(7–18 October). No build step, no dependencies.

## Features

- **Weekly calendar** — days as vertical columns, screenings as cards positioned at
  their start time and sized by runtime; day columns auto-widen for their busiest
  overlap (horizontal scroll when needed), and overlapping screenings get
  side-by-side lanes
- **Venue colour coding** — BFI Southbank, BFI IMAX, Southbank Centre, Curzon Soho,
  Vue West End, ICA, Prince Charles; click a legend chip to hide/show a venue
- **Personal plan** — the checkbox on a card adds a screening to your plan; saved in
  `localStorage`, survives reloads and server restarts
- **Movie details** — clicking a card (or a plan entry) opens the film's popup:
  every screening of the film with add-to-plan checkboxes, per-screening
  hide/restore, and BFI links; **Hide others** hides all screenings of the film
  that aren't in your plan (decluttering repeats)
- **Conflict detection** — overlapping picks are outlined red with warnings in the
  side panel; tight transfers between different venues (< 30 min gap) are orange
- **Hide screenings** — from the details popup; recover from the
  "Hidden screenings" bin in the side panel
- **BFI links** — the ↗ button on a card opens the screening on the BFI site to book
- **Export & share** — *Export* (in the plan sidebar) opens a print-ready view of
  your plan: **Print** (print dialog) or **Download JSON** (plan plus hidden
  screenings and venues). **Import** loads a JSON export — for moving your plan
  between browsers or sharing it. The sidebar collapses via **«** for a
  full-screen calendar — bring it back with the “« Sidebar” tab.
- **Help** — in-app info page describing all of the above

## Run

```sh
node scrape.mjs        # optional: refresh data from whatson.bfi.org.uk (~30s)
python3 -m http.server 8642
open http://localhost:8642
```

Note: plans are stored per browser origin — if you change the port, localStorage
data (plan / hidden screenings / hidden venues) won't carry over.

## Data

`scrape.mjs` fetches the 12 festival day pages (e.g.
`...default.asp?BOparam::WScontent::loadArticle::permalink=20261014`), extracts the
embedded `articleContext.searchResults` JS object, and additionally fetches each
film's detail page for its runtime. HTML entities in the source are decoded.
Results go to `data/screenings.json`; film runtimes are cached in
`data/detail-cache.json` (use `--refresh` to force re-fetching runtimes).

Screening fields: `id`, `title`, `start` (`2026-10-14T19:45`), `durationMin`,
`venue`, `venueRaw`, `strand`, `url`, `priceMin/Max`, `salesStatus`,
`availability`, `availableNum`.
