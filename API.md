# Misugi API — İstek/Yanıt Referansı

Mobil entegrasyon için tam sözleşme. Tüm yollar `/api` önekiyle başlar, tüm gövdeler JSON'dur (`Content-Type: application/json`).

**Zarf:** Her başarılı yanıt `{ "success": true, ... }`, her hata `{ "success": false, "message": "..." }` biçimindedir.

**Kimlik doğrulama:** 🔒 işaretli endpoint'ler `Authorization: Bearer <accessToken>` başlığı ister. ✉️ işaretli olanlar ayrıca doğrulanmış e-posta gerektirir (aksi halde `403 "Please verify your email first"`). Access token ~15 dk geçerlidir; `401 "Token expired"` alınca `/auth/refresh` çağrılır, o da 401 dönerse login ekranına dönülür.

**Ortak hata kodları:** `400` geçersiz istek, `401` kimlik hatası, `403` yetki/doğrulama/cooldown, `404` bulunamadı, `429` rate limit (`message` alanı Türkçe açıklama içerir).

---

## Auth — `/auth`

### POST /auth/register
```jsonc
// İstek
{
  "name": "Yusuf",
  "surname": "Gökkaya",
  "email": "yusuf@ornek.com",
  "password": "enaz8karakter",
  "deviceName": "Pixel 8"        // opsiyonel; yoksa User-Agent kullanılır
}

// 201
{
  "success": true,
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "data": { "id": "665f1a...", "name": "Yusuf" }
}
```
Hatalar: `400 "email already in use"`, `400` validasyon (kısa şifre, geçersiz e-posta), `500 "Email gönderilemedi, tekrar deneyin"` (kayıt geri alınır). Geliştirme ortamında yanıta test için `verificationToken` da eklenir (production'da eklenmez).

### POST /auth/login
```jsonc
// İstek
{ "email": "yusuf@ornek.com", "password": "enaz8karakter", "deviceName": "Pixel 8" }

// 200
{
  "success": true,
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "isEmailVerified": true,
  "data": { "id": "665f1a...", "name": "Yusuf" }
}
```
Hata: `401 "Invalid credentials"` (e-posta da şifre de yanlış olsa aynı mesaj). `isEmailVerified: false` ise client doğrulama bekleme ekranına yönlendirmelidir.

### POST /auth/refresh
```jsonc
// İstek
{ "refreshToken": "eyJ..." }

// 200
{ "success": true, "data": { "accessToken": "eyJ..." } }
```
Hata: `401 "No refresh token"` / `401 "Invalid refresh token"` (oturum kapatılmış veya süresi dolmuş — login'e dön).

### POST /auth/logout 🔒
```jsonc
// İstek — refreshToken verilirse SADECE o cihaz, verilmezse TÜM cihazlar çıkar
{ "refreshToken": "eyJ..." }   // veya boş gövde {}

// 200
{ "success": true, "message": "Logged out" }
```

### GET /auth/me 🔒✉️
```jsonc
// 200 — User dokümanı (password/fcmToken asla dönmez)
{
  "success": true,
  "data": {
    "_id": "665f1a...",
    "name": "Yusuf",
    "surname": "Gökkaya",
    "email": "yusuf@ornek.com",
    "profile_image": "default.jpg",
    "role": "user",
    "isEmailVerified": true,
    "dailyGoal": 20,
    "notificationSettings": { "dailyReminder": true, "streakReminder": true, "wordLevelDown": true },
    "timezone": "Europe/Istanbul",
    "createdAt": "2026-07-01T09:30:00.000Z"
  }
}
```

### PUT /auth/update-info 🔒✉️
```jsonc
// İstek — yalnızca değiştirmek istediğin alanları gönder
{
  "name": "Yusuf",
  "surname": "Gökkaya",
  "email": "yeni@ornek.com",          // değişirse doğrulama sıfırlanır, yeni adrese mail gider
  "password": "yenisifre123",
  "dailyGoal": 30,                    // 5-50 arası
  "fcmToken": "fcm-cihaz-tokeni",     // push için Firebase SDK'dan alınan token
  "timezone": "Europe/Berlin",
  "notificationSettings": { "streakReminder": false }   // kısmi güncelleme, kalanlar korunur
}

// 200 — güncellenmiş kullanıcı (GET /auth/me ile aynı biçim)
{ "success": true, "data": { /* ... */ } }
```
Hatalar: `400 "Bu e-posta adresi zaten kullanımda"`, `500 "Doğrulama maili gönderilemedi, e-posta değiştirilmedi"`.

### PUT /auth/change-password 🔒✉️
```jsonc
// İstek
{ "oldPassword": "eski123456", "newPassword": "yeni123456", "deviceName": "Pixel 8" }

// 200 — TÜM oturumlar kapanır, bu cihaz için taze çift döner; client saklı token'ları değiştirmeli
{
  "success": true,
  "message": "Password changed successfully",
  "data": { "accessToken": "eyJ...", "refreshToken": "eyJ..." }
}
```
Hata: `401 "Old password is incorrect"`.

### POST /auth/forgot-password
```jsonc
// İstek
{ "email": "yusuf@ornek.com" }

// 200 — hesap olsa da olmasa da aynı yanıt (enumeration koruması)
{ "success": true, "message": "Password reset email sent" }
```

### POST /auth/reset-password
```jsonc
// İstek — token, e-postadaki linkten alınır
{ "token": "a1b2c3...", "password": "yenisifre123", "deviceName": "Pixel 8" }

// 200 — tüm eski oturumlar kapanır, taze çift döner (login ile aynı sözleşme)
{ "success": true, "data": { "accessToken": "eyJ...", "refreshToken": "eyJ..." } }
```
Hata: `400 "Invalid or expired token"` (link 1 saat geçerli).

### GET /auth/verify-email/:token
```jsonc
// 200 — doğrulama sonrası otomatik giriş için taze çift döner
{ "success": true, "data": { "accessToken": "eyJ...", "refreshToken": "eyJ..." } }
```
Hata: `400 "Invalid or expired token"` (link 24 saat geçerli).

### POST /auth/resend-verification-email
```jsonc
// İstek
{ "email": "yusuf@ornek.com" }

// 200 — hesap olsa da olmasa da aynı yanıt (enumeration koruması)
{ "success": true, "message": "Verification email sent" }
```

### DELETE /auth/delete-account 🔒✉️
```jsonc
// İstek — güvenlik için şifre tekrar istenir
{ "password": "enaz8karakter" }

// 200 — kullanıcı + TÜM ilişkili veri kalıcı silinir (KVKK)
{ "success": true, "message": "Account deleted" }
```
Hata: `401 "Password is incorrect"`.

---

## Kelimeler — `/words`

`Word` nesnesi (tüm kelime endpoint'lerinde aynı):
```jsonc
{
  "_id": "665f2b...",
  "kanji": "水",
  "romaji": "mizu",
  "meaning": "water",
  "type": "isim",
  "jlptLevel": "N5",       // N5 | N4 | N3 | N2 | N1
  "isCore": true           // aktif oyun havuzunda mı (3000 çekirdek kelime)
}
```

### GET /words 🔒✉️
Query: `?jlptLevel=N5&type=isim&page=1&limit=20&includeAll=false` (hepsi opsiyonel; `limit` en fazla 100; `includeAll=true` çekirdek olmayan ~4900 kelimeyi de dahil eder).
```jsonc
// 200
{
  "success": true,
  "data": {
    "words": [ /* Word[] */ ],
    "total": 300,
    "page": 1,
    "totalPages": 15
  }
}
```

### GET /words/search?q=mizu 🔒✉️
`q` kanji, romaji veya anlamda arar (en fazla 20 sonuç, yalnızca çekirdek set).
```jsonc
// 200
{ "success": true, "data": [ /* Word[] */ ] }
```
Hata: `400 "Please provide a search query"`.

### GET /words/:id 🔒✉️
```jsonc
// 200
{ "success": true, "data": { /* Word */ } }
```
Hata: `404 "Word not found"`.

### POST /words · PUT /words/:id · DELETE /words/:id 🔒 (yalnızca admin)
Gövde `Word` alanlarıdır; mobil uygulamanın kullanması gerekmez.

---

## Günlük çalışma — `/userwords`

### GET /userwords/today?jlptLevel=N5 🔒✉️
Günün havuzunu döner; gün içinde (kullanıcının saat diliminde) tekrar çağrılırsa **aynı liste** döner.
```jsonc
// 200
{
  "success": true,
  "data": {
    "reviewWords": [           // vadesi gelmiş tekrarlar — UserWord + gömülü word
      {
        "_id": "665f3c...",    // UserWord id'si (cevap gönderirken KULLANILMAZ)
        "word": { /* Word */ },
        "status": "learning",  // new | learning | learned
        "interval": 6,
        "easeFactor": 2.5,
        "repetitions": 2,
        "nextReviewDate": "2026-07-10T04:00:00.000Z",
        "masteryLevel": 3,     // 1-5
        "correctCount": 4,
        "wrongCount": 1
      }
    ],
    "newWords": [ /* Word[] — bugüne atanmış yeni kelimeler */ ]
  }
}
```

### POST /userwords/answer 🔒✉️
```jsonc
// İstek — wordId, Word'ün _id'sidir (UserWord id'si DEĞİL)
{ "wordId": "665f2b...", "result": "correct" }   // correct | empty | wrong

// 200 — güncellenmiş SRS durumu
{
  "success": true,
  "data": {
    "_id": "665f3c...",
    "word": "665f2b...",
    "status": "learning",
    "interval": 6,
    "easeFactor": 2.6,
    "repetitions": 2,
    "nextReviewDate": "2026-07-16T09:00:00.000Z",
    "masteryLevel": 3,
    "correctCount": 5,
    "wrongCount": 1,
    "levelDropped": false,     // true ise UI seviye düşüşü animasyonu gösterebilir
    "previousLevel": 3
  }
}
```
Hatalar: `400 "Invalid result, use: correct, empty, wrong"`, `404 "Word not found"`.

### GET /userwords/stats 🔒✉️
```jsonc
// 200
{
  "success": true,
  "data": {
    "total": 120,            // hiç cevaplanmış kelime sayısı
    "learned": 15,           // status=learned (interval ≥ 21 gün)
    "learning": 105,
    "review": 12,            // şu an vadesi gelmiş tekrar sayısı
    "byMasteryLevel": { "1": 30, "2": 40, "3": 25, "4": 10, "5": 15 }
  }
}
```

### GET /userwords/mistakes?page=1&limit=10 🔒✉️
Bugün (kullanıcının saat diliminde) yanlış yapılmış kelimeler, çok yanlıştan aza sıralı.
```jsonc
// 200
{
  "success": true,
  "data": {
    "mistakes": [ { /* UserWord + gömülü word (today ile aynı biçim) */ } ],
    "total": 3,
    "page": 1,
    "totalPages": 1
  }
}
```

---

## Oturumlar — `/sessions`

`StudySession` nesnesi:
```jsonc
{
  "_id": "665f4d...",
  "user": "665f1a...",
  "jlptLevel": "N5",
  "date": "2026-07-10T06:12:00.000Z",   // başlangıç anı
  "totalWords": 18,
  "correctCount": 14,
  "wrongCount": 3,
  "emptyCount": 1,
  "isCompleted": false,
  "completedAt": null,
  "duration": null                       // complete edilince dakika cinsinden dolar
}
```

### POST /sessions/start 🔒✉️
```jsonc
// İstek
{ "jlptLevel": "N5" }

// 200 — bugün açık oturum varsa yenisi açılmaz, mevcut döner
{ "success": true, "data": { /* StudySession */ } }
```

### PUT /sessions/update 🔒✉️
Normalde çağırmana gerek yok — `/userwords/answer` açık oturumu otomatik günceller. Elle saymak gerekirse:
```jsonc
// İstek
{ "result": "correct" }   // correct | wrong | empty

// 200
{ "success": true, "data": { /* StudySession */ } }
```
Hata: `404 "No active session found"`.

### PUT /sessions/complete 🔒✉️
```jsonc
// 200 — gövde yok; isCompleted=true, duration hesaplanır
{ "success": true, "data": { /* StudySession */ } }
```
Hata: `404 "No active session found"`.

### GET /sessions/today 🔒✉️
```jsonc
// 200 — bugün oturum yoksa data: null
{ "success": true, "data": { /* StudySession */ } }
```

### GET /sessions/history 🔒✉️
```jsonc
// 200 — son 30 oturum, yeniden eskiye
{ "success": true, "data": [ /* StudySession[] */ ] }
```

---

## İlerleme — `/progress`

### GET /progress 🔒✉️
```jsonc
// 200
{
  "success": true,
  "data": [
    { "jlptLevel": "N5", "isUnlocked": true,  "completionRate": 42, "totalWords": 300 },
    { "jlptLevel": "N4", "isUnlocked": false, "completionRate": 0,  "totalWords": 400 }
    // ... N3, N2, N1
  ]
}
```

### GET /progress/:jlptLevel/distribution 🔒✉️
```jsonc
// 200 — Seviyeler ekranındaki donut grafik verisi
{
  "success": true,
  "data": {
    "jlptLevel": "N5",
    "totalWords": 300,
    "distribution": { "1": 20, "2": 35, "3": 40, "4": 15, "5": 10 },
    "notStarted": 180
  }
}
```
Hata: `400 "Invalid level"`.

---

## Quiz — `/quiz`

### GET /quiz/status 🔒✉️
```jsonc
// 200
{
  "success": true,
  "data": {
    "placementAvailable": true,      // seviye belirleme sınavına girebilir mi
    "levels": {
      "N5": {
        "unlocked": true,
        "nextLevelUnlocked": false,
        "canAttempt": true,          // levelup sınav butonu aktif mi
        "failCount": 1,
        "nextAttemptAllowedAt": null // cooldown'daysa ISO tarih
      }
      // ... N4, N3, N2 (N1 son seviye, levelup'ı yok)
    }
  }
}
```

### POST /quiz/start 🔒✉️
```jsonc
// İstek — placement (jlptLevel gönderilmez, merdiven N5'ten başlar)
{ "type": "placement" }
// veya levelup
{ "type": "levelup", "jlptLevel": "N5" }

// 200
{
  "success": true,
  "data": {
    "quizId": "665f5e...",
    "type": "levelup",
    "jlptLevel": "N5",
    "passThreshold": 85,             // placement'ta 70
    "expiresAt": "2026-07-10T10:30:00.000Z",   // 30 dk — süresinde submit edilmezse expired
    "totalQuestions": 35,            // placement'ta 12
    "questions": [
      {
        "index": 0,
        "format": "meaning",         // meaning: kelime→anlam | reverse: anlam→kelime | reading: kanji→okunuş
        "prompt": { "kanji": "水", "romaji": "mizu" },   // reverse'te {meaning}, reading'de {kanji}
        "choices": ["water", "fire", "tree", "stone"]    // doğru cevap işaretli DEĞİL (sunucuda skorlanır)
      }
    ]
  }
}
```
Hatalar: `400 "Invalid quiz type..."`, `403 "Bu seviye henüz kilitli"`, `400 "Sonraki seviye zaten açık"`, `400 "Seviye belirleme sınavı tamamlanmış"`, ve cooldown:
```jsonc
// 403 — cooldown; UI geri sayım gösterebilir
{ "success": false, "message": "Sınav hakkın henüz yenilenmedi", "nextAttemptAllowedAt": "2026-07-13T09:00:00.000Z" }
```

### POST /quiz/:id/submit 🔒✉️
```jsonc
// İstek — her soru için seçilen şık indeksi (0-3), soru sırasıyla; boş bırakılan için null gönderilebilir
{ "answers": [2, 0, 1, null, 3 /* ... totalQuestions kadar */] }

// 200
{
  "success": true,
  "data": {
    "score": 88,                    // yüzde
    "passed": true,
    "passThreshold": 85,
    "correctCount": 31,
    "totalQuestions": 35,
    "results": [
      { "index": 0, "yourAnswer": 2, "correctIndex": 2, "correct": true }
    ],
    "unlockedLevel": "N4",          // yalnızca geçince ve yeni seviye açılınca

    // yalnızca levelup + kalınca:
    "failCount": 1,
    "cooldownDays": 3,
    "nextAttemptAllowedAt": "2026-07-13T09:00:00.000Z",

    // yalnızca placement:
    "nextRung": "N4",               // geçildiyse sonraki basamak; client bununla yeni /quiz/start atar
    "placementFinished": false      // true ise merdiven bitti
  }
}
```
Hatalar: `404 "Quiz not found"`, `400 "Bu quiz zaten sonuçlanmış"`, `400 "Quiz süresi doldu, yeniden başlat"`, `400 "answers dizisi N eleman olmalı"`.

---

## Streak — `/streak`

### GET /streak 🔒✉️
```jsonc
// 200
{
  "success": true,
  "data": {
    "_id": "665f6f...",
    "user": "665f1a...",
    "currentStreak": 7,
    "longestStreak": 21,
    "lastStudyDate": "2026-07-10T06:45:00.000Z"
  }
}
```
Not: Streak, günün ilk `/userwords/answer` çağrısıyla otomatik güncellenir; client'ın ayrıca bir şey yapması gerekmez.

---

## Ana ekran — `/home`

### GET /home/summary 🔒✉️
```jsonc
// 200 — ana ekranın tek istekte tüm verisi
{
  "success": true,
  "data": {
    "today": { "totalWords": 18, "correctCount": 14, "wrongCount": 3, "emptyCount": 1, "isCompleted": false },
    "streak": { "current": 7, "longest": 21, "lastStudyDate": "2026-07-10T06:45:00.000Z" },
    "progress": [
      { "jlptLevel": "N5", "isUnlocked": true, "completionRate": 42 }
      // ... diğer seviyeler
    ],
    "pendingReviews": 12,      // şu an vadesi gelmiş tekrar sayısı
    "tomorrowReviews": 8       // yarın vadesi gelecek tekrar sayısı
  }
}
```

### GET /home/calendar 🔒✉️
```jsonc
// 200 — son 30 günün oturumları (aktivite takvimi için)
{
  "success": true,
  "data": [
    { "_id": "665f4d...", "date": "2026-07-09T07:00:00.000Z", "totalWords": 20, "isCompleted": true }
  ]
}
```

---

## Bildirimler — `/notifications`

`Notification` nesnesi:
```jsonc
{
  "_id": "665f7a...",
  "user": "665f1a...",
  "type": "streak_warning",   // daily_task | word_level_down | streak_warning | streak_reminder | daily_word
  "title": "Serini Kaybedeceksin",
  "body": "7 günlük serin bitmek üzere. Acele et, dersini kaçırma...",
  "data": { "currentStreak": 7 },   // tipe göre değişir; push deep-link için de aynı içerik gider
  "read": false,
  "createdAt": "2026-07-10T16:00:00.000Z"
}
```

### GET /notifications?page=1&limit=20 🔒✉️
```jsonc
// 200
{
  "success": true,
  "data": {
    "notifications": [ /* Notification[] — yeniden eskiye */ ],
    "total": 34,
    "unreadCount": 5,          // badge için
    "page": 1,
    "totalPages": 2
  }
}
```

### PUT /notifications/:id/read 🔒✉️
```jsonc
// 200
{ "success": true, "data": { /* Notification, read: true */ } }
```
Hata: `404 "Notification not found"`.

### PUT /notifications/read-all 🔒✉️
```jsonc
// 200
{ "success": true, "data": { "modifiedCount": 5 } }
```

---

## Sağlık kontrolü

### GET /health
Kimlik doğrulama ve rate limit dışındadır; deploy platformlarının canlılık kontrolü içindir.
```jsonc
// 200
{ "status": "ok" }
```
