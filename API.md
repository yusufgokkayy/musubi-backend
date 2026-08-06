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
  "deviceName": "Pixel 8",       // opsiyonel; yoksa User-Agent kullanılır
  "consents": { "terms": "1.0", "privacy": "1.0", "kvkk": "1.0" },  // opsiyonel, bkz. GET /auth/consents

  // Onboarding tercihleri — register ile AYNI alanlar, hepsi opsiyonel.
  // YALNIZCA hesap açılışında uygulanır; mevcut hesapla girişte yok sayılır
  // (kullanıcının Ayarlar'dan değiştirdiği tercihler ezilmesin diye).
  "dailyGoal": 20,
  "reminderTime": "14:00",
  "dailyReminder": true,
  "timezone": "Europe/Istanbul"
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

Sosyal kayıt da onboarding tercihlerini tek istekte alır — mobil taraf, Google SDK'dan gelen e-postayı önce `check-email`'e sorup yeni kullanıcı ise onboarding ekranlarını gösterir, sonra bu uca hepsini birden gönderir.

Notlar: Sosyal hesabın şifresi yoktur — e-posta+şifre login denemesi `401`, `change-password` `400` döner; şifre belirlemek isterse forgot-password akışı kullanılır (hesap hibrite dönüşür).

### POST /auth/register
Onboarding tek istekte biter: e-posta/ad/şifre adımlarının yanında "Hatırlatma
Bildirimi" ve "Günlük Kelime Hedefi" ekranlarının seçimleri de buraya gelir.
```jsonc
// İstek
{
  "name": "Yusuf",
  "surname": "Gökkaya",
  "email": "yusuf@ornek.com",
  "password": "Enaz8Karakter!",
  "deviceName": "Pixel 8",       // opsiyonel; yoksa User-Agent kullanılır

  // Aşağıdakilerin hepsi opsiyoneldir; verilmeyen alan varsayılanında kalır
  "dailyGoal": 20,               // 5-50 (arayüz preset'leri: 5 / 10 / 20 / 40)
  "reminderTime": "14:30",       // HH:mm, kullanıcının KENDİ saat diliminde
  "dailyReminder": false,        // "Şimdilik Geç" → hatırlatma kapalı açılır
  "timezone": "Europe/Istanbul", // geçersizse Europe/Istanbul'a düşülür

  // KVKK: uygulamanın GÖSTERDİĞİ metin sürümleri. Gönderilmesi opsiyoneldir
  // ama önerilir — sunucudaki güncel sürümle uyuşmazsa kayıt 400 ile reddedilir
  // (kullanıcının hiç görmediği bir metne rıza kaydedilmemesi için).
  "consents": { "terms": "1.0", "privacy": "1.0", "kvkk": "1.0" }
}

// 201
{
  "success": true,
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "data": { "id": "665f1a...", "name": "Yusuf" }
}
```
Hatalar: `400 "email already in use"`, `400` validasyon (şifre kuralları, geçersiz e-posta, geçersiz `reminderTime`, 50 karakteri aşan ad/soyad), `500 "Email gönderilemedi, tekrar deneyin"` (kayıt geri alınır).

**Doğrulama token'ı yanıtta DÖNMEZ** — hiçbir ortamda. Eskiden `NODE_ENV !== 'production'` koşuluyla dönüyordu; bu fail-open bir kontroldü (değişken boş kalırsa token açığa çıkardı). Token yalnızca e-postadaki linkte bulunur. Aynısı `forgot-password`'ün `resetToken`'ı için de geçerlidir.

E-posta `lowercase` + `trim` edilerek saklanır: `Emir@Gmail.com` ile `emir@gmail.com` **aynı hesaptır**. Ad ve soyad `trim` edilir, en fazla 50 karakterdir.

#### Şifre kuralları
"Yeni Şifre Oluştur" ekranının kuralları sunucuda da uygulanır. Sırayla kontrol
edilir, ilk ihlal edilen kuralın mesajı `400` ile döner:

| # | Kural | Mesaj |
|---|---|---|
| 1 | En az 8 karakter | `Şifreniz çok kısa (en az 8 karakter olmalı).` |
| 2 | En az bir büyük harf | `Şifrenizde en az bir büyük harf, bir rakam ve bir özel karakter olmalı.` |
| 3 | En az bir rakam | (aynı mesaj) |
| 4 | En az bir özel karakter | `Şifrenizi daha sağlam yapmak için bir özel karakter kullanın.` |

Geçen kural sayısı, tasarımdaki güç göstergesinin 4 çubuğuna birebir karşılık
gelir (1 → "Kötü", 4 → "Çok iyi").

Kurallar **yalnızca yeni şifre belirlenen üç kapıda** çalışır: `register`,
`reset-password`, `change-password`. `login` BİLEREK uygulamaz — aksi halde
kural yürürlüğe girmeden önce açılmış zayıf şifreli hesaplar kilitlenirdi.
`change-password`'de mevcut şifre hatası (`401`) kural hatasının önüne geçer.

Aynı kurallar `User` şemasında da uygulanır (servisi atlayan seed/script/yeni
uçlar için veri katmanı yedeği); iki katman tek kural dizisinden beslenir.
Migration veya test amacıyla zayıf şifreli bir kayıt yazmak gerekiyorsa
`doc.save({ validateBeforeSave: false })` ile açıkça muafiyet istenmelidir.

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
Hatalar (dördü ayrı durumdur, mesajlar ekranda gösterilebilir):
- `404 "Bu e-postayla kayıtlı bir hesap yok"` — client "kayıt ol" önerebilir
- `400 "Bu hesap Google/Apple girişiyle açılmış; ... ile giriş yap"` — sosyal butonları vurgula
- `401 "Şifreniz yanlış. Lütfen tekrar deneyin."`
- `429 "Çok fazla hatalı giriş denemesi yapıldı..."` — hesap geçici kilitli (aşağıda)

#### Hesap bazlı giriş kilidi
IP limitine ek olarak **hesap başına** hatalı deneme sayılır: çok sayıda IP'ye
sahip bir saldırgan tek hesabı IP limitine takılmadan deneyebilirdi. Sayaç
hesabın kendisinde tutulur.

| Hatalı deneme | Kilit süresi |
|---|---|
| 5 | 1 dakika |
| 10 | 5 dakika |
| 15+ | 15 dakika |

- Hatalar **15 dakikalık pencerede** birikir; pencere dolunca sayaç sıfırlanır.
- Kilitliyken **doğru şifre de reddedilir** (`429`), aksi halde kilit anlamsız olurdu.
- Başarılı giriş sayacı tamamen sıfırlar.
- **Şifre sıfırlama ve şifre değiştirme kilidi kaldırır** — kilitli kullanıcı
  sıfırlama sonrası da giremezse çıkmaza girerdi.
- Sosyal hesap uyarısı (`400`) ve bilinmeyen adres (`404`) şifre denemesi
  sayılmaz, sayaca işlenmez.

> Kilit süreleri **bilerek kısa ve kademelidir**: kilidin kendisi bir DoS
> aracıdır (kurbanın e-postasını bilen biri onu bilerek kilitleyebilir).
> Amaç saldırganı imkânsıza zorlamak değil, kaba kuvvetin işe yaramayacağı
> kadar yavaşlatmak.

`isEmailVerified: false` ise client doğrulama bekleme ekranına yönlendirmelidir.

#### E-posta enumeration politikası
**Karar: her uçta dürüst cevap.** Bilinmeyen adres `login`, `forgot-password` ve
`resend-verification-email` uçlarının hepsinde `404 "Bu e-postayla kayıtlı bir
hesap yok"` döner.

Gerekçe: `check-email` onboarding gereği hesap varlığını zaten açıkça söylüyor
(tasarımdaki "Bu e-posta ile zaten hesap açılmış" ekranı). Bunu bir uçta gizleyip
diğerinde söylemek sıfır güvenlik kazancı sağlarken kullanıcıyı yazım hatasında
sessizce bekletiyordu. Sızan bilgi ("bu adresin Musubi hesabı var") bu ürün için
düşük hassasiyetlidir.

Karşılığında koruma iki katmana devredildi: IP bazlı `authLimiter` (20/15dk) ve
**adres bazlı mail kısıtı** (aşağıda).

#### Adres bazlı mail kısıtı
Mail gönderen uçlar (`register`, `forgot-password`, `resend-verification-email`)
hedef **hesap** üzerinde sayaç tutar — IP değiştirerek aşılamaz:

| Kural | Değer |
|---|---|
| İki mail arası bekleme | 60 saniye |
| Aynı adrese günlük üst sınır | 5 mail (kayıt maili dahil) |

Aşılırsa `429` döner. **Mobil not:** kayıt maili de sayaca girdiği için "Tekrar
Gönder" butonu kayıttan hemen sonra `429` alır — buton 60 saniyelik geri sayım
göstermelidir.

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
    "notificationSettings": { "dailyReminder": true, "reminderTime": "10:00", "streakReminder": true, "wordLevelDown": true },
    "consents": { "terms": "1.0", "privacy": "1.0", "kvkk": "1.0", "acceptedAt": "2026-08-04T09:12:00.000Z" },
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
  "notificationSettings": {           // kısmi güncelleme, kalanlar korunur
    "streakReminder": false,
    "reminderTime": "14:30"           // HH:mm — "Bildirim Ayarları" ekranındaki saat
  },
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

### GET /auth/verification-status 🔒
"E-postanı Doğrula" bekleme ekranının sorduğu durum ucu. ✉️ **YOK** — tam da
doğrulanmamış kullanıcı için var.
```jsonc
// 200 — doğrulanmamışsa da 200 döner, hata değil
{ "success": true, "data": { "isEmailVerified": false, "email": "yusuf@ornek.com" } }
```
Kullanıcı maildeki linke tarayıcıda tıkladıktan sonra uygulamaya döner ve
ekrandaki butona basar; uygulama bu uçla durumu sorup doğrulanmışsa mevcut
token'ıyla doğrudan içeri alır — **yeniden giriş istemez.**

`/auth/me` de aynı bilgiyi verirdi (`403` → doğrulanmamış) ama `403` bir hata
kodudur, başka sebeple gelen 403'ten ayırt edilemez ve yoklama yapan istemci
sunucu loglarını 4xx uyarılarıyla doldurur.

> Access token 15 dk geçerlidir. Kullanıcı mailde oyalanırsa bu uç `401`
> döner; istemci önce `/auth/refresh` yapıp isteği tekrarlamalıdır.

### GET /auth/consents
Yürürlükteki hukuki metin sürümleri. **Oturumsuz da çağrılabilir** (giriş
ekranı için). `Authorization` başlığı gönderilirse kullanıcının rıza durumu
ve yeniden onay gerekip gerekmediği de döner.
```jsonc
// 200 — oturumsuz
{
  "success": true,
  "data": {
    "current": { "terms": "1.0", "privacy": "1.0", "kvkk": "1.0" },
    // Karşılama ekranındaki metin linkleri buradan kurulur
    "docs": [
      { "key": "terms",   "title": "Kullanıcı Sözleşmesi",
        "version": "1.0", "effectiveDate": "2026-08-04", "url": "/legal/terms" },
      { "key": "privacy", "title": "Gizlilik Politikası", "...": "..." },
      { "key": "kvkk",    "title": "KVKK Aydınlatma ve Açık Rıza Metni", "...": "..." }
    ]
  }
}

// 200 — oturumlu
{
  "success": true,
  "data": {
    "current":  { "terms": "1.0", "privacy": "2.0", "kvkk": "1.0" },
    "docs":     [ /* yukarıdaki gibi */ ],
    "accepted": { "terms": "1.0", "privacy": "1.0", "kvkk": "1.0",
                  "acceptedAt": "2026-08-04T09:12:00.000Z" },
    "outdated": ["privacy"],       // yeniden onaylanması gereken metinler
    "reconsentRequired": true
  }
}
```
Uygulama açılışta bunu okumalı; `reconsentRequired: true` ise güncellenen
metni gösterip aşağıdaki uçla rıza almalıdır.

### PUT /auth/consents 🔒
Sürüm yükseltmesi sonrası yeniden rıza.
```jsonc
// İstek — uygulamanın gösterdiği sürümler
{ "consents": { "privacy": "2.0" } }

// 200 — kaydedilen rıza
{ "success": true, "data": { "terms": "1.0", "privacy": "2.0", "kvkk": "1.0", "acceptedAt": "..." } }
```
`isEmailVerified` **aranmaz**: doğrulamayı bekleyen kullanıcı da güncellenen
metne rıza verebilmelidir, aksi halde çıkmaza girerdi.

### GET /legal · GET /legal/:doc — hukuki metinler
Metinler **backend'den servis edilir**, uygulamaya gömülü değildir: hukuki bir
düzeltme mağaza onayı beklemeden aynı gün yayına girer.

| Uç | Ne döner |
|---|---|
| `GET /legal` | Tarayıcı sayfası — üç metnin listesi |
| `GET /legal/:doc` | Tarayıcı sayfası — metnin tamamı (`terms`, `privacy`, `kvkk`) |
| `GET /api/legal` | JSON — metin listesi (başlık, sürüm, yürürlük tarihi, url) |
| `GET /api/legal/:doc` | JSON — `intro` + `sections[{heading, body}]` |

Hepsi **oturumsuz** çalışır: kullanıcı kayıt olmadan önce okuyabilmeli.

```jsonc
// GET /api/legal/kvkk → 200
{
  "success": true,
  "data": {
    "key": "kvkk", "version": "1.0", "effectiveDate": "2026-08-04",
    "title": "KVKK Aydınlatma ve Açık Rıza Metni",
    "lang": "tr", "company": "ALPSOY YAZILIM ARGE MÜHENDİSLİK LİMİTED ŞİRKETİ",
    "intro": "İşbu Aydınlatma Metni, 6698 sayılı ...",
    "sections": [ { "heading": "1. Veri Sorumlusu", "body": "..." } ],
    "url": "/legal/kvkk"
  }
}
```

**Mobil tarafta iki seçenek var:** WebView ile `/legal/:doc` açmak (sayfa
uygulamanın tasarım diliyle yazıldı, koyu tema ve TR/EN destekliyor) veya
`/api/legal/:doc` JSON'ını kendi ekranında render etmek. JSON'ı seçersen son
çekilen sürümü **çevrimdışı yedek** olarak sakla.

- Metinlerin dili **Türkçedir**; İngilizce çevirisi yoktur (bağlayıcı sözleşme
  makineyle çevrilmez). `?lang=en` ile açılan sayfa arayüzü İngilizce yapar,
  metni Türkçe bırakır ve bunu üstte açıkça söyler.
- `/legal/*` sayfaları **indekslenebilir** (`robots: index`) — App Store ve
  Google Play, mağaza kaydında açık erişilebilir bir gizlilik politikası
  URL'si ister. `https://<domain>/legal/privacy` tam olarak budur.
  Token taşıyan doğrulama/sıfırlama sayfaları ise `noindex`.

#### KVKK rıza kaydı — nasıl çalışıyor
Metinlerin **kaynağı `config/legal/texts.js`**; backend ayrıca *kim, ne
zaman, hangi sürüme* rıza verdiğini saklar. Açık rızanın ispatı veri
sorumlusundadır ve geçmişe dönük üretilemez — bu yüzden kayıt hesap açılış
anında (`register` ve `social` uçlarında) yazılır, hesabın rıza kaydı olmadan
var olduğu bir an bile olmaz.

Saklananlar: üç metnin sürümü, `acceptedAt`, ayrıca ispat gücü için `ip` ve
`userAgent`. Bunlar da kişisel veridir; hesap silinince `purgeUserData` ile
birlikte silinirler.

Sürümler metnin kendisinden türetilir (`config/legal/texts.js` → `version`);
`config/consents.js` bunu okur, elle yazılmaz. **Bir sürümü yükseltmek tüm
kullanıcılardan yeniden rıza istemek demektir** — metni değiştirip sürümü aynı
bırakmak ise kullanıcının onaylamadığı bir metne onay vermiş görünmesine yol
açar, KVKK açısından kanıt değeri kalmaz.

> **Hukuki not:** Tasarımda ayrı bir onay kutusu yok; giriş ekranı "Yeni bir
> hesap oluşturuyorsanız ... geçerli olacaktır" diyor, yani rıza eylemi kaydın
> kendisi sayılıyor. KVKK'da açık rıza için olumlu bir irade beyanı tercih
> edilir; ayrı bir onay kutusu hukuken daha güçlü olurdu. Bu bir ürün/hukuk
> kararıdır, backend her iki modeli de destekler.

### POST /auth/forgot-password
```jsonc
// İstek
{ "email": "yusuf@ornek.com" }

// 200
{ "success": true, "message": "Password reset email sent" }
```
Hatalar: `404 "Bu e-postayla kayıtlı bir hesap yok"` (enumeration politikası:
dürüst cevap), `429` (adres bazlı mail kısıtı), `500 "Email gönderilemedi..."`.
Doğrulanmamış hesap da şifre sıfırlayabilir — maildeki linke tıklamak zaten
adres sahipliğini kanıtlar.

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
**`jlptLevel` ZORUNLUDUR** (N5-N1, yoksa/geçersizse 400). Havuzun kimliği
`{user, gün, jlptLevel}` üçlüsüdür — aynı ekran akışı içinde bazen `jlptLevel`
gönderip bazen göndermemek FARKLI bir havuz saydırır, ikinci bir tane açtırır
(çift kelime seti, ilerleme çemberinin paydası şişer). Bu uç noktayı çağıran
her ekran/akış noktası **aynı** `jlptLevel` değerini göndermeli.

Günün havuzunu döner; gün içinde (kullanıcının saat diliminde) tekrar çağrılırsa **aynı liste** döner.
Tek istisna: `dailyGoal` gün içinde **artarsa** havuz bir sonraki çağrıda fark
kadar genişler — kontenjana önce **vadesi gelmiş tekrarlar**, kalan yer yeni
kelimelerle dolar (cevaplanmışlar korunur). Hedef azalırsa bugünü etkilemez,
yarınki havuz yeni hedefle kurulur.

**Yeni tur (şimdilik):** `PUT /sessions/complete` ile günün oturumu
tamamlandıktan sonra bu uç nokta tekrar çağrılırsa, aynı gün içinde bile
**taze bir havuz** üretilir — önceki havuzdaki (hem tekrar hem yeni) kelimeler
hariç tutulur, aynı kurallarla (frequencyRank sıralı yeni, vade sıralı tekrar)
yeniden seçilir. Session da otomatik yeniden açılır (`isCompleted:false`).
Günün toplam sayaçları (`/sessions/today`) turlar arasında birikmeye devam eder.

`newWords` **rastgele değil**, `frequencyRank` (müfredat/omurga sırası, küçük
= önce öğretilir) artan sırada gelir — ön koşul kelime (örn. "doktor") sonraki
kelimeden (örn. "cerrah") önce sorulur. `reviewWords` sırası ayrı bir mantığa
tabidir (vadesi en eski + en kırılgan önce).

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
**Önce `POST /sessions/start` çağrılmış olmalı** — o gün için aktif bir
`StudySession` yoksa 400 döner. İstemci UI'sını atlayıp doğrudan bu uç
noktaya istek atarak sınırsız/rastgele kelime cevaplama girişimini kapatır.
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
| `reminderTime` | `daily_task` | "Bugünün Görevi — Bugün 20 ezberlenecek kelime seni bekliyor!" |
| `reminderTime` | `daily_word` | "Günlük Kelime — Bugünün günlük kelimesi; 危ない (abunai) = tehlikeli" (`data.wordId` ile detaya gidilir) |
| 19:00 | `streak_reminder` | "12 Günlük Seri! — Serini devam ettirmeyi unutma." (yalnızca serisi olup o gün çalışmamışsa) |
| 23:00 | `streak_warning` | "Serini Kaybedeceksin — 1 saat sonra serini kaybedeceksin. Acele et, dersini kaçırma..." |
| cevap/decay anı | `word_level_down` | "危ない (abunai) kelimesinin seviyesi 3. seviyeye düştü. Tekrar hatırla!" |

`reminderTime` kullanıcı tercihidir (`notificationSettings.reminderTime`, varsayılan `10:00`). Üretim cron'u çeyrek saatte bir çalışır; hatırlatma, seçilen saatten sonraki **2 saat** içinde bir kez gönderilir (cron kaçırılırsa bir sonraki tur yakalar, ama gece yarısına sarkmaz). Aynı gün ikinci kez üretilmez. Hatırlatma saati 19:00/23:00 seçilirse günlük **ve** seri bildirimleri aynı turda üretilir.

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

### POST /notifications/test 🔒✉️
Elle push testi — giriş yapmış kullanıcının kayıtlı `fcmToken`'ına anında gönderir, `notificationSettings` tercihlerinden bağımsız (mobil uygulama/geliştirme ortamı doğrulaması içindir).
```jsonc
// İstek — ikisi de opsiyonel
{ "title": "Test", "body": "Deneme bildirimi" }

// 200
{ "success": true, "data": { /* Notification, type: "test" */ } }
```

---

## Sağlık kontrolü

### GET /health
Kimlik doğrulama ve rate limit dışındadır; deploy platformlarının canlılık kontrolü içindir.
```jsonc
// 200
{ "status": "ok" }
```
