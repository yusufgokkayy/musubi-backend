# Musubi API — İstek/Yanıt Referansı

Mobil entegrasyon için tam sözleşme. Tüm yollar `/api` önekiyle başlar, tüm gövdeler JSON'dur (`Content-Type: application/json`).

**Zarf:** Her başarılı yanıt `{ "success": true, ... }`, her hata `{ "success": false, "message": "..." }` biçimindedir. Bazı hatalar ayrıca `details` nesnesi taşır — istemcinin üzerine iş yapabileceği makine-okur veri (örn. `PUT /sessions/complete` → `{ "pendingWords": 3 }`). `details` isteğe bağlıdır, yokluğunda hata biçimi değişmez.

**Kimlik doğrulama:** 🔒 işaretli endpoint'ler `Authorization: Bearer <accessToken>` başlığı ister. ✉️ işaretli olanlar ayrıca doğrulanmış e-posta gerektirir (aksi halde `403 "Please verify your email first"`). Access token ~15 dk geçerlidir; `401 "Token expired"` alınca `/auth/refresh` çağrılır, o da 401 dönerse login ekranına dönülür.

**Ortak hata kodları:** `400` geçersiz istek, `401` kimlik hatası, `403` yetki/doğrulama/cooldown, `404` bulunamadı, `429` rate limit (`message` alanı Türkçe açıklama içerir).

---

## Ayarlar ekranı — satır/uç eşlemesi

Tasarımdaki her satırın hangi uca bağlandığı. Dil, tema ve kanji font boyutu
sunucuda **saklanır** (cihazlar arası senkron olsun diye) ama uygulanması
istemcinin işidir — sunucu bu tercihlere göre farklı içerik döndürmez.

| Ayarlar satırı | Uç |
|---|---|
| Şifreyi Değiştir | `POST /auth/verify-password` → `PUT /auth/change-password` |
| Bildirim Ayarları (4 anahtar + saat) | `PUT /auth/update-info` › `notificationSettings` |
| Dil Ayarları · Tema Değiştir · Kanji Font Boyutu | `PUT /auth/update-info` › `preferences` |
| Günlük Kelime Hedefi (5/10/20/40) | `PUT /auth/update-info` › `dailyGoal` |
| Öğrenme Seviyeni Değiştir | `GET /progress` → `PUT /progress/active-level` |
| Seviye Tespit Sınavına Gir | `POST /quiz/start` › `type: "placement"` |
| Hakkında (sözleşme/gizlilik/KVKK) | `GET /legal` · `GET /legal/:doc` |
| Çıkış Yap | `POST /auth/logout` |

Bildirim ekranındaki dört satır **bağımsız** bayraklardır, hiçbiri diğerini
kapatmaz: "Günlük Kelimeler" → `dailyWord`, "Seri Koruma Uyarısı" →
`streakReminder`, "Pratik Anımsatıcısı" → `dailyReminder` + `reminderTime`,
"Tekrar Gereken Kelimeler" → `wordLevelDown`. Detay ekranındaki "Anımsatıcıyı
Kapat" bağlantısı yalnızca `dailyReminder`'ı false yapar; `reminderTime` saati
`dailyWord` için zamanlama kaynağı olmaya devam eder.

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

### POST /auth/logout
```jsonc
// İstek — refreshToken verilirse SADECE o cihaz, verilmezse TÜM cihazlar çıkar
{ "refreshToken": "eyJ..." }   // veya boş gövde {}

// 200
{ "success": true, "message": "Logged out" }
```
**Access token BURADA ZORUNLU DEĞİL** (bilerek 🔒 işaretsiz): token 15 dakikada
ölüyor ve çıkış tam da uzun süre açık kalmış uygulamada isteniyordu — koruma
altındayken süresi dolmuş token'la gelen istek `401` alıp oturumu ayakta
bırakıyordu. Gövdedeki `refreshToken` o cihaza sahip olmanın kanıtı sayılır ve
tek başına yeterlidir. Süresi dolmuş bir access token gönderilmesi zararsızdır.

**Mobil için kural: `refreshToken`'ı her zaman gövdede gönder.** Access token
geçerliyse gövdesiz çağrı tüm cihazları düşürür; ikisi de yoksa
`401 "No refresh token"` döner (kapatılacak oturum belirlenemediği için
sessizce başarı dönmez).

### DELETE /auth/fcm-token 🔒
Push token'ını siler. Kullanıcı bildirim iznini işletim sisteminden kapattığında çağrılır — `update-info` token'ı **yazar** ama boş değeri yok saydığı için silme yolu yoktu. İdempotent; token zaten yoksa da `200` döner. `isEmailVerified` **aranmaz** (e-posta değişip doğrulama düşse bile kullanıcı kaydı kaldırabilmeli).
```jsonc
// 200
{ "success": true, "message": "Push token temizlendi" }
```
> `POST /auth/logout` de token'ı düşürür: ortak kullanılan bir telefonda çıkış yapan kullanıcının token'ı hesabında kalırsa bildirimler bir sonraki kişinin eline gider. Kullanıcı başına **tek** token tutulduğu için çıkışta koşulsuz temizlenir.

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
    "activeLevel": "N5",       // günlük dersin çekildiği seviye — PUT /progress/active-level ile değişir
    "notificationSettings": { "dailyReminder": true, "dailyWord": true, "reminderTime": "10:00", "streakReminder": true, "wordLevelDown": true },
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
    "streakReminder": false,          // "Seri Koruma Uyarısı"
    "dailyWord": false,               // "Günlük Kelimeler" — dailyReminder'dan AYRI
    "reminderTime": "14:30"           // HH:mm — "Pratik Anımsatıcısı" saati
  },
  "preferences": { "theme": "dark" }  // kısmi güncelleme — language: tr | theme: light/dark/system | fontSize: small/medium/large
}

// 200 — güncellenmiş kullanıcı (GET /auth/me ile aynı biçim)
{ "success": true, "data": { /* ... */ } }
```
Hatalar: `400 "Bu e-posta adresi zaten kullanımda"`, `400` enum validasyonu (geçersiz theme/fontSize), `500 "Doğrulama maili gönderilemedi, e-posta değiştirilmedi"`. `isPremium` bu endpoint'ten **değiştirilemez** (gönderilirse yok sayılır). `password` da **değiştirilemez** — gönderilirse `400 "Şifre bu uçtan değiştirilemez..."`: şifre değişiminin tek kapısı `change-password` (eski şifre doğrulamalı) ve `reset-password` (mail token'lı); ikisi de oturum rotasyonu yapar. `activeLevel` de **değiştirilemez** (yok sayılır): seçilen seviyenin açık olması gerekir, o kontrol `PUT /progress/active-level`'dadır.

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
  "meaning": "station",              // İNGİLİZCE
  "meaningTr": "istasyon, tren istasyonu",  // TÜRKÇE
  "type": "isim",
  "jlptLevel": "N5",       // N5 | N4 | N3 | N2 | N1
  "example": "東京**駅**で会いましょう。",
  "exampleFurigana": "東京[とうきょう]**駅[えき]**で会[あ]いましょう。",
  "exampleTr": "Tokyo istasyonunda buluşalım.",
  "isKana": false,         // kanji alanında hiç ideograf yok (それから, いつも)
  "isCore": true           // aktif oyun havuzunda mı
}
```

**Boş alanlar yanıtta bulunmaz, `null` olarak gelmez.** Yukarıdaki örnekte `audioUrl`
(varsa "Dinle" butonu; "Yavaş" client'ta oynatma hızıyla) ve `imageUrl` yok — ikisi de
bugün her kelimede boş. Client `x === null` değil, **alanın varlığını** kontrol etmeli.

Veri setindeki 5816 kelimenin tamamı çekirdektir (`isCore: true`), yani `includeAll`
bugün bir fark yaratmaz; parametre ileride çekirdek dışı kelime eklenirse diye duruyor.

**Anlam alanları — hangisini göstereceğine client karar verir.** Yanıt her zaman ikisini
birden taşır: `meaning` İngilizce, `meaningTr` Türkçe. Sunucu dile göre seçim yapmaz,
çünkü aynı hesap iki cihazda farklı dilde açılabilir. Uygulamanın dili Türkçeyse
`meaningTr`, İngilizceyse `meaning` okunmalı. `meaningTr` boş gelen eski kayıtlarda
`meaning`'e düşülebilir (çekirdek sette hepsi dolu).

**Örnek cümle işaretlemesi.** `example` ve `exampleFurigana` aynı cümlenin iki gösterimi:

| Alan | İçerik | Kullanım |
|---|---|---|
| `example` | `東京**駅**で会いましょう。` | işaretlemesiz düz cümle gerektiğinde |
| `exampleFurigana` | `東京[とうきょう]**駅[えき]**で会[あ]いましょう。` | kütüphane detay kartı (tasarımdaki hâli) |

- `[...]` içindeki okunuş, **kendinden önceki karaktere** aittir → ruby olarak üstüne yazılır.
- `**...**` cümledeki **hedef kelimeyi** işaretler → tasarımdaki kırmızı vurgu.
- Okunuşu olmayan (tamamı kana) cümlelerde `exampleFurigana` yalnızca `**` taşır; hiç
  örnek cümlesi olmayan kelimede alan gelmez.

### GET /words 🔒✉️
Kütüphane listesi **ve** araması bu uçtan gelir.

Query (hepsi opsiyonel): `?q=tren&jlptLevel=N5&type=isim&page=1&limit=20&includeAll=false`
- `q` — `kanji`, `kana`, `romaji`, `meaning` (İng.) ve `meaningTr` (Tür.) alanlarında arar.
  Yani kullanıcı hem `駅`, hem `えき`, hem `eki`, hem `station`, hem `istasyon` yazarak bulabilir.
- `limit` en fazla 100; `includeAll=true` çekirdek olmayan kelimeleri de dahil eder
  (bugün böyle bir kelime yok — yukarıdaki nota bak).

```jsonc
// 200
{
  "success": true,
  "data": {
    "words": [ /* Word[] */ ],
    "total": 300,     // filtreye uyan TÜM kayıt sayısı (sayfadaki değil)
    "page": 1,
    "totalPages": 15
  }
}
```

Sıralama `frequencyRank` (seviye içi müfredat sırası, küçük = önce öğretilir), eşitlikte
`_id`. **Sayfalama bu sıraya güvenir**; `?jlptLevel=` ile çağırdığında kelimeler
öğretilme sırasında gelir. Seviye filtresi verilmezse seviyeler bu sıraya göre iç içe geçer.

### GET /words/search?q=mizu 🔒✉️ (eski uç)
`GET /words?q=` ile aynı arama alanlarını kullanır ama **sayfalama yok**: sabit en fazla
20 sonuç döner ve `total` bilgisi vermez — yani sonuç 20'yi aşınca kullanıcı sessizce
eksik liste görür. Yeni ekranlarda `GET /words?q=` kullan; bu uç geriye dönük uyumluluk
için duruyor.
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

### GET /userwords/today 🔒✉️
**Parametre almaz.** Dersin seviyesi kullanıcının profilindeki `activeLevel`'dır
(Ayarlar > "Öğrenme Seviyeni Değiştir" → `PUT /progress/active-level`).

> **Değişiklik:** bu uç eskiden zorunlu bir `jlptLevel` query parametresi
> isterdi. Artık **gönderilirse yok sayılır** (hata değil). Havuzun kimliği
> `{user, gün, jlptLevel}` üçlüsü olduğu için istemcinin seviyeyi belirlemesi,
> aynı akışta farklı değerler gönderildiğinde ikinci bir havuz açtırıyordu
> (çift kelime seti, ilerleme çemberinin paydasının şişmesi). Seviyenin tek
> yazıcısı artık sunucuda: kullanıcı başına tek `activeLevel`, güne tek havuz.

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

    // DİKKAT: answered burada "kaç kelimeye DOKUNULDU"dur, ertelenenler DAHİL.
    // İlerleme göstergesi için bunu DEĞİL, aşağıdaki today.completedWords'ü kullan.
    "progress": { "total": 30, "answered": 12, "remaining": 18 },

    "goal": 30,                  // bu turun boyutu = progress.total
    "today": {                   // /home/summary ile AYNI kaynak ve şekil
      "completedWords": 9,       // "X/Y Tamamlandı" ifadesinin PAYI
      "totalWords": 12,          // dokunulan kelime sayısı (erteleme dahil)
      "correctCount": 7,
      "wrongCount": 2,
      "emptyCount": 3,
      "isCompleted": false
    }
  }
}
```
Ders ekranı kendi yerel sayacını **tutmamalı**: her `/userwords/answer` yanıtı da aynı `goal` + `today` bloğunu döner, başlık her cevapta oradan tazelenir. İki ekranın ayrı kaynaktan beslenip farklı "X/Y" göstermesi böylece imkânsız olur. `completedWords`'ün tanımı ve neden `totalWords` olmadığı için [Hangi sayı ilerlemedir](#ana-ekran--home) notuna bak.
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

**Ertelenmiş kelime varken ders bitirilemez.** "Şimdilik Geç" (`empty`) nihai cevap değildir; o kelimeler gün içinde yeniden sorulmalıdır. Tur burada kapatılsaydı (`roundClosedAt`) havuzdan düşer ve kullanıcı cevaplamadığı hâlde "Tamamlandı" ekranını görürdü.

```jsonc
// 409 — hâlâ ertelenmiş kelime var
{
  "success": false,
  "message": "Ertelenmiş 3 kelime var, ders tamamlanamaz",
  "details": { "pendingWords": 3 }
}
```
Doğru akış: `/userwords/today`'i tazele, `answeredToday:false` olanları yeniden sor, kuyruk boşalınca `complete` çağır.

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
Ayarlar > **"Öğrenme Seviyen"** ekranının tamamı. Sıra N1→N5'tir (tasarımdaki
liste sırası: kilitli üstte, tamamlanan altta).
```jsonc
// 200
{
  "success": true,
  "data": {
    "completionThreshold": 75,   // "Bir sonraki seviyeye geçmek için listeyi %75 oranında tamamlayın" kutusu
    "activeLevel": "N4",         // günlük dersin çekildiği seviye
    "levels": [
      {
        "jlptLevel": "N3",
        "label": "Orta",         // satır başlığı: "N3 • Orta"
        "isUnlocked": false,
        "completionRate": 0,
        "totalWords": 500,
        "isActive": false,
        "state": "locked",       // locked | available | active | completed
        "canSelect": false,      // satırdaki "Geç" bağlantısı çizilir mi
        "unlockHint": "N4'ün %75'i ile açılır"   // yalnızca locked'da dolu
      },
      {
        "jlptLevel": "N4", "label": "Temel", "isUnlocked": true,
        "completionRate": 42, "totalWords": 400,
        "isActive": true, "state": "active", "canSelect": false, "unlockHint": null
      },
      {
        "jlptLevel": "N5", "label": "Başlangıç", "isUnlocked": true,
        "completionRate": 88, "totalWords": 300,
        "isActive": false, "state": "completed", "canSelect": true, "unlockHint": null
      }
    ]
  }
}
```
`state` ile `canSelect` ayrı şeylerdir: **açık ve şu an seçili olmayan her
seviye seçilebilir**, tamamlananlar dahil — kullanıcı eski seviyesine dönebilir.
`completed` ile `active` de ayrıktır: %75'i geçmiş seviyede çalışmaya devam eden
kullanıcı "Tamamlandı" değil "Şu anki seviyen" görmelidir.

Seviye **kilidini** açmanın iki yolu var: çalışarak tamamlanma oranını
`completionThreshold`'a (%75) ulaştırmak, ya da Seviye Tespit Sınavı'nda o
seviyenin çıkması. Ayrı bir "seviye atlama sınavı" **yoktur** (kaldırıldı).

Kilidin açılması `activeLevel`'ı **kendiliğinden taşımaz** — geçiş kullanıcının
onayına bağlıdır (anasayfadaki "Şimdi Geç" butonu, aşağıdaki uca gider). Tek
istisna STS: sınav sonucu doğrudan `activeLevel` olur.

### PUT /progress/active-level 🔒✉️
Ayarlar > "Öğrenme Seviyeni Değiştir" onayı ve anasayfadaki "Şimdi Geç" butonu.
```jsonc
// istek
{ "jlptLevel": "N4" }
```
Yanıt, `GET /progress` ile **birebir aynı gövdedir** (güncellenmiş hâliyle) —
"Seviyen Güncellendi!" ekranından listeye dönerken ikinci bir istek gerekmesin.

Hatalar: `400 "jlptLevel N5-N1 arasında olmalı"` · `403 "Bu seviye henüz kilitli"`.

İlerleme **hiçbir şekilde silinmez**: geçiş yalnızca günlük dersin hangi havuzdan
çekileceğini değiştirir. Gün ortasında seviye değiştiren kullanıcının eski
havuzu da durur (havuz anahtarı `{user, gün, jlptLevel}`), geri döndüğünde
kaldığı yerden devam eder. Seri (streak) seviyeden bağımsızdır, bozulmaz.

Bu alan `PUT /auth/update-info` ile **değiştirilemez**; kilit kontrolünün tek
kapısı burasıdır.

**İstisna — Seviye Tespit Sınavı:** placement bittiğinde `activeLevel` belirlenen
seviyeye (`summary.determinedLevel`) sunucu tarafından taşınır, ayrıca onay
istenmez. Sınavın amacı zaten kullanıcıyı doğru seviyeye yerleştirmektir.

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

Bu uç **ham** dağılımdır (mastery 1-5 + `notStarted`). Hafıza sekmesinin beş
kutusu bunun etiketlenmiş hâlidir → `GET /memory`.

---

## Hafıza — `/memory`

Alt sekmedeki **Hafıza** ekranı: seviye kartı + beş kutu dağılımı + seçili
kutunun kelime listesi. Kapsam varsayılan olarak kullanıcının **aktif
seviyesidir**; iki uç da opsiyonel `?jlptLevel=N4` ile başka bir seviyeye
bakabilir.

| Ekrandaki blok | Uç |
|---|---|
| Seviye kartı (N5 · Başlangıç · "%65 / %75") | `GET /memory` |
| Renk şeridi + beş kutu + "Bu hafta +23 …" çipi | `GET /memory` |
| "Zayıf Kutusundakiler" listesi ve "Tümünü Gör" | `GET /memory/words?box=weak` |
| Kelimeye dokununca açılan detay | `GET /words/:id` |

**Kutu ↔ `masteryLevel` eşlemesi** (sunucuda tutulur, istemci kendi sözlüğünü
taşımaz — yanıttaki `masteryLevels` alanı bunu zaten söyler):

| Kutu | `key` | Kaynak | Kilide sayılır mı |
|---|---|---|---|
| Yeni | `new` | UserWord kaydı **hiç yok** | ✗ |
| Zayıf | `weak` | masteryLevel 1–2 | ✗ |
| Orta | `medium` | masteryLevel 3 | ✓ |
| İyi | `good` | masteryLevel 4 | ✓ |
| Ezber | `mastered` | masteryLevel 5 | ✓ |

Beş kutunun toplamı **seviyenin tüm core kelimelerine eşittir** (`totalWords`).
Kilide sayılan üç kutunun oranı da `GET /progress`'teki `completionRate` ile
aynı sayıdır — ikisi de aynı eşiği (`masteryLevel >= 3`) kullanır, ayrışamaz.

"Şimdilik Geç" ile ertelenen kelimenin kaydı **açılmıştır** (masteryLevel 1),
yani Yeni'de değil **Zayıf**'ta görünür.

### GET /memory 🔒✉️
```jsonc
// 200
{
  "success": true,
  "data": {
    "jlptLevel": "N5",
    "label": "Başlangıç",         // kart başlığı: "N5 · Başlangıç Seviyesi"
    "isActiveLevel": true,        // ?jlptLevel ile başka seviyeye bakılıyorsa false
    "totalWords": 380,
    "completionThreshold": 75,
    "completionRate": 65,         // çubuktaki "%65 / %75"in payı
    "remainingPercent": 10,       // "N4'e geçmene %10 kaldı"
    "nextLevel": { "jlptLevel": "N4", "label": "Temel", "isUnlocked": false },
    "unlockHint": "Orta, İyi ve Ezber kutularının toplamı %75'i geçince N4 açılır.",
    "boxes": [
      { "key": "new",      "label": "Yeni",  "count": 76,  "masteryLevels": [],     "countsTowardUnlock": false },
      { "key": "weak",     "label": "Zayıf", "count": 57,  "masteryLevels": [1,2],  "countsTowardUnlock": false },
      { "key": "medium",   "label": "Orta",  "count": 46,  "masteryLevels": [3],    "countsTowardUnlock": true },
      { "key": "good",     "label": "İyi",   "count": 106, "masteryLevels": [4],    "countsTowardUnlock": true },
      { "key": "mastered", "label": "Ezber", "count": 95,  "masteryLevels": [5],    "countsTowardUnlock": true }
    ],
    "defaultBox": "weak",         // açılışta seçili gelen kutu
    "weeklyImproved": 23          // "↗ Bu hafta +23 kelime iyiye geçti"
  }
}
```
Hata: `400 "Invalid level"`.

`weeklyImproved` = bu hafta masteryLevel'ı **2'den 3'e geçen** (yani kilide
sayılan bölgeye giren) kelime sayısı. Kurallar:
- Hafta sınırı anasayfadaki seri şeridiyle **aynıdır** (Pzt→Paz, kullanıcının
  saat diliminde).
- Bölge içindeki yükselişler (3→4→5) sayıyı **artırmaz** — kelime bölgeye ilk
  girdiği hafta bir kez sayılır.
- Kelime bölgenin altına düşerse (yanlış cevap ya da mastery decay) izi silinir,
  geri tırmandığında yeniden sayılır.
- **`null` dönebilir:** bu veri geriye dönük üretilemediği için (özellik
  öncesindeki yükselişler hiçbir yere yazılmadı) izleme başlangıcından önceki
  haftalarda alan `null`'dır. **`null` ise çip hiç çizilmemelidir** — "+0"
  göstermek yanlış olur.

`nextLevel` N1'de `null`'dır (`remainingPercent` de öyle). Sonraki seviyenin
kilidi zaten açıksa `isUnlocked: true`, `remainingPercent: 0` ve `unlockHint`
"N4 kilidi açıldı." olur; geçişin kendisi anasayfadaki "Şimdi Geç" →
`PUT /progress/active-level` akışıdır, bu uç **hiçbir şey değiştirmez**.

### GET /memory/words?box=weak&page=1&limit=20 🔒✉️
"Zayıf Kutusundakiler" listesi ve "Tümünü Gör". `box` zorunludur; `jlptLevel`,
`page`, `limit` opsiyonel (`limit` en fazla 100).
```jsonc
// 200
{
  "success": true,
  "data": {
    "box": "weak",
    "label": "Zayıf",             // "Zayıf Kutusundakiler" başlığı
    "jlptLevel": "N5",
    "items": [
      {
        "word": { /* tam Word dokümanı — Kütüphane satırıyla aynı biçim */ },
        "box": "weak",
        "masteryLevel": 2,
        "nextReviewDate": "2026-08-09T00:00:00.000Z",
        "lastReviewDate": "2026-08-07T09:12:00.000Z",
        "lastResult": "wrong"
      }
    ],
    "total": 57,
    "page": 1,
    "totalPages": 3
  }
}
```
Hatalar: `400 "box: new, weak, medium, good, mastered olmalı"` · `400 "Invalid level"`.

**Sıralama:**
- `box=new` → `frequencyRank` artan (**müfredat sırası**): listenin başındaki
  kelime, günlük derste sıradaki yeni kelimedir. Bu kutuda `masteryLevel`,
  `nextReviewDate`, `lastReviewDate`, `lastResult` **`null`**'dır — kayıt yok.
- Diğer kutular → vadesi en yakın önce, eşitlikte en düşük seviye
  (`nextReviewDate` ↑, `masteryLevel` ↑). Günlük havuzun tekrar sıralamasıyla
  **aynı kuraldır**: listenin başındaki kelime yarınki derste ilk gelecek olandır.

`total`, kutunun `GET /memory` yanıtındaki `count` değeriyle **aynıdır** —
ekranda "76 Yeni" yazıp listeye girince başka bir sayı çıkmaz.

---

## Seviye Tespit Sınavı — `/quiz`

Tek seferde **40 soruluk** karma sınav. Beş seviyeden soru gelir (N5:6, N4:6,
N3:8, N2:10, N1:10), sorular kolaydan zora sıralıdır ve her soru kendi seviye
rozetini taşır. **Geçme/kalma yoktur** — sınavın çıktısı bir seviyedir.

> **Değişiklik (07.08.2026):** Sınav eskiden "merdiven"di — 10'ar soruluk beş
> ayrı basamak, basamak başına %70 eşiği, `nextRung` ile devam. Tamamen kalktı.
> **Seviye atlama sınavı (`levelup`) de kaldırıldı**: seviye artık yalnızca
> çalışarak (%75 ustalık) açılıyor ve geçiş kullanıcının onayına bağlı
> (bkz. `PUT /progress/active-level`).

**Seviye nasıl belirlenir.** En yüksek seviyeden aşağı taranır: bir seviyenin
sorularının **%60'ını** doğru yapan kullanıcı o seviyededir. Hiçbiri tutmazsa
N5. Yukarıdan taranmasının sebebi, N3'ü bilen birinin N5/N4 sorularını da
bilmesi — aşağıdan tarasaydık ilk eşiği geçtiği yerde durup seviyeyi düşük
gösterirdik. Tek bir şanslı N1 doğrusu seviyeyi şişiremez, ölçüt o seviyenin
oranıdır.

**Sonuç ne yapar.** Belirlenen seviyeye KADAR olan tüm seviyelerin kilidi açılır
ve kullanıcının `activeLevel`'ı oraya taşınır (STS'nin işi zaten yerleştirme
olduğu için "Şimdi Geç" onayı istenmez). Tekrar girilen sınav **kilitleri geri
kapatmaz** — hak edilmiş ilerleme bir sınav sonucuyla geri alınmaz.

### GET /quiz/status 🔒✉️
Sınav önü ekranının (Ayarlar > "Seviye Tespit Sınavına Gir") tamamı.
```jsonc
// 200
{
  "success": true,
  "data": {
    "placementAvailable": true,           // Başla butonu aktif mi
    "nextAttemptAllowedAt": null,         // cooldown'daysa ISO tarih (geri sayım için)
    "hasTakenPlacement": false,
    "retakeCooldownDays": 14,
    "totalQuestions": 40,
    "secondsPerQuestion": 20,
    // Sınav önü ekranındaki liste, N1'den N5'e
    "distribution": [
      { "jlptLevel": "N1", "label": "Uzman",     "questionCount": 10 },
      { "jlptLevel": "N2", "label": "İleri",     "questionCount": 10 },
      { "jlptLevel": "N3", "label": "Orta",      "questionCount": 8  },
      { "jlptLevel": "N4", "label": "Temel",     "questionCount": 6  },
      { "jlptLevel": "N5", "label": "Başlangıç", "questionCount": 6  }
    ],
    "inProgressQuizId": null              // yarım sınav varsa id'si
  }
}
```
Ayarlardaki satır **koşulsuz görünür**: sınav tekrar girilebilir olduğu için
gizlenmesi/pasifleşmesi gereken bir durum yok, cooldown'da yalnızca geri sayım
gösterilir.

### POST /quiz/start 🔒✉️
```jsonc
// İstek — gövde opsiyonel (type varsayılanı "placement")
{ }

// 200
{
  "success": true,
  "data": {
    "quizId": "665f5e...",
    "type": "placement",
    "expiresAt": "2026-08-07T10:30:00.000Z",  // 30 dk — süresinde bitirilmezse expired
    "secondsPerQuestion": 20,
    "totalQuestions": 40,
    "answeredCount": 0,                       // yarım sınav sürüyorsa >0
    "questions": [
      {
        "index": 0,
        "jlptLevel": "N5",                    // soru başlığındaki rozet
        "format": "meaning",
        "prompt": { "kanji": "駅", "romaji": "eki", "audioUrl": "https://..." },
        "choices": ["istasyon", "tren", "araba", "ben"],  // doğru cevap işaretli DEĞİL
        "answered": false
      }
    ]
  }
}
```

**Soru başına 20 saniyeyi sunucu DENETLEMEZ.** Sayacı istemci tutar; süre
dolunca boş cevap gönderir (boş = yanlış). Sunucu tarafı denetim ağ
gecikmesinde haksız "süren doldu" üretirdi ve burada hile motivasyonu yok —
kullanıcı yüksek seviye çıkarsa kendine zor ders getirmiş olur.

Soru formatları ve `prompt` biçimleri:
| format | Ekran | prompt | choices |
|---|---|---|---|
| `meaning` | kelime → anlam seç | `{ kanji, romaji, audioUrl? }` | 4 anlam |
| `reverse` | anlam → kelime seç | `{ meaning }` (ses YOK — cevabı söylerdi) | 4 kelime |
| `reading` | kanji → okunuş seç | `{ kanji, audioUrl? }` | 4 okunuş |
| `typing` | "Bu kelimenin Türkçesini yazınız" | `{ kanji, romaji, audioUrl? }` | YOK (serbest metin) |
| `fillblank` | "Boşluğa uygun kelimeyi yerleştir" | `{ sentence: "東京____で会いましょう。" }` (ses yok) | 4 kelime |
| `image` | "Doğru şıkkı işaretleyiniz" (görsel) | `{ imageUrl }` (ses yok) | 4 kelime |

`fillblank` ve `image` yalnızca örnek cümlesi/görseli olan kelimelerde
üretilir — içerik DB'ye girdikçe karışımda kendiliğinden görünmeye başlarlar,
kod değişikliği gerekmez. `audioUrl` varsa "Dinle" butonu gösterilebilir
("Yavaş" client'ta oynatma hızıyla yapılır).

Süresi dolmamış yarım bir sınav varsa **yenisi açılmaz, o döner** (`answeredCount`
ile nerede kalındığı bellidir). Aynı anda iki açık sınav, hangisinin cevabının
sayılacağını belirsizleştirirdi.

Hatalar: `400 "Invalid quiz type, use: placement"` ve cooldown:
```jsonc
// 403 — UI geri sayım gösterebilir
{ "success": false, "message": "Seviye tespit sınavına 14 günde bir girebilirsin",
  "nextAttemptAllowedAt": "2026-08-21T09:00:00.000Z" }
```

### POST /quiz/:id/answer 🔒✉️
Her soru cevaplanır cevaplanmaz çağrılır; anlık "Doğru! / Yanlış Cevap!"
kartının verisi döner. Son soru cevaplanınca sınav otomatik sonuçlanır ve
yanıta `result` eklenir.
```jsonc
// İstek — şıklı soruda seçilen indeks (0-3), typing sorusunda yazılan METİN.
// "Şimdilik Geç" ve süre dolması için null veya "" gönderilir (yanlış sayılır).
{ "index": 4, "answer": 2 }        // veya { "index": 4, "answer": "istasyon" }

// 200 — ara soru
{
  "success": true,
  "data": {
    "correct": true,
    "word": { "kanji": "駅", "meaning": "istasyon" },  // kartın "駅 — istasyon" satırı
    "correctIndex": 2,             // şıklı soruda; typing'de yerine "correctAnswer": "istasyon"
    "answeredCount": 5,
    "totalQuestions": 40,
    "finished": false
  }
}

// 200 — SON soru: yukarıdakilere ek olarak result gelir
{
  "success": true,
  "data": {
    "correct": false, "word": { /*...*/ }, "correctIndex": 1,
    "answeredCount": 40, "totalQuestions": 40, "finished": true,

    // "Seviyen Belirlendi" ekranının tamamı
    "result": {
      "determinedLevel": "N4",
      "levelLabel": "Temel",
      "levelDescription": "Günlük konuşmaları ve temel kalıpları anlayabilecek düzeydesin.",
      "totalQuestions": 40,
      "correctCount": 24,
      "wrongCount": 16,             // boş bırakılanlar dahil
      "score": 60,                  // yüzde
      "durationSeconds": 277,       // sonuç kartındaki "4:37"
      "unlockedLevels": ["N4"],     // bu sınavla YENİ açılanlar (zaten açık olanlar yok)
      // "Neden N4 çıktım?" — ekranda gösterilmiyor, istemci isterse açar
      "byLevel": [
        { "jlptLevel": "N5", "total": 6,  "correct": 6 },
        { "jlptLevel": "N4", "total": 6,  "correct": 5 },
        { "jlptLevel": "N3", "total": 8,  "correct": 4 },
        { "jlptLevel": "N2", "total": 10, "correct": 5 },
        { "jlptLevel": "N1", "total": 10, "correct": 4 }
      ]
    }
  }
}
```
`passed`, `passThreshold`, `nextRung`, `placementFinished`, `summary`,
`failCount`, `cooldownDays` alanları **artık dönmüyor** — merdiven ve
geçme/kalma kavramlarıyla birlikte kalktılar.

Typing cevapları sunucuda toleranslı puanlanır: büyük/küçük harf, noktalama,
fazla boşluk ve parantez içleri yok sayılır; anlamın virgülle ayrılmış her
varyantı tek başına kabul edilir.

Hatalar: `404 "Quiz not found"`, `400 "Bu quiz zaten sonuçlanmış"` (terk edilmiş
sınav da bunu döner), `400 "Quiz süresi doldu, yeniden başlat"` (30 dk),
`400 "index 0-39 arası olmalı"`, `400 "Bu soru zaten cevaplandı"`.

### POST /quiz/:id/abandon 🔒✉️
Sınav ekranından çıkış: "Çıkmak İçin Emin Misiniz? → **Çık**".
```jsonc
// 200
{ "success": true, "data": { "abandoned": true } }
```
Yarım sınav geçersiz sayılır (`status: "abandoned"`), sonraki giriş **baştan**
başlar. **Cooldown yakmaz** — kullanıcı bir ölçüm almadı, 14 gün bir sonuç için
bekletiliyor, terk için değil.

Kullanıcı çıkarken bu ucu çağırmazsa (uygulama kapandı, ağ gitti) sınav 30
dakika sonra kendiliğinden `expired` olur.

Hatalar: `404 "Quiz not found"`, `400 "Bu quiz zaten sonuçlanmış"`.

### POST /quiz/placement/defer 🔒✉️
Anasayfadaki "Seviyeni Öğrenelim Mi?" modalında **"Daha Sonra"**.
```jsonc
// 200
{ "success": true, "data": { "deferred": true } }
```
Modal bir daha açılmaz (`GET /home/summary` → `placementPrompt: false`). Sınavı
iptal etmez: Ayarlar'daki satırdan istediği zaman girebilir.

Bu uç olmadan modal her anasayfa açılışında yeniden çıkıyordu — erteleme
istemcide saklanıyordu ve cihaz değişince/yeniden kurulumda geri geliyordu.

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
Anasayfanın tek istekte tüm verisi. **Hikâye şeridi buna dahil değildir** — her hikâyenin tüm slayt URL'lerini taşıdığı için ayrı tutuldu; `GET /stories` ile paralel çağırın (bkz. [Hikâyeler — `/stories`](#hikâyeler--stories)).

```jsonc
// 200
{
  "success": true,
  "data": {
    "name": "Emirhan",              // "Merhaba Emirhan" başlığı
    "greeting": "こんにちは",         // ismin üstündeki Japonca satır; kullanıcının
                                    // saat dilimine göre おはようございます (<11) /
                                    // こんにちは (<18) / こんばんは
    "avatarUrl": null,              // başlıktaki avatar — ŞU AN HER HESAPTA null
                                    // (avatar yükleme henüz yok). Boşsa baş harf çiz.
    "unreadNotifications": 3,       // zil ikonunun rozeti (0 ise rozet yok)

    // Başlığın altındaki seviye bandı: "N4 • Temel Seviyesi"
    "activeLevel": "N4",
    "activeLevelLabel": "Temel",
    // "🔓 Kilit Açıldı / N4 • Temel Seviyesi Hazır / [Şimdi Geç]" kartı.
    // Yalnızca aktif seviyenin BİR SONRAKİSİ açıldıysa dolu, aksi halde null —
    // kart da yalnızca doluyken çizilir. Buton PUT /progress/active-level çağırır;
    // kilit açılması activeLevel'ı kendiliğinden taşımaz, geçiş onaya bağlıdır.
    "advanceableLevel": { "jlptLevel": "N4", "label": "Temel" },
    // "Seviyeni Öğrenelim Mi?" modalı açılsın mı. Yalnızca hiç sınava girmemiş
    // VE ertelememiş kullanıcıda true. "Daha Sonra" → POST /quiz/placement/defer,
    // bayrak kalıcı olarak söner (erteleme eskiden istemcide tutuluyordu ve
    // modal her anasayfa açılışında geri geliyordu).
    "placementPrompt": false,

    "goal": 20,                     // ilerleme çemberinin PAYDASI: bugünün havuz
                                    // boyutu (havuz yoksa dailyGoal)
    "dailyGoal": 20,                // ayarlardaki tercih — çember için goal'u kullan, bunu DEĞİL
    // completedWords = çemberin PAYI (nihai cevabı verilmiş kelime sayısı).
    // totalWords "kaç kelimeye dokundun"dur ve ertelenenleri de sayar —
    // çemberde KULLANMA (bkz. aşağıdaki "Hangi sayı ilerlemedir" notu).
    "today": { "completedWords": 8, "totalWords": 11, "correctCount": 6, "wrongCount": 2, "emptyCount": 3, "isCompleted": false },

    // "🔥 12 Gün" + altındaki yedi daire
    "streak": {
      "current": 12,
      "longest": 21,
      "lastStudyDate": "2026-08-06T06:45:00.000Z",
      "week": [                     // içinde bulunulan TAKVİM haftası, Pzt→Paz, hep 7 öğe
        { "date": "2026-08-03", "weekday": 1, "studied": true,  "isToday": false, "isFuture": false },
        { "date": "2026-08-04", "weekday": 2, "studied": true,  "isToday": false, "isFuture": false },
        { "date": "2026-08-05", "weekday": 3, "studied": false, "isToday": false, "isFuture": false },
        { "date": "2026-08-06", "weekday": 4, "studied": true,  "isToday": true,  "isFuture": false },
        { "date": "2026-08-07", "weekday": 5, "studied": false, "isToday": false, "isFuture": true }
        // ... Cmt, Paz
      ]
    },

    "todayMistakeCount": 7,         // "Bugünün Hataları — 7 Hata" başlığı: hatanın TAMAMI
    "todayMistakes": [              // aynı kartın altındaki çipler — ÖNİZLEME, en fazla 8
      { "id": "665f2b...", "kanji": "食べる", "romaji": "taberu",
        "meaning": "to eat", "meaningTr": "yemek yemek", "jlptLevel": "N5" }
    ],

    // --- Aşağıdakilerin yeni tasarımda karşılığı YOK, okumayın (deprecated) ---
    "progress": [ { "jlptLevel": "N5", "isUnlocked": true, "completionRate": 42 } ],
    "pendingReviews": 12,
    "tomorrowReviews": 20
  }
}
```

**`streak.week` nasıl çizilir.** Dizi ham gerçekleri taşır, görsel eşleme istemcinindir:

| Durum | Çizim |
|---|---|
| `isToday` | 🔥 alev |
| `studied && !isToday` | ✓ dolu daire |
| `isFuture` veya çalışılmamış geçmiş gün | kesikli boş daire |

Gün etiketleri (`Pzt`, `Salı`…) `date`'ten yerel olarak biçimlendirilir; `weekday` 1=Pazartesi … 7=Pazar. Hafta ve `studied` kullanıcının **profil saat dilimine** göre hesaplanır (cihaz saatine göre değil), böylece şeritteki tikler seri sayacıyla aynı şeyi söyler.

`studied` = o gün en az bir **gerçek cevap** verilmiş (doğru veya yanlış). "Şimdilik Geç" (`empty`) çalışma sayılmaz — seri sayacının kuralı da budur.

**Hangi sayı ilerlemedir.** İki farklı sayaç var ve karıştırılmaları 06.08.2026'da bir hataya yol açtı ("20/20 Tamamlandı" yazarken ders bitmiyor, kuyruğu baştan soruyordu):

| Alan | Anlamı | Nerede kullanılır |
|---|---|---|
| `completedWords` | Nihai cevabı (doğru/yanlış) verilmiş kelime sayısı | **Çemberin ve "X/Y Tamamlandı" ifadesinin PAYI** |
| `totalWords` | Dokunulan kelime sayısı — "Şimdilik Geç" dahil | Yalnızca bilgi; ilerleme olarak gösterme |

"Şimdilik Geç" (`empty`) **ilerleme değildir**: kelime gün içinde yeniden sorulur, yani ders bitmemiştir. `totalWords` payda olarak kullanılırsa 18 kelime ertelenmişken ekran "20/20 Tamamlandı" der ama ders devam eder; üstelik sayaç oradan sonra donar (ertelenenin gerçek cevabı `emptyCount`'u düşürür, `totalWords`'e dokunmaz). Aynı kural seri sayacında ve `streak.week`'te de geçerlidir.

`completedWords` her zaman `correctCount + wrongCount`'a eşittir; istemci bunu **kendisi hesaplamamalı**, alanı okumalıdır.

**Deprecated alanlar.** `progress`, `pendingReviews` ve `tomorrowReviews` 04.08.2026 tasarım revizyonunda anasayfadan kalktı ("Yarın N Kart Bekliyor" bandı ve seviye ilerleme listesi artık çizilmiyor). Yayındaki uygulamayı kırmamak için yanıtta duruyorlar; **yeni istemci kodu okumamalı.** Seviye ilerlemesinin asıl yeri `/progress` uçlarıdır.

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
    "completedWords": 13,      // çember: 13/20 (nihai cevaplı kelimeler)
    "totalWords": 14,          // o gün DOKUNULAN kelime sayısı (ertelenenler dahil)
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
  // tipe göre değişir; push deep-link için de aynı içerik gider:
  //   daily_task       → { remaining, dailyGoal }
  //   daily_word       → { wordId, kanji }
  //   streak_*         → { currentStreak }
  //   word_level_down  → { source: "decay", count } · tek kelimede ayrıca { wordId, kanji, newLevel }
  "data": { "currentStreak": 12 },
  "read": false,
  "createdAt": "2026-07-10T20:00:00.000Z"
}
```

Otomatik üretim (kullanıcının KENDİ saat diliminde):
| Saat | Tip | Örnek |
|---|---|---|
| `reminderTime` | `daily_task` | "Bugünün Görevi — Bugün 20 ezberlenecek kelime seni bekliyor!" (yalnızca günün işi bitmemişse; sayı KALAN kelimedir) |
| `reminderTime` | `daily_word` | "Günlük Kelime — Bugünün günlük kelimesi; 危ない (abunai) = tehlikeli" (`data.wordId` ile detaya gidilir) |
| 19:00 | `streak_reminder` | "12 Günlük Seri! — Serini devam ettirmeyi unutma." (yalnızca serisi olup o gün çalışmamışsa) |
| 23:00 | `streak_warning` | "Serini Kaybedeceksin — 1 saat sonra serini kaybedeceksin. Acele et, dersini kaçırma..." |
| 03:00 UTC (decay) | `word_level_down` | tek kelime: "Kelimenin Seviyesi Düştü — 危ない (abunai) kelimesinin seviyesi 3. seviyeye düştü. Uygulamaya gir tekrar hatırla!" · çok kelime: "Kelimeler tazelenmek istiyor 🌱 — … seni bekliyor." |

`reminderTime` kullanıcı tercihidir (`notificationSettings.reminderTime`, varsayılan `10:00`). Üretim cron'u çeyrek saatte bir çalışır; hatırlatma, seçilen saatten sonraki **2 saat** içinde bir kez gönderilir (cron kaçırılırsa bir sonraki tur yakalar, ama gece yarısına sarkmaz). Günün son turu (23:45) gün sonuna ayarlanmış saatleri de üstlenir, yani `23:50` gibi bir seçim kaybolmaz. Aynı gün ikinci kez üretilmez. Hatırlatma saati 19:00/23:00 seçilirse günlük **ve** seri bildirimleri aynı turda üretilir.

**`daily_task` yalnızca gerçekten iş kaldıysa gider.** Gövdedeki sayı hedef değil **kalan** kelimedir (havuz toplamı − bugün cevaplanan); hedefini bitiren kullanıcıya bildirim hiç oluşmaz. Tek üreticisi bu cron'dur — günün havuzu kurulurken ayrıca üretilmez (kullanıcı o an zaten uygulamanın içindedir).

**`word_level_down` yalnızca gece decay işinden gelir.** Cevap anında üretilmez: düşüş bilgisi `POST /userwords/answer` yanıtındaki `levelDropped` / `previousLevel` / `masteryLevel` alanlarıyla zaten dönüyor ve kullanıcı o sırada uygulamanın içinde. Kısıt: son çalışmadan beri en fazla 3 bildirim, iki bildirim arasında en az 3 gün, aynı gün tek kayıt.

Kullanıcının `notificationSettings` tercihleri kapalıysa ilgili tip hiç oluşmaz — eşleme "Bildirim Ayarları" ekranıyla birebirdir:

| Ayarlar ekranındaki kontrol | Alan | Susan tipler |
|---|---|---|
| Günlük Kelimeler (あ) | `dailyWord` | `daily_word` |
| Seri Koruma Uyarısı (alev) | `streakReminder` | `streak_reminder`, `streak_warning` |
| Pratik Anımsatıcısı (takvim+saat) + "Anımsatıcıyı Kapat" | `dailyReminder` | `daily_task` |
| Tekrar Gereken Kelimeler (↘) | `wordLevelDown` | `word_level_down` |

`reminderTime` **iki tip için de** zamanlama kaynağıdır: `dailyReminder` kapalı ama `dailyWord` açıksa günlük kelime yine seçilen saatte gider.

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

## Görsel yükleme — `/uploads` (yalnızca admin)

Anasayfanın üstündeki hikâye kartlarının (ve ileride kelime görsellerinin) görselleri buradan yüklenir. Mobil uygulamanın **yükleme** uçlarını çağırması gerekmez — normal kullanıcı `403` alır; uygulama yalnızca dönen `url`'i gösterir.

**İstek biçimi:** `multipart/form-data` (bu bölümdeki uçlar JSON almaz).

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `image` | evet | Dosyanın kendisi. JPEG, PNG, WebP veya GIF. En fazla **20 MB** — sunucu zaten yeniden kodluyor, tavan telefon fotoğraflarını reddetmesin diye geniş tutuldu. |
| `preset` | hayır | `story` (varsayılan), `storyCover` veya `word` |

**Ön ayarlar** hem hedef klasörü hem de maksimum boyutu belirler (oran korunur, görsel büyütülmez):

| preset | kullanım | maksimum |
|---|---|---|
| `story` | tam ekran hikâye kartı | 1080 × 1920 |
| `storyCover` | anasayfadaki daire kapak | 512 × 512 |
| `word` | kelime kartı görseli | 800 × 800 |

Yüklenen her dosya sunucuda **yeniden kodlanır**: EXIF/konum verisi silinir, yön düzeltilir, WebP'e çevrilir. Dolayısıyla dönen dosya her zaman `.webp`'tir ve boyutu gönderdiğinizden farklıdır. SVG **kabul edilmez**; dosya türü uzantıya/`Content-Type`'a değil dosyanın kendi baytlarına bakılarak belirlenir.

### POST /uploads 🔒✉️ (admin)
```jsonc
// 201
{
  "success": true,
  "data": {
    "key": "stories/9f2c4a...b1.webp",                       // kalıcı kimlik — DB'de BU saklanır
    "url": "https://<backend>/uploads/stories/9f2c4a...b1.webp",
    "width": 1080,
    "height": 1697,
    "bytes": 84210,
    "preset": "story"
  }
}
```
Dosya adı içeriğin hash'idir: aynı görsel iki kez yüklenirse aynı `key` döner (kopya birikmez) ve bir URL'nin işaret ettiği görsel asla değişmez — istemci sonsuza dek cache'leyebilir.

Hatalar: `400 "Görsel dosyası gerekli..."`, `400 "Görsel çok büyük (en fazla 20 MB)"`, `400 "Desteklenmeyen dosya biçimi... (SVG kabul edilmez)"`, `400 "Görsel çözümlenemedi, dosya bozuk olabilir"`, `400 "Geçersiz preset ..."`, `403` (admin değil), `429` (15 dakikada 60 yükleme sınırı).

### DELETE /uploads?key=stories/9f2c...webp 🔒✉️ (admin)
```jsonc
// 200
{ "success": true, "message": "Görsel silindi" }
```
İdempotenttir: zaten silinmiş bir `key` de `200` döner. Hata: `400 "Geçersiz görsel anahtarı"` (biçime uymayan key).

### GET /uploads/:key
Görselin kendisi. Kimlik doğrulama **istemez** (uygulamadaki `<Image>` bileşenleri token gönderemez), `Cache-Control: immutable` ile bir yıl cache'lenir. Bulunamazsa `404`.

> Depolama yeri ortam değişkeniyle seçilir (`STORAGE_DRIVER`). Şu an yerel disk kullanılıyor; sağlayıcı değişirse `url` değişir, `key` **değişmez** — bu yüzden istemci tarafında da `url` önbelleğe alınmamalı, kayıtla birlikte gelen güncel `url` kullanılmalıdır.

---

## Hikâyeler — `/stories`

Anasayfanın üstündeki daire şeridi ("bilgi kutucukları"). İçerik adminler tarafından `/admin` panelinden girilir; mobil uygulama yalnızca okur ve "görüldü" işaretler.

`Story` nesnesi (kullanıcı görünümü):
```jsonc
{
  "id": "66b1f2...",
  "title": "Sakura",                                    // dairenin ALTINDAKİ etiket, en fazla 24 karakter
  "coverUrl": "https://<backend>/uploads/story-covers/....webp",
  "seen": false,                                        // false → halka kırmızı, true → gri
  "isPinned": true,                                     // sabitlenmiş: şeridin başında durur
  "slides": [
    { "url": "https://<backend>/uploads/stories/....webp" },
    { "url": "https://<backend>/uploads/stories/....webp" }
  ]
}
```

### GET /stories 🔒✉️
Yayında olan ve süresi geçmemiş hikâyeler, gösterim sırasında.
```jsonc
// 200
{ "success": true, "data": [ /* Story[] */ ] }
```
Slaytlar listeyle **birlikte** gelir — daireye dokunulduğunda ikinci istek atmaya gerek yok. Hikâye sayısı azdır (onlarca değil, birkaç tane).

Sıra sunucuda belirlenir: **önce sabitlenenler** (`isPinned: true`), sonra diğerleri; her grup kendi içinde adminin panelden verdiği sıradadır. İstemci yeniden sıralamamalı — gelen diziyi olduğu gibi göstersin. `isPinned` yalnızca bilgi amaçlıdır (istenirse rozet gösterilebilir).

### POST /stories/:id/opened 🔒✉️
Hikâye **açılır açılmaz** çağrılır; gövde yok. `seen` işaretlemez — yalnızca analitik olayı yazar.
```jsonc
// 200
{ "success": true, "message": "Açılma kaydedildi" }
```
Hata: `404 "Hikâye bulunamadı"`.

### POST /stories/:id/seen 🔒✉️
Kullanıcı **son slaytı bitirdiğinde** çağrılır; gövde yok. İdempotenttir, tekrar çağrılabilir. Hem `seen` işaretler hem tamamlanma olayını yazar.
```jsonc
// 200
{ "success": true, "message": "Görüldü olarak işaretlendi" }
```
Hata: `404 "Hikâye bulunamadı"` — hikâye izlenirken admin silmiş olabilir; istemci bunu **sessizce yutmalı**, kullanıcıya hata göstermemeli.

> **İkisi birden gönderilmeli.** `opened` açılışta, `seen` yalnızca sonuna kadar izlenirse. Yarıda çıkan kullanıcı yalnızca `opened` üretir; ikisinin farkı "kaç kişi açtı, kaçı bitirdi" ölçümünü verir ve admin panelinde gösterilir. `seen`'i açılışta göndermek bu ölçümü anlamsızlaştırır.

> **`seen` ne zaman sıfırlanır:** yalnızca **görsel içerik** değişince — kapak değiştirilirse veya slaytlar eklenir/çıkarılır/sıralanırsa `seen` o kullanıcı için tekrar `false` olur ve halka yeniden yanar. Başlık düzeltmesi, yayından kaldırıp geri alma, bitiş tarihini uzatma ve hikâyelerin panelden yeniden sıralanması `seen`'i **bozmaz**. İstemci tarafında `seen`'i önbelleğe almayın, her `GET /stories`'te gelen değeri kullanın.

### Yönetim uçları 🔒✉️ (yalnızca admin)
Mobil uygulamanın kullanması gerekmez; `/admin` paneli bunları çağırır.

| Metot | Yol | Gövde |
|---|---|---|
| GET | `/stories/admin` | — (pasif + süresi dolmuşlar dahil hepsi; `openCount`, `completedCount`, `completionRate` ile) |
| POST | `/stories` | `{ title, coverKey, slides: [key], isActive?, expiresAt? }` → `201 { data: { id } }` |
| PUT | `/stories/:id` | Aynı alanlar, kısmi gönderilebilir |
| PUT | `/stories/order` | `{ pinnedIds: [...], normalIds: [...] }` — aşağıya bakın |
| DELETE | `/stories/:id` | — (hikâye + görüntülenme kayıtları + başka hikâyede kullanılmayan görseller silinir) |

`coverKey` ve `slides` elemanları `POST /api/uploads`'un döndüğü **key**'lerdir, URL değil. Biçime uymayan bir değer `400 "Geçersiz görsel anahtarı (...)"` döner. `expiresAt` boş/`null` ise hikâye süresizdir; tarih geçince hikâye gizlenir ama **silinmez** (admin tarihi uzatıp yeniden yayına alabilir).

Tipik akış: `POST /api/uploads` (preset `storyCover`) → kapak key'i · `POST /api/uploads` (preset `story`) × N → slayt key'leri · `POST /api/stories`.

**Sıralama ve sabitleme tek çağrıdır.** `PUT /stories/order` ekranda görülen iki grubun tamamını alır:
```jsonc
{ "pinnedIds": ["id3", "id1"], "normalIds": ["id2", "id4"] }
```
Sunucu `isPinned`'i hangi listede olduğuna, `order`'ı da listedeki konuma göre yazar. Ayrı bir "pinle" ucu **yoktur**: pinlemek, bir id'yi diğer listeye taşıyıp bu çağrıyı yapmaktır. İki alan da opsiyoneldir (verilmeyen boş kabul edilir) ama ikisi birden boşsa `400` döner. Bu çağrı `seen` bilgisini **bozmaz** — sıralama ve sabitleme içerik değişikliği sayılmaz.

Yeni oluşturulan hikâye her zaman sabitlenmemiş grubun **sonuna** eklenir.

---

## Sağlık kontrolü

### GET /health
Kimlik doğrulama ve rate limit dışındadır; deploy platformlarının canlılık kontrolü içindir.
```jsonc
// 200
{ "status": "ok" }
```
