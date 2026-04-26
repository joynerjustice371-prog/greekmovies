/* ============================================================
   app.js — GreekMovies v6.0  (clean rewrite)
   ============================================================ */

import { tmdb } from './tmdb.js';
import { initAuthManager, getCurrentUser } from './authManager.js';

/* ── Firebase stub ─────────────────────────────────────────── */
let fb = null;

function _createFirebaseStubs() {
  const _na = () => Promise.reject(new Error('Firebase μη διαθέσιμο.'));
  return {
    auth: null, db: null,
    authReady: Promise.resolve(null),
    onAuth: (cb) => { cb(null); return () => {}; },
    loginWithGoogle: _na, loginWithEmail: _na,
    registerWithEmail: _na, forgotPassword: _na, logout: _na,
    ensureUserDoc: async () => null, getUserProfile: async () => null, updateUserProfile: _na,
    getUserFavorites: async () => [], isFavorite: async () => false, toggleFavorite: _na,
    getUserWatchlist: async () => [], isInWatchlist: async () => false, toggleWatchlist: _na,
    getUserSeen: async () => [], isInSeen: async () => false, toggleSeen: _na,
    setRating: _na, getRating: async () => 0, getAllRatings: async () => ({}),
    getAverageRating: async () => ({ avg: 0, count: 0 }),
    onSeriesRatingsSnapshot: () => () => {},
    postComment: _na, getComments: async () => [], getUserComments: async () => [],
    likeComment: _na, dislikeComment: _na,
  };
}

async function loadFirebase() {
  try {
    return await Promise.race([
      import('./firebase.js'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
  } catch (e) { console.warn('[App] Firebase:', e.message); return _createFirebaseStubs(); }
}

/* ── Utilities ─────────────────────────────────────────────── */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pageUrl = (page, params = {}) => {
  const u = new URL(page, window.location.href);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.href;
};

function toast(msg, type = 'info') {
  let c = $('#toast-container');
  if (!c) { c = Object.assign(document.createElement('div'), { id: 'toast-container', className: 'toast-container' }); document.body.appendChild(c); }
  const el = Object.assign(document.createElement('div'), { className: `toast toast-${type}`, textContent: msg });
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => { el.classList.remove('toast-show'); setTimeout(() => el.remove(), 400); }, 3600);
}

const BASE_URL = (() => { try { return new URL('../../', import.meta.url).href; } catch { return '/'; } })();

/* ── Pagination ─────────────────────────────────────────────── */
const PER_PAGE = 24;

function getPage() {
  return Math.max(1, parseInt(new URLSearchParams(location.search).get('page') || '1', 10));
}

function paginate(arr, page) {
  const start = (page - 1) * PER_PAGE;
  return arr.slice(start, start + PER_PAGE);
}

function buildPaginationHTML(cur, total) {
  if (total <= 1) return '';
  const href = (p) => { const u = new URL(location.href); u.searchParams.set('page', p); return u.toString(); };
  const show = new Set([1, total]);
  for (let i = Math.max(1, cur - 2); i <= Math.min(total, cur + 2); i++) show.add(i);
  const nums = [...show].sort((a, b) => a - b);
  let h = '<div class="pagination">';
  h += `<a class="page-btn${cur === 1 ? ' disabled' : ''}" href="${cur > 1 ? href(cur - 1) : '#'}">← Προηγούμενη</a>`;
  let prev = 0;
  for (const p of nums) {
    if (p - prev > 1) h += '<span class="page-ellipsis">…</span>';
    h += `<a class="page-btn${p === cur ? ' active' : ''}" href="${href(p)}">${p}</a>`;
    prev = p;
  }
  h += `<a class="page-btn${cur === total ? ' disabled' : ''}" href="${cur < total ? href(cur + 1) : '#'}">Επόμενη →</a>`;
  return h + '</div>';
}

/* ── Episode normalizer ─────────────────────────────────────── */
function normalizeEpisodes(data) {
  if (Array.isArray(data.seasons) && data.seasons.length) {
    const flat = [];
    for (const s of data.seasons) {
      const sNum = s.season ?? s.season_number ?? 1;
      for (const ep of (s.episodes ?? [])) {
        const epNum = ep.episode ?? ep.episode_number ?? 1;
        const players = {};
        for (const src of (ep.sources ?? [])) {
          const key = src.server || src.name || src.label || 'Server';
          if (src.url) players[key] = src.url;
        }
        if (!Object.keys(players).length && ep.url) players['Server'] = ep.url;
        flat.push({ season: sNum, ep: epNum, title: ep.title ?? '', players });
      }
    }
    return flat;
  }
  if (Array.isArray(data.episodes) && data.episodes.length) {
    return data.episodes.map(ep => ({
      season: ep.season ?? 1,
      ep: ep.episode ?? ep.episode_number ?? ep.ep ?? 1,
      title: ep.title ?? '',
      players: ep.players ?? (ep.url ? { Server: ep.url } : {}),
    }));
  }
  if (data.type === 'movie' && data.players && Object.keys(data.players).length) {
    return [{ season: 1, ep: 1, title: data.title ?? '', players: data.players }];
  }
  return [];
}

/* ── Channel/network derivation — NO "Unknown" ever ─────────── */
function deriveChannel(data) {
  if (Array.isArray(data.networks) && data.networks.length) {
    const name = data.networks[0]?.name;
    if (name && name.toLowerCase() !== 'unknown') return name;
  }
  if (data.channel && data.channel.toLowerCase() !== 'unknown') return data.channel;
  return null;
}

/* ── Icons ──────────────────────────────────────────────────── */
const ICONS = {
  play:      `<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`,
  star:      `<svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>`,
  film:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
  search:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  back:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevL:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevR:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`,
  heart:     `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  bookmark:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  check:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
  user:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  thumbUp:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`,
  thumbDown: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`,
  broadcast: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>`,
};

/* ══════════════════════════════════════════════════════════
   CARD RENDERER  — zero inline onerror with SVG
   All image error handling via setupCards(container)
   ══════════════════════════════════════════════════════════ */
function renderCard(entry) {
  const { slug, title, channel, tmdb: t, _posterFallback } = entry;
  const poster      = t?.poster ?? _posterFallback ?? entry.data?.poster ?? null;
  const year        = t?.year   ?? entry.data?.year   ?? null;
  const rating      = t?.rating ?? entry.data?.rating ?? null;
  const isMovie     = entry.data?.type === 'movie';
  const playerCount = isMovie ? Object.keys(entry.data?.players ?? {}).length : null;
  const watchUrl = pageUrl('watch.html', { series: slug, season: 1, ep: 1 });

  const posterImg = poster
    ? `<img class="card-poster" data-src="${esc(poster)}" alt="${esc(title)}" loading="lazy">`
    : '';
  const placeholder = `<div class="card-no-poster"${poster ? ' style="display:none"' : ''}>${ICONS.film}<span>${esc(title)}</span></div>`;

  return `<div class="series-card" data-slug="${esc(slug)}" data-title="${esc(title.toLowerCase())}" data-channel="${esc((channel ?? '').toLowerCase())}">
    ${posterImg}${placeholder}
    <div class="card-overlay">
      <div class="card-title">${esc(title)}</div>
      <div class="card-meta">
        ${year   ? `<span>${esc(String(year))}</span>` : ''}
        ${rating ? `<span class="card-rating">${ICONS.star}${rating}</span>` : ''}
        ${playerCount !== null
          ? `<span class="card-channel">${playerCount} player${playerCount !== 1 ? 's' : ''}</span>`
          : channel ? `<span class="card-channel">${esc(channel)}</span>` : ''}
      </div>
    </div>
    <a href="${watchUrl}" class="card-play-btn" aria-label="Παρακολούθηση ${esc(title)}">${ICONS.play}</a>
  </div>`;
}

/* Activate lazy images and attach error handlers — call after every innerHTML with cards */
function setupCards(container) {
  container.querySelectorAll('img[data-src]').forEach(img => {
    const src = img.dataset.src;
    const ph = img.nextElementSibling; /* card-no-poster div */
    img.addEventListener('error', () => {
      img.style.display = 'none';
      if (ph) ph.style.display = 'flex';
    }, { once: true });
    img.src = src;
    img.removeAttribute('data-src');
  });
}

/* ── Nav helpers ────────────────────────────────────────────── */
function initNavScroll() {
  const nav = $('#navbar'); if (!nav) return;
  const fn = () => nav.classList.toggle('scrolled', window.scrollY > 60);
  window.addEventListener('scroll', fn, { passive: true }); fn();
}

let _cardClicksInit = false;
function initCardClicks() {
  if (_cardClicksInit) return; _cardClicksInit = true;
  document.addEventListener('click', e => {
    const card = e.target.closest('.series-card');
    if (!card || e.target.closest('a') || e.target.closest('.card-play-btn')) return;
    const slug = card.dataset.slug;
    if (slug) window.location.href = pageUrl('series.html', { id: slug });
  });
}

/* ══════════════════════════════════════════════════════════
   SESSION
   ══════════════════════════════════════════════════════════ */
const Session = {
  user: null, profile: null,
  favorites: new Set(), watchlist: new Set(), seen: new Set(),
  ratings: {}, loaded: false, hydrating: false, loadError: null,
  _loadingPromise: null,

  async hydrate(user) {
    if (!user) { this.clear(); return; }
    if (this.loaded && this.user?.uid === user.uid) return;
    if (this._loadingPromise) return this._loadingPromise;
    this._loadingPromise = (async () => {
      this.hydrating = true; this.loadError = null;
      try {
        try { await fb.ensureUserDoc(user); } catch (_) {}
        const [profile, favs, watch, seen, ratings] = await Promise.all([
          fb.getUserProfile(user.uid), fb.getUserFavorites(user.uid),
          fb.getUserWatchlist(user.uid), fb.getUserSeen(user.uid), fb.getAllRatings(user.uid),
        ]);
        if ((fb?.auth?.currentUser?.uid ?? null) && fb.auth.currentUser.uid !== user.uid) return;
        this.user = user;
        this.profile = profile ?? { uid: user.uid, username: user.displayName || user.email?.split('@')[0] || 'Χρήστης', email: user.email, avatar: user.photoURL || null };
        (favs ?? []).forEach(s => this.favorites.add(s));
        (watch ?? []).forEach(s => this.watchlist.add(s));
        (seen ?? []).forEach(s => this.seen.add(s));
        for (const [k, v] of Object.entries(ratings ?? {})) { if (this.ratings[k] === undefined) this.ratings[k] = v; }
        this.loaded = true; this.loadError = null;
      } catch (e) {
        this.user = user;
        this.profile = this.profile ?? { uid: user.uid, username: user.displayName || user.email?.split('@')[0] || 'Χρήστης', email: user.email, avatar: user.photoURL || null };
        this.loaded = false; this.loadError = e; throw e;
      } finally { this.hydrating = false; this._loadingPromise = null; this._emit(); }
    })();
    return this._loadingPromise;
  },

  clear() {
    this.user = null; this.profile = null;
    this.favorites.clear(); this.watchlist.clear(); this.seen.clear();
    this.ratings = {}; this.loaded = false; this.hydrating = false;
    this.loadError = null; this._loadingPromise = null;
  },

  isFav(s)    { return this.favorites.has(s); },
  isWatch(s)  { return this.watchlist.has(s); },
  isSeen(s)   { return this.seen.has(s); },
  getRating(s){ return this.ratings[s] ?? 0; },
  _liveUser() { return fb?.auth?.currentUser ?? null; },

  async toggleFavorite(slug) {
    const u = this._liveUser(); if (!u) throw new Error('Πρέπει να είστε συνδεδεμένοι.');
    const was = this.favorites.has(slug);
    if (was) this.favorites.delete(slug); else this.favorites.add(slug); this._emit();
    try { const r = await fb.toggleFavorite(u.uid, slug); if (r) this.favorites.add(slug); else this.favorites.delete(slug); this._emit(); return r; }
    catch (e) { const off = e.code === 'unavailable' || (e.message ?? '').includes('offline'); if (!off) { if (was) this.favorites.add(slug); else this.favorites.delete(slug); this._emit(); } throw e; }
  },
  async toggleWatchlist(slug) {
    const u = this._liveUser(); if (!u) throw new Error('Πρέπει να είστε συνδεδεμένοι.');
    const was = this.watchlist.has(slug);
    if (was) this.watchlist.delete(slug); else this.watchlist.add(slug); this._emit();
    try { const r = await fb.toggleWatchlist(u.uid, slug); if (r) this.watchlist.add(slug); else this.watchlist.delete(slug); this._emit(); return r; }
    catch (e) { const off = e.code === 'unavailable' || (e.message ?? '').includes('offline'); if (!off) { if (was) this.watchlist.add(slug); else this.watchlist.delete(slug); this._emit(); } throw e; }
  },
  async toggleSeen(slug) {
    const u = this._liveUser(); if (!u) throw new Error('Πρέπει να είστε συνδεδεμένοι.');
    const was = this.seen.has(slug);
    if (was) this.seen.delete(slug); else this.seen.add(slug); this._emit();
    try { const r = await fb.toggleSeen(u.uid, slug); if (r) this.seen.add(slug); else this.seen.delete(slug); this._emit(); return r; }
    catch (e) { const off = e.code === 'unavailable' || (e.message ?? '').includes('offline'); if (!off) { if (was) this.seen.add(slug); else this.seen.delete(slug); this._emit(); } throw e; }
  },
  async setRating(slug, stars) {
    const u = this._liveUser(); if (!u) throw new Error('Πρέπει να είστε συνδεδεμένοι.');
    const prev = this.ratings[slug] ?? 0; this.ratings[slug] = stars; this._emit();
    try { await fb.setRating(u.uid, slug, stars); return stars; }
    catch (e) { const off = e.code === 'unavailable' || (e.message ?? '').includes('offline'); if (!off) { if (prev) this.ratings[slug] = prev; else delete this.ratings[slug]; this._emit(); } throw e; }
  },
  _emit() { document.dispatchEvent(new CustomEvent('sessionChanged', { detail: { session: this } })); },
};

/* ══════════════════════════════════════════════════════════
   AUTH CONTROLLER
   ══════════════════════════════════════════════════════════ */
class AuthController {
  static _inst = null;
  static _unsub = null;

  init() {
    if (AuthController._inst) return AuthController._inst;
    AuthController._inst = this;
    this._injectNavUI();
    if (typeof AuthController._unsub === 'function') { try { AuthController._unsub(); } catch (_) {} }
    AuthController._unsub = fb.onAuth(user => {
      if (user) {
        this._modal?.remove(); this._modal = null;
        const qn = user.displayName || user.email?.split('@')[0] || '?';
        this._setIn(qn, user.photoURL ?? null);
        document.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user, profile: null } }));
        Session.hydrate(user).then(() => {
          if (Session.profile) this._setIn(Session.profile.username || qn, Session.profile.avatar || user.photoURL || null);
          document.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user, profile: Session.profile } }));
        }).catch(e => console.warn('[Auth]', e.message));
      } else {
        Session.clear(); this._setOut();
        document.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user: null, profile: null } }));
      }
    });
    document.addEventListener('openAuthModal', () => this._openModal());
    return this;
  }

  _injectNavUI() {
    const actions = document.getElementById('nav-actions'); if (!actions) return;
    document.getElementById('authNavWrap')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'authNavWrap'; wrap.className = 'auth-nav-wrap'; wrap.dataset.state = 'pending';
    wrap.innerHTML = `
      <button id="navLoginBtn" class="nav-login-btn" type="button">Σύνδεση</button>
      <div id="navUserMenu" class="nav-user-menu">
        <button class="nav-avatar-btn" id="navAvatarBtn" type="button" aria-label="Μενού" aria-expanded="false">
          <img id="navAvatarImg" class="nav-avatar-img" alt="" hidden>
          <span class="nav-avatar-initials" id="navAvatarInitials">?</span>
        </button>
        <div class="nav-dropdown" id="navDropdown" role="menu">
          <div class="nav-dropdown-header"><span class="nav-dropdown-username" id="navDropdownUsername"></span></div>
          <a class="nav-dropdown-item" href="./profile.html" role="menuitem">${ICONS.user} Προφίλ</a>
          <a class="nav-dropdown-item" href="./profile.html#favorites" role="menuitem">${ICONS.heart} Αγαπημένα</a>
          <a class="nav-dropdown-item" href="./profile.html#watchlist" role="menuitem">${ICONS.bookmark} Watchlist</a>
          <a class="nav-dropdown-item" href="./profile.html#seen" role="menuitem">${ICONS.check} Έχω δει</a>
          <div class="nav-dropdown-divider"></div>
          <button class="nav-dropdown-item nav-dropdown-logout" id="navLogoutBtn" role="menuitem" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Αποσύνδεση
          </button>
        </div>
      </div>`;
    actions.appendChild(wrap);
    this.$w        = wrap;
    this.$loginBtn = wrap.querySelector('#navLoginBtn');
    this.$initials = wrap.querySelector('#navAvatarInitials');
    this.$avatarImg= wrap.querySelector('#navAvatarImg');
    this.$username = wrap.querySelector('#navDropdownUsername');
    this.$dropdown = wrap.querySelector('#navDropdown');
    this.$avatarBtn= wrap.querySelector('#navAvatarBtn');

    this.$loginBtn.addEventListener('click', () => this._openModal());
    this.$avatarBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = this.$dropdown.classList.toggle('open');
      this.$avatarBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', e => { if (this.$w && !this.$w.contains(e.target)) { this.$dropdown?.classList.remove('open'); this.$avatarBtn?.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.$dropdown?.classList.remove('open'); });
    wrap.querySelector('#navLogoutBtn').addEventListener('click', async () => {
      this.$dropdown?.classList.remove('open');
      try { await fb.logout(); toast('Αποσυνδεθήκατε.'); } catch (e) { toast('Σφάλμα: ' + e.message, 'error'); }
    });
  }

  _setIn(name, avatar = null) {
    if (!this.$w) return;
    this.$w.dataset.state = 'loggedIn';
    const d = String(name || '?');
    this.$initials.textContent = d.charAt(0).toUpperCase();
    this.$username.textContent = d;
    if (avatar) {
      this.$avatarImg.src = avatar; this.$avatarImg.alt = d; this.$avatarImg.hidden = false;
      this.$initials.style.display = 'none';
      this.$avatarImg.addEventListener('error', () => { this.$avatarImg.hidden = true; this.$initials.style.display = ''; }, { once: true });
    } else { this.$avatarImg.hidden = true; this.$initials.style.display = ''; }
  }

  _setOut() {
    if (!this.$w) return;
    this.$w.dataset.state = 'loggedOut';
    this.$dropdown?.classList.remove('open');
    this.$avatarBtn?.setAttribute('aria-expanded', 'false');
  }

  _openModal(tab = 'login') {
    this._tab = tab; this._modal?.remove();
    const o = document.createElement('div'); o.id = 'authModal'; o.className = 'auth-overlay';
    const isL = tab === 'login', isR = tab === 'register', isF = tab === 'forgot';
    const googleSvg = `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;
    o.innerHTML = `<div class="auth-modal">
      <button class="auth-modal-close" id="authClose" type="button">✕</button>
      ${!isF ? `
      <div class="auth-tabs">
        <button class="auth-tab${isL ? ' auth-tab-active' : ''}" data-tab="login" type="button">Σύνδεση</button>
        <button class="auth-tab${isR ? ' auth-tab-active' : ''}" data-tab="register" type="button">Εγγραφή</button>
      </div>
      <button id="googleSignIn" class="auth-google-btn" type="button">${googleSvg} Συνέχεια με Google</button>
      <div class="auth-divider"><span>ή με email</span></div>
      <div id="authFormWrap">
        ${isR ? '<input id="authUsername" type="text" placeholder="Ψευδώνυμο" autocomplete="username" class="auth-input">' : ''}
        <input id="authEmail" type="email" placeholder="Email" autocomplete="email" class="auth-input">
        <input id="authPassword" type="password" placeholder="Κωδικός" autocomplete="${isL ? 'current-password' : 'new-password'}" class="auth-input">
        <p id="authError" class="auth-error" style="display:none"></p>
        <button id="authSubmit" class="auth-submit-btn" type="button">${isL ? 'Σύνδεση' : 'Δημιουργία Λογαριασμού'}</button>
        ${isL ? '<button class="auth-forgot-link" id="authForgotLink" type="button">Ξεχάσατε τον κωδικό;</button>' : ''}
      </div>` : `
      <div class="auth-forgot-view">
        <h3 class="auth-forgot-title">Επαναφορά Κωδικού</h3>
        <p class="auth-forgot-desc">Εισάγετε το email σας.</p>
        <input id="forgotEmail" type="email" placeholder="Email" autocomplete="email" class="auth-input">
        <p id="forgotError" class="auth-error" style="display:none"></p>
        <p id="forgotSuccess" class="auth-success" style="display:none"></p>
        <button id="forgotSubmit" class="auth-submit-btn" type="button">Αποστολή</button>
        <button class="auth-forgot-link" id="backToLogin" type="button">← Πίσω στη Σύνδεση</button>
      </div>`}
    </div>`;
    document.body.appendChild(o); this._modal = o;
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });
    o.querySelector('#authClose')?.addEventListener('click', () => o.remove());
    o.querySelectorAll('.auth-tab').forEach(b => b.addEventListener('click', () => this._openModal(b.dataset.tab)));
    o.querySelector('#authForgotLink')?.addEventListener('click', () => this._openModal('forgot'));
    o.querySelector('#backToLogin')?.addEventListener('click', () => this._openModal('login'));
    o.querySelector('#googleSignIn')?.addEventListener('click', async () => {
      try { await fb.loginWithGoogle(); o.remove(); toast('Συνδεθήκατε!', 'success'); }
      catch (e) { this._showErr(this._mapErr(e)); }
    });
    o.querySelector('#authSubmit')?.addEventListener('click', async () => {
      const em = o.querySelector('#authEmail')?.value?.trim();
      const pw = o.querySelector('#authPassword')?.value;
      const un = o.querySelector('#authUsername')?.value?.trim();
      if (!em || !pw) { this._showErr('Συμπληρώστε email και κωδικό.'); return; }
      try {
        if (this._tab === 'register') { if (!un) { this._showErr('Συμπληρώστε ψευδώνυμο.'); return; } await fb.registerWithEmail(em, pw, un); toast('Καλωσήρθατε!', 'success'); }
        else { await fb.loginWithEmail(em, pw); toast('Συνδεθήκατε!', 'success'); }
        o.remove();
      } catch (e) { this._showErr(this._mapErr(e)); }
    });
    o.querySelector('#forgotSubmit')?.addEventListener('click', async () => {
      const em = o.querySelector('#forgotEmail')?.value?.trim();
      if (!em) { this._showForgotErr('Εισάγετε email.'); return; }
      try {
        await fb.forgotPassword(em);
        const s = o.querySelector('#forgotSuccess'), er = o.querySelector('#forgotError');
        if (s) { s.textContent = 'Στάλθηκε email!'; s.style.display = 'block'; }
        if (er) er.style.display = 'none';
      } catch (e) { this._showForgotErr(this._mapErr(e)); }
    });
    o.addEventListener('keydown', e => {
      if (e.key === 'Enter') { o.querySelector('#authSubmit')?.click(); o.querySelector('#forgotSubmit')?.click(); }
      if (e.key === 'Escape') o.remove();
    });
  }

  _mapErr(e) {
    const m = { 'auth/user-not-found': 'Δεν βρέθηκε χρήστης.', 'auth/wrong-password': 'Λανθασμένος κωδικός.', 'auth/invalid-credential': 'Λανθασμένα στοιχεία.', 'auth/email-already-in-use': 'Το email χρησιμοποιείται ήδη.', 'auth/weak-password': 'Κωδικός τουλάχιστον 6 χαρακτήρες.', 'auth/invalid-email': 'Μη έγκυρο email.', 'auth/too-many-requests': 'Πολλές προσπάθειες.' };
    return m[e.code] ?? e.message;
  }
  _showErr(msg)       { const el = this._modal?.querySelector('#authError');   if (el) { el.textContent = msg; el.style.display = 'block'; } }
  _showForgotErr(msg) { const el = this._modal?.querySelector('#forgotError'); if (el) { el.textContent = msg; el.style.display = 'block'; } }
}

/* ══════════════════════════════════════════════════════════
   DATA MANAGER
   ══════════════════════════════════════════════════════════ */
class DataManager {
  constructor() { this._raw = null; this._local = null; this._rich = null; }

  async _loadRaw() {
    if (this._raw) return this._raw;
    try {
      const [seriesRes, moviesRes, metaRes] = await Promise.all([
        fetch(`${BASE_URL}data/series.json`),
        fetch(`${BASE_URL}data/movies.json`).catch(() => null),
        fetch(`${BASE_URL}data/movies.meta.json`).catch(() => null),
      ]);
      const seriesData = seriesRes.ok ? await seriesRes.json() : {};
      const moviesData = moviesRes?.ok ? await moviesRes.json() : {};
      const metaData   = metaRes?.ok  ? await metaRes.json()  : {};
      for (const key of Object.keys(moviesData)) {
        if (metaData[key]) moviesData[key].featured = metaData[key].featured ?? false;
      }
      this._raw = { ...seriesData, ...moviesData };
      if (typeof this._raw !== 'object' || Array.isArray(this._raw)) throw new Error('Invalid JSON');
      return this._raw;
    } catch (e) { console.error('[DM]', e.message); this._raw = {}; return this._raw; }
  }

  _build(raw) {
    return Object.entries(raw).map(([slug, data]) => {
      if (!data._normalized) { data.episodes = normalizeEpisodes(data); data._normalized = true; }
      return {
        slug, data, tmdb: null,
        title: data.title ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        overview: data.overview ?? '',
        channel: deriveChannel(data),
        _posterFallback: data.poster ?? null,
        _backdropFallback: data.backdrop ?? null,
      };
    });
  }

  _merge(locals, results) {
    const map = new Map(results.map(e => [e.slug, e.tmdb]));
    return locals.map(l => {
      const t = map.get(l.slug) ?? null;
      return { ...l, tmdb: t, title: l.data.title ?? t?.title ?? l.title, overview: l.data.overview ?? t?.overview ?? l.overview };
    });
  }

  async loadLocalFast() {
    if (this._rich || this._local) return this._rich ?? this._local;
    const raw = await this._loadRaw();
    if (!Object.keys(raw).length) return [];
    this._local = this._build(raw);
    return this._local;
  }

  async loadAll() {
    if (this._rich) return this._rich;
    const raw = await this._loadRaw();
    if (!Object.keys(raw).length) { this._rich = []; return this._rich; }
    this._local = this._build(raw);
    try {
      const entries = Object.entries(raw).map(([slug, data]) => ({ slug, data }));
      const results = await Promise.race([tmdb.batchResolve(entries), new Promise(r => setTimeout(() => r(null), 8000))]);
      this._rich = (results?.length > 0) ? this._merge(this._local, results) : this._local;
    } catch (e) { console.warn('[DM] TMDB:', e.message); this._rich = this._local; }
    return this._rich;
  }

  async getOne(slug) {
    const raw = await this._loadRaw();
    const data = raw[slug]; if (!data) return null;
    if (!data._normalized) { data.episodes = normalizeEpisodes(data); data._normalized = true; }
    const local = {
      slug, data, tmdb: null,
      title: data.title ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      overview: data.overview ?? '',
      channel: deriveChannel(data),
      _posterFallback: data.poster ?? null,
      _backdropFallback: data.backdrop ?? null,
    };
    try {
      const t = await Promise.race([tmdb.getDetails(data), new Promise(r => setTimeout(() => r(null), 6000))]);
      if (t) return { ...local, tmdb: t, title: data.title ?? t.title ?? local.title, overview: data.overview ?? t.overview ?? local.overview };
    } catch (e) { console.warn('[DM] getOne:', e.message); }
    return local;
  }
}

/* ══════════════════════════════════════════════════════════
   GENRES
   ══════════════════════════════════════════════════════════ */
export const GREEK_GENRES = [
  'Σειρές', 'Κωμωδία', 'Δράμα', 'Δράση', 'Θρίλερ', 'Κινούμενα Σχέδια', 'Anime',
  'Οικογενειακές', 'Αισθηματικές', 'Μιούζικαλ', 'Περιπέτεια', 'Sci-Fi', 'Φαντασίας',
  'Western', 'Τρόμου', 'Μυστηρίου', 'Εγκλήματος', 'Ιστορικές', 'Βιογραφίες', 'Ντοκιμαντέρ',
  'Ελληνικές Ταινίες', 'Θέατρο', 'Αθλητικά',
];

const GENRE_MAP = {
  'Action': ['Δράση'], 'Adventure': ['Περιπέτεια'], 'Animation': ['Κινούμενα Σχέδια'], 'Comedy': ['Κωμωδία'],
  'Crime': ['Εγκλήματος'], 'Documentary': ['Ντοκιμαντέρ'], 'Drama': ['Δράμα'], 'Family': ['Οικογενειακές'],
  'Fantasy': ['Φαντασίας'], 'History': ['Ιστορικές'], 'Horror': ['Τρόμου'], 'Music': ['Μιούζικαλ'],
  'Mystery': ['Μυστηρίου'], 'Romance': ['Αισθηματικές'], 'Science Fiction': ['Sci-Fi'], 'Sci-Fi & Fantasy': ['Sci-Fi', 'Φαντασίας'],
  'Thriller': ['Θρίλερ'], 'War': ['Ιστορικές'], 'Western': ['Western'],
  'Action & Adventure': ['Δράση', 'Περιπέτεια'], 'Kids': ['Οικογενειακές'], 'Soap': ['Δράμα', 'Αισθηματικές'],
  'Δράμα': ['Δράμα'], 'Κωμωδία': ['Κωμωδία'], 'Δράση': ['Δράση'], 'Θρίλερ': ['Θρίλερ'],
};

export function classifyEntry(entry) {
  const tags = new Set();
  const genres = entry.tmdb?.genres ?? entry.data?.genres ?? [];
  for (const g of genres) { const m = GENRE_MAP[g] ?? []; m.forEach(t => tags.add(t)); }
  const origin = entry.tmdb?.originCountry ?? [];
  tags.add('Σειρές');
  if (genres.some(g => g === 'Animation') && origin.includes('JP')) tags.add('Anime');
  if (origin.includes('GR')) tags.add('Ελληνικές Ταινίες');
  (entry.data?.categories ?? []).forEach(t => tags.add(t));
  return [...tags];
}

/* ══════════════════════════════════════════════════════════
   SEARCH CONTROLLER
   ══════════════════════════════════════════════════════════ */
class SearchController {
  constructor(all) {
    this._all = all;
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

  _open()  { this._overlay?.classList.add('active'); setTimeout(() => this._input?.focus(), 50); }
  _close() { this._overlay?.classList.remove('active'); if (this._input) this._input.value = ''; if (this._results) this._results.innerHTML = ''; }

  _run() {
    const q = this._input?.value?.trim().toLowerCase() ?? '';
    if (!q) { if (this._results) this._results.innerHTML = ''; return; }
    const m = this._all.filter(e => e.title.toLowerCase().includes(q) || (e.channel ?? '').toLowerCase().includes(q));
    if (this._results) {
      if (m.length) {
        this._results.innerHTML = `<div class="series-grid">${m.map(renderCard).join('')}</div>`;
        setupCards(this._results);
      } else {
        this._results.innerHTML = `<div class="search-empty">${ICONS.search}<p>Δεν βρέθηκαν αποτελέσματα για "<strong>${esc(q)}</strong>"</p></div>`;
      }
    }
  }
}

/* ══════════════════════════════════════════════════════════
   HOMEPAGE CONTROLLER
   Targets static anchors in index.html:
     #homeGrid       — the card grid
     #homeCount      — "N τίτλοι" label
     #homePagination — pagination bar
   Sorted by last_updated DESC, paginated 24/page.
   ══════════════════════════════════════════════════════════ */
class HomepageController {
  constructor() { this._dm = new DataManager(); }

  async init() {
    initNavScroll();
    new AuthController().init();
    const all = await this._dm.loadAll();
    if (!all.length) {
      const grid = $('#homeGrid');
      if (grid) grid.innerHTML = `<div class="home-empty"><p>Δεν ήταν δυνατή η φόρτωση περιεχομένου.</p></div>`;
      return;
    }
    this._render(all);
    new SearchController(all);
    initCardClicks();
  }

  _render(all) {
    const grid       = $('#homeGrid');
    const countEl    = $('#homeCount');
    const pagination = $('#homePagination');
    const featured   = $('#homeFeatured');
    if (!grid) return;

    const sorted = [...all].sort((a, b) => (b.data.last_updated || 0) - (a.data.last_updated || 0));

    /* Featured movies → dedicated hero section */
    if (featured) {
      const featuredMovies = sorted.filter(e => e.data.type === 'movie' && e.data.featured);
      if (featuredMovies.length) {
        featured.innerHTML = `
          <div class="home-section-header">
            <h2 class="home-section-title">🎬 Προτεινόμενες Ταινίες</h2>
          </div>
          <div class="series-grid home-grid" style="margin-bottom:2rem">${featuredMovies.map(renderCard).join('')}</div>`;
        setupCards(featured);
      } else {
        featured.innerHTML = '';
      }
    }

    /* Latest row: all content except featured movies */
    const latest = sorted.filter(e => !(e.data.type === 'movie' && e.data.featured));

    const page       = getPage();
    const totalPages = Math.ceil(latest.length / PER_PAGE);
    const items      = paginate(latest, page);

    if (countEl) countEl.textContent = `${all.length} τίτλοι`;
    grid.innerHTML = items.map(renderCard).join('');
    setupCards(grid);
    if (pagination) pagination.innerHTML = buildPaginationHTML(page, totalPages);
  }
}

/* ══════════════════════════════════════════════════════════
   STAR RATING
   ══════════════════════════════════════════════════════════ */
function renderStarRating(container, slug) {
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cur  = Session.getRating(slug);
  container.innerHTML = `<div class="star-rating" data-slug="${esc(slug)}">
    ${[1, 2, 3, 4, 5].map(n => `<button class="star-btn${n <= cur ? ' active' : ''}" data-star="${n}" title="${n}★" type="button">${ICONS.star}</button>`).join('')}
    <span class="star-label" id="starLabel-${safe}">${cur ? `${cur}/5` : fb?.auth?.currentUser ? 'Αξιολόγησε' : 'Συνδεθείτε'}</span>
    <span class="star-avg-badge" id="starAvg-${safe}"></span>
  </div>`;
  fb.getAverageRating(slug).then(({ avg, count }) => {
    const el = document.getElementById(`starAvg-${safe}`);
    if (el && count > 0) el.textContent = `· Μ.Ο. ${avg}★ (${count})`;
  }).catch(() => {});
  if (container._ratingUnsub) { try { container._ratingUnsub(); } catch (_) {} }
  container._ratingUnsub = fb.onSeriesRatingsSnapshot(slug, ({ avg, count }) => {
    const el = document.getElementById(`starAvg-${safe}`);
    if (el) el.textContent = count > 0 ? `· Μ.Ο. ${avg}★ (${count})` : '';
  });
  container.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('mouseover', () => { const n = +btn.dataset.star; container.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('hover', i < n)); });
    btn.addEventListener('mouseout',  () => { container.querySelectorAll('.star-btn').forEach(b => b.classList.remove('hover')); });
    btn.addEventListener('click', async () => {
      if (!fb?.auth?.currentUser) { toast('Συνδεθείτε για αξιολόγηση.', 'info'); return; }
      const stars = +btn.dataset.star;
      container.querySelectorAll('.star-btn').forEach((b, i) => { b.classList.toggle('active', i < stars); b.classList.remove('hover'); });
      const lbl = document.getElementById(`starLabel-${safe}`);
      if (lbl) lbl.textContent = `${stars}/5`;
      try { await Session.setRating(slug, stars); toast(`Αξιολόγηση: ${stars}/5 ★`, 'success'); }
      catch (e) { console.error('[Rating]', e); toast('Σφάλμα αξιολόγησης.', 'error'); }
    });
  });
}

/* ══════════════════════════════════════════════════════════
   COMMENTS
   ══════════════════════════════════════════════════════════ */
function _commentAvatar(c) {
  const i = (c.username?.[0] ?? '?').toUpperCase();
  if (c.userAvatar) {
    const img = document.createElement('img');
    img.className = 'comment-avatar-img';
    img.alt = c.username ?? '';
    img.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = 'comment-avatar-initials';
      span.textContent = i;
      img.replaceWith(span);
    }, { once: true });
    img.src = c.userAvatar;
    const tmp = document.createElement('div');
    tmp.appendChild(img);
    return tmp.innerHTML;
  }
  return `<span class="comment-avatar-initials">${esc(i)}</span>`;
}

async function renderComments(container, slug) {
  let comments = [];
  try { comments = await fb.getComments(slug); } catch (_) {}
  const listHtml = comments.length
    ? comments.map(c => {
        const date = c.createdAt?.toDate?.()?.toLocaleDateString('el-GR') ?? '';
        return `<div class="comment-item">
          <div class="comment-header">
            <div class="comment-avatar">${_commentAvatar(c)}</div>
            <strong class="comment-user">${esc(c.username ?? 'Ανώνυμος')}</strong>
            <span class="comment-date">${date}</span>
          </div>
          <p class="comment-text">${esc(c.text ?? '')}</p>
          <div class="comment-actions">
            <button class="comment-action-btn like-btn" data-id="${c.id}" data-slug="${esc(slug)}" type="button">${ICONS.thumbUp} <span>${c.likes ?? 0}</span></button>
            <button class="comment-action-btn dislike-btn" data-id="${c.id}" data-slug="${esc(slug)}" type="button">${ICONS.thumbDown} <span>${c.dislikes ?? 0}</span></button>
          </div>
        </div>`;
      }).join('')
    : '<p class="comments-empty">Δεν υπάρχουν σχόλια ακόμα.</p>';

  const isIn = !!(fb?.auth?.currentUser || Session.user);
  container.innerHTML = `<div class="comments-section">
    <h3 class="comments-title">💬 Σχόλια${comments.length ? ` <span class="count-badge">${comments.length}</span>` : ''}</h3>
    ${isIn
      ? `<div class="comment-input-wrap">
          <textarea id="commentText" placeholder="Γράψτε ένα σχόλιο…" rows="3" class="comment-textarea" maxlength="2000"></textarea>
          <button id="commentSubmit" class="comment-submit-btn" type="button">Δημοσίευση</button>
        </div>`
      : `<div class="comment-login-notice"><p>Πρέπει να <button class="comment-login-link" id="commentLoginBtn" type="button">συνδεθείτε</button> για να σχολιάσετε.</p></div>`}
    <div class="comments-list">${listHtml}</div>
  </div>`;

  container.querySelector('#commentLoginBtn')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('openAuthModal')));
  container.querySelectorAll('.like-btn').forEach(b    => b.addEventListener('click', async () => { if (!fb?.auth?.currentUser) { toast('Συνδεθείτε.', 'info'); return; } await fb.likeComment(b.dataset.slug, b.dataset.id); await renderComments(container, slug); }));
  container.querySelectorAll('.dislike-btn').forEach(b => b.addEventListener('click', async () => { if (!fb?.auth?.currentUser) { toast('Συνδεθείτε.', 'info'); return; } await fb.dislikeComment(b.dataset.slug, b.dataset.id); await renderComments(container, slug); }));
  container.querySelector('#commentSubmit')?.addEventListener('click', async () => {
    const text = container.querySelector('#commentText')?.value?.trim(); if (!text) { toast('Γράψτε κάτι.', 'info'); return; }
    const lu = fb?.auth?.currentUser ?? Session.user; if (!lu) { toast('Συνδεθείτε.', 'info'); return; }
    try {
      const u = Session.profile?.username ?? lu.displayName ?? lu.email?.split('@')[0] ?? 'Ανώνυμος';
      const a = Session.profile?.avatar ?? lu.photoURL ?? null;
      await fb.postComment(slug, lu.uid, u, text, a);
      container.querySelector('#commentText').value = '';
      await renderComments(container, slug); toast('Δημοσιεύτηκε!', 'success');
    } catch (e) { toast('Σφάλμα.', 'error'); }
  });
}

/* ══════════════════════════════════════════════════════════
   SERIES CONTROLLER  — listing (no ?id) + detail (?id=slug)
   ══════════════════════════════════════════════════════════ */
class SeriesController {
  constructor() { this._dm = new DataManager(); }

  async init() {
    initNavScroll();
    new AuthController().init();
    const slug = new URLSearchParams(location.search).get('id');
    if (slug) await this._detail(slug);
    else      await this._listing();
  }

  /* LISTING ─────────────────────────────────────────────── */
  async _listing() {
    const all    = await this._dm.loadAll();
    const series = all.filter(e => e.data.type === 'series' || !e.data.type);
    const sorted = [...series].sort((a, b) => (b.data.last_updated || 0) - (a.data.last_updated || 0));
    const page   = getPage();
    const total  = Math.ceil(sorted.length / PER_PAGE);
    const items  = paginate(sorted, page);

    document.title = 'Σειρές — GreekMovies';
    const main = document.getElementById('seriesMain'); if (!main) return;

    main.innerHTML = `
      <div class="page-header-wrap">
        <div class="page-header">
          <h1>Σειρές</h1>
          <span class="page-count">${sorted.length} σειρές</span>
        </div>
      </div>
      <div style="padding:0 4vw">
        <div class="section visible">
          <div class="series-grid" id="seriesListGrid">${items.map(renderCard).join('')}</div>
        </div>
        ${buildPaginationHTML(page, total)}
      </div>`;

    setupCards(main);
    new SearchController(all);
    initCardClicks();
  }

  /* DETAIL ──────────────────────────────────────────────── */
  async _detail(slug) {
    const entry = await this._dm.getOne(slug);
    if (!entry) { toast('Η σειρά δεν βρέθηκε.', 'error'); setTimeout(() => window.location.href = pageUrl('index.html'), 2000); return; }
    document.title = `${entry.title} — GreekMovies`;
    const main = document.getElementById('seriesMain'); if (!main) return;
    main.className = ''; main.removeAttribute('style');
    main.innerHTML = `
      <div class="series-hero"><div class="series-backdrop" id="seriesBackdrop"></div><div class="series-backdrop-overlay"></div></div>
      <section class="series-info-section">
        <div class="series-poster-wrap" id="seriesPoster"></div>
        <div class="series-details">
          <div class="series-channel-badge" id="seriesChannelBadge" style="display:none"></div>
          <h1 class="series-title" id="seriesTitle"></h1>
          <div class="series-meta-row" id="seriesMeta"></div>
          <div class="series-genres" id="seriesGenres"></div>
          <p class="series-overview" id="seriesOverview"></p>
          <div class="series-cta" id="seriesCta"></div>
          <div id="seriesRatingWrap" style="margin-top:1rem"></div>
        </div>
      </section>
      <section class="episodes-section"><h2>Επεισόδια</h2><div id="episodesContainer"></div></section>
      <section style="padding:0 4vw 4rem"><div id="seriesComments"></div></section>`;
    await this._renderDetail(entry);
    initCardClicks();
  }

  async _renderDetail(entry) {
    const { slug, title, channel, tmdb: t, data, _backdropFallback, _posterFallback } = entry;

    const bd = $('#seriesBackdrop');
    if (bd) { const img = t?.backdrop ?? t?.posterLg ?? _backdropFallback ?? data.backdrop ?? ''; if (img) bd.style.backgroundImage = `url('${img}')`; }

    const p = $('#seriesPoster');
    if (p) {
      const src = t?.posterLg ?? _posterFallback ?? data.poster ?? null;
      if (src) {
        const img = document.createElement('img');
        img.alt = title;
        img.addEventListener('error', () => { p.innerHTML = `<div class="no-poster">${ICONS.film}</div>`; }, { once: true });
        img.src = src;
        p.appendChild(img);
      } else { p.innerHTML = `<div class="no-poster">${ICONS.film}</div>`; }
    }

    const cb = $('#seriesChannelBadge');
    if (cb) { if (channel) { cb.textContent = channel; cb.style.display = ''; } else cb.style.display = 'none'; }

    const te = $('#seriesTitle'); if (te) te.textContent = title;

    const m = $('#seriesMeta');
    if (m) {
      const yr = t?.year ?? data.year, rt = t?.rating ?? data.rating, parts = [];
      if (yr) parts.push(`<span>${yr}</span>`);
      if (rt) parts.push(`<span class="rating-stars">${ICONS.star} ${rt}</span>`);
      if (t?.seasons) parts.push(`<span>${t.seasons} Σεζόν</span>`);
      m.innerHTML = parts.join('<span class="meta-sep">·</span>');
    }

    const ge = $('#seriesGenres');
    if (ge) { const g = t?.genres ?? data.genres ?? []; if (g.length) ge.innerHTML = g.map(x => `<span class="genre-tag">${esc(x)}</span>`).join(''); }

    const ov = $('#seriesOverview');
    if (ov) ov.textContent = entry.overview || data.overview || 'Δεν υπάρχει διαθέσιμη περιγραφή.';

    const cta = $('#seriesCta');
    if (cta) {
      cta.innerHTML = `
        <a href="${pageUrl('watch.html', { series: slug, season: 1, ep: 1 })}" class="btn-primary">${ICONS.play} Δείτε Τώρα</a>
        <a href="${pageUrl('series.html')}" class="btn-secondary">${ICONS.back} Σειρές</a>
        <button id="favBtn" class="btn-secondary user-action-btn" type="button">${ICONS.heart} <span id="favLabel">Αγαπημένα</span></button>
        <button id="watchlistBtn" class="btn-secondary user-action-btn" type="button">${ICONS.bookmark} <span id="watchlistLabel">Watchlist</span></button>
        <button id="seenBtn" class="btn-secondary user-action-btn" type="button">${ICONS.check} <span id="seenLabel">Έχω δει</span></button>`;
    }

    const syncBtns = () => {
      const lu = fb?.auth?.currentUser;
      const iF = Session.isFav(slug), iW = Session.isWatch(slug), iS = Session.isSeen(slug);
      const fl = $('#favLabel'), wl = $('#watchlistLabel'), sl = $('#seenLabel');
      if (fl) fl.textContent = lu ? (iF ? '❤️ Αφαίρεση' : 'Αγαπημένα') : 'Αγαπημένα';
      if (wl) wl.textContent = lu ? (iW ? '📌 Στη λίστα' : 'Watchlist') : 'Watchlist';
      if (sl) sl.textContent = lu ? (iS ? '✓ Το είδα' : 'Έχω δει') : 'Έχω δει';
      $('#favBtn')?.classList.toggle('active', !!iF && !!lu);
      $('#watchlistBtn')?.classList.toggle('active', !!iW && !!lu);
      $('#seenBtn')?.classList.toggle('active', !!iS && !!lu);
    };

    const rw = $('#seriesRatingWrap');
    const syncAll = () => { syncBtns(); if (rw) renderStarRating(rw, slug); };
    document.addEventListener('sessionChanged', syncAll);
    document.addEventListener('authStateChanged', syncAll);
    syncAll();

    const authOk = () => !!(fb?.auth?.currentUser);
    $('#favBtn')?.addEventListener('click', async () => { if (!authOk()) { toast('Συνδεθείτε.', 'info'); return; } try { const a = await Session.toggleFavorite(slug); toast(a ? '❤️ Προστέθηκε!' : 'Αφαιρέθηκε.', 'success'); } catch (e) { toast('Σφάλμα: ' + e.message, 'error'); } });
    $('#watchlistBtn')?.addEventListener('click', async () => { if (!authOk()) { toast('Συνδεθείτε.', 'info'); return; } try { const a = await Session.toggleWatchlist(slug); toast(a ? '📌 Προστέθηκε!' : 'Αφαιρέθηκε.', 'success'); } catch (e) { toast('Σφάλμα: ' + e.message, 'error'); } });
    $('#seenBtn')?.addEventListener('click', async () => { if (!authOk()) { toast('Συνδεθείτε.', 'info'); return; } try { const a = await Session.toggleSeen(slug); toast(a ? '✓ Σημειώθηκε!' : 'Αφαιρέθηκε.', 'success'); } catch (e) { toast('Σφάλμα: ' + e.message, 'error'); } });

    this._renderEpisodes(slug, data.episodes ?? []);
    const ce = $('#seriesComments');
    if (ce) { await renderComments(ce, slug); document.addEventListener('authStateChanged', () => renderComments(ce, slug)); }
  }

  _renderEpisodes(slug, episodes) {
    const c = $('#episodesContainer'); if (!c) return;
    if (!episodes.length) { c.innerHTML = '<p style="color:var(--text-3)">Δεν βρέθηκαν επεισόδια.</p>'; return; }
    const bs = {};
    episodes.forEach(ep => (bs[ep.season] = bs[ep.season] || []).push(ep));
    const seasons = Object.keys(bs).map(Number).sort((a, b) => a - b);
    let active = seasons[0];

    const tabs = () => seasons.map(s => `<button class="season-tab${s === active ? ' active' : ''}" data-season="${s}" type="button">Σεζόν ${s}</button>`).join('');
    const grid = s => bs[s].map(ep => {
      const pn = Object.keys(ep.players ?? {});
      return `<a href="${pageUrl('watch.html', { series: slug, season: ep.season, ep: ep.ep })}" class="episode-card">
        <div class="episode-num">${String(ep.ep).padStart(2, '0')}</div>
        <div class="episode-info">
          <div class="episode-label">Επεισόδιο ${ep.ep}</div>
          <div class="episode-players">${pn.length} server${pn.length !== 1 ? 's' : ''}: ${pn.join(', ')}</div>
        </div>
        <div class="episode-play-icon">${ICONS.play}</div>
      </a>`;
    }).join('');

    const update = () => {
      c.innerHTML = `<div class="season-tabs">${tabs()}</div><div class="episodes-grid">${grid(active)}</div>`;
      $$('.season-tab', c).forEach(b => b.addEventListener('click', () => { active = +b.dataset.season; update(); }));
    };
    update();
  }
}

/* ══════════════════════════════════════════════════════════
   WATCH CONTROLLER
   ══════════════════════════════════════════════════════════ */
class WatchController {
  constructor() { this._dm = new DataManager(); this._slug = null; this._season = 1; this._ep = 1; this._entry = null; this._players = {}; this._active = null; }

  async init() {
    initNavScroll(); new AuthController().init();
    const p = new URLSearchParams(location.search);
    this._slug = p.get('series'); this._season = +(p.get('season') ?? 1); this._ep = +(p.get('ep') ?? 1);
    if (!this._slug) { window.location.href = pageUrl('index.html'); return; }
    this._entry = await this._dm.getOne(this._slug);
    if (!this._entry) { toast('Η σειρά δεν βρέθηκε.', 'error'); return; }
    document.title = `${this._entry.title} S${this._season}E${this._ep} — GreekMovies`;
    this._findEp(); this._renderMeta(); this._renderPlayer(); this._renderControls(); this._renderAllEps();
  }

  _findEp() {
    const ep = (this._entry.data.episodes ?? []).find(e => e.season === this._season && e.ep === this._ep);
    this._players = ep?.players ?? {}; this._active = Object.keys(this._players)[0] ?? null;
  }

  _renderMeta() {
    const t = $('#watchTitle'); if (t) t.textContent = this._entry.title;
    const b = $('#watchEpBadge'); if (b) b.textContent = `S${this._season} E${this._ep}`;
    const bl = $('#watchSeriesLink');
    if (bl) { bl.href = pageUrl('series.html', { id: this._slug }); bl.style.display = ''; bl.textContent = ''; bl.appendChild(document.createTextNode('Όλα τα Επεισόδια')); }
  }

  _renderPlayer() {
    const w = $('#playerWrapper'); if (!w) return;
    if (!this._active || !this._players[this._active]) {
      w.innerHTML = `<div class="player-loading"><div style="font-size:2.5rem;margin-bottom:.5rem">🎬</div><p>Δεν υπάρχει διαθέσιμος player.</p></div>`; return;
    }
    w.innerHTML = `<div class="player-loading" id="playerLoading"><div class="spinner"></div><span>Φόρτωση…</span></div>
      <iframe class="player-iframe" id="playerIframe" src="${esc(this._players[this._active])}"
        allowfullscreen allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-top-navigation"></iframe>`;
    $('#playerIframe')?.addEventListener('load', () => $('#playerLoading')?.remove());
  }

  _renderControls() {
    const b = $('#playerBtns');
    if (b) {
      b.innerHTML = Object.keys(this._players).map(n => `<button class="player-btn${n === this._active ? ' active' : ''}" data-player="${esc(n)}" type="button">${esc(n)}</button>`).join('');
      b.addEventListener('click', e => {
        const btn = e.target.closest('.player-btn'); if (!btn) return;
        $$('.player-btn', b).forEach(x => x.classList.remove('active')); btn.classList.add('active');
        this._active = btn.dataset.player; this._renderPlayer();
      });
    }
    const s = $('#episodeSelect');
    if (s) {
      const bs = {}; (this._entry.data.episodes ?? []).forEach(e => (bs[e.season] = bs[e.season] || []).push(e));
      s.innerHTML = Object.keys(bs).sort((a, b) => a - b).map(se =>
        `<optgroup label="Σεζόν ${se}">${bs[se].map(e => `<option value="${e.season}|${e.ep}" ${e.season === this._season && e.ep === this._ep ? 'selected' : ''}>S${e.season} E${e.ep}</option>`).join('')}</optgroup>`
      ).join('');
      s.addEventListener('change', () => { const [se, ep] = s.value.split('|').map(Number); window.location.href = pageUrl('watch.html', { series: this._slug, season: se, ep }); });
    }
    const eps    = this._entry.data.episodes ?? [];
    const sorted = [...eps].sort((a, b) => a.season !== b.season ? a.season - b.season : a.ep - b.ep);
    const i      = sorted.findIndex(e => e.season === this._season && e.ep === this._ep);
    const prev   = $('#prevEpBtn'), next = $('#nextEpBtn');
    if (prev) { prev.disabled = i <= 0; prev.addEventListener('click', () => { if (i > 0) { const pp = sorted[i - 1]; window.location.href = pageUrl('watch.html', { series: this._slug, season: pp.season, ep: pp.ep }); } }); }
    if (next) { next.disabled = i >= sorted.length - 1; next.addEventListener('click', () => { if (i < sorted.length - 1) { const nn = sorted[i + 1]; window.location.href = pageUrl('watch.html', { series: this._slug, season: nn.season, ep: nn.ep }); } }); }
  }

  _renderAllEps() {
    const c = $('#allEpisodesPanel'); if (!c) return;
    const bs = {}; (this._entry.data.episodes ?? []).forEach(e => (bs[e.season] = bs[e.season] || []).push(e));
    const cs = bs[this._season] ?? [];
    c.innerHTML = `<h3>Σεζόν ${this._season} — Επεισόδια</h3><div class="episodes-grid">${cs.map(ep => {
      const url = pageUrl('watch.html', { series: this._slug, season: ep.season, ep: ep.ep });
      const cur = ep.season === this._season && ep.ep === this._ep;
      return `<a href="${url}" class="episode-card${cur ? ' episode-card-active' : ''}">
        <div class="episode-num">${String(ep.ep).padStart(2, '0')}</div>
        <div class="episode-info">
          <div class="episode-label">Επεισόδιο ${ep.ep}${cur ? ' <span class="ep-now-playing">(Παίζει)</span>' : ''}</div>
          <div class="episode-players">${Object.keys(ep.players ?? {}).join(', ')}</div>
        </div>
        <div class="episode-play-icon">${ICONS.play}</div>
      </a>`;
    }).join('')}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   MOVIES CONTROLLER  — type=movie only, paginated
   ══════════════════════════════════════════════════════════ */
class MoviesController {
  constructor() { this._dm = new DataManager(); this._movies = []; this._cat = 'all'; }

  async init() {
    initNavScroll(); new AuthController().init();
    const all = await this._dm.loadAll();
    this._movies = all
      .filter(e => e.data.type === 'movie')
      .sort((a, b) => (b.data.last_updated || 0) - (a.data.last_updated || 0));
    this._render(); initCardClicks();
    new SearchController(all);
  }

  _render() {
    const results = $('#moviesResults'); if (!results) return;

    const filtered = this._cat === 'all'
      ? this._movies
      : this._movies.filter(e => e.data.category === this._cat);

    const ce = $('#moviesCount');
    if (ce) ce.textContent = `${filtered.length} ταινίες`;

    const catBar = `<div class="genres-bar" id="moviesCatFilter" style="margin-bottom:2rem">
      <button class="genre-chip${this._cat === 'all'     ? ' active' : ''}" data-cat="all"     type="button">Όλες</button>
      <button class="genre-chip${this._cat === 'greek'   ? ' active' : ''}" data-cat="greek"   type="button">Ελληνικές</button>
      <button class="genre-chip${this._cat === 'foreign' ? ' active' : ''}" data-cat="foreign" type="button">Ξένες</button>
    </div>`;

    if (!filtered.length) {
      results.innerHTML = catBar + `<div style="text-align:center;padding:4rem 2rem;color:var(--text-3)"><div style="font-size:3rem;margin-bottom:1rem">🎬</div><p>Δεν υπάρχουν ταινίες σε αυτή την κατηγορία.</p></div>`;
    } else {
      const genreMap = new Map();
      for (const movie of filtered) {
        const genres = movie.data.genres ?? [];
        const keys = genres.length ? genres : ['Άλλες'];
        for (const g of keys) {
          if (!genreMap.has(g)) genreMap.set(g, []);
          genreMap.get(g).push(movie);
        }
      }
      const sections = [...genreMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'el'))
        .map(([genre, movies]) => `
          <div style="margin-bottom:2.5rem">
            <div class="home-section-header" style="padding:0 4vw">
              <h2 class="home-section-title">${esc(genre)}</h2>
              <span class="home-section-count">${movies.length} ταινί${movies.length === 1 ? 'α' : 'ες'}</span>
            </div>
            <div class="series-grid home-grid" style="padding:0 4vw">${movies.map(renderCard).join('')}</div>
          </div>`).join('');
      results.innerHTML = catBar + sections;
      setupCards(results);
    }

    $('#moviesCatFilter')?.addEventListener('click', e => {
      const b = e.target.closest('.genre-chip'); if (!b || !b.dataset.cat) return;
      this._cat = b.dataset.cat;
      this._render();
    });
  }
}

/* ══════════════════════════════════════════════════════════
   NETWORKS CONTROLLER
   ══════════════════════════════════════════════════════════ */
class NetworksController {
  constructor() { this._dm = new DataManager(); this._all = []; this._byNet = new Map(); }

  async init() {
    initNavScroll(); new AuthController().init();
    this._all = await this._dm.loadAll();
    this._buildMap(); this._renderList(); initCardClicks();
    const qp = new URLSearchParams(location.search).get('network');
    if (qp) this._select(qp);
  }

  _buildMap() {
    this._byNet = new Map();
    for (const entry of this._all) {
      let nets = [];
      if (entry.tmdb?.networks?.length) {
        nets = entry.tmdb.networks;
      } else if (Array.isArray(entry.data?.networks) && entry.data.networks.length) {
        nets = entry.data.networks.map(n => ({ id: `json:${n.name}`, name: n.name, logo: n.logo || null }));
      } else if (entry.channel) {
        nets = [{ id: `ch:${entry.channel}`, name: entry.channel, logo: null }];
      }
      if (!nets.length) continue;
      for (const n of nets) {
        const key = String(n.id);
        if (!this._byNet.has(key)) this._byNet.set(key, { id: n.id, name: n.name, logo: n.logo, entries: [] });
        this._byNet.get(key).entries.push(entry);
      }
    }
  }

  _renderList() {
    const list = $('#networkList'); if (!list) return;
    const networks = [...this._byNet.values()].sort((a, b) => b.entries.length - a.entries.length);
    list.innerHTML = networks.map(n => `
      <button class="network-card" data-id="${esc(String(n.id))}" type="button">
        ${n.logo ? `<img class="network-logo" data-src="${esc(n.logo)}" alt="${esc(n.name)}" loading="lazy">` : `<div class="network-logo-placeholder">${ICONS.broadcast}</div>`}
        <div class="network-name">${esc(n.name)}</div>
        <div class="network-count">${n.entries.length} σειρ${n.entries.length === 1 ? 'ά' : 'ές'}</div>
      </button>`).join('');

    /* Lazy-load network logos with safe error handler */
    list.querySelectorAll('img[data-src]').forEach(img => {
      img.addEventListener('error', () => {
        const ph = document.createElement('div');
        ph.className = 'network-logo-placeholder';
        ph.innerHTML = ICONS.broadcast;
        img.replaceWith(ph);
      }, { once: true });
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    });

    list.addEventListener('click', e => { const b = e.target.closest('.network-card'); if (b) this._select(b.dataset.id); });
  }

  _select(id) {
    const net = this._byNet.get(String(id)); if (!net) return;
    const results = $('#networkResults'), list = $('#networkList');
    if (!results || !list) return;
    list.style.display = 'none'; results.style.display = '';

    results.innerHTML = `
      <div class="network-detail-header">
        <button class="btn-secondary network-back-btn" id="networkBackBtn" type="button">${ICONS.back} Πίσω στα Networks</button>
        <h2 class="network-detail-title">
          ${net.logo ? `<img class="network-detail-logo" data-src="${esc(net.logo)}" alt="${esc(net.name)}">` : ''}
          ${esc(net.name)}
        </h2>
        <span class="network-detail-count">${net.entries.length} σειρ${net.entries.length === 1 ? 'ά' : 'ές'}</span>
      </div>
      <div class="series-grid">${net.entries.map(renderCard).join('')}</div>`;

    const dlLogo = results.querySelector('img[data-src]');
    if (dlLogo) {
      dlLogo.addEventListener('error', () => dlLogo.remove(), { once: true });
      dlLogo.src = dlLogo.dataset.src;
      dlLogo.removeAttribute('data-src');
    }
    setupCards(results);

    $('#networkBackBtn')?.addEventListener('click', () => { results.style.display = 'none'; list.style.display = ''; history.replaceState(null, '', './networks.html'); });
    history.replaceState(null, '', `./networks.html?network=${encodeURIComponent(id)}`);
  }
}

/* ══════════════════════════════════════════════════════════
   GENRES CONTROLLER
   ══════════════════════════════════════════════════════════ */
class GenresController {
  constructor() { this._dm = new DataManager(); this._all = []; this._active = 'all'; }

  async init() {
    initNavScroll(); new AuthController().init();
    this._all = await this._dm.loadAll();
    this._renderBar(); this._applyFilter(); initCardClicks();
    const qp = new URLSearchParams(location.search).get('genre');
    if (qp) { const b = $(`.genre-chip[data-genre="${CSS.escape(qp)}"]`); if (b) b.click(); }
  }

  _renderBar() {
    const bar = $('#genresBar'); if (!bar) return;
    bar.innerHTML = ['all', ...GREEK_GENRES].map(g =>
      `<button class="genre-chip${g === this._active ? ' active' : ''}" data-genre="${esc(g)}" type="button">${esc(g === 'all' ? 'Όλα' : g)}</button>`
    ).join('');
    bar.addEventListener('click', e => {
      const b = e.target.closest('.genre-chip'); if (!b) return;
      $$('.genre-chip', bar).forEach(x => x.classList.remove('active')); b.classList.add('active');
      this._active = b.dataset.genre; this._applyFilter();
    });
  }

  _applyFilter() {
    const results = $('#genresResults'); if (!results) return;
    const filtered = this._active === 'all' ? this._all : this._all.filter(e => classifyEntry(e).includes(this._active));
    const ce = $('#genresCount'); if (ce) ce.textContent = `${filtered.length} σειρ${filtered.length === 1 ? 'ά' : 'ές'}`;
    if (filtered.length) {
      results.innerHTML = `<div class="series-grid">${filtered.map(renderCard).join('')}</div>`;
      setupCards(results);
    } else {
      results.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">🎬</div><p>Δεν βρέθηκαν σειρές για "${esc(this._active)}".</p></div>`;
    }
  }
}

/* ══════════════════════════════════════════════════════════
   PROFILE CONTROLLER
   ══════════════════════════════════════════════════════════ */
class ProfileController {
  constructor() { this._dm = new DataManager(); this._bound = false; }

  async init() {
    initNavScroll(); new AuthController().init();
    this._initTabs(); this._initEdit();
    if (!this._bound) {
      this._bound = true;
      document.addEventListener('authStateChanged', e => { if (!e.detail?.user) { this._renderLoggedOut(); return; } this._showUI(); this._render(); });
      document.addEventListener('sessionChanged', () => { if (!Session.user) return; if (Session.loaded) { this._showUI(); this._render(); return; } if (Session.loadError) { this._showUI(); this._renderError(); } });
    }
    const cu = fb.auth?.currentUser;
    if (cu) { this._showUI(); this._render(); if (!Session.loaded || Session.user?.uid !== cu.uid) Session.hydrate(cu).catch(() => {}); }
  }

  _renderLoggedOut() {
    const hero = $('#profileHero'), tabs = document.querySelector('.profile-tabs'), stats = $('#profileStats');
    document.querySelector('.profile-load-error')?.remove();
    if (hero) hero.style.display = 'none'; if (tabs) tabs.style.display = 'none'; if (stats) stats.style.display = 'none';
    $$('.profile-panel').forEach(p => p.style.display = 'none');
    const main = $('#profileMain'); if (!main || main.querySelector('.profile-login-prompt')) return;
    const div = document.createElement('div'); div.className = 'profile-login-prompt';
    div.innerHTML = `<div style="font-size:3rem;margin-bottom:1rem">🔐</div><h2>Καλωσήρθατε!</h2><p>Συνδεθείτε για να δείτε το προφίλ σας.</p><button class="btn-primary" id="profileLoginBtn" type="button" style="margin:0 auto">Σύνδεση / Εγγραφή</button>`;
    main.prepend(div);
    main.querySelector('#profileLoginBtn')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('openAuthModal')));
  }

  _showUI() {
    document.querySelector('.profile-login-prompt')?.remove(); document.querySelector('.profile-load-error')?.remove();
    const hero = $('#profileHero'), tabs = document.querySelector('.profile-tabs'), stats = $('#profileStats');
    if (hero) hero.style.display = ''; if (tabs) tabs.style.display = ''; if (stats) stats.style.display = '';
    $$('.profile-panel').forEach(p => p.style.display = '');
  }

  _renderError() {
    const main = $('#profileMain'); if (!main) return;
    document.querySelector('.profile-load-error')?.remove();
    const div = document.createElement('div'); div.className = 'profile-load-error';
    div.innerHTML = `<h2>Σφάλμα φόρτωσης.</h2><p>Δοκιμάστε ξανά.</p><button class="btn-primary" id="profileRetryBtn" type="button">Επανάληψη</button>`;
    main.prepend(div);
    main.querySelector('#profileRetryBtn')?.addEventListener('click', () => { const lu = fb?.auth?.currentUser ?? Session.user; if (!lu) return; div.remove(); Session.hydrate(lu).catch(() => {}); });
  }

  async _render() {
    const lu = fb?.auth?.currentUser ?? Session.user; if (!lu) return;
    const p = Session.profile ?? { uid: lu.uid, username: lu.displayName || lu.email?.split('@')[0] || 'Χρήστης', email: lu.email, avatar: lu.photoURL || null };
    document.title = `${p.username} — Προφίλ`;
    const avEl = $('#profileAvatar'), imgEl = $('#profileAvatarImg'), nmEl = $('#profileUsername'), emEl = $('#profileEmail');
    const init = (p.username?.[0] ?? lu.email?.[0] ?? '?').toUpperCase();
    if (avEl) { avEl.textContent = init; avEl.style.display = ''; }
    if (imgEl) {
      const url = p.avatar || lu.photoURL || null;
      if (url) {
        imgEl.src = url; imgEl.hidden = false;
        if (avEl) avEl.style.display = 'none';
        imgEl.addEventListener('error', () => { imgEl.hidden = true; if (avEl) avEl.style.display = ''; }, { once: true });
      } else imgEl.hidden = true;
    }
    if (nmEl) nmEl.textContent = p.username || 'Χρήστης';
    if (emEl) emEl.textContent = lu.email || '';
    const st = $('#profileStats');
    if (st) {
      const fc = Session.favorites.size, wc = Session.watchlist.size, sc = Session.seen.size, rc = Object.keys(Session.ratings).length;
      st.innerHTML = `<div class="profile-stat"><span class="profile-stat-num">${fc}</span><span class="profile-stat-label">Αγαπημένα</span></div><div class="profile-stat"><span class="profile-stat-num">${wc}</span><span class="profile-stat-label">Watchlist</span></div><div class="profile-stat"><span class="profile-stat-num">${sc}</span><span class="profile-stat-label">Έχω δει</span></div><div class="profile-stat"><span class="profile-stat-num">${rc}</span><span class="profile-stat-label">Αξιολογήσεις</span></div>`;
    }
    const locals = await this._dm.loadLocalFast();
    const by = Object.fromEntries(locals.map(e => [e.slug, e]));
    this._list('#favoritesGrid', '#favCount', [...Session.favorites], by, '❤️', 'Δεν υπάρχουν αγαπημένα ακόμα.');
    this._list('#watchlistGrid', '#watchlistCount', [...Session.watchlist], by, '📌', 'Η watchlist σας είναι άδεια.');
    this._list('#seenGrid', '#seenCount', [...Session.seen], by, '✓', 'Δεν έχετε σημειώσει καμία σειρά.');
    this._renderRatings('#ratingsGrid', '#ratingsCount', Session.ratings, by);
    this._renderCommentsTab('#commentsGrid', '#commentsCount', lu.uid);
  }

  _initTabs() {
    const tabs = $$('.profile-tab'), panels = $$('.profile-panel');
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active')); panels.forEach(x => x.classList.remove('active'));
      t.classList.add('active'); $(`#panel-${t.dataset.panel}`)?.classList.add('active');
      history.replaceState(null, '', `#${t.dataset.panel}`);
    }));
    const h = location.hash.replace('#', ''); if (h) { const t = $(`[data-panel="${h}"]`); if (t) t.click(); }
  }

  _initEdit() {
    const btn = $('#profileEditBtn'); if (!btn) return;
    btn.addEventListener('click', () => {
      const lu = fb?.auth?.currentUser ?? Session.user; if (!lu) { toast('Συνδεθείτε.', 'info'); return; }
      const pd = Session.profile ?? { uid: lu.uid, username: lu.displayName || 'Χρήστης', email: lu.email, avatar: null };
      const o = document.createElement('div'); o.className = 'auth-overlay';
      o.innerHTML = `<div class="auth-modal"><button class="auth-modal-close" id="editClose" type="button">✕</button><h3 class="auth-forgot-title">Επεξεργασία Προφίλ</h3><input id="editUsername" type="text" class="auth-input" maxlength="40" value="${esc(pd.username ?? '')}"><input id="editAvatar" type="url" class="auth-input" placeholder="Avatar URL" value="${esc(pd.avatar ?? '')}"><p id="editError" class="auth-error" style="display:none"></p><button id="editSave" class="auth-submit-btn" type="button">Αποθήκευση</button></div>`;
      document.body.appendChild(o);
      o.addEventListener('click', e => { if (e.target === o) o.remove(); });
      o.querySelector('#editClose').addEventListener('click', () => o.remove());
      o.querySelector('#editSave').addEventListener('click', async () => {
        const u = o.querySelector('#editUsername').value.trim();
        const a = o.querySelector('#editAvatar').value.trim();
        const er = o.querySelector('#editError');
        if (!u || u.length < 2 || u.length > 40) { er.textContent = '2–40 χαρακτήρες.'; er.style.display = 'block'; return; }
        try { await fb.updateUserProfile(lu.uid, { username: u, avatar: a || null }); if (Session.profile) { Session.profile.username = u; Session.profile.avatar = a || null; } toast('Ενημερώθηκε!', 'success'); o.remove(); setTimeout(() => location.reload(), 400); }
        catch (e) { er.textContent = 'Σφάλμα: ' + e.message; er.style.display = 'block'; }
      });
    });
  }

  _list(gs, cs, slugs, by, icon, emptyMsg) {
    const ce = $(cs); if (ce) ce.textContent = slugs.length;
    const el = $(gs); if (!el) return;
    if (!slugs.length) { el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">${icon}</div><p>${esc(emptyMsg)}</p></div>`; return; }
    const entries = slugs.map(s => by[s]).filter(Boolean);
    if (!entries.length) { el.innerHTML = `<p style="color:var(--text-3);font-size:.9rem">Φόρτωση…</p>`; return; }
    el.innerHTML = `<div class="series-grid">${entries.map(renderCard).join('')}</div>`;
    setupCards(el);
    el.querySelectorAll('.series-card[data-slug]').forEach(card => card.addEventListener('click', e => { if (e.target.closest('a')) return; window.location.href = pageUrl('series.html', { id: card.dataset.slug }); }));
  }

  _renderRatings(gs, cs, ratings, by) {
    const ce = $(cs), slugs = Object.keys(ratings); if (ce) ce.textContent = slugs.length;
    const el = $(gs); if (!el) return;
    if (!slugs.length) { el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">⭐</div><p>Δεν έχετε αξιολογήσει ακόμα.</p></div>`; return; }
    const items = slugs.map(slug => {
      const e = by[slug], stars = ratings[slug]; if (!e) return '';
      const poster = e.tmdb?.poster ?? e._posterFallback ?? null;
      return `<a href="${pageUrl('series.html', { id: slug })}" class="rating-item">${poster ? `<img src="${esc(poster)}" alt="${esc(e.title)}" class="rating-poster">` : `<div class="rating-poster-placeholder">${ICONS.film}</div>`}<div class="rating-info"><div class="rating-title">${esc(e.title)}</div><div class="rating-stars-display">${[1, 2, 3, 4, 5].map(n => `<span class="rating-star${n <= stars ? ' filled' : ''}">${ICONS.star}</span>`).join('')}<span class="rating-num">${stars}/5</span></div></div></a>`;
    }).filter(Boolean);
    el.innerHTML = items.length ? `<div class="ratings-list">${items.join('')}</div>` : '';
  }

  async _renderCommentsTab(gs, cs, uid) {
    const el = $(gs); if (!el) return;
    el.innerHTML = `<p style="color:var(--text-3);font-size:.85rem;padding:1rem 0">Φόρτωση…</p>`;
    try {
      const c = await fb.getUserComments(uid);
      const ce = $(cs); if (ce) ce.textContent = c.length;
      if (!c.length) { el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">💬</div><p>Δεν έχετε γράψει σχόλια ακόμα.</p></div>`; return; }
      el.innerHTML = c.map(x => `<div class="comment-item"><div class="comment-header"><a href="${pageUrl('series.html', { id: x.seriesSlug })}" class="comment-series-link">${esc(x.seriesSlug)}</a><span class="comment-date">${x.createdAt?.toDate?.()?.toLocaleDateString('el-GR') ?? ''}</span></div><p class="comment-text">${esc(x.text ?? '')}</p></div>`).join('');
    } catch (_) { el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">💬</div><p>Δεν βρέθηκαν σχόλια.</p></div>`; }
  }
}

/* ══════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════ */
async function router() {
  fb = await loadFirebase();
  initAuthManager(fb, Session);
  const page = document.body.dataset.page;
  try {
    switch (page) {
      case 'home':     await new HomepageController().init();  break;
      case 'series':   await new SeriesController().init();    break;
      case 'watch':    await new WatchController().init();     break;
      case 'profile':  await new ProfileController().init();   break;
      case 'genres':   await new GenresController().init();    break;
      case 'networks': await new NetworksController().init();  break;
      case 'movies':   await new MoviesController().init();    break;
      case 'rules':    initNavScroll(); new AuthController().init(); break;
      default: console.warn('[Router] Unknown page:', page);
    }
  } catch (err) {
    console.error('[Router]', err);
    const m = document.querySelector('main, #mainContent, #seriesMain, .main-content');
    if (m && !m.children.length) m.innerHTML = `<div style="text-align:center;padding:4rem 2rem;color:var(--text-3)"><p>⚠️ Σφάλμα φόρτωσης.</p><button onclick="location.reload()" style="margin-top:1rem;padding:.6rem 1.5rem;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer">Ανανέωση</button></div>`;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', router, { once: true });
else router();
