/* ============================================================
   app.js — StreamVault Main Application  v3.0  FIXED
   ─────────────────────────────────────────────────────────────
   CRITICAL FIXES vs v2.x:
   ① Auth nav uses data-state attribute on #authNavWrap instead
      of .hidden (which was being overridden by
      .nav-login-btn { display: inline-flex } — same specificity,
      author rule wins → double-state bug)
   ② Initial render hides BOTH states until onAuth fires once
      (no flicker of "Σύνδεση" before avatar mounts)
   ③ Static singleton + unsubscribe guard in AuthController
      (no duplicate onAuth listeners on SPA re-navigation)
   ④ Avatar image support (user.photoURL) in navbar + comments
   ⑤ "Έχω δει" button on series page + profile tab
   ⑥ Profile edit (username + avatar URL)
   ⑦ Comments include avatar
   ============================================================ */

import { tmdb } from './tmdb.js';

/* ═══════════════════════════════════════════════════════════
   FIREBASE — dynamic import with fallback stubs
   ═══════════════════════════════════════════════════════════ */
let fb = null;

function _createFirebaseStubs() {
  const _notAvail = () => Promise.reject(new Error('Firebase non διαθέσιμο. Ελέγξτε τη σύνδεση.'));
  return {
    auth:              null,
    db:                null,
    loginWithGoogle:   _notAvail,
    loginWithEmail:    _notAvail,
    registerWithEmail: _notAvail,
    forgotPassword:    _notAvail,
    logout:            _notAvail,
    onAuth:            (cb) => { cb(null); return () => {}; },
    getUserProfile:    async () => null,
    updateUserProfile: _notAvail,
    toggleFavorite:    _notAvail,
    toggleWatchlist:   _notAvail,
    toggleSeen:        _notAvail,
    setRating:         _notAvail,
    getRating:         async () => 0,
    getAllRatings:     async () => ({}),
    postComment:       _notAvail,
    getComments:       async () => [],
    getUserComments:   async () => [],
    likeComment:       _notAvail,
    dislikeComment:    _notAvail,
  };
}

async function loadFirebase() {
  try {
    const loaded = await Promise.race([
      import('./firebase.js'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firebase timeout')), 8000)
      ),
    ]);
    return loaded;
  } catch (err) {
    console.warn('[App] Firebase unavailable:', err.message);
    return _createFirebaseStubs();
  }
}

/* ── Utils ─────────────────────────────────────────────── */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
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
    const k = item[key] ?? 'Άλλα';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function pageUrl(page, params = {}) {
  const url = new URL(page, window.location.href);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.href;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg, type = 'info') {
  let container = $('#toast-container');
  if (!container) {
    container = Object.assign(document.createElement('div'), {
      id: 'toast-container',
      className: 'toast-container',
    });
    document.body.appendChild(container);
  }
  const el = Object.assign(document.createElement('div'), {
    className: `toast toast-${type}`,
    textContent: msg,
  });
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => { el.classList.remove('toast-show'); setTimeout(() => el.remove(), 400); }, 3600);
}

/* ── Auth state ─────────────────────────────────────────── */
let _currentUser    = null;
let _currentProfile = null;

const BASE_URL = (() => {
  try { return new URL('../../', import.meta.url).href; }
  catch (e) { return '/'; }
})();

/* ── SVG Icons ──────────────────────────────────────────── */
const ICONS = {
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
  check:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
  user:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  edit:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  thumbUp:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`,
  thumbDown:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`,
};

/* ══════════════════════════════════════════════════════════
   AUTH CONTROLLER v3.0 — FIXED
   ─────────────────────────────────────────────────────────
   ROOT CAUSES FIXED:
     (a) .hidden attr was overridden by .nav-login-btn { display:
         inline-flex } (equal specificity, author rule wins).
         Now uses data-state attribute with higher-specificity
         id-scoped CSS + !important.
     (b) Flash of "Σύνδεση" before Firebase hydrates. Now initial
         state is "pending" → both hidden until first onAuth fires.
     (c) Duplicate onAuth listeners on multi-controller init.
         Static singleton pattern.
   ══════════════════════════════════════════════════════════ */
class AuthController {
  static _instance    = null;
  static _unsubscribe = null;

  constructor() {
    this._modal    = null;
    this._tab      = 'login';
    this.$wrap     = null;
    this.$loginBtn = null;
    this.$userMenu = null;
    this.$initials = null;
    this.$avatarImg= null;
    this.$username = null;
    this.$dropdown = null;
    this.$avatarBtn= null;
  }

  init() {
    /* Singleton guard — only one live AuthController per page */
    if (AuthController._instance) return AuthController._instance;
    AuthController._instance = this;

    this._injectNavUI();

    /* Unsubscribe any prior onAuth listener (defensive) */
    if (typeof AuthController._unsubscribe === 'function') {
      try { AuthController._unsubscribe(); } catch (_) {}
    }

    AuthController._unsubscribe = fb.onAuth(async (user) => {
      _currentUser = user;

      if (user) {
        /* Phase 1 — INSTANT UI update from Firebase user obj */
        const quickName = user.displayName
          || user.email?.split('@')[0]
          || '?';
        this._setLoggedIn(quickName, user.photoURL ?? null);

        /* Phase 2 — Enhance with Firestore profile (non-blocking) */
        try {
          _currentProfile = await fb.getUserProfile(user.uid);
          if (_currentProfile) {
            this._setLoggedIn(
              _currentProfile.username || quickName,
              _currentProfile.avatar || user.photoURL || null
            );
          }
        } catch (e) {
          console.warn('[AuthController] getUserProfile:', e.message);
        }
      } else {
        _currentProfile = null;
        this._setLoggedOut();
      }

      document.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { user, profile: _currentProfile },
      }));
    });

    document.addEventListener('openAuthModal', () => this._openModal());

    return this;
  }

  /* ── DOM Injection ─────────────────────────────────────── */
  _injectNavUI() {
    const actions = document.getElementById('nav-actions');
    if (!actions) return;

    /* Guard: remove previous wrap */
    document.getElementById('authNavWrap')?.remove();

    const wrap = document.createElement('div');
    wrap.id        = 'authNavWrap';
    wrap.className = 'auth-nav-wrap';
    wrap.dataset.state = 'pending';   /* starts hidden → prevents flicker */
    wrap.innerHTML = `
      <button id="navLoginBtn" class="nav-login-btn" type="button">Σύνδεση</button>

      <div id="navUserMenu" class="nav-user-menu">

        <button class="nav-avatar-btn" id="navAvatarBtn" type="button"
                aria-label="Μενού χρήστη" aria-expanded="false">
          <img id="navAvatarImg" class="nav-avatar-img" alt="" hidden>
          <span class="nav-avatar-initials" id="navAvatarInitials">?</span>
        </button>

        <div class="nav-dropdown" id="navDropdown" role="menu">
          <div class="nav-dropdown-header">
            <span class="nav-dropdown-username" id="navDropdownUsername"></span>
          </div>
          <a class="nav-dropdown-item" href="./profile.html" role="menuitem">
            ${ICONS.user} Προφίλ
          </a>
          <a class="nav-dropdown-item" href="./profile.html#favorites" role="menuitem">
            ${ICONS.heart} Αγαπημένα
          </a>
          <a class="nav-dropdown-item" href="./profile.html#watchlist" role="menuitem">
            ${ICONS.bookmark} Watchlist
          </a>
          <a class="nav-dropdown-item" href="./profile.html#seen" role="menuitem">
            ${ICONS.check} Έχω δει
          </a>
          <a class="nav-dropdown-item" href="./profile.html#ratings" role="menuitem">
            ${ICONS.star} Αξιολογήσεις
          </a>
          <div class="nav-dropdown-divider"></div>
          <button class="nav-dropdown-item nav-dropdown-logout"
                  id="navLogoutBtn" role="menuitem" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" width="15" height="15">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Αποσύνδεση
          </button>
        </div>
      </div>`;

    actions.appendChild(wrap);

    /* Element refs — single source of truth */
    this.$wrap      = wrap;
    this.$loginBtn  = wrap.querySelector('#navLoginBtn');
    this.$userMenu  = wrap.querySelector('#navUserMenu');
    this.$initials  = wrap.querySelector('#navAvatarInitials');
    this.$avatarImg = wrap.querySelector('#navAvatarImg');
    this.$username  = wrap.querySelector('#navDropdownUsername');
    this.$dropdown  = wrap.querySelector('#navDropdown');
    this.$avatarBtn = wrap.querySelector('#navAvatarBtn');

    this.$loginBtn.addEventListener('click', () => this._openModal());

    this.$avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = this.$dropdown.classList.toggle('open');
      this.$avatarBtn.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('click', (e) => {
      if (this.$wrap && !this.$wrap.contains(e.target)) {
        this.$dropdown?.classList.remove('open');
        this.$avatarBtn?.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.$dropdown?.classList.remove('open');
        this.$avatarBtn?.setAttribute('aria-expanded', 'false');
      }
    });

    wrap.querySelector('#navLogoutBtn').addEventListener('click', async () => {
      this.$dropdown?.classList.remove('open');
      try {
        await fb.logout();
        toast('Αποσυνδεθήκατε.', 'info');
      } catch (e) {
        toast('Σφάλμα αποσύνδεσης: ' + e.message, 'error');
      }
    });
  }

  /* ── UI State: Logged IN ───────────────────────────────── */
  _setLoggedIn(name, avatarUrl = null) {
    if (!this.$wrap) return;
    this.$wrap.dataset.state = 'loggedIn';

    const display = String(name || '?');
    this.$initials.textContent = display.charAt(0).toUpperCase();
    this.$username.textContent = display;

    if (avatarUrl) {
      this.$avatarImg.src = avatarUrl;
      this.$avatarImg.alt = display;
      this.$avatarImg.hidden = false;
      this.$initials.style.display = 'none';
      this.$avatarImg.onerror = () => {
        this.$avatarImg.hidden = true;
        this.$initials.style.display = '';
      };
    } else {
      this.$avatarImg.hidden = true;
      this.$avatarImg.src = '';
      this.$initials.style.display = '';
    }
  }

  /* ── UI State: Logged OUT ──────────────────────────────── */
  _setLoggedOut() {
    if (!this.$wrap) return;
    this.$wrap.dataset.state = 'loggedOut';
    this.$dropdown?.classList.remove('open');
    this.$avatarBtn?.setAttribute('aria-expanded', 'false');
  }

  /* ══════════════════════════════════════════════════════════
     AUTH MODAL
     ══════════════════════════════════════════════════════════ */
  _openModal(tab = 'login') {
    this._tab = tab;
    this._modal?.remove();

    const overlay = document.createElement('div');
    overlay.id        = 'authModal';
    overlay.className = 'auth-overlay';
    overlay.innerHTML = this._buildModalHTML(tab);
    document.body.appendChild(overlay);
    this._modal = overlay;

    this._wireModal(overlay);
  }

  _buildModalHTML(tab) {
    const isLogin    = tab === 'login';
    const isRegister = tab === 'register';
    const isForgot   = tab === 'forgot';

    return `
      <div class="auth-modal">
        <button class="auth-modal-close" id="authClose" aria-label="Κλείσιμο" type="button">✕</button>

        ${!isForgot ? `
        <div class="auth-tabs">
          <button class="auth-tab${isLogin    ? ' auth-tab-active' : ''}" data-tab="login" type="button">Σύνδεση</button>
          <button class="auth-tab${isRegister ? ' auth-tab-active' : ''}" data-tab="register" type="button">Εγγραφή</button>
        </div>

        <button id="googleSignIn" class="auth-google-btn" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26
              1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23
              1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07
              H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09
              14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Συνέχεια με Google
        </button>

        <div class="auth-divider"><span>ή με email</span></div>

        <div id="authFormWrap">
          ${isRegister
            ? `<input id="authUsername" type="text" placeholder="Ψευδώνυμο"
                      autocomplete="username" class="auth-input">`
            : ''}
          <input id="authEmail" type="email" placeholder="Email"
                 autocomplete="email" class="auth-input">
          <input id="authPassword" type="password" placeholder="Κωδικός"
                 autocomplete="${isLogin ? 'current-password' : 'new-password'}"
                 class="auth-input">
          <p id="authError" class="auth-error" style="display:none"></p>
          <button id="authSubmit" class="auth-submit-btn" type="button">
            ${isLogin ? 'Σύνδεση' : 'Δημιουργία Λογαριασμού'}
          </button>
          ${isLogin
            ? `<button class="auth-forgot-link" id="authForgotLink" type="button">
                 Ξεχάσατε τον κωδικό;
               </button>`
            : ''}
        </div>

        ` : `
        <div class="auth-forgot-view">
          <h3 class="auth-forgot-title">Επαναφορά Κωδικού</h3>
          <p class="auth-forgot-desc">
            Εισάγετε το email σας και θα σας στείλουμε σύνδεσμο επαναφοράς.
          </p>
          <input id="forgotEmail" type="email" placeholder="Email"
                 autocomplete="email" class="auth-input">
          <p id="forgotError"   class="auth-error"   style="display:none"></p>
          <p id="forgotSuccess" class="auth-success" style="display:none"></p>
          <button id="forgotSubmit" class="auth-submit-btn" type="button">Αποστολή Email</button>
          <button class="auth-forgot-link" id="backToLogin" type="button">← Πίσω στη Σύνδεση</button>
        </div>
        `}
      </div>`;
  }

  _wireModal(overlay) {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#authClose')?.addEventListener('click', () => overlay.remove());

    overlay.querySelectorAll('.auth-tab').forEach(btn => {
      btn.addEventListener('click', () => this._openModal(btn.dataset.tab));
    });

    overlay.querySelector('#authForgotLink')?.addEventListener('click', () => this._openModal('forgot'));
    overlay.querySelector('#backToLogin')?.addEventListener('click',    () => this._openModal('login'));

    overlay.querySelector('#googleSignIn')?.addEventListener('click', async () => {
      try {
        await fb.loginWithGoogle();
        overlay.remove();
        toast('Συνδεθήκατε με Google! 🎉', 'success');
      } catch (e) {
        this._showError(this._mapError(e));
      }
    });

    overlay.querySelector('#authSubmit')?.addEventListener('click', async () => {
      const email    = overlay.querySelector('#authEmail')?.value?.trim();
      const password = overlay.querySelector('#authPassword')?.value;
      const username = overlay.querySelector('#authUsername')?.value?.trim();

      if (!email || !password) {
        this._showError('Συμπληρώστε email και κωδικό.');
        return;
      }

      try {
        if (this._tab === 'register') {
          if (!username) { this._showError('Συμπληρώστε ψευδώνυμο.'); return; }
          await fb.registerWithEmail(email, password, username);
          toast('Καλωσήρθατε! Ο λογαριασμός σας δημιουργήθηκε. 🎉', 'success');
        } else {
          await fb.loginWithEmail(email, password);
          toast('Συνδεθήκατε!', 'success');
        }
        overlay.remove();
      } catch (e) {
        this._showError(this._mapError(e));
      }
    });

    overlay.querySelector('#forgotSubmit')?.addEventListener('click', async () => {
      const email = overlay.querySelector('#forgotEmail')?.value?.trim();
      if (!email) { this._showForgotError('Εισάγετε το email σας.'); return; }
      try {
        await fb.forgotPassword(email);
        const s = overlay.querySelector('#forgotSuccess');
        const err = overlay.querySelector('#forgotError');
        if (s)   { s.textContent = `Στάλθηκε email επαναφοράς στο ${email}!`; s.style.display = 'block'; }
        if (err) { err.style.display = 'none'; }
      } catch (e) {
        this._showForgotError(this._mapError(e));
      }
    });

    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        overlay.querySelector('#authSubmit')?.click();
        overlay.querySelector('#forgotSubmit')?.click();
      }
      if (e.key === 'Escape') overlay.remove();
    });
  }

  _mapError(e) {
    const map = {
      'auth/user-not-found':       'Δεν βρέθηκε χρήστης με αυτό το email.',
      'auth/wrong-password':       'Λανθασμένος κωδικός.',
      'auth/invalid-credential':   'Λανθασμένο email ή κωδικός.',
      'auth/email-already-in-use': 'Το email χρησιμοποιείται ήδη.',
      'auth/weak-password':        'Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.',
      'auth/invalid-email':        'Μη έγκυρο email.',
      'auth/too-many-requests':    'Πολλές αποτυχημένες προσπάθειες. Δοκιμάστε αργότερα.',
    };
    return map[e.code] ?? e.message;
  }

  _showError(msg) {
    const el = this._modal?.querySelector('#authError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  _showForgotError(msg) {
    const el = this._modal?.querySelector('#forgotError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
}


/* ══════════════════════════════════════════════════════════
   DATA MANAGER  (unchanged from v2 — stable)
   ══════════════════════════════════════════════════════════ */
class DataManager {
  constructor() {
    this._raw       = null;
    this._localAll  = null;
    this._rich      = null;
  }

  async _loadRaw() {
    if (this._raw) return this._raw;
    try {
      const res = await fetch(`${BASE_URL}data/series.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._raw = await res.json();
      if (typeof this._raw !== 'object' || Array.isArray(this._raw)) {
        throw new Error('Invalid JSON format');
      }
      return this._raw;
    } catch (err) {
      console.error('[DataManager] loadRaw:', err.message);
      this._raw = {};
      return this._raw;
    }
  }

  _buildLocalEntries(raw) {
    return Object.entries(raw).map(([slug, data]) => ({
      slug, data, tmdb: null,
      title:    data.title    ?? data.title_fallback ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      overview: data.overview ?? '',
      channel:  data.channel  ?? 'Unknown',
      _posterFallback:   data.poster_fallback   ?? null,
      _backdropFallback: data.backdrop_fallback ?? null,
    }));
  }

  _mergeWithTMDB(localEntries, tmdbResults) {
    const tmdbMap = new Map(tmdbResults.map(e => [e.slug, e.tmdb]));
    return localEntries.map(local => {
      const t = tmdbMap.get(local.slug) ?? null;
      return {
        ...local, tmdb: t,
        title:    local.data.title    ?? t?.title    ?? local.title,
        overview: local.data.overview ?? t?.overview ?? local.overview,
        channel:  local.data.channel  ?? 'Unknown',
      };
    });
  }

  async loadAll() {
    if (this._rich) return this._rich;
    const raw = await this._loadRaw();
    if (!Object.keys(raw).length) { this._rich = []; return this._rich; }

    this._localAll = this._buildLocalEntries(raw);
    try {
      const entries = Object.entries(raw).map(([slug, data]) => ({ slug, data }));
      const tmdbResults = await Promise.race([
        tmdb.batchResolve(entries),
        new Promise(resolve => setTimeout(() => resolve(null), 8000)),
      ]);
      this._rich = (tmdbResults && tmdbResults.length > 0)
        ? this._mergeWithTMDB(this._localAll, tmdbResults)
        : this._localAll;
    } catch (err) {
      console.warn('[DataManager] TMDB enrichment failed:', err.message);
      this._rich = this._localAll;
    }
    return this._rich;
  }

  async getOne(slug) {
    const raw = await this._loadRaw();
    const data = raw[slug];
    if (!data) return null;

    const local = {
      slug, data, tmdb: null,
      title:    data.title    ?? data.title_fallback ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      overview: data.overview ?? '',
      channel:  data.channel  ?? 'Unknown',
      _posterFallback:   data.poster_fallback   ?? null,
      _backdropFallback: data.backdrop_fallback ?? null,
    };

    try {
      const t = await Promise.race([
        tmdb.getDetails(data),
        new Promise(resolve => setTimeout(() => resolve(null), 6000)),
      ]);
      if (t) {
        return {
          ...local, tmdb: t,
          title:    data.title    ?? t.title    ?? local.title,
          overview: data.overview ?? t.overview ?? local.overview,
        };
      }
    } catch (err) {
      console.warn('[DataManager] getOne TMDB failed:', err.message);
    }
    return local;
  }
}

/* ══════════════════════════════════════════════════════════
   CARD RENDERER  (unchanged)
   ══════════════════════════════════════════════════════════ */
function renderCard(entry) {
  const { slug, title, channel, tmdb: t, _posterFallback } = entry;
  const poster  = t?.poster ?? _posterFallback ?? null;
  const year    = t?.year   ?? entry.data?.year    ?? '';
  const rating  = t?.rating ?? '';
  const watchUrl= pageUrl('watch.html', { series: slug, season: 1, ep: 1 });
  const genres  = (t?.genres ?? entry.data?.genres ?? []).slice(0, 2);

  const posterHtml = poster
    ? `<img class="card-poster" src="${poster}" alt="${title}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const placeholderHtml = `<div class="card-no-poster" style="${poster ? 'display:none' : ''}">${ICONS.film}<span>${title}</span></div>`;

  return `
    <div class="series-card" data-slug="${slug}"
         data-title="${title.toLowerCase()}"
         data-channel="${channel.toLowerCase()}"
         data-genres="${genres.join(',').toLowerCase()}">
      ${posterHtml}${placeholderHtml}
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

function observeSections() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: 0.06 });
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
    if (!row) return;
    $('.row-arrow.left',  wrapper)?.addEventListener('click', () => row.scrollBy({ left: -row.clientWidth * 0.75, behavior: 'smooth' }));
    $('.row-arrow.right', wrapper)?.addEventListener('click', () => row.scrollBy({ left:  row.clientWidth * 0.75, behavior: 'smooth' }));
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

  _open()  {
    this._overlay?.classList.add('active');
    setTimeout(() => this._input?.focus(), 50);
  }
  _close() {
    this._overlay?.classList.remove('active');
    if (this._input)   this._input.value   = '';
    if (this._results) this._results.innerHTML = '';
  }

  _run() {
    const q = this._input?.value?.trim().toLowerCase() ?? '';
    if (!q) { if (this._results) this._results.innerHTML = ''; return; }
    const matches = this._all.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.channel.toLowerCase().includes(q) ||
      (e.tmdb?.genres ?? e.data?.genres ?? []).join(' ').toLowerCase().includes(q)
    );
    this._results.innerHTML = matches.length
      ? `<div class="series-grid">${matches.map(renderCard).join('')}</div>`
      : `<div class="search-empty">${ICONS.search}<p>Δεν βρέθηκαν αποτελέσματα για "<strong>${q}</strong>"</p></div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   HOMEPAGE CONTROLLER
   ══════════════════════════════════════════════════════════ */
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

    if (!this._all.length) {
      const sections = $('#sections');
      if (sections) sections.innerHTML = `
        <div style="text-align:center;padding:4rem 2rem;color:var(--text-3)">
          <p style="font-size:1.1rem;margin-bottom:.5rem">Δεν ήταν δυνατή η φόρτωση περιεχομένου.</p>
          <p style="font-size:.85rem">Ελέγξτε τη σύνδεσή σας και ανανεώστε τη σελίδα.</p>
        </div>`;
      return;
    }

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
      const btn = Object.assign(document.createElement('button'), {
        className:   'category-chip',
        textContent: ch,
      });
      btn.dataset.channel = ch.toLowerCase();
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
    const recent   = [...this._all].reverse().slice(0, 12);
    const random   = shuffle(this._all).filter(e => !featured.find(f => f.slug === e.slug)).slice(0, 10);

    let html = '';
    if (featured.length) html += buildSection('Προτεινόμενες', featured, 'row');
    html += buildSection('Πρόσφατες Αναρτήσεις', recent, 'row');
    if (random.length)   html += buildSection('Τυχαίες Επιλογές', random, 'row');

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
    const { title, channel, tmdb: t, _backdropFallback, _posterFallback } = entry;

    const bg = $('#heroBg');
    if (bg) {
      const img = t?.backdrop ?? t?.posterLg ?? _backdropFallback ?? _posterFallback ?? '';
      bg.style.backgroundImage = img ? `url('${img}')` : '';
    }

    const content = $('#heroContent');
    if (content) {
      const year    = t?.year    ?? entry.data?.year    ?? '';
      const rating  = t?.rating  ?? '';
      const seasons = t?.seasons ?? null;
      const genres  = (t?.genres ?? entry.data?.genres ?? []).slice(0, 3);
      const desc    = entry.overview ?? '';

      content.innerHTML = `
        <div class="hero-channel">${channel}</div>
        <h1 class="hero-title">${title}</h1>
        <div class="hero-meta">
          ${year    ? `<span>${year}</span>`                              : ''}
          ${rating  ? `<span class="hero-rating">${ICONS.star} ${rating}</span>` : ''}
          ${seasons ? `<span>${seasons} Σεζόν</span>`                    : ''}
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

/* ══════════════════════════════════════════════════════════
   STAR RATING WIDGET
   ══════════════════════════════════════════════════════════ */
function renderStarRating(container, slug, currentRating = 0) {
  container.innerHTML = `
    <div class="star-rating" data-slug="${slug}">
      ${[1,2,3,4,5].map(n => `
        <button class="star-btn${n <= currentRating ? ' active' : ''}" data-star="${n}" title="${n} αστέρ${n===1?'ι':'ια'}" type="button">
          ${ICONS.star}
        </button>`).join('')}
      <span class="star-label">${currentRating ? `${currentRating}/5` : 'Αξιολόγησε'}</span>
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
      try {
        await fb.setRating(_currentUser.uid, slug, stars);
        renderStarRating(container, slug, stars);
        toast(`Αξιολόγηση: ${stars}/5 ★`, 'success');
      } catch (e) { toast('Σφάλμα αξιολόγησης.', 'error'); }
    });
  });
}

/* ══════════════════════════════════════════════════════════
   COMMENTS WIDGET — now with avatars
   ══════════════════════════════════════════════════════════ */
function _commentAvatar(c) {
  const initial = (c.username?.[0] ?? '?').toUpperCase();
  if (c.userAvatar) {
    return `<img class="comment-avatar-img" src="${escapeHtml(c.userAvatar)}" alt="${escapeHtml(c.username ?? '')}"
                 onerror="this.outerHTML='<span class=&quot;comment-avatar-initials&quot;>${escapeHtml(initial)}</span>'">`;
  }
  return `<span class="comment-avatar-initials">${escapeHtml(initial)}</span>`;
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
            <strong class="comment-user">${escapeHtml(c.username ?? 'Ανώνυμος')}</strong>
            <span class="comment-date">${date}</span>
          </div>
          <p class="comment-text">${escapeHtml(c.text ?? '')}</p>
          <div class="comment-actions">
            <button class="comment-action-btn like-btn" data-id="${c.id}" data-slug="${slug}" type="button">
              ${ICONS.thumbUp} <span>${c.likes ?? 0}</span>
            </button>
            <button class="comment-action-btn dislike-btn" data-id="${c.id}" data-slug="${slug}" type="button">
              ${ICONS.thumbDown} <span>${c.dislikes ?? 0}</span>
            </button>
          </div>
        </div>`;
      }).join('')
    : '<p class="comments-empty">Δεν υπάρχουν σχόλια ακόμα. Γίνετε οι πρώτοι!</p>';

  const isLoggedIn = !!_currentUser;
  container.innerHTML = `
    <div class="comments-section">
      <h3 class="comments-title">💬 Σχόλια${comments.length ? ` <span class="count-badge">${comments.length}</span>` : ''}</h3>

      ${isLoggedIn
        ? `<div class="comment-input-wrap" id="commentInputWrap">
            <textarea id="commentText" placeholder="Γράψτε ένα σχόλιο…" rows="3" class="comment-textarea" maxlength="2000"></textarea>
            <button id="commentSubmit" class="comment-submit-btn" type="button">Δημοσίευση</button>
          </div>`
        : `<div class="comment-login-notice">
            <p>Πρέπει να <button class="comment-login-link" id="commentLoginBtn" type="button">συνδεθείτε</button> για να σχολιάσετε.</p>
          </div>`
      }

      <div class="comments-list">${listHtml}</div>
    </div>`;

  container.querySelector('#commentLoginBtn')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('openAuthModal'));
  });

  container.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_currentUser) { toast('Συνδεθείτε για να αξιολογήσετε σχόλια.', 'info'); return; }
      await fb.likeComment(btn.dataset.slug, btn.dataset.id);
      await renderComments(container, slug);
    });
  });
  container.querySelectorAll('.dislike-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_currentUser) { toast('Συνδεθείτε για να αξιολογήσετε σχόλια.', 'info'); return; }
      await fb.dislikeComment(btn.dataset.slug, btn.dataset.id);
      await renderComments(container, slug);
    });
  });

  container.querySelector('#commentSubmit')?.addEventListener('click', async () => {
    const text = container.querySelector('#commentText')?.value?.trim();
    if (!text) { toast('Γράψτε κάτι πρώτα.', 'info'); return; }
    if (!_currentUser) { toast('Συνδεθείτε πρώτα.', 'info'); return; }
    try {
      const username = _currentProfile?.username
        ?? _currentUser.displayName
        ?? _currentUser.email?.split('@')[0]
        ?? 'Ανώνυμος';
      const avatar = _currentProfile?.avatar ?? _currentUser.photoURL ?? null;
      await fb.postComment(slug, _currentUser.uid, username, text, avatar);
      container.querySelector('#commentText').value = '';
      await renderComments(container, slug);
      toast('Το σχόλιο δημοσιεύτηκε!', 'success');
    } catch (e) { toast('Σφάλμα δημοσίευσης σχολίου.', 'error'); }
  });
}

/* ══════════════════════════════════════════════════════════
   SERIES PAGE CONTROLLER — now with Watchlist + Seen
   ══════════════════════════════════════════════════════════ */
class SeriesController {
  constructor() {
    this._dm = new DataManager();
    this._authListener = null;
  }

  async init() {
    initNavScroll();
    new AuthController().init();

    const slug = new URLSearchParams(window.location.search).get('id');
    if (!slug) { window.location.href = pageUrl('index.html'); return; }

    const entry = await this._dm.getOne(slug);
    if (!entry) {
      toast('Η σειρά δεν βρέθηκε.', 'error');
      setTimeout(() => window.location.href = pageUrl('index.html'), 2000);
      return;
    }

    document.title = `${entry.title} — StreamVault`;
    await this._render(entry);
    initCardClicks();
  }

  async _render(entry) {
    const { slug, title, channel, tmdb: t, data, _backdropFallback, _posterFallback } = entry;

    const backdropEl = $('#seriesBackdrop');
    if (backdropEl) {
      const img = t?.backdrop ?? t?.posterLg ?? _backdropFallback ?? '';
      if (img) backdropEl.style.backgroundImage = `url('${img}')`;
    }

    const posterEl = $('#seriesPoster');
    if (posterEl) {
      const src = t?.posterLg ?? _posterFallback ?? null;
      posterEl.innerHTML = src
        ? `<img src="${src}" alt="${escapeHtml(title)}" onerror="this.parentElement.innerHTML='<div class=\\'no-poster\\'>${ICONS.film}</div>'">`
        : `<div class="no-poster">${ICONS.film}</div>`;
    }

    const channelEl = $('#seriesChannelBadge'); if (channelEl) channelEl.textContent = channel;
    const titleEl   = $('#seriesTitle');        if (titleEl)   titleEl.textContent   = title;

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
    if (genresEl) {
      const genres = t?.genres ?? data.genres ?? [];
      if (genres.length) genresEl.innerHTML = genres.map(g => `<span class="genre-tag">${g}</span>`).join('');
    }

    const overviewEl = $('#seriesOverview');
    if (overviewEl) overviewEl.textContent = entry.overview || 'Δεν υπάρχει διαθέσιμη περιγραφή.';

    /* ── CTA buttons: Watch + Back + Favorites + Watchlist + Seen ── */
    const ctaEl = $('#seriesCta');
    if (ctaEl) {
      ctaEl.innerHTML = `
        <a href="${pageUrl('watch.html', { series: slug, season: 1, ep: 1 })}" class="btn-primary">
          ${ICONS.play} Δείτε Τώρα
        </a>
        <a href="${pageUrl('index.html')}" class="btn-secondary">
          ${ICONS.back} Αρχική
        </a>
        <button id="favBtn" class="btn-secondary user-action-btn" type="button">
          ${ICONS.heart} <span id="favLabel">Αγαπημένα</span>
        </button>
        <button id="watchlistBtn" class="btn-secondary user-action-btn" type="button">
          ${ICONS.bookmark} <span id="watchlistLabel">Watchlist</span>
        </button>
        <button id="seenBtn" class="btn-secondary user-action-btn" type="button">
          ${ICONS.check} <span id="seenLabel">Έχω δει</span>
        </button>`;
    }

    const ratingWrap = $('#seriesRatingWrap');
    if (ratingWrap) {
      const current = _currentUser ? await fb.getRating(_currentUser.uid, slug).catch(() => 0) : 0;
      renderStarRating(ratingWrap, slug, current);
    }

    /* ── Update button states from profile ── */
    const updateUserBtns = async () => {
      const favBtn  = $('#favBtn');
      const watchBtn= $('#watchlistBtn');
      const seenBtn = $('#seenBtn');
      const fl = $('#favLabel');
      const wl = $('#watchlistLabel');
      const sl = $('#seenLabel');

      if (!_currentUser) {
        if (fl) fl.textContent = 'Αγαπημένα';
        if (wl) wl.textContent = 'Watchlist';
        if (sl) sl.textContent = 'Έχω δει';
        [favBtn, watchBtn, seenBtn].forEach(b => b?.classList.remove('active'));
        return;
      }
      try {
        const profile = await fb.getUserProfile(_currentUser.uid);
        const isFav   = profile?.favorites?.includes(slug);
        const isWatch = profile?.watchlist?.includes(slug);
        const isSeen  = profile?.watched?.includes(slug);
        if (fl) fl.textContent = isFav   ? '❤️ Αφαίρεση'  : 'Αγαπημένα';
        if (wl) wl.textContent = isWatch ? '📌 Στη λίστα' : 'Watchlist';
        if (sl) sl.textContent = isSeen  ? '✓ Το είδα'    : 'Έχω δει';
        favBtn  ?.classList.toggle('active', !!isFav);
        watchBtn?.classList.toggle('active', !!isWatch);
        seenBtn ?.classList.toggle('active', !!isSeen);
      } catch (_) {}
    };

    /* Remove prior listener if re-rendering (defensive) */
    if (this._authListener) {
      document.removeEventListener('authStateChanged', this._authListener);
    }
    this._authListener = updateUserBtns;
    document.addEventListener('authStateChanged', updateUserBtns);
    await updateUserBtns();

    $('#favBtn')?.addEventListener('click', async () => {
      if (!_currentUser) { toast('Συνδεθείτε για να αποθηκεύσετε αγαπημένα.', 'info'); return; }
      try {
        const added = await fb.toggleFavorite(_currentUser.uid, slug);
        toast(added ? '❤️ Προστέθηκε στα αγαπημένα!' : 'Αφαιρέθηκε από τα αγαπημένα.', 'success');
        await updateUserBtns();
      } catch (e) { toast(e.message, 'error'); }
    });

    $('#watchlistBtn')?.addEventListener('click', async () => {
      if (!_currentUser) { toast('Συνδεθείτε για να αποθηκεύσετε στη λίστα.', 'info'); return; }
      try {
        const added = await fb.toggleWatchlist(_currentUser.uid, slug);
        toast(added ? '📌 Προστέθηκε στη watchlist!' : 'Αφαιρέθηκε από τη watchlist.', 'success');
        await updateUserBtns();
      } catch (e) { toast(e.message, 'error'); }
    });

    $('#seenBtn')?.addEventListener('click', async () => {
      if (!_currentUser) { toast('Συνδεθείτε για να σημειώσετε σειρές.', 'info'); return; }
      try {
        const added = await fb.toggleSeen(_currentUser.uid, slug);
        toast(added ? '✓ Σημειώθηκε ως "Έχω δει"!' : 'Αφαιρέθηκε από τα "Έχω δει".', 'success');
        await updateUserBtns();
      } catch (e) { toast(e.message, 'error'); }
    });

    this._renderEpisodes(slug, data.episodes ?? []);

    const commentsEl = $('#seriesComments');
    if (commentsEl) {
      await renderComments(commentsEl, slug);
      document.addEventListener('authStateChanged', async () => {
        await renderComments(commentsEl, slug);
      });
    }
  }

  _renderEpisodes(slug, episodes) {
    const container = $('#episodesContainer');
    if (!container) return;
    if (!episodes.length) {
      container.innerHTML = '<p style="color:var(--text-3)">Δεν βρέθηκαν επεισόδια.</p>';
      return;
    }
    const bySeason  = {};
    episodes.forEach(ep => { (bySeason[ep.season] = bySeason[ep.season] || []).push(ep); });
    const seasons   = Object.keys(bySeason).map(Number).sort((a, b) => a - b);
    let activeSeason= seasons[0];

    const renderTabs = () => seasons.map(s =>
      `<button class="season-tab${s === activeSeason ? ' active' : ''}" data-season="${s}" type="button">Σεζόν ${s}</button>`
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

/* ══════════════════════════════════════════════════════════
   WATCH PAGE CONTROLLER  (unchanged)
   ══════════════════════════════════════════════════════════ */
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
    const params  = new URLSearchParams(window.location.search);
    this._slug    = params.get('series');
    this._season  = +(params.get('season') ?? 1);
    this._ep      = +(params.get('ep')     ?? 1);
    if (!this._slug) { window.location.href = pageUrl('index.html'); return; }
    this._entry   = await this._dm.getOne(this._slug);
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
      wrapper.innerHTML = `
        <div class="player-loading">
          <div style="font-size:2.5rem;margin-bottom:.5rem">🎬</div>
          <p>Δεν υπάρχει διαθέσιμος player για αυτό το επεισόδιο.</p>
        </div>`;
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
        `<button class="player-btn${name === this._activePlayer ? ' active' : ''}" data-player="${name}" type="button">${name}</button>`
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
            <a href="${url}" class="episode-card${isCurrent ? ' episode-card-active' : ''}">
              <div class="episode-num">${String(ep.ep).padStart(2,'0')}</div>
              <div class="episode-info">
                <div class="episode-label">Επεισόδιο ${ep.ep}${isCurrent ? ' <span class="ep-now-playing">(Παίζει)</span>' : ''}</div>
                <div class="episode-players">${Object.keys(ep.players ?? {}).join(', ')}</div>
              </div>
              <div class="episode-play-icon">${ICONS.play}</div>
            </a>`;
        }).join('')}
      </div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   PROFILE PAGE CONTROLLER — with Seen tab + Edit profile
   ══════════════════════════════════════════════════════════ */
class ProfileController {
  constructor() {
    this._dm = new DataManager();
  }

  async init() {
    initNavScroll();
    new AuthController().init();
    this._initTabs();
    this._initEdit();

    fb.onAuth(async (user) => {
      const main = $('#profileMain');
      if (!user) {
        const heroEl = $('#profileHero');
        if (heroEl) heroEl.style.display = 'none';
        if (main) main.innerHTML = `
          <div class="profile-login-prompt">
            <div style="font-size:3rem;margin-bottom:1rem">🔐</div>
            <h2>Καλωσήρθατε!</h2>
            <p>Συνδεθείτε για να δείτε τα αγαπημένα σας, τη watchlist, τα "Έχω δει" και τις αξιολογήσεις σας.</p>
            <button class="btn-primary" id="profileLoginBtn" type="button" style="margin:0 auto">Σύνδεση / Εγγραφή</button>
          </div>`;
        main?.querySelector('#profileLoginBtn')?.addEventListener('click', () => {
          document.dispatchEvent(new CustomEvent('openAuthModal'));
        });
        return;
      }

      _currentUser    = user;
      _currentProfile = await fb.getUserProfile(user.uid);
      const profile   = _currentProfile;
      if (!profile) return;

      document.title = `${profile.username} — Προφίλ`;

      /* ── Hero ── */
      const avatarEl    = $('#profileAvatar');
      const avatarImg   = $('#profileAvatarImg');
      const usernameEl  = $('#profileUsername');
      const emailEl     = $('#profileEmail');

      const initial = (profile.username?.[0] ?? user.email?.[0] ?? '?').toUpperCase();
      if (avatarEl) avatarEl.textContent = initial;
      if (avatarImg) {
        const url = profile.avatar || user.photoURL;
        if (url) {
          avatarImg.src = url;
          avatarImg.hidden = false;
          if (avatarEl) avatarEl.style.display = 'none';
          avatarImg.onerror = () => {
            avatarImg.hidden = true;
            if (avatarEl) avatarEl.style.display = '';
          };
        } else {
          avatarImg.hidden = true;
          if (avatarEl) avatarEl.style.display = '';
        }
      }
      if (usernameEl) usernameEl.textContent = profile.username;
      if (emailEl)    emailEl.textContent    = user.email;

      /* ── Stats bar ── */
      const statsEl = $('#profileStats');
      if (statsEl) {
        const favC   = (profile.favorites ?? []).length;
        const watchC = (profile.watchlist ?? []).length;
        const seenC  = (profile.watched   ?? []).length;
        const rateC  = Object.keys(profile.ratings ?? {}).length;
        statsEl.innerHTML = `
          <div class="profile-stat"><span class="profile-stat-num">${favC}</span><span class="profile-stat-label">Αγαπημένα</span></div>
          <div class="profile-stat"><span class="profile-stat-num">${watchC}</span><span class="profile-stat-label">Watchlist</span></div>
          <div class="profile-stat"><span class="profile-stat-num">${seenC}</span><span class="profile-stat-label">Έχω δει</span></div>
          <div class="profile-stat"><span class="profile-stat-num">${rateC}</span><span class="profile-stat-label">Αξιολογήσεις</span></div>
        `;
      }

      const allEntries = await this._dm.loadAll();
      const bySlug     = Object.fromEntries(allEntries.map(e => [e.slug, e]));

      this._renderList('#favoritesGrid', '#favCount', profile.favorites ?? [], bySlug,
        '❤️', 'Δεν υπάρχουν αγαπημένα ακόμα.',
        `<a href="./index.html" class="btn-secondary" style="display:inline-flex;margin-top:.5rem">Εξερεύνηση σειρών</a>`);

      this._renderList('#watchlistGrid', '#watchlistCount', profile.watchlist ?? [], bySlug,
        '📌', 'Η watchlist σας είναι άδεια.', '');

      this._renderList('#seenGrid', '#seenCount', profile.watched ?? [], bySlug,
        '✓', 'Δεν έχετε σημειώσει καμία σειρά ως "Έχω δει".', '');

      this._renderRatings('#ratingsGrid', '#ratingsCount', profile.ratings ?? {}, bySlug);

      this._renderCommentsTab('#commentsGrid', '#commentsCount', user.uid);
    });
  }

  _initTabs() {
    const tabs   = $$('.profile-tab');
    const panels = $$('.profile-panel');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = $(`#panel-${tab.dataset.panel}`);
        if (panel) panel.classList.add('active');
        history.replaceState(null, '', `#${tab.dataset.panel}`);
      });
    });
    const hash = location.hash.replace('#', '');
    if (hash) {
      const targetTab = $(`[data-panel="${hash}"]`);
      if (targetTab) targetTab.click();
    }
  }

  /* ── Edit profile modal ── */
  _initEdit() {
    const editBtn = $('#profileEditBtn');
    if (!editBtn) return;

    editBtn.addEventListener('click', () => {
      if (!_currentUser || !_currentProfile) return;
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.innerHTML = `
        <div class="auth-modal">
          <button class="auth-modal-close" id="editClose" aria-label="Κλείσιμο" type="button">✕</button>
          <h3 class="auth-forgot-title">Επεξεργασία Προφίλ</h3>
          <p class="auth-forgot-desc">Ενημερώστε το ψευδώνυμό σας ή το URL του avatar.</p>

          <label style="font-size:.75rem;color:var(--text-4);display:block;margin-bottom:.25rem">Ψευδώνυμο</label>
          <input id="editUsername" type="text" class="auth-input" maxlength="40"
                 value="${escapeHtml(_currentProfile.username ?? '')}">

          <label style="font-size:.75rem;color:var(--text-4);display:block;margin-bottom:.25rem;margin-top:.4rem">Avatar URL (προαιρετικό)</label>
          <input id="editAvatar" type="url" class="auth-input" placeholder="https://..."
                 value="${escapeHtml(_currentProfile.avatar ?? '')}">

          <p id="editError" class="auth-error" style="display:none"></p>

          <button id="editSave" class="auth-submit-btn" type="button">Αποθήκευση</button>
        </div>`;
      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      overlay.querySelector('#editClose').addEventListener('click', close);

      overlay.querySelector('#editSave').addEventListener('click', async () => {
        const username = overlay.querySelector('#editUsername').value.trim();
        const avatar   = overlay.querySelector('#editAvatar').value.trim();
        const errEl    = overlay.querySelector('#editError');

        if (!username) {
          errEl.textContent = 'Το ψευδώνυμο είναι υποχρεωτικό.';
          errEl.style.display = 'block';
          return;
        }
        if (username.length < 2 || username.length > 40) {
          errEl.textContent = 'Το ψευδώνυμο πρέπει να έχει 2–40 χαρακτήρες.';
          errEl.style.display = 'block';
          return;
        }
        try {
          await fb.updateUserProfile(_currentUser.uid, {
            username,
            avatar: avatar || null,
          });
          toast('Το προφίλ ενημερώθηκε!', 'success');
          close();
          setTimeout(() => location.reload(), 400);
        } catch (e) {
          errEl.textContent = 'Σφάλμα αποθήκευσης: ' + e.message;
          errEl.style.display = 'block';
        }
      });
    });
  }

  _renderList(gridSel, countSel, slugs, bySlug, icon, emptyMsg, emptyAction = '') {
    const countEl = $(countSel);
    if (countEl) countEl.textContent = slugs.length;
    const el = $(gridSel);
    if (!el) return;
    if (!slugs.length) {
      el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">${icon}</div><p>${emptyMsg}</p>${emptyAction}</div>`;
      return;
    }
    const entries = slugs.map(s => bySlug[s]).filter(Boolean);
    if (!entries.length) {
      el.innerHTML = `<p style="color:var(--text-3);font-size:.9rem">Τα δεδομένα δεν φορτώθηκαν.</p>`;
      return;
    }
    el.innerHTML = `<div class="series-grid">${entries.map(renderCard).join('')}</div>`;
    el.querySelectorAll('.series-card[data-slug]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        window.location.href = pageUrl('series.html', { id: card.dataset.slug });
      });
    });
  }

  _renderRatings(gridSel, countSel, ratings, bySlug) {
    const countEl = $(countSel);
    const ratedSlugs = Object.keys(ratings);
    if (countEl) countEl.textContent = ratedSlugs.length;
    const el = $(gridSel);
    if (!el) return;
    if (!ratedSlugs.length) {
      el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">⭐</div><p>Δεν έχετε αξιολογήσει καμία σειρά ακόμα.</p></div>`;
      return;
    }
    const items = ratedSlugs.map(slug => {
      const entry = bySlug[slug];
      const stars = ratings[slug];
      if (!entry) return '';
      const poster = entry.tmdb?.poster ?? entry._posterFallback ?? null;
      return `
        <a href="${pageUrl('series.html', { id: slug })}" class="rating-item">
          ${poster ? `<img src="${poster}" alt="${escapeHtml(entry.title)}" class="rating-poster">` : `<div class="rating-poster-placeholder">${ICONS.film}</div>`}
          <div class="rating-info">
            <div class="rating-title">${escapeHtml(entry.title)}</div>
            <div class="rating-stars-display">
              ${[1,2,3,4,5].map(n => `<span class="rating-star${n <= stars ? ' filled' : ''}">${ICONS.star}</span>`).join('')}
              <span class="rating-num">${stars}/5</span>
            </div>
          </div>
        </a>`;
    }).filter(Boolean);
    el.innerHTML = items.length
      ? `<div class="ratings-list">${items.join('')}</div>`
      : `<div class="profile-empty"><div class="profile-empty-icon">⭐</div><p>Δεν βρέθηκαν δεδομένα αξιολογήσεων.</p></div>`;
  }

  async _renderCommentsTab(gridSel, countSel, uid) {
    const el = $(gridSel);
    if (!el) return;
    el.innerHTML = `<p style="color:var(--text-3);font-size:.85rem;padding:1rem 0">Φόρτωση σχολίων…</p>`;
    try {
      const comments = await fb.getUserComments(uid);
      const countEl  = $(countSel);
      if (countEl) countEl.textContent = comments.length;
      if (!comments.length) {
        el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">💬</div><p>Δεν έχετε γράψει σχόλια ακόμα.</p></div>`;
        return;
      }
      el.innerHTML = comments.map(c => `
        <div class="comment-item">
          <div class="comment-header">
            <a href="${pageUrl('series.html', { id: c.seriesSlug })}" class="comment-series-link">${escapeHtml(c.seriesSlug)}</a>
            <span class="comment-date">${c.createdAt?.toDate?.()?.toLocaleDateString('el-GR') ?? ''}</span>
          </div>
          <p class="comment-text">${escapeHtml(c.text ?? '')}</p>
        </div>`).join('');
    } catch (e) {
      el.innerHTML = `<div class="profile-empty"><div class="profile-empty-icon">💬</div><p>Δεν έχετε γράψει σχόλια ακόμα.</p></div>`;
    }
  }
}

/* ══════════════════════════════════════════════════════════
   ROUTER + BOOTSTRAP
   ══════════════════════════════════════════════════════════ */
async function router() {
  fb = await loadFirebase();

  const page = document.body.dataset.page;
  try {
    switch (page) {
      case 'home':    await new HomepageController().init(); break;
      case 'series':  await new SeriesController().init();   break;
      case 'watch':   await new WatchController().init();    break;
      case 'profile': await new ProfileController().init();  break;
      default:
        console.warn('[Router] Unknown page:', page);
    }
  } catch (err) {
    console.error('[Router] Page init failed:', err);
    const main = document.querySelector('main, .main-content, #mainContent');
    if (main && !main.children.length) {
      main.innerHTML = `
        <div style="text-align:center;padding:4rem 2rem;color:var(--text-3)">
          <p style="font-size:2rem;margin-bottom:.5rem">⚠️</p>
          <p style="font-size:1rem;margin-bottom:.5rem">Παρουσιάστηκε σφάλμα κατά τη φόρτωση.</p>
          <p style="font-size:.85rem">Ανανεώστε τη σελίδα ή επικοινωνήστε με τον διαχειριστή.</p>
          <button onclick="location.reload()" style="margin-top:1rem;padding:.6rem 1.5rem;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer">
            Ανανέωση
          </button>
        </div>`;
    }
  }
}

/* ── DOMContentLoaded guard: avoids race with deferred/module script timing ── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', router, { once: true });
} else {
  router();
}
