import {
  onAuth,
  loginWithGoogle,
  logout,
} from './firebase.js';

export function initAuthUI() {
  const nav = document.getElementById('nav-actions');
  if (!nav) return;

  onAuth(user => {
    if (user) {
      nav.innerHTML = `
        <span style="color:#fff;font-size:0.9rem">${user.displayName || user.email}</span>
        <button id="logoutBtn" class="btn-primary">Αποσύνδεση</button>
      `;

      document.getElementById('logoutBtn').onclick = logout;
    } else {
      nav.innerHTML = `
        <button id="loginBtn" class="btn-primary">Σύνδεση</button>
      `;

      document.getElementById('loginBtn').onclick = loginWithGoogle;
    }
  });
}
