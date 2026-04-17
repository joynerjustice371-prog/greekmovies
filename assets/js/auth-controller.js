/* ============================================================
   auth-controller.js — Navbar Auth UI + Login/Register Modal
   Handles: avatar dropdown, forgot password, shadowban check
   ============================================================ */

import {
  auth,
  loginWithGoogle, loginWithEmail, registerWithEmail,
  sendPasswordReset, logout, onAuth,
  getUserProfile,
} from './firebase.js';

/* ── Module-level auth state (shared across controllers) ──── */
export let currentUser    = null;
export let currentProfile = null;

/** Internal setter — called by onAuth listener */
function _setState(user, profile) {
  currentUser    = user;
  currentProfile = profile;
  // Broadcast to any listener in the page
  document.dispatchEvent(new CustomEvent('sv:authChanged', {
    detail: { user, profile },
    bubbles: true,
  }));
}

/* ── Utility ─────────────────────────────────────────────── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);

function _avatarHtml(profile, size = 36) {
  const s = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block;`;
  if (profile?.avatar) {
    return `<img src="${profile.avatar}" alt="${profile.username}" style="${s}border:2px solid var(--accent,.6)">`;
  }
  const initial = (profile?.username?.[0] ?? '?').toUpperCase();
  return `<div style="${s}background:var(--accent,#e50914);display:flex;align-items:center;
                justify-content:center;font-weight:700;font-size:${Math.round(size*0.4)}px;
                color:#fff;flex-shrink:0">${initial}</div>`;
}

const AUTH_ERRORS = {
  'auth/user-not-found':       'Δεν βρέθηκε χρήστης με αυτό το email.',
  'auth/wrong-password':       'Λανθασμένος κωδικός.',
  'auth/invalid-credential':   'Λανθασμένα στοιχεία σύνδεσης.',
  'auth/email-already-in-use': 'Το email χρησιμοποιείται ήδη.',
  'auth/weak-password':        'Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.',
  'auth/invalid-email':        'Μη έγκυρο email.',
  'auth/too-many-requests':    'Πάρα πολλές προσπάθειες. Δοκιμάστε ξανά αργότερα.',
  'auth/popup-closed-by-user': 'Το παράθυρο Google έκλεισε. Δοκιμάστε ξανά.',
};

/* ════════════════════════════════════════════════════════════
   AUTH CONTROLLER
   ════════════════════════════════════════════════════════════ */
export class AuthController {
  constructor() {
    this._modal      = null;
    this._tab        = 'login';
    this._modalView  = 'main';   // 'main' | 'forgot'
    this._unsubscribe= null;
  }

  /** Call once per page — injects nav UI and subscribes to auth state */
  init() {
    this._injectNavUI();
    this._unsubscribe = onAuth(async (user) => {
      const profile = user ? await getUserProfile(user.uid) : null;
      _setState(user, profile);
      this._renderNavAuth();
    });

    // Allow other modules to request the modal
    document.addEventListener('sv:openAuthModal', (e) => {
      this._openModal(e.detail?.tab ?? 'login');
    });
  }

  destroy() {
    this._unsubscribe?.();
  }

  /* ── Nav UI ─────────────────────────────────────────────── */

  _injectNavUI() {
    const actions = document.getElementById('nav-actions');
    if (!actions || document.getElementById('authNavWrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'authNavWrap';
    wrap.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin-left:.4rem;position:relative';
    wrap.innerHTML = `
      <!-- Logged-out: Σύνδεση button -->
      <button id="navLoginBtn"
              style="padding:6px 16px;border-radius:6px;background:var(--accent,#e50914);
                     color:#fff;font-size:.82rem;font-weight:600;cursor:pointer;border:none;
                     font-family:inherit;transition:.2s">
        Σύνδεση
      </button>

      <!-- Logged-in: avatar + dropdown trigger -->
      <button id="navAvatarBtn"
              style="display:none;background:none;border:none;cursor:pointer;
                     padding:2px;border-radius:50%;outline:none"
              aria-label="Μενού χρήστη" aria-haspopup="true" aria-expanded="false">
        <div id="navAvatarImg"></div>
      </button>

      <!-- Dropdown -->
      <div id="navDropdown"
           style="display:none;position:absolute;top:calc(100% + 10px);right:0;
                  background:var(--bg-card,#1c1c1c);border:1px solid var(--border,rgba(255,255,255,.1));
                  border-radius:10px;min-width:200px;z-index:3000;overflow:hidden;
                  box-shadow:0 12px 40px rgba(0,0,0,.7)">
        <div id="navDropdownHeader"
             style="padding:12px 16px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));
                    display:flex;align-items:center;gap:10px">
          <div id="navDropdownAvatar"></div>
          <div>
            <div id="navDropdownUsername"
                 style="font-size:.85rem;font-weight:600;color:var(--text-1,#fff)"></div>
            <div style="font-size:.72rem;color:var(--text-3,#777)">Λογαριασμός</div>
          </div>
        </div>
        <nav style="padding:6px 0">
          <a class="nav-dd-item" href="./profile.html">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Προφίλ
          </a>
          <a class="nav-dd-item" href="./profile.html?tab=favorites">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l7.78 7.78 7.78-7.78a5.5 5.5 0 0 0 0-7.78z"/></svg>
            Αγαπημένα
          </a>
          <a class="nav-dd-item" href="./profile.html?tab=watchlist">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            Θα το δω
          </a>
          <a class="nav-dd-item" href="./profile.html?tab=ratings">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
            Αξιολογήσεις
          </a>
          <hr style="border:none;border-top:1px solid var(--border,rgba(255,255,255,.08));margin:4px 0">
          <button class="nav-dd-item" id="navLogoutDd" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:var(--text-3,#888)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Αποσύνδεση
          </button>
        </nav>
      </div>`;

    // CSS for dropdown items (injected once)
    if (!document.getElementById('sv-nav-dd-styles')) {
      const style = document.createElement('style');
      style.id = 'sv-nav-dd-styles';
      style.textContent = `
        .nav-dd-item{
          display:flex;align-items:center;gap:10px;
          padding:9px 16px;font-size:.84rem;color:var(--text-2,#ccc);
          text-decoration:none;transition:background .15s,color .15s;
        }
        .nav-dd-item:hover{background:rgba(255,255,255,.06);color:var(--text-1,#fff)}
      `;
      document.head.appendChild(style);
    }

    actions.appendChild(wrap);

    // Login button
    wrap.querySelector('#navLoginBtn').addEventListener('click', () => this._openModal('login'));

    // Avatar dropdown toggle
    const avatarBtn  = wrap.querySelector('#navAvatarBtn');
    const dropdown   = wrap.querySelector('#navDropdown');
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dropdown.style.display === 'none' || !dropdown.style.display;
      dropdown.style.display = open ? 'block' : 'none';
      avatarBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => { dropdown.style.display = 'none'; });
    dropdown.addEventListener('click', e => e.stopPropagation());

    // Logout from dropdown
    wrap.querySelector('#navLogoutDd').addEventListener('click', async () => {
      dropdown.style.display = 'none';
      await logout();
      this._toast('Αποσυνδεθήκατε.', 'info');
    });
  }

  _renderNavAuth() {
    const loginBtn  = document.getElementById('navLoginBtn');
    const avatarBtn = document.getElementById('navAvatarBtn');
    const avatarImg = document.getElementById('navAvatarImg');
    const ddAvatar  = document.getElementById('navDropdownAvatar');
    const ddUsername= document.getElementById('navDropdownUsername');

    if (currentUser && currentProfile) {
      // Banned users: force logout
      if (currentProfile.status === 'banned') {
        logout();
        this._toast('Ο λογαριασμός σας έχει ανασταλεί.', 'error');
        return;
      }
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (avatarBtn) avatarBtn.style.display = 'inline-flex';
      if (avatarImg) avatarImg.innerHTML     = _avatarHtml(currentProfile, 36);
      if (ddAvatar)  ddAvatar.innerHTML      = _avatarHtml(currentProfile, 40);
      if (ddUsername) ddUsername.textContent = currentProfile.username;
    } else {
      if (loginBtn)  loginBtn.style.display  = 'inline-block';
      if (avatarBtn) avatarBtn.style.display = 'none';
    }
  }

  /* ── Modal ──────────────────────────────────────────────── */

  _openModal(tab = 'login') {
    this._tab      = tab;
    this._modalView= 'main';
    this._modal?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'authModal';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9000;
      background:rgba(0,0,0,.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      display:flex;align-items:center;justify-content:center;padding:1rem`;

    overlay.innerHTML = this._modalMainHtml(tab);
    document.body.appendChild(overlay);
    this._modal = overlay;
    this._bindModalEvents();

    // Close on backdrop click
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  _modalMainHtml(tab) {
    const isLogin = tab === 'login';
    return `
      <div id="authBox" style="background:var(--bg-card,#161616);border:1px solid var(--border,rgba(255,255,255,.1));
                border-radius:14px;padding:2rem;width:100%;max-width:420px;position:relative;
                max-height:90vh;overflow-y:auto">
        <button id="authClose"
                style="position:absolute;top:14px;right:14px;background:none;border:none;
                       color:var(--text-3,#777);font-size:1.1rem;cursor:pointer;line-height:1;
                       width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center">✕</button>

        <h2 style="font-family:var(--font-display,sans-serif);font-size:1.6rem;letter-spacing:.04em;
                   color:var(--text-1,#fff);margin-bottom:1.5rem;text-align:center">
          StreamVault
        </h2>

        <!-- Tabs -->
        <div style="display:flex;gap:.4rem;margin-bottom:1.5rem;background:var(--bg-surface,#1e1e1e);
                    border-radius:8px;padding:3px">
          <button class="auth-modal-tab ${isLogin?'active':''}" data-tab="login"
                  style="flex:1;padding:.55rem;border:none;border-radius:6px;cursor:pointer;
                         font-size:.88rem;font-family:inherit;transition:.18s;
                         background:${isLogin?'var(--bg-card,#161616)':'transparent'};
                         color:${isLogin?'var(--text-1,#fff)':'var(--text-3,#777)'}">
            Σύνδεση
          </button>
          <button class="auth-modal-tab ${!isLogin?'active':''}" data-tab="register"
                  style="flex:1;padding:.55rem;border:none;border-radius:6px;cursor:pointer;
                         font-size:.88rem;font-family:inherit;transition:.18s;
                         background:${!isLogin?'var(--bg-card,#161616)':'transparent'};
                         color:${!isLogin?'var(--text-1,#fff)':'var(--text-3,#777)'}">
            Εγγραφή
          </button>
        </div>

        <!-- Google -->
        <button id="authGoogle"
                style="width:100%;padding:.7rem;margin-bottom:.85rem;border:1px solid var(--border,rgba(255,255,255,.12));
                       border-radius:8px;background:var(--bg-surface,#1e1e1e);color:var(--text-1,#fff);
                       font-size:.9rem;cursor:pointer;font-family:inherit;
                       display:flex;align-items:center;justify-content:center;gap:.6rem;transition:.2s">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Συνέχεια με Google
        </button>

        <div style="text-align:center;color:var(--text-4,#555);font-size:.76rem;margin-bottom:.85rem;
                    display:flex;align-items:center;gap:.5rem">
          <hr style="flex:1;border:none;border-top:1px solid var(--border,rgba(255,255,255,.08))">
          ή με email
          <hr style="flex:1;border:none;border-top:1px solid var(--border,rgba(255,255,255,.08))">
        </div>

        <!-- Form fields -->
        <div id="authFormFields">
          ${!isLogin ? `
          <input id="authUsername" type="text" placeholder="Ψευδώνυμο" autocomplete="username"
                 style="${this._inputStyle}">` : ''}
          <input id="authEmail" type="email" placeholder="Email" autocomplete="email"
                 style="${this._inputStyle}">
          <input id="authPassword" type="password" placeholder="Κωδικός" autocomplete="current-password"
                 style="${this._inputStyle}">
        </div>

        <!-- Error message -->
        <p id="authError"
           style="color:#ff5566;font-size:.8rem;margin-bottom:.65rem;display:none;
                  background:rgba(255,60,80,.08);border-radius:6px;padding:8px 10px"></p>

        <!-- Submit button -->
        <button id="authSubmit"
                style="width:100%;padding:.8rem;background:var(--accent,#e50914);color:#fff;
                       border:none;border-radius:8px;font-size:.95rem;font-weight:600;
                       cursor:pointer;font-family:inherit;transition:opacity .2s;margin-bottom:${isLogin?'.6rem':'0'}">
          ${isLogin ? 'Σύνδεση' : 'Δημιουργία Λογαριασμού'}
        </button>

        ${isLogin ? `
        <button id="authForgot"
                style="width:100%;padding:.4rem;background:none;border:none;
                       color:var(--text-3,#777);font-size:.8rem;cursor:pointer;font-family:inherit;
                       text-align:center;transition:color .18s">
          Ξέχασα τον κωδικό
        </button>` : ''}
      </div>`;
  }

  get _inputStyle() {
    return `width:100%;padding:.65rem .8rem;margin-bottom:.55rem;border-radius:7px;
            border:1px solid var(--border,rgba(255,255,255,.1));
            background:var(--bg-surface,#1e1e1e);color:var(--text-1,#fff);
            font-size:.9rem;box-sizing:border-box;font-family:inherit;outline:none;
            transition:border-color .18s;`;
  }

  _modalForgotHtml() {
    return `
      <div id="authBox" style="background:var(--bg-card,#161616);border:1px solid var(--border,rgba(255,255,255,.1));
                border-radius:14px;padding:2rem;width:100%;max-width:420px;position:relative">
        <button id="authClose"
                style="position:absolute;top:14px;right:14px;background:none;border:none;
                       color:var(--text-3,#777);font-size:1.1rem;cursor:pointer">✕</button>
        <h2 style="font-family:var(--font-display,sans-serif);font-size:1.4rem;letter-spacing:.04em;
                   color:var(--text-1,#fff);margin-bottom:.5rem">Επαναφορά Κωδικού</h2>
        <p style="font-size:.85rem;color:var(--text-3,#777);margin-bottom:1.25rem">
          Εισάγετε το email σας και θα λάβετε σύνδεσμο επαναφοράς.
        </p>
        <input id="forgotEmail" type="email" placeholder="Email" autocomplete="email"
               style="${this._inputStyle}">
        <p id="forgotMsg" style="font-size:.8rem;margin-bottom:.65rem;display:none;
                                  border-radius:6px;padding:8px 10px"></p>
        <button id="forgotSubmit"
                style="width:100%;padding:.75rem;background:var(--accent,#e50914);color:#fff;
                       border:none;border-radius:8px;font-size:.92rem;font-weight:600;
                       cursor:pointer;font-family:inherit;margin-bottom:.6rem">
          Αποστολή Email
        </button>
        <button id="forgotBack"
                style="width:100%;padding:.4rem;background:none;border:none;
                       color:var(--text-3,#777);font-size:.8rem;cursor:pointer;font-family:inherit">
          ← Επιστροφή στη σύνδεση
        </button>
      </div>`;
  }

  _bindModalEvents() {
    const overlay = this._modal;

    const close = () => overlay.remove();
    overlay.querySelector('#authClose')?.addEventListener('click', close);

    // Tab switching
    overlay.querySelectorAll('.auth-modal-tab').forEach(btn => {
      btn.addEventListener('click', () => this._openModal(btn.dataset.tab));
    });

    // Google
    overlay.querySelector('#authGoogle')?.addEventListener('click', async () => {
      try {
        await loginWithGoogle();
        overlay.remove();
        this._toast('Συνδεθήκατε με Google!', 'success');
      } catch (e) { this._showErr(e); }
    });

    // Email submit
    overlay.querySelector('#authSubmit')?.addEventListener('click', async () => {
      const email    = overlay.querySelector('#authEmail')?.value?.trim();
      const password = overlay.querySelector('#authPassword')?.value ?? '';
      const username = overlay.querySelector('#authUsername')?.value?.trim() ?? '';
      if (!email || !password) { this._showErr({ message: 'Συμπληρώστε email και κωδικό.' }); return; }
      try {
        if (this._tab === 'register') {
          if (!username) { this._showErr({ message: 'Απαιτείται ψευδώνυμο.' }); return; }
          if (username.length < 3) { this._showErr({ message: 'Το ψευδώνυμο πρέπει να έχει τουλάχιστον 3 χαρακτήρες.' }); return; }
          await registerWithEmail(email, password, username);
          this._toast('Καλωσήρθατε! Ο λογαριασμός σας δημιουργήθηκε.', 'success');
        } else {
          await loginWithEmail(email, password);
          this._toast('Συνδεθήκατε!', 'success');
        }
        overlay.remove();
      } catch (e) { this._showErr(e); }
    });

    // Enter key
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') overlay.querySelector('#authSubmit')?.click();
    });

    // Forgot password link
    overlay.querySelector('#authForgot')?.addEventListener('click', () => {
      overlay.querySelector('#authBox').outerHTML;
      overlay.innerHTML = this._modalForgotHtml();
      overlay.querySelector('#authClose').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#forgotBack').addEventListener('click', () => this._openModal('login'));
      overlay.querySelector('#forgotSubmit').addEventListener('click', async () => {
        const email = overlay.querySelector('#forgotEmail')?.value?.trim();
        const msgEl = overlay.querySelector('#forgotMsg');
        if (!email) { this._showForgotMsg('Εισάγετε το email σας.', 'error'); return; }
        try {
          await sendPasswordReset(email);
          this._showForgotMsg('Email επαναφοράς στάλθηκε! Ελέγξτε τα εισερχόμενά σας.', 'success');
          overlay.querySelector('#forgotSubmit').disabled = true;
        } catch (e) {
          this._showForgotMsg(AUTH_ERRORS[e.code] ?? e.message, 'error');
        }
      });
    });
  }

  _showErr(e) {
    const el = this._modal?.querySelector('#authError');
    if (!el) return;
    el.textContent = AUTH_ERRORS[e.code] ?? e.message ?? 'Σφάλμα. Δοκιμάστε ξανά.';
    el.style.display = 'block';
  }

  _showForgotMsg(msg, type) {
    const el = this._modal?.querySelector('#forgotMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = type === 'success' ? 'rgba(0,200,83,.1)' : 'rgba(255,60,80,.08)';
    el.style.color = type === 'success' ? '#00c853' : '#ff5566';
  }

  _toast(msg, type = 'info') {
    // Dispatch to app.js toast system
    document.dispatchEvent(new CustomEvent('sv:toast', { detail: { msg, type } }));
  }
}

/** Export the avatar HTML helper for use by other controllers */
export { _avatarHtml };
