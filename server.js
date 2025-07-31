import dotenv from "dotenv";
dotenv.config();


import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

// Path setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express
const app = express();
const PORT = process.env.PORT || 5000;

// API Keys (replace with your actual keys)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;


// Middleware
app.use(cors({
origin: [
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:5500",
  "https://cinevibe-ej8v.onrender.com",
    "https://cinevibe-frontend.netlify.app"

],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Enhanced OTT platform data with more realistic availability
const OTT_PLATFORMS = [
  { name: "Netflix", logo: "/logos/netflix.png", baseUrl: "https://netflix.com" },
  { name: "Prime Video", logo: "/logos/prime.png", baseUrl: "https://primevideo.com" },
  { name: "Disney+", logo: "/logos/disney.png", baseUrl: "https://disneyplus.com" },
  { name: "Hulu", logo: "/logos/hulu.png", baseUrl: "https://hulu.com" },
  { name: "HBO Max", logo: "/logos/hbo.png", baseUrl: "https://max.com" },
  { name: "Apple TV+", logo: "/logos/apple.png", baseUrl: "https://tv.apple.com" },
  { name: "Paramount+", logo: "/logos/paramount.png", baseUrl: "https://paramountplus.com" },
  { name: "Peacock", logo: "/logos/peacock.png", baseUrl: "https://peacocktv.com" },
  { name: "YouTube", logo: "/logos/youtube.png", baseUrl: "https://youtube.com" },
  { name: "Tubi", logo: "/logos/tubi.png", baseUrl: "https://tubi.tv" }
];

// Cache for trending movies (refresh every hour)
let trendingCache = {
  data: null,
  timestamp: 0,
  ttl: 3600000 // 1 hour
};

// TMDB Helper Functions
async function getMovieDetails(movieTitle, includeVideos = true) {
  try {
    // Search for the movie
    const searchResponse = await fetch(
      `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(movieTitle)}&api_key=${TMDB_API_KEY}&language=en-US`
    );
    const searchData = await searchResponse.json();

    if (!searchData.results || searchData.results.length === 0) {
      console.log(`No results found for: ${movieTitle}`);
      return null;
    }

    const movie = searchData.results[0];

    // Get detailed information
    const appendToResponse = includeVideos ? 'videos,credits,watch/providers' : 'credits,watch/providers';
    const detailsResponse = await fetch(
      `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}&append_to_response=${appendToResponse}&language=en-US`
    );
    const detailsData = await detailsResponse.json();

    // Find trailer
    const trailer = detailsData.videos?.results?.find(
      v => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
    );

    // Generate realistic OTT platform availability
    const ottPlatforms = OTT_PLATFORMS.map(platform => {
      // More realistic availability based on platform and movie popularity
      let availability = Math.random();
      
      // Popular movies more likely to be on major platforms
      if (movie.vote_average > 7 && movie.vote_count > 1000) {
        if (platform.name === "Netflix" || platform.name === "Prime Video") {
          availability += 0.3;
        }
      }
      
      // Older movies more likely on free platforms
      const releaseYear = new Date(movie.release_date).getFullYear();
      if (releaseYear < 2015 && (platform.name === "Tubi" || platform.name === "YouTube")) {
        availability += 0.4;
      }

      const isAvailable = availability > 0.65;
      
      return {
        ...platform,
        available: isAvailable,
        url: isAvailable ? `${platform.baseUrl}/title/${movie.id}` : null
      };
    });

    // Get watch providers from TMDB (if available)
    const providers = detailsData['watch/providers']?.results?.US;
    if (providers) {
      // Update availability based on actual TMDB data
      ['flatrate', 'rent', 'buy'].forEach(type => {
        if (providers[type]) {
          providers[type].forEach(provider => {
            const platformMatch = ottPlatforms.find(p => 
              p.name.toLowerCase().includes(provider.provider_name.toLowerCase()) ||
              provider.provider_name.toLowerCase().includes(p.name.toLowerCase())
            );
            if (platformMatch) {
              platformMatch.available = true;
              platformMatch.url = providers.link || platformMatch.url;
            }
          });
        }
      });
    }

    return {
      id: movie.id.toString(),
      title: detailsData.title,
      poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
      backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
      overview: detailsData.overview,
      releaseDate: detailsData.release_date,
      rating: movie.vote_average || 0,
      voteCount: movie.vote_count || 0,
      genres: detailsData.genres?.map(g => g.name) || [],
      director: detailsData.credits?.crew?.find(c => c.job === "Director")?.name,
      cast: detailsData.credits?.cast?.slice(0, 10).map(c => c.name) || [],
      runtime: detailsData.runtime,
      trailerUrl: trailer ? `https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1` : null,
      ottPlatforms: ottPlatforms.filter(p => p.available).concat(
        ottPlatforms.filter(p => !p.available).slice(0, 2)
      ), // Show available platforms first, then a few unavailable ones
      popularity: movie.popularity
    };
  } catch (error) {
    console.error(`Error fetching movie details for "${movieTitle}":`, error.message);
    return null;
  }
}

async function getTrendingMovies() {
  try {
    // Check cache first
    const now = Date.now();
    if (trendingCache.data && (now - trendingCache.timestamp) < trendingCache.ttl) {
      return trendingCache.data;
    }

    console.log('🔥 Fetching trending movies from TMDB...');

    const response = await fetch(
      `https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_API_KEY}&language=en-US`
    );
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      throw new Error('No trending movies found');
    }

    // Get detailed info for top trending movies
    const moviePromises = data.results
      .slice(0, 20) // Get top 20 trending
      .filter(movie => movie.vote_average > 6.0) // Filter out low-rated movies
      .map(movie => getMovieDetails(movie.title, false)); // Don't need videos for trending

    const movieResults = await Promise.all(moviePromises);
    const validMovies = movieResults
      .filter(movie => movie !== null)
      .sort((a, b) => b.popularity - a.popularity); // Sort by popularity

    // Cache the results
    trendingCache = {
      data: validMovies,
      timestamp: now
    };

    console.log(`✅ Successfully fetched ${validMovies.length} trending movies`);
    return validMovies;

  } catch (error) {
    console.error('❌ Error fetching trending movies:', error);
    return [];
  }
}

// Enhanced recommendation with better prompting
async function getMovieRecommendations(mood) {
  try {
    console.log(`🎬 Generating recommendations for mood: "${mood}"`);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-2025-04-14",
        messages: [
          {
            role: "system",
            content: `You are a Gen Z movie curator with exceptional taste. You understand nuanced moods and can recommend both popular and hidden gem films. 

Based on the user's mood/vibe, suggest exactly 15 movies that perfectly match their energy. Include a mix of:
- Popular recent films (2020-2024)
- Modern classics (2010-2019) 
- Timeless favorites (before 2010)
- Some international/indie films for variety

Focus on movies that are actually available on streaming platforms. Return ONLY the movie titles, one per line, no numbers or formatting. Make sure all titles are exact and searchable.`
          },
          {
            role: "user",
            content: `Find 15 movies that match this exact vibe: "${mood}"`
          }
        ],
        temperature: 0.8,
        max_tokens: 600
      })
    });

    const aiData = await response.json();

    if (aiData.error) {
      console.error("OpenAI API error:", aiData.error);
      throw new Error(`OpenAI API error: ${aiData.error.message}`);
    }

    const movieTitles = aiData.choices?.[0]?.message?.content
      ?.split("\n")
      .map(line => line.replace(/^[0-9]+[\.)\-\s]*/, '').trim())
      .filter(Boolean)
      .slice(0, 15) || [];

    if (movieTitles.length === 0) {
      throw new Error("No movie recommendations generated");
    }

    console.log(`🤖 AI suggested ${movieTitles.length} movies:`, movieTitles);

    // Fetch movie details in parallel with error handling
    const moviePromises = movieTitles.map(async (title) => {
      try {
        return await getMovieDetails(title);
      } catch (error) {
        console.error(`Failed to get details for "${title}":`, error.message);
        return null;
      }
    });

    const movieResults = await Promise.allSettled(moviePromises);
    const validMovies = movieResults
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => result.value)
      .filter(movie => movie.rating > 5.0); // Filter out very low-rated movies

    console.log(`✅ Successfully processed ${validMovies.length} movies`);

    // If we don't have enough movies, supplement with trending
    if (validMovies.length < 8) {
      console.log('🔄 Supplementing with trending movies...');
      const trending = await getTrendingMovies();
      const supplementMovies = trending
        .filter(movie => !validMovies.find(vm => vm.id === movie.id))
        .slice(0, 15 - validMovies.length);
      
      validMovies.push(...supplementMovies);
    }

    return validMovies;

  } catch (error) {
    console.error("❌ Error in getMovieRecommendations:", error);
    throw error;
  }
}

// API Routes

// Health Check
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "2.0.0",
    features: ["recommendations", "trending", "detailed-info"]
  });
});

// Get Trending Movies
app.get("/api/trending", async (req, res) => {
  try {
    console.log('📊 Trending movies requested');
    
    const trendingMovies = await getTrendingMovies();
    
    res.json({
      success: true,
      count: trendingMovies.length,
      movies: trendingMovies,
      cached: (Date.now() - trendingCache.timestamp) < trendingCache.ttl
    });

  } catch (error) {
    console.error("❌ Trending endpoint error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch trending movies",
      message: error.message
    });
  }
});

// Movie Recommendations
app.post("/api/recommend", async (req, res) => {
  const { mood } = req.body;

  // Validation
  if (!mood || typeof mood !== "string" || mood.trim().length === 0) {
    return res.status(400).json({ 
      success: false,
      error: "Mood is required and must be a non-empty string" 
    });
  }

  if (mood.length > 500) {
    return res.status(400).json({
      success: false,
      error: "Mood description is too long (max 500 characters)"
    });
  }

  try {
    const startTime = Date.now();
    const movies = await getMovieRecommendations(mood.trim());
    const endTime = Date.now();

    console.log(`⚡ Request completed in ${endTime - startTime}ms`);

    res.json({
      success: true,
      mood: mood.trim(),
      count: movies.length,
      movies: movies,
      processingTime: endTime - startTime
    });

  } catch (error) {
    console.error("❌ Recommendation endpoint error:", error);
    
    let statusCode = 500;
    let errorMessage = "Internal server error";
    
    if (error.message.includes('OpenAI')) {
      statusCode = 502;
      errorMessage = "AI service temporarily unavailable";
    } else if (error.message.includes('TMDB')) {
      statusCode = 503;
      errorMessage = "Movie database temporarily unavailable";
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Search specific movie
app.get("/api/movie/:title", async (req, res) => {
  try {
    const { title } = req.params;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        error: "Movie title is required"
      });
    }

    const movie = await getMovieDetails(decodeURIComponent(title));
    
    if (!movie) {
      return res.status(404).json({
        success: false,
        error: "Movie not found"
      });
    }

    res.json({
      success: true,
      movie: movie
    });

  } catch (error) {
    console.error("❌ Movie search error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to search for movie",
      message: error.message
    });
  }
});

// Serve static files (including prompt.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "prompt.html"));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("💥 Unhandled error:", err);
  res.status(500).json({ 
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: [
      "GET /api/health",
      "GET /api/trending", 
      "POST /api/recommend",
      "GET /api/movie/:title"
    ]
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start Server
app.listen(PORT, () => {
  console.log(`🎬 CineVibe server running at http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔥 Trending movies: GET http://localhost:${PORT}/api/trending`);
  console.log(`🎯 Recommendations: POST http://localhost:${PORT}/api/recommend`);
  console.log(`🔍 Movie search: GET http://localhost:${PORT}/api/movie/:title`);
  console.log(`💫 Web interface: http://localhost:${PORT}/`);
  
  // Warm up trending cache
  getTrendingMovies().catch(console.error);
});

export default app;