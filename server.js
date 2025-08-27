// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import axios from "axios";
import dns from "node:dns";

// -------------------- Path & App --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// -------------------- Keys --------------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";          // v3 key (optional fallback)
const TMDB_V4_TOKEN = process.env.TMDB_V4_TOKEN || "";        // v4 Read Access Token (recommended)

// -------------------- Middleware --------------------
app.use(
  cors({
    origin: [
      "http://localhost:8080",
      "http://localhost:3000",
      "http://localhost:5000",
      "http://127.0.0.1:5500",
      "https://cinevibe-ej8v.onrender.com",
      "https://cinevibe-frontend.netlify.app",
    ],
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// -------------------- Constants --------------------
const OTT_PLATFORMS = [
  { name: "Netflix",     logo: "/logos/netflix.png",   baseUrl: "https://netflix.com" },
  { name: "Prime Video", logo: "/logos/prime.png",     baseUrl: "https://primevideo.com" },
  { name: "Disney+",     logo: "/logos/disney.png",    baseUrl: "https://disneyplus.com" },
  { name: "Hulu",        logo: "/logos/hulu.png",      baseUrl: "https://hulu.com" },
  { name: "Max",         logo: "/logos/hbo.png",       baseUrl: "https://max.com" },
  { name: "Apple TV+",   logo: "/logos/apple.png",     baseUrl: "https://tv.apple.com" },
  { name: "Paramount+",  logo: "/logos/paramount.png", baseUrl: "https://paramountplus.com" },
  { name: "Peacock",     logo: "/logos/peacock.png",   baseUrl: "https://peacocktv.com" },
  { name: "YouTube",     logo: "/logos/youtube.png",   baseUrl: "https://youtube.com" },
  { name: "Tubi",        logo: "/logos/tubi.png",      baseUrl: "https://tubi.tv" },
];

// -------------------- Cache --------------------
let trendingCache = { data: null, timestamp: 0, ttl: 60 * 60 * 1000 }; // 1h

// -------------------- Networking: Hardened Clients --------------------
if (process.env.FORCE_IPV4 === "true") {
  dns.setDefaultResultOrder("ipv4first");
}
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 20,
  timeout: 30_000,
});

// TMDB axios instance
const tmdbClient = axios.create({
  baseURL: "https://api.themoviedb.org/3",
  timeout: 15_000,
  httpsAgent,
  headers: TMDB_V4_TOKEN ? { Authorization: `Bearer ${TMDB_V4_TOKEN}` } : undefined,
  params: TMDB_V4_TOKEN ? { language: "en-US" } : { language: "en-US", api_key: TMDB_API_KEY },
  validateStatus: (s) => s >= 200 && s < 300,
});

const RETRYABLE_CODES = new Set(["ECONNRESET","EAI_AGAIN","ETIMEDOUT","ENETUNREACH","EHOSTUNREACH","ECONNABORTED","EPIPE"]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function axiosWithRetry(fn, { attempts = 4, baseDelay = 300 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      const code = err?.code || err?.cause?.code;
      const status = err?.response?.status;
      const retryableHttp = status >= 500 || status === 429;
      const retryableNet  = RETRYABLE_CODES.has(code);
      if (i === attempts - 1 || !(retryableHttp || retryableNet)) break;
      const wait = Math.round(baseDelay * Math.pow(2, i) + Math.random() * 100);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function tmdb(pathname, params = {}) {
  return axiosWithRetry(() => tmdbClient.get(pathname, { params }).then((r) => r.data));
}

function mapMovieSummary(m) {
  return {
    id: String(m.id),
    title: m.title || m.name || m.original_title || m.original_name || "",
    overview: m.overview || "",
    releaseDate: m.release_date || m.first_air_date || null,
    rating: typeof m.vote_average === "number" ? m.vote_average : 0,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : null,
    popularity: m.popularity || 0,
  };
}

// simple concurrency limiter
function pLimit(concurrency) {
  const queue = [];
  let active = 0;
  const next = () => { active--; if (queue.length) queue.shift()(); };
  return (fn) => new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try { resolve(await fn()); } catch (e) { reject(e); } finally { next(); }
    };
    if (active < concurrency) run(); else queue.push(run);
  });
}
const limit4 = pLimit(4);

// -------------------- Movie/TV detail helpers --------------------
function normalizeProviders(providerBlock) {
  if (!providerBlock) return [];
  const buckets = ["flatrate", "rent", "buy"];
  const found = new Map();
  buckets.forEach((b) => {
    (providerBlock[b] || []).forEach((p) => {
      const key = (p.provider_name || "").toLowerCase();
      if (!found.has(key)) found.set(key, { name: p.provider_name, types: new Set([b]) });
      else found.get(key).types.add(b);
    });
  });
  const list = [];
  for (const { name, types } of found.values()) {
    const match =
      OTT_PLATFORMS.find(
        (pl) =>
          pl.name.toLowerCase() === name.toLowerCase() ||
          name.toLowerCase().includes(pl.name.toLowerCase()) ||
          pl.name.toLowerCase().includes(name.toLowerCase())
      ) || { name };
    list.push({
      name: match.name,
      logo: match.logo || null,
      available: true,
      url: providerBlock.link || null,
      types: Array.from(types),
    });
  }
  return list;
}

async function getMovieDetailsById(movieId, includeVideos = true) {
  try {
    const append = includeVideos ? "videos,credits,watch/providers" : "credits,watch/providers";
    const data = await tmdb(`/movie/${movieId}`, { append_to_response: append });

    const trailer = data.videos?.results?.find(
      (v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
    );

    const providersUS = data["watch/providers"]?.results?.US;
    const ottPlatforms = normalizeProviders(providersUS);

    return {
      id: String(data.id),
      title: data.title,
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
      overview: data.overview || "",
      releaseDate: data.release_date || null,
      rating: data.vote_average || 0,
      voteCount: data.vote_count || 0,
      genres: (data.genres || []).map((g) => g.name),
      director: data.credits?.crew?.find((c) => c.job === "Director")?.name || null,
      cast: (data.credits?.cast || []).slice(0, 10).map((c) => c.name),
      runtime: data.runtime || null,
      trailerUrl: trailer ? `https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1` : null,
      ottPlatforms,
      popularity: data.popularity || 0,
    };
  } catch (err) {
    return null;
  }
}

async function getTvDetailsById(tvId, includeVideos = true) {
  try {
    const append = includeVideos ? "videos,credits,watch/providers" : "credits,watch/providers";
    const data = await tmdb(`/tv/${tvId}`, { append_to_response: append });

    const trailer = data.videos?.results?.find(
      (v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
    );

    const providersUS = data["watch/providers"]?.results?.US;
    const ottPlatforms = normalizeProviders(providersUS);

    return {
      id: String(data.id),
      title: data.name || data.original_name || "",
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
      overview: data.overview || "",
      releaseDate: data.first_air_date || null,
      rating: data.vote_average || 0,
      voteCount: data.vote_count || 0,
      genres: (data.genres || []).map((g) => g.name),
      director: null,
      cast: (data.credits?.cast || []).slice(0, 10).map((c) => c.name),
      runtime: Array.isArray(data.episode_run_time) && data.episode_run_time.length
        ? Number(data.episode_run_time[0])
        : null,
      trailerUrl: trailer ? `https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1` : null,
      ottPlatforms,
      popularity: data.popularity || 0,
    };
  } catch (err) {
    return null;
  }
}

// recommendations (movie first, then tv; mix of recommendations + similar)
async function getRecsById(id) {
  const out = new Map();

  // movie recs/similar
  try {
    const r1 = await tmdb(`/movie/${id}/recommendations`).catch(() => ({ results: [] }));
    (r1.results || []).forEach(m => out.set(m.id, mapMovieSummary(m)));
  } catch {}
  try {
    const r2 = await tmdb(`/movie/${id}/similar`).catch(() => ({ results: [] }));
    (r2.results || []).forEach(m => out.set(m.id, mapMovieSummary(m)));
  } catch {}

  // tv recs/similar (in case the id is TV)
  try {
    const r3 = await tmdb(`/tv/${id}/recommendations`).catch(() => ({ results: [] }));
    (r3.results || []).forEach(m => out.set(m.id, mapMovieSummary(m)));
  } catch {}
  try {
    const r4 = await tmdb(`/tv/${id}/similar`).catch(() => ({ results: [] }));
    (r4.results || []).forEach(m => out.set(m.id, mapMovieSummary(m)));
  } catch {}

  // filter weak items
  return Array.from(out.values()).filter(m => (m.rating || 0) > 5.0).slice(0, 18);
}

async function getMovieDetails(movieTitle, includeVideos = true) {
  try {
    const search = await tmdb(`/search/movie`, { query: movieTitle });
    if (!search.results?.length) return null;
    const first = search.results[0];
    return getMovieDetailsById(first.id, includeVideos);
  } catch {
    return null;
  }
}

async function getTrendingMovies() {
  try {
    const now = Date.now();
    if (trendingCache.data && now - trendingCache.timestamp < trendingCache.ttl) {
      return trendingCache.data;
    }

    const data = await tmdb("/trending/movie/week");
    const ids = (data.results || [])
      .filter((m) => (m.vote_average || 0) > 6.0)
      .slice(0, 20)
      .map((m) => m.id);

    const results = await Promise.all(ids.map((id) => limit4(() => getMovieDetailsById(id, false))));
    const movies = results.filter(Boolean);

    trendingCache = { data: movies, timestamp: now, ttl: trendingCache.ttl };
    return movies;
  } catch {
    return [];
  }
}

// -------------------- Anime helpers --------------------
async function fetchAnimeTrending() {
  const a1 = await tmdb("/discover/movie", {
    with_original_language: "ja",
    with_genres: "16",
    sort_by: "popularity.desc",
    "vote_count.gte": 20,
    page: 1,
  }).catch(() => ({ results: [] }));
  if (a1.results?.length) return a1.results.map(mapMovieSummary);

  const a2 = await tmdb("/discover/movie", {
    with_genres: "16",
    sort_by: "popularity.desc",
    "vote_count.gte": 20,
    page: 1,
  }).catch(() => ({ results: [] }));
  if (a2.results?.length) return a2.results.map(mapMovieSummary);

  const a3 = await tmdb("/discover/tv", {
    with_genres: "16",
    sort_by: "popularity.desc",
    "vote_count.gte": 20,
    page: 1,
  }).catch(() => ({ results: [] }));
  return (a3.results || []).map(mapMovieSummary);
}

async function fetchAnimeUpcoming() {
  const today = new Date().toISOString().slice(0, 10);

  const u1 = await tmdb("/discover/movie", {
    with_original_language: "ja",
    with_genres: "16",
    sort_by: "primary_release_date.asc",
    "primary_release_date.gte": today,
    page: 1,
  }).catch(() => ({ results: [] }));
  if (u1.results?.length) return u1.results.map(mapMovieSummary);

  const u2 = await tmdb("/movie/upcoming", { region: "JP", page: 1 }).catch(() => ({ results: [] }));
  if (u2.results?.length) return u2.results.map(mapMovieSummary);

  const u3 = await tmdb("/discover/movie", {
    with_genres: "16",
    sort_by: "primary_release_date.asc",
    "primary_release_date.gte": today,
    page: 1,
  }).catch(() => ({ results: [] }));
  if (u3.results?.length) return u3.results.map(mapMovieSummary);

  const u4 = await tmdb("/discover/tv", {
    with_genres: "16",
    sort_by: "first_air_date.asc",
    "first_air_date.gte": today,
    page: 1,
  }).catch(() => ({ results: [] }));
  return (u4.results || []).map(mapMovieSummary);
}

// -------------------- OpenAI Recs --------------------
async function getMovieRecommendations(mood) {
  const body = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a Gen Z movie curator. Return EXACTLY 15 movie titles (one per line, no numbering). Include a mix of recent (2020+), modern classics (2010-2019), older favorites (pre-2010), and some international/indie. Titles must be exact and searchable.",
      },
      { role: "user", content: `Find 15 movies that match this vibe: "${mood}"` },
    ],
    temperature: 0.8,
    max_tokens: 600,
  };

  const openai = axios.create({
    baseURL: "https://api.openai.com/v1",
    timeout: 20_000,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    httpsAgent,
  });

  const aiData = await axiosWithRetry(() => openai.post("/chat/completions", body));
  const text = aiData?.data?.choices?.[0]?.message?.content || "";
  const movieTitles = text
    .split("\n")
    .map((line) => line.replace(/^[0-9]+[\.)\-\s]*/, "").trim())
    .filter(Boolean)
    .slice(0, 30);

  if (!movieTitles.length) throw new Error("No movie recommendations generated");

  const results = await Promise.allSettled(movieTitles.map((t) => getMovieDetails(t)));
  const valid = results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value)
    .filter((m) => (m.rating || 0) > 5.0);

  if (valid.length < 8) {
    const trending = await getTrendingMovies();
    const supplement = trending.filter((m) => !valid.find((v) => v.id === m.id)).slice(0, 15 - valid.length);
    valid.push(...supplement);
  }
  return valid;
}

// -------------------- Routes --------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "2.2.0",
    features: ["recommendations", "trending", "detailed-info", "more-like-this"],
  });
});

app.get("/api/trending", async (req, res) => {
  try {
    const movies = await getTrendingMovies();
    res.json({
      success: true,
      count: movies.length,
      movies,
      cached: Date.now() - trendingCache.timestamp < trendingCache.ttl,
    });
  } catch {
    res.status(500).json({ success: false, error: "Failed to fetch trending movies" });
  }
});

app.post("/api/recommend", async (req, res) => {
  try {
    const mood = String(req.body?.mood || "").trim();
    if (!mood) return res.status(400).json({ success: false, error: "Mood is required and must be non-empty" });
    if (mood.length > 500) return res.status(400).json({ success: false, error: "Mood too long (max 500 chars)" });

    const start = Date.now();
    const movies = await getMovieRecommendations(mood);
    res.json({ success: true, mood, count: movies.length, movies, processingTime: Date.now() - start });
  } catch (error) {
    const msg = /openai/i.test(String(error?.message)) ? "AI service temporarily unavailable" : "Internal server error";
    const code = /openai/i.test(String(error?.message)) ? 502 : 500;
    res.status(code).json({ success: false, error: msg });
  }
});

app.get("/api/movie/:title", async (req, res) => {
  try {
    const { title } = req.params;
    if (!title) return res.status(400).json({ success: false, error: "Movie title is required" });
    const movie = await getMovieDetails(decodeURIComponent(title));
    if (!movie) return res.status(404).json({ success: false, error: "Movie not found" });
    res.json({ success: true, movie });
  } catch {
    res.status(500).json({ success: false, error: "Failed to search for movie" });
  }
});

// fetch full details by TMDB id (movie, else tv)
app.get("/api/details/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, error: "ID is required" });

    let item = await getMovieDetailsById(id, false);
    if (!item) item = await getTvDetailsById(id, false);

    if (!item) return res.status(404).json({ success: false, error: "Movie/TV not found" });
    res.json({ success: true, movie: item });
  } catch {
    res.status(500).json({ success: false, error: "Failed to fetch details" });
  }
});

// NEW: More Like This (recommendations/similar)
app.get("/api/recommendations/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ success: false, error: "ID is required" });
    const recs = await getRecsById(id);
    res.json({ success: true, count: recs.length, movies: recs });
  } catch {
    res.status(500).json({ success: false, error: "Failed to fetch recommendations" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "prompt.html"));
});

// -------- Extras (unchanged) --------
app.get("/api/trending/all", async (req, res) => {
  try {
    const t = await tmdb("/trending/movie/week");
    const hollywood = (t.results || []).map(mapMovieSummary);

    const b = await tmdb("/discover/movie", {
      with_original_language: "hi",
      sort_by: "popularity.desc",
      "vote_count.gte": 50,
      page: 1,
    });
    const bollywood = (b.results || []).map(mapMovieSummary);

    const anime = await fetchAnimeTrending();
    res.json({ success: true, hollywood, bollywood, anime });
  } catch (e) {
    res.status(502).json({ success: false, error: "Failed to fetch trending" });
  }
});

app.get("/api/now-playing", async (req, res) => {
  try {
    const us = await tmdb("/movie/now_playing", { region: "US", page: 1 });
    const india = await tmdb("/movie/now_playing", { region: "IN", page: 1 });
    res.json({
      success: true,
      us: (us.results || []).map(mapMovieSummary),
      in: (india.results || []).map(mapMovieSummary),
    });
  } catch (e) {
    res.status(502).json({ success: false, error: "Failed to fetch now playing" });
  }
});

app.get("/api/upcoming", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const us = await tmdb("/movie/upcoming", { region: "US", page: 1 });
    const inUpcoming = await tmdb("/movie/upcoming", { region: "IN", page: 1 });
    const hiDiscover = await tmdb("/discover/movie", {
      with_original_language: "hi",
      sort_by: "primary_release_date.asc",
      "primary_release_date.gte": today,
      page: 1,
    });

    const byId = new Map();
    [...(inUpcoming.results || []), ...(hiDiscover.results || [])].forEach((m) => byId.set(m.id, m));

    const anime = await fetchAnimeUpcoming();
    res.json({
      success: true,
      hollywood: (us.results || []).map(mapMovieSummary),
      bollywood: Array.from(byId.values()).map(mapMovieSummary),
      anime,
    });
  } catch (e) {
    res.status(502).json({ success: false, error: "Failed to fetch upcoming" });
  }
});

// simple demo rooms (unchanged)
const activeRooms = new Set();
app.post("/api/room/create", (req, res) => {
  const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
  if (activeRooms.has(roomId)) return res.status(409).json({ success: false, error: "Room already exists" });
  activeRooms.add(roomId);
  res.json({ success: true, roomId });
});
app.get("/api/room/join/:id", (req, res) => {
  const roomId = req.params.id.toUpperCase();
  if (!activeRooms.has(roomId)) return res.status(404).json({ success: false, error: "Room not found" });
  res.json({ success: true, roomId });
});

// -------------------- Error handlers --------------------
app.use((err, req, res, next) => {
  res.status(500).json({ success: false, error: "Internal server error" });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: [
      "GET /api/health",
      "GET /api/trending",
      "GET /api/trending/all",
      "GET /api/now-playing",
      "GET /api/upcoming",
      "POST /api/recommend",
      "GET /api/movie/:title",
      "GET /api/details/:id",
      "GET /api/recommendations/:id",
      "POST /api/room/create",
      "GET /api/room/join/:id",
    ],
  });
});

// -------------------- Start server --------------------
app.listen(PORT, () => {
  console.log(`🎬 CineVibe server running at http://localhost:${PORT}`);
  console.log(`📊 Health check:      http://localhost:${PORT}/api/health`);
  console.log(`🔥 Trending:          GET /api/trending`);
  console.log(`🌍 Trending (All):    GET /api/trending/all`);
  console.log(`🎟️  Now Playing:      GET /api/now-playing`);
  console.log(`⏳ Upcoming:          GET /api/upcoming`);
  console.log(`🎯 Recommendations:   POST /api/recommend`);
  console.log(`🔍 Movie search:      GET /api/movie/:title`);
  console.log(`📄 Details by ID:     GET /api/details/:id`);
  console.log(`➕ More Like This:    GET /api/recommendations/:id`);
  console.log(`💫 Web interface:     http://localhost:${PORT}/`);
  getTrendingMovies().catch(() => {});
});

export default app;
