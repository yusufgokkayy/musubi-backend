# Musubi API — İstek/Yanıt Referansı

Mobil entegrasyon için tam sözleşme. Tüm yollar `/api` önekiyle başlar, tüm gövdeler JSON'dur (`Content-Type: application/json`).

**Zarf:** Her başarılı yanıt `{ "success": true, ... }`, her hata `{ "success": false, "message": "..." }` biçimindedir.

**Kimlik doğrulama:** 🔒 işaretli endpoint'ler `Authorization: Bearer <accessToken>` başlığı ister. ✉️ işaretli olanlar ayrıca doğrulanmış e-posta gerektirir (aksi halde `403 "Please verify your email first"`). Access token ~15 dk geçerlidir; `401 "Token expired"` alınca `/auth/refresh` çağrılır, o da 401 dönerse login ekranına dönülür.

**Ortak hata kodları:** `400` geçersiz istek, `401` kimlik hatası, `403` yetki/doğrulama/cooldown, `404` bulunamadı, `429` rate limit (`message` alanı Türkçe açıklama içerir).

---

## Auth — `/auth`

### POST /auth/check-email
Onboarding'in "E-posta ile Devam Et" adımı: ad-soyad/şifre ekranlarına geçmeden adresin biçimini ve müsaitliğini kontrol eder.
```jsonc
// İstek
{ "email": "yusuf@ornek.com" }

// 200
{ "success": true, "available": true }   // false ise adres kayıtlı → giriş ekranına yönlendir
```
Hata: `400 "Geçerli bir e-posta adresi girin"` (boş veya bozuk biçim).

### POST /auth/social
Google/Apple ile giriş. Client, sağlayıcı SDK'sından aldığı `idToken`'ı gönderir; backend imzayı sağlayıcının anahtarlarıyla doğrular. Hesap yoksa oluşturulur, aynı e-postayla local hesap varsa sosyal hesaba bağlanır (şifresi korunur). Sosyal hesapların e-postası doğrulanmış sayılır — doğrulama maili akışı çalışmaz.
```jsonc
// İstek — name/surname opsiyonel (Apple ad bilgisini yalnızca İLK girişte client'a verir, o zaman iletin)
{
  "provider": "google",          // "google" | "apple"
  "idToken": "eyJhbGciOiJSUzI1...",
  "name": "Yusuf",               // opsiyonel
  "surname": "Gökkaya",          // opsiyonel
  "deviceName": "Pixel 8"        // opsiyonel; yoksa User-Agent kullanılır
}

// 201 (yeni hesap) veya 200 (mevcut hesaba giriş)
{
  "success": true,
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "isNewUser": true,             // true ise client onboarding/seviye testi teklifine yönlendirebilir
  "isEmailVerified": true,
  "data": { "id": "665f1a...", "name": "Yusuf" }
}
```
Hatalar: `400 "Desteklenmeyen sağlayıcı"`, `400 "idToken gerekli"`, `400 "Sosyal hesabınızın e-postası doğrulanmamış"`, `401 "Geçersiz sosyal giriş tokenı"`.

Notlar: Sosyal hesabın şifresi yoktur — e-posta+şifre login denemesi `401`, `change-password` `400` döner; şifre belirlemek isterse forgot-password akışı kullanılır (hesap hibrite dönüşür).

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
Hatalar (üçü ayrı durumdur, mesajlar ekranda gösterilebilir):
- `404 "Bu e-postayla kayıtlı bir hesap yok"` — client "kayıt ol" önerebilir
- `400 "Bu hesap Google/Apple girişiyle açılmış; ... ile giriş yap"` — sosyal butonları vurgula
- `401 "Şifreniz yanlış. Lütfen tekrar deneyin."`

`isEmailVerified: false` ise client doğrulama bekleme ekranına yönlendirmelidir.

Not: e-posta enumeration koruması BİLİNÇLİ olarak yalnızca `forgot-password`'dedir
(check-email onboarding gereği hesap varlığını zaten söylüyor); mağaza yayını
öncesi yeniden değerlendirilecek.

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
    "preferences": { "language": "tr", "theme": "light", "fontSize": "medium" },
    "isPremium": false,        // "Reklamları Kaldır" durumu — yalnızca satın alma doğrulaması değiştirir
    "provider": "local",       // local | google | apple
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
  "dailyGoal": 30,                    // 5-50 arası
  "fcmToken": "fcm-cihaz-tokeni",     // push için Firebase SDK'dan alınan token
  "timezone": "Europe/Berlin",        // geçersiz değer varsayılana (Europe/Istanbul) düşer
  "notificationSettings": { "streakReminder": false },   // kısmi güncelleme, kalanlar korunur
  "preferences": { "theme": "dark" }  // kısmi güncelleme — language: tr | theme: light/dark/system | fontSize: small/medium/large
}

// 200 — güncellenmiş kullanıcı (GET /auth/me ile aynı biçim)
{ "success": true, "data": { /* ... */ } }
```
Hatalar: `400 "Bu e-posta adresi zaten kullanımda"`, `400` enum validasyonu (geçersiz theme/fontSize), `500 "Doğrulama maili gönderilemedi, e-posta değiştirilmedi"`. `isPremium` bu endpoint'ten **değiştirilemez** (gönderilirse yok sayılır). `password` da **değiştirilemez** — gönderilirse `400 "Şifre bu uçtan değiştirilemez..."`: şifre değişiminin tek kapısı `change-password` (eski şifre doğrulamalı) ve `reset-password` (mail token'lı); ikisi de oturum rotasyonu yapar.

### POST /auth/verify-password 🔒✉️
Ayarlardaki adım adım şifre değiştirme akışının ilk ekranı ("Şifre Girin" alt sayfası): mevcut şifre doğrulanmadan yeni şifre ekranına geçilmez.
```jsonc
// İstek
{ "password": "mevcutsifre" }

// 200
{ "success": true, "message": "Password verified" }
```
Hatalar: `401 "Şifreniz yanlış. Lütfen tekrar deneyin."` (ekrandaki hata metniyle aynı), `400` (sosyal hesapta şifre yoktur). Doğrulama sonrası yeni şifre `PUT /auth/change-password`'e eski+yeni birlikte gönderilir.

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
Hatalar: `401 "Old password is incorrect"`, `400 "Yeni şifre eski şifrenle aynı olamaz"`.

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

// 200 — tüm eski oturumlar kapanır; deviceName GÖNDERİLDİYSE taze çift döner
// (login ile aynı sözleşme)
{ "success": true, "data": { "accessToken": "eyJ...", "refreshToken": "eyJ..." } }

// deviceName gönderilmediyse (web landing sayfası) oturum açılmaz: data boş döner
{ "success": true, "data": {} }
```
Hatalar: `400 "Invalid or expired token"` (link 1 saat geçerli), `400 "Yeni şifre
eski şifrenle aynı olamaz"` (aynı-şifre 400'ü token'ı TÜKETMEZ; kullanıcı aynı
linkle farklı şifre deneyebilir).

### POST /auth/verify-email
```jsonc
// İstek — token, e-postadaki linkten alınır
{ "token": "a1b2c3...", "deviceName": "Pixel 8" }

// 200 — deviceName GÖNDERİLDİYSE oturum açılır, taze çift döner (login sözleşmesi)
{ "success": true, "data": { "accessToken": "eyJ...", "refreshToken": "eyJ..." } }

// deviceName gönderilmediyse (web landing sayfası) yalnızca doğrulama yapılır
{ "success": true, "data": {} }
```
Hata: `400 "Invalid or expired token"` (link 24 saat geçerli).

### GET /auth/verify-email/:token
POST varyantının eski GET biçimi (geriye uyumluluk). `User-Agent` cihaz adı sayılır,
her zaman oturum açılıp taze çift döner. Yeni istemciler POST kullanmalı.

### Tarayıcı sayfaları (API dışı)
E-postalardaki linkler `/api`'ye değil şu HTML sayfalarına gider ve akış
**tamamen web'de tamamlanır** (ürün kararı: deep link yok):

- `GET /verify-email/:token` — "E-postamı Doğrula" butonu
  (`POST /api/auth/verify-email` çağırır, oturum açılmaz).
- `GET /reset-password/:token` — "Şifreyi Değiştir" butonu → yeni şifre formu
  (`POST /api/auth/reset-password` çağırır, oturum açılmaz).

Sayfalar yan etkisizdir (mail istemcilerinin link tarayıcıları GET'i takip
edebilir); geçersiz/süresi dolmuş tokende hata ekranı basar.

Uygulama akışı: register sonrası istemci "e-postanı doğrula" bekleme ekranı
gösterir; kullanıcı webde doğrulayıp uygulamaya dönünce istemci `GET /auth/me`'yi
yeniden dener (403 → 200'e döner) — register'da verilen token çifti bu yüzden
vardır. Yeni bağlantı için `POST /auth/resend-verification-email`.

### POST /auth/resend-verification-email
```jsonc
// İstek
{ "email": "yusuf@ornek.com" }

// 200 — doğrulanmamış kayıtlı hesaba yeni bağlantı gönderildi
{ "success": true, "message": "Verification email sent" }
```
Hatalar: `404 "Bu e-postayla kayıtlı bir hesap yok"`, `400 "E-posta zaten doğrulanmış"`
(client login'e yönlendirebilir).

### DELETE /auth/delete-account 🔒✉️
```jsonc
// İstek — güvenlik için şifre tekrar istenir
{ "password": "enaz8karakter" }

// Şifresiz sosyal hesap: şifre yerine sağlayıcıdan alınan TAZE idToken gönderilir
{ "idToken": "eyJhbGciOiJSUzI1..." }

// 200 — kullanıcı + TÜM ilişkili veri kalıcı silinir (KVKK)
{ "success": true, "message": "Account deleted" }
```
Hata: `401 "Password is incorrect"` / `401 "Kimlik doğrulanamadı"`.

---

## Kelimeler — `/words`

`Word` nesnesi (tüm kelime endpoint'lerinde aynı):
```jsonc
{
  "_id": "665f2b...",
  "kanji": "駅",
  "kana": "えき",          // detay kartında kanjinin altındaki okunuş; eski kayıtta boşsa romaji'ye düşün
  "romaji": "eki",
  "meaning": "istasyon",
  "type": "isim",
  "jlptLevel": "N5",       // N5 | N4 | N3 | N2 | N1
  "audioUrl": null,        // varsa "Dinle" butonu ("Yavaş" client'ta oynatma hızıyla)
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
Tek istisna: `dailyGoal` gün içinde **artarsa** havuz bir sonraki çağrıda fark
kadar genişler — kontenjana önce **vadesi gelmiş tekrarlar**, kalan yer rastgele
yeni kelimeler girer (cevaplanmışlar korunur). Hedef azalırsa bugünü etkilemez,
yarınki havuz yeni hedefle kurulur.

Kaldığın yerden devam: her öğede `answeredToday`/`todayResult`, kökte `progress`
sayaçları vardır. Ders yarıda kalıp yeniden açıldığında istemci
`answeredToday: false` olan kelimelerden sürdürmelidir — baştan başlamak yerine.
`answeredToday` yalnızca günün **nihai cevabı** (correct/easy/wrong) verildiyse
true olur; **"Şimdilik Geç" (empty) ertelemedir**: kelime `remaining`'de kalır
(`todayResult: "empty"` ile işaretli) ve yeniden sorulmalıdır.
```jsonc
// 200
{
  "success": true,
  "data": {
    "reviewWords": [           // vadesi gelmiş tekrarlar — UserWord + gömülü word
      {
        "_id": "665f3c...",    // UserWord id'si (cevap gönderirken KULLANILMAZ)
        "word": { /* Word — isKana dahil, aşağıya bak */ },
        "status": "learning",  // new | learning | learned
        "interval": 6,
        "easeFactor": 2.5,
        "repetitions": 2,
        "nextReviewDate": "2026-07-10T04:00:00.000Z",
        "masteryLevel": 3,     // 1-5
        "correctCount": 4,
        "wrongCount": 1,
        "answeredToday": true, // günün NİHAİ cevabı verildiyse true — devam ederken atla
        "todayResult": "wrong" // bugünkü son sonuç; "empty" = ertelendi (answeredToday false kalır)
      }
    ],
    "newWords": [ /* Word[] + answeredToday/todayResult — bugüne atanmış yeni kelimeler */ ],
    "progress": { "total": 30, "answered": 12, "remaining": 18 } // ilerleme çemberi
  }
}
```
Not: tüm `Word` yanıtlarında türetilmiş `isKana` alanı vardır — `true` ise kelime
kana-only'dir (それから, いつも): istemci "kanji" etiketini ve kanjiyle aynı olan
okunuş satırını gizlemelidir.

### POST /userwords/answer 🔒✉️
```jsonc
// İstek — wordId, Word'ün _id'sidir (UserWord id'si DEĞİL)
{ "wordId": "665f2b...", "result": "correct" }   // correct | easy | empty | wrong

// VEYA yazma sorusunda result yerine yazılan metin gönderilir; puanlamayı
// BACKEND yapar ("to see / watch" gibi çok varyantlı anlamlarda her varyant
// tek başına kabul edilir, parantez içleri opsiyoneldir, büyük/küçük harf
// ve noktalama önemsizdir). Boş metin "empty" sayılır.
{ "wordId": "665f2b...", "answer": "to see" }

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
    "lastResult": "correct",
    "levelDropped": false,     // true ise UI seviye düşüşü animasyonu gösterebilir
    "previousLevel": 3,
    "result": "correct",       // kullanılan sonuç — answer gönderildiyse puanlama budur
    "correctAnswer": "to see", // yalnızca answer gönderildiyse: "Cevap: ..." satırı için
    "counted": true            // false ise cevap kaydedilmedi (tekrar çalışma turu)
  }
}
```
Hatalar: `400 "Invalid result, use: correct, easy, empty, wrong"`, `404 "Word not found"`.

**Günün cevabı kuralı** (kullanıcının saat diliminde):

- Bir kelimenin günün **nihai cevabı**, o gün verilen İLK `correct/easy/wrong`'tur.
  SM-2, session sayaçları ve streak yalnızca onunla işler (`counted: true`).
- **Nihai cevaptan sonraki her cevap tekrar çalışma turudur ve TAM NÖTRDÜR**
  (`counted: false`): seviye ne çıkar ne iner, hiçbir sayaç oynamaz. Yanıt yine
  puanlanıp döner — istemci "Doğru!/Yanlış!" geri bildirimini gösterebilir.
  Kullanıcı günün havuzunu istediği kadar yeniden çalışabilir, hiçbir şey şişmez.
- **`empty` ("Şimdilik Geç") ertelemedir, nihai cevap değildir**: SM-2'ye
  dokunmaz (vadesi gelmiş kelimeyi geçmek programını bozmaz), session'a kelime
  başına bir kez `emptyCount` olarak işler, streak'i tetiklemez. Kelime gün
  içinde yeniden sorulur; gelen ilk gerçek cevap normal sayılır ve session
  sayacı düzeltilir (`emptyCount--`, sonuç sayacı `++`, toplam değişmez).
- Ertesi gün her şey gerçek sinyaldir: doğru ilerletir, yanlış sıfırlar.

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

### GET /userwords/list 🔒✉️
Seviyeler detayındaki "Kelime Listesi": çalışılmış kelimeler, dropdown'daki mastery seviyesine göre filtrelenebilir. Query: `?jlptLevel=N5&masteryLevel=5&page=1&limit=20` (hepsi opsiyonel; `limit` en fazla 100). Sıralama: son çalışılandan eskiye.
```jsonc
// 200
{
  "success": true,
  "data": {
    "items": [ { /* UserWord + gömülü word */ } ],
    "total": 200,
    "page": 1,
    "totalPages": 10
  }
}
```
Hata: `400 "masteryLevel 1-5 arası olmalı"`. Dropdown'daki seviye sayıları `GET /progress/:jlptLevel/distribution`'dan gelir.

### GET /userwords/mistakes?page=1&limit=10 🔒✉️
Bugün (kullanıcının saat diliminde) **son cevabı yanlış olan** kelimeler, çok
yanlıştan aza sıralı. "Şimdilik Geç" (empty) hata sayılmaz; geçmiş günlerin
yanlışları bugüne taşınmaz ve bugün doğruya dönen kelime listeden düşer.
`GET /home/summary` içindeki `todayMistakeCount` da aynı tanımı kullanır.
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

// 200 — GÜNLÜK TEK OTURUM: bugünün kaydı varsa o döner (bitirilmişse
// yeniden açılır, isCompleted=false olur); aynı güne ikinci kayıt açılmaz.
// Oturum "günün ilk gerçek cevaplarının" özetidir — tekrar çalışma turları
// sayaçlara yazılmaz.
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
// 200 — gövde yok; isCompleted=true, duration hesaplanır.
// accuracy: bitiş ekranındaki "Accuracy %" — correctCount/totalWords'ten
// hazır yüzde olarak döner, istemci hesaplamamalıdır
{ "success": true, "data": { /* StudySession */, "accuracy": 40 } }
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
// 200 — Seviyeler ekranının liste verisi
{
  "success": true,
  "data": {
    "completionThreshold": 75,   // "Bir sonraki seviyeye geçmek için listeyi %75 oranında tamamlayın" kutusu
    "levels": [
      { "jlptLevel": "N5", "isUnlocked": true,  "completionRate": 42, "totalWords": 300 },
      { "jlptLevel": "N4", "isUnlocked": false, "completionRate": 0,  "totalWords": 400 }
      // ... N3, N2, N1
    ]
  }
}
```
Not: seviye kilidi, tamamlanma oranı `completionThreshold`'a ulaşınca çalışmayla ya da seviye atlama sınavıyla açılır.

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
    "placementAvailable": true,      // seviye belirleme sınavına girebilir mi — "Seviyeni Öğrenelim Mi?" modalı bununla gösterilir ("Daha Sonra" client'ta saklanır, bu alan true kaldıkça Ayarlar'dan tekrar girilebilir)
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
    "expiresAt": "2026-07-10T10:30:00.000Z",   // 30 dk — süresinde bitirilmezse expired
    "totalQuestions": 35,            // placement'ta 10 (5 basamak × 10 = 50 soru)
    "questions": [
      {
        "index": 0,
        "format": "meaning",
        "prompt": { "kanji": "駅", "romaji": "eki", "audioUrl": "https://..." },
        "choices": ["istasyon", "tren", "araba", "ben"]  // doğru cevap işaretli DEĞİL (sunucuda skorlanır)
      }
    ]
  }
}
```

Soru formatları ve `prompt` biçimleri:
| format | Ekran | prompt | choices |
|---|---|---|---|
| `meaning` | kelime → anlam seç | `{ kanji, romaji, audioUrl? }` | 4 anlam |
| `reverse` | anlam → kelime seç | `{ meaning }` (ses YOK — cevabı söylerdi) | 4 kelime |
| `reading` | kanji → okunuş seç | `{ kanji, audioUrl? }` | 4 okunuş |
| `typing` | "Bu kelimenin Türkçesini yazınız" | `{ kanji, romaji, audioUrl? }` | YOK (serbest metin) |
| `fillblank` | "Boşluğa uygun kelimeyi yerleştir" | `{ sentence: "東京____で会いましょう。" }` (ses yok) | 4 kelime |
| `image` | "Doğru şıkkı işaretleyiniz" (görsel) | `{ imageUrl }` (ses yok) | 4 kelime |

`typing`/`fillblank`/`image` yalnızca placement karışımına girer; levelup klasik 3 şıklı formatla kalır. `fillblank` ve `image`, yalnızca örnek cümlesi/görseli olan kelimelerde üretilir — içerik DB'ye girdikçe karışımda kendiliğinden görünmeye başlarlar, kod değişikliği gerekmez. `audioUrl` varsa "Dinle" butonu gösterilebilir ("Yavaş" client'ta oynatma hızıyla yapılır).
Hatalar: `400 "Invalid quiz type..."`, `403 "Bu seviye henüz kilitli"`, `400 "Sonraki seviye zaten açık"`, `400 "Seviye belirleme sınavı tamamlanmış"`, ve cooldown:
```jsonc
// 403 — cooldown; UI geri sayım gösterebilir
{ "success": false, "message": "Sınav hakkın henüz yenilenmedi", "nextAttemptAllowedAt": "2026-07-13T09:00:00.000Z" }
```

### POST /quiz/:id/answer 🔒✉️
Her soru cevaplanır cevaplanmaz çağrılır; anlık "Doğru! / Yanlış Cevap!" kartının verisi döner. Son soru cevaplanınca sınav otomatik sonuçlanır ve yanıta `result` eklenir.
```jsonc
// İstek — şıklı soruda seçilen indeks (0-3), typing sorusunda yazılan METİN;
// boş bırakılan ("Şimdilik Geç") için null veya "" gönderilir (yanlış sayılır)
{ "index": 4, "answer": 2 }        // veya { "index": 4, "answer": "istasyon" }

// 200 — ara soru
{
  "success": true,
  "data": {
    "correct": true,
    "word": { "kanji": "駅", "meaning": "istasyon" },  // kartın "駅 — istasyon" satırı
    "correctIndex": 2,             // şıklı soruda; typing'de yerine "correctAnswer": "istasyon"
    "answeredCount": 5,
    "totalQuestions": 10,
    "finished": false
  }
}

// 200 — SON soru: yukarıdakilere ek olarak result gelir
{
  "success": true,
  "data": {
    "correct": false, "word": { /*...*/ }, "correctIndex": 1,
    "answeredCount": 10, "totalQuestions": 10, "finished": true,
    "result": {
      "score": 80,                  // yüzde
      "passed": true,
      "passThreshold": 70,
      "correctCount": 8,
      "totalQuestions": 10,
      "unlockedLevel": "N4",        // yalnızca geçince ve yeni seviye açılınca

      // yalnızca levelup + kalınca:
      "failCount": 1,
      "cooldownDays": 3,
      "nextAttemptAllowedAt": "2026-07-16T09:00:00.000Z",

      // yalnızca placement:
      "nextRung": "N4",             // geçildiyse sonraki basamak; client "Sınavınız Oluşturuluyor" gösterip yeni /quiz/start atar
      "placementFinished": false,   // true ise merdiven bitti

      // yalnızca placement bitince — "Seviyen Belirlendi" ekranının tüm verisi:
      "summary": {
        "determinedLevel": "N4",    // en yüksek kilidi açılan seviye
        "totalQuestions": 50,       // tüm basamakların toplamı
        "correctCount": 41,
        "wrongCount": 9,            // boş bırakılanlar dahil
        "durationSeconds": 277
      }
    }
  }
}
```
Typing cevapları sunucuda toleranslı puanlanır: büyük/küçük harf, noktalama, fazla boşluk ve parantez içleri yok sayılır; anlamın virgülle ayrılmış her varyantı tek başına kabul edilir.
Hatalar: `404 "Quiz not found"`, `400 "Bu quiz zaten sonuçlanmış"`, `400 "Quiz süresi doldu, yeniden başlat"` (30 dk), `400 "index 0-9 arası olmalı"`, `400 "Bu soru zaten cevaplandı"`.

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
    "name": "Emirhan",         // "Merhaba Emirhan" başlığı
    "goal": 20,                // çemberin PAYDASI: bugünün havuz boyutu (havuz yoksa dailyGoal)
    "dailyGoal": 20,           // ayarlardaki tercih — çember için goal'u kullan, bunu DEĞİL
    "today": { "totalWords": 14, "correctCount": 10, "wrongCount": 3, "emptyCount": 1, "isCompleted": false },
    "streak": { "current": 12, "longest": 21, "lastStudyDate": "2026-07-10T06:45:00.000Z" },  // "12 Günlük Seri" + "En iyi: 21"
    "progress": [
      { "jlptLevel": "N5", "isUnlocked": true, "completionRate": 42 }
      // ... diğer seviyeler
    ],
    "pendingReviews": 12,      // şu an vadesi gelmiş tekrar sayısı
    "tomorrowReviews": 20,     // "Yarın 20 Kart Seri Bekliyor" bandı
    "todayMistakeCount": 8     // "Bugünün Hataları — 8 Hata" başlığı (liste: GET /userwords/mistakes)
  }
}
```

### GET /home/calendar 🔒✉️
```jsonc
// 200 — son 30 günün oturumları (seri takvimi şeridi için; dolu gün = çalışılmış)
{
  "success": true,
  "data": [
    { "_id": "665f4d...", "date": "2026-07-09T07:00:00.000Z", "totalWords": 20, "isCompleted": true }
  ]
}
```

### GET /home/day/:date 🔒✉️
Takvimde bir güne dokununca açılan detay ekranı ("22 Nisan Salı"). `:date` `YYYY-MM-DD` biçimindedir ve kullanıcının saat dilimine göre yorumlanır.
```jsonc
// 200 — GET /home/day/2026-04-22
{
  "success": true,
  "data": {
    "date": "2026-04-22",
    "goal": 20,                // o günün havuz büyüklüğü (tarihsel hedef; havuz kaydı yoksa güncel dailyGoal)
    "totalWords": 14,          // çember: 14/20
    "correctCount": 10,        // yeşil nokta
    "wrongCount": 3,           // kırmızı nokta
    "emptyCount": 1,           // sarı nokta
    "isCompleted": false,
    "words": [                 // o gün çalışılan kelimeler, cevap sırasıyla; result = o günkü SON cevap
      {
        "word": { "_id": "665f2b...", "kanji": "食べる", "romaji": "taberu", "meaning": "yemek yemek", "type": "fiil", "jlptLevel": "N5" },
        "result": "correct"    // correct | wrong | empty
      }
    ]
  }
}
```
Veri olmayan gün `200` + sıfır sayaçlar ve boş `words` ile döner. Hata: `400 "Geçersiz tarih, YYYY-MM-DD bekleniyor"`.

---

## Bildirimler — `/notifications`

`Notification` nesnesi:
```jsonc
{
  "_id": "665f7a...",
  "user": "665f1a...",
  "type": "streak_warning",   // daily_task | word_level_down | streak_warning | streak_reminder | daily_word
  "title": "Serini Kaybedeceksin",
  "body": "1 saat sonra serini kaybedeceksin. Acele et, dersini kaçırma...",
  "data": { "currentStreak": 12 },   // tipe göre değişir; push deep-link için de aynı içerik gider
  "read": false,
  "createdAt": "2026-07-10T20:00:00.000Z"
}
```

Otomatik üretim (kullanıcının KENDİ saat diliminde):
| Saat | Tip | Örnek |
|---|---|---|
| 10:00 | `daily_task` | "Bugünün Görevi — Bugün 20 ezberlenecek kelime seni bekliyor!" |
| 10:00 | `daily_word` | "Günlük Kelime — Bugünün günlük kelimesi; 危ない (abunai) = tehlikeli" (`data.wordId` ile detaya gidilir) |
| 19:00 | `streak_reminder` | "12 Günlük Seri! — Serini devam ettirmeyi unutma." (yalnızca serisi olup o gün çalışmamışsa) |
| 23:00 | `streak_warning` | "Serini Kaybedeceksin — 1 saat sonra serini kaybedeceksin. Acele et, dersini kaçırma..." |
| cevap/decay anı | `word_level_down` | "危ない (abunai) kelimesinin seviyesi 3. seviyeye düştü. Tekrar hatırla!" |

Kullanıcının `notificationSettings` tercihleri kapalıysa ilgili tip hiç oluşmaz (`daily_task`/`daily_word` → `dailyReminder`, seri tipleri → `streakReminder`, seviye düşüşü → `wordLevelDown`).

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
