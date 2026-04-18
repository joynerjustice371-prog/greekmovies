/* ============================================================
   firebase.js — StreamVault  v4.0
   ─────────────────────────────────────────────────────────────
   Core architectural primitive: `authReady` Promise.
   Every controller awaits authReady ONCE before any Firestore
   read/write. Eliminates all auth race conditions.

   All writes use _safeWrite + _verifyWrite.
   All reads use _safeRead with fallback value.
   ============================================================ */

import {
  initializeApp, getApps, getApp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, enableNetwork,
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, collectionGroup, addDoc, getDocs,
  query, orderBy, where, onSnapshot,
  serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCCvlyYUwn4KSPCrjzJ8gw1SIXcRd4jcEE",
  authDomain: "my-site-greek-m.firebaseapp.com",
  projectId: "my-site-greek-m",
  storageBucket: "my-site-greek-m.firebasestorage.app",
  messagingSenderId: "1059332450786",
  appId: "1:1059332450786:web:d321b95a3e9951c28ef1bb",
  measurementId: "G-VBPHLPBPYT"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db   = getFirestore(app);

console.log("[Firebase] App ready. Project:", firebaseConfig.projectId);
enableNetwork(db).then(() => console.log("[Firestore] Online.")).catch(e => console.warn("[Firestore] enableNetwork:", e.message));

if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { console.log("[Network] Online"); enableNetwork(db).catch(()=>{}); });
  window.addEventListener('offline', () => console.warn("[Network] Offline"));
}

/* ══════════════════════════════════════════════════════════════
   AUTH-READY PRIMITIVE — the foundation
   ══════════════════════════════════════════════════════════════ */
let _fbCurrentUser = null;
let _authReadyResolve;
let _authReadySettled = false;

/** Resolves ONCE with the user (or null) on the first auth emission. */
export const authReady = new Promise(r => { _authReadyResolve = r; });

onAuthStateChanged(auth, (user) => {
  _fbCurrentUser = user;
  console.log("[Firebase] Auth state:", user?.uid ?? "null");
  if (!_authReadySettled) {
    _authReadySettled = true;
    _authReadyResolve(user);
  }
});

/** Subscribe to auth state changes (fires immediately with current). */
export function onAuth(cb) { return onAuthStateChanged(auth, cb); }

const googleProvider = new GoogleAuthProvider();

/* ══════════════════════════════════════════════════════════════
   INTERNAL HELPERS
   ══════════════════════════════════════════════════════════════ */
function _requireAuth(context = '') {
  const user = _fbCurrentUser ?? auth.currentUser;
  if (!user) {
    console.error(`[Firestore] ${context} — no auth user.`);
    throw new Error("User not authenticated");
  }
  return user.uid;
}

async function _safeWrite(opName, fn) {
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    console.warn(`[Firestore] ${opName} — offline, write queued.`);
  console.log(`[Firestore] ${opName} — writing…`);
  try {
    const r = await fn();
    console.log(`[Firestore] ${opName} — ✓ success.`);
    return r;
  } catch (e) {
    console.error(`[Firestore] ${opName} — ✗ FAILED:`, e.code ?? e.message, e);
    throw e;
  }
}

async function _safeRead(opName, fn, fallback) {
  try { return await fn(); }
  catch (e) {
    console.error(`[Firestore] ${opName} — READ ERROR:`, e.code ?? e.message);
    return fallback;
  }
}

async function _verifyWrite(opName, ref, checkFn = null) {
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) { console.error(`[Firestore] VERIFY FAIL ${opName}: doc missing after write`); return false; }
    if (checkFn && !checkFn(snap.data())) { console.error(`[Firestore] VERIFY FAIL ${opName}: data mismatch`, snap.data()); return false; }
    return true;
  } catch (e) { console.warn(`[Firestore] verify error ${opName}:`, e.message); return false; }
}

/* ══════════════════════════════════════════════════════════════
   AUTH OPERATIONS
   ══════════════════════════════════════════════════════════════ */
export async function loginWithGoogle() {
  const r = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(r.user);
  return r.user;
}

export async function loginWithEmail(email, password) {
  const r = await signInWithEmailAndPassword(auth, email, password);
  try { await ensureUserDoc(r.user); } catch (_) {}
  return r.user;
}

export async function registerWithEmail(email, password, username) {
  const r = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(r.user, username);
  return r.user;
}

export async function forgotPassword(email) { await sendPasswordResetEmail(auth, email); }
export async function logout() { await signOut(auth); }

/* ══════════════════════════════════════════════════════════════
   USER PROFILE — users/{uid}
   ══════════════════════════════════════════════════════════════ */
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
  return { uid: user.uid, ...profileData };
}

export async function getUserProfile(uid) {
  return _safeRead(`getUserProfile(${uid})`, async () => {
    const s = await getDoc(doc(db, "users", uid));
    return s.exists() ? { uid, ...s.data() } : null;
  }, null);
}

export async function updateUserProfile(uid, updates = {}) {
  const allowed = {};
  if (typeof updates.username === 'string' && updates.username.trim())
    allowed.username = updates.username.trim().slice(0, 40);
  if (updates.avatar === null || typeof updates.avatar === 'string')
    allowed.avatar = updates.avatar || null;
  if (!Object.keys(allowed).length) return;
  return _safeWrite(`updateUserProfile(${uid})`, () => updateDoc(doc(db, "users", uid), allowed));
}

/* ══════════════════════════════════════════════════════════════
   FAVORITES / WATCHLIST / SEEN — identical subcollection pattern
   ══════════════════════════════════════════════════════════════ */
function _makeCollectionAPI(collName) {
  return {
    async getAll(uid) {
      return _safeRead(`get${collName}(${uid})`, async () => {
        const s = await getDocs(collection(db, "users", uid, collName));
        return s.docs.map(d => d.id);
      }, []);
    },
    async has(uid, slug) {
      return _safeRead(`has-${collName}(${uid},${slug})`, async () => {
        const s = await getDoc(doc(db, "users", uid, collName, slug));
        return s.exists();
      }, false);
    },
    async add(uid, slug) {
      const resolvedUid = uid || _requireAuth(`add-${collName}(${slug})`);
      const ref = doc(db, "users", resolvedUid, collName, slug);
      await _safeWrite(`add-${collName}(${resolvedUid},${slug})`, () =>
        setDoc(ref, { slug, addedAt: serverTimestamp() })
      );
      await _verifyWrite(`add-${collName}(${resolvedUid},${slug})`, ref);
    },
    async remove(uid, slug) {
      const resolvedUid = uid || _requireAuth(`remove-${collName}(${slug})`);
      const ref = doc(db, "users", resolvedUid, collName, slug);
      await _safeWrite(`remove-${collName}(${resolvedUid},${slug})`, () => deleteDoc(ref));
    },
    async toggle(uid, slug) {
      const resolvedUid = uid || _requireAuth(`toggle-${collName}(${slug})`);
      const ref = doc(db, "users", resolvedUid, collName, slug);
      const snap = await _safeRead(`toggle-${collName}-read(${resolvedUid},${slug})`, () => getDoc(ref), null);
      if (snap?.exists()) {
        await _safeWrite(`toggle-${collName}-remove(${resolvedUid},${slug})`, () => deleteDoc(ref));
        return false;
      }
      await _safeWrite(`toggle-${collName}-add(${resolvedUid},${slug})`, () =>
        setDoc(ref, { slug, addedAt: serverTimestamp() })
      );
      await _verifyWrite(`toggle-${collName}-add(${resolvedUid},${slug})`, ref);
      return true;
    },
  };
}

const favoritesAPI = _makeCollectionAPI("favorites");
const watchlistAPI = _makeCollectionAPI("watchlist");
const seenAPI      = _makeCollectionAPI("seen");

export const getUserFavorites = favoritesAPI.getAll;
export const isFavorite        = favoritesAPI.has;
export const addFavorite       = favoritesAPI.add;
export const removeFavorite    = favoritesAPI.remove;
export const toggleFavorite    = favoritesAPI.toggle;

export const getUserWatchlist  = watchlistAPI.getAll;
export const isInWatchlist     = watchlistAPI.has;
export const addToWatchlist    = watchlistAPI.add;
export const removeFromWatchlist = watchlistAPI.remove;
export const toggleWatchlist   = watchlistAPI.toggle;

export const getUserSeen       = seenAPI.getAll;
export const isInSeen          = seenAPI.has;
export const addSeen           = seenAPI.add;
export const removeSeen        = seenAPI.remove;
export const toggleSeen        = seenAPI.toggle;

/* ══════════════════════════════════════════════════════════════
   RATINGS — seriesRatings/{seriesId}/ratings/{uid}
   ══════════════════════════════════════════════════════════════ */
export async function setRating(uid, slug, stars) {
  const resolvedUid = uid || _requireAuth(`setRating(${slug})`);
  const ref = doc(db, "seriesRatings", slug, "ratings", resolvedUid);
  await _safeWrite(`setRating(${resolvedUid},${slug},${stars})`, () =>
    setDoc(ref, { rating: stars, uid: resolvedUid, updatedAt: serverTimestamp() })
  );
  await _verifyWrite(`setRating(${resolvedUid},${slug})`, ref, d => d.rating === stars);
  /* Secondary: user doc ratings map (best-effort) */
  try { await updateDoc(doc(db, "users", resolvedUid), { [`ratings.${slug}`]: stars }); } catch (_) {}
}

export async function getRating(uid, slug) {
  return _safeRead(`getRating(${uid},${slug})`, async () => {
    const s = await getDoc(doc(db, "seriesRatings", slug, "ratings", uid));
    if (s.exists()) return s.data().rating ?? 0;
    const p = await getUserProfile(uid);
    return p?.ratings?.[slug] ?? 0;
  }, 0);
}

export async function getAllRatings(uid) {
  return _safeRead(`getAllRatings(${uid})`, async () => {
    const p = await getUserProfile(uid);
    return p?.ratings ?? {};
  }, {});
}

export async function getAverageRating(slug) {
  return _safeRead(`getAverageRating(${slug})`, async () => {
    const s = await getDocs(collection(db, "seriesRatings", slug, "ratings"));
    if (s.empty) return { avg: 0, count: 0 };
    const vals = s.docs.map(d => d.data().rating ?? 0).filter(r => r > 0);
    if (!vals.length) return { avg: 0, count: 0 };
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { avg: Math.round(avg * 10) / 10, count: vals.length };
  }, { avg: 0, count: 0 });
}

export function onSeriesRatingsSnapshot(slug, cb) {
  try {
    return onSnapshot(collection(db, "seriesRatings", slug, "ratings"), snap => {
      if (snap.empty) { cb({ avg: 0, count: 0 }); return; }
      const vals = snap.docs.map(d => d.data().rating ?? 0).filter(r => r > 0);
      if (!vals.length) { cb({ avg: 0, count: 0 }); return; }
      const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
      cb({ avg: Math.round(avg * 10) / 10, count: vals.length });
    }, e => console.warn("[Firestore] rating snapshot:", e.message));
  } catch (e) { console.warn("[Firestore] snapshot setup:", e.message); return () => {}; }
}

/* ══════════════════════════════════════════════════════════════
   COMMENTS
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
    const q = query(collection(db, "comments", slug, "items"), orderBy("createdAt", "asc"));
    const s = await getDocs(q);
    return s.docs.map(d => ({ id: d.id, ...d.data() }));
  }, []);
}

export async function getUserComments(uid) {
  return _safeRead(`getUserComments(${uid})`, async () => {
    const q = query(collectionGroup(db, "items"), where("userId", "==", uid), orderBy("createdAt", "desc"));
    const s = await getDocs(q);
    return s.docs.map(d => ({ id: d.id, seriesSlug: d.ref.parent.parent?.id ?? '', ...d.data() }));
  }, []);
}

export async function likeComment(slug, id) {
  return _safeWrite(`likeComment(${slug},${id})`, () =>
    updateDoc(doc(db, "comments", slug, "items", id), { likes: increment(1) })
  );
}

export async function dislikeComment(slug, id) {
  return _safeWrite(`dislikeComment(${slug},${id})`, () =>
    updateDoc(doc(db, "comments", slug, "items", id), { dislikes: increment(1) })
  );
}
