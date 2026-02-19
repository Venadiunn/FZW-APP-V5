# TrackIT — WWT Distribution Hub

**Live:** Deploy `index.html` + folders to GitHub Pages root.

## Architecture

```
trackit/
├── index.html              # Main entry point
├── css/
│   └── app.css             # All styles (WWT + TrackIT unified)
├── js/
│   ├── csv-parser.js       # Client-side CSV parsing + DataLoader
│   ├── state.js            # All warehouse state + WWT7.java operations
│   ├── gemini.js           # Gemini AI integration (mirrors Java logic)
│   ├── ui.js               # All DOM rendering (no business logic)
│   └── app.js              # App controller + event handlers
└── data/
    ├── items_with_area.csv         # 1000 items
    ├── locations_with_areas.csv    # 36 locations
    ├── alerts-compvis.csv          # 184 CV alerts (headerless)
    └── inventory.csv               # PartNumber → LOCATION assignments
```

## Features

### From `index(1).html` (100% preserved)
- Dashboard with stat cards, utilization bar, work area banner, quick actions
- Inventory view: search, filter chips (All/Stored/Unassigned/Work Area), item table with actions
- Placement view: AI quick-assign by part #, Bulk Auto-Pack (LAFF), expandable location cards
- Work Area view: full table with timers, timer progress bars
- All 6 WWT7.java operations: viewAllItems, moveItem, checkOut, checkIn, workAreaStatus, AI suggest
- Gemini AI with exact Java prompt, response parsing (`replaceAll("\\D+","")`) and safety validation
- LAFF bulk pack (sort descending by area, AI-place each)
- Space NOT freed on checkout (slot reserved — key WWT7 behavior)
- Export CSV (mirrors WWT7.java save block)

### Added from `index.html` (TrackIT dashboard)
- **Sidebar navigation** with keyboard shortcuts (1–7)
- **Dark/Light theme toggle** (persisted to localStorage)
- **Loader screen** with boot animation
- **Live clock** in sidebar footer
- **CV Alerts view**: full log, search/filter, breakdown-by-location table, export CSV
- **Locations view**: capacity grid with sort (default/highest/lowest)
- **History view**: session checkout/checkin log with late/on-time stats, clear log
- **Direct checkout/checkin forms** in Work Area (from server.js work area panel)
- **Timer progress bars** (animated, color-coded green→amber→red)
- **Connection status indicator** in sidebar

### Added from `server.js`
- Real **36-location**, **1000-item** data from actual CSVs
- Checkout/checkin direct form interface (Work Area panel)
- Alert export endpoint logic (client-side implementation)

### Added from `computer-vision.py`
- CV Alerts panel with **computer-vision system info card** explaining the Python script
- Alert simulation button (demos what CV alerts look like without live camera)
- Alert cooldown/stabilization constants displayed in UI

### Added from `alerts-compvis.csv`
- **185 real historical CV alerts** loaded and displayed

## GitHub Pages Deployment

1. Push entire `trackit/` folder contents to repo root (or subfolder with base path)
2. Enable GitHub Pages → Deploy from branch → `main` → `/ (root)`
3. App runs 100% client-side — no server needed

## Data Persistence
State changes (placements, checkouts) persist via **localStorage** so they survive page refresh.
Use the "Reset All Placement Data" button in History view to restore from CSV.

## Gemini API Key
`AIzaSyDPd44Nt5IsOT0XVmm5zroyHXNnpO0wS-g` — set in `js/gemini.js`. Restrict in Google Cloud Console by HTTP referrer for production.
