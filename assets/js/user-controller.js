/* ============================================================
   user-controller.js — Profile page management
   Handles: edit profile, avatar upload, tabs, content grids
   ============================================================ */

import {
  auth,
  getUserProfile, updateUserProfile, uploadAvatar,
  getFavorites, getWatchlist, getRatings,
} from './firebase.js';
import { currentUser, currentProfile, _avatarHtml } from './auth-controller.js';

const $ = (sel, ctx = document) => ctx.querySelector(sel);

/* ════════════════════════════════════════════════════════════
   USER CONTROLLER — profile page
   ════════════════════════════════════════════════════════════ */
export class UserController {
  /**
   * @param {object} opts
   * @param {DataManager} opts.dm       – DataManager instance for slug→entry lookup
   * @param {function}    opts.renderCard – card renderer from app.js
   * @param {function}    opts.pageUrl    – URL builder from app.js
   */
  constructor(opts = {}) {
    this._dm         = opts.dm;
    this._renderCard = opts.renderCard;
    this._pageUrl    = opts.pageUrl;
    this._profile    = null;
    this._allBySlug  = {};
  }

  /** Called after auth state is known */
  async load(user) {
    if (!user) return;
    this._profile = await getUserProfile(user.uid);
    if (!this._profile) return;

    this._renderHeader();

    // Pre-load all series for cross-reference
    if (this._dm) {
      const all       = await this._dm.loadAll();
      this._allBySlug = Object.fromEntries(all.map(e => [e.slug, e]));
    }

    // Activate tab from URL param
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    if (tabParam) this._activateTab(tabParam);

    await this._renderActiveTab();

    // Re-render on tab clicks
    document.querySelectorAll('.profile-tab').forEach(btn => {
      btn.addEventListener('click', async () => {
        this._activateTab(btn.dataset.panel);
        await this._renderActiveTab();
      });
    });

    // Edit profile form
    this._bindEditForm(user);
  }

  /* ── Header ─────────────────────────────────────────────── */

  _renderHeader() {
    const p = this._profile;
    if (!p) return;

    const avatarEl = $('#profileAvatar');
    if (avatarEl) avatarEl.innerHTML = _avatarHtml(p, 72);

    const usernameEl = $('#profileUsername');
    if (usernameEl) usernameEl.textContent = p.username;

    // Populate edit form if present
    const editUsername = $('#editUsername');
    if (editUsername) editUsername.value = p.username ?? '';
  }

  /* ── Edit Profile Form ──────────────────────────────────── */

  _bindEditForm(user) {
    const form = $('#editProfileForm');
    if (!form) return;

    // Avatar file input preview
    const fileInput = $('#avatarFileInput');
    const previewEl = $('#avatarPreview');
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        if (previewEl) previewEl.innerHTML = `<img src="${e.target.result}" alt="preview"
          style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid var(--accent)">`;
      };
      reader.readAsDataURL(file);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newUsername = $('#editUsername')?.value?.trim();
      const file        = fileInput?.files?.[0];
      const errEl       = $('#editProfileError');
      const successEl   = $('#editProfileSuccess');

      if (errEl)     errEl.style.display = 'none';
      if (successEl) successEl.style.display = 'none';

      if (!newUsername || newUsername.length < 3) {
        if (errEl) { errEl.textContent = 'Το ψευδώνυμο πρέπει να έχει τουλάχιστον 3 χαρακτήρες.'; errEl.style.display = 'block'; }
        return;
      }

      const submitBtn = $('#editProfileSubmit');
      if (submitBtn) submitBtn.disabled = true;

      try {
        let avatarUrl = this._profile?.avatar;

        // Upload new avatar if selected
        if (file) {
          if (file.size > 2 * 1024 * 1024) {
            if (errEl) { errEl.textContent = 'Η εικόνα δεν πρέπει να υπερβαίνει τα 2MB.'; errEl.style.display = 'block'; }
            submitBtn.disabled = false;
            return;
          }
          avatarUrl = await uploadAvatar(user, file);
        }

        await updateUserProfile(user.uid, { username: newUsername, avatar: avatarUrl });

        // Refresh local profile
        this._profile = await getUserProfile(user.uid);
        this._renderHeader();

        if (successEl) { successEl.textContent = 'Το προφίλ ενημερώθηκε!'; successEl.style.display = 'block'; }
        // Re-render nav avatar
        document.dispatchEvent(new CustomEvent('sv:profileUpdated', { detail: this._profile }));

      } catch (err) {
        if (errEl) { errEl.textContent = err.message ?? 'Σφάλμα. Δοκιμάστε ξανά.'; errEl.style.display = 'block'; }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  /* ── Tabs ───────────────────────────────────────────────── */

  _activateTab(name) {
    document.querySelectorAll('.profile-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    document.querySelectorAll('.profile-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  }

  async _renderActiveTab() {
    const active = document.querySelector('.profile-panel.active');
    if (!active || !this._profile) return;
    const id = active.id;

    if (id === 'panel-favorites')  await this._renderFavorites();
    if (id === 'panel-watchlist')  await this._renderWatchlist();
    if (id === 'panel-ratings')    await this._renderRatings();
    if (id === 'panel-comments')   this._renderCommentsNotice();
  }

  /* ── Favorites ──────────────────────────────────────────── */

  async _renderFavorites() {
    const el = $('#favoritesGrid');
    const countEl = $('#favCount');
    if (!el || !this._profile) return;

    el.innerHTML = '<div class="sv-spinner"></div>';
    const slugs = await getFavorites(this._profile.uid);
    if (countEl) countEl.textContent = slugs.length;

    if (!slugs.length) {
      el.innerHTML = this._emptyHtml('❤️', 'Δεν υπάρχουν αγαπημένα ακόμα.',
        `<a href="./index.html" class="btn-secondary" style="display:inline-flex;margin-top:.75rem">Εξερεύνηση</a>`);
      return;
    }
    this._renderGrid(el, slugs);
  }

  /* ── Watchlist ──────────────────────────────────────────── */

  async _renderWatchlist() {
    const el = $('#watchlistGrid');
    const countEl = $('#watchlistCount');
    if (!el || !this._profile) return;

    el.innerHTML = '<div class="sv-spinner"></div>';
    const slugs = await getWatchlist(this._profile.uid);
    if (countEl) countEl.textContent = slugs.length;

    if (!slugs.length) {
      el.innerHTML = this._emptyHtml('📌', 'Η λίστα "Θα τα δω" είναι άδεια.');
      return;
    }
    this._renderGrid(el, slugs);
  }

  /* ── Ratings ────────────────────────────────────────────── */

  async _renderRatings() {
    const el = $('#ratingsGrid');
    const countEl = $('#ratingsCount');
    if (!el || !this._profile) return;

    el.innerHTML = '<div class="sv-spinner"></div>';
    const ratings = await getRatings(this._profile.uid);
    const slugs   = Object.keys(ratings);
    if (countEl) countEl.textContent = slugs.length;

    if (!slugs.length) {
      el.innerHTML = this._emptyHtml('⭐', 'Δεν έχετε αξιολογήσει καμία σειρά ακόμα.');
      return;
    }

    const entries = slugs.map(s => this._allBySlug[s]).filter(Boolean);
    if (!entries.length) {
      el.innerHTML = '<p style="color:var(--text-3);font-size:.9rem">Τα δεδομένα δεν φορτώθηκαν.</p>';
      return;
    }

    const STAR = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:var(--gold,#f5a623)"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`;
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:.6rem">
        ${entries.map(entry => {
          const stars = ratings[entry.slug] ?? 0;
          const poster = entry.tmdb?.poster
            ? `<img src="${entry.tmdb.poster}" alt="${entry.title}"
                    style="width:48px;height:72px;object-fit:cover;border-radius:5px;flex-shrink:0">`
            : `<div style="width:48px;height:72px;background:var(--bg-surface);border-radius:5px;flex-shrink:0"></div>`;
          return `
            <a href="${this._pageUrl('series.html', { id: entry.slug })}"
               style="display:flex;align-items:center;gap:12px;padding:.85rem;border-radius:9px;
                      background:var(--bg-card,#161616);border:1px solid var(--border,rgba(255,255,255,.08));
                      text-decoration:none;transition:border-color .2s"
               onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border,rgba(255,255,255,.08))'">
              ${poster}
              <div style="flex:1;min-width:0">
                <div style="font-size:.92rem;font-weight:600;color:var(--text-1);
                             white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${entry.title}</div>
                <div style="font-size:.78rem;color:var(--text-3);margin-top:2px">${entry.channel ?? ''}</div>
              </div>
              <div style="display:flex;align-items:center;gap:3px;flex-shrink:0">
                ${STAR} <span style="font-size:.88rem;font-weight:600;color:var(--gold,#f5a623)">${stars}/5</span>
              </div>
            </a>`;
        }).join('')}
      </div>`;
  }

  _renderCommentsNotice() {
    const el = $('#commentsTabGrid');
    if (!el) return;
    el.innerHTML = `<p style="color:var(--text-3);font-size:.9rem">
      Τα σχόλιά σας εμφανίζονται στις σελίδες των σειρών.
    </p>`;
  }

  /* ── Helpers ────────────────────────────────────────────── */

  _renderGrid(el, slugs) {
    const entries = slugs.map(s => this._allBySlug[s]).filter(Boolean);
    if (!entries.length) {
      el.innerHTML = '<p style="color:var(--text-3);font-size:.9rem">Τα δεδομένα δεν φορτώθηκαν.</p>';
      return;
    }
    el.innerHTML = `<div class="series-grid">${entries.map(e => this._renderCard(e)).join('')}</div>`;
    el.querySelectorAll('.series-card[data-slug]').forEach(card => {
      card.addEventListener('click', ev => {
        if (ev.target.closest('a')) return;
        const s = card.dataset.slug;
        if (s) window.location.href = this._pageUrl('series.html', { id: s });
      });
    });
  }

  _emptyHtml(icon, msg, action = '') {
    return `<div class="profile-empty"><div class="profile-empty-icon">${icon}</div>
              <p>${msg}</p>${action}</div>`;
  }
}
