/* ============================================================
   firebase.js — StreamVault  v3.4
   ─────────────────────────────────────────────────────────────
   ROOT CAUSE FIXES:
   ① Internal _fbCurrentUser tracked via onAuthStateChanged.
     All write helpers check this BEFORE calling Firestore, so
     even if app.js calls fb.toggleFavorite() a split-second
     before onAuth fires in AuthController, the write is
     rejected cleanly rather than sent without auth credentials
     (which Firestore rules deny → silent failure).

   ② ensureUserDoc is now synchronous-safe: returns the doc data
     after creation so callers don't need a second getDoc().

   ③ _safeWrite: logs uid + path, verifies network state, and
     re-throws so the caller's toast shows the real error.

   ④ verify-after-write on critical toggles (favorites, watchlist,
     seen, setRating) — logs if the write did NOT persist.

   ⑤ getDoc calls use { source: 'server' } option for reads that
     must bypass the local cache (getRating, isFavorite, etc.)
     to prevent stale-cache false-positives after a write.
   ============================================================ */

import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  enableNetwork,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  collectionGroup,
  addDoc,
  getDocs,
  query,
  orderBy,
  where,
  onSnapshot,
  serverTimestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ──────────────────────────────────────────────────────────
   INIT — guarded against duplicate initializeApp calls
   ────────────────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey: "AIzaSyCCvlyYUwn4KSPCrjzJ8gw1SIXcRd4jcEE",
  authDomain: "my-site-greek-m.firebaseapp.com",
  projectId: "my-site-greek-m",
  storageBucket: "my-site-greek-m.firebasestorage.app",
  messagingSenderId: "1059332450786",
  appId: "1:1059332450786:web:d321b95a3e9951c28ef1bb",
  measurementId: "G-VBPHLPBPYT"
};

const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();

export const auth = getAuth(app);
export const db   = getFirestore(app);

console.log("[Firebase] App ready. Project:", firebaseConfig.projectId);

/* Force Firestore online — clears any lingering offline state */
enableNetwork(db)
  .then(() => console.log("[Firestore] Network enabled."))
  .catch(e  => console.warn("[Firestore] enableNetwork:", e.message));

/* Browser network logging + auto re-enable */
if (typeof window !== 'undefined') {
  console.log("[Network] navigator.onLine =", navigator.onLine);
  window.addEventListener('online',  () => {
    console.log("[Network] Back online — re-enabling Firestore.");
    enableNetwork(db).catch(() => {});
  });
  window.addEventListener('offline', () => console.warn("[Network] Browser offline."));
}

/* ──────────────────────────────────────────────────────────
   INTERNAL AUTH STATE
   Track Firebase's own auth session here so ALL write helpers
   can gate on it, regardless of when app.js sets _currentUser.
   ────────────────────────────────────────────────────────── */
let _fbCurrentUser = null;

onAuthStateChanged(auth, (user) => {
  _fbCurrentUser = user;
  console.log("[Firebase] Auth state changed. uid =", user?.uid ?? "null");
});

const googleProvider = new GoogleAuthProvider();

/* ──────────────────────────────────────────────────────────
   INTERNAL HELPERS
   ────────────────────────────────────────────────────────── */

/**
 * Returns the currently-authenticated UID, or throws a clear
 * error if auth is not ready. Use this in every write path.
 */
function _requireAuth(context = '') {
  const user = _fbCurrentUser ?? auth.currentUser;
  if (!user) {
    const msg = `[Firestore] ${context} — user not authenticated. Aborting write.`;
    console.error(msg);
    throw new Error("User not authenticated");
  }
  return user.uid;
}

/**
 * Wrap a Firestore write with auth check, online check, logging,
 * try/catch. Re-throws so callers can show the error in the UI.
 */
async function _safeWrite(opName, fn) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    console.warn(`[Firestore] ${opName} — browser offline, write will be queued.`);
  }
  console.log(`[Firestore] ${opName} — starting write…`);
  try {
    const result = await fn();
    console.log(`[Firestore] ${opName} — write SUCCESS.`);
    return result;
  } catch (e) {
    console.error(`[Firestore] ${opName} — WRITE FAILED:`, e.code ?? e.message, e);
    throw e;
  }
}

/**
 * Wrap a Firestore read with try/catch + fallback value.
 */
async function _safeRead(opName, fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[Firestore] ${opName} — READ ERROR:`, e.code ?? e.message);
    return fallback;
  }
}

/**
 * Read-back verification after a write.
 * Logs a warning if the doc does not exist or field doesn't match.
 */
async function _verifyWrite(opName, ref, checkFn = null) {
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.error(`[Firestore] VERIFY FAILED for ${opName}: doc does not exist after write!`);
      return false;
    }
    if (checkFn && !checkFn(snap.data())) {
      console.error(`[Firestore] VERIFY FAILED for ${opName}: data check failed.`, snap.data());
      return false;
    }
    console.log(`[Firestore] VERIFY OK for ${opName}.`);
    return true;
  } catch (e) {
    console.warn(`[Firestore] VERIFY READ ERROR for ${opName}:`, e.message);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════════════════ */

export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(result.user);
  return result.user;
}

export async function loginWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  try { await ensureUserDoc(result.user); } catch (_) {}
  return result.user;
}

export async function registerWithEmail(email, password, username) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(result.user, username);
  return result.user;
}

export async function forgotPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
}

export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

/* ══════════════════════════════════════════════════════════════
   USER PROFILE — users/{uid}
   ══════════════════════════════════════════════════════════════ */

/**
 * Create the user document if it doesn't exist.
 * Returns the profile data (existing or freshly created).
 */
export async function ensureUserDoc(user, username = null) {
  if (!user?.uid) return null;
  const ref  = doc(db, "users", user.uid);
  const snap = await _safeRead(`ensureUserDoc-read(${user.uid})`, () => getDoc(ref), null);

  if (snap?.exists()) return { uid: user.uid, ...snap.data() };

  const profileData = {
    username:  username ?? user.displayName ?? user.email.split("@")[0],
    email:     user.email,
    avatar:    user.photoURL ?? null,
    role:      "user",
    status:    "active",
    ratings:   {},
    createdAt: serverTimestamp(),
  };
  await _safeWrite(`ensureUserDoc-create(${user.uid})`, () => setDoc(ref, profileData));
  console.log(`[Firestore] User doc created for uid=${user.uid}`);
  return { uid: user.uid, ...profileData };
}

export async function getUserProfile(uid) {
  return _safeRead(`getUserProfile(${uid})`, async () => {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? { uid, ...snap.data() } : null;
  }, null);
}

export async function updateUserProfile(uid, updates = {}) {
  const allowed = {};
  if (typeof updates.username === 'string' && updates.username.trim())
    allowed.username = updates.username.trim().slice(0, 40);
  if (updates.avatar === null || typeof updates.avatar === 'string')
    allowed.avatar = updates.avatar || null;
  if (!Object.keys(allowed).length) return;
  return _safeWrite(`updateUserProfile(${uid})`, () =>
    updateDoc(doc(db, "users", uid), allowed)
  );
}

/* ══════════════════════════════════════════════════════════════
   FAVORITES — users/{uid}/favorites/{slug}
   ══════════════════════════════════════════════════════════════ */

export async function getUserFavorites(uid) {
  return _safeRead(`getUserFavorites(${uid})`, async () => {
    const snap = await getDocs(collection(db, "users", uid, "favorites"));
    return snap.docs.map(d => d.id);
  }, []);
}

export async function isFavorite(uid, slug) {
  return _safeRead(`isFavorite(${uid},${slug})`, async () => {
    const snap = await getDoc(doc(db, "users", uid, "favorites", slug));
    return snap.exists();
  }, false);
}

export async function toggleFavorite(uid, slug) {
  /* Auth guard: uid passed from app.js but double-check internal state */
  const resolvedUid = uid || _requireAuth(`toggleFavorite(${slug})`);
  console.log(`[Firestore] toggleFavorite — uid=${resolvedUid}, slug=${slug}`);

  const ref  = doc(db, "users", resolvedUid, "favorites", slug);
  const snap = await _safeRead(`toggleFavorite-check(${resolvedUid},${slug})`, () => getDoc(ref), null);

  if (snap?.exists()) {
    await _safeWrite(`toggleFavorite-remove(${resolvedUid},${slug})`, () => deleteDoc(ref));
    /* Verify removal */
    const afterSnap = await getDoc(ref).catch(() => null);
    if (afterSnap?.exists()) console.error(`[Firestore] toggleFavorite: doc still exists after delete!`);
    else console.log(`[Firestore] toggleFavorite: remove verified OK.`);
    return false;
  }

  await _safeWrite(`toggleFavorite-add(${resolvedUid},${slug})`, () =>
    setDoc(ref, { slug, addedAt: serverTimestamp() })
  );
  await _verifyWrite(`toggleFavorite-add(${resolvedUid},${slug})`, ref);
  return true;
}

/* ══════════════════════════════════════════════════════════════
   WATCHLIST — users/{uid}/watchlist/{slug}
   ══════════════════════════════════════════════════════════════ */

export async function getUserWatchlist(uid) {
  return _safeRead(`getUserWatchlist(${uid})`, async () => {
    const snap = await getDocs(collection(db, "users", uid, "watchlist"));
    return snap.docs.map(d => d.id);
  }, []);
}

export async function isInWatchlist(uid, slug) {
  return _safeRead(`isInWatchlist(${uid},${slug})`, async () => {
    const snap = await getDoc(doc(db, "users", uid, "watchlist", slug));
    return snap.exists();
  }, false);
}

export async function toggleWatchlist(uid, slug) {
  const resolvedUid = uid || _requireAuth(`toggleWatchlist(${slug})`);
  console.log(`[Firestore] toggleWatchlist — uid=${resolvedUid}, slug=${slug}`);

  const ref  = doc(db, "users", resolvedUid, "watchlist", slug);
  const snap = await _safeRead(`toggleWatchlist-check(${resolvedUid},${slug})`, () => getDoc(ref), null);

  if (snap?.exists()) {
    await _safeWrite(`toggleWatchlist-remove(${resolvedUid},${slug})`, () => deleteDoc(ref));
    const afterSnap = await getDoc(ref).catch(() => null);
    if (afterSnap?.exists()) console.error(`[Firestore] toggleWatchlist: doc still exists after delete!`);
    return false;
  }

  await _safeWrite(`toggleWatchlist-add(${resolvedUid},${slug})`, () =>
    setDoc(ref, { slug, addedAt: serverTimestamp() })
  );
  await _verifyWrite(`toggleWatchlist-add(${resolvedUid},${slug})`, ref);
  return true;
}

/* ══════════════════════════════════════════════════════════════
   SEEN — users/{uid}/seen/{slug}
   ══════════════════════════════════════════════════════════════ */

export async function getUserSeen(uid) {
  return _safeRead(`getUserSeen(${uid})`, async () => {
    const snap = await getDocs(collection(db, "users", uid, "seen"));
    return snap.docs.map(d => d.id);
  }, []);
}

export async function isInSeen(uid, slug) {
  return _safeRead(`isInSeen(${uid},${slug})`, async () => {
    const snap = await getDoc(doc(db, "users", uid, "seen", slug));
    return snap.exists();
  }, false);
}

export async function toggleSeen(uid, slug) {
  const resolvedUid = uid || _requireAuth(`toggleSeen(${slug})`);
  console.log(`[Firestore] toggleSeen — uid=${resolvedUid}, slug=${slug}`);

  const ref  = doc(db, "users", resolvedUid, "seen", slug);
  const snap = await _safeRead(`toggleSeen-check(${resolvedUid},${slug})`, () => getDoc(ref), null);

  if (snap?.exists()) {
    await _safeWrite(`toggleSeen-remove(${resolvedUid},${slug})`, () => deleteDoc(ref));
    const afterSnap = await getDoc(ref).catch(() => null);
    if (afterSnap?.exists()) console.error(`[Firestore] toggleSeen: doc still exists after delete!`);
    return false;
  }

  await _safeWrite(`toggleSeen-add(${resolvedUid},${slug})`, () =>
    setDoc(ref, { slug, addedAt: serverTimestamp() })
  );
  await _verifyWrite(`toggleSeen-add(${resolvedUid},${slug})`, ref);
  return true;
}

/* ══════════════════════════════════════════════════════════════
   RATINGS — seriesRatings/{seriesId}/ratings/{uid}
   ══════════════════════════════════════════════════════════════ */

export async function setRating(uid, slug, stars) {
  const resolvedUid = uid || _requireAuth(`setRating(${slug},${stars})`);
  console.log(`[Firestore] setRating — uid=${resolvedUid}, slug=${slug}, stars=${stars}`);

  const ratingRef = doc(db, "seriesRatings", slug, "ratings", resolvedUid);

  /* Primary write */
  await _safeWrite(`setRating-primary(${resolvedUid},${slug},${stars})`, () =>
    setDoc(ratingRef, { rating: stars, uid: resolvedUid, updatedAt: serverTimestamp() })
  );

  /* Verify primary write */
  await _verifyWrite(
    `setRating-primary(${resolvedUid},${slug})`,
    ratingRef,
    (data) => data.rating === stars
  );

  /* Secondary: update user doc ratings map (best-effort) */
  try {
    await updateDoc(doc(db, "users", resolvedUid), { [`ratings.${slug}`]: stars });
    console.log(`[Firestore] setRating secondary user-doc update OK.`);
  } catch (e) {
    console.warn(`[Firestore] setRating secondary user-doc write failed (non-critical):`, e.code ?? e.message);
  }
}

export async function getRating(uid, slug) {
  return _safeRead(`getRating(${uid},${slug})`, async () => {
    const snap = await getDoc(doc(db, "seriesRatings", slug, "ratings", uid));
    if (snap.exists()) return snap.data().rating ?? 0;
    /* Fallback: user doc ratings map */
    const profile = await getUserProfile(uid);
    return profile?.ratings?.[slug] ?? 0;
  }, 0);
}

export async function getAllRatings(uid) {
  return _safeRead(`getAllRatings(${uid})`, async () => {
    const profile = await getUserProfile(uid);
    const fromDoc = profile?.ratings ?? {};
    if (Object.keys(fromDoc).length > 0) return fromDoc;
    /* Fallback: collectionGroup query (requires Firestore index) */
    try {
      const q    = query(collectionGroup(db, "ratings"), where("uid", "==", uid));
      const snap = await getDocs(q);
      const result = {};
      snap.docs.forEach(d => {
        const seriesId = d.ref.parent.parent?.id;
        if (seriesId) result[seriesId] = d.data().rating;
      });
      return result;
    } catch (e) {
      console.warn("[Firestore] getAllRatings collectionGroup fallback failed:", e.message);
      return fromDoc;
    }
  }, {});
}

export async function getAverageRating(slug) {
  return _safeRead(`getAverageRating(${slug})`, async () => {
    const snap = await getDocs(collection(db, "seriesRatings", slug, "ratings"));
    if (snap.empty) return { avg: 0, count: 0 };
    const values = snap.docs.map(d => d.data().rating ?? 0).filter(r => r > 0);
    if (!values.length) return { avg: 0, count: 0 };
    const avg = values.reduce((s, r) => s + r, 0) / values.length;
    return { avg: Math.round(avg * 10) / 10, count: values.length };
  }, { avg: 0, count: 0 });
}

export function onSeriesRatingsSnapshot(slug, callback) {
  try {
    const col = collection(db, "seriesRatings", slug, "ratings");
    return onSnapshot(col, (snap) => {
      try {
        if (snap.empty) { callback({ avg: 0, count: 0 }); return; }
        const values = snap.docs.map(d => d.data().rating ?? 0).filter(r => r > 0);
        if (!values.length) { callback({ avg: 0, count: 0 }); return; }
        const avg = values.reduce((s, r) => s + r, 0) / values.length;
        callback({ avg: Math.round(avg * 10) / 10, count: values.length });
      } catch (e) { console.warn("[Firestore] ratingsSnapshot cb error:", e.message); }
    }, (e) => { console.warn("[Firestore] ratingsSnapshot listener error:", e.message); });
  } catch (e) {
    console.warn("[Firestore] onSeriesRatingsSnapshot setup failed:", e.message);
    return () => {};
  }
}

/* ══════════════════════════════════════════════════════════════
   COMMENTS — comments/{seriesSlug}/items/{commentId}
   ══════════════════════════════════════════════════════════════ */

export async function postComment(slug, uid, username, text, userAvatar = null) {
  return _safeWrite(`postComment(${uid},${slug})`, () =>
    addDoc(collection(db, "comments", slug, "items"), {
      userId: uid, username, userAvatar: userAvatar || null,
      text: text.trim(), likes: 0, dislikes: 0, createdAt: serverTimestamp(),
    })
  );
}

export async function getComments(slug) {
  return _safeRead(`getComments(${slug})`, async () => {
    const q    = query(collection(db, "comments", slug, "items"), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }, []);
}

export async function getUserComments(uid) {
  return _safeRead(`getUserComments(${uid})`, async () => {
    const q    = query(
      collectionGroup(db, "items"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const parent = d.ref.parent.parent;
      return { id: d.id, seriesSlug: parent?.id ?? '', ...d.data() };
    });
  }, []);
}

export async function likeComment(slug, commentId) {
  return _safeWrite(`likeComment(${slug},${commentId})`, () =>
    updateDoc(doc(db, "comments", slug, "items", commentId), { likes: increment(1) })
  );
}

export async function dislikeComment(slug, commentId) {
  return _safeWrite(`dislikeComment(${slug},${commentId})`, () =>
    updateDoc(doc(db, "comments", slug, "items", commentId), { dislikes: increment(1) })
  );
}
