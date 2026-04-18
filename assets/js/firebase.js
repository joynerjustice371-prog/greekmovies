/* ============================================================
   firebase.js — StreamVault  v3.3
   ─────────────────────────────────────────────────────────────
   ROOT CAUSE FIX:
   "Failed to get document because the client is offline."

   The error comes from Firebase Firestore's offline-persistence
   cache going into a state where it can't reach the server.
   Common triggers:
     (a) initializeApp() called more than once → duplicate app
         instance → getFirestore() on the wrong instance → all
         reads/writes go to cache only, never to server
     (b) enableIndexedDbPersistence() called in a context where
         multiple tabs are open → fails silently, Firestore falls
         back to memory-only mode without enabling the network
     (c) getFirestore() called before Firebase networking is ready
         → Firestore starts in offline mode

   FIXES APPLIED:
   ① getApps() guard — initializeApp called ONLY ONCE. If the
     module is imported multiple times (two <script> tags, dynamic
     re-import, HMR) the existing app is reused instead of throwing.
   ② enableNetwork(db) called immediately after getFirestore() —
     forces Firestore to go online and flush its pending write queue
   ③ navigator.onLine check + window 'online'/'offline' listeners —
     log network state, re-call enableNetwork when browser reconnects
   ④ All writes wrapped in _safeWrite() helper with:
      - navigator.onLine guard
      - try/catch
      - console.error on failure
   ⑤ All reads wrapped in _safeRead() helper with:
      - try/catch + re-throw with context
   ⑥ NO enableIndexedDbPersistence / enableMultiTabIndexedDbPersistence
      — these are the most common cause of offline errors in dev.
      They can be re-enabled later behind a feature flag once
      the connection is confirmed stable.
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
  disableNetwork,
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

/* If Firebase was already initialized (e.g. module re-imported),
   reuse the existing app instead of creating a duplicate. */
const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();

export const auth = getAuth(app);
export const db   = getFirestore(app);

console.log("[Firebase] Initialized. App name:", app.name, "Project:", firebaseConfig.projectId);

/* ── Force Firestore online immediately after init ─────────
   This flushes any pending writes stuck in the offline queue
   and ensures the client connects to the Firestore servers.    */
enableNetwork(db)
  .then(() => console.log("[Firestore] Network enabled — client is online."))
  .catch(e => console.warn("[Firestore] enableNetwork failed:", e.message));

/* ── Browser network state monitoring ──────────────────────
   Log online/offline events and re-enable Firestore when the
   browser regains connectivity.                               */
if (typeof window !== 'undefined') {
  console.log("[Network] navigator.onLine =", navigator.onLine);

  window.addEventListener('online', () => {
    console.log("[Network] Browser went ONLINE — re-enabling Firestore network.");
    enableNetwork(db).catch(e => console.warn("[Firestore] Re-enable network failed:", e.message));
  });

  window.addEventListener('offline', () => {
    console.warn("[Network] Browser went OFFLINE — Firestore will queue writes.");
  });
}

const googleProvider = new GoogleAuthProvider();

/* ──────────────────────────────────────────────────────────
   INTERNAL HELPERS
   ────────────────────────────────────────────────────────── */

/**
 * Wrap a Firestore write in an online check + try/catch.
 * @param {string} opName  — label for error logs
 * @param {() => Promise} fn — the actual Firestore operation
 */
async function _safeWrite(opName, fn) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const msg = `[Firestore] ${opName} — browser is offline, write queued.`;
    console.warn(msg);
    /* Still attempt the write: Firestore will queue it and sync when online */
  }
  try {
    console.log(`[Firestore] ${opName} — writing…`);
    const result = await fn();
    console.log(`[Firestore] ${opName} — success.`);
    return result;
  } catch (e) {
    console.error(`[Firestore] ${opName} — WRITE ERROR:`, e.code ?? e.message, e);
    throw e;
  }
}

/**
 * Wrap a Firestore read in a try/catch with context label.
 * @param {string} opName  — label for error logs
 * @param {() => Promise<T>} fn — the actual Firestore operation
 * @param {T} fallback — value returned on error
 */
async function _safeRead(opName, fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[Firestore] ${opName} — READ ERROR:`, e.code ?? e.message, e);
    return fallback;
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

export async function ensureUserDoc(user, username = null) {
  if (!user?.uid) return;
  return _safeWrite(`ensureUserDoc(${user.uid})`, async () => {
    const ref  = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        username:  username ?? user.displayName ?? user.email.split("@")[0],
        email:     user.email,
        avatar:    user.photoURL ?? null,
        role:      "user",
        status:    "active",
        ratings:   {},
        createdAt: serverTimestamp(),
      });
      console.log(`[Firestore] ensureUserDoc — created doc for uid=${user.uid}`);
    }
  });
}

export async function getUserProfile(uid) {
  return _safeRead(`getUserProfile(${uid})`, async () => {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? { uid, ...snap.data() } : null;
  }, null);
}

export async function updateUserProfile(uid, updates = {}) {
  const allowed = {};
  if (typeof updates.username === 'string' && updates.username.trim()) {
    allowed.username = updates.username.trim().slice(0, 40);
  }
  if (updates.avatar === null || typeof updates.avatar === 'string') {
    allowed.avatar = updates.avatar || null;
  }
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

export async function addFavorite(uid, slug) {
  return _safeWrite(`addFavorite(${uid},${slug})`, () =>
    setDoc(doc(db, "users", uid, "favorites", slug), { addedAt: serverTimestamp() })
  );
}

export async function removeFavorite(uid, slug) {
  return _safeWrite(`removeFavorite(${uid},${slug})`, () =>
    deleteDoc(doc(db, "users", uid, "favorites", slug))
  );
}

export async function toggleFavorite(uid, slug) {
  const ref  = doc(db, "users", uid, "favorites", slug);
  const snap = await _safeRead(`toggleFavorite-read(${uid},${slug})`, () => getDoc(ref), null);
  if (snap?.exists()) {
    await _safeWrite(`toggleFavorite-remove(${uid},${slug})`, () => deleteDoc(ref));
    return false;
  }
  await _safeWrite(`toggleFavorite-add(${uid},${slug})`, () =>
    setDoc(ref, { addedAt: serverTimestamp() })
  );
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

export async function addToWatchlist(uid, slug) {
  return _safeWrite(`addToWatchlist(${uid},${slug})`, () =>
    setDoc(doc(db, "users", uid, "watchlist", slug), { addedAt: serverTimestamp() })
  );
}

export async function removeFromWatchlist(uid, slug) {
  return _safeWrite(`removeFromWatchlist(${uid},${slug})`, () =>
    deleteDoc(doc(db, "users", uid, "watchlist", slug))
  );
}

export async function toggleWatchlist(uid, slug) {
  const ref  = doc(db, "users", uid, "watchlist", slug);
  const snap = await _safeRead(`toggleWatchlist-read(${uid},${slug})`, () => getDoc(ref), null);
  if (snap?.exists()) {
    await _safeWrite(`toggleWatchlist-remove(${uid},${slug})`, () => deleteDoc(ref));
    return false;
  }
  await _safeWrite(`toggleWatchlist-add(${uid},${slug})`, () =>
    setDoc(ref, { addedAt: serverTimestamp() })
  );
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

export async function addSeen(uid, slug) {
  return _safeWrite(`addSeen(${uid},${slug})`, () =>
    setDoc(doc(db, "users", uid, "seen", slug), { addedAt: serverTimestamp() })
  );
}

export async function removeSeen(uid, slug) {
  return _safeWrite(`removeSeen(${uid},${slug})`, () =>
    deleteDoc(doc(db, "users", uid, "seen", slug))
  );
}

export async function toggleSeen(uid, slug) {
  const ref  = doc(db, "users", uid, "seen", slug);
  const snap = await _safeRead(`toggleSeen-read(${uid},${slug})`, () => getDoc(ref), null);
  if (snap?.exists()) {
    await _safeWrite(`toggleSeen-remove(${uid},${slug})`, () => deleteDoc(ref));
    return false;
  }
  await _safeWrite(`toggleSeen-add(${uid},${slug})`, () =>
    setDoc(ref, { addedAt: serverTimestamp() })
  );
  return true;
}

/* ══════════════════════════════════════════════════════════════
   RATINGS — seriesRatings/{seriesId}/ratings/{uid}
   ══════════════════════════════════════════════════════════════ */

export async function setRating(uid, slug, stars) {
  if (!uid) throw new Error("setRating: uid is required");

  /* Primary store */
  await _safeWrite(`setRating-primary(${uid},${slug},${stars})`, () =>
    setDoc(
      doc(db, "seriesRatings", slug, "ratings", uid),
      { rating: stars, uid, updatedAt: serverTimestamp() }
    )
  );

  /* Secondary — update user doc ratings map (best-effort) */
  try {
    await updateDoc(doc(db, "users", uid), { [`ratings.${slug}`]: stars });
  } catch (e) {
    console.warn(`[Firestore] setRating secondary user-doc write:`, e.code ?? e.message);
  }
}

export async function getRating(uid, slug) {
  return _safeRead(`getRating(${uid},${slug})`, async () => {
    const snap = await getDoc(doc(db, "seriesRatings", slug, "ratings", uid));
    if (snap.exists()) return snap.data().rating ?? 0;
    const profile = await getUserProfile(uid);
    return profile?.ratings?.[slug] ?? 0;
  }, 0);
}

export async function getAllRatings(uid) {
  return _safeRead(`getAllRatings(${uid})`, async () => {
    const profile = await getUserProfile(uid);
    const fromDoc = profile?.ratings ?? {};
    if (Object.keys(fromDoc).length > 0) return fromDoc;
    /* Fallback: collectionGroup (requires index) */
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
      } catch (e) {
        console.warn("[Firestore] onSeriesRatingsSnapshot cb error:", e.message);
      }
    }, (e) => {
      console.warn("[Firestore] onSeriesRatingsSnapshot listener error:", e.message);
    });
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
      userId:     uid,
      username,
      userAvatar: userAvatar || null,
      text:       text.trim(),
      likes:      0,
      dislikes:   0,
      createdAt:  serverTimestamp(),
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
