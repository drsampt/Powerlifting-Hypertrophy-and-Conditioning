# Training Program Builder

A personalized, AI-assisted training program generator for serious strength athletes (powerlifters, strongmen, weightlifters, CrossFit athletes) with session logging, RPE-based auto-adjustment, and progress analytics.

## Stack

- **Backend:** Node.js, Express, SQLite (`better-sqlite3`)
- **Frontend:** Vanilla JavaScript SPA, Chart.js (vendored locally), dark theme, mobile-responsive

## Quick Start

```bash
npm install
npm start
```

Then open http://localhost:3000. The SQLite database (`training.db`) is created automatically on first run.

## Features

- **Program generation** across 4 periodization models: Linear, Block, Conjugate/Concurrent, and Daily Undulating (DUP)
- Sport-specific exercise selection (powerlifting, strongman, weightlifting, CrossFit, bodybuilding, general strength)
- Load calculations from RPE/rep tables against competition maxes
- **Session logging** with RPE-based auto-adjustment (next-session weight recommendation)
- **Analytics dashboard**: estimated 1RM progression, weekly volume load, RPE patterns, week-over-week comparisons
- CSV/JSON export of logged sessions
- Program management: list, clone, archive, delete

## Project Structure

```
server.js              Express app + all API routes
lib/
  db.js                 SQLite schema + seed
  periodization.js       Program generation engine
  loadCalc.js             RPE% tables, weight rounding
  adjustment.js            Auto-adjustment rules
  analytics.js              Analytics engine
  exercises.js               Sport exercise libraries
public/
  index.html
  styles/main.css
  js/                    app.js, program.js, logger.js, analytics.js, api.js, vendor/chart.umd.js
```

## API Overview

See `server.js` for the full route list. Key endpoints:

- `POST /api/profile` — create an athlete profile
- `POST /api/generate-program` — generate a full periodized program
- `GET /api/program/:id` — fetch a program
- `POST /api/log-session` — log a session and get the auto-adjusted next weight
- `GET /api/progress/:program_id` — analytics
- `GET /api/export/:program_id?format=csv|json` — export logged sessions
