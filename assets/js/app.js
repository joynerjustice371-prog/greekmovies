/* ============================================================
   app.js — StreamVault Main Application  v4.0
   ─────────────────────────────────────────────────────────────
   ARCHITECTURE:
   ① fb.authReady — Promise resolved once on first auth emission.
     All controllers await this before touching Firestore.
   ② Session — in-memory cache of user's subcollections, loaded
     ONCE per session on auth-ready. All reads (isFavorite etc.)
     hit the cache (instant). All writes update cache optimistically,
     sync to Firestore, revert on error.
   ③ Profile page = zero Firestore reads on nav → <1s load.
   ④ Genre system — TMDB English genres mapped to Greek categories.
   ⑤ Network system — extracted from TMDB networks + production
     companies, displayed with logos.
   ============================================================ */

import { tmdb } from './tmdb.js';
import { initAuthManager, getCurrentUser } from './authManager.js';

/* ═══════════════════════════════════════════════════════════
   FIREBASE — dynamic import with fallback stubs
   ═══════════════════════════════════════════════════════════ */
let fb = null;

function _createFirebaseStubs() {
  const _notAvail = () => Promise.reject(new Error('Firebase non διαθέσιμο.'));
  return {
    auth: null, db: null,
    authReady: Promise.resolve(null),
    onAuth: (cb) => { cb(null); return () => {}; },
    loginWithGoogle: _notAvail, loginWithEmail: _notAvail,
    registerWithEmail: _notAvail, forgotPassword: _notAvail, logout: _notAvail,
    ensureUserDoc: async () => null,
    getUserProfile: async () => null,
    updateUserProfile: _notAvail,
    getUserFavorites: async () => [], isFavorite: async () => false, toggleFavorite: _notAvail,
    getUserWatchlist: async () => [], isInWatchlist: async () => false, toggleWatchlist: _notAvail,
    getUserSeen: async () => [], isInSeen: async () => false, toggleSeen: _notAvail,
    setRating: _notAvail, getRating: async () => 0,
    getAllRatings: async () => ({}),
    getAverageRating: async () => ({ avg: 0, count: 0 }),
    onSeriesRatingsSnapshot: () => () => {},
    postComment: _notAvail, getComments: async () => [], getUserComments: async () => [],
    likeComment: _notAvail, dislikeComment: _notAvail,
  };
}

async function loadFirebase() {
  try {
    return await Promise.race([
      import('./firebase.js'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase timeout')), 8000)),
    ]);
  } catch (err) {
    console.warn('[App] Firebase unavailable:', err.message);
    return _createFirebaseStubs();
  }
}

/* ── Utils ─────────────────────────────────────────────── */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const groupBy = (arr, key) => arr.reduce((acc, it) => { const k = it[key] ?? 'Άλλα'; (acc[k] = acc[k] || []).push(it); return acc; }, {});
const pageUrl = (page, params = {}) => { const u = new URL(page, window.location.href); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v)); return u.href; };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function toast(msg, type = 'info') {
  let c = $('#toast-container');
  if (!c) { c = Object.assign(document.createElement('div'), { id: 'toast-container', className: 'toast-container' }); document.body.appendChild(c); }
  const el = Object.assign(document.createElement('div'), { className: `toast toast-${type}`, textContent: msg });
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => { el.classList.remove('toast-show'); setTimeout(() => el.remove(), 400); }, 3600);
}

const BASE_URL = (() => { try { return new URL('../../', import.meta.url).href; } catch { return '/'; } })();

/* ── SVG Icons ──────────────────────────────────────────── */
const ICONS = {
  play:     `<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`,
  info:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  search:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  star:     `<svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/></svg>`,
  film:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/></svg>`,
  chevL:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevR:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`,
  back:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
  heart:    `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  check:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
  user:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  thumbUp:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`,
  thumbDown:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`,
  broadcast:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>`,
};

/* ══════════════════════════════════════════════════════════
   SESSION — in-memory user-data cache
   Hydrated ONCE on authReady → all reads become instant.
   ══════════════════════════════════════════════════════════ */
const Session = {
  user:      null,
  profile:   null,
  favorites: new Set(),
  watchlist: new Set(),
  seen:      new Set(),
  ratings:   {},
  loaded:    false,
  _loadingPromise: null,

  async hydrate(user) {
    if (!user) { this.clear(); return; }
    if (this.loaded && this.user?.uid === user.uid) return;
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = (async () => {
      try {
        await fb.ensureUserDoc(user);
        const [profile, favs, watch, seen, ratings] = await Promise.all([
          fb.getUserProfile(user.uid),
          fb.getUserFavorites(user.uid),
          fb.getUserWatchlist(user.uid),
          fb.getUserSeen(user.uid),
          fb.getAllRatings(user.uid),
        ]);
        this.user      = user;
        this.profile   = profile ?? {
          uid: user.uid,
          username: user.displayName || user.email?.split('@')[0] || 'Χρήστης',
          email: user.email, avatar: user.photoURL || null,
        };
        this.favorites = new Set(favs);
        this.watchlist = new Set(watch);
        this.seen      = new Set(seen);
        this.ratings   = ratings ?? {};
        this.loaded    = true;
        console.log('[Session] Hydrated.', {
          favs: favs.length, watch: watch.length, seen: seen.length, ratings: Object.keys(ratings).length
        });
      } finally {
        this._loadingPromise = null;
      }
    })();
    return this._loadingPromise;
  },

  clear() {
    this.user = null;
    this.profile = null;
    this.favorites.clear();
    this.watchlist.clear();
    this.seen.clear();
    this.ratings = {};
    this.loaded = false;
    this._loadingPromise = null;
  },

  /* Instant lookups from cache */
  isFav(slug)   { return this.favorites.has(slug); },
  isWatch(slug) { return this.watchlist.has(slug); },
  isSeen(slug)  { return this.seen.has(slug); },
  getRating(slug) { return this.ratings[slug] ?? 0; },

  /* Optimistic mutations — use LIVE auth (fb.auth.currentUser), not cached.
     This ensures buttons work the instant the user is signed in, even before
     Session.hydrate() completes. If hydrated, we also do optimistic UI; if
     not, we just call Firestore and sync the cache after. */
  _liveUid() {
    return this.user?.uid ?? fb?.auth?.currentUser?.uid ?? null;
  },

  async toggleFavorite(slug) {
    const uid = this._liveUid();
    if (!uid) throw new Error('Not signed in');
    const was = this.favorites.has(slug);
    if (this.loaded) {
      if (was) this.favorites.delete(slug); else this.favorites.add(slug);
      this._emitChange();
    }
    try {
      const result = await fb.toggleFavorite(uid, slug);
      /* Sync cache from actual result (esp. important if not hydrated) */
      if (result) this.favorites.add(slug); else this.favorites.delete(slug);
      if (!this.loaded) this._emitChange();
      return result;
    } catch (e) {
      if (this.loaded) {
        if (was) this.favorites.add(slug); else this.favorites.delete(slug);
        this._emitChange();
      }
      throw e;
    }
  },

  async toggleWatchlist(slug) {
    const uid = this._liveUid();
    if (!uid) throw new Error('Not signed in');
    const was = this.watchlist.has(slug);
    if (this.loaded) {
      if (was) this.watchlist.delete(slug); else this.watchlist.add(slug);
      this._emitChange();
    }
    try {
      const result = await fb.toggleWatchlist(uid, slug);
      if (result) this.watchlist.add(slug); else this.watchlist.delete(slug);
      if (!this.loaded) this._emitChange();
      return result;
    } catch (e) {
      if (this.loaded) {
        if (was) this.watchlist.add(slug); else this.watchlist.delete(slug);
        this._emitChange();
      }
      throw e;
    }
  },

  async toggleSeen(slug) {
    const uid = this._liveUid();
    if (!uid) throw new Error('Not signed in');
    const was = this.seen.has(slug);
    if (this.loaded) {
      if (was) this.seen.delete(slug); else this.seen.add(slug);
      this._emitChange();
    }
    try {
      const result = await fb.toggleSeen(uid, slug);
      if (result) this.seen.add(slug); else this.seen.delete(slug);
      if (!this.loaded) this._emitChange();
      return result;
    } catch (e) {
      if (this.loaded) {
        if (was) this.seen.add(slug); else this.seen.delete(slug);
        this._emitChange();
      }
      throw e;
    }
  },

  async setRating(slug, stars) {
    const uid = this._liveUid();
    if (!uid) throw new Error('Not signed in');
    const prev = this.ratings[slug] ?? 0;
    this.ratings[slug] = stars;
    this._emitChange();
    try {
      await fb.setRating(uid, slug, stars);
      return stars;
    } catch (e) {
      if (prev) this.ratings[slug] = prev; else delete this.ratings[slug];
      this._emitChange();
      throw e;
    }
  },

  _emitChange() {
    document.dispatchEvent(new CustomEvent('sessionChanged', { detail: { session: this } }));
  },
};

/* ══════════════════════════════════════════════════════════
   AUTH CONTROLLER
   Reads Session.profile once hydrated (no extra Firestore read).
   ══════════════════════════════════════════════════════════ */
class AuthController {
  static _instance = null;
  static _authUnsub = null;

  constructor() {
    this._modal = null; this._tab = 'login';
    this.$wrap = null; this.$loginBtn = null; this.$userMenu = null;
    this.$initials = null; this.$avatarImg = null; this.$username = null;
    this.$dropdown = null; this.$avatarBtn = null;
  }

  init() {
    if (AuthController._instance) return AuthController._instance;
    AuthController._instance = this;
    this._injectNavUI();

    if (typeof AuthController._authUnsub === 'function') {
      try { AuthController._authUnsub(); } catch (_) {}
    }

    AuthController._authUnsub = fb.onAuth((user) => {
      /* NON-BLOCKING: this callback itself is synchronous-looking — all
         async work happens in background without blocking the auth event. */
      if (user) {
        if (this._modal) {
          try { this._modal.remove(); } catch (_) {}
          this._modal = null;
        }
        /* Phase 1: immediate paint from Firebase user */
        const quickName = user.displayName || user.email?.split('@')[0] || '?';
        this._setLoggedIn(quickName, user.photoURL ?? null);

        /* Dispatch FIRST event immediately so pages can react to login
           right away, even before Session is hydrated. Pages use
           fb.auth.currentUser for live auth checks. */
        document.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: { user, profile: null }
        }));

        /* Hydrate session in BACKGROUND — no await here. Pages get a
           second 'sessionChanged' (and updated auth) when done. */
        Session.hydrate(user)
          .then(() => {
            if (Session.profile) {
              this._setLoggedIn(Session.profile.username || quickName,
                                Session.profile.avatar || user.photoURL || null);
            }
            /* Also dispatch authStateChanged again with profile populated */
            document.dispatchEvent(new CustomEvent('authStateChanged', {
              detail: { user, profile: Session.profile }
            }));
          })
          .catch(e => console.warn('[Auth] hydrate:', e.message));
      } else {
        Session.clear();
        this._setLoggedOut();
        document.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: { user: null, profile: null }
        }));
      }
    });

    document.addEventListener('openAuthModal', () => this._openModal());
    return this;
  }

  _injectNavUI() {
    const actions = document.getElementById('nav-actions');
    if (!actions) return;
    document.getElementById('authNavWrap')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'authNavWrap'; wrap.className = 'auth-nav-wrap';
    wrap.dataset.state = 'pending';
    wrap.innerHTML = `
      <button id="navLoginBtn" class="nav-login-btn" type="button">Σύνδεση</button>
      <div id="navUserMenu" class="nav-user-menu">
        <button class="nav-avatar-btn" id="navAvatarBtn" type="button" aria-label="Μενού χρήστη" aria-expanded="false">
          <img id="navAvatarImg" class="nav-avatar-img" alt="" hidden>
          <span class="nav-avatar-initials" id="navAvatarInitials">?</span>
        </button>
        <div class="nav-dropdown" id="navDropdown" role="menu">
          <div class="nav-dropdown-header">
            <span class="nav-dropdown-username" id="navDropdownUsername"></span>
          </div>
          <a class="nav-dropdown-item" href="./profile.html" role="menuitem">${ICONS.user} Προφίλ</a>
          <a class="nav-dropdown-item" href="./profile.html#favorites" role="menuitem">${ICONS.heart} Αγαπημένα</a>
          <a class="nav-dropdown-item" href="./profile.html#watchlist" role="menuitem">${ICONS.bookmark} Watchlist</a>
          <a class="nav-dropdown-item" href="./profile.html#seen" role="menuitem">${ICONS.check} Έχω δει</a>
          <a class="nav-dropdown-item" href="./profile.html#ratings" role="menuitem">${ICONS.star} Αξιολογήσεις</a>
          <div class="nav-dropdown-divider"></div>
          <button class="nav-dropdown-item nav-dropdown-logout" id="navLogoutBtn" role="menuitem" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Αποσύνδεση
          </button>
        </div>
      </div>`;
    actions.appendChild(wrap);

    this.$wrap = wrap;
    this.$loginBtn = wrap.querySelector('#navLoginBtn');
    this.$userMenu = wrap.querySelector('#navUserMenu');
    this.$initials = wrap.querySelector('#navAvatarInitials');
    this.$avatarImg = wrap.querySelector('#navAvatarImg');
    this.$username = wrap.querySelector('#navDropdownUsername');
    this.$dropdown = wrap.querySelector('#navDropdown');
    this.$avatarBtn = wrap.querySelector('#navAvatarBtn');

    this.$loginBtn.addEventListener('click', () => this._openModal());
    this.$avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = this.$dropdown.classList.toggle('open');
      this.$avatarBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (this.$wrap && !this.$wrap.contains(e.target)) {
        this.$dropdown?.classList.remove('open');
        this.$avatarBtn?.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.$dropdown?.classList.remove('open'); this.$avatarBtn?.setAttribute('aria-expanded', 'false'); }
    });
    wrap.querySelector('#navLogoutBtn').addEventListener('click', async () => {
      this.$dropdown?.classList.remove('open');
      try { await fb.logout(); toast('Αποσυνδεθήκατε.', 'info'); }
      catch (e) { toast('Σφάλμα: ' + e.message, 'error'); }
    });
  }

  _setLoggedIn(name, avatarUrl = null) {
    if (!this.$wrap) return;
    this.$wrap.dataset.state = 'loggedIn';
    const d = String(name || '?');
    this.$initials.textContent = d.charAt(0).toUpperCase();
    this.$username.textContent = d;
    if (avatarUrl) {
      this.$avatarImg.src = avatarUrl; this.$avatarImg.alt = d; this.$avatarImg.hidden = false;
      this.$initials.style.display = 'none';
      this.$avatarImg.onerror = () => { this.$avatarImg.hidden = true; this.$initials.style.display = ''; };
    } else {
      this.$avatarImg.hidden = true; this.$avatarImg.src = ''; this.$initials.style.display = '';
    }
  }
  _setLoggedOut() {
    if (!this.$wrap) return;
    this.$wrap.dataset.state = 'loggedOut';
    this.$dropdown?.classList.remove('open');
    this.$avatarBtn?.setAttribute('aria-expanded', 'false');
  }

  _openModal(tab = 'login') {
    this._tab = tab;
    this._modal?.remove();
    const o = document.createElement('div');
    o.id = 'authModal'; o.className = 'auth-overlay';
    o.innerHTML = this._buildModalHTML(tab);
    document.body.appendChild(o);
    this._modal = o;
    this._wireModal(o);
  }

  _buildModalHTML(tab) {
    const isLogin = tab === 'login', isRegister = tab === 'register', isForgot = tab === 'forgot';
    return `
      <div class="auth-modal">
        <button class="auth-modal-close" id="authClose" aria-label="Κλείσιμο" type="button">✕</button>
        ${!isForgot ? `
        <div class="auth-tabs">
          <button class="auth-tab${isLogin?' auth-tab-active':''}" data-tab="login" type="button">Σύνδεση</button>
          <button class="auth-tab${isRegister?' auth-tab-active':''}" data-tab="register" type="button">Εγγραφή</button>
        </div>
        <button id="googleSignIn" class="auth-google-btn" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>Συνέχεια με Google
        </button>
        <div class="auth-divider"><span>ή με email</span></div>
        <div id="authFormWrap">
          ${isRegister ? `<input id="authUsername" type="text" placeholder="Ψευδώνυμο" autocomplete="username" class="auth-input">` : ''}
          <input id="authEmail" type="email" placeholder="Email" autocomplete="email" class="auth-input">
          <input id="authPassword" type="password" placeholder="Κωδικός" autocomplete="${isLogin?'current-password':'new-password'}" class="auth-input">
          <p id="authError" class="auth-error" style="display:none"></p>
          <button id="authSubmit" class="auth-submit-btn" type="button">${isLogin?'Σύνδεση':'Δημιουργία Λογαριασμού'}</button>
          ${isLogin ? `<button class="auth-forgot-link" id="authForgotLink" type="button">Ξεχάσατε τον κωδικό;</button>` : ''}
        </div>
        ` : `
        <div class="auth-forgot-view">
          <h3 class="auth-forgot-title">Επαναφορά Κωδικού</h3>
          <p class="auth-forgot-desc">Εισάγετε το email σας και θα σας στείλουμε σύνδεσμο επαναφοράς.</p>
          <input id="forgotEmail" type="email" placeholder="Email" autocomplete="email" class="auth-input">
          <p id="forgotError" class="auth-error" style="display:none"></p>
          <p id="forgotSuccess" class="auth-success" style="display:none"></p>
          <button id="forgotSubmit" class="auth-submit-btn" type="button">Αποστολή Email</button>
          <button class="auth-forgot-link" id="backToLogin" type="button">← Πίσω στη Σύνδεση</button>
        </div>
        `}
      </div>`;
  }

  _wireModal(o) {
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });
    o.querySelector('#authClose')?.addEventListener('click', () => o.remove());
    o.querySelectorAll('.auth-tab').forEach(b => b.addEventListener('click', () => this._openModal(b.dataset.tab)));
    o.querySelector('#authForgotLink')?.addEventListener('click', () => this._openModal('forgot'));
    o.querySelector('#backToLogin')?.addEventListener('click', () => this._openModal('login'));
    o.querySelector('#googleSignIn')?.addEventListener('click', async () => {
      try { await fb.loginWithGoogle(); o.remove(); toast('Συνδεθήκατε! 🎉', 'success'); }
      catch (e) { this._showError(this._mapError(e)); }
    });
    o.querySelector('#authSubmit')?.addEventListener('click', async () => {
      const email = o.querySelector('#authEmail')?.value?.trim();
      const password = o.querySelector('#authPassword')?.value;
      const username = o.querySelector('#authUsername')?.value?.trim();
      if (!email || !password) { this._showError('Συμπληρώστε email και κωδικό.'); return; }
      try {
        if (this._tab === 'register') {
          if (!username) { this._showError('Συμπληρώστε ψευδώνυμο.'); return; }
          await fb.registerWithEmail(email, password, username);
          toast('Καλωσήρθατε! 🎉', 'success');
        } else {
          await fb.loginWithEmail(email, password);
          toast('Συνδεθήκατε!', 'success');
        }
        o.remove();
      } catch (e) { this._showError(this._mapError(e)); }
    });
    o.querySelector('#forgotSubmit')?.addEventListener('click', async () => {
      const email = o.querySelector('#forgotEmail')?.value?.trim();
      if (!email) { this._showForgotError('Εισάγετε το email σας.'); return; }
      try {
        await fb.forgotPassword(email);
        const s = o.querySelector('#forgotSuccess'), err = o.querySelector('#forgotError');
        if (s) { s.textContent = `Στάλθηκε email στο ${email}!`; s.style.display = 'block'; }
        if (err) err.style.display = 'none';
      } catch (e) { this._showForgotError(this._mapError(e)); }
    });
    o.addEventListener('keydown', e => {
      if (e.key === 'Enter') { o.querySelector('#authSubmit')?.click(); o.querySelector('#forgotSubmit')?.click(); }
      if (e.key === 'Escape') o.remove();
    });
  }

  _mapError(e) {
    const m = {
      'auth/user-not-found':'Δεν βρέθηκε χρήστης.','auth/wrong-password':'Λανθασμένος κωδικός.',
      'auth/invalid-credential':'Λανθασμένα στοιχεία.','auth/email-already-in-use':'Το email χρησιμοποιείται ήδη.',
      'auth/weak-password':'Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.',
      'auth/invalid-email':'Μη έγκυρο email.','auth/too-many-requests':'Πολλές προσπάθειες. Δοκιμάστε αργότερα.',
    };
    return m[e.code] ?? e.message;
  }
  _showError(msg)       { const el = this._modal?.querySelector('#authError');   if (el) { el.textContent = msg; el.style.display = 'block'; } }
  _showForgotError(msg) { const el = this._modal?.querySelector('#forgotError'); if (el) { el.textContent = msg; el.style.display = 'block'; } }
}

/* ══════════════════════════════════════════════════════════
   DATA MANAGER
   ══════════════════════════════════════════════════════════ */
class DataManager {
  constructor() { this._raw = null; this._localAll = null; this._rich = null; }

  async _loadRaw() {
    if (this._raw) return this._raw;
    try {
      const r = await fetch(`${BASE_URL}data/series.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this._raw = await r.json();
      if (typeof this._raw !== 'object' || Array.isArray(this._raw)) throw new Error('Invalid JSON');
      return this._raw;
    } catch (e) { console.error('[DataManager]', e.message); this._raw = {}; return this._raw; }
  }

  _buildLocalEntries(raw) {
    return Object.entries(raw).map(([slug, data]) => ({
      slug, data, tmdb: null,
      title: data.title ?? data.title_fallback ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      overview: data.overview ?? '', channel: data.channel ?? 'Unknown',
      _posterFallback: data.poster_fallback ?? null,
      _backdropFallback: data.backdrop_fallback ?? null,
    }));
  }

  _mergeWithTMDB(locals, results) {
    const map = new Map(results.map(e => [e.slug, e.tmdb]));
    return locals.map(l => {
      const t = map.get(l.slug) ?? null;
      return { ...l, tmdb: t, title: l.data.title ?? t?.title ?? l.title, overview: l.data.overview ?? t?.overview ?? l.overview };
    });
  }

  async loadLocalFast() {
    if (this._rich) return this._rich;
    if (this._localAll) return this._localAll;
    const raw = await this._loadRaw();
    if (!Object.keys(raw).length) return [];
    this._localAll = this._buildLocalEntries(raw);
    return this._localAll;
  }

  async loadAll() {
    if (this._rich) return this._rich;
    const raw = await this._loadRaw();
    if (!Object.keys(raw).length) { this._rich = []; return this._rich; }
    this._localAll = this._buildLocalEntries(raw);
    try {
      const entries = Object.entries(raw).map(([slug, data]) => ({ slug, data }));
      const results = await Promise.race([
        tmdb.batchResolve(entries),
        new Promise(r => setTimeout(() => r(null), 8000)),
      ]);
      this._rich = (results?.length > 0) ? this._mergeWithTMDB(this._localAll, results) : this._localAll;
    } catch (e) { console.warn('[DM] TMDB failed:', e.message); this._rich = this._localAll; }
    return this._rich;
  }

  async getOne(slug) {
    const raw = await this._loadRaw();
    const data = raw[slug];
    if (!data) return null;
    const local = {
      slug, data, tmdb: null,
      title: data.title ?? data.title_fallback ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      overview: data.overview ?? '', channel: data.channel ?? 'Unknown',
      _posterFallback: data.poster_fallback ?? null,
      _backdropFallback: data.backdrop_fallback ?? null,
    };
    try {
      const t = await Promise.race([ tmdb.getDetails(data), new Promise(r => setTimeout(() => r(null), 6000)) ]);
      if (t) return { ...local, tmdb: t, title: data.title ?? t.title ?? local.title, overview: data.overview ?? t.overview ?? local.overview };
    } catch (e) { console.warn('[DM] getOne:', e.message); }
    return local;
  }
}

/* ══════════════════════════════════════════════════════════
   GENRE SYSTEM
   ══════════════════════════════════════════════════════════ */
export const GREEK_GENRES = [
  'Σειρές','Κωμωδία','Δράμα','Δράση','Θρίλερ','Κινούμενα Σχέδια','Anime',
  'Οικογενειακές','Αισθηματικές','Μιούζικαλ','Περιπέτεια','Sci-Fi','Φαντασίας',
  'Western','Τρόμου','Μυστηρίου','Εγκλήματος','Ιστορικές','Βιογραφίες',
  'Ντοκιμαντέρ','Ελληνικές Ταινίες','Θέατρο','Αθλητικά'
];

/* TMDB name → Greek categories (multi-target supported) */
const GENRE_MAP = {
  'Action':           ['Δράση'],
  'Adventure':        ['Περιπέτεια'],
  'Animation':        ['Κινούμενα Σχέδια'],
  'Comedy':           ['Κωμωδία'],
  'Crime':            ['Εγκλήματος'],
  'Documentary':      ['Ντοκιμαντέρ','Βιογραφίες'],
  'Drama':            ['Δράμα'],
  'Family':           ['Οικογενειακές'],
  'Fantasy':          ['Φαντασίας'],
  'History':          ['Ιστορικές','Βιογραφίες'],
  'Horror':           ['Τρόμου'],
  'Music':            ['Μιούζικαλ'],
  'Mystery':          ['Μυστηρίου'],
  'Romance':          ['Αισθηματικές'],
  'Science Fiction':  ['Sci-Fi'],
  'Sci-Fi & Fantasy': ['Sci-Fi','Φαντασίας'],
  'Thriller':         ['Θρίλερ'],
  'War':              ['Ιστορικές'],
  'War & Politics':   ['Ιστορικές'],
  'Western':          ['Western'],
  'Action & Adventure': ['Δράση','Περιπέτεια'],
  'Kids':             ['Οικογενειακές'],
  'News':             ['Ντοκιμαντέρ'],
  'Soap':             ['Δράμα','Αισθηματικές'],
  'Reality':          [],
  'Talk':             [],
  /* Greek aliases that may appear in JSON */
  'Δράμα':        ['Δράμα'],
  'Κωμωδία':     ['Κωμωδία'],
  'Δράση':       ['Δράση'],
  'Περιπέτεια':  ['Περιπέτεια'],
  'Φαντασία':    ['Φαντασίας'],
  'Θρίλερ':      ['Θρίλερ'],
  'Αστυνομική': ['Εγκλήματος'],
  'Τρόμου':      ['Τρόμου'],
  'Ρομάντζο':    ['Αισθηματικές'],
  'Μυστήριο':    ['Μυστηρίου'],
  'Ιστορική':    ['Ιστορικές'],
};

/** Returns the Greek category tags that apply to a given series entry. */
export function classifyEntry(entry) {
  const tags = new Set();
  const genres = entry.tmdb?.genres ?? entry.data?.genres ?? [];
  for (const g of genres) {
    const mapped = GENRE_MAP[g] ?? [];
    mapped.forEach(t => tags.add(t));
  }

  /* Special rules */
  const origin = entry.tmdb?.originCountry ?? [];
  const isAnimation = genres.some(g => g === 'Animation' || g === 'Κινούμενα Σχέδια');

  /* Σειρές → all TV series (everything in this DB is a TV series) */
  tags.add('Σειρές');

  /* Anime → origin=JP AND animation */
  if (isAnimation && origin.includes('JP')) tags.add('Anime');

  /* Ελληνικές Ταινίες → origin=GR */
  if (origin.includes('GR')) tags.add('Ελληνικές Ταινίες');

  /* Manual tags via JSON (data.categories array) */
  const manualTags = entry.data?.categories ?? [];
  manualTags.forEach(t => tags.add(t));

  return [...tags];
}

/* ══════════════════════════════════════════════════════════
   CARD RENDERER
   ══════════════════════════════════════════════════════════ */
function renderCard(entry) {
  const { slug, title, channel, tmdb: t, _posterFallback } = entry;
  const poster = t?.poster ?? _posterFallback ?? null;
  const year = t?.year ?? entry.data?.year ?? '';
  const rating = t?.rating ?? '';
  const watchUrl = pageUrl('watch.html', { series: slug, season: 1, ep: 1 });
  const genres = (t?.genres ?? entry.data?.genres ?? []).slice(0, 2);
  const posterHtml = poster ? `<img class="card-poster" src="${poster}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : '';
  const ph = `<div class="card-no-poster" style="${poster?'display:none':''}">${ICONS.film}<span>${escapeHtml(title)}</span></div>`;
  return `
    <div class="series-card" data-slug="${escapeHtml(slug)}"
         data-title="${escapeHtml(title.toLowerCase())}"
         data-channel="${escapeHtml(channel.toLowerCase())}"
         data-genres="${escapeHtml(genres.join(',').toLowerCase())}">
      ${posterHtml}${ph}
      <div class="card-overlay">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-meta">
          ${year?`<span>${escapeHtml(String(year))}</span>`:''}
          ${rating?`<span class="card-rating">${ICONS.star}${rating}</span>`:''}
          <span class="card-channel">${escapeHtml(channel)}</span>
        </div>
      </div>
      <a href="${watchUrl}" class="card-play-btn" aria-label="Παρακολούθηση ${escapeHtml(title)}">${ICONS.play}</a>
    </div>`;
}

function buildSection(title, entries, mode = 'row') {
  if (!entries.length) return '';
  const cards = entries.map(renderCard).join('');
  if (mode === 'grid')
    return `<div class="section" data-section><div class="section-header"><h2 class="section-title">${escapeHtml(title)}</h2></div><div class="series-grid">${cards}</div></div>`;
  return `<div class="section" data-section>
      <div class="section-header"><h2 class="section-title">${escapeHtml(title)}</h2></div>
      <div class="row-wrapper">
        <button class="row-arrow left" aria-label="Scroll left">${ICONS.chevL}</button>
        <div class="series-row">${cards}</div>
        <button class="row-arrow right" aria-label="Scroll right">${ICONS.chevR}</button>
      </div>
    </div>`;
}

function observeSections() {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } }), { threshold: 0.06 });
  $$('[data-section]').forEach(el => io.observe(el));
}

function initNavScroll() {
  const nav = $('#navbar'); if (!nav) return;
  const fn = () => nav.classList.toggle('scrolled', window.scrollY > 60);
  window.addEventListener('scroll', fn, { passive: true }); fn();
}

function initRowArrows() {
  $$('.row-wrapper').forEach(w => {
    const row = $('.series-row', w); if (!row) return;
    $('.row-arrow.left', w)?.addEventListener('click', () => row.scrollBy({ left: -row.clientWidth * 0.75, behavior: 'smooth' }));
    $('.row-arrow.right', w)?.addEventListener('click', () => row.scrollBy({ left: row.clientWidth * 0.75, behavior: 'smooth' }));
  });
}

function initCardClicks() {
  document.addEventListener('click', e => {
    const card = e.target.closest('.series-card');
    if (!card || e.target.closest('a') || e.target.closest('.card-play-btn')) return;
    const slug = card.dataset.slug;
    if (slug) window.location.href = pageUrl('series.html', { id: slug });
  });
}

/* ══════════════════════════════════════════════════════════
   SEARCH CONTROLLER
   ══════════════════════════════════════════════════════════ */
class SearchController {
  constructor(all) { this._all = all; this._overlay = $('#searchOverlay'); this._input = $('#searchInput'); this._results = $('#searchResults'); this._init(); }
  _init() {
    $('#searchToggle')?.addEventListener('click', () => this._open());
    $('#searchClose')?.addEventListener('click', () => this._close());
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
    const m = this._all.filter(e =>
      e.title.toLowerCase().includes(q) || e.channel.toLowerCase().includes(q) ||
      (e.tmdb?.genres ?? e.data?.genres ?? []).join(' ').toLowerCase().includes(q)
    );
    this._results.innerHTML = m.length
      ? `<div class="series-grid">${m.map(renderCard).join('')}</div>`
      : `<div class="search-empty">${ICONS.search}<p>Δεν βρέθηκαν αποτελέσματα για "<strong>${escapeHtml(q)}</strong>"</p></div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   HOMEPAGE
   ══════════════════════════════════════════════════════════ */
class HomepageController {
  constructor() { this._dm = new DataManager(); this._all = []; this._heroIdx = 0; this._heroTimer = null; this._featured = []; }

  async init() {
    initNavScroll();
    new AuthController().init();
    this._all = await this._dm.loadAll();
    if (!this._all.length) {
      const s = $('#sections');
      if (s) s.innerHTML = `<div style="text-align:center;padding:4rem 2rem;color:var(--text-3)"><p style="font-size:1.1rem;margin-bottom:.5rem">Δεν ήταν δυνατή η φόρτωση περιεχομένου.</p></div>`;
      return;
    }
    this._buildSections();
    this._buildHero();
    new SearchController(this._all);
    initCardClicks();
    observeSections();
  }

  _buildSections() {
    const c = $('#sections'); if (!c) return;
    const featured = this._all.filter(e => e.data.featured);
    const recent = [...this._all].reverse().slice(0, 12);
    const random = shuffle(this._all).filter(e => !featured.find(f => f.slug === e.slug)).slice(0, 10);
    let html = '';
    if (featured.length) html += buildSection('Προτεινόμενες', featured, 'row');
    html += buildSection('Πρόσφατες Αναρτήσεις', recent, 'row');
    if (random.length) html += buildSection('Τυχαίες Επιλογές', random, 'row');
    const byCh = groupBy(this._all, 'channel');
    Object.entries(byCh).sort(([a],[b]) => a.localeCompare(b)).forEach(([ch, entries]) => {
      html += buildSection(ch, entries, 'row');
    });
    c.innerHTML = html;
    initRowArrows();
  }

  _buildHero() {
    this._featured = this._all.filter(e => e.data.featured);
    if (!this._featured.length) this._featured = this._all.slice(0, 3);
    if (!this._featured.length) return;
    const d = $('#heroDots');
    if (d) {
      d.innerHTML = this._featured.map((_, i) => `<button class="hero-dot-btn${i===0?' active':''}" data-idx="${i}"></button>`).join('');
      d.addEventListener('click', e => { const b = e.target.closest('.hero-dot-btn'); if (b) this._showHero(+b.dataset.idx); });
    }
    this._showHero(0);
    this._heroTimer = setInterval(() => { this._heroIdx = (this._heroIdx + 1) % this._featured.length; this._showHero(this._heroIdx); }, 8000);
  }

  _showHero(idx) {
    this._heroIdx = idx;
    const e = this._featured[idx]; if (!e) return;
    const { title, channel, tmdb: t, _backdropFallback, _posterFallback } = e;
    const bg = $('#heroBg');
    if (bg) { const img = t?.backdrop ?? t?.posterLg ?? _backdropFallback ?? _posterFallback ?? ''; bg.style.backgroundImage = img ? `url('${img}')` : ''; }
    const ct = $('#heroContent');
    if (ct) {
      const y = t?.year ?? e.data?.year ?? '', r = t?.rating ?? '', s = t?.seasons ?? null;
      const g = (t?.genres ?? e.data?.genres ?? []).slice(0, 3), desc = e.overview ?? '';
      ct.innerHTML = `
        <div class="hero-channel">${escapeHtml(channel)}</div>
        <h1 class="hero-title">${escapeHtml(title)}</h1>
        <div class="hero-meta">${y?`<span>${escapeHtml(String(y))}</span>`:''}${r?`<span class="hero-rating">${ICONS.star} ${r}</span>`:''}${s?`<span>${s} Σεζόν</span>`:''}</div>
        ${g.length?`<div class="hero-genres">${g.map(x=>`<span class="genre-tag">${escapeHtml(x)}</span>`).join('')}</div>`:''}
        ${desc?`<p class="hero-desc">${escapeHtml(desc)}</p>`:''}
        <div class="hero-actions">
          <a href="${pageUrl('watch.html',{series:e.slug,season:1,ep:1})}" class="btn-primary">${ICONS.play} Δείτε Τώρα</a>
          <a href="${pageUrl('series.html',{id:e.slug})}" class="btn-secondary">${ICONS.info} Περισσότερα</a>
        </div>`;
    }
    $$('.hero-dot-btn').forEach((b, i) => b.classList.toggle('active', i === idx));
  }
}

/* ══════════════════════════════════════════════════════════
   STAR RATING WIDGET
   ══════════════════════════════════════════════════════════ */
function renderStarRating(container, slug) {
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, '_');
  const current = Session.getRating(slug);
  container.innerHTML = `
    <div class="star-rating" data-slug="${escapeHtml(slug)}">
      ${[1,2,3,4,5].map(n => `
        <button class="star-btn${n <= current ? ' active' : ''}" data-star="${n}" title="${n}★" type="button">${ICONS.star}</button>`).join('')}
      <span class="star-label" id="starLabel-${safe}">${current ? `${current}/5` : 'Αξιολόγησε'}</span>
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
    btn.addEventListener('mouseover', () => {
      const n = +btn.dataset.star;
      container.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('hover', i < n));
    });
    btn.addEventListener('mouseout', () => {
      container.querySelectorAll('.star-btn').forEach(b => b.classList.remove('hover'));
    });
    btn.addEventListener('click', async () => {
      /* Live auth check — works even before Session.hydrate completes */
      if (!fb?.auth?.currentUser) { toast('Συνδεθείτε για να αξιολογήσετε.', 'info'); return; }
      const stars = +btn.dataset.star;
      container.querySelectorAll('.star-btn').forEach((b, i) => { b.classList.toggle('active', i < stars); b.classList.remove('hover'); });
      const lbl = document.getElementById(`starLabel-${safe}`);
      if (lbl) lbl.textContent = `${stars}/5`;
      try {
        await Session.setRating(slug, stars);
        toast(`Αξιολόγηση: ${stars}/5 ★`, 'success');
      } catch (e) {
        console.error('[Rating]', e);
        toast('Σφάλμα αξιολόγησης.', 'error');
        const prev = Session.getRating(slug);
        container.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('active', i < prev));
        if (lbl) lbl.textContent = prev ? `${prev}/5` : 'Αξιολόγησε';
      }
    });
  });
}

/* ══════════════════════════════════════════════════════════
   COMMENTS
   ══════════════════════════════════════════════════════════ */
function _commentAvatar(c) {
  const i = (c.username?.[0] ?? '?').toUpperCase();
  if (c.userAvatar) {
    return `<img class="comment-avatar-img" src="${escapeHtml(c.userAvatar)}" alt="${escapeHtml(c.username ?? '')}" onerror="this.outerHTML='<span class=&quot;comment-avatar-initials&quot;>${escapeHtml(i)}</span>'">`;
  }
  return `<span class="comment-avatar-initials">${escapeHtml(i)}</span>`;
}

async function renderComments(container, slug) {
  let comments = [];
  try { comments = await fb.getComments(slug); } catch (_) {}
  const listHtml = comments.length ? comments.map(c => {
    const date = c.createdAt?.toDate?.()?.toLocaleDateString('el-GR') ?? '';
    return `<div class="comment-item">
        <div class="comment-header">
          <div class="comment-avatar">${_commentAvatar(c)}</div>
          <strong class="comment-user">${escapeHtml(c.username ?? 'Ανώνυμος')}</strong>
          <span class="comment-date">${date}</span>
        </div>
        <p class="comment-text">${escapeHtml(c.text ?? '')}</p>
        <div class="comment-actions">
          <button class="comment-action-btn like-btn" data-id="${c.id}" data-slug="${escapeHtml(slug)}" type="button">${ICONS.thumbUp} <span>${c.likes ?? 0}</span></button>
          <button class="comment-action-btn dislike-btn" data-id="${c.id}" data-slug="${escapeHtml(slug)}" type="button">${ICONS.thumbDown} <span>${c.dislikes ?? 0}</span></button>
        </div>
      </div>`;
  }).join('') : '<p class="comments-empty">Δεν υπάρχουν σχόλια ακόμα. Γίνετε οι πρώτοι!</p>';

  const isLoggedIn = !!(fb?.auth?.currentUser || Session.user);
  container.innerHTML = `
    <div class="comments-section">
      <h3 class="comments-title">💬 Σχόλια${comments.length ? ` <span class="count-badge">${comments.length}</span>` : ''}</h3>
      ${isLoggedIn ? `
        <div class="comment-input-wrap">
          <textarea id="commentText" placeholder="Γράψτε ένα σχόλιο…" rows="3" class="comment-textarea" maxlength="2000"></textarea>
          <button id="commentSubmit" class="comment-submit-btn" type="button">Δημοσίευση</button>
        </div>` : `
        <div class="comment-login-notice">
          <p>Πρέπει να <button class="comment-login-link" id="commentLoginBtn" type="button">συνδεθείτε</button> για να σχολιάσετε.</p>
        </div>`
      }
      <div class="comments-list">${listHtml}</div>
    </div>`;

  container.querySelector('#commentLoginBtn')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('openAuthModal'))
  );
  container.querySelectorAll('.like-btn').forEach(b => b.addEventListener('click', async () => {
    if (!fb?.auth?.currentUser) { toast('Συνδεθείτε πρώτα.', 'info'); return; }
    await fb.likeComment(b.dataset.slug, b.dataset.id);
    await renderComments(container, slug);
  }));
  container.querySelectorAll('.dislike-btn').forEach(b => b.addEventListener('click', async () => {
    if (!fb?.auth?.currentUser) { toast('Συνδεθείτε πρώτα.', 'info'); return; }
    await fb.dislikeComment(b.dataset.slug, b.dataset.id);
    await renderComments(container, slug);
  }));
  container.querySelector('#commentSubmit')?.addEventListener('click', async () => {
    const text = container.querySelector('#commentText')?.value?.trim();
    if (!text) { toast('Γράψτε κάτι πρώτα.', 'info'); return; }
    const liveUser = fb?.auth?.currentUser ?? Session.user;
    if (!liveUser) { toast('Συνδεθείτε πρώτα.', 'info'); return; }
    try {
      const u = Session.profile?.username ?? liveUser.displayName ?? liveUser.email?.split('@')[0] ?? 'Ανώνυμος';
      const a = Session.profile?.avatar ?? liveUser.photoURL ?? null;
      await fb.postComment(slug, liveUser.uid, u, text, a);
      container.querySelector('#commentText').value = '';
      await renderComments(container, slug);
      toast('Το σχόλιο δημοσιεύτηκε!', 'success');
    } catch (e) { toast('Σφάλμα δημοσίευσης.', 'error'); }
  });
}

/* ══════════════════════════════════════════════════════════
   SERIES PAGE
   ══════════════════════════════════════════════════════════ */
class SeriesController {
  constructor() { this._dm = new DataManager(); }

  async init() {
    initNavScroll();
    new AuthController().init();
    /* NON-BLOCKING: render immediately. Auth/session updates arrive via
       'authStateChanged' + 'sessionChanged' events, which trigger syncAll().
       The page is fully usable before auth resolves. */
    const slug = new URLSearchParams(window.location.search).get('id');
    if (!slug) { window.location.href = pageUrl('index.html'); return; }
    const entry = await this._dm.getOne(slug);
    if (!entry) { toast('Η σειρά δεν βρέθηκε.', 'error'); setTimeout(() => window.location.href = pageUrl('index.html'), 2000); return; }
    document.title = `${entry.title} — StreamVault`;
    await this._render(entry);
    initCardClicks();
  }

  async _render(entry) {
    const { slug, title, channel, tmdb: t, data, _backdropFallback, _posterFallback } = entry;

    const bd = $('#seriesBackdrop');
    if (bd) { const i = t?.backdrop ?? t?.posterLg ?? _backdropFallback ?? ''; if (i) bd.style.backgroundImage = `url('${i}')`; }
    const p = $('#seriesPoster');
    if (p) { const src = t?.posterLg ?? _posterFallback ?? null;
      p.innerHTML = src ? `<img src="${src}" alt="${escapeHtml(title)}" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>${ICONS.film}</div>'">` : `<div class="no-poster">${ICONS.film}</div>`;
    }
    const cb = $('#seriesChannelBadge'); if (cb) cb.textContent = channel;
    const te = $('#seriesTitle'); if (te) te.textContent = title;

    const m = $('#seriesMeta');
    if (m) {
      const parts = [];
      if (t?.year) parts.push(`<span>${t.year}</span>`);
      if (t?.rating) parts.push(`<span class="rating-stars">${ICONS.star} ${t.rating}</span>`);
      if (t?.seasons) parts.push(`<span>${t.seasons} Σεζόν</span>`);
      if (t?.status) parts.push(`<span>${escapeHtml(t.status)}</span>`);
      m.innerHTML = parts.join('<span class="meta-sep">·</span>');
    }

    const ge = $('#seriesGenres');
    if (ge) { const g = t?.genres ?? data.genres ?? []; if (g.length) ge.innerHTML = g.map(x => `<span class="genre-tag">${escapeHtml(x)}</span>`).join(''); }

    const ov = $('#seriesOverview');
    if (ov) ov.textContent = entry.overview || 'Δεν υπάρχει διαθέσιμη περιγραφή.';

    const cta = $('#seriesCta');
    if (cta) {
      cta.innerHTML = `
        <a href="${pageUrl('watch.html', { series: slug, season: 1, ep: 1 })}" class="btn-primary">${ICONS.play} Δείτε Τώρα</a>
        <a href="${pageUrl('index.html')}" class="btn-secondary">${ICONS.back} Αρχική</a>
        <button id="favBtn"       class="btn-secondary user-action-btn" type="button">${ICONS.heart}    <span id="favLabel">Αγαπημένα</span></button>
        <button id="watchlistBtn" class="btn-secondary user-action-btn" type="button">${ICONS.bookmark} <span id="watchlistLabel">Watchlist</span></button>
        <button id="seenBtn"      class="btn-secondary user-action-btn" type="button">${ICONS.check}    <span id="seenLabel">Έχω δει</span></button>`;
    }

    /* Button state: use LIVE auth (fb.auth.currentUser) so labels update
       immediately when user signs in, even before Session hydrates.
       Session cache provides the isFav/isWatch/isSeen lookups for active state. */
    const syncBtns = () => {
      const liveUser = fb?.auth?.currentUser ?? Session.user;
      const isFav = Session.isFav(slug), isW = Session.isWatch(slug), isS = Session.isSeen(slug);
      const fl = $('#favLabel'), wl = $('#watchlistLabel'), sl = $('#seenLabel');
      if (fl) fl.textContent = liveUser ? (isFav ? '❤️ Αφαίρεση' : 'Αγαπημένα') : 'Αγαπημένα';
      if (wl) wl.textContent = liveUser ? (isW ? '📌 Στη λίστα' : 'Watchlist') : 'Watchlist';
      if (sl) sl.textContent = liveUser ? (isS ? '✓ Το είδα' : 'Έχω δει') : 'Έχω δει';
      $('#favBtn')      ?.classList.toggle('active', !!isFav && !!liveUser);
      $('#watchlistBtn')?.classList.toggle('active', !!isW   && !!liveUser);
      $('#seenBtn')     ?.classList.toggle('active', !!isS   && !!liveUser);
    };

    const ratingWrap = $('#seriesRatingWrap');
    const syncRating = () => { if (ratingWrap) renderStarRating(ratingWrap, slug); };

    const syncAll = () => { syncBtns(); syncRating(); };
    document.addEventListener('sessionChanged', syncAll);
    document.addEventListener('authStateChanged', syncAll);
    syncAll();

    /* Click handlers check LIVE auth (fb.auth.currentUser) at click time —
       not cached Session.user. This means buttons work the instant a user
       signs in, even if Session hasn't hydrated yet. */
    const liveAuthOk = () => !!(fb?.auth?.currentUser);
    $('#favBtn')?.addEventListener('click', async () => {
      if (!liveAuthOk()) { toast('Συνδεθείτε πρώτα.', 'info'); return; }
      try { const a = await Session.toggleFavorite(slug); toast(a ? '❤️ Προστέθηκε!' : 'Αφαιρέθηκε.', 'success'); }
      catch (e) { toast('Σφάλμα: ' + e.message, 'error'); }
    });
    $('#watchlistBtn')?.addEventListener('click', async () => {
      if (!liveAuthOk()) { toast('Συνδεθείτε πρώτα.', 'info'); return; }
      try { const a = await Session.toggleWatchlist(slug); toast(a ? '📌 Προστέθηκε!' : 'Αφαιρέθηκε.', 'success'); }
      catch (e) { toast('Σφάλμα: ' + e.message, 'error'); }
    });
    $('#seenBtn')?.addEventListener('click', async () => {
      if (!liveAuthOk()) { toast('Συνδεθείτε πρώτα.', 'info'); return; }
      try { const a = await Session.toggleSeen(slug); toast(a ? '✓ Σημειώθηκε!' : 'Αφαιρέθηκε.', 'success'); }
      catch (e) { toast('Σφάλμα: ' + e.message, 'error'); }
    });

    this._renderEpisodes(slug, data.episodes ?? []);

    const ce = $('#seriesComments');
    if (ce) {
      await renderComments(ce, slug);
      document.addEventListener('authStateChanged', () => renderComments(ce, slug));
    }
  }

  _renderEpisodes(slug, episodes) {
    const c = $('#episodesContainer'); if (!c) return;
    if (!episodes.length) { c.innerHTML = '<p style="color:var(--text-3)">Δεν βρέθηκαν επεισόδια.</p>'; return; }
    const bs = {}; episodes.forEach(ep => (bs[ep.season] = bs[ep.season] || []).push(ep));
    const seasons = Object.keys(bs).map(Number).sort((a, b) => a - b);
    let active = seasons[0];
    const tabs = () => seasons.map(s => `<button class="season-tab${s===active?' active':''}" data-season="${s}" type="button">Σεζόν ${s}</button>`).join('');
    const grid = (s) => bs[s].map(ep => {
      const pn = Object.keys(ep.players ?? {});
      const url = pageUrl('watch.html', { series: slug, season: ep.season, ep: ep.ep });
      return `<a href="${url}" class="episode-card">
          <div class="episode-num">${String(ep.ep).padStart(2,'0')}</div>
          <div class="episode-info">
            <div class="episode-label">Επεισόδιο ${ep.ep}</div>
            <div class="episode-players">${pn.length} server${pn.length!==1?'s':''}: ${pn.join(', ')}</div>
          </div>
          <div class="episode-play-icon">${ICONS.play}</div>
        </a>`;
    }).join('');
    const u = () => {
      c.innerHTML = `<div class="season-tabs">${tabs()}</div><div class="episodes-grid">${grid(active)}</div>`;
      $$('.season-tab', c).forEach(b => b.addEventListener('click', () => { active = +b.dataset.season; u(); }));
    };
    u();
  }
}

/* ══════════════════════════════════════════════════════════
   WATCH PAGE
   ══════════════════════════════════════════════════════════ */
class WatchController {
  constructor() { this._dm = new DataManager(); this._slug = null; this._season = 1; this._ep = 1; this._entry = null; this._players = {}; this._active = null; }

  async init() {
    initNavScroll();
    new AuthController().init();
    /* NON-BLOCKING: render immediately. Auth irrelevant for watching. */
    const p = new URLSearchParams(window.location.search);
    this._slug = p.get('series'); this._season = +(p.get('season') ?? 1); this._ep = +(p.get('ep') ?? 1);
    if (!this._slug) { window.location.href = pageUrl('index.html'); return; }
    this._entry = await this._dm.getOne(this._slug);
    if (!this._entry) { toast('Η σειρά δεν βρέθηκε.', 'error'); return; }
    document.title = `${this._entry.title} S${this._season}E${this._ep} — StreamVault`;
    this._findEp(); this._renderMeta(); this._renderPlayer(); this._renderControls(); this._renderAllEps();
  }

  _findEp() {
    const ep = (this._entry.data.episodes ?? []).find(e => e.season === this._season && e.ep === this._ep);
    this._players = ep?.players ?? {}; this._active = Object.keys(this._players)[0] ?? null;
  }

  _renderMeta() {
    const t = $('#watchTitle'); if (t) t.textContent = this._entry.title;
    const b = $('#watchEpBadge'); if (b) b.textContent = `S${this._season} E${this._ep}`;
    /* watchSeriesLink is in nav-actions in watch.html — reveal and populate it */
    const bl = $('#watchSeriesLink');
    if (bl) {
      bl.href = pageUrl('series.html', { id: this._slug });
      bl.style.display = '';
      bl.innerHTML = `${ICONS.back} Όλα τα Επεισόδια`;
    }
  }

  _renderPlayer() {
    const w = $('#playerWrapper'); if (!w) return;
    if (!this._active || !this._players[this._active]) {
      w.innerHTML = `<div class="player-loading"><div style="font-size:2.5rem;margin-bottom:.5rem">🎬</div><p>Δεν υπάρχει διαθέσιμος player.</p></div>`; return;
    }
    w.innerHTML = `
      <div class="player-loading" id="playerLoading"><div class="spinner"></div><span>Φόρτωση…</span></div>
      <iframe class="player-iframe" id="playerIframe" src="${this._players[this._active]}"
        allowfullscreen allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-top-navigation"></iframe>`;
    $('#playerIframe')?.addEventListener('load', () => $('#playerLoading')?.remove());
  }

  _renderControls() {
    const b = $('#playerBtns');
    if (b) {
      b.innerHTML = Object.keys(this._players).map(n => `<button class="player-btn${n===this._active?' active':''}" data-player="${escapeHtml(n)}" type="button">${escapeHtml(n)}</button>`).join('');
      b.addEventListener('click', e => {
        const btn = e.target.closest('.player-btn'); if (!btn) return;
        $$('.player-btn', b).forEach(x => x.classList.remove('active'));
        btn.classList.add('active'); this._active = btn.dataset.player; this._renderPlayer();
      });
    }
    const s = $('#episodeSelect');
    if (s) {
      const bs = {}; (this._entry.data.episodes ?? []).forEach(e => (bs[e.season] = bs[e.season] || []).push(e));
      s.innerHTML = Object.keys(bs).sort((a,b) => a-b).map(se =>
        `<optgroup label="Σεζόν ${se}">${bs[se].map(e => `<option value="${e.season}|${e.ep}" ${e.season===this._season&&e.ep===this._ep?'selected':''}>S${e.season} E${e.ep}</option>`).join('')}</optgroup>`
      ).join('');
      s.addEventListener('change', () => {
        const [se, ep] = s.value.split('|').map(Number);
        window.location.href = pageUrl('watch.html', { series: this._slug, season: se, ep });
      });
    }
    const eps = this._entry.data.episodes ?? [];
    const sorted = [...eps].sort((a, b) => a.season !== b.season ? a.season - b.season : a.ep - b.ep);
    const i = sorted.findIndex(e => e.season === this._season && e.ep === this._ep);
    const prev = $('#prevEpBtn'), next = $('#nextEpBtn');
    if (prev) { prev.disabled = i <= 0; prev.addEventListener('click', () => { if (i > 0) { const p = sorted[i-1]; window.location.href = pageUrl('watch.html', { series: this._slug, season: p.season, ep: p.ep }); } }); }
    if (next) { next.disabled = i >= sorted.length-1; next.addEventListener('click', () => { if (i < sorted.length-1) { const n = sorted[i+1]; window.location.href = pageUrl('watch.html', { series: this._slug, season: n.season, ep: n.ep }); } }); }
  }

  _renderAllEps() {
    const c = $('#allEpisodesPanel'); if (!c) return;
    const bs = {}; (this._entry.data.episodes ?? []).forEach(e => (bs[e.season] = bs[e.season] || []).push(e));
    const cs = bs[this._season] ?? [];
    c.innerHTML = `<h3>Σεζόν ${this._season} — Επεισόδια</h3><div class="episodes-grid">${cs.map(ep => {
      const url = pageUrl('watch.html', { series: this._slug, season: ep.season, ep: ep.ep });
      const cur = ep.season === this._season && ep.ep === this._ep;
      return `<a href="${url}" class="episode-card${cur?' episode-card-active':''}">
          <div class="episode-num">${String(ep.ep).padStart(2,'0')}</div>
          <div class="episode-info">
            <div class="episode-label">Επεισόδιο ${ep.ep}${cur?' <span class="ep-now-playing">(Παίζει)</span>':''}</div>
            <div class="episode-players">${Object.keys(ep.players??{}).join(', ')}</div>
          </div>
          <div class="episode-play-icon">${ICONS.play}</div>
        </a>`;
    }).join('')}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   PROFILE PAGE — reads ONLY from Session cache → <1s load
   ══════════════════════════════════════════════════════════ */
class ProfileController {
  constructor() { this._dm = new DataManager(); this._sessionChangedBound = false; }

  async init() {
    initNavScroll();
    new AuthController().init();
    this._initTabs();
    this._initEdit();

    /* NON-BLOCKING: show a skeleton/loading state immediately.
       UI renders in <50ms; auth updates arrive reactively. */
    this._renderLoading();

    /* Reactive: react to auth state from the document event bus
       (AuthController dispatches 'authStateChanged' after each onAuth fires
       AND after Session.hydrate completes for signed-in users). */
    if (!this._sessionChangedBound) {
      this._sessionChangedBound = true;

      document.addEventListener('authStateChanged', (e) => {
        const evtUser = e.detail?.user;
        if (!evtUser) {
          this._renderLoggedOut();
        } else {
          this._showProfileUI();
          /* Render from whatever Session state we have now; if hydration
             is in progress, sessionChanged will fire when it completes
             and trigger another _render(). */
          this._render();
        }
      });

      document.addEventListener('sessionChanged', () => {
        if (Session.user) this._render();
      });
    }

    /* If Firebase auth is ALREADY resolved (e.g. persisted session, page
       refresh), trigger initial render without waiting. fb.auth.currentUser
       is read synchronously — no promise, no blocking. */
    const currentUser = fb.auth?.currentUser;
    if (currentUser) {
      this._showProfileUI();
      this._render();
      /* Kick off hydration in the background (no await). sessionChanged
         will fire when done and trigger another _render() with full data. */
      Session.hydrate(currentUser).catch(e => console.warn('[Profile] hydrate:', e.message));
    } else {
      /* If auth hasn't resolved yet, wait for authStateChanged event
         (non-blocking — the listener above handles it when it fires). */
    }
  }

  /* Immediate skeleton while we wait for reactive auth events. */
  _renderLoading() {
    /* Nothing to do — the HTML already has skeleton placeholders for the
       hero and stats. We just ensure the page is visible. */
    const hero = $('#profileHero'); if (hero) hero.style.display = '';
    const tabs = document.querySelector('.profile-tabs'); if (tabs) tabs.style.display = '';
  }

  /* Shows the login prompt WITHOUT destroying the profile DOM.
     Hides profile sections and inserts a login overlay. */
  _renderLoggedOut() {
    const hero = $('#profileHero');
    const tabs = document.querySelector('.profile-tabs');
    const stats = $('#profileStats');
    if (hero)  hero.style.display  = 'none';
    if (tabs)  tabs.style.display  = 'none';
    if (stats) stats.style.display = 'none';
    $$('.profile-panel').forEach(p => { p.style.display = 'none'; });

    const main = $('#profileMain');
    if (!main || main.querySelector('.profile-login-prompt')) return;

    const div = document.createElement('div');
    div.className = 'profile-login-prompt';
    div.innerHTML = `
      <div style="font-size:3rem;margin-bottom:1rem">🔐</div>
      <h2>Καλωσήρθατε!</h2>
      <p>Συνδεθείτε για να δείτε τα αγαπημένα σας, τη watchlist, τα "Έχω δει" και τις αξιολογήσεις σας.</p>
      <button class="btn-primary" id="profileLoginBtn" type="button" style="margin:0 auto">Σύνδεση / Εγγραφή</button>`;
    main.prepend(div);
    main.querySelector('#profileLoginBtn')?.addEventListener('click', () =>
      document.dispatchEvent(new CustomEvent('openAuthModal'))
    );
  }

  /* Removes the login overlay and restores hidden profile DOM elements. */
  _showProfileUI() {
    const hero = $('#profileHero');
    const tabs = document.querySelector('.profile-tabs');
    const stats = $('#profileStats');
    const prompt = document.querySelector('.profile-login-prompt');
    prompt?.remove();
    if (hero)  hero.style.display  = '';
    if (tabs)  tabs.style.display  = '';
    if (stats) stats.style.display = '';
    $$('.profile-panel').forEach(p => { p.style.display = ''; });
  }

  async _render() {
    const user = Session.user;
    if (!user) return;
    const p = Session.profile;
    document.title = `${p.username} — Προφίλ`;

    const avEl = $('#profileAvatar'), imgEl = $('#profileAvatarImg');
    const nmEl = $('#profileUsername'), emEl = $('#profileEmail');
    const init = (p.username?.[0] ?? user.email?.[0] ?? '?').toUpperCase();
    if (avEl) { avEl.textContent = init; avEl.style.display = ''; }
    if (imgEl) {
      const url = p.avatar || user.photoURL || null;
      if (url) { imgEl.src = url; imgEl.hidden = false; if (avEl) avEl.style.display = 'none'; imgEl.onerror = () => { imgEl.hidden = true; if (avEl) avEl.style.display = ''; }; }
      else imgEl.hidden = true;
    }
    if (nmEl) nmEl.textContent = p.username || 'Χρήστης';
    if (emEl) emEl.textContent = user.email || '';

    const st = $('#profileStats');
    if (st) {
      const fc = Session.favorites.size, wc = Session.watchlist.size;
      const sc = Session.seen.size,      rc = Object.keys(Session.ratings).length;
      st.innerHTML = `
        <div class="profile-stat"><span class="profile-stat-num">${fc}</span><span class="profile-stat-label">Αγαπημένα</span></div>
        <div class="profile-stat"><span class="profile-stat-num">${wc}</span><span class="profile-stat-label">Watchlist</span></div>
        <div class="profile-stat"><span class="profile-stat-num">${sc}</span><span class="profile-stat-label">Έχω δει</span></div>
        <div class="profile-stat"><span class="profile-stat-num">${rc}</span><span class="profile-stat-label">Αξιολογήσεις</span></div>`;
    }

    const locals = await this._dm.loadLocalFast();
    const by = Object.fromEntries(locals.map(e => [e.slug, e]));

    this._list('#favoritesGrid', '#favCount', [...Session.favorites], by, '❤️', 'Δεν υπάρχουν αγαπημένα ακόμα.',
      `<a href="./index.html" class="btn-secondary" style="display:inline-flex;margin-top:.5rem">Εξερεύνηση σειρών</a>`);
    this._list('#watchlistGrid', '#watchlistCount', [...Session.watchlist], by, '📌', 'Η watchlist σας είναι άδεια.', '');
    this._list('#seenGrid', '#seenCount', [...Session.seen], by, '✓', 'Δεν έχετε σημειώσει καμία σειρά ως "Έχω δει".', '');
    this._renderRatings('#ratingsGrid', '#ratingsCount', Session.ratings, by);
    this._renderCommentsTab('#commentsGrid', '#commentsCount', user.uid);

    /* Upgrade cards with TMDB posters async */
    this._dm.loadAll().then(full => {
      if (full === locals) return;
      const byFull = Object.fromEntries(full.map(e => [e.slug, e]));
      if (Session.favorites.size) this._list('#favoritesGrid', '#favCount', [...Session.favorites], byFull, '❤️', '', '');
      if (Session.watchlist.size) this._list('#watchlistGrid', '#watchlistCount', [...Session.watchlist], byFull, '📌', '', '');
      if (Session.seen.size)      this._list('#seenGrid', '#seenCount', [...Session.seen], byFull, '✓', '', '');
      if (Object.keys(Session.ratings).length) this._renderRatings('#ratingsGrid', '#ratingsCount', Session.ratings, byFull);
    }).catch(() => {});
  }

  _initTabs() {
    const tabs = $$('.profile-tab'), panels = $$('.profile-panel');
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      panels.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const pn = $(`#panel-${t.dataset.panel}`); if (pn) pn.classList.add('active');
      history.replaceState(null, '', `#${t.dataset.panel}`);
    }));
    const h = location.hash.replace('#', '');
    if (h) { const t = $(`[data-panel="${h}"]`); if (t) t.click(); }
  }

  _initEdit() {
    const btn = $('#profileEditBtn'); if (!btn) return;
    btn.addEventListener('click', () => {
      if (!Session.user || !Session.profile) return;
      const o = document.createElement('div');
      o.className = 'auth-overlay';
      o.innerHTML = `
        <div class="auth-modal">
          <button class="auth-modal-close" id="editClose" aria-label="Κλείσιμο" type="button">✕</button>
          <h3 class="auth-forgot-title">Επεξεργασία Προφίλ</h3>
          <p class="auth-forgot-desc">Ενημερώστε το ψευδώνυμό σας ή το URL του avatar.</p>
          <label style="font-size:.75rem;color:var(--text-4);display:block;margin-bottom:.25rem">Ψευδώνυμο</label>
          <input id="editUsername" type="text" class="auth-input" maxlength="40" value="${escapeHtml(Session.profile.username ?? '')}">
          <label style="font-size:.75rem;color:var(--text-4);display:block;margin-bottom:.25rem;margin-top:.4rem">Avatar URL (προαιρετικό)</label>
          <input id="editAvatar" type="url" class="auth-input" placeholder="https://..." value="${escapeHtml(Session.profile.avatar ?? '')}">
          <p id="editError" class="auth-error" style="display:none"></p>
          <button id="editSave" class="auth-submit-btn" type="button">Αποθήκευση</button>
        </div>`;
      document.body.appendChild(o);
      const close = () => o.remove();
      o.addEventListener('click', e => { if (e.target === o) close(); });
      o.querySelector('#editClose').addEventListener('click', close);
      o.querySelector('#editSave').addEventListener('click', async () => {
        const u = o.querySelector('#editUsername').value.trim();
        const a = o.querySelector('#editAvatar').value.trim();
        const er = o.querySelector('#editError');
        if (!u) { er.textContent = 'Το ψευδώνυμο είναι υποχρεωτικό.'; er.style.display = 'block'; return; }
        if (u.length < 2 || u.length > 40) { er.textContent = '2–40 χαρακτήρες.'; er.style.display = 'block'; return; }
        try {
          await fb.updateUserProfile(Session.user.uid, { username: u, avatar: a || null });
          if (Session.profile) { Session.profile.username = u; Session.profile.avatar = a || null; }
          toast('Ενημερώθηκε!', 'success');
          close();
          setTimeout(() => location.reload(), 400);
        } catch (e) { er.textContent = 'Σφάλμα: ' + e.message; er.style.display = 'block'; }
      });
    });
  }

  _list(gridSel, countSel, slugs, by, icon, emptyMsg, emptyAct) {
    const ce = $(countSel); if (ce) ce.textContent = slugs.length;
    const el = $(gridSel); if (!el) return;
    if (!slugs.length) {
      if (emptyMsg) el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">${icon}</div><p>${escapeHtml(emptyMsg)}</p>${emptyAct}</div>`;
      return;
    }
    const entries = slugs.map(s => by[s]).filter(Boolean);
    if (!entries.length) { el.innerHTML = `<p style="color:var(--text-3);font-size:.9rem">Τα δεδομένα δεν φορτώθηκαν.</p>`; return; }
    el.innerHTML = `<div class="series-grid">${entries.map(renderCard).join('')}</div>`;
    el.querySelectorAll('.series-card[data-slug]').forEach(card => {
      card.addEventListener('click', e => { if (e.target.closest('a')) return; window.location.href = pageUrl('series.html', { id: card.dataset.slug }); });
    });
  }

  _renderRatings(gs, cs, ratings, by) {
    const ce = $(cs), slugs = Object.keys(ratings);
    if (ce) ce.textContent = slugs.length;
    const el = $(gs); if (!el) return;
    if (!slugs.length) { el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">⭐</div><p>Δεν έχετε αξιολογήσει καμία σειρά ακόμα.</p></div>`; return; }
    const items = slugs.map(slug => {
      const e = by[slug], stars = ratings[slug];
      if (!e) return '';
      const poster = e.tmdb?.poster ?? e._posterFallback ?? null;
      return `<a href="${pageUrl('series.html', { id: slug })}" class="rating-item">
          ${poster ? `<img src="${poster}" alt="${escapeHtml(e.title)}" class="rating-poster">` : `<div class="rating-poster-placeholder">${ICONS.film}</div>`}
          <div class="rating-info">
            <div class="rating-title">${escapeHtml(e.title)}</div>
            <div class="rating-stars-display">
              ${[1,2,3,4,5].map(n => `<span class="rating-star${n<=stars?' filled':''}">${ICONS.star}</span>`).join('')}
              <span class="rating-num">${stars}/5</span>
            </div>
          </div>
        </a>`;
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
      el.innerHTML = c.map(x => `
        <div class="comment-item">
          <div class="comment-header">
            <a href="${pageUrl('series.html', { id: x.seriesSlug })}" class="comment-series-link">${escapeHtml(x.seriesSlug)}</a>
            <span class="comment-date">${x.createdAt?.toDate?.()?.toLocaleDateString('el-GR') ?? ''}</span>
          </div>
          <p class="comment-text">${escapeHtml(x.text ?? '')}</p>
        </div>`).join('');
    } catch (e) { el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">💬</div><p>Δεν έχετε γράψει σχόλια ακόμα.</p></div>`; }
  }
}

/* ══════════════════════════════════════════════════════════
   GENRES PAGE
   ══════════════════════════════════════════════════════════ */
class GenresController {
  constructor() { this._dm = new DataManager(); this._all = []; this._active = 'all'; }

  async init() {
    initNavScroll();
    new AuthController().init();
    this._all = await this._dm.loadAll();
    this._renderBar();
    this._applyFilter();
    initCardClicks();
    /* Honor ?genre=X query */
    const qp = new URLSearchParams(location.search).get('genre');
    if (qp) {
      const b = $(`.genre-chip[data-genre="${CSS.escape(qp)}"]`);
      if (b) b.click();
    }
  }

  _renderBar() {
    const bar = $('#genresBar'); if (!bar) return;
    const chips = ['all', ...GREEK_GENRES];
    bar.innerHTML = chips.map(g => {
      const label = g === 'all' ? 'Όλα' : g;
      return `<button class="genre-chip${g===this._active?' active':''}" data-genre="${escapeHtml(g)}" type="button">${escapeHtml(label)}</button>`;
    }).join('');
    bar.addEventListener('click', e => {
      const b = e.target.closest('.genre-chip');
      if (!b) return;
      $$('.genre-chip', bar).forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      this._active = b.dataset.genre;
      this._applyFilter();
    });
  }

  _applyFilter() {
    const results = $('#genresResults'); if (!results) return;
    let filtered;
    if (this._active === 'all') {
      filtered = this._all;
    } else {
      filtered = this._all.filter(e => classifyEntry(e).includes(this._active));
    }
    const countEl = $('#genresCount');
    if (countEl) countEl.textContent = `${filtered.length} σειρ${filtered.length===1?'ά':'ές'}`;
    if (!filtered.length) {
      results.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">🎬</div><p>Δεν βρέθηκαν σειρές για την κατηγορία "${escapeHtml(this._active)}".</p></div>`;
      return;
    }
    results.innerHTML = `<div class="series-grid">${filtered.map(renderCard).join('')}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   NETWORKS PAGE
   ══════════════════════════════════════════════════════════ */
class NetworksController {
  constructor() { this._dm = new DataManager(); this._all = []; this._byNetwork = new Map(); this._selected = null; }

  async init() {
    initNavScroll();
    new AuthController().init();
    this._all = await this._dm.loadAll();
    this._buildNetworkMap();
    this._renderList();
    initCardClicks();
    const qp = new URLSearchParams(location.search).get('network');
    if (qp) this._selectNetwork(qp);
  }

  _buildNetworkMap() {
    this._byNetwork = new Map();
    for (const entry of this._all) {
      const nets = entry.tmdb?.networks?.length
        ? entry.tmdb.networks
        : (entry.tmdb?.productionCompanies ?? []);
      /* Also fallback to data.channel if no TMDB networks */
      const list = nets.length ? nets : [{ id: `ch:${entry.channel}`, name: entry.channel, logo: null }];
      for (const n of list) {
        const key = String(n.id);
        if (!this._byNetwork.has(key)) {
          this._byNetwork.set(key, { id: n.id, name: n.name, logo: n.logo, entries: [] });
        }
        this._byNetwork.get(key).entries.push(entry);
      }
    }
  }

  _renderList() {
    const list = $('#networkList'); if (!list) return;
    const networks = [...this._byNetwork.values()].sort((a, b) => b.entries.length - a.entries.length);
    list.innerHTML = networks.map(n => `
      <button class="network-card" data-id="${escapeHtml(String(n.id))}" type="button">
        ${n.logo ? `<img class="network-logo" src="${n.logo}" alt="${escapeHtml(n.name)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'network-logo-placeholder',innerHTML:'${ICONS.broadcast.replace(/'/g, "\\'")}'}))">` :
          `<div class="network-logo-placeholder">${ICONS.broadcast}</div>`}
        <div class="network-name">${escapeHtml(n.name)}</div>
        <div class="network-count">${n.entries.length} σειρ${n.entries.length===1?'ά':'ές'}</div>
      </button>`).join('');
    list.addEventListener('click', e => {
      const b = e.target.closest('.network-card');
      if (b) this._selectNetwork(b.dataset.id);
    });
  }

  _selectNetwork(id) {
    const net = this._byNetwork.get(String(id));
    if (!net) return;
    this._selected = id;
    const results = $('#networkResults'), list = $('#networkList');
    if (!results || !list) return;
    list.style.display = 'none';
    results.style.display = '';
    results.innerHTML = `
      <div class="network-detail-header">
        <button class="btn-secondary network-back-btn" id="networkBackBtn" type="button">${ICONS.back} Πίσω στα Networks</button>
        <h2 class="network-detail-title">
          ${net.logo ? `<img class="network-detail-logo" src="${net.logo}" alt="${escapeHtml(net.name)}">` : ICONS.broadcast}
          ${escapeHtml(net.name)}
        </h2>
        <span class="network-detail-count">${net.entries.length} σειρ${net.entries.length===1?'ά':'ές'}</span>
      </div>
      <div class="series-grid">${net.entries.map(renderCard).join('')}</div>`;
    $('#networkBackBtn')?.addEventListener('click', () => {
      this._selected = null;
      results.style.display = 'none';
      list.style.display = '';
      history.replaceState(null, '', './networks.html');
    });
    history.replaceState(null, '', `./networks.html?network=${encodeURIComponent(id)}`);
  }
}

/* ══════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════ */
async function router() {
  fb = await loadFirebase();
  /* Initialize central auth manager so getCurrentUser() works globally */
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
      case 'rules':
        initNavScroll();
        new AuthController().init();
        break;
      default: console.warn('[Router] Unknown page:', page);
    }
  } catch (err) {
    console.error('[Router] Page init failed:', err);
    const main = document.querySelector('main, .main-content, #mainContent');
    if (main && !main.children.length) {
      main.innerHTML = `<div style="text-align:center;padding:4rem 2rem;color:var(--text-3)">
          <p style="font-size:2rem;margin-bottom:.5rem">⚠️</p>
          <p>Παρουσιάστηκε σφάλμα. Ανανεώστε τη σελίδα.</p>
          <button onclick="location.reload()" style="margin-top:1rem;padding:.6rem 1.5rem;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer">Ανανέωση</button>
        </div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', router, { once: true });
} else {
  router();
}
