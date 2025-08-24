CineVibe – AI-Powered Conversational Movie Recommendation Platform

CineVibe is an AI-powered movie discovery app that goes beyond genre filters. It understands natural-language prompts about emotions, moods, situations, and preferences, then returns context-aware recommendations. Each result includes OTT availability, a trailer, rich details, and ratings so users can decide and start watching quickly.

This project does not include rooms/co-watch or ticket booking flows.

Overview

• Single home page with one prompt box.
• Users describe how they feel or what they want to watch.
• The app returns up to 10 recommendations that fit the vibe.
• Background music adapts to the mood expressed in the prompt.
• The front page also presents curated rows: Trending, Now Playing (in theatres), and Upcoming, across Hollywood, Bollywood, and Anime.

Example: entering “nostalgic 90s/2000s comfort movies” returns a list of matching titles such as The Half of It (2020) with posters, OTT badges, trailer access, and ratings.

Key Objectives

Enable discovery through natural conversation

Recommend films by emotional context, not only genre

Provide OTT availability so users can watch instantly

Deliver an aesthetic, vibe-first user experience

Keep the experience fast, stable, and privacy-respecting

Core Features
1) Conversational Assistant (Home Page)

Describe your mood in plain language (for example: “slow-paced movie about finding yourself” or “I just had a breakup and want something comforting”).
CineVibe uses AI to generate candidate titles and then validates and enriches them with TMDB data. Results show up to 10 movies with poster, year, rating, overview, and OTT badges.

2) Background Music Engine (no code)

The app includes a background music system that adapts to the user’s prompt. It analyzes the words in the prompt and assigns a theme such as romantic, sad, suspense, horror, comedy, action, sci-fi, upbeat, or chill.
How it behaves:

When the user runs a search, CineVibe determines a theme from the text and selects a matching background track.

Music is looped and keeps playing across the page until the user disables it.

Users can toggle music on or off and adjust volume from the UI.

If a trailer is opened in the movie modal, background music pauses automatically and resumes when the modal closes.

The theme selection is keyword-driven. For example:

romance, romantic, heartwarming → romantic theme

sad, melancholy, breakup → sad theme

suspense, mystery, mind-bending → suspense theme

horror, scary, slasher → horror theme

comedy, funny, quirky → comedy theme

action, battle, superhero → action theme

sci-fi, space, cyberpunk → sci-fi theme

feel-good, uplifting, wholesome, party → upbeat theme

chill, cozy, comfort, lofi → chill theme

This approach keeps the interface quiet by default and adds mood-appropriate ambience as soon as the user engages with the app.

3) Front Page Rows (Curated Sections)

The landing page includes several dynamic sections sourced from TMDB:

Trending

Hollywood

Bollywood

Now Playing (in theatres)

Hollywood

Bollywood

Anime

Upcoming

Hollywood

Bollywood

Anime

These rows are fetched with caching and fallbacks to keep the page responsive and reliable.

4) Movie Details Modal

Each title opens a details modal that provides:

OTT availability
Provider badges for services such as Netflix, Prime Video, Disney+, Hulu, and others. Clicking a badge opens the provider page for the title, when available.

Trailer
Embedded YouTube trailer. Audio is managed to avoid overlap: the app pauses/unloads any trailer when the modal is closed.

Details
Overview, release year, runtime, genres, director, and top cast.

Rating
TMDB average rating displayed clearly alongside other metadata.

Technology Stack

Backend: Node.js (Express), Axios with retry and keep-alive

Data: TMDB API (v4 token preferred; v3 key fallback)

AI: OpenAI GPT API to generate initial title lists based on the prompt

Frontend: Vanilla HTML, CSS, and JavaScript served from the public directory

Optional: Firebase (client-side hooks) for search history

Hosting: any Node-capable environment

Project Structure

server.js — Express API and static hosting

.env — environment variables for server and keys

public/prompt.html — web UI entry (home/front page)

public/prompt.css — styles

public/app.js or public/prompt.js — client script (ensure the HTML script source matches the file name)

public/logos — OTT logos

public/music — background music assets

Getting Started

Install dependencies with your package manager.

Create an environment file with server port, OpenAI key, and TMDB credentials.

Start the server.

Open the application in a browser at localhost on the configured port.

The app works without Firebase; search history is enabled only when Firebase is configured on the client.

API Reference

Health
GET /api/health — status, timestamp, version, features.

Trending (flat list)
GET /api/trending — weekly trending movies with details.

Trending (grouped)
GET /api/trending/all — grouped trending for Hollywood, Bollywood, Anime.

Now Playing
GET /api/now-playing — in-theatre listings for US and India.

Upcoming
GET /api/upcoming — upcoming movies grouped for Hollywood, Bollywood, and Anime.

Recommendations
POST /api/recommend — accepts a mood prompt and returns up to 10 context-matched recommendations with OTT, trailer link, details, and rating.

Movie by Title
GET /api/movie/:title — TMDB search and details for a specific title.

Implementation Notes

Trailers are embedded through YouTube and are stopped and unloaded when the modal closes to avoid audio bleed.

OTT availability uses TMDB watch/providers and is mapped to recognizable badges in the UI.

Network calls use retries and keep-alive for stability on unreliable connections.

Placeholder images are used if a poster or backdrop is not available from TMDB.