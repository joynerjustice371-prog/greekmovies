/* ============================================================
   comments-controller.js — Full Comments System
   Features: post, like/dislike, report, shadowban, avatar,
             inline rating, auth gating
   ============================================================ */

import {
  getComments, postComment, likeComment, dislikeComment, reportComment,
} from './firebase.js';
import { currentUser, currentProfile, _avatarHtml } from './auth-controller.js';

/* ════════════════════════════════════════════════════════════
   COMMENTS CONTROLLER
   ════════════════════════════════════════════════════════════ */
export class CommentsController {
  /**
   * @param {string} container  – CSS selector for the container element
   * @param {string} seriesId   – Series slug / Firestore document id
   */
  constructor(container, seriesId) {
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;
    this._seriesId  = seriesId;
    this._rating    = 0;  // inline rating for new comment
  }

  /** Render everything — call on page load and after auth change */
  async render() {
    if (!this._container) return;
    this._container.innerHTML = '<div class="sv-spinner" style="margin:1rem auto"></div>';

    try {
      const viewerUid    = currentUser?.uid ?? null;
      const viewerStatus = currentProfile?.status ?? 'active';
      const comments     = await getComments(this._seriesId, viewerUid, viewerStatus);

      this._container.innerHTML = `
        <div class="comments-wrap">
          <h3 class="comments-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 style="width:18px;height:18px;vertical-align:middle;margin-right:6px">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Σχόλια
            <span class="comments-count">${comments.length}</span>
          </h3>

          ${this._inputHtml()}
          <div class="comments-list" id="commentsListInner">
            ${comments.length
              ? comments.map(c => this._commentHtml(c, viewerUid)).join('')
              : '<p class="comments-empty">Δεν υπάρχουν σχόλια ακόμα. Γίνετε οι πρώτοι!</p>'}
          </div>
        </div>`;

      this._injectStyles();
      this._bindInput();
      this._bindCommentActions();

    } catch (err) {
      console.error('[CommentsController]', err);
      this._container.innerHTML = '<p style="color:var(--text-3);font-size:.85rem;padding:1rem 0">Αδύνατη φόρτωση σχολίων.</p>';
    }
  }

  /* ── Input area HTML ────────────────────────────────────── */

  _inputHtml() {
    if (!currentUser) {
      return `
        <div class="comments-auth-gate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
               style="width:28px;height:28px;color:var(--text-4)">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p>Πρέπει να συνδεθείτε για να σχολιάσετε.</p>
          <button class="sv-btn-accent" id="commentsLoginBtn">Σύνδεση</button>
        </div>`;
    }

    return `
      <div class="comments-input-wrap">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="flex-shrink:0;margin-top:2px">${_avatarHtml(currentProfile, 36)}</div>
          <div style="flex:1">
            <!-- Inline star rating for comment -->
            <div class="comment-star-row" id="commentStarRow">
              <span style="font-size:.78rem;color:var(--text-3)">Αξιολόγηση (προαιρετικά):</span>
              ${[1,2,3,4,5].map(n =>
                `<button class="c-star-btn" data-n="${n}" title="${n} αστέρι${n===1?'':'α'}">
                  <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor">
                    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                  </svg>
                </button>`).join('')}
              <span id="cStarLabel" style="font-size:.76rem;color:var(--text-3);margin-left:4px"></span>
            </div>
            <textarea id="commentInput" placeholder="Γράψτε ένα σχόλιο…" rows="3"
                      style="width:100%;padding:.65rem;border-radius:8px;
                             border:1px solid var(--border,rgba(255,255,255,.1));
                             background:var(--bg-surface,#1e1e1e);color:var(--text-1);
                             font-family:inherit;font-size:.9rem;resize:vertical;
                             box-sizing:border-box;outline:none;transition:border-color .18s"
                      onfocus="this.style.borderColor='var(--accent)'"
                      onblur="this.style.borderColor='var(--border,rgba(255,255,255,.1))'"></textarea>
            <div style="display:flex;align-items:center;gap:.5rem;margin-top:.4rem">
              <button id="commentSubmitBtn" class="sv-btn-accent">Δημοσίευση</button>
              <span id="commentInputError" style="font-size:.78rem;color:#ff5566;display:none"></span>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ── Single comment HTML ────────────────────────────────── */

  _commentHtml(c, viewerUid) {
    const date  = c.createdAt?.toDate?.()?.toLocaleDateString('el-GR', { day:'2-digit', month:'short', year:'numeric' }) ?? '';
    const isOwn = c.uid === viewerUid;

    const avatarHtml = c.avatar
      ? `<img src="${c.avatar}" alt="${c.username}"
             style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0">`
      : `<div style="width:36px;height:36px;border-radius:50%;background:var(--accent,#e50914);
                     display:flex;align-items:center;justify-content:center;
                     font-weight:700;font-size:.85rem;color:#fff;flex-shrink:0">
           ${(c.username?.[0] ?? '?').toUpperCase()}
         </div>`;

    const starsHtml = c.rating > 0
      ? `<div style="display:flex;align-items:center;gap:2px;margin-left:auto">
           ${Array.from({length:5}, (_,i) =>
             `<svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:${i < c.rating ? 'var(--gold,#f5a623)' : 'var(--text-4,#555)'}">
               <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
             </svg>`).join('')}
         </div>`
      : '';

    return `
      <div class="comment-item${isOwn ? ' comment-own' : ''}" data-id="${c.id}">
        <div class="comment-header">
          ${avatarHtml}
          <div class="comment-meta">
            <span class="comment-username">${this._esc(c.username)}</span>
            <span class="comment-date">${date}</span>
          </div>
          ${starsHtml}
        </div>
        <p class="comment-text">${this._esc(c.text)}</p>
        <div class="comment-actions">
          <button class="comment-action-btn c-like" data-id="${c.id}" title="Μου αρέσει">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
              <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
            </svg>
            <span>${c.likes ?? 0}</span>
          </button>
          <button class="comment-action-btn c-dislike" data-id="${c.id}" title="Δεν μου αρέσει">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/>
              <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
            </svg>
            <span>${c.dislikes ?? 0}</span>
          </button>
          ${!isOwn ? `
          <button class="comment-action-btn c-report" data-id="${c.id}" title="Αναφορά"
                  style="margin-left:auto;color:var(--text-4)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
            Αναφορά
          </button>` : ''}
        </div>
      </div>`;
  }

  /* ── Event binding ──────────────────────────────────────── */

  _bindInput() {
    const c = this._container;

    // Login gate button
    c.querySelector('#commentsLoginBtn')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('sv:openAuthModal', { detail: { tab: 'login' } }));
    });

    // Inline star rating
    this._rating = 0;
    c.querySelectorAll('.c-star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._rating = +btn.dataset.n;
        c.querySelectorAll('.c-star-btn').forEach((b, i) => {
          b.style.color = i < this._rating ? 'var(--gold,#f5a623)' : 'var(--text-4,#555)';
        });
        const lbl = c.querySelector('#cStarLabel');
        if (lbl) lbl.textContent = this._rating + '/5';
      });
      btn.addEventListener('mouseover', () => {
        const n = +btn.dataset.n;
        c.querySelectorAll('.c-star-btn').forEach((b, i) => {
          b.style.color = i < n ? 'var(--gold,#f5a623)' : 'var(--text-4,#555)';
        });
      });
      btn.addEventListener('mouseout', () => {
        c.querySelectorAll('.c-star-btn').forEach((b, i) => {
          b.style.color = i < this._rating ? 'var(--gold,#f5a623)' : 'var(--text-4,#555)';
        });
      });
    });

    // Submit
    c.querySelector('#commentSubmitBtn')?.addEventListener('click', async () => {
      if (!currentUser) {
        document.dispatchEvent(new CustomEvent('sv:openAuthModal', { detail: { tab: 'login' } }));
        return;
      }

      const text   = c.querySelector('#commentInput')?.value?.trim();
      const errEl  = c.querySelector('#commentInputError');
      const btn    = c.querySelector('#commentSubmitBtn');

      if (!text) {
        if (errEl) { errEl.textContent = 'Γράψτε ένα σχόλιο πρώτα.'; errEl.style.display = 'inline'; }
        return;
      }
      if (text.length > 2000) {
        if (errEl) { errEl.textContent = 'Το σχόλιο δεν μπορεί να υπερβαίνει τους 2000 χαρακτήρες.'; errEl.style.display = 'inline'; }
        return;
      }

      btn.disabled = true;
      try {
        await postComment(
          this._seriesId,
          currentUser.uid,
          currentProfile?.username ?? 'Ανώνυμος',
          currentProfile?.avatar   ?? '',
          text,
          this._rating,
        );
        await this.render(); // full refresh
        document.dispatchEvent(new CustomEvent('sv:toast', { detail: { msg: 'Το σχόλιο δημοσιεύτηκε!', type: 'success' } }));
      } catch (err) {
        if (errEl) { errEl.textContent = err.message ?? 'Σφάλμα. Δοκιμάστε ξανά.'; errEl.style.display = 'inline'; }
        btn.disabled = false;
      }
    });
  }

  _bindCommentActions() {
    const c = this._container;

    // Like
    c.querySelectorAll('.c-like').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!currentUser) { document.dispatchEvent(new CustomEvent('sv:openAuthModal')); return; }
        const id = btn.dataset.id;
        await likeComment(this._seriesId, id);
        const span = btn.querySelector('span');
        if (span) span.textContent = +span.textContent + 1;
        btn.style.color = 'var(--accent)';
      });
    });

    // Dislike
    c.querySelectorAll('.c-dislike').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!currentUser) { document.dispatchEvent(new CustomEvent('sv:openAuthModal')); return; }
        const id = btn.dataset.id;
        await dislikeComment(this._seriesId, id);
        const span = btn.querySelector('span');
        if (span) span.textContent = +span.textContent + 1;
        btn.style.color = 'var(--text-3)';
      });
    });

    // Report
    c.querySelectorAll('.c-report').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!currentUser) { document.dispatchEvent(new CustomEvent('sv:openAuthModal')); return; }
        if (btn.dataset.reported) return;
        const id = btn.dataset.id;
        await reportComment(this._seriesId, id);
        btn.dataset.reported = '1';
        btn.textContent = '✓ Αναφέρθηκε';
        btn.style.color = 'var(--gold)';
        btn.disabled = true;
        document.dispatchEvent(new CustomEvent('sv:toast', { detail: { msg: 'Το σχόλιο αναφέρθηκε.', type: 'info' } }));
      });
    });
  }

  /* ── CSS injection (once) ───────────────────────────────── */

  _injectStyles() {
    if (document.getElementById('sv-comments-styles')) return;
    const style = document.createElement('style');
    style.id = 'sv-comments-styles';
    style.textContent = `
      .comments-wrap { padding: 0 0 2.5rem; }
      .comments-title {
        font-family: var(--font-display, sans-serif);
        font-size: 1.15rem; letter-spacing: .05em;
        color: var(--text-2); margin-bottom: 1.25rem;
        display: flex; align-items: center; gap: .4rem;
      }
      .comments-count {
        font-family: var(--font-body, sans-serif);
        font-size: .72rem; font-weight: 600;
        background: var(--bg-surface); border: 1px solid var(--border);
        color: var(--text-3); padding: 2px 8px;
        border-radius: 20px; vertical-align: middle;
      }
      .comments-auth-gate {
        display: flex; flex-direction: column; align-items: center;
        gap: .75rem; padding: 2rem; text-align: center;
        background: var(--bg-card); border: 1px solid var(--border);
        border-radius: 10px; margin-bottom: 1.5rem;
        color: var(--text-3); font-size: .9rem;
      }
      .comments-input-wrap {
        background: var(--bg-card); border: 1px solid var(--border);
        border-radius: 10px; padding: 1rem;
        margin-bottom: 1.5rem;
      }
      .comment-star-row {
        display: flex; align-items: center; gap: 4px;
        margin-bottom: .5rem;
      }
      .c-star-btn {
        background: none; border: none; cursor: pointer;
        color: var(--text-4); padding: 2px; line-height: 1;
        transition: color .15s, transform .15s;
      }
      .c-star-btn:hover { transform: scale(1.2); }
      .sv-btn-accent {
        padding: .55rem 1.2rem;
        background: var(--accent); color: #fff;
        border: none; border-radius: 6px;
        font-size: .88rem; font-weight: 600;
        cursor: pointer; font-family: inherit;
        transition: opacity .18s;
      }
      .sv-btn-accent:hover { opacity: .88; }
      .sv-btn-accent:disabled { opacity: .5; cursor: not-allowed; }
      .comments-list { display: flex; flex-direction: column; gap: .75rem; }
      .comments-empty { color: var(--text-3); font-size: .9rem; padding: 1rem 0; }
      .comment-item {
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 10px; padding: .9rem 1rem;
        transition: border-color .18s;
      }
      .comment-item:hover { border-color: var(--border-2, rgba(255,255,255,.14)); }
      .comment-item.comment-own { border-color: rgba(229,9,20,.3); }
      .comment-header {
        display: flex; align-items: center; gap: .6rem; margin-bottom: .5rem;
      }
      .comment-meta { display: flex; flex-direction: column; flex: 1; }
      .comment-username { font-size: .84rem; font-weight: 600; color: var(--text-1); }
      .comment-date { font-size: .72rem; color: var(--text-4); }
      .comment-text {
        font-size: .88rem; color: var(--text-2);
        line-height: 1.6; white-space: pre-wrap;
        word-break: break-word; margin-bottom: .6rem;
      }
      .comment-actions { display: flex; align-items: center; gap: .5rem; }
      .comment-action-btn {
        display: inline-flex; align-items: center; gap: 4px;
        background: none; border: none; cursor: pointer;
        font-size: .78rem; color: var(--text-3);
        padding: 4px 8px; border-radius: 5px;
        font-family: inherit;
        transition: background .15s, color .15s;
      }
      .comment-action-btn:hover {
        background: rgba(255,255,255,.06); color: var(--text-1);
      }
      .sv-spinner {
        width: 28px; height: 28px;
        border: 2px solid rgba(255,255,255,.1);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: sv-spin .7s linear infinite;
        display: block;
      }
      @keyframes sv-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }

  _esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}
