# MEXC Change Analyzer

A lightweight web app that mirrors MEXC sidebar percent values and helps you track real-time momentum across USDT pairs.

## Features

- USDT-only stream and REST ticker ingestion for clean scope
- Exact percent parity with MEXC via `zonedRate` (UTC+8 mini tickers)
- Dual-table layout: left sticky (Pair, Price) and right scrollable (Trend, Change %, latest 30 histories)
- Ranks by 10-point trend slope (percent/min) with up/down/flat arrows
- New-token treatment after 10 ticks: chips in a yellow label bar + persistent toast
- Clicking any row copies the MEXC exchange URL (`https://www.mexc.com/exchange/BASE_QUOTE?...`) to clipboard
- Top 30 tokens only; histories show the latest 30 values, newest on the left
- Row highlighting sync across both tables on selection

## Quick Start

- Prerequisites: Node.js 18+
- Install: `npm install`
- Run: `npm start`
- Open: `http://localhost:5173/`

## How It Works

- Backend (`server.js`)
  - Serves static files from `public/`
  - Proxies REST `GET https://api.mexc.com/api/v3/ticker/24hr` at `/api/ticker24`
  - Connects to `wss://wbs.mexc.com/ws` and subscribes to `spot@public.miniTickers.v3.api@UTC+8`
  - Broadcasts messages to clients on `/stream`

- Frontend (`public/index.html`)
  - Starts REST polling at load and also opens the WebSocket stream
  - Filters to USDT symbols, builds per-symbol state with price history
  - Computes 10-point trend slope and renders arrows with color coding
  - Caps percent history to latest 30 and renders newest-to-oldest
  - New tokens: gated until tick ≥ 10; shows chips and persistent toasts
  - Clicking a row copies the pair’s MEXC URL to clipboard

## UI Controls

- Poll interval selector: `10s | 20s | 30s`
- Status indicator shows stream connectivity and last update time

## Notes

- The mini tickers channel can deliver Protobuf frames; current implementation parses JSON shapes delivered by MEXC and falls back to REST polling if needed
- Only top 30 rows are shown for clarity
- No secrets or keys are stored; external calls go directly to MEXC endpoints

## Troubleshooting

- Blank screen: ensure the server is running (`npm start`) and visit `http://localhost:5173/`
- Stream issues: the app continues to poll REST; check console logs for network errors
- Clipboard permissions: some browsers require a user gesture; clicking a row provides this

## Scripts

- `npm start` — starts the HTTP server and WebSocket relay