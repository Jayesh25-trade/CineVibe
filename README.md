# CineVibe – AI-Powered Conversational Movie Recommendation Platform

CineVibe is a mood-first movie discovery app. Users write a natural-language prompt (for example: “nostalgic 90s/2000s comfort movies”), and CineVibe returns a curated list enriched with OTT availability, trailer, rich details, and rating. The landing page also includes curated rows for Trending, Now Playing (in theatres), and Upcoming across Hollywood, Bollywood, and Anime.

This README summarizes the current behavior of the provided codebase.

---

## Overview

- Single home page with one prompt box.
- The server generates a candidate list via OpenAI and enriches each title using TMDB.
- The UI renders recommendation cards; clicking a card opens a modal with OTT badges, trailer, details, and rating.
- Background music adapts to the prompt’s mood, automatically pausing while a trailer plays.
- The front page can show dynamic rows: Trending, Now Playing (US/IN theatres), and Upcoming for Hollywood, Bollywood, and Anime.
- Optional Firebase hooks power a simple search-history view; the site runs even if Firebase is not configured.

> Booking flows are not part of this project. “Rooms” code paths exist for experimentation but are not required for core functionality.

---

## What the Website Does

### 1) Conversational Recommendations (Home Page)
- Users enter a free-text prompt such as:
  - “nostalgic 90s/2000s comfort movies”
  - “slow-paced movie about finding yourself”
  - “something dark and twisted that messes with my mind”
- The backend calls OpenAI to generate titles, then:
  - Looks up each title on TMDB
  - Enriches each movie with images, credits, providers, and trailer
  - Filters out very low-rated items and supplements with trending if needed
- The client shows a grid of results (typically around ten items). Clicking a card opens a modal with:
  - Poster/backdrop, year, runtime, genres, overview
  - Director and top cast
  - TMDB rating
  - OTT availability badges with “Watch” links (when available)
  - Embedded YouTube trailer

### 2) Background Music Engine
- On each search, CineVibe analyzes the prompt and assigns a theme such as: romantic, sad, suspense, horror, comedy, action, sci-fi, upbeat, or chill.
- A matching background track loops quietly. Users can toggle music on/off and adjust volume.
- When a trailer opens in the modal, background music pauses automatically and resumes when the modal closes.
- The theme selection is keyword-based. Examples:
  - romance/heartwarming/date → romantic
  - sad/melancholy/breakup → sad
  - suspense/mystery/mind-bending → suspense
  - horror/slasher/possession → horror
  - comedy/funny/quirky → comedy
  - action/battle/superhero → action
  - sci-fi/space/cyberpunk → sci-fi
  - feel-good/uplifting/party → upbeat
  - chill/cozy/comfort/lofi → chill

### 3) Front Page Curated Rows
Backed by TMDB, the landing page can render:

- Trending
  - Hollywood
  - Bollywood
  - Anime
- Now Playing (in theatres)
  - Hollywood (US)
  - Bollywood (IN)
  - Anime
- Upcoming
  - Hollywood
  - Bollywood
  - Anime

Each row shows clickable cards that open the same details modal. Data loading is cached and guarded to keep the UI responsive.

### 4) OTT, Trailer, Details, Rating
- **OTT availability**: derived from TMDB watch/providers. The UI maps common providers (Netflix, Prime Video, Disney+, Hulu, Max, Apple TV+, Paramount+, Peacock, YouTube, Tubi) to recognizable badges. If a title link is available, a “Watch” button is shown.
- **Trailer**: embedded via YouTube. The modal implements strict media hygiene: on close, trailers are programmatically stopped/unloaded and any `<video>` is paused/reset.
- **Details**: overview, release year, runtime, genres, director, and cast.
- **Rating**: TMDB average rating is displayed on cards and inside the modal.

---

## Architecture and Data Flow

1. **Prompt ingestion (client)**  
   Browser posts `{ mood }` to `POST /api/recommend`.

2. **Title generation (server)**  
   OpenAI (`gpt-4o-mini`) returns a list of titles for the requested vibe.

3. **Enrichment (server)**  
   Each title is looked up on TMDB for details, images, credits, trailer, and providers. Low-quality or unresolved items are dropped. If too few remain, the server supplements with trending results.

4. **Presentation (client)**  
   The grid displays cards; the modal presents full details and trailer. Background music is controlled according to user actions.

---

## Reliability and UX Safeguards

- **DOM guards** on the client prevent crashes if optional elements are missing.
- **Media hygiene** ensures all trailers and videos stop when the modal closes to avoid audio bleed.
- **Networking resilience** with keep-alive HTTPS agent, exponential backoff + jitter retry strategy, and a cache for trending results.
- **Concurrency limiting** balances speed and API rate limits during TMDB enrichment.
- **Optional Firebase** search history is best-effort; the app remains fully functional without Firebase configuration.

---

## Technology Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript (served from `/public`)
- **Backend**: Node.js (Express), Axios, keep-alive agent, retry/backoff
- **AI**: OpenAI Chat Completions API (`gpt-4o-mini`)
- **Data Provider**: TMDB API (v4 bearer preferred; v3 API key as fallback)
- **Optional**: Firebase Firestore (client-side) for search history
- **Hosting**: Any Node-capable environment

---

## API Reference

### `GET /api/health`
Health status, timestamp, version, and feature flags.

### `GET /api/trending`
Weekly trending movies (enriched movie objects). Server caches for one hour.

### `GET /api/trending/all`
Grouped trending arrays: `hollywood`, `bollywood`, and `anime` (summary objects suitable for row rendering).

### `GET /api/now-playing`
Now-playing summaries for theatres in `us` and `in`.

### `GET /api/upcoming`
Grouped upcoming summaries for `hollywood`, `bollywood`, and `anime`.

### `POST /api/recommend`
Accepts a natural-language prompt and returns a curated list of enriched movies.

**Request body**
```json
{ "mood": "nostalgic 90s/2000s comfort movies" }
