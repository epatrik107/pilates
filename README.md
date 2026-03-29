# Pilates Studio – Időpontfoglaló Webalkalmazás

Pilates stúdióknak készült időpontfoglaló rendszer, amely GitHub Pages-en hosztolható és Firebase-t használ backendként.

## Funkciók

### Edzői (Admin) fiók
- Biztonságos bejelentkezés
- Dashboard: új Pilates órák meghirdetése (dátum, időpont, típus, max. létszám)
- Résztvevők listájának megtekintése óránként
- Órák szerkesztése és törlése

### Vendég (User) fiók
- Regisztráció és bejelentkezés (email/jelszó)
- Órarend nézet: jövőbeli órák, szabad helyek, edző neve
- Foglalás egyetlen kattintással (betelt óra esetén inaktív gomb)
- Saját profil: közelgő foglalások, lemondás

## Projekt struktúra

```
pilates/
├── index.html              # Órarend (főoldal)
├── login.html              # Bejelentkezés
├── register.html           # Regisztráció
├── admin.html              # Admin dashboard
├── profile.html            # Felhasználói profil
├── firestore.rules         # Firestore biztonsági szabályok
├── .gitignore              # Git ignore + biztonsági megjegyzések
├── css/
│   └── style.css           # Egyedi stílusok (Tailwind kiegészítő)
├── js/
│   ├── firebase-config.js  # Firebase + Google Calendar + App Check konfig
│   ├── auth.js             # Autentikáció (regisztráció, login, logout)
│   ├── classes.js          # Óra CRUD műveletek
│   ├── bookings.js         # Foglalás kezelés (tranzakciókkal!)
│   ├── google-calendar.js  # Google Calendar integráció (URL + API)
│   └── ui.js               # Közös UI + escapeHtml + jelszó validáció + rate limiter
└── README.md
```

## Firebase beállítás (lépésről lépésre)

### 1. Firebase projekt létrehozása

1. Menj a [Firebase Console](https://console.firebase.google.com/)-ra
2. Kattints az **Add project** gombra
3. Adj nevet a projektnek (pl. `pilates-studio`)
4. Google Analytics – opcionális, kikapcsolhatod
5. Kattints a **Create project** gombra

### 2. Web App hozzáadása

1. A projekt áttekintőn kattints a **Web** (`</>`) ikonra
2. Adj nevet az appnak (pl. `pilates-web`)
3. **Nem** kell bekapcsolni a Firebase Hosting-ot (GitHub Pages-t használunk)
4. Kattints a **Register app** gombra
5. **Másold ki a `firebaseConfig` objektumot** – erre lesz szükséged!

### 3. Firebase konfiguráció beillesztése

Nyisd meg a `js/firebase-config.js` fájlt, és cseréld ki a placeholder értékeket a saját Firebase projektedéire:

```javascript
const firebaseConfig = {
  apiKey:            "AIzaSy...",        // ← a te API kulcsod
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId:             "1:000000000000:web:xxxxxxxxxxxxxx"
};
```

### 4. Authentication bekapcsolása

1. Firebase Console → **Authentication** → **Get started**
2. **Sign-in method** fülön engedélyezd az **Email/Password** szolgáltatót
3. Kattints a **Save** gombra

### 5. Firestore Database létrehozása

1. Firebase Console → **Firestore Database** → **Create database**
2. Válaszd a **Start in test mode** opciót (fejlesztéshez)
3. Válaszd ki a régiót (pl. `europe-west1`)
4. Kattints a **Create** gombra

### 6. Firestore biztonsági szabályok

A **Firestore → Rules** fülön cseréld ki az alapértelmezett szabályokat:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Felhasználói profilok
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    // Órák – bárki olvashatja, admin írhatja
    match /classes/{classId} {
      allow read: if true;
      allow create, update, delete: if request.auth != null
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // Foglalások
    match /bookings/{bookingId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;
      allow delete: if request.auth != null
        && (resource.data.userId == request.auth.uid
            || get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');
    }
  }
}
```

### 7. Admin felhasználó létrehozása

1. Regisztrálj egy felhasználót a weboldalon (register.html)
2. Firebase Console → **Firestore** → `users` gyűjtemény
3. Keresd meg a felhasználód dokumentumát
4. Módosítsd a `role` mezőt `"user"`-ről `"admin"`-re
5. Mentsd el – mostantól Admin Dashboard-hoz is hozzáférsz

## Firebase adatbázis struktúra

### `users` gyűjtemény
```
users/{userId}
├── name: string          // "Kovács Anna"
├── email: string         // "anna@example.com"
├── role: string          // "user" | "admin"
└── createdAt: Timestamp
```

### `classes` gyűjtemény
```
classes/{classId}
├── title: string          // "Mat Pilates kezdő"
├── type: string           // "mat" | "reformer" | "tower" | "prenatal"
├── date: string           // "2026-04-15"
├── startTime: string      // "10:00"
├── duration: number       // 60
├── maxCapacity: number    // 12
├── currentBookings: number // 5
├── instructorId: string   // userId hivatkozás
├── instructorName: string // "Kovács Anna"
├── description: string    // "Kezdőknek ajánlott..."
├── location: string       // "Stúdió A"
└── createdAt: Timestamp
```

### `bookings` gyűjtemény
```
bookings/{bookingId}
├── userId: string          // hivatkozás a users-re
├── userName: string        // "Kiss Péter"
├── userEmail: string       // "peter@example.com"
├── classId: string         // hivatkozás a classes-re
├── classTitle: string      // "Mat Pilates kezdő"
├── classDate: string       // "2026-04-15"
├── classStartTime: string  // "10:00"
├── classDuration: number   // 60
├── classLocation: string   // "Stúdió A"
├── instructorName: string  // "Kovács Anna"
├── classDescription: string // "Kezdőknek..."
├── calendarEventId: string // Google Calendar event ID (vagy null)
└── bookedAt: Timestamp
```

## Firestore indexek

Egyes összetett lekérdezésekhez a Firebase automatikusan kérhet index létrehozást. Ha a böngészőkonzolban hibaüzenetet látsz egy linkkel, kattints rá, és a Firebase automatikusan létrehozza az indexet. A szükséges indexek:

| Gyűjtemény | Mezők | Sorrend |
|-----------|-------|---------|
| `classes` | `date` ASC, `startTime` ASC | Composite |
| `bookings` | `userId` ASC, `classDate` ASC, `classStartTime` ASC | Composite |
| `bookings` | `classId` ASC, `bookedAt` ASC | Composite |

## Google Calendar integráció

Az alkalmazás kétféle Google Calendar integrációt támogat:

### A) Egyszerű mód (nincs extra setup)

Alapértelmezetten minden foglalt óra mellett megjelenik egy **"Naptár"** gomb, ami a Google Calendar webes felületén nyit egy előre kitöltött esemény-létrehozó űrlapot. Ez **semmilyen konfigurációt nem igényel** – azonnal működik.

### B) Teljes API szinkron (automatikus, opcionális)

Ha beállítod a Google Calendar API-t, a foglalások **automatikusan** szinkronizálódnak a felhasználó Google Naptárjába, és lemondáskor automatikusan törlődnek onnan.

#### Google Cloud Console beállítás

1. Menj a [Google Cloud Console](https://console.cloud.google.com/)-ra
2. Hozz létre egy új projektet (vagy válaszd ki a Firebase projektedhez tartozót)
3. **APIs & Services → Library** → Keresd meg a **Google Calendar API**-t → **Enable**
4. **APIs & Services → Credentials** → **Create Credentials** → **API Key**
   - Másold ki az API kulcsot
   - Ajánlott: korlátozd a kulcsot a Calendar API-ra és a domainedre
5. **APIs & Services → Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: add hozzá:
     - `https://FELHASZNALO.github.io` (a GitHub Pages domained)
     - `http://localhost:5500` (lokális fejlesztéshez, ha Live Server-t használsz)
   - Authorized redirect URIs: hagyd üresen
   - Másold ki a **Client ID**-t
6. **APIs & Services → OAuth consent screen**
   - User Type: **External**
   - Töltsd ki az alkalmazás nevét, e-mail címét
   - Scopes: add hozzá `https://www.googleapis.com/auth/calendar.events`
   - Test users: amíg nem publikálod, add hozzá a tesztelő felhasználókat

#### Konfiguráció beillesztése

Nyisd meg a `js/firebase-config.js` fájlt, és töltsd ki a `googleCalendarConfig` objektumot:

```javascript
const googleCalendarConfig = {
  clientId: "123456789-abc.apps.googleusercontent.com",  // ← OAuth Client ID
  apiKey:   "AIzaSy...",                                  // ← API Key
};
```

#### Működés

- **Foglaláskor:** A rendszer automatikusan létrehoz egy eseményt a felhasználó Google Naptárjában (1 órás és 15 perces emlékeztetővel)
- **Lemondáskor:** Az esemény automatikusan törlődik a naptárból
- **Profiloldalon:** A "Naptár" gomb manuálisan is szinkronizálhat egy foglalást
- Ha a felhasználó nem engedélyezi a Google hozzáférést, a foglalás ettől még sikeres lesz

## GitHub Pages deploy

1. Hozz létre egy GitHub repository-t
2. Pushold a projektet:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/FELHASZNALO/REPO.git
   git push -u origin main
   ```
3. GitHub → Repository → **Settings** → **Pages**
4. Source: **Deploy from a branch**
5. Branch: `main`, mappa: `/ (root)`
6. Kattints a **Save** gombra
7. Pár perc múlva elérhető lesz: `https://FELHASZNALO.github.io/REPO/`

### Fontos: Firebase Authorized Domains

A Firebase Authentication-höz hozzá kell adnod a GitHub Pages domaint:

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Add hozzá: `FELHASZNALO.github.io`

## Biztonsági védelmek

Ez az alkalmazás 6 fő biztonsági fenyegetésre készül fel:

### 1. Firestore Security Rules (adatbázis-szabályok)

A `firestore.rules` fájl tartalmazza a szigorú szabályokat:

- **Felhasználók NEM állíthatják magukat admin-ra** – a `role` mező csak `"user"` lehet regisztrációkor, és a felhasználó soha nem módosíthatja
- **Órát csak admin hozhat létre/módosíthat/törölhet**
- **Foglalást csak saját magadnak hozhatsz létre** (`userId == auth.uid`)
- **Foglalást csak a tulajdonos vagy admin törölheti**
- **Adattípusok és mezők validálva vannak** (string hossz, int értékhatárok)
- **Admin szerepkör kizárólag a Firebase Console-ból adható!**

### 2. XSS (Cross-Site Scripting) védelem

Minden felhasználói input escape-elve van megjelenítés előtt:

- `escapeHtml()` függvény a `ui.js`-ben – `<`, `>`, `&`, `"`, `'` karakterek HTML entitásokra cserélve
- **Kritikus pontok:** résztvevők nevei/emailjei az admin panelen, óra címek, leírások, helyszínek
- A `auth.js`-ben a regisztrációs név is szanitizálva van (`sanitizeName()`)
- Hibaüzenetek is escape-elve vannak, hogy ne lehessen rajtuk keresztül kódot injektálni

### 3. Race Condition védelem (Firestore tranzakciók)

A `bookings.js`-ben `runTransaction()` használata:

- **Foglaláskor:** a kapacitás-ellenőrzés és a foglalás + számláló növelés **egyetlen atomi művelet**
- **Lemondáskor:** a törlés és a számláló csökkentés szintén **atomi**
- Ha két felhasználó egyszerre foglal az utolsó helyre, az egyik tranzakció automatikusan meghiúsul (Firestore retry + conflict detection)

### 4. Brute Force és hitelesítési védelem

**Firebase beépített védelem:**
- Automatikus rate limiting túl sok sikertelen bejelentkezési kísérlet után
- Átmeneti fiókkizárás gyanús IP-címekről

**Alkalmazás szintű védelem:**
- **Erős jelszó követelmény:** min. 8 karakter, nagybetű, kisbetű, szám (valós idejű visszajelzéssel)
- **Kliensoldali rate limiter:** `checkRateLimit()` függvény – max. 5 próbálkozás / perc login és regisztráció esetén
- Részletes hibaüzenetek a Firebase hibakódokra (pl. `auth/too-many-requests`)

### 5. API kulcsok biztonsága

- A `.gitignore` fájl dokumentálja, mi kerülhet és mi NEM kerülhet a repóba
- A Firebase `apiKey` egy **publikus azonosító** – biztonságosan commitolható
- **TILOS a frontendbe tenni:** Stripe Secret Key, SendGrid API Key, bármilyen szerver-oldali titkos kulcs
- Ha ilyesmire van szükség, Firebase Cloud Functions-ben kell tárolni

### 6. App Check (Denial of Wallet / kóta-kimerítés védelem)

A `firebase-config.js`-ben konfigurálható a Firebase App Check reCAPTCHA v3-mal:

- **Láthatatlan reCAPTCHA** – nem zavarja a felhasználókat
- **Kiszűri a robotokat** – csak a valódi weboldalról érkező kéréseket engedi
- Beállítás: Firebase Console → App Check → reCAPTCHA v3 provider
- Ha nincs konfigurálva, az alkalmazás működik nélküle is (de kevésbé védett)

### Biztonsági ellenőrzőlista

| Védelem | Státusz | Fájl |
|---------|---------|------|
| Firestore Security Rules | `firestore.rules` | Szigorú szerepkör-alapú hozzáférés |
| XSS védelem | `ui.js` | `escapeHtml()` minden felhasználói adatra |
| Race condition | `bookings.js` | `runTransaction()` foglalás/lemondás |
| Brute force | `ui.js` + `register.html` | Rate limiter + erős jelszó |
| API kulcsok | `.gitignore` | Dokumentált, mi publikus és mi titkos |
| App Check | `firebase-config.js` | reCAPTCHA v3 (opcionális, de ajánlott) |

## Technológiák

- **Frontend:** HTML5, Vanilla JavaScript (ES Modules), Tailwind CSS (CDN)
- **Backend:** Firebase Authentication + Cloud Firestore
- **Biztonság:** Firestore Security Rules, App Check (reCAPTCHA v3), XSS escape, tranzakciók
- **Naptár integráció:** Google Calendar API v3 + egyszerű URL fallback
- **Hosting:** GitHub Pages (statikus)
- **Betűtípusok:** Inter + Playfair Display (Google Fonts)
