/*
  CineVibe — App Script (Rooms + Recommendations + BG Music + Trailer Fix)
  -----------------------------------------------------------------------
  - Robust DOM guards (won't crash if some elements are missing)
  - Trailer sound fix: stop/unload iframe & pause/reset <video> on modal close
  - Background music engine: loops based on mood/genre keywords
  - Optional Firebase hooks (history) — safe if not configured
*/

(() => {
  'use strict';

  // ---------- Utilities ----------
  const $  = (id)  => /** @type {HTMLElement|null} */ (document.getElementById(id));
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const noop = () => {};
  const withTry = async (fn, fallback=null) => { try { return await fn(); } catch { return fallback; } };
  const normalizeBaseUrl = (u) => (u || '').replace(/\/?$/,'');
  const toYear = (d) => { const y = new Date(d).getFullYear(); return Number.isFinite(y) && y > 1900 ? y : ''; };

  function toast(msg){ try{ const el=document.createElement('div'); el.className='cv-toast';
    Object.assign(el.style,{position:'fixed',left:'50%',transform:'translateX(-50%)',bottom:'24px',background:'rgba(0,0,0,0.8)',color:'#fff',padding:'10px 14px',borderRadius:'12px',fontFamily:'system-ui,sans-serif',fontSize:'14px',zIndex:99999,opacity:'0',transition:'opacity 200ms ease'}); el.textContent=msg;
    document.body.appendChild(el); requestAnimationFrame(()=>{ el.style.opacity='1'; }); setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=>el.remove(),240); },1800);
  }catch{ alert(msg); } }

  async function fetchJSON(url, options={}, {timeoutMs=15000}={}){
    const ctrl=new AbortController(); const id=setTimeout(()=>ctrl.abort(),timeoutMs);
    try{
      const res=await fetch(url,{...options,signal:ctrl.signal});
      const text=await res.text(); let json={};
      try{ json=text?JSON.parse(text):{}; }catch{ json={raw:text}; }
      if(!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      return json;
    } finally { clearTimeout(id); }
  }

  // ---------- State / DOM ----------
  let isLoading=false, currentMovies=[], showingHistory=false;

  const searchForm       = $('searchForm');
  const moodInput        = /** @type {HTMLInputElement|null} */ ($('moodInput'));
  const searchButton     = /** @type {HTMLButtonElement|null} */ ($('searchButton'));
  const loadingScreen    = $('loadingScreen');
  const moviesGrid       = $('moviesGrid');
  const moviesSection    = $('moviesSection');
  const moviesTitle      = $('moviesTitle');
  const movieModal       = $('movieModal');
  const modalCloseBtn    = $('modalClose');
  const suggestionButtons= $$('.suggestion-button');
  const historyToggle    = $('historyToggle');
  const historySection   = $('historySection');
  const historyGrid      = $('historyGrid');
  const trendingSection  = $('trendingSection');
  const trendingGrid     = $('trendingGrid');
  const moodSuggestions  = $('moodSuggestions');
  const logoHome         = $('logoHome');
  const heroSection      = $('heroSection');

  // Rooms UI (optional)
  const createRoomModal  = $('createRoomModal');
  const joinRoomModal    = $('joinRoomModal');
  const createRoomClose  = $('createRoomClose');
  const joinRoomClose    = $('joinRoomClose');
  const crDisplayName    = /** @type {HTMLInputElement|null} */ ($('crDisplayName'));
  const crRoomName       = /** @type {HTMLInputElement|null} */ ($('crRoomName'));
  const crRoomId         = /** @type {HTMLInputElement|null} */ ($('crRoomId'));
  const regenRoomId      = $('regenRoomId');
  const copyRoomIdBtn    = $('copyRoomId');
  const crJoinBtn        = $('crJoinBtn');
  const crShareBtn       = $('crShareBtn');
  const jrDisplayName    = /** @type {HTMLInputElement|null} */ ($('jrDisplayName'));
  const jrRoomId         = /** @type {HTMLInputElement|null} */ ($('jrRoomId'));
  const jrJoinBtn        = $('jrJoinBtn');

  // Music UI (optional)
  const musicToggleBtn   = $('musicToggle');
  const musicVolume      = /** @type {HTMLInputElement|null} */ ($('musicVolume'));

  // API base
  const API_BASE_URL = normalizeBaseUrl(
    location.hostname.includes('localhost') ? 'http://localhost:5000/api'
                                            : 'https://cinevibe-ej8v.onrender.com/api'
  );

  // ---------- Home rows helpers ----------
  const HOME_ROW_IDS = [
    'rowTrendingUS','rowTrendingIN',
    'rowNowUS','rowNowIN',
    'rowUpcomingUS','rowUpcomingIN',
    'rowTrendingAnime','rowUpcomingAnime'
  ];

  function hideHomeSections() {
    if (heroSection)       heroSection.style.display = 'none';
    if (trendingSection)   trendingSection.style.display = 'none';
    if (historySection)    historySection.style.display = 'none';
    if (moodSuggestions)   moodSuggestions.style.display = 'none';
    HOME_ROW_IDS.forEach(id => { const sec = $(id); if (sec) sec.style.display = 'none'; });
  }

  function showHomeSections() {
    if (heroSection)       heroSection.style.display = 'block';
    if (trendingSection)   trendingSection.style.display = 'block';
    if (historySection)    historySection.style.display = 'block';
    if (moodSuggestions)   moodSuggestions.style.display = 'block';
    HOME_ROW_IDS.forEach(id => { const sec = $(id); if (sec) sec.style.display = 'block'; });
    if (moviesSection)     moviesSection.classList.remove('show');
  }

  // ---------- Rooms ----------
  function randomRoomId(){ const c=()=>Math.random().toString(36).slice(2,6).toUpperCase(); return `${c()}-${c()}-${c()}-${c()}`; }
  function roomLink(roomId){ const url=new URL(location.href); if(roomId) url.searchParams.set('roomId',roomId); return url.toString(); }
  async function saveRoomToFirebase(room){ return withTry(async()=>{ if (window.firebase?.db){ const ref=window.firebase.collection(window.firebase.db,'rooms'); await window.firebase.addDoc(ref,room); return true; } return false; },false); }
  function saveRoomLocal(room){ const key='cinevibe_rooms'; const rooms=JSON.parse(localStorage.getItem(key)||'[]'); const i=rooms.findIndex(r=>r.roomId===room.roomId); if(i>=0) rooms[i]=room; else rooms.push(room); localStorage.setItem(key,JSON.stringify(rooms)); }
  function getRoomLocal(roomId){ const rooms=JSON.parse(localStorage.getItem('cinevibe_rooms')||'[]'); return rooms.find(r=>r.roomId===roomId)||null; }

  const createRoomBtn = $('createRoom');
  const joinRoomBtn   = $('joinRoom');
  if (createRoomBtn) createRoomBtn.addEventListener('click', () => {
    if (!createRoomModal) return alert('Create Room UI not found.');
    if (crDisplayName) crDisplayName.value = localStorage.getItem('cinevibe_displayName') || '';
    if (crRoomName) crRoomName.value = '';
    if (crRoomId) crRoomId.value = randomRoomId();
    createRoomModal.style.display = 'flex';
  });
  if (joinRoomBtn) joinRoomBtn.addEventListener('click', () => {
    if (!joinRoomModal) return alert('Join Room UI not found.');
    if (jrDisplayName) jrDisplayName.value = localStorage.getItem('cinevibe_displayName') || '';
    if (jrRoomId) jrRoomId.value = '';
    joinRoomModal.style.display = 'flex';
  });
  if (createRoomClose) createRoomClose.addEventListener('click', () => { if (createRoomModal) createRoomModal.style.display='none'; });
  if (joinRoomClose)   joinRoomClose.addEventListener('click',   () => { if (joinRoomModal)   joinRoomModal.style.display='none'; });

  if (createRoomModal) createRoomModal.addEventListener('click', (e)=>{ if (e.target===createRoomModal) createRoomModal.style.display='none'; });
  if (joinRoomModal)   joinRoomModal.addEventListener('click',   (e)=>{ if (e.target===joinRoomModal)   joinRoomModal.style.display='none'; });



  if (regenRoomId) regenRoomId.addEventListener('click', ()=>{ const i=$('crRoomId'); if (i) i.value = randomRoomId(); });
  if (copyRoomIdBtn) copyRoomIdBtn.addEventListener('click', async ()=>{
    const i=$('crRoomId'); if (!i) return;
    const ok = await navigator.clipboard.writeText(i.value).then(()=>true).catch(()=>false);
    ok ? toast('Room ID copied!') : alert('Copy failed. Please copy manually.');
  });
  if (crShareBtn) crShareBtn.addEventListener('click', async ()=>{
    const i = /** @type {HTMLInputElement|null} */ ($('crRoomId'));
    const id = i?.value?.trim(); if (!id) return alert('Generate a Room ID first.');
    const link = roomLink(id);
    if (navigator.share) { try { await navigator.share({ title:'Join my CineVibe Room', text:'Let’s watch together!', url:link }); return; } catch {}
    }
    const ok = await navigator.clipboard.writeText(link).then(()=>true).catch(()=>false);
    ok ? toast('Link copied to clipboard!') : alert(`Share this link:\n${link}`);
  });
  if (crJoinBtn) crJoinBtn.addEventListener('click', async ()=>{
    const displayName=/** @type {HTMLInputElement|null} */ ($('crDisplayName'))?.value?.trim();
    const roomName=/** @type {HTMLInputElement|null} */ ($('crRoomName'))?.value?.trim();
    const roomId=/** @type {HTMLInputElement|null} */ ($('crRoomId'))?.value?.trim();
    if (!displayName || !roomName || !roomId) return alert('Please fill all fields.');
    const room={roomId,roomName,host:displayName,createdAt:new Date().toISOString()};
    const saved=await saveRoomToFirebase(room); saveRoomLocal(room); localStorage.setItem('cinevibe_displayName',displayName||'');
    const url=new URL(location.href); url.searchParams.set('roomId',roomId); url.searchParams.set('name',encodeURIComponent(displayName||'')); history.replaceState(null,'',url.toString());
    alert(saved?'Room created & joined!':'Room created locally & joined!'); if (createRoomModal) createRoomModal.style.display='none';
  });
  if (jrJoinBtn) jrJoinBtn.addEventListener('click', async ()=>{
    const displayName=/** @type {HTMLInputElement|null} */ ($('jrDisplayName'))?.value?.trim();
    const roomId=(/** @type {HTMLInputElement|null} */ ($('jrRoomId'))?.value||'').trim().toUpperCase();
    if(!displayName || !roomId) return alert('Please enter display name and room ID.');
    let room=null;
    try{
      if (window.firebase?.db){
        const ref=window.firebase.collection(window.firebase.db,'rooms');
        const q=window.firebase.query(ref, window.firebase.orderBy('roomId'), window.firebase.limit(25));
        const snap=await window.firebase.getDocs(q);
        snap.forEach(doc=>{ if (doc.data()?.roomId===roomId) room=doc.data(); });
      }
    }catch(e){ console.warn('Room lookup error:',e); }
    if(!room) room=getRoomLocal(roomId) || {roomId,roomName:'CineVibe Room'};
    localStorage.setItem('cinevibe_displayName',displayName||'');
    const url=new URL(location.href); url.searchParams.set('roomId',roomId); url.searchParams.set('name',encodeURIComponent(displayName||'')); history.replaceState(null,'',url.toString());
    alert(`Joined ${room.roomName || 'room'}!`); if (joinRoomModal) joinRoomModal.style.display='none';
  });

  // ---------- Firebase history (optional) ----------
  async function saveSearchToHistory(mood){
    await withTry(async()=>{ if(window.firebase?.db){
      await window.firebase.addDoc(window.firebase.collection(window.firebase.db,'searchHistory'),
        { mood, timestamp: window.firebase.serverTimestamp(), userId: 'guest' });
    }});
  }
  async function loadSearchHistory(){
    await withTry(async()=>{
      if(!historyGrid) return;
      if(window.firebase?.db){
        const historyRef = window.firebase.collection(window.firebase.db,'searchHistory');
        const q = window.firebase.query(historyRef, window.firebase.orderBy('timestamp','desc'), window.firebase.limit(10));
        const snap = await window.firebase.getDocs(q);
        const history=[]; snap.forEach(doc=>{ const d=doc.data()||{}; history.push({ id:doc.id, mood:d.mood||'', timestamp:d.timestamp?.toDate?.()||new Date() });});
        displayHistory(history);
      } else displayHistory([]);
    });
  }
  function displayHistory(history){
    if(!historyGrid) return;
    historyGrid.innerHTML='';
    if(!history?.length){ historyGrid.innerHTML='<p style="text-align:center;color:var(--text-muted);">No search history yet</p>'; return; }
    history.forEach(item=>{
      const el=document.createElement('div'); el.className='history-item';
      el.onclick=()=>{ if(moodInput) moodInput.value=item.mood; handleSearch({preventDefault:noop}); toggleHistory(); };
      el.innerHTML=`<div class="history-mood">${item.mood}</div><div class="history-date">${item.timestamp instanceof Date ? item.timestamp.toLocaleDateString() : ''}</div>`;
      historyGrid.appendChild(el);
    });
  }
  function toggleHistory(){
    showingHistory=!showingHistory;
    if(!historySection || !trendingSection || !moodSuggestions || !moviesSection || !historyToggle) return;
    if(showingHistory){
      historySection.classList.add('show'); moviesSection.classList.remove('show');
      trendingSection.style.display='none'; moodSuggestions.style.display='none'; historyToggle.textContent='🎬 Movies'; loadSearchHistory();
    } else {
      historySection.classList.remove('show'); trendingSection.style.display='block'; moodSuggestions.style.display='block';
      historyToggle.textContent='📚 History'; if(currentMovies.length>0) moviesSection.classList.add('show');
    }
  }

  // ---------- Home rows (trending/now/upcoming) ----------
  function renderRow({title,containerId,movies}){
    // Skip rendering if nothing to show
    if (!movies || movies.length === 0) return;

    let section=$(containerId);
    if(!section){
      section=document.createElement('section'); section.id=containerId; section.className='trending-section';
      section.innerHTML=`<h2 class="section-title">${title}</h2><div class="trending-grid"></div>`;
      (document.querySelector('.container')||document.body).appendChild(section);
    }
    const grid = section.querySelector('.trending-grid'); if(!grid) return;
    grid.innerHTML='';
    (movies||[]).slice(0,12).forEach((m,i)=>{
      const card=document.createElement('div'); card.className='trending-card'; card.style.animationDelay=`${i*0.07}s`;
      card.onclick=()=>openMovieModal(m);
      const rating=Number.isFinite(m?.rating)?Number(m.rating).toFixed(1):'—';
      card.innerHTML=`<img src="${m.poster||'/placeholder-movie.jpg'}" alt="${m.title}" class="trending-poster" loading="lazy">
        <div class="trending-info"><h3 class="trending-title">${m.title}</h3><p class="trending-rating">⭐ ${rating}</p></div>`;
      grid.appendChild(card);
    });
  }

  // Load and render all home rows, including Anime
  async function loadHomeRows(){
    try{
      const t = await fetchJSON(`${API_BASE_URL}/trending/all`).catch(()=>null);
      if(t?.success){
        renderRow({title:'🔥 Trending – Hollywood', containerId:'rowTrendingUS', movies:t.hollywood});
        renderRow({title:'💥 Trending – Bollywood',  containerId:'rowTrendingIN', movies:t.bollywood});
        renderRow({title:'🍣 Trending – Anime',      containerId:'rowTrendingAnime', movies:t.anime});
      }

      const np = await fetchJSON(`${API_BASE_URL}/now-playing`).catch(()=>null);
      if(np?.success){
        renderRow({title:'🎟️ In Cinemas Now – US',   containerId:'rowNowUS', movies:np.us});
        renderRow({title:'🎬 In Cinemas Now – India', containerId:'rowNowIN', movies:np.in});
      }

      const up = await fetchJSON(`${API_BASE_URL}/upcoming`).catch(()=>null);
      if(up?.success){
        renderRow({title:'⏳ Upcoming – Hollywood', containerId:'rowUpcomingUS', movies:up.hollywood});
        renderRow({title:'🌟 Upcoming – Bollywood', containerId:'rowUpcomingIN', movies:up.bollywood});
        renderRow({title:'🎌 Upcoming – Anime',     containerId:'rowUpcomingAnime', movies:up.anime});
      }
    }catch(e){ console.error('Home rows load error:',e); }
  }

  // ---------- Trending (simple top grid) ----------
  async function loadTrendingMovies(){
    try{
      const data=await fetchJSON(`${API_BASE_URL}/trending`);
      if(data?.success && Array.isArray(data.movies)) displayTrendingMovies(data.movies.slice(0,8));
    }catch(err){ console.error('Failed to load trending movies:',err); }
  }
  function displayTrendingMovies(movies){
    if(!trendingGrid) return; trendingGrid.innerHTML='';
    (movies||[]).forEach((movie,i)=>{
      const card=document.createElement('div'); card.className='trending-card'; card.style.animationDelay=`${Math.min(i*0.1,5)}s`;
      card.onclick=()=>openMovieModal(movie);
      const rating=Number.isFinite(movie?.rating)?Number(movie.rating).toFixed(1):'—';
      card.innerHTML=`<img src="${movie?.poster||'/placeholder-movie.jpg'}" alt="${movie?.title||'Movie'}" class="trending-poster" loading="lazy">
        <div class="trending-info"><h3 class="trending-title">${movie?.title||''}</h3><p class="trending-rating">⭐ ${rating}</p></div>`;
      trendingGrid.appendChild(card);
    });
  }

  // ---------- Search ----------
  async function handleSearch(e){
    if (e?.preventDefault) e.preventDefault();
    if (isLoading) return;
    const mood = moodInput?.value?.trim(); if(!mood) return;

    // Auto-enable music on first search and pick theme
    if (!bgMusicEnabled) { await enableBgMusic(); if (musicToggleBtn) musicToggleBtn.textContent='🔊 Music: On'; }
    setMoodMusicFromText(mood);

    setLoading(true);
    try{
      const data = await fetchJSON(`${API_BASE_URL}/recommend`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ mood })
      });
      if(!data?.movies) throw new Error(data?.error || 'Failed to get recommendations');

      currentMovies = data.movies;
      displayMovies(currentMovies);
      if (moviesTitle) moviesTitle.textContent = `Movies for "${mood}"`;
      await saveSearchToHistory(mood);

      if (showingHistory) toggleHistory();
      hideHomeSections();
      if (moviesSection) moviesSection.classList.add('show');
    }catch(err){
      console.error('Search error:',err);
      alert('Failed to get movie recommendations. Please try again.');
    }finally{ setLoading(false); }
  }

  // ---------- Loading UI ----------
  function setLoading(loading){
    isLoading=!!loading;
    if (loadingScreen) loadingScreen.style.display = loading ? 'flex' : 'none';
    if (searchButton){
      searchButton.disabled = loading;
      searchButton.dataset.origText = searchButton.dataset.origText || searchButton.textContent || 'Find Movies';
      searchButton.textContent = loading ? 'Searching...' : (searchButton.dataset.origText || 'Find Movies');
    }
    if (loading) startLoadingAnimation();
  }
  function startLoadingAnimation(){
    const dotsEl = $('loadingDots'); if(!dotsEl) return;
    let dots=''; const it=setInterval(()=>{ if(!isLoading){ clearInterval(it); return; } dots=dots.length>=3?'':dots+'.'; dotsEl.textContent=dots; },500);
  }

  // ---------- Movies grid ----------
  function displayMovies(movies){
    if(!moviesGrid) return; moviesGrid.innerHTML='';
    (movies||[]).forEach((m,i)=> moviesGrid.appendChild(createMovieCard(m,i)));
  }
  function createMovieCard(movie,index){
    const card=document.createElement('div'); card.className='movie-card'; card.style.animationDelay=`${Math.min(index*0.1,5)}s`;
    card.onclick=()=>openMovieModal(movie);
    const platforms=(movie?.ottPlatforms||[]).filter(p=>p?.available).slice(0,3).map(p=>`<span class="platform-badge">${p.name}</span>`).join('');
    card.innerHTML=`<img src="${movie?.poster||'/placeholder-movie.jpg'}" alt="${movie?.title||'Movie'}" class="movie-poster" loading="lazy">
      <div class="movie-info"><h3 class="movie-title">${movie?.title||''}</h3><p class="movie-year">${toYear(movie?.releaseDate)}</p><div class="movie-platforms">${platforms}</div></div>`;
    return card;
  }

  // ---------- Modal + trailer ----------
  function openMovieModal(movie){
    const modalContent=$('modalContent'); if(!movieModal || !modalContent) return;
    pauseBgForTrailer();
    const platforms=(movie?.ottPlatforms||[]).map(p=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem;border:1px solid ${p?.available?'var(--primary-start)':'var(--border-color)'};border-radius:.5rem;margin-bottom:.5rem;background:${p?.available?'rgba(200,50,255,0.1)':'var(--bg-secondary)'};">
        <span style="color:${p?.available?'var(--text-primary)':'var(--text-secondary)'};">${p?.name||''}</span>
        ${p?.available && p?.url ? `<a href="${p.url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-cyan);text-decoration:none;font-weight:600;">Watch</a>`:''}
      </div>`).join('');
    const trailerSrc=(()=>{ if(!movie?.trailerUrl) return ''; const url=new URL(movie.trailerUrl,location.href); if(!url.searchParams.has('enablejsapi')) url.searchParams.set('enablejsapi','1'); return url.toString(); })();
    const rating=Number.isFinite(movie?.rating)?Number(movie.rating).toFixed(1):'—';
    const hasRuntime=Number.isFinite(movie?.runtime); const hours=hasRuntime?Math.floor(Number(movie.runtime)/60):0; const mins=hasRuntime?Number(movie.runtime)%60:0;

    modalContent.innerHTML = `
      <button class="modal-close" id="modalClose">&times;</button>
      ${movie?.backdrop ? `<img src="${movie.backdrop}" style="width:100%;height:300px;object-fit:cover;border-radius:1rem 1rem 0 0;">`:''}
      <div style="padding:2rem;">
        <h2 style="font-family:'Space Grotesk',sans-serif;font-size:2rem;margin-bottom:1rem;background:var(--gradient-primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">${movie?.title||''}</h2>
        <div style="display:flex;gap:1rem;margin-bottom:1rem;color:var(--text-secondary);">
          <span style="color:var(--accent-green);">⭐ ${rating}</span>
          <span>📅 ${toYear(movie?.releaseDate)}</span>
          ${hasRuntime?`<span>⏱ ${hours}h ${mins}m</span>`:''}
        </div>
        <p style="line-height:1.6;margin-bottom:2rem;color:var(--text-secondary);">${movie?.overview||''}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;">
          <div>
            <h3 style="margin-bottom:1rem;color:var(--accent-cyan);">Genres</h3>
            <div style="display:flex;flex-wrap:wrap;gap:.5rem;">
              ${(movie?.genres||[]).map(g=>`<span style="padding:.25rem .75rem;background:var(--gradient-primary);border-radius:1rem;font-size:.8rem;color:white;">${g}</span>`).join('')}
            </div>
            ${movie?.director?`<h3 style="margin:1rem 0 .5rem;color:var(--accent-cyan);">Director</h3><p style="color:var(--text-secondary);">${movie.director}</p>`:''}
          </div>
          <div>
            <h3 style="margin-bottom:1rem;color:var(--accent-cyan);">Available On</h3>
            ${platforms}
          </div>
        </div>
        ${movie?.trailerUrl?`
          <div style="margin-top:2rem;">
            <h3 style="margin-bottom:1rem;color:var(--accent-cyan);">Trailer</h3>
            <iframe id="cvTrailer" src="${trailerSrc}" width="100%" height="300" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="border-radius:.5rem;border:1px solid var(--border-color);"></iframe>
          </div>`:''}
      </div>`;
    const closeBtn=$('modalClose'); if(closeBtn) closeBtn.addEventListener('click', closeModal, {once:true});
    movieModal.addEventListener('click', (e)=>{ if(e.target===movieModal) closeModal(); }, {once:true});
    movieModal.style.display='flex';
  }
  function stopAllMediaInModal(){
    const modalContent=$('modalContent'); if(!modalContent) return;
    modalContent.querySelectorAll('video').forEach(v=>{ try{ v.pause(); v.currentTime=0; }catch{} });
    modalContent.querySelectorAll('iframe').forEach(frame=>{
      const src=frame.getAttribute('src'); if(!src) return;
      try{ frame.contentWindow?.postMessage(JSON.stringify({event:'command',func:'stopVideo',args:[]}), '*'); }catch{}
      frame.setAttribute('src','about:blank');
    });
  }
  function closeModal(){
    if(!movieModal) return;
    stopAllMediaInModal();
    movieModal.style.display='none';
    resumeBgAfterTrailer();
  }

  // ---------- BG Music Engine ----------
  let bgAudio=null, bgMusicEnabled=false, lastTheme=null;
  const BG_MUSIC = {
    romantic:'/music/Fall-In-Love-chosic.com_.mp3',
    sad:'/music/scott-buckley-moonlight(chosic.com).mp3',
    suspense:'/music/Hidden-Agenda(chosic.com).mp3',
    horror:'/music/Incantation-chosic.com_.mp3',
    comedy:'/music/Monkeys-Spinning-Monkeys(chosic.com).mp3',
    action:'/music/Last-Call-chosic.com_.mp3',
    scifi:'/music/suspense-sci-fi-underscore-music-loop-300215.mp3',
    chill:'/music/Heart-Of-The-Ocean(chosic.com).mp3',
    upbeat:'/music/HEROICCC(chosic.com).mp3',
  };
  function pickThemeFromText(txt){
    const t=(txt||'').toLowerCase();
    if (/(romance|romantic|love|sapphic|heartwarming|tearjerker|kiss|date)/.test(t)) return 'romantic';
    if (/(sad|melancholy|tragic|cry|breakup|lonely|somber)/.test(t)) return 'sad';
    if (/(suspense|thrill|mystery|twist|mind-?bending|tense|noir|detective)/.test(t)) return 'suspense';
    if (/(horror|scary|terrifying|haunt|slasher|possession|demonic)/.test(t)) return 'horror';
    if (/(comedy|funny|laugh|quirky|sitcom|rom-?com)/.test(t)) return 'comedy';
    if (/(action|fight|battle|war|chase|adrenaline|superhero)/.test(t)) return 'action';
    if (/(sci[- ]?fi|science fiction|space|cyberpunk|futur)/.test(t)) return 'scifi';
    if (/(feel[- ]?good|uplifting|happy|optimistic|wholesome|party)/.test(t)) return 'upbeat';
    if (/(chill|slice of life|calm|cozy|comfort|lofi|cult classic|underground)/.test(t)) return 'chill';
    return 'chill';
  }
  function ensureBgAudio(){ if(bgAudio) return bgAudio; bgAudio=new Audio(); bgAudio.loop=true; bgAudio.volume = musicVolume ? Number(musicVolume.value) : 0.25; return bgAudio; }
  async function setMoodMusicFromText(txt){ const theme=pickThemeFromText(txt); await setBgMusicTheme(theme); }
  async function setBgMusicTheme(theme){
    try{ ensureBgAudio(); const src=BG_MUSIC[theme]; if(!src) return;
      if(lastTheme===theme && !bgAudio.paused) return;
      const absSrc=new URL(src,location.href).toString();
      if(bgAudio.src!==absSrc){ bgAudio.src=absSrc; bgAudio.load(); }
      lastTheme=theme;
      if(bgMusicEnabled){ await bgAudio.play().catch(()=>{}); }
    }catch(e){ console.warn('BG music error:',e); }
  }
  async function enableBgMusic(){ bgMusicEnabled=true; ensureBgAudio(); try{ await bgAudio.play(); }catch{} }
  function disableBgMusic(){ bgMusicEnabled=false; if(bgAudio){ try{ bgAudio.pause(); }catch{} } }
  function pauseBgForTrailer(){ if(bgAudio && !bgAudio.paused){ try{ bgAudio.pause(); }catch{} } }
  async function resumeBgAfterTrailer(){ if(bgAudio && bgMusicEnabled){ try{ await bgAudio.play(); }catch{} } }

  if (musicToggleBtn) {
    musicToggleBtn.addEventListener('click', async () => {
      if (!bgMusicEnabled) { await enableBgMusic(); musicToggleBtn.textContent = '🔊 Music: On'; }
      else { disableBgMusic(); musicToggleBtn.textContent = '🔇 Music: Off'; }
    });
  }
  if (musicVolume) musicVolume.addEventListener('input', () => { ensureBgAudio(); bgAudio.volume = Number(musicVolume.value); });

  // ---------- Events / Init ----------
  if (searchForm) searchForm.addEventListener('submit', handleSearch);
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
  if (historyToggle) historyToggle.addEventListener('click', toggleHistory);

  suggestionButtons.forEach((button) => {
    button.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.currentTarget);
      const mood = btn?.dataset?.mood || '';
      if (moodInput) moodInput.value = mood;
      handleSearch(e);
    });
  });

  if (movieModal) {
    movieModal.addEventListener('click', (e) => { if (e.target === movieModal) closeModal(); });
  }

  // Logo → home (reload to fully reset)
  if (logoHome) {
    logoHome.style.cursor = 'pointer';
    logoHome.addEventListener('click', () => { window.location.reload(); });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (movieModal && movieModal.style.display === 'flex') closeModal();
      if (createRoomModal && createRoomModal.style.display === 'flex') createRoomModal.style.display = 'none';
      if (joinRoomModal && joinRoomModal.style.display === 'flex') joinRoomModal.style.display = 'none';
    }
  });

  // Initial load
  document.addEventListener('DOMContentLoaded', () => {
    loadTrendingMovies();
    loadSearchHistory();
    loadHomeRows();
  });

  console.log('🎬 CineVibe loaded! Ready to find your perfect vibe.');
})();
