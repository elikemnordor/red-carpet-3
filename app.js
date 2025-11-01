'use strict';

(function() {
  const cfg = window.CONFIG;

  // State
  let items = [];
  let currentIndex = 0;
  let playing = true;
  let liveMode = true; // when true, we follow newest
  let lastInteractionAt = Date.now();
  let lastTopId = null; // track newest item id to detect new arrivals
  let lastNewTopAt = 0; // when a new top item was first seen
  let lastSnapAt = 0;   // when we last snapped to newest
  let pendingNewTopId = null; // remember pending newest to snap to

  // Timers
  let slideTimer = null;
  let pollTimer = null;

  // Elements
  const stageImg = document.getElementById('stage-image');
  const photoNameEl = document.getElementById('photo-name');
  const photoTimeEl = document.getElementById('photo-time');
  const qrImg = document.getElementById('qr-image');
  const filmstripEl = document.getElementById('filmstrip');
  const toastEl = document.getElementById('toast');
  const liveBadge = document.getElementById('live-badge');
  const netBadge = document.getElementById('net-badge');

  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const playBtn = document.getElementById('play-btn');
  const liveBtn = document.getElementById('live-btn');

  // Utils
  const fmtTime = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { hour12: false });
    } catch {
      return '';
    }
  };

  // Build a high-res thumbnail URL if possible (fallback to original if unknown format)
  const hiResThumb = (thumb) => {
    if (!thumb) return '';
    try {
      // Replace trailing =s### with =s2000 to request a bigger size
      const replaced = thumb.replace(/=s\d+$/i, '=s2000');
      if (replaced !== thumb) return replaced;
      // If there's no size param, append one
      const url = new URL(thumb);
      if (!/=s\d+$/i.test(url.toString())) return url.toString() + (url.search ? '' : '') + '=s2000';
      return url.toString();
    } catch {
      return thumb;
    }
  };

  const embedUserContentFromId = (id) => id ? `https://drive.usercontent.google.com/uc?export=view&id=${encodeURIComponent(id)}` : '';
  const embedDriveFromId = (id) => id ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}` : '';
  const viewFromWebContent = (wcl) => {
    if (!wcl) return '';
    try {
      const url = new URL(wcl);
      url.searchParams.set('export', 'view');
      return url.toString();
    } catch {
      return '';
    }
  };

  const showToast = (msg, ms = 2000) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), ms);
  };

  const setNet = (ok) => {
    if (ok) {
      netBadge.classList.add('hidden');
    } else {
      netBadge.classList.remove('hidden');
    }
  };

  const markInteraction = () => { lastInteractionAt = Date.now(); };

  // Render
  function renderStage(idx) {
    if (!items.length) return;
    const it = items[idx];

    // Stage image: try a sequence of candidates and use the first that loads
    const candidates = [];
    if (it.thumbnailLink) candidates.push(hiResThumb(it.thumbnailLink));
    candidates.push(embedUserContentFromId(it.id));
    candidates.push(embedDriveFromId(it.id));
    if (it.webContentLink) candidates.push(viewFromWebContent(it.webContentLink));

    stageImg.style.opacity = 0;

    let tried = 0;
    const tryNext = () => {
      if (tried >= candidates.length) {
        stageImg.src = '';
        stageImg.alt = 'Failed to load image';
        stageImg.style.opacity = 1;
        return;
      }
      const url = candidates[tried++];
      if (!url) { tryNext(); return; }
      const probe = new Image();
      probe.onload = () => {
        stageImg.src = url;
        stageImg.alt = it.name || '';
        stageImg.style.opacity = 1;
      };
      probe.onerror = tryNext;
      probe.src = url;
    };
    tryNext();

    // Caption
    photoNameEl.textContent = it.name || '';
    photoTimeEl.textContent = fmtTime(it.createdTime);

    // QR
    qrImg.src = it.qrCodeUrl || '';
    qrImg.alt = 'QR code';

    // Filmstrip active state
    filmstripEl.querySelectorAll('.thumb').forEach((n, i) => {
      n.classList.toggle('active', i === idx);
    });
  }

  function renderFilmstrip() {
    filmstripEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => {
      const div = document.createElement('div');
      div.className = 'thumb' + (i === currentIndex ? ' active' : '');
      const ring = document.createElement('div');
      ring.className = 'ring';
      const img = document.createElement('img');
      img.src = it.thumbnailLink || embedUrlFromId(it.id);
      img.alt = it.name || '';
      div.appendChild(img);
      div.appendChild(ring);
      div.addEventListener('click', () => {
        liveMode = false;
        liveBadge.textContent = 'PAUSED';
        currentIndex = i;
        renderStage(currentIndex);
        stopSlideshow();
        markInteraction();
      });
      frag.appendChild(div);
    });
    filmstripEl.appendChild(frag);
  }

  // Slideshow
  function next() {
    if (!items.length) return;
    currentIndex = (currentIndex + 1) % items.length;
    renderStage(currentIndex);
  }
  function prev() {
    if (!items.length) return;
    currentIndex = (currentIndex - 1 + items.length) % items.length;
    renderStage(currentIndex);
  }
  function play() {
    if (slideTimer) return;
    playing = true;
    playBtn.textContent = '❚❚';
    slideTimer = setInterval(() => {
      if (liveMode) {
        const recentWindow = Math.min(items.length || 0, cfg.RECENT_WINDOW || 12);
        const jumpProb = cfg.LIVE_RANDOM_JUMP_PROB ?? 0.2;

        const doRandom = Math.random() < jumpProb && items.length > 1;
        if (doRandom) {
          // Jump into older range if possible, else anywhere but current
          let target = 0;
          if (items.length > recentWindow) {
            const min = recentWindow;
            const max = items.length - 1;
            target = Math.floor(Math.random() * (max - min + 1)) + min;
          } else {
            // pick any different index
            do {
              target = Math.floor(Math.random() * items.length);
            } while (target === currentIndex && items.length > 1);
          }
          currentIndex = target;
          renderStage(currentIndex);
        } else {
          // Cycle within recent window, newest-first
          const windowSize = Math.max(1, recentWindow);
          // If we're outside recent, snap to newest
          if (currentIndex >= windowSize) currentIndex = 0;
          currentIndex = (currentIndex + 1) % windowSize;
          renderStage(currentIndex);
        }
      } else {
        next();
      }
    }, cfg.SLIDE_INTERVAL_MS);
  }
  function stopSlideshow() {
    playing = false;
    playBtn.textContent = '▶';
    if (slideTimer) { clearInterval(slideTimer); slideTimer = null; }
  }

  // Idle auto-resume
  setInterval(() => {
    const idle = Date.now() - lastInteractionAt > cfg.IDLE_TIMEOUT_MS;
    if (idle) {
      liveMode = true;
      liveBadge.textContent = 'LIVE';
      if (!playing) play();
      if (items.length) {
        currentIndex = 0;
        renderStage(currentIndex);
      }
    }
  }, 1000);

  // Controls
  prevBtn.addEventListener('click', () => { prev(); stopSlideshow(); liveMode = false; liveBadge.textContent = 'PAUSED'; markInteraction(); });
  nextBtn.addEventListener('click', () => { next(); stopSlideshow(); liveMode = false; liveBadge.textContent = 'PAUSED'; markInteraction(); });
  playBtn.addEventListener('click', () => { playing ? stopSlideshow() : play(); liveMode = playing; liveBadge.textContent = playing ? 'LIVE' : 'PAUSED'; markInteraction(); });
  liveBtn.addEventListener('click', () => { liveMode = true; liveBadge.textContent = 'LIVE'; if (!playing) play(); if (items.length) { currentIndex = 0; renderStage(currentIndex); } markInteraction(); });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { prevBtn.click(); }
    if (e.key === 'ArrowRight') { nextBtn.click(); }
    if (e.key.toLowerCase() === ' ') { playBtn.click(); }
    if (e.key.toLowerCase() === 'l') { liveBtn.click(); }
  });
  ['mousemove','mousedown','touchstart','wheel','keydown'].forEach(evt => {
    window.addEventListener(evt, markInteraction, { passive: true });
  });

  // Data handling
  function sortItems(arr) {
    return arr.slice().sort((a, b) => {
      const ta = +new Date(a.createdTime || 0);
      const tb = +new Date(b.createdTime || 0);
      return tb - ta; // newest first
    });
  }

  function dedupe(arr) {
    const seen = new Set();
    const res = [];
    for (const it of arr) {
      if (it && it.id && !seen.has(it.id)) {
        seen.add(it.id);
        res.push(it);
      }
    }
    return res;
  }

  function clampMax(arr) {
    if (arr.length <= cfg.MAX_ITEMS) return arr;
    return arr.slice(0, cfg.MAX_ITEMS);
  }

  async function fetchData() {
    try {
      const resp = await fetch(cfg.DATA_URL, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      setNet(true);

      // Track previous top id to detect new arrivals
      const prevTop = items.length ? items[0]?.id : null;

      // Merge with existing by id
      const map = new Map(items.map(i => [i.id, i]));
      for (const it of data) {
        map.set(it.id, { ...map.get(it.id), ...it });
      }
      let merged = Array.from(map.values());
      merged = sortItems(merged);
      merged = dedupe(merged);
      merged = clampMax(merged);

      const had = items.length;
      items = merged;
      const newTop = items.length ? items[0]?.id : null;

      if (!had && items.length) {
        currentIndex = 0;
        renderFilmstrip();
        renderStage(currentIndex);
        play();
        lastTopId = newTop;
        pendingNewTopId = null;
        return;
      }

      // Always refresh filmstrip after merge
      renderFilmstrip();

      // New arrivals handling: delay snapping to newest to allow appreciation
      if (liveMode && newTop && newTop !== prevTop) {
        lastNewTopAt = Date.now();
        pendingNewTopId = newTop;
      }

      // Determine if we should snap now
      const havePending = liveMode && pendingNewTopId && pendingNewTopId === newTop;
      const delayOk = Date.now() - lastNewTopAt >= (cfg.NEWITEM_SNAP_DELAY_MS || 0);
      const cooldownOk = Date.now() - lastSnapAt >= (cfg.NEWITEM_SNAP_COOLDOWN_MS || 0);
      if (havePending && delayOk && cooldownOk) {
        currentIndex = 0;
        lastSnapAt = Date.now();
        pendingNewTopId = null;
      } else if (currentIndex >= items.length) {
        // Clamp if list shrank
        currentIndex = Math.max(0, items.length - 1);
      }
      renderStage(currentIndex);
      lastTopId = newTop;
    } catch (err) {
      setNet(false);
      console.error('Fetch failed', err);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchData, cfg.POLL_INTERVAL_MS);
  }

  // Initial load
  fetchData();
  startPolling();
})();
