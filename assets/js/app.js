/* ============================================================
   app.js — StreamVault Main Application
   ============================================================ */

import { tmdb } from './tmdb.js';

/* ── Base URL (handles GitHub Pages subdirectory deploys) ── */
const BASE_URL = new URL('../../', import.meta.url).href;

/* ── Utils ─────────────────────────────────────────────── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] ?? 'Other';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function pageUrl(page, params = {}) {
  const url = new URL(page, window.location.href);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.href;
}

function toast(msg, type = 'info') {
  let container = $('#toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ── SVG Icons ─────────────────────────────────────────── */
const ICONS = {
  play:   `<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`,
  info:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  close:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  star:   `<svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>`,
  film:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/></svg>`,
  chevL:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevR:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`,
  back:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
};

/* ═══════════════════════════════════════════════════════════
   DATA MANAGER
   ═══════════════════════════════════════════════════════════ */
class DataManager {
  constructor() {
    this._raw    = null;   // raw series.json
    this._rich   = null;   // enriched: [{slug, data, tmdb}]
  }

  async load() {
    if (this._raw) return this._raw;
    try {
      const res = await fetch(`${BASE_URL}data/series.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._raw = await res.json();
      return this._raw;
    } catch (err) {
      toast('Could not load series data.', 'error');
      console.error('[DataManager] load:', err);
      return {};
    }
  }

  async loadAll() {
    if (this._rich) return this._rich;
    const raw = await this.load();
    const entries = Object.entries(raw).map(([slug, data]) => ({ slug, data }));
    this._rich = await tmdb.batchResolve(entries);

    // Attach local json data back onto each entry
    this._rich = this._rich.map(e => ({
      ...e,
      title:   e.tmdb?.title ?? e.data.title_fallback ?? e.slug,
      channel: e.data.channel ?? 'Unknown',
    }));

    return this._rich;
  }

  async getOne(slug) {
    const raw = await this.load();
    const data = raw[slug];
    if (!data) return null;
    const tmdbData = await tmdb.getDetails(data);
    return {
      slug,
      data,
      tmdb: tmdbData,
      title:   tmdbData?.title ?? data.title_fallback ?? slug,
      channel: data.channel ?? 'Unknown',
    };
  }

  /* Get unique channels from raw data */
  async getChannels() {
    const raw = await this.load();
    return [...new Set(Object.values(raw).map(s => s.channel).filter(Boolean))].sort();
  }
}

/* ═══════════════════════════════════════════════════════════
   CARD RENDERER
   ═══════════════════════════════════════════════════════════ */
function renderCard(entry) {
  const { slug, title, channel, tmdb: t } = entry;
  const poster  = t?.poster;
  const year    = t?.year ?? '';
  const rating  = t?.rating ?? '';
  const url     = pageUrl('series.html', { id: slug });
  const watchUrl = pageUrl('watch.html', { series: slug, season: 1, ep: 1 });

  const posterHtml = poster
    ? `<img class="card-poster" src="${poster}" alt="${title}" loading="lazy">`
    : `<div class="card-no-poster">${ICONS.film}<span>${title}</span></div>`;

  return `
    <div class="series-card" data-slug="${slug}" data-title="${title.toLowerCase()}" 
         data-channel="${channel.toLowerCase()}"
         data-genres="${(t?.genres ?? []).join(',').toLowerCase()}">
      ${posterHtml}
      <div class="card-overlay">
        <div class="card-title">${title}</div>
        <div class="card-meta">
          ${year ? `<span>${year}</span>` : ''}
          ${rating ? `<span class="card-rating">${ICONS.star}${rating}</span>` : ''}
          <span class="card-channel">${channel}</span>
        </div>
      </div>
      <a href="${watchUrl}" class="card-play-btn" aria-label="Play ${title}">
        ${ICONS.play}
      </a>
    </div>`;
}

function renderSkeletonRow(count = 6) {
  return Array.from({ length: count }, () =>
    `<div class="series-card skeleton-card"><div class="skeleton skeleton-poster"></div></div>`
  ).join('');
}

function buildSection(title, entries, mode = 'row') {
  if (!entries.length) return '';
  const cards = entries.map(renderCard).join('');

  if (mode === 'grid') {
    return `
      <div class="section" data-section>
        <div class="section-header"><h2 class="section-title">${title}</h2></div>
        <div class="series-grid">${cards}</div>
      </div>`;
  }

  // Row (horizontal scroll)
  return `
    <div class="section" data-section>
      <div class="section-header"><h2 class="section-title">${title}</h2></div>
      <div class="row-wrapper">
        <button class="row-arrow left" aria-label="Scroll left">${ICONS.chevL}</button>
        <div class="series-row">${cards}</div>
        <button class="row-arrow right" aria-label="Scroll right">${ICONS.chevR}</button>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   INTERSECTION OBSERVER (section fade-in)
   ═══════════════════════════════════════════════════════════ */
function observeSections() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: 0.08 });
  $$('[data-section]').forEach(el => io.observe(el));
}

/* ═══════════════════════════════════════════════════════════
   NAV SCROLL EFFECT
   ═══════════════════════════════════════════════════════════ */
function initNavScroll() {
  const nav = $('#navbar');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 60);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ═══════════════════════════════════════════════════════════
   ROW ARROWS
   ═══════════════════════════════════════════════════════════ */
function initRowArrows() {
  $$('.row-wrapper').forEach(wrapper => {
    const row = $('.series-row', wrapper);
    $('.row-arrow.left', wrapper)?.addEventListener('click', () =>
      row.scrollBy({ left: -row.clientWidth * 0.7, behavior: 'smooth' })
    );
    $('.row-arrow.right', wrapper)?.addEventListener('click', () =>
      row.scrollBy({ left: row.clientWidth * 0.7, behavior: 'smooth' })
    );
  });
}

/* ═══════════════════════════════════════════════════════════
   CARD CLICK → series.html
   ═══════════════════════════════════════════════════════════ */
function initCardClicks() {
  document.addEventListener('click', e => {
    const card = e.target.closest('.series-card');
    if (!card || e.target.closest('a')) return;
    const slug = card.dataset.slug;
    if (slug) window.location.href = pageUrl('series.html', { id: slug });
  });
}

/* ═══════════════════════════════════════════════════════════
   SEARCH CONTROLLER
   ═══════════════════════════════════════════════════════════ */
class SearchController {
  constructor(allEntries) {
    this._all      = allEntries;
    this._overlay  = $('#searchOverlay');
    this._input    = $('#searchInput');
    this._results  = $('#searchResults');
    this._toggle   = $('#searchToggle');
    this._closeBtn = $('#searchClose');
    this._init();
  }

  _init() {
    this._toggle?.addEventListener('click', () => this._open());
    this._closeBtn?.addEventListener('click', () => this._close());
    this._overlay?.addEventListener('click', e => { if (e.target === this._overlay) this._close(); });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._close();
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); this._open(); }
    });

    this._input?.addEventListener('input', debounce(() => this._run(), 200));
  }

  _open() {
    this._overlay?.classList.add('active');
    setTimeout(() => this._input?.focus(), 50);
    this._run();
  }

  _close() {
    this._overlay?.classList.remove('active');
    if (this._input) this._input.value = '';
    if (this._results) this._results.innerHTML = '';
  }

  _run() {
    const q = this._input?.value?.trim().toLowerCase() ?? '';
    if (!q) { if (this._results) this._results.innerHTML = ''; return; }

    const matches = this._all.filter(e => {
      const title   = e.title.toLowerCase();
      const channel = e.channel.toLowerCase();
      const genres  = (e.tmdb?.genres ?? []).join(' ').toLowerCase();
      return title.includes(q) || channel.includes(q) || genres.includes(q);
    });

    if (!matches.length) {
      this._results.innerHTML = `
        <div class="search-empty">${ICONS.search}<p>No results for "<strong>${q}</strong>"</p></div>`;
      return;
    }

    this._results.innerHTML = `<div class="series-grid">${matches.map(renderCard).join('')}</div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   HOMEPAGE CONTROLLER
   ═══════════════════════════════════════════════════════════ */
class HomepageController {
  constructor() {
    this._dm      = new DataManager();
    this._all     = [];
    this._active  = null; // active category filter
    this._heroIdx = 0;
    this._heroTimer = null;
    this._featured = [];
  }

  async init() {
    initNavScroll();
    this._all = await this._dm.loadAll();

    this._buildCategories();
    this._buildSections();
    this._buildHero();

    new SearchController(this._all);
    initCardClicks();
    observeSections();
  }

  _buildCategories() {
    const bar = $('#categoriesBar .categories-scroll');
    if (!bar) return;

    const channels = [...new Set(this._all.map(e => e.channel))].sort();
    channels.forEach(ch => {
      const btn = document.createElement('button');
      btn.className = 'category-chip';
      btn.dataset.channel = ch.toLowerCase();
      btn.textContent = ch;
      bar.appendChild(btn);
    });

    bar.addEventListener('click', e => {
      const chip = e.target.closest('.category-chip');
      if (!chip) return;
      $$('.category-chip', bar).forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      this._filterByChannel(chip.dataset.channel);
    });
  }

  _filterByChannel(channel) {
    this._active = channel || null;
    const cards = $$('.series-card[data-slug]');
    cards.forEach(card => {
      const match = !channel || card.dataset.channel === channel;
      card.closest('.series-card').style.display = match ? '' : 'none';
    });

    // Also show/hide entire sections if channel-specific
    $$('[data-channel-section]').forEach(section => {
      const secChannel = section.dataset.channelSection;
      section.style.display = (!channel || secChannel === channel) ? '' : 'none';
    });
  }

  _buildSections() {
    const container = $('#sections');
    if (!container) return;

    const featured  = this._all.filter(e => e.data.featured);
    const allSlug   = this._all.map(e => e.slug);
    const recent    = this._all.slice().reverse().slice(0, 12);
    const random    = shuffle(this._all).slice(0, 12);

    let html = '';

    // Featured Row
    if (featured.length) {
      html += buildSection('Featured', featured, 'row');
    }

    // Recently Added
    html += buildSection('Recently Added', recent, 'row');

    // Random Picks
    const randomFiltered = random.filter(e => !featured.find(f => f.slug === e.slug)).slice(0, 10);
    if (randomFiltered.length) {
      html += buildSection('Random Picks', randomFiltered, 'row');
    }

    // By Channel
    const byChannel = groupBy(this._all, 'channel');
    Object.entries(byChannel)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([channel, entries]) => {
        const sectionHtml = buildSection(channel, entries, 'row');
        // Wrap in channel-section div for filtering
        html += `<div data-channel-section="${channel.toLowerCase()}">${sectionHtml}</div>`;
      });

    container.innerHTML = html;
    initRowArrows();
  }

  _buildHero() {
    this._featured = this._all.filter(e => e.data.featured);
    if (!this._featured.length) this._featured = this._all.slice(0, 3);
    if (!this._featured.length) return;

    // Build dots
    const dotsEl = $('#heroDots');
    if (dotsEl) {
      dotsEl.innerHTML = this._featured.map((_, i) =>
        `<button class="hero-dot-btn${i === 0 ? ' active' : ''}" data-idx="${i}" aria-label="Featured ${i+1}"></button>`
      ).join('');
      dotsEl.addEventListener('click', e => {
        const btn = e.target.closest('.hero-dot-btn');
        if (btn) this._showHero(+btn.dataset.idx);
      });
    }

    this._showHero(0);

    // Auto-rotate every 8s
    this._heroTimer = setInterval(() => {
      this._heroIdx = (this._heroIdx + 1) % this._featured.length;
      this._showHero(this._heroIdx);
    }, 8000);
  }

  _showHero(idx) {
    this._heroIdx = idx;
    const entry = this._featured[idx];
    if (!entry) return;

    const { title, channel, tmdb: t } = entry;

    // Update backdrop
    const bg = $('#heroBg');
    if (bg) {
      if (t?.backdrop) {
        bg.style.backgroundImage = `url('${t.backdrop}')`;
      } else if (t?.posterLg) {
        bg.style.backgroundImage = `url('${t.posterLg}')`;
      }
    }

    // Update content
    const content = $('#heroContent');
    if (content) {
      const year    = t?.year ?? '';
      const rating  = t?.rating ?? '';
      const seasons = t?.seasons ? `${t.seasons} Season${t.seasons > 1 ? 's' : ''}` : '';
      const genres  = (t?.genres ?? []).slice(0, 3);
      const desc    = t?.overview ?? '';

      content.innerHTML = `
        <div class="hero-channel">${channel}</div>
        <h1 class="hero-title">${title}</h1>
        <div class="hero-meta">
          ${year ? `<span>${year}</span>` : ''}
          ${year && (rating || seasons) ? '<span class="hero-dot"></span>' : ''}
          ${rating ? `<span class="hero-rating">${ICONS.star} ${rating}</span>` : ''}
          ${rating && seasons ? '<span class="hero-dot"></span>' : ''}
          ${seasons ? `<span>${seasons}</span>` : ''}
        </div>
        ${genres.length ? `<div class="hero-genres">${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>` : ''}
        ${desc ? `<p class="hero-desc">${desc}</p>` : ''}
        <div class="hero-actions">
          <a href="${pageUrl('watch.html', { series: entry.slug, season: 1, ep: 1 })}" class="btn-primary">
            ${ICONS.play} Watch Now
          </a>
          <a href="${pageUrl('series.html', { id: entry.slug })}" class="btn-secondary">
            ${ICONS.info} More Info
          </a>
        </div>`;
    }

    // Update dots
    $$('.hero-dot-btn').forEach((btn, i) => btn.classList.toggle('active', i === idx));
  }
}

/* ═══════════════════════════════════════════════════════════
   SERIES PAGE CONTROLLER
   ═══════════════════════════════════════════════════════════ */
class SeriesController {
  constructor() {
    this._dm = new DataManager();
  }

  async init() {
    initNavScroll();
    const slug = new URLSearchParams(window.location.search).get('id');
    if (!slug) { window.location.href = pageUrl('index.html'); return; }

    const entry = await this._dm.getOne(slug);
    if (!entry) { toast('Series not found.', 'error'); return; }

    document.title = `${entry.title} — StreamVault`;
    this._render(entry);
    initCardClicks();
  }

  _render(entry) {
    const { slug, title, channel, tmdb: t, data } = entry;

    // Backdrop
    const backdropEl = $('#seriesBackdrop');
    if (backdropEl && (t?.backdrop || t?.posterLg)) {
      backdropEl.style.backgroundImage = `url('${t.backdrop ?? t.posterLg}')`;
    }

    // Poster
    const posterEl = $('#seriesPoster');
    if (posterEl) {
      if (t?.posterLg) {
        posterEl.innerHTML = `<img src="${t.posterLg}" alt="${title}">`;
      } else {
        posterEl.innerHTML = `<div class="no-poster">${ICONS.film}</div>`;
      }
    }

    // Channel badge
    const badgeEl = $('#seriesChannelBadge');
    if (badgeEl) badgeEl.textContent = channel;

    // Title
    const titleEl = $('#seriesTitle');
    if (titleEl) titleEl.textContent = title;

    // Meta row
    const metaEl = $('#seriesMeta');
    if (metaEl) {
      const parts = [];
      if (t?.year)    parts.push(`<span>${t.year}</span>`);
      if (t?.rating)  parts.push(`<span class="rating-stars">${ICONS.star} ${t.rating}</span>`);
      if (t?.seasons) parts.push(`<span>${t.seasons} Season${t.seasons > 1 ? 's' : ''}</span>`);
      if (t?.status)  parts.push(`<span>${t.status}</span>`);
      metaEl.innerHTML = parts.join('<span class="meta-sep">·</span>');
    }

    // Genres
    const genresEl = $('#seriesGenres');
    if (genresEl && t?.genres?.length) {
      genresEl.innerHTML = t.genres.map(g => `<span class="genre-tag">${g}</span>`).join('');
    }

    // Overview
    const overviewEl = $('#seriesOverview');
    if (overviewEl) overviewEl.textContent = t?.overview ?? 'No description available.';

    // CTA Buttons
    const ctaEl = $('#seriesCta');
    if (ctaEl) {
      ctaEl.innerHTML = `
        <a href="${pageUrl('watch.html', { series: slug, season: 1, ep: 1 })}" class="btn-primary">
          ${ICONS.play} Watch Now
        </a>
        <a href="${pageUrl('index.html')}" class="btn-secondary">
          ${ICONS.back} Back
        </a>`;
    }

    // Episodes
    this._renderEpisodes(slug, data.episodes ?? []);
  }

  _renderEpisodes(slug, episodes) {
    const container = $('#episodesContainer');
    if (!container) return;

    if (!episodes.length) {
      container.innerHTML = '<p style="color:var(--text-3)">No episodes found.</p>';
      return;
    }

    // Group by season
    const bySeason = {};
    episodes.forEach(ep => {
      (bySeason[ep.season] = bySeason[ep.season] || []).push(ep);
    });

    const seasons = Object.keys(bySeason).map(Number).sort((a, b) => a - b);
    let activeSeason = seasons[0];

    const renderSeasonTabs = () => seasons.map(s =>
      `<button class="season-tab${s === activeSeason ? ' active' : ''}" data-season="${s}">Season ${s}</button>`
    ).join('');

    const renderEpisodeGrid = (season) => {
      return bySeason[season].map(ep => {
        const playerNames = Object.keys(ep.players ?? {});
        const url = pageUrl('watch.html', { series: slug, season: ep.season, ep: ep.ep });
        return `
          <a href="${url}" class="episode-card">
            <div class="episode-num">${String(ep.ep).padStart(2, '0')}</div>
            <div class="episode-info">
              <div class="episode-label">Episode ${ep.ep}</div>
              <div class="episode-players">${playerNames.length} server${playerNames.length !== 1 ? 's' : ''}: ${playerNames.join(', ')}</div>
            </div>
            <div class="episode-play-icon">${ICONS.play}</div>
          </a>`;
      }).join('');
    };

    const update = () => {
      container.innerHTML = `
        <div class="season-tabs">${renderSeasonTabs()}</div>
        <div class="episodes-grid">${renderEpisodeGrid(activeSeason)}</div>`;

      $$('.season-tab', container).forEach(btn => {
        btn.addEventListener('click', () => {
          activeSeason = +btn.dataset.season;
          update();
        });
      });
    };

    update();
  }
}

/* ═══════════════════════════════════════════════════════════
   WATCH PAGE CONTROLLER
   ═══════════════════════════════════════════════════════════ */
class WatchController {
  constructor() {
    this._dm      = new DataManager();
    this._slug    = null;
    this._season  = 1;
    this._ep      = 1;
    this._entry   = null;
    this._players = {};
    this._activePlayer = null;
  }

  async init() {
    initNavScroll();
    const params = new URLSearchParams(window.location.search);
    this._slug   = params.get('series');
    this._season = +(params.get('season') ?? 1);
    this._ep     = +(params.get('ep')     ?? 1);

    if (!this._slug) { window.location.href = pageUrl('index.html'); return; }

    this._entry = await this._dm.getOne(this._slug);
    if (!this._entry) { toast('Series not found.', 'error'); return; }

    document.title = `${this._entry.title} S${this._season}E${this._ep} — StreamVault`;

    this._findEpisode();
    this._renderMeta();
    this._renderPlayer();
    this._renderControls();
    this._renderAllEpisodes();
  }

  _findEpisode() {
    const episodes = this._entry.data.episodes ?? [];
    const ep = episodes.find(e => e.season === this._season && e.ep === this._ep);
    this._players = ep?.players ?? {};
    this._activePlayer = Object.keys(this._players)[0] ?? null;
  }

  _renderMeta() {
    const titleEl = $('#watchTitle');
    if (titleEl) titleEl.textContent = this._entry.title;

    const badgeEl = $('#watchEpBadge');
    if (badgeEl) badgeEl.textContent = `S${this._season} E${this._ep}`;

    const backLink = $('#watchSeriesLink');
    if (backLink) {
      backLink.href = pageUrl('series.html', { id: this._slug });
      backLink.innerHTML = `${ICONS.back} All Episodes`;
    }
  }

  _renderPlayer() {
    const wrapper = $('#playerWrapper');
    if (!wrapper) return;

    if (!this._activePlayer || !this._players[this._activePlayer]) {
      wrapper.innerHTML = `
        <div class="player-loading">
          <div style="font-size:2rem">🎬</div>
          <p>No player available for this episode.</p>
        </div>`;
      return;
    }

    wrapper.innerHTML = `
      <div class="player-loading" id="playerLoading"><div class="spinner"></div><span>Loading player…</span></div>
      <iframe class="player-iframe" id="playerIframe"
        src="${this._players[this._activePlayer]}"
        allowfullscreen allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-top-navigation"></iframe>`;

    $('#playerIframe')?.addEventListener('load', () => {
      $('#playerLoading')?.remove();
    });
  }

  _renderControls() {
    const btnsEl = $('#playerBtns');
    if (btnsEl) {
      btnsEl.innerHTML = Object.keys(this._players).map(name =>
        `<button class="player-btn${name === this._activePlayer ? ' active' : ''}" data-player="${name}">${name}</button>`
      ).join('');

      btnsEl.addEventListener('click', e => {
        const btn = e.target.closest('.player-btn');
        if (!btn) return;
        $$('.player-btn', btnsEl).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._activePlayer = btn.dataset.player;
        this._renderPlayer();
      });
    }

    // Episode select dropdown
    const selectEl = $('#episodeSelect');
    if (selectEl) {
      const episodes = this._entry.data.episodes ?? [];
      const bySeason = {};
      episodes.forEach(e => (bySeason[e.season] = bySeason[e.season] || []).push(e));

      selectEl.innerHTML = Object.keys(bySeason).sort((a,b)=>a-b).map(s =>
        `<optgroup label="Season ${s}">
          ${bySeason[s].map(e =>
            `<option value="${e.season}|${e.ep}" ${e.season===this._season && e.ep===this._ep ? 'selected' : ''}>
              S${e.season} E${e.ep}
            </option>`
          ).join('')}
        </optgroup>`
      ).join('');

      selectEl.addEventListener('change', () => {
        const [s, e] = selectEl.value.split('|').map(Number);
        window.location.href = pageUrl('watch.html', { series: this._slug, season: s, ep: e });
      });
    }

    // Prev / Next buttons
    const episodes = this._entry.data.episodes ?? [];
    const sorted = [...episodes].sort((a, b) =>
      a.season !== b.season ? a.season - b.season : a.ep - b.ep
    );
    const curIdx = sorted.findIndex(e => e.season === this._season && e.ep === this._ep);

    const prevBtn = $('#prevEpBtn');
    const nextBtn = $('#nextEpBtn');

    if (prevBtn) {
      prevBtn.disabled = curIdx <= 0;
      prevBtn.addEventListener('click', () => {
        if (curIdx > 0) {
          const prev = sorted[curIdx - 1];
          window.location.href = pageUrl('watch.html', { series: this._slug, season: prev.season, ep: prev.ep });
        }
      });
    }

    if (nextBtn) {
      nextBtn.disabled = curIdx >= sorted.length - 1;
      nextBtn.addEventListener('click', () => {
        if (curIdx < sorted.length - 1) {
          const next = sorted[curIdx + 1];
          window.location.href = pageUrl('watch.html', { series: this._slug, season: next.season, ep: next.ep });
        }
      });
    }
  }

  _renderAllEpisodes() {
    const container = $('#allEpisodesPanel');
    if (!container) return;

    const episodes = this._entry.data.episodes ?? [];
    const bySeason = {};
    episodes.forEach(e => (bySeason[e.season] = bySeason[e.season] || []).push(e));

    const currentSeason = bySeason[this._season] ?? [];

    container.innerHTML = `
      <h3>Season ${this._season} Episodes</h3>
      <div class="episodes-grid">
        ${currentSeason.map(ep => {
          const url = pageUrl('watch.html', { series: this._slug, season: ep.season, ep: ep.ep });
          const isCurrent = ep.season === this._season && ep.ep === this._ep;
          return `
            <a href="${url}" class="episode-card${isCurrent ? '" style="border-color:var(--accent);background:var(--accent-dim)' : ''}">
              <div class="episode-num" style="${isCurrent ? 'color:var(--accent)' : ''}">${String(ep.ep).padStart(2,'0')}</div>
              <div class="episode-info">
                <div class="episode-label">Episode ${ep.ep}${isCurrent ? ' <span style="color:var(--accent);font-size:0.7rem">(Playing)</span>' : ''}</div>
                <div class="episode-players">${Object.keys(ep.players ?? {}).join(', ')}</div>
              </div>
              <div class="episode-play-icon">${ICONS.play}</div>
            </a>`;
        }).join('')}
      </div>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   ROUTER — detect page & init
   ═══════════════════════════════════════════════════════════ */
async function router() {
  const page = document.body.dataset.page;

  switch (page) {
    case 'home':
      await new HomepageController().init();
      break;
    case 'series':
      await new SeriesController().init();
      break;
    case 'watch':
      await new WatchController().init();
      break;
    default:
      console.warn('[Router] Unknown page:', page);
  }
}

document.addEventListener('DOMContentLoaded', router);
