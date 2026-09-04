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
- **Screening details** — clicking a card opens a popup with time, runtime, venue,
  strand, price range and all other screenings of the same film; from there you can
  add to plan, hide the screening, or open the BFI page
- **Conflict detection** — overlapping picks are outlined red with warnings in the
  side panel; tight transfers between different venues (< 30 min gap) are orange
- **"Also at" chips** — under each film in the plan, switch your pick to another
  screening of the same film with one click
- **Hide screenings** — from the details popup; recover from the
  "Hidden screenings" bin in the side panel
- **BFI links** — the ↗ button on a card opens the screening on the BFI site to book
- **Export & share** — *Export* (in the plan sidebar) opens a print-ready view of
  your plan: **Print** (print dialog) or **Copy as text** (plain-text plan with
  warnings). The sidebar collapses via **«** for a full-screen calendar — bring it
  back with the “« Sidebar” tab.
- **Help** — in-app info page describing all of the above

## Run

```sh
node scrape.mjs        # optional: refresh data from whatson.bfi.org.uk (~30s)
python3 -m http.server 8642
open http://localhost:8642
```

Note: plans are stored per browser origin — if you change the port, localStorage
data (plan / hidden screenings / hidden venues) won't carry over.
