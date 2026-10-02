# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file, client-side web app (`RoasterICS.html`) that converts Thai Airways crew roster PDFs into Google Calendar-compatible `.ics` files. No build step — the HTML file runs directly in a browser.

`index.html` is a thin `<meta http-equiv="refresh">` redirect to `RoasterICS.html`; it exists only so the GitHub Pages root URL resolves. All app logic lives in `RoasterICS.html` — keep it as the canonical file and do not move logic into `index.html`.

## Development Server

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/RoasterICS.html` in the browser. All processing is client-side; no backend is needed.

## Deployment

Hosted on GitHub Pages from the `main` branch (root folder) of `github.com/Tono-Gitto/roster`.

- **Live URL:** https://tono-gitto.github.io/roster/ (the `index.html` redirect forwards to `RoasterICS.html`).
- **Deploy:** any push to `main` triggers the `pages-build-deployment` GitHub Actions workflow, which builds and deploys automatically (~1 min). No manual step.
- Since it's a static site, a successful deploy needs both the `build` **and** `deploy` jobs green — `build` passing alone does not mean the site updated.

## Architecture

The entire application lives in `RoasterICS.html`: a `<script id="airportTz" type="application/json">` data block (airport → timezone, ~380 lines) followed by a `<script type="module">` block (~680 lines). The processing pipeline (`parseRoster`) is:

1. **PDF Extraction** (`extractPdfItems`) — PDF.js reads the uploaded file and returns text items with pixel (x, y) coordinates (`item.transform[4]`/`[5]`), in native PDF user-space (y increases upward).
2. **Grid Building** (`buildGrid`) — Detects date column headers (e.g. `1SUN`, `10MON`) via regex on the header row, locates the month/year header, then computes per-day column x-boundaries (midpoint between adjacent day headers) and buckets every text item into a `dayItems[day]` array, sorted top-to-bottom by y.
3. **Duty Parsing** (`parseDayColumn`, per day) — Walks each day's items top-to-bottom, building "segments" keyed off flight-number tokens (`\d{3,4}` or `SIM...`), accumulating airport and time tokens onto the current segment. Any 3-letter token inside a segment is taken as an airport unless it is in the `NON_AIRPORT` denylist (`isAirportToken`). Segments that have ≥1 airport and ≥1 time become real `FLT`/`P` (deadhead) duties; everything else (GRD, SBY, AL, SIC, TRG, OFF, unrecognized) collapses into a single plain `DUTY` event via `buildSimpleDuty`.
4. **Post-Processing** (`postProcessFlights`) — Resolves overnight flights (departure on day N, arrival past midnight on day N+1) by pulling the missing destination/end time from day N+1's column, then deletes the leftover `DUTY` artifact that `parseDayColumn` independently built from those same arrival tokens (only when day N+1 had no other duty signal — see Gotchas).
5. **ICS Generation** (`buildIcs`, `buildCheckin`) — Serialises each duty to an iCalendar VEVENT, converting local times to UTC via `getUtcOffset` (looks the airport up in the embedded `#airportTz` table to get its IANA zone, then asks the browser's `Intl` timezone database for the offset at that local date/time, DST included), and emits an automatic check-in reminder VEVENT alongside `FLT`/`P`/`GRD`/`SBY` duties.

### Key Data Shape

```js
// Duty object produced by parseDayColumn / postProcessFlights
{
  date,           // "YYYY-MM-DD" string (NOT a JS Date)
  type,           // 'FLT' | 'P' | 'GRD' | 'SBY' | 'AL' | 'SIC' | 'TRG' | 'OFF' | 'DUTY'
  duty,           // flight number ("TG123") or duty label
  start_local,    // "HH:MM" local time
  end_local,      // "HH:MM" local time
  origin,         // IATA code (FLT/P only)
  destination,    // IATA code (FLT/P only)
  base,           // home base IATA ('BKK')
  summary,        // free-text label, only set on the 'DUTY' fallback type
}
```

`'DUTY'` is the catch-all type produced by `buildSimpleDuty` for anything that isn't a recognized real flight (GRD/SBY/AL/SIC/TRG/unrecognized tokens) — it carries no `origin`/`destination`, just a `summary` string.

### Check-in Logic

`buildCheckin` auto-generates a VEVENT reminder 120 minutes before flights departing BKK (`FLT`/`P` with `origin === 'BKK'`) and 60 minutes before `GRD`/`SBY` duties. Nothing else gets a check-in.

## Dependencies (CDN, no install needed)

| Library | Version | Purpose |
|---|---|---|
| pdf.js | 4.9.155 | PDF text extraction with coordinates |
| Tailwind CSS | latest CDN | Styling |

## Gotchas

- **Airports are recognized by position, not by a whitelist.** `isAirportToken` accepts any 3-letter token that is not in the small `NON_AIRPORT` denylist (duty codes like GRD/SBY/OFF/TRG/SIC/SIM, header words, weekday names). If the roster ever shows a new 3-letter duty code inside a flight's day column, it will be mistaken for an airport — add it to `NON_AIRPORT`. Do not test "is this an airport" against the timezone table: OFF, SBY, GRD, TRG and SIM are all real IATA codes there.
- **Timezones come from the embedded `#airportTz` table (~7,900 airports, from `mwgg/Airports`, MIT) plus the browser's `Intl` database.** Regenerate the block with `tools/gen-airport-tz.mjs`; don't hand-edit it. An airport missing from the table is kept on the flight, its times fall back to UTC+7, and `renderPreview` shows an amber warning (`unknownAirports`) and marks the row with ⚠. Offsets are only as current as the user's browser timezone data.
- **Overnight flights produce a duplicate-looking artifact unless `postProcessFlights` prunes it.** Every day column is parsed independently by `parseDayColumn`, so a flight landing after midnight leaves a same-day arrival remnant (bare airport + time) in the *next* day's column, which `parseDayColumn` turns into its own spurious `DUTY` entry. `postProcessFlights` both completes the overnight flight from that remnant *and* deletes the resulting duplicate `DUTY` — but only when the next day's column has no other duty signal (`nextHasDuty`). If that pruning logic changes, re-verify against a roster with a true overnight flight (departure local time > arrival local time on the same multi-leg duty).
- Roster detection is tightly coupled to the Thai Airways "Crew Schedule Slip" PDF layout — column detection relies on the specific date-header pattern (`\d{1,2}(SUN|MON|TUE|WED|THU|FRI|SAT)`) and table boundaries (`*** ` separator rows, `DUE DATE`/`Indicator Description` footer markers).
- No automated tests exist. Verify changes by loading a real roster PDF in the browser (`#debugSection` exposes the raw extracted text per row, useful for diagnosing column/grid issues without instrumenting the JS).
