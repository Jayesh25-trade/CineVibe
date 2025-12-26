(() => {
  'use strict';

  // ---------- Utilities ----------
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const noop = () => {};
  const normalizeBaseUrl = (u) => (u || '').replace(/\/?$/, '');
  const toYear = (d) => {
    const y = new Date(d).getFullYear();
    return Number.isFinite(y) && y > 1900 ? y : '';
  };

  function toast(msg) {
    try {
      const el = document.createElement('div');
      el.className = 'cv-toast';
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: '24px',
        background: 'rgba(0,0,0,0.9)',
        color: '#fff',
        padding: '12px 18px',
        borderRadius: '12px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        zIndex: 99999,
        opacity: '0',
        transition: 'opacity 200ms ease',
        border: '1px solid rgba(200,50,255,0.3)',
        boxShadow: '0 0 20px rgba(200,50,255,0.2)'
      });
      el.textContent = msg;
      document.body.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = '1'; });
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 240);
      }, 2500);
    } catch {
      alert(msg);
    }
  }

  async function fetchJSON(url, options = {}, { timeoutMs = 20000 } = {}) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      const text = await res.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      return json;
    } finally {
      clearTimeout(id);
    }
  }

  // ---------- State / DOM ----------
  let isLoading = false;
  let currentMovies = [];
  let showingHistory = false;

  const searchForm = $('searchForm');
  const moodInput = $('moodInput');
  const searchButton = $('searchButton');
  const loadingScreen = $('loadingScreen');
  const moviesGrid = $('moviesGrid');
  const moviesSection = $('moviesSection');
  const moviesTitle = $('moviesTitle');
  const movieModal = $('movieModal');
  const modalCloseBtn = $('modalClose');
  const suggestionButtons = $$('.suggestion-button');
  const historyToggle = $('historyToggle');
  const historySection = $('historySection');
  const historyGrid = $('historyGrid');
  const trendingSection = $('trendingSection');
  const trendingGrid = $('trendingGrid');
  const moodSuggestions = $('moodSuggestions');
  const logoHome = $('logoHome');
  const heroSection = $('heroSection');

  // API base URL - your Render backend
  const API_BASE_URL = normalizeBaseUrl(
    location.hostname.includes('localhost')
      ? 'http://localhost:5000/api'
      : 'https://cinevibe-movie.onrender.com/api'
  );

  // ---------- Helper Functions ----------
  function hideHomeSections() {
    if (heroSection) heroSection.style.display = 'none';
    if (trendingSection) trendingSection.style.display = 'none';
    if (historySection) historySection.style.display = 'none';
    if (moodSuggestions) moodSuggestions.style.display = 'none';
  }

  function showHomeSections() {
    if (heroSection) heroSection.style.display = 'block';
    if (trendingSection) trendingSection.style.display = 'block';
    if (moodSuggestions) moodSuggestions.style.display = 'block';
    if (moviesSection) moviesSection.classList.remove('show');
  }

  // ---------- Local Storage History ----------
  function getLocalHistory() {
    try {
      return JSON.parse(localStorage.getItem('cinevibe_history') || '[]');
    } catch {
      return [];
    }
  }

  function saveToLocalHistory(mood) {
    try {
      const history = getLocalHistory();
      const newItem = {
        id: Date.now().toString(),
        mood,
        timestamp: new Date().toISOString()
      };
      const updated = [newItem, ...history.filter(h => h.mood !== mood)].slice(0, 20);
      localStorage.setItem('cinevibe_history', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save history:', e);
    }
  }

  function displayHistory() {
    if (!historyGrid) return;
    const history = getLocalHistory();
    historyGrid.innerHTML = '';

    if (!history.length) {
      historyGrid.innerHTML = '<p style="text-align:center;color:var(--text-muted);">No search history yet</p>';
      return;
    }

    history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.onclick = () => {
        if (moodInput) moodInput.value = item.mood;
        handleSearch({ preventDefault: noop });
        toggleHistory();
      };
      const date = new Date(item.timestamp);
      el.innerHTML = `
        <div class="history-mood">${item.mood}</div>
        <div class="history-date">${date.toLocaleDateString()}</div>
      `;
      historyGrid.appendChild(el);
    });
  }

  function toggleHistory() {
    showingHistory = !showingHistory;
    if (!historySection || !trendingSection || !moodSuggestions || !moviesSection || !historyToggle) return;

    if (showingHistory) {
      historySection.classList.add('show');
      moviesSection.classList.remove('show');
      trendingSection.style.display = 'none';
      moodSuggestions.style.display = 'none';
      historyToggle.textContent = '🎬 Movies';
      displayHistory();
    } else {
      historySection.classList.remove('show');
      trendingSection.style.display = 'block';
      moodSuggestions.style.display = 'block';
      historyToggle.textContent = '📚 History';
      if (currentMovies.length > 0) moviesSection.classList.add('show');
    }
  }

  // ---------- Trending Movies ----------
  async function loadTrendingMovies() {
    try {
      const data = await fetchJSON(`${API_BASE_URL}/trending`);
      if (data?.success && Array.isArray(data.movies)) {
        displayTrendingMovies(data.movies.slice(0, 8));
      }
    } catch (err) {
      console.error('Failed to load trending movies:', err);
    }
  }

  function displayTrendingMovies(movies) {
    if (!trendingGrid) return;
    trendingGrid.innerHTML = '';

    (movies || []).forEach((movie, i) => {
      const card = document.createElement('div');
      card.className = 'trending-card';
      card.style.animationDelay = `${Math.min(i * 0.1, 1)}s`;
      card.onclick = () => openMovieModal(movie);

      const rating = Number.isFinite(movie?.rating) ? Number(movie.rating).toFixed(1) : '—';
      card.innerHTML = `
        <img src="${movie?.poster || '/placeholder-movie.jpg'}" alt="${movie?.title || 'Movie'}" class="trending-poster" loading="lazy">
        <div class="trending-info">
          <h3 class="trending-title">${movie?.title || ''}</h3>
          <p class="trending-rating">⭐ ${rating}</p>
        </div>
      `;
      trendingGrid.appendChild(card);
    });
  }

  // ---------- Search Handler (WITH AUTH CHECK) ----------
  async function handleSearch(e) {
    if (e?.preventDefault) e.preventDefault();
    if (isLoading) return;

    const mood = moodInput?.value?.trim();
    if (!mood) {
      toast('Please describe your mood first!');
      return;
    }

    // ===== CHECK AUTH - This is the key integration =====
    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      
      if (!session) {
        // User not logged in - show auth modal
        window.showAuthModal(mood);
        return;
      }

      // User is logged in - proceed with search
      const accessToken = session.access_token;
      if (!accessToken) {
        window.showAuthModal(mood);
        return;
      }

      setLoading(true);

      try {
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        };

        const data = await fetchJSON(`${API_BASE_URL}/recommend`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ mood })
        });

        if (!data?.movies) {
          throw new Error(data?.error || 'Failed to get recommendations');
        }

        currentMovies = data.movies;
        displayMovies(currentMovies);
        if (moviesTitle) moviesTitle.textContent = `Movies for "${mood}"`;
        saveToLocalHistory(mood);

        if (showingHistory) toggleHistory();
        hideHomeSections();
        if (moviesSection) moviesSection.classList.add('show');

        toast(`Found ${data.movies.length} movies for your vibe!`);
      } catch (err) {
        console.error('Search error:', err);
        toast('Failed to get recommendations. Please try again.');
      } finally {
        setLoading(false);
      }

    } catch (err) {
      console.warn('Auth check failed:', err);
      window.showAuthModal(mood);
    }
  }

  // ---------- Loading UI ----------
  function setLoading(loading) {
    isLoading = !!loading;
    if (loadingScreen) loadingScreen.style.display = loading ? 'flex' : 'none';
    if (searchButton) {
      searchButton.disabled = loading;
      searchButton.dataset.origText = searchButton.dataset.origText || searchButton.textContent || 'Find Movies';
      searchButton.textContent = loading ? 'Searching...' : (searchButton.dataset.origText || '✨ Find Movies');
    }
    if (loading) startLoadingAnimation();
  }

  function startLoadingAnimation() {
    const dotsEl = $('loadingDots');
    if (!dotsEl) return;
    let dots = '';
    const it = setInterval(() => {
      if (!isLoading) { clearInterval(it); return; }
      dots = dots.length >= 3 ? '' : dots + '.';
      dotsEl.textContent = dots;
    }, 500);
  }

  // ---------- Movies Display ----------
  function displayMovies(movies) {
    if (!moviesGrid) return;
    moviesGrid.innerHTML = '';
    (movies || []).forEach((m, i) => moviesGrid.appendChild(createMovieCard(m, i)));
  }

  function createMovieCard(movie, index) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.style.animationDelay = `${Math.min(index * 0.1, 2)}s`;
    card.onclick = () => openMovieModal(movie);

    const platforms = (movie?.ottPlatforms || [])
      .filter(p => p?.available)
      .slice(0, 3)
      .map(p => `<span class="platform-badge">${p.name}</span>`)
      .join('');

    card.innerHTML = `
      <img src="${movie?.poster || '/placeholder-movie.jpg'}" alt="${movie?.title || 'Movie'}" class="movie-poster" loading="lazy">
      <div class="movie-info">
        <h3 class="movie-title">${movie?.title || ''}</h3>
        <p class="movie-year">${toYear(movie?.releaseDate)}</p>
        <div class="movie-platforms">${platforms}</div>
      </div>
    `;
    return card;
  }

  // ---------- Movie Modal ----------
  function openMovieModal(movie) {
    const modalContent = $('modalContent');
    if (!movieModal || !modalContent) return;

    const platforms = (movie?.ottPlatforms || []).map(p => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem;border:1px solid ${p?.available ? 'var(--primary-start)' : 'var(--border-color)'};border-radius:.5rem;margin-bottom:.5rem;background:${p?.available ? 'rgba(200,50,255,0.1)' : 'var(--bg-secondary)'};">
        <span style="color:${p?.available ? 'var(--text-primary)' : 'var(--text-secondary)'};">${p?.name || ''}</span>
        ${p?.available && p?.url ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);text-decoration:none;font-weight:600;">Watch</a>` : ''}
      </div>
    `).join('');

    const rating = Number.isFinite(movie?.rating) ? Number(movie.rating).toFixed(1) : '—';
    const hasRuntime = Number.isFinite(movie?.runtime);
    const hours = hasRuntime ? Math.floor(Number(movie.runtime) / 60) : 0;
    const mins = hasRuntime ? Number(movie.runtime) % 60 : 0;

    modalContent.innerHTML = `
      <button class="modal-close" id="modalClose">&times;</button>
      ${movie?.backdrop ? `<img src="${movie.backdrop}" style="width:100%;height:300px;object-fit:cover;border-radius:1rem 1rem 0 0;">` : ''}
      <div class="modal-content-inner" style="padding:2rem;">
        <h2 style="font-family:'Space Grotesk',sans-serif;font-size:2rem;margin-bottom:1rem;background:var(--gradient-primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">${movie?.title || ''}</h2>
        <div style="display:flex;gap:1rem;margin-bottom:1rem;color:var(--text-secondary);">
          <span style="color:var(--accent-green);">⭐ ${rating}</span>
          <span>📅 ${toYear(movie?.releaseDate)}</span>
          ${hasRuntime ? `<span>⏱ ${hours}h ${mins}m</span>` : ''}
        </div>
        <p style="line-height:1.6;margin-bottom:1.25rem;color:var(--text-secondary);">${movie?.overview || ''}</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;">
          <div>
            <h3 style="margin-bottom:1rem;color:var(--accent-cyan);">Genres</h3>
            <div style="display:flex;flex-wrap:wrap;gap:.5rem;">
              ${(movie?.genres || []).map(g => `<span style="padding:.25rem .75rem;background:var(--gradient-primary);border-radius:1rem;font-size:.8rem;color:white;">${g}</span>`).join('')}
            </div>
            ${movie?.director ? `<h3 style="margin:1rem 0 .5rem;color:var(--accent-cyan);">Director</h3><p style="color:var(--text-secondary);">${movie.director}</p>` : ''}
          </div>
          <div>
            <h3 style="margin-bottom:1rem;color:var(--accent-cyan);">Available On</h3>
            ${platforms}
          </div>
        </div>

        ${movie?.trailerUrl ? `
          <div style="margin-top:2rem;">
            <h3 style="margin-bottom:1rem;color:var(--accent-cyan);">Trailer</h3>
            <iframe src="${movie.trailerUrl}" width="100%" height="300" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="border-radius:.5rem;border:1px solid var(--border-color);"></iframe>
          </div>
        ` : ''}
      </div>
    `;

    const closeBtn = $('modalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeModal, { once: true });
    movieModal.addEventListener('click', (e) => { if (e.target === movieModal) closeModal(); }, { once: true });
    movieModal.style.display = 'flex';
  }

  function closeModal() {
    if (!movieModal) return;
    // Stop any media
    const modalContent = $('modalContent');
    if (modalContent) {
      modalContent.querySelectorAll('iframe').forEach(frame => {
        frame.setAttribute('src', 'about:blank');
      });
    }
    movieModal.style.display = 'none';
  }

  // ---------- Event Listeners ----------
  if (searchForm) searchForm.addEventListener('submit', handleSearch);
  if (historyToggle) historyToggle.addEventListener('click', toggleHistory);

  suggestionButtons.forEach((button) => {
    button.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const mood = btn?.dataset?.mood || '';
      if (moodInput) moodInput.value = mood;
      handleSearch(e);
    });
  });

  if (movieModal) {
    movieModal.addEventListener('click', (e) => {
      if (e.target === movieModal) closeModal();
    });
  }

  if (logoHome) {
    logoHome.style.cursor = 'pointer';
    logoHome.addEventListener('click', () => {
      window.location.reload();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (movieModal && movieModal.style.display === 'flex') closeModal();
    }
  });

  // ---------- Initialize ----------
  document.addEventListener('DOMContentLoaded', () => {
    loadTrendingMovies();
    displayHistory();
  });

  console.log('🎬 CineVibe loaded! Ready to find your perfect vibe.');
})();
