/* ============================================================
   firebase.js — Core Firebase init + all Firestore helpers
   Firebase v10 modular SDK
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, orderBy, where,
  serverTimestamp, increment,
  getStorage,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage as _getStorage,
  ref as _ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* ── Firebase config — replace with your project values ──── */
const firebaseConfig = {
  apiKey: "AIzaSyCCvlyYUwn4KSPCrjzJ8gw1SIXcRd4jcEE",
  authDomain: "my-site-greek-m.firebaseapp.com",
  projectId: "my-site-greek-m",
  storageBucket: "my-site-greek-m.firebasestorage.app",
  messagingSenderId: "1059332450786",
  appId: "1:1059332450786:web:d321b95a3e9951c28ef1bb",
  measurementId: "G-VBPHLPBPYT"
};

const app      = initializeApp(firebaseConfig);
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = _getStorage(app);

const googleProvider = new GoogleAuthProvider();

/* ════════════════════════════════════════════════════════════
   USER MODEL
   users/{uid}: {
     username, email(private), avatar, role, status, createdAt
   }
   ════════════════════════════════════════════════════════════ */

function _genUsername(user) {
  if (user.displayName) return user.displayName.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const part = user.email.split('@')[0].replace(/[^a-z0-9]/g, '');
  return part + Math.floor(Math.random() * 9000 + 1000);
}

export async function ensureUserDoc(user, usernameOverride = null) {
  const ref  = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      username:  usernameOverride ?? _genUsername(user),
      email:     user.email,            // stored but never exposed in UI
      avatar:    user.photoURL ?? '',
      role:      'user',                // 'user' | 'admin'
      status:    'active',              // 'active' | 'banned' | 'shadowbanned'
      createdAt: serverTimestamp(),
    });
  }
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  // NEVER expose email to callers — strip it
  const { email: _email, ...safe } = d;
  return { uid, ...safe };
}

/** Update editable profile fields (username, avatar) */
export async function updateUserProfile(uid, { username, avatar }) {
  const data = {};
  if (username) data.username = username.trim();
  if (avatar !== undefined) data.avatar = avatar;
  await updateDoc(doc(db, 'users', uid), data);
}

/** Upload avatar file to Firebase Storage, update Firestore + Auth */
export async function uploadAvatar(user, file) {
  const path = `avatars/${user.uid}`;
  const storageRef = _ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  // Update Firestore
  await updateDoc(doc(db, 'users', user.uid), { avatar: url });
  // Update Auth display photo
  await updateProfile(user, { photoURL: url });
  return url;
}

/* ════════════════════════════════════════════════════════════
   AUTH
   ════════════════════════════════════════════════════════════ */

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
  if (!username?.trim()) throw new Error('Απαιτείται ψευδώνυμο.');
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(result.user, username.trim());
  return result.user;
}

export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
}

export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

/* ════════════════════════════════════════════════════════════
   FAVORITES  — users/{uid}/favorites/{seriesId}
   ════════════════════════════════════════════════════════════ */

export async function getFavorites(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'favorites'));
  return snap.docs.map(d => d.id);
}

export async function addFavorite(uid, seriesId) {
  await setDoc(doc(db, 'users', uid, 'favorites', seriesId), { addedAt: serverTimestamp() });
}

export async function removeFavorite(uid, seriesId) {
  await deleteDoc(doc(db, 'users', uid, 'favorites', seriesId));
}

export async function isFavorite(uid, seriesId) {
  const snap = await getDoc(doc(db, 'users', uid, 'favorites', seriesId));
  return snap.exists();
}

export async function toggleFavorite(uid, seriesId) {
  if (await isFavorite(uid, seriesId)) {
    await removeFavorite(uid, seriesId);
    return false;
  }
  await addFavorite(uid, seriesId);
  return true;
}

/* ════════════════════════════════════════════════════════════
   WATCHLIST  — users/{uid}/watchlist/{seriesId}
   ════════════════════════════════════════════════════════════ */

export async function getWatchlist(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'watchlist'));
  return snap.docs.map(d => d.id);
}

export async function addToWatchlist(uid, seriesId) {
  await setDoc(doc(db, 'users', uid, 'watchlist', seriesId), { addedAt: serverTimestamp() });
}

export async function removeFromWatchlist(uid, seriesId) {
  await deleteDoc(doc(db, 'users', uid, 'watchlist', seriesId));
}

export async function isInWatchlist(uid, seriesId) {
  const snap = await getDoc(doc(db, 'users', uid, 'watchlist', seriesId));
  return snap.exists();
}

export async function toggleWatchlist(uid, seriesId) {
  if (await isInWatchlist(uid, seriesId)) {
    await removeFromWatchlist(uid, seriesId);
    return false;
  }
  await addToWatchlist(uid, seriesId);
  return true;
}

/* ════════════════════════════════════════════════════════════
   RATINGS  — users/{uid}/ratings/{seriesId}
   ════════════════════════════════════════════════════════════ */

export async function getRatings(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'ratings'));
  const out = {};
  snap.docs.forEach(d => { out[d.id] = d.data().stars; });
  return out;
}

export async function getRating(uid, seriesId) {
  const snap = await getDoc(doc(db, 'users', uid, 'ratings', seriesId));
  return snap.exists() ? snap.data().stars : 0;
}

export async function setRating(uid, seriesId, stars) {
  await setDoc(doc(db, 'users', uid, 'ratings', seriesId), {
    stars,
    ratedAt: serverTimestamp(),
  });
}

/* ════════════════════════════════════════════════════════════
   COMMENTS  — series/{seriesId}/comments/{commentId}
   Fields: uid, username, avatar, text, rating,
           likes, dislikes, status, reports, createdAt
   ════════════════════════════════════════════════════════════ */

export async function getComments(seriesId, viewerUid = null, viewerStatus = 'active') {
  const col  = collection(db, 'series', seriesId, 'comments');
  const q    = query(col, orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => {
      if (c.status === 'deleted') return false;
      // Shadowban: visible only to the author
      if (c.status === 'hidden') return c.uid === viewerUid;
      return true;
    });
}

export async function postComment(seriesId, uid, username, avatar, text, rating = 0) {
  const col = collection(db, 'series', seriesId, 'comments');
  const ref = await addDoc(col, {
    uid,
    username,
    avatar:    avatar ?? '',
    text:      text.trim(),
    rating:    rating > 0 ? Math.min(5, Math.max(1, rating)) : 0,
    likes:     0,
    dislikes:  0,
    status:    'visible',    // 'visible' | 'hidden' | 'deleted'
    reports:   0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function likeComment(seriesId, commentId) {
  await updateDoc(doc(db, 'series', seriesId, 'comments', commentId), {
    likes: increment(1),
  });
}

export async function dislikeComment(seriesId, commentId) {
  await updateDoc(doc(db, 'series', seriesId, 'comments', commentId), {
    dislikes: increment(1),
  });
}

export async function reportComment(seriesId, commentId) {
  await updateDoc(doc(db, 'series', seriesId, 'comments', commentId), {
    reports: increment(1),
  });
}

export async function getUserComments(uid) {
  // Collects comments authored by a user across all series
  // Note: requires a Firestore collection-group index on 'uid'
  const q    = query(collection(db, 'series'), where('__name__', '!=', ''));
  // Lightweight approach: caller passes known seriesIds
  // Returns nothing here — use getUserCommentsBySeries instead
  return [];
}
