/* ============================================================
   firebase.js — StreamVault  v3.2
   ─────────────────────────────────────────────────────────────
   CHANGES vs v3.1:
   ① favorites / watchlist / seen → subcollections
       users/{uid}/favorites/{slug}
       users/{uid}/watchlist/{slug}
       users/{uid}/seen/{slug}
     Write: setDoc   Read: getDoc/getDocs   Delete: deleteDoc
   ② isFavorite / isInWatchlist / isInSeen — single-doc checks
     (used in SeriesController for parallel Promise.all)
   ③ getUserFavorites / getUserWatchlist / getUserSeen — bulk reads
     (used in ProfileController parallel loading)
   ④ setRating — stores uid field so collectionGroup can filter
   ⑤ getAllRatings — user-doc fast path + collectionGroup fallback
   ============================================================ */

import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
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

const firebaseConfig = {
  apiKey: "AIzaSyCCvlyYUwn4KSPCrjzJ8gw1SIXcRd4jcEE",
  authDomain: "my-site-greek-m.firebaseapp.com",
  projectId: "my-site-greek-m",
  storageBucket: "my-site-greek-m.firebasestorage.app",
  messagingSenderId: "1059332450786",
  appId: "1:1059332450786:web:d321b95a3e9951c28ef1bb",
  measurementId: "G-VBPHLPBPYT"
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

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
   USER PROFILE
   Firestore path: users/{uid}
   ══════════════════════════════════════════════════════════════ */

export async function ensureUserDoc(user, username = null) {
  if (!user?.uid) return;
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
  }
}

export async function getUserProfile(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? { uid, ...snap.data() } : null;
  } catch (e) {
    console.warn("[Firebase] getUserProfile failed:", e.message);
    return null;
  }
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
  await updateDoc(doc(db, "users", uid), allowed);
}

/* ══════════════════════════════════════════════════════════════
   FAVORITES  —  subcollection: users/{uid}/favorites/{slug}
   ══════════════════════════════════════════════════════════════ */

/**
 * Returns all favorite slugs for a user (one getDocs call).
 * Suitable for ProfileController bulk loading.
 */
export async function getUserFavorites(uid) {
  try {
    const snap = await getDocs(collection(db, "users", uid, "favorites"));
    return snap.docs.map(d => d.id);
  } catch (e) {
    console.error("[Firebase] getUserFavorites failed:", e.message);
    return [];
  }
}

/**
 * Returns true/false for a single series.
 * Suitable for SeriesController parallel checks.
 */
export async function isFavorite(uid, slug) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "favorites", slug));
    return snap.exists();
  } catch (e) {
    return false;
  }
}

export async function addFavorite(uid, slug) {
  await setDoc(doc(db, "users", uid, "favorites", slug), {
    addedAt: serverTimestamp(),
  });
}

export async function removeFavorite(uid, slug) {
  await deleteDoc(doc(db, "users", uid, "favorites", slug));
}

export async function toggleFavorite(uid, slug) {
  const ref  = doc(db, "users", uid, "favorites", slug);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    return false; // removed
  }
  await setDoc(ref, { addedAt: serverTimestamp() });
  return true;   // added
}

/* ══════════════════════════════════════════════════════════════
   WATCHLIST  —  subcollection: users/{uid}/watchlist/{slug}
   ══════════════════════════════════════════════════════════════ */

export async function getUserWatchlist(uid) {
  try {
    const snap = await getDocs(collection(db, "users", uid, "watchlist"));
    return snap.docs.map(d => d.id);
  } catch (e) {
    console.error("[Firebase] getUserWatchlist failed:", e.message);
    return [];
  }
}

export async function isInWatchlist(uid, slug) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "watchlist", slug));
    return snap.exists();
  } catch (e) {
    return false;
  }
}

export async function addToWatchlist(uid, slug) {
  await setDoc(doc(db, "users", uid, "watchlist", slug), {
    addedAt: serverTimestamp(),
  });
}

export async function removeFromWatchlist(uid, slug) {
  await deleteDoc(doc(db, "users", uid, "watchlist", slug));
}

export async function toggleWatchlist(uid, slug) {
  const ref  = doc(db, "users", uid, "watchlist", slug);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, { addedAt: serverTimestamp() });
  return true;
}

/* ══════════════════════════════════════════════════════════════
   SEEN  —  subcollection: users/{uid}/seen/{slug}
   ══════════════════════════════════════════════════════════════ */

export async function getUserSeen(uid) {
  try {
    const snap = await getDocs(collection(db, "users", uid, "seen"));
    return snap.docs.map(d => d.id);
  } catch (e) {
    console.error("[Firebase] getUserSeen failed:", e.message);
    return [];
  }
}

export async function isInSeen(uid, slug) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "seen", slug));
    return snap.exists();
  } catch (e) {
    return false;
  }
}

export async function addSeen(uid, slug) {
  await setDoc(doc(db, "users", uid, "seen", slug), {
    addedAt: serverTimestamp(),
  });
}

export async function removeSeen(uid, slug) {
  await deleteDoc(doc(db, "users", uid, "seen", slug));
}

export async function toggleSeen(uid, slug) {
  const ref  = doc(db, "users", uid, "seen", slug);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, { addedAt: serverTimestamp() });
  return true;
}

/* ══════════════════════════════════════════════════════════════
   RATINGS  —  seriesRatings/{seriesId}/ratings/{uid}
   ──────────────────────────────────────────────────────────────
   Primary store: seriesRatings (independent of user doc)
   Secondary store: users/{uid}.ratings map (for profile tab)
   ══════════════════════════════════════════════════════════════ */

/**
 * Save a rating.
 * Primary write → seriesRatings (always, rules are simple).
 * Secondary write → user doc ratings map (best-effort).
 */
export async function setRating(uid, slug, stars) {
  if (!uid) throw new Error("uid required");

  /* Primary — stores uid field for collectionGroup queries */
  await setDoc(
    doc(db, "seriesRatings", slug, "ratings", uid),
    { rating: stars, uid, updatedAt: serverTimestamp() }
  );

  /* Secondary — update user doc ratings map for profile tab */
  try {
    await updateDoc(doc(db, "users", uid), {
      [`ratings.${slug}`]: stars,
    });
  } catch (e) {
    /* updateDoc fails on missing doc — non-critical, seriesRatings is primary */
    console.warn("[Firebase] setRating user-doc secondary write:", e.message);
  }
}

/**
 * Read current user's rating for a series.
 * Reads from seriesRatings first (fast single doc), falls back to user doc.
 */
export async function getRating(uid, slug) {
  try {
    const snap = await getDoc(doc(db, "seriesRatings", slug, "ratings", uid));
    if (snap.exists()) return snap.data().rating ?? 0;
  } catch (_) {}
  try {
    const profile = await getUserProfile(uid);
    return profile?.ratings?.[slug] ?? 0;
  } catch (_) {}
  return 0;
}

/**
 * Get ALL ratings for a user (profile ratings tab).
 * Fast path: reads from user doc ratings map.
 * Fallback: collectionGroup query on "ratings" subcollections.
 *   Requires Firestore index: collectionGroup "ratings", field "uid" ASC.
 */
export async function getAllRatings(uid) {
  /* Fast path */
  try {
    const profile    = await getUserProfile(uid);
    const userRatings = profile?.ratings ?? {};
    if (Object.keys(userRatings).length > 0) return userRatings;
  } catch (_) {}

  /* Fallback: collectionGroup (needs index) */
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
    console.warn("[Firebase] getAllRatings collectionGroup fallback failed:", e.message);
    return {};
  }
}

/**
 * Calculate community average for a series (one-time read).
 */
export async function getAverageRating(slug) {
  try {
    const snap   = await getDocs(collection(db, "seriesRatings", slug, "ratings"));
    if (snap.empty) return { avg: 0, count: 0 };
    const values = snap.docs.map(d => d.data().rating ?? 0).filter(r => r > 0);
    if (!values.length) return { avg: 0, count: 0 };
    const avg = values.reduce((s, r) => s + r, 0) / values.length;
    return { avg: Math.round(avg * 10) / 10, count: values.length };
  } catch (e) {
    console.warn("[Firebase] getAverageRating failed:", e.message);
    return { avg: 0, count: 0 };
  }
}

/**
 * Subscribe to live average rating updates for a series.
 * Returns an unsubscribe function.
 */
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
        console.warn("[Firebase] onSeriesRatingsSnapshot cb error:", e.message);
      }
    }, (e) => {
      console.warn("[Firebase] onSeriesRatingsSnapshot error:", e.message);
    });
  } catch (e) {
    console.warn("[Firebase] onSeriesRatingsSnapshot setup failed:", e.message);
    return () => {};
  }
}

/* ══════════════════════════════════════════════════════════════
   COMMENTS  —  comments/{seriesSlug}/items/{commentId}
   ══════════════════════════════════════════════════════════════ */

export async function postComment(slug, uid, username, text, userAvatar = null) {
  const col = collection(db, "comments", slug, "items");
  await addDoc(col, {
    userId:     uid,
    username,
    userAvatar: userAvatar || null,
    text:       text.trim(),
    likes:      0,
    dislikes:   0,
    createdAt:  serverTimestamp(),
  });
}

export async function getComments(slug) {
  try {
    const q    = query(collection(db, "comments", slug, "items"), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("[Firebase] getComments failed:", e.message);
    return [];
  }
}

/**
 * Get all comments by a user across all series.
 * Requires collectionGroup index: collection "items", field "userId" + "createdAt".
 */
export async function getUserComments(uid) {
  try {
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
  } catch (e) {
    console.warn("[Firebase] getUserComments failed (needs index?):", e.message);
    return [];
  }
}

export async function likeComment(slug, commentId) {
  try {
    await updateDoc(doc(db, "comments", slug, "items", commentId), { likes: increment(1) });
  } catch (e) {
    console.warn("[Firebase] likeComment failed:", e.message);
  }
}

export async function dislikeComment(slug, commentId) {
  try {
    await updateDoc(doc(db, "comments", slug, "items", commentId), { dislikes: increment(1) });
  } catch (e) {
    console.warn("[Firebase] dislikeComment failed:", e.message);
  }
}
