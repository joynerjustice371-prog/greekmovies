[README.md](https://github.com/user-attachments/files/26836225/README.md)
# StreamVault — Final Stable Version v2.0

## 🚀 Γρήγορη Εκκίνηση

### 1. Firebase Setup

1. Πηγαίνετε στο [Firebase Console](https://console.firebase.google.com)
2. Δημιουργήστε νέο project
3. Ενεργοποιήστε **Authentication** → Email/Password + Google
4. Ενεργοποιήστε **Firestore Database**
5. Αντιγράψτε τα config values στο `assets/js/firebase.js`:

```js
const firebaseConfig = {
  apiKey:            "AIza...",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc",
};
```

6. Ανεβάστε τα `firestore.rules` στο Firebase Console → Firestore → Rules

### 2. TMDB Setup (προαιρετικό)

1. Δημιουργήστε δωρεάν λογαριασμό στο [TMDB](https://www.themoviedb.org)
2. Settings → API → Request API Key
3. Αντικαταστήστε στο `assets/js/tmdb.js`:

```js
const TMDB_API_KEY = "your_actual_key_here";
```

> **Σημείωση:** Χωρίς TMDB key, η εφαρμογή εξακολουθεί να λειτουργεί πλήρως
> χρησιμοποιώντας τα local fallback data από το `data/series.json`.

### 3. Εκτέλεση

Χρειάζεται HTTP server (δεν λειτουργεί με `file://`):

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# VS Code → Live Server extension
```

Ανοίξτε: `http://localhost:8080`

---

## 📁 Δομή Αρχείων

```
streamvault/
├── index.html          # Αρχική σελίδα
├── series.html         # Σελίδα σειράς
├── watch.html          # Player σελίδα
├── profile.html        # Προφίλ χρήστη
├── firestore.rules     # Κανόνες ασφαλείας Firestore
├── data/
│   └── series.json     # Δεδομένα σειρών (local fallback)
└── assets/
    ├── css/
    │   └── style.css   # Όλα τα styles
    └── js/
        ├── app.js      # Κύρια λογική εφαρμογής
        ├── firebase.js # Firebase integration
        └── tmdb.js     # TMDB API client
```

---

## ✅ Εγγυήσεις Σταθερότητας

| Σενάριο | Συμπεριφορά |
|---------|-------------|
| Firebase CDN αποτυχία | Stubs φορτώνονται → app renders κανονικά |
| TMDB αποτυχία / timeout | Local JSON data → cards εμφανίζονται με τίτλους |
| Δεν υπάρχει σύνδεση internet | Σειρές εμφανίζονται με local data χωρίς posters |
| Firebase config λείπει | Auth buttons εμφανίζονται, login επιστρέφει error message |
| JS exception | Global error boundary → μήνυμα "ανανέωση σελίδας" |

---

## 🔐 Λειτουργίες Auth

- **Εγγραφή** με email/password + ψευδώνυμο
- **Σύνδεση** με email/password
- **Σύνδεση** με Google (popup)
- **Επαναφορά κωδικού** μέσω email
- **Avatar dropdown** με: Προφίλ, Αγαπημένα, Watchlist, Αποσύνδεση

---

## 👤 Schema Χρηστών (Firestore)

```
users/{uid}:
  username    : string
  email       : string  (private)
  avatar      : string | null
  role        : "user" | "admin"
  status      : "active" | "banned" | "shadowbanned"
  favorites   : string[]
  watchlist   : string[]
  watched     : string[]
  ratings     : { [slug]: 1-5 }
  createdAt   : Timestamp
```

---

## ➕ Προσθήκη Νέας Σειράς

Στο `data/series.json`, προσθέστε νέο entry:

```json
"my-series": {
  "tmdb_id": 12345,
  "title": "Η Σειρά Μου",
  "overview": "Σύντομη περιγραφή...",
  "genres": ["Δράμα", "Θρίλερ"],
  "year": "2024",
  "channel": "Netflix",
  "featured": false,
  "poster_fallback": "https://...",
  "backdrop_fallback": "https://...",
  "episodes": [
    { "season": 1, "ep": 1, "players": { "VidSrc": "https://vidsrc.to/embed/tv/12345/1/1" } }
  ]
}
```
