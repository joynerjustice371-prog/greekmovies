/* ============================================================
   firebase.js — Firebase Modular SDK v10
   v3.0 FIXED — adds toggleSeen, updateUserProfile,
                postComment(avatar), getUserComments via
                collectionGroup query.
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
  serverTimestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ── Replace with your Firebase project config ───────────── */
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
   AUTH HELPERS
   ══════════════════════════════════════════════════════════════ */

export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(result.user);
  return result.user;
}

export async function loginWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
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
   FIRESTORE — USER PROFILE
   Schema: users/{uid}
     username    : string
     email       : string  (private)
     avatar      : string|null
     role        : 'user' | 'admin'
     status      : 'active' | 'banned' | 'shadowbanned'
     favorites   : string[]
     watchlist   : string[]
     watched     : string[]    ← "Έχω δει"
     ratings     : { [slug]: number 1-5 }
     createdAt   : Timestamp
   ══════════════════════════════════════════════════════════════ */

async function ensureUserDoc(user, username = null) {
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

/** Update username / avatar. Firestore rules block role/status changes. */
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
   FIRESTORE — FAVORITES
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
   FIRESTORE — WATCHLIST
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
   FIRESTORE — SEEN / WATCHED ("Έχω δει")
   Uses the existing `watched` array field.
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
   FIRESTORE — RATINGS
   ══════════════════════════════════════════════════════════════ */

export async function setRating(uid, slug, stars) {
  await updateDoc(doc(db, "users", uid), {
    [`ratings.${slug}`]: stars,
  });
}

export async function getRating(uid, slug) {
  const profile = await getUserProfile(uid);
  return profile?.ratings?.[slug] ?? 0;
}

export async function getAllRatings(uid) {
  const profile = await getUserProfile(uid);
  return profile?.ratings ?? {};
}

/* ══════════════════════════════════════════════════════════════
   FIRESTORE — COMMENTS
   Collection: comments/{seriesSlug}/items/{commentId}
   Schema:
     userId     : string
     username   : string
     userAvatar : string|null      ← NEW
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

/**
 * Get all comments by a specific user across all series.
 * Uses collectionGroup query on "items". Requires a Firestore
 * single-field exemption or composite index on userId + createdAt
 * at the collection-group level. Falls back to [] gracefully.
 */
export async function getUserComments(uid) {
  try {
    const cg   = collectionGroup(db, "items");
    const q    = query(cg, where("userId", "==", uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      // Parent path:  comments/{seriesSlug}/items/{commentId}
      const parent = d.ref.parent.parent; // doc under /comments/
      return {
        id:         d.id,
        seriesSlug: parent?.id ?? '',
        ...d.data(),
      };
    });
  } catch (e) {
    // Likely missing collectionGroup index — graceful fallback
    console.warn("[Firebase] getUserComments failed (needs index?):", e.message);
    return [];
  }
}

export async function likeComment(slug, commentId) {
  try {
    const ref = doc(db, "comments", slug, "items", commentId);
    await updateDoc(ref, { likes: increment(1) });
  } catch (e) {
    console.warn("[Firebase] likeComment failed:", e.message);
  }
}

export async function dislikeComment(slug, commentId) {
  try {
    const ref = doc(db, "comments", slug, "items", commentId);
    await updateDoc(ref, { dislikes: increment(1) });
  } catch (e) {
    console.warn("[Firebase] dislikeComment failed:", e.message);
  }
}
