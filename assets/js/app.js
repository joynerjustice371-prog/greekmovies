/* ============================================================
   app.js — StreamVault Main Application
   Greek UI · Firebase Auth · Favorites · Watchlist · Ratings · Comments
   ============================================================ */

import { tmdb }          from './tmdb.js';
import {
  auth, db,
  loginWithGoogle, loginWithEmail, registerWithEmail, logout, onAuth,
  getUserProfile,
  toggleFavorite, toggleWatchlist,
  setRating, getRating,
  postComment, getComments,
} from './firebase.js';

/* ── Base URL ─────────────────────────────────────────────── */
const BASE_URL = new URL('../../', import.meta.url).href;

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

/* ── Current Auth state (module-level, updated by onAuth) ── */
let _currentUser    = null;
let _currentProfile = null;

/* ── SVG Icons ─────────────────────────────────────────────── */
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
  heart:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  bookmark:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  user:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
};

/* ══════════════════════════════════════════════════════════════
   AUTH UI CONTROLLER
   ══════════════════════════════════════════════════════════════ */
class AuthController {
  constructor() {
    this._modal    = null;
    this._tab      = 'login'; // 'login' | 'register'
  }

  init() {
    // Inject auth UI into nav
    this._injectNavUI();

    // Subscribe to auth state
    onAuth(async (user) => {
      _currentUser = user;
      _currentProfile = user ? await getUserProfile(user.uid) : null;
      this._updateNavUI();
      document.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user, profile: _currentProfile } }));
    });
  }

  _injectNavUI() {
    const actions = $('#nav-actions, .nav-actions');
    if (!actions) return;

    // Auth container injected into nav
    const wrap = document.createElement('div');
    wrap.id = 'authNavWrap';
    wrap.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin-left:.5rem';
    wrap.innerHTML = `
      <a href="${pageUrl('profile.html')}" id="navProfileLink" class="btn-icon" title="Προφίλ" style="display:none">
        ${ICONS.user}
      </a>
      <span id="navUsername" style="display:none;font-size:.82rem;color:var(--text-2);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <button id="navLoginBtn" class="nav-auth-btn" style="padding:6px 14px;border-radius:6px;background:var(--accent);color:#fff;font-size:.82rem;font-weight:600;cursor:pointer;border:none">
        Σύνδεση
      </button>
      <button id="navLogoutBtn" class="nav-auth-btn" style="display:none;padding:6px 14px;border-radius:6px;background:var(--bg-surface);color:var(--text-2);font-size:.82rem;cursor:pointer;border:1px solid var(--border)">
        Αποσύνδεση
      </button>`;
    actions.appendChild(wrap);

    $('#navLoginBtn')?.addEventListener('click', () => this._openModal());
    $('#navLogoutBtn')?.addEventListener('click', () => this._logout());
  }

  _updateNavUI() {
    const loginBtn   = $('#navLoginBtn');
    const logoutBtn  = $('#navLogoutBtn');
    const profileLink= $('#navProfileLink');
    const usernameEl = $('#navUsername');

    if (_currentUser) {
      loginBtn?.setAttribute('style', 'display:none');
      logoutBtn?.setAttribute('style', 'display:inline-block;padding:6px 14px;border-radius:6px;background:var(--bg-surface);color:var(--text-2);font-size:.82rem;cursor:pointer;border:1px solid var(--border)');
      profileLink?.setAttribute('style', 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.08);color:var(--text-2);cursor:pointer');
      if (usernameEl) {
        usernameEl.textContent = _currentProfile?.username ?? _currentUser.email.split('@')[0];
        usernameEl.style.display = 'inline';
      }
    } else {
      loginBtn?.setAttribute('style', 'padding:6px 14px;border-radius:6px;background:var(--accent);color:#fff;font-size:.82rem;font-weight:600;cursor:pointer;border:none');
      logoutBtn?.setAttribute('style', 'display:none');
      profileLink?.setAttribute('style', 'display:none');
      if (usernameEl) usernameEl.style.display = 'none';
    }
  }

  async _logout() {
    await logout();
    toast('Αποσυνδεθήκατε.', 'info');
  }

  _openModal(tab = 'login') {
    this._tab = tab;
    if (this._modal) { this._modal.remove(); }

    const overlay = document.createElement('div');
    overlay.id = 'authModal';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,.85);backdrop-filter:blur(8px);
      display:flex;align-items:center;justify-content:center;`;

    overlay.innerHTML = `
      <div style="background:var(--bg-card,#1c1c1c);border:1px solid var(--border,#2e2e2e);
                  border-radius:12px;padding:2rem;width:100%;max-width:400px;position:relative">
        <button id="authClose" style="position:absolute;top:1rem;right:1rem;background:none;border:none;
                color:var(--text-3,#777);font-size:1.2rem;cursor:pointer">✕</button>

        <div style="display:flex;gap:.5rem;margin-bottom:1.5rem">
          <button class="auth-tab ${tab==='login'?'auth-tab-active':''}" data-tab="login"
                  style="flex:1;padding:.6rem;border:none;border-radius:6px;cursor:pointer;
                         font-size:.9rem;font-family:inherit;
                         background:${tab==='login'?'var(--accent,#e50914)':'var(--bg-surface,#242424)'};
                         color:${tab==='login'?'#fff':'var(--text-2,#bbb)'}">
            Σύνδεση
          </button>
          <button class="auth-tab ${tab==='register'?'auth-tab-active':''}" data-tab="register"
                  style="flex:1;padding:.6rem;border:none;border-radius:6px;cursor:pointer;
                         font-size:.9rem;font-family:inherit;
                         background:${tab==='register'?'var(--accent,#e50914)':'var(--bg-surface,#242424)'};
                         color:${tab==='register'?'#fff':'var(--text-2,#bbb)'}">
            Εγγραφή
          </button>
        </div>

        <!-- Google Sign In -->
        <button id="googleSignIn" style="width:100%;padding:.7rem;margin-bottom:1rem;
               border:1px solid var(--border,#2e2e2e);border-radius:8px;background:var(--bg-surface,#242424);
               color:var(--text-1,#fff);font-size:.9rem;cursor:pointer;font-family:inherit;
               display:flex;align-items:center;justify-content:center;gap:.5rem">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Συνέχεια με Google
        </button>

        <div style="text-align:center;color:var(--text-3,#777);font-size:.78rem;margin-bottom:1rem">
          — ή με email —
        </div>

        <div id="authFormWrap">
          ${tab === 'register' ? `
            <input id="authUsername" type="text" placeholder="Ψευδώνυμο" autocomplete="username"
                   style="width:100%;padding:.65rem .75rem;margin-bottom:.6rem;border-radius:6px;
                          border:1px solid var(--border,#2e2e2e);background:var(--bg-card2,#242424);
                          color:var(--text-1,#fff);font-size:.9rem;box-sizing:border-box">
          ` : ''}
          <input id="authEmail" type="email" placeholder="Email" autocomplete="email"
                 style="width:100%;padding:.65rem .75rem;margin-bottom:.6rem;border-radius:6px;
                        border:1px solid var(--border,#2e2e2e);background:var(--bg-card2,#242424);
                        color:var(--text-1,#fff);font-size:.9rem;box-sizing:border-box">
          <input id="authPassword" type="password" placeholder="Κωδικός" autocomplete="current-password"
                 style="width:100%;padding:.65rem .75rem;margin-bottom:1rem;border-radius:6px;
                        border:1px solid var(--border,#2e2e2e);background:var(--bg-card2,#242424);
                        color:var(--text-1,#fff);font-size:.9rem;box-sizing:border-box">
          <p id="authError" style="color:#ff5555;font-size:.8rem;margin-bottom:.75rem;display:none"></p>
          <button id="authSubmit" style="width:100%;padding:.75rem;background:var(--accent,#e50914);
                  color:#fff;border:none;border-radius:8px;font-size:.95rem;font-weight:600;
                  cursor:pointer;font-family:inherit">
            ${tab === 'login' ? 'Σύνδεση' : 'Δημιουργία Λογαριασμού'}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this._modal = overlay;

    // Tab switch
    overlay.querySelectorAll('.auth-tab').forEach(btn => {
      btn.addEventListener('click', () => this._openModal(btn.dataset.tab));
    });

    // Close
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#authClose').addEventListener('click', () => overlay.remove());

    // Google
    overlay.querySelector('#googleSignIn').addEventListener('click', async () => {
      try {
        await loginWithGoogle();
        overlay.remove();
        toast('Συνδεθήκατε με Google!', 'success');
      } catch (e) { this._showError(e.message); }
    });

    // Email submit
    overlay.querySelector('#authSubmit').addEventListener('click', async () => {
      const email    = overlay.querySelector('#authEmail')?.value?.trim();
      const password = overlay.querySelector('#authPassword')?.value;
      const username = overlay.querySelector('#authUsername')?.value?.trim();
      if (!email || !password) { this._showError('Συμπληρώστε email και κωδικό.'); return; }
      try {
        if (this._tab === 'register') {
          if (!username) { this._showError('Συμπληρώστε ψευδώνυμο.'); return; }
          await registerWithEmail(email, password, username);
          toast('Καλωσήρθατε! Ο λογαριασμός σας δημιουργήθηκε.', 'success');
        } else {
          await loginWithEmail(email, password);
          toast('Συνδεθήκατε!', 'success');
        }
        overlay.remove();
      } catch (e) {
        const map = {
          'auth/user-not-found':    'Δεν βρέθηκε χρήστης με αυτό το email.',
          'auth/wrong-password':    'Λανθασμένος κωδικός.',
          'auth/email-already-in-use': 'Το email χρησιμοποιείται ήδη.',
          'auth/weak-password':     'Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.',
          'auth/invalid-email':     'Μη έγκυρο email.',
        };
        this._showError(map[e.code] ?? e.message);
      }
    });
  }

  _showError(msg) {
    const el = this._modal?.querySelector('#authError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
}

/* ══════════════════════════════════════════════════════════════
   DATA MANAGER
   ══════════════════════════════════════════════════════════════ */
class DataManager {
  constructor() {
    this._raw  = null;
    this._rich = null;
  }

  async load() {
    if (this._raw) return this._raw;
    try {
      const res = await fetch(`${BASE_URL}data/series.json`);
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
    this._rich    = await tmdb.batchResolve(entries);

    // PART 2 FIX: title priority → data.title → tmdb.title → slug
    // PART 2 FIX: overview priority → data.overview → tmdb.overview → ""
    this._rich = this._rich.map(e => ({
      ...e,
      title:    e.data.title    ?? e.tmdb?.title    ?? e.slug,
      overview: e.data.overview ?? e.tmdb?.overview ?? "",
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
      // PART 2 FIX: same priority chain for single-series load
      title:    data.title    ?? tmdbData?.title    ?? slug,
      overview: data.overview ?? tmdbData?.overview ?? "",
      channel:  data.channel  ?? 'Unknown',
    };
  }

  async getChannels() {
    const raw = await this.load();
    return [...new Set(Object.values(raw).map(s => s.channel).filter(Boolean))].sort();
  }
}

/* ══════════════════════════════════════════════════════════════
   CARD RENDERER
   ══════════════════════════════════════════════════════════════ */
function renderCard(entry) {
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
          ${year   ? `<span>${year}</span>`                              : ''}
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
        <button class="row-arrow left" aria-label="Scroll left">${ICONS.chevL}</button>
        <div class="series-row">${cards}</div>
        <button class="row-arrow right" aria-label="Scroll right">${ICONS.chevR}</button>
      </div>
    </div>`;
}

/* ── Shared helpers ─────────────────────────────────────────── */
function observeSections() {
  const io = new IntersectionObserver((entries) => {
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
  $$('.row-wrapper').forEach(wrapper => {
    const row = $('.series-row', wrapper);
    $('.row-arrow.left',  wrapper)?.addEventListener('click', () => row.scrollBy({ left: -row.clientWidth * 0.7, behavior: 'smooth' }));
    $('.row-arrow.right', wrapper)?.addEventListener('click', () => row.scrollBy({ left:  row.clientWidth * 0.7, behavior: 'smooth' }));
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

/* ══════════════════════════════════════════════════════════════
   SEARCH CONTROLLER
   ══════════════════════════════════════════════════════════════ */
class SearchController {
  constructor(allEntries) {
    this._all     = allEntries;
    this._overlay = $('#searchOverlay');
    this._input   = $('#searchInput');
    this._results = $('#searchResults');
    this._init();
  }

  _init() {
    $('#searchToggle')?.addEventListener('click', () => this._open());
    $('#searchClose')?.addEventListener('click',  () => this._close());
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
    const matches = this._all.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.channel.toLowerCase().includes(q) ||
      (e.tmdb?.genres ?? []).join(' ').toLowerCase().includes(q)
    );
    this._results.innerHTML = matches.length
      ? `<div class="series-grid">${matches.map(renderCard).join('')}</div>`
      : `<div class="search-empty">${ICONS.search}<p>Δεν βρέθηκαν αποτελέσματα για "<strong>${q}</strong>"</p></div>`;
  }
}

/* ══════════════════════════════════════════════════════════════
   HOMEPAGE CONTROLLER
   ══════════════════════════════════════════════════════════════ */
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
      this._filterByChannel(chip.dataset.channel);
    });
  }

  _filterByChannel(channel) {
    $$('.series-card[data-slug]').forEach(card => {
      card.style.display = !channel || card.dataset.channel === channel ? '' : 'none';
    });
    $$('[data-channel-section]').forEach(s => {
      s.style.display = (!channel || s.dataset.channelSection === channel) ? '' : 'none';
    });
  }

  _buildSections() {
    const container = $('#sections');
    if (!container) return;

    const featured = this._all.filter(e => e.data.featured);
    const recent   = this._all.slice().reverse().slice(0, 12);
    const random   = shuffle(this._all).filter(e => !featured.find(f => f.slug === e.slug)).slice(0, 10);

    let html = '';
    if (featured.length) html += buildSection('Featured', featured, 'row');
    // PART 3 FIX: Greek labels
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
        `<button class="hero-dot-btn${i === 0 ? ' active' : ''}" data-idx="${i}"></button>`
      ).join('');
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
      const year    = t?.year ?? '';
      const rating  = t?.rating ?? '';
      const seasons = t?.seasons ? `${t.seasons} Σεζόν` : '';
      const genres  = (t?.genres ?? []).slice(0, 3);
      // PART 2 FIX: overview priority
      const desc    = entry.overview ?? '';

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
            ${ICONS.play} Δείτε Τώρα
          </a>
          <a href="${pageUrl('series.html', { id: entry.slug })}" class="btn-secondary">
            ${ICONS.info} Περισσότερα
          </a>
        </div>`;
    }
    $$('.hero-dot-btn').forEach((btn, i) => btn.classList.toggle('active', i === idx));
  }
}

/* ══════════════════════════════════════════════════════════════
   STAR RATING WIDGET
   ══════════════════════════════════════════════════════════════ */
function renderStarRating(container, slug, currentRating = 0) {
  container.innerHTML = `
    <div class="star-rating" data-slug="${slug}">
      ${[1,2,3,4,5].map(n => `
        <button class="star-btn${n <= currentRating ? ' active' : ''}" data-star="${n}" title="${n} αστέρ${n===1?'ι':'ια'}">
          ${ICONS.star}
        </button>`).join('')}
      <span class="star-label">${currentRating ? `${currentRating}/5` : 'Αξιολόγηση'}</span>
    </div>`;

  container.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('mouseover', () => {
      const n = +btn.dataset.star;
      container.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('hover', i < n));
    });
    btn.addEventListener('mouseout', () => {
      container.querySelectorAll('.star-btn').forEach(b => b.classList.remove('hover'));
    });
    btn.addEventListener('click', async () => {
      if (!_currentUser) { toast('Συνδεθείτε για να αξιολογήσετε.', 'info'); return; }
      const stars = +btn.dataset.star;
      await setRating(_currentUser.uid, slug, stars);
      renderStarRating(container, slug, stars);
      toast(`Αξιολόγηση: ${stars}/5 ★`, 'success');
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   COMMENTS WIDGET
   ══════════════════════════════════════════════════════════════ */
async function renderComments(container, slug) {
  const comments = await getComments(slug);

  const listHtml = comments.length
    ? comments.map(c => {
        const date = c.createdAt?.toDate?.()?.toLocaleDateString('el-GR') ?? '';
        return `<div class="comment-item">
          <div class="comment-header">
            <strong class="comment-user">${c.username}</strong>
            <span class="comment-date">${date}</span>
          </div>
          <p class="comment-text">${c.text.replace(/</g,'&lt;')}</p>
        </div>`;
      }).join('')
    : '<p style="color:var(--text-3);font-size:.9rem">Δεν υπάρχουν σχόλια ακόμα. Γίνετε οι πρώτοι!</p>';

  const inputHtml = `
    <div class="comment-input-wrap" id="commentInputWrap" style="${_currentUser ? '' : 'display:none'}">
      <textarea id="commentText" placeholder="Γράψτε ένα σχόλιο…" rows="3"
                style="width:100%;padding:.65rem;border-radius:8px;border:1px solid var(--border);
                       background:var(--bg-card2,#242424);color:var(--text-1);font-family:inherit;
                       font-size:.9rem;resize:vertical;box-sizing:border-box"></textarea>
      <button id="commentSubmit" style="margin-top:.5rem;padding:.6rem 1.25rem;background:var(--accent);
              color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:.9rem">
        Δημοσίευση
      </button>
    </div>
    ${!_currentUser ? '<p style="color:var(--text-3);font-size:.85rem">Συνδεθείτε για να σχολιάσετε.</p>' : ''}`;

  container.innerHTML = `
    <div class="comments-section">
      <h3 style="font-size:1.1rem;margin-bottom:1rem;color:var(--text-2)">💬 Σχόλια</h3>
      ${inputHtml}
      <div class="comments-list" style="margin-top:1.25rem;display:flex;flex-direction:column;gap:.75rem">
        ${listHtml}
      </div>
    </div>`;

  container.querySelector('#commentSubmit')?.addEventListener('click', async () => {
    const text = container.querySelector('#commentText')?.value?.trim();
    if (!text) return;
    if (!_currentUser) { toast('Συνδεθείτε πρώτα.', 'info'); return; }
    await postComment(slug, _currentUser.uid, _currentProfile?.username ?? 'Ανώνυμος', text);
    container.querySelector('#commentText').value = '';
    await renderComments(container, slug); // refresh
    toast('Το σχόλιο δημοσιεύτηκε!', 'success');
  });
}

/* ══════════════════════════════════════════════════════════════
   SERIES PAGE CONTROLLER
   ══════════════════════════════════════════════════════════════ */
class SeriesController {
  constructor() {
    this._dm = new DataManager();
  }

  async init() {
    initNavScroll();
    new AuthController().init();

    const slug = new URLSearchParams(window.location.search).get('id');
    if (!slug) { window.location.href = pageUrl('index.html'); return; }

    const entry = await this._dm.getOne(slug);
    if (!entry) { toast('Η σειρά δεν βρέθηκε.', 'error'); return; }

    document.title = `${entry.title} — StreamVault`;
    await this._render(entry);
    initCardClicks();
  }

  async _render(entry) {
    const { slug, title, channel, tmdb: t, data } = entry;

    // Backdrop
    const backdropEl = $('#seriesBackdrop');
    if (backdropEl && (t?.backdrop || t?.posterLg)) {
      backdropEl.style.backgroundImage = `url('${t.backdrop ?? t.posterLg}')`;
    }

    // Poster
    const posterEl = $('#seriesPoster');
    if (posterEl) {
      posterEl.innerHTML = t?.posterLg
        ? `<img src="${t.posterLg}" alt="${title}">`
        : `<div class="no-poster">${ICONS.film}</div>`;
    }

    $('#seriesChannelBadge').textContent = channel;
    $('#seriesTitle').textContent = title;

    // Meta
    const metaEl = $('#seriesMeta');
    if (metaEl) {
      const parts = [];
      if (t?.year)    parts.push(`<span>${t.year}</span>`);
      if (t?.rating)  parts.push(`<span class="rating-stars">${ICONS.star} ${t.rating}</span>`);
      if (t?.seasons) parts.push(`<span>${t.seasons} Σεζόν</span>`);
      if (t?.status)  parts.push(`<span>${t.status}</span>`);
      metaEl.innerHTML = parts.join('<span class="meta-sep">·</span>');
    }

    // Genres
    const genresEl = $('#seriesGenres');
    if (genresEl && t?.genres?.length) {
      genresEl.innerHTML = t.genres.map(g => `<span class="genre-tag">${g}</span>`).join('');
    }

    // PART 2 FIX: overview priority
    const overviewEl = $('#seriesOverview');
    if (overviewEl) overviewEl.textContent = entry.overview || 'Δεν υπάρχει περιγραφή.';

    // CTA Buttons + User Actions
    const ctaEl = $('#seriesCta');
    if (ctaEl) {
      ctaEl.innerHTML = `
        <a href="${pageUrl('watch.html', { series: slug, season: 1, ep: 1 })}" class="btn-primary">
          ${ICONS.play} Δείτε Τώρα
        </a>
        <a href="${pageUrl('index.html')}" class="btn-secondary">
          ${ICONS.back} Αρχική Σελίδα
        </a>
        <button id="favBtn" class="btn-secondary" style="gap:.4rem">
          ${ICONS.heart} <span id="favLabel">Αγαπημένα</span>
        </button>
        <button id="watchlistBtn" class="btn-secondary" style="gap:.4rem">
          ${ICONS.bookmark} <span id="watchlistLabel">Θα το δω</span>
        </button>`;
    }

    // Star Rating
    const ratingWrap = $('#seriesRatingWrap');
    if (ratingWrap) {
      const current = _currentUser ? await getRating(_currentUser.uid, slug) : 0;
      renderStarRating(ratingWrap, slug, current);
    }

    // Update fav/watchlist buttons on auth change
    const updateUserBtns = async () => {
      if (!_currentUser) {
        const fl = $('#favLabel');       if (fl) fl.textContent = 'Αγαπημένα';
        const wl = $('#watchlistLabel'); if (wl) wl.textContent = 'Θα το δω';
        return;
      }
      const profile = await getUserProfile(_currentUser.uid);
      const isFav   = profile?.favorites?.includes(slug);
      const isWatch = profile?.watchlist?.includes(slug);
      const fl = $('#favLabel');       if (fl) fl.textContent = isFav  ? '❤️ Αφαίρεση' : 'Αγαπημένα';
      const wl = $('#watchlistLabel'); if (wl) wl.textContent = isWatch ? '📌 Αφαίρεση' : 'Θα το δω';
      if (isFav  && $('#favBtn'))       $('#favBtn').style.borderColor       = 'var(--accent)';
      if (isWatch && $('#watchlistBtn')) $('#watchlistBtn').style.borderColor = '#f5a623';
    };

    document.addEventListener('authStateChanged', updateUserBtns);
    await updateUserBtns();

    // Fav button
    $('#favBtn')?.addEventListener('click', async () => {
      if (!_currentUser) { toast('Συνδεθείτε για να αποθηκεύσετε αγαπημένα.', 'info'); return; }
      const added = await toggleFavorite(_currentUser.uid, slug);
      toast(added ? '❤️ Προστέθηκε στα αγαπημένα!' : 'Αφαιρέθηκε από τα αγαπημένα.', 'success');
      await updateUserBtns();
    });

    // Watchlist button
    $('#watchlistBtn')?.addEventListener('click', async () => {
      if (!_currentUser) { toast('Συνδεθείτε για να αποθηκεύσετε στη λίστα.', 'info'); return; }
      const added = await toggleWatchlist(_currentUser.uid, slug);
      toast(added ? '📌 Προστέθηκε στη λίστα!' : 'Αφαιρέθηκε από τη λίστα.', 'success');
      await updateUserBtns();
    });

    // Episodes
    this._renderEpisodes(slug, data.episodes ?? []);

    // Comments
    const commentsEl = $('#seriesComments');
    if (commentsEl) await renderComments(commentsEl, slug);

    // Re-render comments on auth change
    document.addEventListener('authStateChanged', async () => {
      if (commentsEl) await renderComments(commentsEl, slug);
    });
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

    const renderGrid = (season) => bySeason[season].map(ep => {
      const pNames = Object.keys(ep.players ?? {});
      const url    = pageUrl('watch.html', { series: slug, season: ep.season, ep: ep.ep });
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

/* ══════════════════════════════════════════════════════════════
   WATCH PAGE CONTROLLER
   ══════════════════════════════════════════════════════════════ */
class WatchController {
  constructor() {
    this._dm          = new DataManager();
    this._slug        = null;
    this._season      = 1;
    this._ep          = 1;
    this._entry       = null;
    this._players     = {};
    this._activePlayer= null;
  }

  async init() {
    initNavScroll();
    new AuthController().init();
    const params      = new URLSearchParams(window.location.search);
    this._slug        = params.get('series');
    this._season      = +(params.get('season') ?? 1);
    this._ep          = +(params.get('ep')     ?? 1);
    if (!this._slug)  { window.location.href = pageUrl('index.html'); return; }
    this._entry       = await this._dm.getOne(this._slug);
    if (!this._entry) { toast('Η σειρά δεν βρέθηκε.', 'error'); return; }
    document.title    = `${this._entry.title} S${this._season}E${this._ep} — StreamVault`;
    this._findEpisode();
    this._renderMeta();
    this._renderPlayer();
    this._renderControls();
    this._renderAllEpisodes();
  }

  _findEpisode() {
    const ep = (this._entry.data.episodes ?? []).find(e => e.season === this._season && e.ep === this._ep);
    this._players     = ep?.players ?? {};
    this._activePlayer= Object.keys(this._players)[0] ?? null;
  }

  _renderMeta() {
    const titleEl = $('#watchTitle');
    if (titleEl) titleEl.textContent = this._entry.title;
    const badgeEl = $('#watchEpBadge');
    if (badgeEl) badgeEl.textContent = `S${this._season} E${this._ep}`;
    const backLink = $('#watchSeriesLink');
    if (backLink) {
      backLink.href      = pageUrl('series.html', { id: this._slug });
      backLink.innerHTML = `${ICONS.back} Όλα τα Επεισόδια`;
    }
  }

  _renderPlayer() {
    const wrapper = $('#playerWrapper');
    if (!wrapper) return;
    if (!this._activePlayer || !this._players[this._activePlayer]) {
      wrapper.innerHTML = `<div class="player-loading"><div style="font-size:2rem">🎬</div><p>Δεν υπάρχει διαθέσιμος player.</p></div>`;
      return;
    }
    wrapper.innerHTML = `
      <div class="player-loading" id="playerLoading"><div class="spinner"></div><span>Φόρτωση player…</span></div>
      <iframe class="player-iframe" id="playerIframe"
        src="${this._players[this._activePlayer]}"
        allowfullscreen allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-top-navigation"></iframe>`;
    $('#playerIframe')?.addEventListener('load', () => { $('#playerLoading')?.remove(); });
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

    const selectEl = $('#episodeSelect');
    if (selectEl) {
      const bySeason = {};
      (this._entry.data.episodes ?? []).forEach(e => (bySeason[e.season] = bySeason[e.season] || []).push(e));
      selectEl.innerHTML = Object.keys(bySeason).sort((a,b)=>a-b).map(s =>
        `<optgroup label="Σεζόν ${s}">
          ${bySeason[s].map(e =>
            `<option value="${e.season}|${e.ep}" ${e.season===this._season && e.ep===this._ep ? 'selected' : ''}>
              S${e.season} E${e.ep}
            </option>`).join('')}
        </optgroup>`
      ).join('');
      selectEl.addEventListener('change', () => {
        const [s, e] = selectEl.value.split('|').map(Number);
        window.location.href = pageUrl('watch.html', { series: this._slug, season: s, ep: e });
      });
    }

    const episodes = this._entry.data.episodes ?? [];
    const sorted   = [...episodes].sort((a,b) => a.season !== b.season ? a.season - b.season : a.ep - b.ep);
    const curIdx   = sorted.findIndex(e => e.season === this._season && e.ep === this._ep);

    const prevBtn = $('#prevEpBtn');
    const nextBtn = $('#nextEpBtn');
    if (prevBtn) {
      prevBtn.disabled = curIdx <= 0;
      prevBtn.addEventListener('click', () => {
        if (curIdx > 0) {
          const p = sorted[curIdx - 1];
          window.location.href = pageUrl('watch.html', { series: this._slug, season: p.season, ep: p.ep });
        }
      });
    }
    if (nextBtn) {
      nextBtn.disabled = curIdx >= sorted.length - 1;
      nextBtn.addEventListener('click', () => {
        if (curIdx < sorted.length - 1) {
          const n = sorted[curIdx + 1];
          window.location.href = pageUrl('watch.html', { series: this._slug, season: n.season, ep: n.ep });
        }
      });
    }
  }

  _renderAllEpisodes() {
    const container = $('#allEpisodesPanel');
    if (!container) return;
    const bySeason = {};
    (this._entry.data.episodes ?? []).forEach(e => (bySeason[e.season] = bySeason[e.season] || []).push(e));
    const currentSeason = bySeason[this._season] ?? [];
    container.innerHTML = `
      <h3>Σεζόν ${this._season} — Επεισόδια</h3>
      <div class="episodes-grid">
        ${currentSeason.map(ep => {
          const url       = pageUrl('watch.html', { series: this._slug, season: ep.season, ep: ep.ep });
          const isCurrent = ep.season === this._season && ep.ep === this._ep;
          return `
            <a href="${url}" class="episode-card${isCurrent ? '" style="border-color:var(--accent);background:var(--accent-dim)' : ''}">
              <div class="episode-num" style="${isCurrent ? 'color:var(--accent)' : ''}">${String(ep.ep).padStart(2,'0')}</div>
              <div class="episode-info">
                <div class="episode-label">Επεισόδιο ${ep.ep}${isCurrent ? ' <span style="color:var(--accent);font-size:.7rem">(Παίζει)</span>' : ''}</div>
                <div class="episode-players">${Object.keys(ep.players ?? {}).join(', ')}</div>
              </div>
              <div class="episode-play-icon">${ICONS.play}</div>
            </a>`;
        }).join('')}
      </div>`;
  }
}

/* ══════════════════════════════════════════════════════════════
   PROFILE PAGE CONTROLLER
   ══════════════════════════════════════════════════════════════ */
class ProfileController {
  constructor() {
    this._dm = new DataManager();
  }

  async init() {
    initNavScroll();
    new AuthController().init();

    onAuth(async (user) => {
      const main = $('#profileMain');

      if (!user) {
        // Not logged in — show login prompt
        const heroEl = $('#profileHero');
        if (heroEl) heroEl.style.display = 'none';
        if (main) main.innerHTML = `
          <div class="profile-login-prompt">
            <h2>Καλωσήρθατε!</h2>
            <p>Συνδεθείτε για να δείτε τα αγαπημένα σας,<br>τη λίστα παρακολούθησης και τα σχόλιά σας.</p>
            <button class="btn-primary" id="profileLoginBtn">Σύνδεση / Εγγραφή</button>
          </div>`;
        // Wire up the login button to open the auth modal
        main?.querySelector('#profileLoginBtn')?.addEventListener('click', () => {
          document.dispatchEvent(new CustomEvent('openAuthModal'));
        });
        return;
      }

      _currentUser    = user;
      _currentProfile = await getUserProfile(user.uid);
      const profile   = _currentProfile;
      if (!profile) return;

      document.title = `${profile.username} — Προφίλ`;

      // Avatar initial
      const avatarEl = $('#profileAvatar');
      if (avatarEl) avatarEl.textContent = (profile.username?.[0] ?? user.email?.[0] ?? '?').toUpperCase();

      // Name + email
      const usernameEl = $('#profileUsername');
      if (usernameEl) usernameEl.textContent = profile.username;
      const emailEl = $('#profileEmail');
      if (emailEl) emailEl.textContent = profile.email;

      // Load all series for cross-referencing slugs → entries
      const allEntries = await this._dm.loadAll();
      const bySlug     = Object.fromEntries(allEntries.map(e => [e.slug, e]));

      this._renderList('#favoritesGrid',  '#favCount',     profile.favorites ?? [], bySlug,
        '❤️', 'Δεν υπάρχουν αγαπημένα ακόμα.',
        `<a href="./index.html" class="btn-secondary" style="display:inline-flex;margin-top:.5rem">Εξερεύνηση σειρών</a>`);

      this._renderList('#watchlistGrid',  '#watchlistCount', profile.watchlist ?? [], bySlug,
        '📌', 'Η λίστα "Θα τα δω" είναι άδεια.', '');

      this._renderList('#watchedGrid',    '#watchedCount',  profile.watched   ?? [], bySlug,
        '✅', 'Δεν έχετε επισημάνει καμία σειρά ως παρακολουθημένη.', '');
    });

    // Listen for openAuthModal event (fired from login prompt button)
    document.addEventListener('openAuthModal', () => {
      document.dispatchEvent(new CustomEvent('requestAuthModal'));
    });
  }

  _renderList(gridSel, countSel, slugs, bySlug, _icon, emptyMsg, emptyAction = '') {
    const countEl = $(countSel);
    if (countEl) countEl.textContent = slugs.length;

    const el = $(gridSel);
    if (!el) return;

    if (!slugs.length) {
      el.innerHTML = `
        <div class="profile-empty">
          <div class="profile-empty-icon">${_icon}</div>
          <p>${emptyMsg}</p>
          ${emptyAction}
        </div>`;
      return;
    }

    const entries = slugs.map(s => bySlug[s]).filter(Boolean);
    if (!entries.length) {
      el.innerHTML = `<p style="color:var(--text-3);font-size:.9rem">Τα δεδομένα δεν φορτώθηκαν.</p>`;
      return;
    }

    el.innerHTML = `<div class="series-grid">${entries.map(renderCard).join('')}</div>`;

    // Make cards clickable
    el.querySelectorAll('.series-card[data-slug]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        const slug = card.dataset.slug;
        if (slug) window.location.href = pageUrl('series.html', { id: slug });
      });
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════════ */
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
