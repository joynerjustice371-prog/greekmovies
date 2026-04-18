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
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    console.warn(`[Firestore] ${opName} — OFFLINE, write will be queued.`);
  }
  console.log(`[Firestore] ${opName} — writing…`);
  try {
    const r = await fn();
    console.log(`[Firestore] ${opName} — ✓ write call resolved.`);
    return r;
  } catch (e) {
    const code = e.code ?? 'unknown';
    console.error(`[Firestore] ${opName} — ✗ WRITE FAILED:`, code, e.message);
    if (code === 'permission-denied') {
      console.error(`[Firestore] PERMISSION DENIED — check Firestore rules for this path. User not authorized.`);
      throw new Error(`Δεν έχετε δικαίωμα για αυτή την ενέργεια (permission-denied).`);
    }
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

/**
 * MANDATORY write verification — reads back and THROWS if not persisted.
 * Proves the write actually committed to the server, not just cache.
 */
async function _verifyWrite(opName, ref, checkFn = null) {
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.error(`[Firestore] ${opName} — ✗ VERIFY FAILED: doc does not exist after write!`);
    throw new Error(`Η εγγραφή δεν αποθηκεύτηκε (${opName}).`);
  }
  if (checkFn && !checkFn(snap.data())) {
    console.error(`[Firestore] ${opName} — ✗ VERIFY FAILED: data mismatch`, snap.data());
    throw new Error(`Η εγγραφή έγινε αλλά με λάθος δεδομένα (${opName}).`);
  }
  console.log(`[Firestore] ${opName} — ✓ VERIFIED (read-back OK)`);
  return true;
}

/**
 * MANDATORY: returns the currently authenticated user or throws a clear
 * error. Use before every write operation.
 */
function _requireUser(context = '') {
  const user = auth.currentUser ?? _fbCurrentUser;
  if (!user?.uid) {
    console.error(`[Firestore] ${context} — NO AUTHENTICATED USER. Aborting write.`);
    throw new Error('Πρέπει να είστε συνδεδεμένοι.');
  }
  console.log(`[Firestore] ${context} — auth user:`, user.uid);
  return user;
}

/* ══════════════════════════════════════════════════════════════
   AUTH OPERATIONS
   ══════════════════════════════════════════════════════════════ */
export async function loginWithGoogle() {
  const r = await signInWithPopup(auth, googleProvider);
  /* Swallow ensureUserDoc errors — Firestore failure must NOT prevent modal closing */
  try { await ensureUserDoc(r.user); } catch (e) { console.warn('[Firebase] loginWithGoogle ensureUserDoc:', e.message); }
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
      /* Enforce auth from live Firebase SDK, ignore passed uid if different */
      const user = _requireUser(`add-${collName}(${slug})`);
      const authedUid = user.uid;
      const path = `users/${authedUid}/${collName}/${slug}`;
      const ref  = doc(db, "users", authedUid, collName, slug);
      console.log(`[Firestore] add-${collName} PATH:`, path);
      await _safeWrite(`add-${collName}(${authedUid},${slug})`, () =>
        setDoc(ref, { slug, addedAt: serverTimestamp() })
      );
      /* Mandatory verify — throws if not persisted */
      await _verifyWrite(`add-${collName}(${authedUid},${slug})`, ref);
    },
    async remove(uid, slug) {
      const user = _requireUser(`remove-${collName}(${slug})`);
      const authedUid = user.uid;
      const path = `users/${authedUid}/${collName}/${slug}`;
      const ref  = doc(db, "users", authedUid, collName, slug);
      console.log(`[Firestore] remove-${collName} PATH:`, path);
      await _safeWrite(`remove-${collName}(${authedUid},${slug})`, () => deleteDoc(ref));
      /* Verify removal */
      const after = await getDoc(ref);
      if (after.exists()) {
        console.error(`[Firestore] remove-${collName} VERIFY FAILED: doc still exists after delete`);
        throw new Error(`Η διαγραφή απέτυχε (${collName}).`);
      }
      console.log(`[Firestore] remove-${collName} VERIFY OK — doc deleted`);
    },
    async toggle(uid, slug) {
      const user = _requireUser(`toggle-${collName}(${slug})`);
      const authedUid = user.uid;
      const path = `users/${authedUid}/${collName}/${slug}`;
      const ref  = doc(db, "users", authedUid, collName, slug);
      console.log(`[Firestore] toggle-${collName} PATH:`, path);

      /* Read current state */
      const snap = await getDoc(ref).catch(e => {
        console.error(`[Firestore] toggle-${collName} pre-read failed:`, e.code ?? e.message);
        throw e;
      });

      if (snap.exists()) {
        /* Currently present → remove */
        await _safeWrite(`toggle-${collName}-remove(${authedUid},${slug})`, () => deleteDoc(ref));
        const after = await getDoc(ref);
        if (after.exists()) {
          console.error(`[Firestore] toggle-${collName} VERIFY FAILED: doc still exists`);
          throw new Error(`Η διαγραφή απέτυχε.`);
        }
        console.log(`[Firestore] toggle-${collName} REMOVED & VERIFIED`);
        return false;
      } else {
        /* Not present → add */
        await _safeWrite(`toggle-${collName}-add(${authedUid},${slug})`, () =>
          setDoc(ref, { slug, addedAt: serverTimestamp() })
        );
        await _verifyWrite(`toggle-${collName}-add(${authedUid},${slug})`, ref,
                           d => d.slug === slug);
        return true;
      }
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
  /* Enforce live auth (uid param ignored if it doesn't match live user) */
  const user = _requireUser(`setRating(${slug})`);
  const authedUid = user.uid;

  /* Explicit integer coercion — Firestore rule requires "rating is int".
     JS number 5 is fine, but we defensively round to be safe. */
  const ratingInt = Math.round(Number(stars));
  if (!Number.isInteger(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    console.error(`[Firestore] setRating INVALID: rating must be int 1-5, got ${stars}`);
    throw new Error(`Μη έγκυρη αξιολόγηση: ${stars}`);
  }

  const path = `seriesRatings/${slug}/ratings/${authedUid}`;
  const ref  = doc(db, "seriesRatings", slug, "ratings", authedUid);
  console.log(`[Firestore] setRating PATH: ${path} RATING: ${ratingInt}`);

  /* Primary write — this is the canonical store for ratings */
  await _safeWrite(`setRating(${authedUid},${slug},${ratingInt})`, () =>
    setDoc(ref, {
      rating:    ratingInt,
      uid:       authedUid,
      updatedAt: serverTimestamp(),
    })
  );

  /* MANDATORY verify — reads back and throws if not persisted */
  await _verifyWrite(`setRating(${authedUid},${slug})`, ref,
                     d => d.rating === ratingInt);

  /* Secondary: mirror to user doc ratings map (for profile tab aggregation).
     Best-effort — a failure here is NON-CRITICAL because seriesRatings is
     the primary store. */
  try {
    await updateDoc(doc(db, "users", authedUid), { [`ratings.${slug}`]: ratingInt });
    console.log(`[Firestore] setRating secondary user-doc update OK`);
  } catch (e) {
    console.warn(`[Firestore] setRating secondary update FAILED (non-critical):`, e.code ?? e.message);
  }

  return ratingInt;
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
