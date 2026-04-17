/* ============================================================
   app.js — StreamVault Main Application
   Delegates auth/comments to dedicated controllers.
   Existing DataManager, series, home, watch logic untouched.
   ============================================================ */

import { tmdb }        from './tmdb.js';
import {
  auth, db,
  toggleFavorite, toggleWatchlist,
  setRating, getRating,
  isFavorite, isInWatchlist,
} from './firebase.js';
import {
  AuthController,
  currentUser, currentProfile,
} from './auth-controller.js';
import { CommentsController } from './comments-controller.js';
import { UserController }     from './user-controller.js';

/* ── Re-export for sub-modules that need these values ──────── */
export { currentUser, currentProfile };

/* ── Base URL ─────────────────────────────────────────────── */
const BASE_URL = './';

/* ── Utils ─────────────────────────────────────────────────── */
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

export function pageUrl(page, params = {}) {
  const url = new URL(page, window.location.href);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.href;
}

export function toast(msg, type = 'info') {
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

// Route toast events from sub-modules
document.addEventListener('sv:toast', e => toast(e.detail.msg, e.detail.type));

/* ── SVG Icons ─────────────────────────────────────────────── */
export const ICONS = {
  play:     `<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`,
  info:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  search:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  close:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  star:     `<svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>`,
  film:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/></svg>`,
  chevL:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevR:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`,
  back:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
  heart:    `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
};

/* ════════════════════════════════════════════════════════════
   STAR RATING WIDGET  (series page inline rating)
   ════════════════════════════════════════════════════════════ */
function renderStarRating(container, slug, currentRating = 0) {
  container.innerHTML = `
    <div class="star-rating" data-slug="${slug}">
      ${[1,2,3,4,5].map(n =>
        `<button class="star-btn${n <= currentRating ? ' active' : ''}" data-star="${n}"
                 title="${n} αστέρ${n===1?'ι':'ια'}">${ICONS.star}</button>`).join('')}
      <span class="star-label">${currentRating ? `${currentRating}/5` : 'Αξιολόγηση'}</span>
    </div>`;

  container.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('mouseover', () => {
      const n = +btn.dataset.star;
      container.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('hover', i < n));
    });
    btn.addEventListener('mouseout', () =>
      container.querySelectorAll('.star-btn').forEach(b => b.classList.remove('hover')));
    btn.addEventListener('click', async () => {
      if (!currentUser) { toast('Συνδεθείτε για να αξιολογήσετε.', 'info'); return; }
      const stars = +btn.dataset.star;
      await setRating(currentUser.uid, slug, stars);
      renderStarRating(container, slug, stars);
      toast(`Αξιολόγηση: ${stars}/5 ★`, 'success');
    });
  });
}

/* ════════════════════════════════════════════════════════════
   DATA MANAGER  — unchanged
   ════════════════════════════════════════════════════════════ */
class DataManager {
  constructor() {
    this._raw  = null;
    this._rich = null;
  }

  async load() {
    if (this._raw) return this._raw;
    try {
      const res = await fetch('./data/series.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._raw = await res.json();
      return this._raw;
    } catch (err) {
      toast('Αδύνατη φόρτωση δεδομένων.', 'error');
      console.error('[DataManager] load:', err);
      return {};
    }
  }

  async loadAll() {
    if (this._rich) return this._rich;
    const raw     = await this.load();
    const entries = Object.entries(raw).map(([slug, data]) => ({ slug, data }));
    let resolved = [];

    try {
      resolved = await tmdb.batchResolve(entries);
    } catch (err) {
      console.error('[TMDB] batchResolve failed:', err);
    }

    if (!Array.isArray(resolved) || resolved.length === 0) {
      // fallback χωρίς TMDB
      resolved = entries.map(e => ({ ...e, tmdb: null }));
    }

    this._rich = resolved.map(e => ({
      ...e,
      title:    e.data.title    ?? e.tmdb?.title    ?? e.slug,
      overview: e.data.overview ?? e.tmdb?.overview ?? '',
      channel:  e.data.channel  ?? 'Unknown',
    }));
    return this._rich;
  }

  async getOne(slug) {
    const raw  = await this.load();
    const data = raw[slug];
    if (!data) return null;
    const tmdbData = await tmdb.getDetails(data);
    return {
      slug,
      data,
      tmdb: tmdbData,
      title:    data.title    ?? tmdbData?.title    ?? slug,
      overview: data.overview ?? tmdbData?.overview ?? '',
      channel:  data.channel  ?? 'Unknown',
    };
  }

  async getChannels() {
    const raw = await this.load();
    return [...new Set(Object.values(raw).map(s => s.channel).filter(Boolean))].sort();
  }
}

/* ════════════════════════════════════════════════════════════
   CARD RENDERER  — unchanged
   ════════════════════════════════════════════════════════════ */
export function renderCard(entry) {
  const { slug, title, channel, tmdb: t } = entry;
  const poster   = t?.poster;
  const year     = t?.year  ?? '';
  const rating   = t?.rating ?? '';
  const url      = pageUrl('series.html', { id: slug });
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
          ${year   ? `<span>${year}</span>` : ''}
          ${rating ? `<span class="card-rating">${ICONS.star}${rating}</span>` : ''}
          <span class="card-channel">${channel}</span>
        </div>
      </div>
      <a href="${watchUrl}" class="card-play-btn" aria-label="Παρακολούθηση ${title}">
        ${ICONS.play}
      </a>
    </div>`;
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
  return `
    <div class="section" data-section>
      <div class="section-header"><h2 class="section-title">${title}</h2></div>
      <div class="row-wrapper">
        <button class="row-arrow left">${ICONS.chevL}</button>
        <div class="series-row">${cards}</div>
        <button class="row-arrow right">${ICONS.chevR}</button>
      </div>
    </div>`;
}

/* ── Shared helpers ─────────────────────────────────────────── */
function observeSections() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: 0.08 });
  $$('[data-section]').forEach(el => io.observe(el));
}

function initNavScroll() {
  const nav = $('#navbar');
  if (!nav) return;
  const fn = () => nav.classList.toggle('scrolled', window.scrollY > 60);
  window.addEventListener('scroll', fn, { passive: true });
  fn();
}

function initRowArrows() {
  $$('.row-wrapper').forEach(w => {
    const row = $('.series-row', w);
    $('.row-arrow.left',  w)?.addEventListener('click', () => row.scrollBy({ left: -row.clientWidth * 0.7, behavior: 'smooth' }));
    $('.row-arrow.right', w)?.addEventListener('click', () => row.scrollBy({ left:  row.clientWidth * 0.7, behavior: 'smooth' }));
  });
}

function initCardClicks() {
  document.addEventListener('click', e => {
    const card = e.target.closest('.series-card');
    if (!card || e.target.closest('a')) return;
    const slug = card.dataset.slug;
    if (slug) window.location.href = pageUrl('series.html', { id: slug });
  });
}

/* ════════════════════════════════════════════════════════════
   SEARCH CONTROLLER  — unchanged
   ════════════════════════════════════════════════════════════ */
class SearchController {
  constructor(all) {
    this._all    = all;
    this._overlay= $('#searchOverlay');
    this._input  = $('#searchInput');
    this._results= $('#searchResults');
    this._init();
  }
  _init() {
    $('#searchToggle')?.addEventListener('click',  () => this._open());
    $('#searchClose')?.addEventListener('click',   () => this._close());
    this._overlay?.addEventListener('click', e => { if (e.target === this._overlay) this._close(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._close();
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); this._open(); }
    });
    this._input?.addEventListener('input', debounce(() => this._run(), 200));
  }
  _open()  { this._overlay?.classList.add('active'); setTimeout(() => this._input?.focus(), 50); this._run(); }
  _close() { this._overlay?.classList.remove('active'); if (this._input) this._input.value = ''; if (this._results) this._results.innerHTML = ''; }
  _run() {
    const q = this._input?.value?.trim().toLowerCase() ?? '';
    if (!q) { if (this._results) this._results.innerHTML = ''; return; }
    const m = this._all.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.channel.toLowerCase().includes(q) ||
      (e.tmdb?.genres ?? []).join(' ').toLowerCase().includes(q)
    );
    this._results.innerHTML = m.length
      ? `<div class="series-grid">${m.map(renderCard).join('')}</div>`
      : `<div class="search-empty">${ICONS.search}<p>Δεν βρέθηκαν αποτελέσματα για "<strong>${q}</strong>"</p></div>`;
  }
}

/* ════════════════════════════════════════════════════════════
   HOMEPAGE CONTROLLER  — unchanged except Greek labels
   ════════════════════════════════════════════════════════════ */
class HomepageController {
  constructor() {
    this._dm       = new DataManager();
    this._all      = [];
    this._heroIdx  = 0;
    this._heroTimer= null;
    this._featured = [];
  }

  async init() {
    initNavScroll();
    new AuthController().init();
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
      this._filter(chip.dataset.channel);
    });
  }

  _filter(channel) {
    $$('.series-card[data-slug]').forEach(c => { c.style.display = !channel || c.dataset.channel === channel ? '' : 'none'; });
    $$('[data-channel-section]').forEach(s => { s.style.display = (!channel || s.dataset.channelSection === channel) ? '' : 'none'; });
  }

  _buildSections() {
    const container = $('#sections');
    if (!container) return;
    const featured = this._all.filter(e => e.data.featured);
    const recent   = this._all.slice().reverse().slice(0, 12);
    const random   = shuffle(this._all).filter(e => !featured.find(f => f.slug === e.slug)).slice(0, 10);
    let html = '';
    if (featured.length) html += buildSection('Featured', featured, 'row');
    html += buildSection('Πρόσφατες Αναρτήσεις', recent, 'row');
    if (random.length) html += buildSection('Τυχαίες Επιλογές', random, 'row');
    const byChannel = groupBy(this._all, 'channel');
    Object.entries(byChannel).sort(([a], [b]) => a.localeCompare(b)).forEach(([ch, entries]) => {
      html += `<div data-channel-section="${ch.toLowerCase()}">${buildSection(ch, entries, 'row')}</div>`;
    });
    container.innerHTML = html;
    initRowArrows();
  }

  _buildHero() {
    this._featured = this._all.filter(e => e.data.featured);
    if (!this._featured.length) this._featured = this._all.slice(0, 3);
    if (!this._featured.length) return;
    const dotsEl = $('#heroDots');
    if (dotsEl) {
      dotsEl.innerHTML = this._featured.map((_, i) =>
        `<button class="hero-dot-btn${i === 0 ? ' active' : ''}" data-idx="${i}"></button>`).join('');
      dotsEl.addEventListener('click', e => {
        const btn = e.target.closest('.hero-dot-btn');
        if (btn) this._showHero(+btn.dataset.idx);
      });
    }
    this._showHero(0);
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
    const bg = $('#heroBg');
    if (bg) bg.style.backgroundImage = t?.backdrop ? `url('${t.backdrop}')` : t?.posterLg ? `url('${t.posterLg}')` : '';
    const content = $('#heroContent');
    if (content) {
      const year   = t?.year ?? '';
      const rating = t?.rating ?? '';
      const seasons= t?.seasons ? `${t.seasons} Σεζόν` : '';
      const genres = (t?.genres ?? []).slice(0, 3);
      const desc   = entry.overview ?? '';
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
          <a href="${pageUrl('watch.html', { series: entry.slug, season: 1, ep: 1 })}" class="btn-primary">${ICONS.play} Δείτε Τώρα</a>
          <a href="${pageUrl('series.html', { id: entry.slug })}" class="btn-secondary">${ICONS.info} Περισσότερα</a>
        </div>`;
    }
    $$('.hero-dot-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
  }
}

/* ════════════════════════════════════════════════════════════
   SERIES PAGE CONTROLLER
   Uses CommentsController + renderStarRating
   ════════════════════════════════════════════════════════════ */
class SeriesController {
  constructor() {
    this._dm       = new DataManager();
    this._comments = null;
  }

  async init() {
    initNavScroll();
    const ac = new AuthController();
    ac.init();

    const slug = new URLSearchParams(window.location.search).get('id');
    if (!slug) { window.location.href = pageUrl('index.html'); return; }

    const entry = await this._dm.getOne(slug);
    if (!entry) { toast('Η σειρά δεν βρέθηκε.', 'error'); return; }

    document.title = `${entry.title} — StreamVault`;
    await this._render(entry);
    initCardClicks();

    // Comments controller
    const commentsEl = $('#seriesComments');
    if (commentsEl) {
      this._comments = new CommentsController(commentsEl, slug);
      await this._comments.render();
    }

    // Re-render comments when auth changes
    document.addEventListener('sv:authChanged', async () => {
      if (this._comments) await this._comments.render();
      // Refresh fav/watchlist button states
      await this._updateUserBtns(slug);
    });
  }

  async _render(entry) {
    const { slug, title, channel, tmdb: t, data } = entry;

    const backdropEl = $('#seriesBackdrop');
    if (backdropEl && (t?.backdrop || t?.posterLg))
      backdropEl.style.backgroundImage = `url('${t.backdrop ?? t.posterLg}')`;

    const posterEl = $('#seriesPoster');
    if (posterEl) posterEl.innerHTML = t?.posterLg
      ? `<img src="${t.posterLg}" alt="${title}">`
      : `<div class="no-poster">${ICONS.film}</div>`;

    const badgeEl = $('#seriesChannelBadge');
    if (badgeEl) badgeEl.textContent = channel;
    const titleEl = $('#seriesTitle');
    if (titleEl) titleEl.textContent = title;

    const metaEl = $('#seriesMeta');
    if (metaEl) {
      const parts = [];
      if (t?.year)    parts.push(`<span>${t.year}</span>`);
      if (t?.rating)  parts.push(`<span class="rating-stars">${ICONS.star} ${t.rating}</span>`);
      if (t?.seasons) parts.push(`<span>${t.seasons} Σεζόν</span>`);
      if (t?.status)  parts.push(`<span>${t.status}</span>`);
      metaEl.innerHTML = parts.join('<span class="meta-sep">·</span>');
    }

    const genresEl = $('#seriesGenres');
    if (genresEl && t?.genres?.length)
      genresEl.innerHTML = t.genres.map(g => `<span class="genre-tag">${g}</span>`).join('');

    const overviewEl = $('#seriesOverview');
    if (overviewEl) overviewEl.textContent = entry.overview || 'Δεν υπάρχει περιγραφή.';

    // CTA + action buttons
    const ctaEl = $('#seriesCta');
    if (ctaEl) {
      ctaEl.innerHTML = `
        <a href="${pageUrl('watch.html', { series: slug, season: 1, ep: 1 })}" class="btn-primary">
          ${ICONS.play} Δείτε Τώρα
        </a>
        <a href="${pageUrl('index.html')}" class="btn-secondary">
          ${ICONS.back} Αρχική
        </a>
        <button id="favBtn" class="btn-secondary" style="gap:.4rem">
          ${ICONS.heart} <span id="favLabel">❤️ Αγαπημένα</span>
        </button>
        <button id="watchlistBtn" class="btn-secondary" style="gap:.4rem">
          ${ICONS.bookmark} <span id="watchlistLabel">📌 Θα το δω</span>
        </button>`;
    }

    // Star rating
    const ratingWrap = $('#seriesRatingWrap');
    if (ratingWrap) {
      const stars = currentUser ? await getRating(currentUser.uid, slug) : 0;
      renderStarRating(ratingWrap, slug, stars);
    }

    await this._updateUserBtns(slug);

    $('#favBtn')?.addEventListener('click', async () => {
      if (!currentUser) { toast('Συνδεθείτε για να αποθηκεύσετε αγαπημένα.', 'info'); return; }
      const added = await toggleFavorite(currentUser.uid, slug);
      toast(added ? '❤️ Προστέθηκε στα αγαπημένα!' : 'Αφαιρέθηκε από τα αγαπημένα.', 'success');
      await this._updateUserBtns(slug);
    });

    $('#watchlistBtn')?.addEventListener('click', async () => {
      if (!currentUser) { toast('Συνδεθείτε για να αποθηκεύσετε στη λίστα.', 'info'); return; }
      const added = await toggleWatchlist(currentUser.uid, slug);
      toast(added ? '📌 Προστέθηκε στη λίστα!' : 'Αφαιρέθηκε από τη λίστα.', 'success');
      await this._updateUserBtns(slug);
    });

    this._renderEpisodes(slug, data.episodes ?? []);
  }

  async _updateUserBtns(slug) {
    if (!currentUser) {
      const fl = $('#favLabel');       if (fl) fl.textContent = '❤️ Αγαπημένα';
      const wl = $('#watchlistLabel'); if (wl) wl.textContent = '📌 Θα το δω';
      return;
    }
    const [fav, watch] = await Promise.all([
      isFavorite(currentUser.uid, slug),
      isInWatchlist(currentUser.uid, slug),
    ]);
    const fl = $('#favLabel');
    if (fl) {
      fl.textContent = fav ? '❤️ Αφαίρεση' : '❤️ Αγαπημένα';
      fl.closest('button')?.style.setProperty('border-color', fav ? 'var(--accent)' : '');
    }
    const wl = $('#watchlistLabel');
    if (wl) {
      wl.textContent = watch ? '📌 Αφαίρεση' : '📌 Θα το δω';
      wl.closest('button')?.style.setProperty('border-color', watch ? 'var(--gold,#f5a623)' : '');
    }
  }

  _renderEpisodes(slug, episodes) {
    const container = $('#episodesContainer');
    if (!container) return;
    if (!episodes.length) {
      container.innerHTML = '<p style="color:var(--text-3)">Δεν βρέθηκαν επεισόδια.</p>';
      return;
    }
    const bySeason = {};
    episodes.forEach(ep => { (bySeason[ep.season] = bySeason[ep.season] || []).push(ep); });
    const seasons = Object.keys(bySeason).map(Number).sort((a, b) => a - b);
    let activeSeason = seasons[0];

    const renderTabs = () => seasons.map(s =>
      `<button class="season-tab${s === activeSeason ? ' active' : ''}" data-season="${s}">Σεζόν ${s}</button>`
    ).join('');

    const renderGrid = season => bySeason[season].map(ep => {
      const pNames = Object.keys(ep.players ?? {});
      const url = pageUrl('watch.html', { series: slug, season: ep.season, ep: ep.ep });
      return `
        <a href="${url}" class="episode-card">
          <div class="episode-num">${String(ep.ep).padStart(2, '0')}</div>
          <div class="episode-info">
            <div class="episode-label">Επεισόδιο ${ep.ep}</div>
            <div class="episode-players">${pNames.length} server${pNames.length !== 1 ? 's' : ''}: ${pNames.join(', ')}</div>
          </div>
          <div class="episode-play-icon">${ICONS.play}</div>
        </a>`;
    }).join('');

    const update = () => {
      container.innerHTML = `
        <div class="season-tabs">${renderTabs()}</div>
        <div class="episodes-grid">${renderGrid(activeSeason)}</div>`;
      $$('.season-tab', container).forEach(btn => {
        btn.addEventListener('click', () => { activeSeason = +btn.dataset.season; update(); });
      });
    };
    update();
  }
}

/* ════════════════════════════════════════════════════════════
   WATCH PAGE CONTROLLER  — unchanged
   ════════════════════════════════════════════════════════════ */
class WatchController {
  constructor() {
    this._dm           = new DataManager();
    this._slug         = null;
    this._season       = 1;
    this._ep           = 1;
    this._entry        = null;
    this._players      = {};
    this._activePlayer = null;
  }

  async init() {
    initNavScroll();
    new AuthController().init();
    const p      = new URLSearchParams(window.location.search);
    this._slug   = p.get('series');
    this._season = +(p.get('season') ?? 1);
    this._ep     = +(p.get('ep')     ?? 1);
    if (!this._slug) { window.location.href = pageUrl('index.html'); return; }
    this._entry = await this._dm.getOne(this._slug);
    if (!this._entry) { toast('Η σειρά δεν βρέθηκε.', 'error'); return; }
    document.title = `${this._entry.title} S${this._season}E${this._ep} — StreamVault`;
    this._findEpisode();
    this._renderMeta();
    this._renderPlayer();
    this._renderControls();
    this._renderAllEpisodes();
  }

  _findEpisode() {
    const ep = (this._entry.data.episodes ?? []).find(e => e.season === this._season && e.ep === this._ep);
    this._players      = ep?.players ?? {};
    this._activePlayer = Object.keys(this._players)[0] ?? null;
  }

  _renderMeta() {
    const t = $('#watchTitle');
    if (t) t.textContent = this._entry.title;
    const b = $('#watchEpBadge');
    if (b) b.textContent = `S${this._season} E${this._ep}`;
    const l = $('#watchSeriesLink');
    if (l) { l.href = pageUrl('series.html', { id: this._slug }); l.innerHTML = `${ICONS.back} Όλα τα Επεισόδια`; }
  }

  _renderPlayer() {
    const w = $('#playerWrapper');
    if (!w) return;
    if (!this._activePlayer || !this._players[this._activePlayer]) {
      w.innerHTML = `<div class="player-loading"><div style="font-size:2rem">🎬</div><p>Δεν υπάρχει διαθέσιμος player.</p></div>`;
      return;
    }
    w.innerHTML = `
      <div class="player-loading" id="playerLoading"><div class="spinner"></div><span>Φόρτωση player…</span></div>
      <iframe class="player-iframe" id="playerIframe"
        src="${this._players[this._activePlayer]}"
        allowfullscreen allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-top-navigation"></iframe>`;
    $('#playerIframe')?.addEventListener('load', () => { $('#playerLoading')?.remove(); });
  }

  _renderControls() {
    const btns = $('#playerBtns');
    if (btns) {
      btns.innerHTML = Object.keys(this._players).map(n =>
        `<button class="player-btn${n === this._activePlayer ? ' active' : ''}" data-player="${n}">${n}</button>`
      ).join('');
      btns.addEventListener('click', e => {
        const b = e.target.closest('.player-btn');
        if (!b) return;
        $$('.player-btn', btns).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this._activePlayer = b.dataset.player;
        this._renderPlayer();
      });
    }

    const sel = $('#episodeSelect');
    if (sel) {
      const bs = {};
      (this._entry.data.episodes ?? []).forEach(e => (bs[e.season] = bs[e.season] || []).push(e));
      sel.innerHTML = Object.keys(bs).sort((a,b)=>a-b).map(s =>
        `<optgroup label="Σεζόν ${s}">${bs[s].map(e =>
          `<option value="${e.season}|${e.ep}" ${e.season===this._season&&e.ep===this._ep?'selected':''}>S${e.season} E${e.ep}</option>`
        ).join('')}</optgroup>`).join('');
      sel.addEventListener('change', () => {
        const [s, e] = sel.value.split('|').map(Number);
        window.location.href = pageUrl('watch.html', { series: this._slug, season: s, ep: e });
      });
    }

    const eps    = this._entry.data.episodes ?? [];
    const sorted = [...eps].sort((a,b) => a.season !== b.season ? a.season - b.season : a.ep - b.ep);
    const idx    = sorted.findIndex(e => e.season === this._season && e.ep === this._ep);
    const prev   = $('#prevEpBtn');
    const next   = $('#nextEpBtn');
    if (prev) {
      prev.disabled = idx <= 0;
      prev.addEventListener('click', () => {
        if (idx > 0) { const p = sorted[idx-1]; window.location.href = pageUrl('watch.html', { series: this._slug, season: p.season, ep: p.ep }); }
      });
    }
    if (next) {
      next.disabled = idx >= sorted.length - 1;
      next.addEventListener('click', () => {
        if (idx < sorted.length - 1) { const n = sorted[idx+1]; window.location.href = pageUrl('watch.html', { series: this._slug, season: n.season, ep: n.ep }); }
      });
    }
  }

  _renderAllEpisodes() {
    const c = $('#allEpisodesPanel');
    if (!c) return;
    const bs = {};
    (this._entry.data.episodes ?? []).forEach(e => (bs[e.season] = bs[e.season] || []).push(e));
    const cur = bs[this._season] ?? [];
    c.innerHTML = `
      <h3>Σεζόν ${this._season} — Επεισόδια</h3>
      <div class="episodes-grid">
        ${cur.map(ep => {
          const url       = pageUrl('watch.html', { series: this._slug, season: ep.season, ep: ep.ep });
          const isCurrent = ep.season === this._season && ep.ep === this._ep;
          return `
            <a href="${url}" class="episode-card${isCurrent ? '" style="border-color:var(--accent);background:var(--accent-dim)' : ''}">
              <div class="episode-num" style="${isCurrent?'color:var(--accent)':''}">${String(ep.ep).padStart(2,'0')}</div>
              <div class="episode-info">
                <div class="episode-label">Επεισόδιο ${ep.ep}${isCurrent?' <span style="color:var(--accent);font-size:.7rem">(Παίζει)</span>':''}</div>
                <div class="episode-players">${Object.keys(ep.players??{}).join(', ')}</div>
              </div>
              <div class="episode-play-icon">${ICONS.play}</div>
            </a>`;
        }).join('')}
      </div>`;
  }
}

/* ════════════════════════════════════════════════════════════
   PROFILE PAGE CONTROLLER  — uses UserController
   ════════════════════════════════════════════════════════════ */
class ProfileController {
  constructor() {
    this._dm = new DataManager();
    this._uc = null;
  }

  async init() {
    initNavScroll();
    const ac = new AuthController();
    ac.init();

    // Show login prompt until we know auth state
    document.addEventListener('sv:authChanged', async (e) => {
      const { user } = e.detail;

      if (!user) {
        const heroEl = $('#profileHero');
        if (heroEl) heroEl.style.display = 'none';
        const main = $('#profileMain');
        if (main) main.innerHTML = `
          <div class="profile-login-prompt">
            <h2>Καλωσήρθατε!</h2>
            <p>Συνδεθείτε για να δείτε το προφίλ σας,<br>τα αγαπημένα και τις αξιολογήσεις σας.</p>
            <button class="btn-primary" id="profileLoginBtn">Σύνδεση / Εγγραφή</button>
          </div>`;
        $('#profileLoginBtn')?.addEventListener('click', () => {
          document.dispatchEvent(new CustomEvent('sv:openAuthModal', { detail: { tab: 'login' } }));
        });
        return;
      }

      // Show profile UI
      const heroEl = $('#profileHero');
      if (heroEl) heroEl.style.display = '';
      const main = $('#profileMain');
      if (main) main.style.display = '';

      this._uc = new UserController({ dm: this._dm, renderCard, pageUrl });
      await this._uc.load(user);
    }, { once: false });
  }
}

/* ════════════════════════════════════════════════════════════
   ROUTER
   ════════════════════════════════════════════════════════════ */
async function router() {
  const page = document.body.dataset.page;
  switch (page) {
    case 'home':    await new HomepageController().init(); break;
    case 'series':  await new SeriesController().init();   break;
    case 'watch':   await new WatchController().init();    break;
    case 'profile': await new ProfileController().init();  break;
    default: console.warn('[Router] Unknown page:', page);
  }
}

document.addEventListener('DOMContentLoaded', router);
