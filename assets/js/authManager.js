/* ============================================================
   authManager.js — Central Auth State Manager
   ─────────────────────────────────────────────────────────────
   Single source of truth for authentication state.
   Provides getCurrentUser() and onUserChange(callback).
   Initialized by the router after Firebase loads.
   ============================================================ */

let _session  = null;   /* reference to the Session singleton in app.js */
let _fbModule = null;   /* reference to the loaded firebase module */

/**
 * Initialize the auth manager.
 * Called once by the router after Firebase and Session are ready.
 */
export function initAuthManager(fbModule, session) {
  _fbModule = fbModule;
  _session  = session;
}

/**
 * Returns the currently authenticated Firebase user (or null).
 * Reads from the Session cache which is synced to onAuthStateChanged.
 * Always up-to-date after Session.hydrate() has run.
 */
export function getCurrentUser() {
  /* Session.user is set after hydration; fall back to fb.auth.currentUser
     for the brief window between onAuthStateChanged firing and hydration. */
  return _session?.user ?? _fbModule?.auth?.currentUser ?? null;
}

/**
 * Subscribe to auth state changes.
 * Callback receives the Firebase user (or null) on every change.
 * Uses the document-level 'authStateChanged' custom event for consistency.
 *
 * @param {(user: object|null) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function onUserChange(callback) {
  if (typeof document === 'undefined') return () => {};
  const handler = (e) => {
    try { callback(e.detail?.user ?? null); }
    catch (err) { console.warn('[AuthManager] onUserChange callback error:', err); }
  };
  document.addEventListener('authStateChanged', handler);
  // Fire immediately with current state so caller doesn't miss already-resolved auth
  if (_session?.user !== undefined) {
    queueMicrotask(() => { try { callback(_session?.user ?? null); } catch (_) {} });
  }
  return () => document.removeEventListener('authStateChanged', handler);
}
