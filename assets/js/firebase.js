/* ============================================================
   firebase.js — Firebase Modular SDK v10  v3.1
   ─────────────────────────────────────────────────────────────
   FIXES vs v3.0:
   ① setRating — replaced updateDoc (fails on missing doc) with
     setDoc+merge for user doc AND writes to seriesRatings/
   ② getAverageRating — new: reads seriesRatings/{id}/ratings/
   ③ onSeriesRatingsSnapshot — new: live average updates
   ④ getRating — reads seriesRatings first, falls back to user doc
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
  /* Safety net: self-heal missing Firestore user doc */
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
   Schema: users/{uid}
     username  : string
     email     : string
     avatar    : string|null
     role      : 'user'|'admin'
     status    : 'active'|'banned'|'shadowbanned'
     favorites : string[]
     watchlist : string[]
     watched   : string[]
     ratings   : { [slug]: number }
     createdAt : Timestamp
   ══════════════════════════════════════════════════════════════ */

export async function ensureUserDoc(user, username = null) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      username:  username ?? user.displayName ?? user.email.split("@")[0],
      email:     user.email,
      avatar:    user.photoURL ?? null,
      role:      "user",
      status:    "active",
      favorites: [],
      watchlist: [],
      watched:   [],
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
   FAVORITES
   ══════════════════════════════════════════════════════════════ */

export async function addFavorite(uid, slug) {
  await updateDoc(doc(db, "users", uid), { favorites: arrayUnion(slug) });
}

export async function removeFavorite(uid, slug) {
  await updateDoc(doc(db, "users", uid), { favorites: arrayRemove(slug) });
}

export async function toggleFavorite(uid, slug) {
  const profile = await getUserProfile(uid);
  if (profile?.favorites?.includes(slug)) {
    await removeFavorite(uid, slug);
    return false;
  }
  await addFavorite(uid, slug);
  return true;
}

/* ══════════════════════════════════════════════════════════════
   WATCHLIST
   ══════════════════════════════════════════════════════════════ */

export async function addToWatchlist(uid, slug) {
  await updateDoc(doc(db, "users", uid), { watchlist: arrayUnion(slug) });
}

export async function removeFromWatchlist(uid, slug) {
  await updateDoc(doc(db, "users", uid), { watchlist: arrayRemove(slug) });
}

export async function toggleWatchlist(uid, slug) {
  const profile = await getUserProfile(uid);
  if (profile?.watchlist?.includes(slug)) {
    await removeFromWatchlist(uid, slug);
    return false;
  }
  await addToWatchlist(uid, slug);
  return true;
}

/* ══════════════════════════════════════════════════════════════
   SEEN / WATCHED
   ══════════════════════════════════════════════════════════════ */

export async function addSeen(uid, slug) {
  await updateDoc(doc(db, "users", uid), { watched: arrayUnion(slug) });
}

export async function removeSeen(uid, slug) {
  await updateDoc(doc(db, "users", uid), { watched: arrayRemove(slug) });
}

export async function toggleSeen(uid, slug) {
  const profile = await getUserProfile(uid);
  if (profile?.watched?.includes(slug)) {
    await removeSeen(uid, slug);
    return false;
  }
  await addSeen(uid, slug);
  return true;
}

/* ══════════════════════════════════════════════════════════════
   RATINGS  v3.1
   ─────────────────────────────────────────────────────────────
   Dual-write:
     (A) users/{uid}  ratings.{slug}  — for profile page tab
     (B) seriesRatings/{slug}/ratings/{uid} — for per-series avg

   FIX: old code used updateDoc which throws on missing doc.
        New code uses setDoc+merge which upserts safely.
   ══════════════════════════════════════════════════════════════ */

/**
 * Save a rating. Writes to both the user doc (profile tab) and
 * the seriesRatings collection (average calculation).
 */
export async function setRating(uid, slug, stars) {
  /* (A) User profile — use setDoc+merge so it works even if
     the user doc was created moments ago or doesn't exist yet. */
  try {
    await setDoc(
      doc(db, "users", uid),
      { ratings: { [slug]: stars } },
      { merge: true }
    );
  } catch (e) {
    /* Non-fatal: profile write failing doesn't block the main rating */
    console.warn("[Firebase] setRating user-doc write failed:", e.message);
  }

  /* (B) Series ratings collection — this is the primary store */
  await setDoc(
    doc(db, "seriesRatings", slug, "ratings", uid),
    { rating: stars, updatedAt: serverTimestamp() }
  );
}

/**
 * Get the current user's rating for a series.
 * Reads from seriesRatings first (faster), falls back to user doc.
 */
export async function getRating(uid, slug) {
  try {
    const snap = await getDoc(doc(db, "seriesRatings", slug, "ratings", uid));
    if (snap.exists()) return snap.data().rating ?? 0;
  } catch (_) {}
  /* Fallback: read from user profile ratings map */
  try {
    const profile = await getUserProfile(uid);
    return profile?.ratings?.[slug] ?? 0;
  } catch (_) {}
  return 0;
}

export async function getAllRatings(uid) {
  const profile = await getUserProfile(uid);
  return profile?.ratings ?? {};
}

/**
 * Calculate the average rating for a series (one-time read).
 * Returns { avg: number, count: number }
 */
export async function getAverageRating(slug) {
  try {
    const col  = collection(db, "seriesRatings", slug, "ratings");
    const snap = await getDocs(col);
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
 * Subscribe to live rating updates for a series.
 * Callback receives { avg, count } every time any user rates.
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
        console.warn("[Firebase] onSeriesRatingsSnapshot callback error:", e.message);
      }
    }, (e) => {
      console.warn("[Firebase] onSeriesRatingsSnapshot error:", e.message);
    });
  } catch (e) {
    console.warn("[Firebase] onSeriesRatingsSnapshot setup failed:", e.message);
    return () => {};  /* noop unsubscribe */
  }
}

/* ══════════════════════════════════════════════════════════════
   COMMENTS
   Collection: comments/{seriesSlug}/items/{commentId}
   Schema:
     userId     : string
     username   : string
     userAvatar : string|null
     text       : string
     likes      : number
     dislikes   : number
     createdAt  : Timestamp
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
    const col  = collection(db, "comments", slug, "items");
    const q    = query(col, orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("[Firebase] getComments failed:", e.message);
    return [];
  }
}

export async function getUserComments(uid) {
  try {
    const cg   = collectionGroup(db, "items");
    const q    = query(cg, where("userId", "==", uid), orderBy("createdAt", "desc"));
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
