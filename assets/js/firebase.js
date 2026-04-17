/* ============================================================
   firebase.js — Firebase Modular SDK v9 initialization
   Replace the firebaseConfig values with your project's config
   from: Firebase Console → Project Settings → Your Apps
   ============================================================ */

import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ── Your Firebase project config ─────────────────────────── */
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

/** Google Sign-In popup */
export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(result.user);
  return result.user;
}

/** Email + password sign-in */
export async function loginWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

/** Email + password registration */
export async function registerWithEmail(email, password, username) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(result.user, username);
  return result.user;
}

/** Sign out */
export async function logout() {
  await signOut(auth);
}

/** Subscribe to auth state — calls cb(user | null) */
export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

/* ══════════════════════════════════════════════════════════════
   FIRESTORE — USER PROFILE
   ══════════════════════════════════════════════════════════════ */

/** Create user document if it doesn't exist yet (idempotent) */
async function ensureUserDoc(user, username = null) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      username:  username ?? user.displayName ?? user.email.split("@")[0],
      email:     user.email,
      favorites: [],
      watchlist: [],
      watched:   [],
      ratings:   {},
      createdAt: serverTimestamp(),
    });
  }
}

/** Get full user profile document */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
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

/** Toggle favorite — returns true if now added, false if removed */
export async function toggleFavorite(uid, slug) {
  const profile = await getUserProfile(uid);
  if (profile?.favorites?.includes(slug)) {
    await removeFavorite(uid, slug);
    return false;
  } else {
    await addFavorite(uid, slug);
    return true;
  }
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
  } else {
    await addToWatchlist(uid, slug);
    return true;
  }
}

/* ══════════════════════════════════════════════════════════════
   FIRESTORE — RATINGS
   ══════════════════════════════════════════════════════════════ */

/** Save a 1–5 star rating for a series */
export async function setRating(uid, slug, stars) {
  await updateDoc(doc(db, "users", uid), {
    [`ratings.${slug}`]: stars,
  });
}

export async function getRating(uid, slug) {
  const profile = await getUserProfile(uid);
  return profile?.ratings?.[slug] ?? 0;
}

/* ══════════════════════════════════════════════════════════════
   FIRESTORE — COMMENTS
   Collection path: comments/{seriesSlug}/items
   ══════════════════════════════════════════════════════════════ */

export async function postComment(slug, uid, username, text) {
  const col = collection(db, "comments", slug, "items");
  await addDoc(col, {
    userId:    uid,
    username,
    text:      text.trim(),
    createdAt: serverTimestamp(),
  });
}

export async function getComments(slug) {
  const col  = collection(db, "comments", slug, "items");
  const q    = query(col, orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
