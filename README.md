<div align="center">

# 結 Musubi API

**Türkçe konuşanlar için JLPT (N5–N1) temelli Japonca kelime öğrenme uygulamasının backend servisi.**

[![Test](https://github.com/yusufgokkayy/musubi-backend/actions/workflows/test.yml/badge.svg)](https://github.com/yusufgokkayy/musubi-backend/actions/workflows/test.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/express-5-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/mongodb-atlas-47A248?logo=mongodb&logoColor=white)

</div>

---

SM-2 aralıklı tekrar algoritması, kelime başına 1–5 ustalık seviyesi, tek oturumluk seviye tespit sınavı, günlük seri (streak) takibi, uygulama içi + push bildirimleri ve anasayfa hikâyeleri.

**İçindekiler**
[Kurulum](#kurulum) ·
[Arayüzler](#arayüzler) ·
[Mimari](#mimari) ·
[Temel akışlar](#temel-akışlar) ·
[API referansı](#api-referansı) ·
[Testler](#testler) ·
[Zamanlanmış işler](#zamanlanmış-i̇şler) ·
[Güvenlik](#güvenlik-önlemleri) ·
[Yol haritası](#yol-haritası)

> **Mobil geliştirici için:** Her endpoint'in tam istek gövdesi, yanıt örneği ve hata durumları **[API.md](API.md)** dosyasındadır. Buradaki tablolar hızlı özet içindir.

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Runtime | Node.js + Express 5 |
| Veritabanı | MongoDB (Mongoose ODM) |
| Kimlik doğrulama | JWT (access + refresh), cihaz bazlı oturumlar |
| E-posta | Resend |
| Push bildirimleri | Firebase Admin (FCM) |
| Görsel işleme | sharp (yeniden kodlama + EXIF temizliği) |
| Zamanlanmış işler | node-cron |
| Güvenlik | helmet, express-rate-limit, bcrypt |
| Test | node:test (yerleşik) + mongodb-memory-server |

## Kurulum

### 1. Önkoşullar

- Node.js 18+ (yerleşik `fetch` ve `Intl` API'leri kullanılıyor)
- MongoDB bağlantısı (Atlas veya lokal)
- [Resend](https://resend.com) API anahtarı (e-posta doğrulama/şifre sıfırlama için)

### 2. Klonlama

```bash
git clone <repo-url> musubi-backend
cd musubi-backend
npm install
```

Kelime verisi (`veri-seti/`) repoda **yoktur** — `.gitignore`'dadır ve ayrıca temin edilip kök dizine konur. İçinde seviye başına iki dosya bulunur:

```
veri-seti/musubi_n{1..5}.json            # kelime + anlam + örnek cümle (hedef kelime ** ile vurgulu)
veri-seti/musubi_n{1..5}_furigana.json   # aynı cümleler, okunuşlarıyla
```

İkisi seed sırasında tek cümlede birleştirilir (`seeds/furigana-merge.js`): vurgu birinci dosyada, okunuş ikincisinde durur, tasarım ikisini birden ister.

### 3. Ortam değişkenleri

```bash
cp .env.example .env
```

**Zorunlu**

| Değişken | Açıklama |
|---|---|
| `MONGO_URI` | Bağlantı dizesi. **Sonunda DB adı olmalı** — adsız URI sessizce `test` DB'sine yazar |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Birbirinden **farklı**, uzun ve rastgele |
| `CLIENT_URL` | Mail linklerinin işaret ettiği HTTPS adres. Eksikse doğrulama/sıfırlama gönderimi hata verir |
| `RESEND_API_KEY` / `EMAIL_FROM` | `EMAIL_FROM` doğrulanmış bir Resend domaini olmalı |

**Opsiyonel**

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` / `NODE_ENV` | `5000` / `development` | |
| `JWT_EXPIRE` / `JWT_REFRESH_EXPIRE` | `15m` / `30d` | Oturum kaydının TTL'i refresh token'ın kendi `exp`inden türer, süreyi değiştirince kendiliğinden uyar |
| `CORS_ORIGIN` | — | Production'da izin verilen origin'ler (virgülle). Boşsa CORS kısıtsızdır |
| `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` | — | Sosyal girişte `idToken`'ın `aud` claim'i bu listeyle eşleşmeli |
| `NEW_WORD_DAILY_LIMIT` / `REVIEW_DAILY_LIMIT` | `10` / `10` | Yalnızca kullanıcının `dailyGoal`'u yokken devreye girer |
| `STORAGE_DRIVER` / `UPLOAD_DIR` | `local` / `./uploads` | Görsel depolama — aşağıdaki uyarıya bakın |
| `MEMORY_TRACKING_SINCE` | `2026-08-07` | Hafıza ekranındaki haftalık sayımların başlangıcı |
| `IOS_APP_IDS` / `ANDROID_PACKAGE` / `ANDROID_CERT_FINGERPRINTS` | — | Universal / App Links doğrulama dosyaları. Boşken `/.well-known/…` 404 döner ve mail linkleri web'e iner (akış kırılmaz) |
| `SIMULATOR_ENABLED` | `false` | Simülatörü canlıda `/sim` altında açar |

Push bildirimleri için ayrıca `config/firebase-service-account.json` konur (gitignore'da). Production `FIREBASE_SERVICE_ACCOUNT_B64` env'inden okur; dosya yalnızca lokal geliştirme içindir. Anahtar yoksa push sessizce devre dışı kalır, uygulama çalışmaya devam eder.

> [!WARNING]
> **Railway'de `UPLOAD_DIR` bir Volume'a bakmalı.** Konteynerin diski kalıcı değildir: Volume bağlanmazsa yüklenen görseller ilk deploy'da **sessizce** silinir. Panelde servise Volume ekleyip mount path'i (örn. `/data`) verin, ardından `UPLOAD_DIR=/data/uploads` ayarlayın. Volume bağlı servis yatayda ölçeklenemez (tek replika) ve dosyalar otomatik yedeklenmez — bkz. `config/storage/`.

### 4. Veriyi hazırlama

```bash
npm run seed    # veri-seti/'nden 5816 kelimeyi DB'ye yazar (idempotent, tekrar çalıştırılabilir)
```

### 5. Çalıştırma

```bash
npm run dev    # nodemon ile geliştirme
npm start      # production
```

## Arayüzler

Backend üç tarayıcı yüzeyi servis eder. Üçü de derleme adımı olmayan düz HTML/CSS/JS'tir.

### Mobil simülatör (`public/`)

Gerçek API'ye bağlı, telefon çerçevesi içinde çalışan tam uygulama simülasyonu: kayıt/giriş, seviye tespit sınavı, günlük ders, kütüphane, hafıza, ayarlar ve ham istek aracı. Her API çağrısı alttaki istek günlüğüne düşer.

- **Geliştirmede:** `http://localhost:5000/` — koşulsuz açılır.
- **Canlıda:** `SIMULATOR_ENABLED=true` verilirse `/sim` altında açılır. Mobil istemci olmadan uygulamayı web'den test ettirmek için. Sayfa parolasızdır; koruma iki yerdedir — bayrağı silmek yüzeyi tamamen kaldırır (deploy gerekmez), veriye erişim ise `/api`'nin kendi auth'undan geçer. Sayfa `noindex` döner.

Simülatör API'yi göreli yoldan (`/api/...`) çağırır, yani backend'in **kendi origin'inden** servis edilmek zorundadır. Ayrı bir statik host'a koymak hem `CORS_ORIGIN` genişletmesi hem de istemcide adres yapılandırması ister — üstelik ayrı host da aynı canlı API ve DB'ye vurur, hiçbir şeyi izole etmez.

Her istekte `X-Musubi-Client: simulator` başlığı gider. Bu bir **etikettir, kimlik değildir** (taklit edilebilir, hiçbir yetki vermez); tek işi trafiği loglarda ve rate limit kovalarında ayırt edilebilir kılmaktır.

> [!CAUTION]
> `/sim` **canlı veritabanına** bağlanır. Oradan açılan hesaplar, çözülen dersler ve gönderilen doğrulama mailleri gerçektir.

### Admin paneli (`admin/`)

`/admin` adresinde, anasayfa üstündeki hikâyeleri yöneten panel. Simülatörün aksine **her ortamda** servis edilir — içerik canlıdan girilir.

```bash
npm run make-admin -- ornek@mail.com            # mevcut kullanıcıyı yönetici yap
npm run make-admin -- ornek@mail.com --revoke   # yöneticiliği geri al
```

Rol yükseltme bilinçli olarak panelde değil bu script'te: adminlik verme yetkisi de tarayıcıda olsaydı, ele geçirilen tek bir admin oturumu kalıcı arka kapı açabilirdi. Panel oturumu sekme kapanınca düşer.

### E-posta ve hukuk sayfaları

`/verify-email/:token`, `/reset-password/:token`, `/legal`, `/legal/:doc` — dış kaynaksız, açık/koyu tema ve TR/EN destekli HTML sayfalar. Ayrıntı aşağıda.

## Mimari

```
app.js                     # Express app + route mount'ları (DB/cron/listen içermez — testler bunu kullanır)
server.js                  # app + DB bağlantısı + cron'lar + listen + graceful shutdown
.env                       # ortam değişkenleri (gitignore'da; şablonu .env.example)
admin/                     # admin paneli — /admin altında HER ortamda servis edilir, derleme adımı yok.
                           # JS ayrı dosyada (production CSP inline script'i engeller); theme.js <head>'de
                           # ayrı yüklenir ki tema gövde çizilmeden uygulansın
public/                    # mobil simülatör — dev'de kökten, canlıda SIMULATOR_ENABLED ile /sim altında
assets/                    # marka varlıkları (logo) — her ortamda /assets altında servis edilir
scripts/                   # tek seferlik bakım script'leri (make-admin)
config/                    # db, firebase, resend, consents, legal/ (hukuki metinlerin kanonik kaynağı),
                           # storage/ (görsel depolama adaptörü — sürücü STORAGE_DRIVER ile seçilir)
middlewares/               # auth (protect, isEmailVerified, isAdmin), rateLimiter, errorHandler, upload (multer)
models/                    # Mongoose şemaları
modules/<özellik>/         # her özellik: routes → controller → service üçlüsü
utils/                     # jwt, catchAsync, AppError, sendEmail, notification (FCM), date.util, event.util,
                           # i18n (TR/EN), webPage (HTML sayfa kabuğu), emailTemplate, password.util
seeds/                     # seed-veri-seti.js, furigana-merge.js, export-vocab.js, PLAN.md
tests/                     # API sözleşme testleri (npm test)
```

- Her istek `routes` → `controller` (`catchAsync` sarmalı) → `service` katmanından geçer; iş mantığı yalnızca service'lerde yaşar.
- Standart yanıt zarfı: `{ success: true, data }` veya `{ success: false, message }`.
- Hatalar `AppError(message, statusCode)` ile fırlatılır, `errorHandler` tek noktadan JSON'a çevirir (Mongoose validasyon, duplicate key ve JWT hataları dahil).
- `protect` + `isEmailVerified` **mount seviyesinde** uygulanır (`app.js`), rota bazında değil — yeni bir rota korumayı unutamaz.

## Temel Akışlar

### Kimlik doğrulama ve cihaz oturumları

1. **Kayıt** → `POST /api/auth/register` — kullanıcı oluşturulur, N5 kilidi açık `Progress` kayıtları ve `Streak` başlatılır, doğrulama e-postası gönderilir. E-posta gönderilemezse kayıt geri alınır.
2. **E-posta doğrulama** → `GET /api/auth/verify-email/:token` — çoğu endpoint doğrulanmamış hesaba kapalıdır.
3. **Giriş** → `POST /api/auth/login` — `accessToken` (15 dk) + `refreshToken` (30 gün) çifti döner.
4. **Token tazeleme** → `POST /api/auth/refresh`.

Refresh token'lar **cihaz başına oturum** olarak saklanır (`DeviceSession`, SHA-256 hash'li):

- Aynı hesap en fazla **5 cihazda** aynı anda oturum açık tutabilir (en eski oturum düşer).
- `logout` gövdesinde `refreshToken` verilirse yalnızca o cihaz, verilmezse **tüm cihazlar** çıkış yapar.
- **Şifre değişikliği/sıfırlama tüm oturumları kapatır** ve işlemi yapan cihaza taze token çifti döner.
- E-posta adresi değiştirilirse doğrulama sıfırlanır ve yeni adrese mail gider; gönderilemezse adres değişmez.

### Günlük öğrenme döngüsü (SRS)

1. Client güne `GET /api/userwords/today` ile başlar. **Seviye parametresi yoktur:** dersin seviyesi kullanıcının Ayarlar'dan seçtiği `activeLevel`'dır ve tek kaynağı sunucudur (`PUT /api/progress/active-level`). İlk çağrıda o güne özel **donuk bir havuz** (`DailyWordPool`) oluşturulur: `dailyGoal` kadar kelime (varsayılan 20), **tekrarlar öncelikli** (en fazla %70), kalan kontenjan yeni kelimelerle dolar. Gün içinde tekrar çağrılırsa aynı liste döner; `dailyGoal` değişikliği ertesi gün etkili olur.
2. Her cevap `POST /api/userwords/answer` ile gönderilir — şıklı/kart akışında `result` (`correct` / `empty` / `wrong`), yazma sorusunda `answer` (metni **sunucu** puanlar). Tek çağrıda zincirleme şunlar olur:
   - **SM-2** çalışır (`easeFactor`, `interval`, `repetitions`, `nextReviewDate`; kalite eşlemesi correct→4, empty→2, wrong→1).
   - **masteryLevel (1–5)** SM-2 durumundan türetilir: `repetitions=0 → 1`, ilk başarılı tekrar → 2, `interval≥6 → 3`, `≥10 → 4`, `≥21 → 5`. Yanlış cevap repetitions'ı sıfırladığı için seviye 1'e düşer; düşüşte yanıtta `levelDropped: true` + `word_level_down` bildirimi oluşur.
   - **Streak** güncellenir (günün ilk cevabı yeterli).
   - **Seviye kilidi** kontrol edilir.
   - Açık **StudySession** varsa sayaçları artar.
3. Bugün yanlış yapılan kelimeler `GET /api/userwords/mistakes` ile listelenir (ana ekrandaki "Bugünün Hataları").

Tüm "bugün" hesapları (havuz, streak, hatalar, oturumlar) **kullanıcının kendi saat dilimine** göre yapılır (`User.timezone`, varsayılan `Europe/Istanbul`).

**Tekrar önceliği:** Vadesi geçmiş kelime sayısı günlük kontenjanı aşarsa, en eski vadeli ve eşitlikte **en düşük seviyeli** (en kırılgan) kelimeler önce gelir; sağlam hafızalı kelimeler bir sonraki güne bekleyebilir.

### Seviye çürümesi (mastery decay)

Uzun süre tekrar edilmeyen kelimelerin **görünen** seviyesi kademeli düşer — ama SM-2 verisi (interval/easeFactor/repetitions) asla değişmez:

- Kelime, vadesini **kendi aralığının 2 katı** kadar aşınca 1 seviye, sonraki her aralık katında 1 seviye daha düşer (taban 1). Seviye 5 bir kelime (aralık 21+ gün) ~6 hafta dokunulmazken seviye 2 bir kelime birkaç günde düşer — taze hafıza hızlı, oturmuş hafıza yavaş unutulur.
- Kullanıcı dönüp kelimeyi **doğru cevapladığı an** seviye SM-2 durumundan yeniden hesaplanır ve anında geri zıplar; ceza değil, dürüst bir tahmindir.
- **Açılmış seviye kilitleri asla geri kapanmaz.**
- Bildirim: düşüşler tek özette demetlenir ("Kelimeler tazelenmek istiyor 🌱"), günde en fazla 1, iki özet arası en az 3 gün ve son çalışmadan beri en fazla 3 dokunuş — sonra susar. `wordLevelDown` tercihi kapalıysa hiç gitmez.

### Kelime havuzu ve seviye ilerlemesi

Seed **5816 kelimelik omurga müfredatı** yazar (N5→N1, hepsi `isCore: true`): ders kitabı kökenli, `meaningTr` / örnek cümle / eş anlamlı kabul edilen cevap dizileriyle zenginleştirilmiş veri. Kütüphane, günlük havuz, quiz ve ilerleme yüzdesi çekirdek set üzerinden çalışır; `GET /api/words?includeAll=true` filtreyi tamamen kaldırır (çekirdek dışı kelime sonradan eklenirse diye).

Bir sonraki JLPT seviyesinin kilidi **iki yoldan** açılır:

- **Çalışma:** seviyenin kelimelerinin **%75'i** `masteryLevel ≥ 3`'e ulaşınca otomatik açılır (her cevapta kontrol edilir).
- **Seviye tespit sınavı:** sınavın belirlediği seviyeye **kadar olan tüm seviyeler** tek seferde açılır.

`GET /api/progress` seviye listesini, `GET /api/progress/:jlptLevel/distribution` o seviyedeki kelimelerin 1–5 ustalık dağılımını döner.

**Hafıza sekmesi** aynı dağılımın etiketlenmiş hâlidir: Yeni (hiç dokunulmamış) · Zayıf (1–2) · Orta (3) · İyi (4) · Ezber (5). Son üç kutu tam olarak kilidi açan kümedir (`masteryLevel ≥ 3`), yani beş kutunun toplamı seviyenin kelime sayısına, sayılan üçünün oranı `completionRate`'e eşittir — eşik tek yerde tanımlıdır (`ProgressService.MASTERY_COUNTED_MIN`).

"Bu hafta +N kelime iyiye geçti" çipi `UserWord.promotedAt` üzerinden sayılır: kelimenin sayılan bölgeye **girdiği** an. Bölge içi yükselişler (3→4→5) tekrar saymaz, bölgeden düşünce iz silinir. Veri geriye dönük üretilemediği için `MEMORY_TRACKING_SINCE` öncesi haftalarda alan `null` döner ve çip çizilmez.

### Seviye Tespit Sınavı

Tek oturumluk **40 soruluk** bir sınav. Geçme/kalma yoktur — çıktısı bir yargı değil, bir seviyedir.

| | |
|---|---|
| Soru dağılımı | N5: 6 · N4: 6 · N3: 8 · N2: 10 · **N1: 10** — üst seviyeleri ayırt etmek daha çok kanıt ister |
| Seviye eşiği | Bir seviyenin sorularının **%60**'ını doğru yapan kullanıcı o seviyededir |
| Süre | Soru başına 20 sn (sayacı **istemci** tutar) · sınavın tamamı 30 dk içinde bitmeli |
| Tekrar | **Sabit 14 gün** cooldown |

- `POST /api/quiz/start` sınavı açar, sorular **her denemede** taze üretilir.
- Sorular **tek tek** `POST /api/quiz/:id/answer` ile cevaplanır; yanıt anında geri bildirim döner (doğru/yanlış + kelimenin anlamı), son soruda `finished: true` ve sonuç birlikte gelir.
- `POST /api/quiz/:id/abandon` — yarım deneme geçersiz sayılır, sonraki girişte baştan başlanır.
- `POST /api/quiz/placement/defer` — anasayfa modalındaki "Daha Sonra"; modal bir daha çıkmaz.
- `GET /api/quiz/status` sınav önü ekranının tamamını döner (uygunluk, cooldown, dağılım, yarım kalmış sınav id'si).

Cooldown bilinçli olarak **sabittir**: artan bekleme (3/7/14) "başarısızlık" kavramı olan sınavlara aittir, burada öyle bir şey yok. Tekrar girmenin ödülü de tek seferliktir — açılan kilit bir daha kapanmaz.

**Soru formatları** (kelimenin verisine göre seçilir): anlam · ters anlam · okunuş (kana-only kelimede üretilmez) · yazma (`typing`, sunucu puanlar) · boşluk doldurma (örnek cümlesi olan kelimede) · görselli (`imageUrl` olan kelimede). **Cevap anahtarı hiçbir zaman client'a gönderilmez** — skorlama sunucudadır; anahtar yalnızca soru cevaplandıktan sonra geri bildirimde döner.

### Streak (günlük seri)

- Günün ilk cevabıyla seri +1 (dün de çalışıldıysa) veya 1'e döner (ara verildiyse).
- Saatlik cron, **her kullanıcının kendi saat diliminde** günü kaçıranların serisini sıfırlar.
- `GET /api/home/summary` ana ekran verisini, `/home/calendar` son 30 günün aktivitesini, `/home/day/:date` tek günün detayını döner.

### Bildirimler (uygulama içi + push)

**Push akışı (FCM):** Mobil uygulama, Firebase SDK'sından aldığı cihaz token'ını `PUT /api/auth/update-info` ile `fcmToken` olarak kaydeder. Backend bir bildirim oluşturduğunda aynı içerik hem DB'ye (uygulama içi liste) yazılır hem de FCM üzerinden push gönderilir. Gönderim arkaplandadır (istek gecikmesine eklenmez); FCM "token artık kayıtlı değil" derse token otomatik temizlenir. Push `data` alanında tip ve ilgili id'ler string olarak gider.

| Tip | Ne zaman oluşur |
|---|---|
| `daily_task` | Kullanıcının seçtiği hatırlatma saatinde ve ayrıca günlük havuz ilk oluşturulduğunda |
| `daily_word` | Hatırlatma saatinde, günün kelimesi (`data.wordId` ile detaya gidilir) |
| `streak_reminder` | Serisi **olup** o gün çalışmamış kullanıcıya, yerel saat 19:00'da |
| `streak_warning` | Aynı koşulla, yerel saat 23:00'te son uyarı |
| `word_level_down` | Yanlış cevapla seviye düşünce (anlık) veya decay özeti olarak (günde ≤1, `data.source: "decay"`) |

Hatırlatma saati kullanıcının **kendi saat diliminde** yorumlanır. Cron çeyrek saatte bir çalışır; hatırlatma seçilen saatten sonraki 2 saat içinde bir kez gönderilir (cron kaçarsa sonraki tur yakalar, gece yarısına sarkmaz). Üretim `notificationSettings` tercihlerine saygı gösterir ve aynı gün aynı tipten mükerrer bildirim oluşturmaz. `daily_word` ile `daily_task` bilerek ayrı bayraklardadır.

### Hikâyeler (anasayfa üstü bilgi kutucukları)

Adminlerin `/admin` panelinden yayımladığı, daire kapak + tam ekran görsel kartlardan oluşan şerit. Kart içerikleri düz görseldir; metin/link yoktur.

- Görseller kayıtta **key** olarak durur (`stories/<hash>.webp`), URL değil — depolama sağlayıcısı değişirse kayıtlara dokunmak gerekmez.
- Aynı görsel iki hikâyede aynı key'e düşer (dosya adı içerik hash'i). Bu yüzden hikâye silinirken görsel körlemesine silinmez; başka kullanan varsa dosya kalır.
- `seen` ayrı bir koleksiyonda (`StoryView`) tutulur; `viewedAt < contentUpdatedAt` olduğunda halka o kullanıcıda yeniden yanar. `updatedAt` **kullanılamaz**: onu sıralama, yayından kaldırma ve başlık düzeltmesi de ilerletiyor, yani kartları sürüklemek herkesin halkasını yakıyordu. `Story.viewedBy: []` dizisi de bilinçli kullanılmadı — kullanıcı sayısıyla sınırsız büyür ve 16 MB doküman sınırına dayanır.
- Açılma (`/:id/opened`) ve tamamlanma (`/:id/seen`) **ayrı** kaydedilir: yarıda bırakan kullanıcının halkası yanık kalır.
- Süresi dolan hikâye gizlenir, **silinmez** (TTL indeksi yok): admin tarihi uzatıp yeniden yayına alabilir.
- Sıralama iki kademeli: `{ isPinned: -1, order: 1 }`. `order` global değil, **kendi grubu içinde** geçerli. Sabitleme ve sıralama tek uçtan (`PUT /stories/order`) ve tek `bulkWrite` ile yazılır — ayrı bir "pinle" ucu yok, çünkü bir hikâyeyi gruplar arasında taşımak iki isteğe bölünseydi arada tutarsız bir an olurdu.

## API Referansı

Tüm yollar `/api` önekiyle başlar. 🔒 = access token gerekli, ✉️ = ayrıca doğrulanmış e-posta gerekli.
`GET /health` (öneksiz, auth'suz) deploy platformlarının canlılık kontrolü için `{ "status": "ok" }` döner.

### Auth — `/auth`
| Metot | Yol | Açıklama |
|---|---|---|
| POST | `/check-email` | Onboarding e-posta adımı: biçim + müsaitlik |
| POST | `/register` | Kayıt — onboarding tercihlerini de alır** |
| POST | `/login` | Giriş, token çifti döner |
| POST | `/social` | Google/Apple ile giriş; hesap yoksa oluşturur |
| POST | `/refresh` | Yeni access token |
| POST | `/logout` | Tek cihaz (`refreshToken` gövdede) veya tümü |
| GET | `/me` 🔒✉️ | Mevcut kullanıcı |
| GET | `/verification-status` 🔒 | Doğrulanmamış hesabın bekleme ekranı için |
| GET | `/consents` | Yürürlükteki metin sürümleri; oturumluysa yeniden rıza durumu |
| PUT | `/consents` 🔒 | Sürüm değişimi sonrası yeniden rıza (KVKK) |
| PUT | `/update-info` 🔒✉️ | Ad, e-posta*, dailyGoal, fcmToken, timezone, bildirim/uygulama tercihleri |
| DELETE | `/fcm-token` 🔒 | Push token'ını sil (çıkışta) |
| POST | `/verify-password` 🔒✉️ | Şifre değişiminin ilk adımı |
| PUT | `/change-password` 🔒✉️ | Şifre değişimi — diğer oturumlar kapanır, taze çift döner |
| POST | `/forgot-password` | Sıfırlama maili |
| POST | `/reset-password` | Token ile yeni şifre, taze çift döner |
| GET | `/verify-email/:token` | E-posta doğrulama, taze çift döner |
| POST | `/verify-email` | Aynısı; `deviceName` yoksa oturum açmaz (web landing) |
| POST | `/resend-verification-email` | Doğrulama mailini tekrar gönder |
| DELETE | `/delete-account` 🔒✉️ | Hesap + **tüm ilişkili veri** silinir (KVKK) |

<sub>Kimlik uçlarının tamamı sıkı rate limit altındadır (20 istek/15 dk).</sub>
<sub>\* E-posta değişiminde doğrulama sıfırlanır ve yeni adrese mail gider.</sub>
<sub>\*\* `dailyGoal`, `reminderTime`, `dailyReminder`, `timezone`, `consents` — hepsi opsiyonel.</sub>

Şifre `update-info`'dan **değiştirilemez** (`400`): tek kapı `change-password` (eski şifre doğrulamalı) ve `reset-password` (mail token'lı); ikisi de oturum rotasyonu yapar.

### Kelimeler — `/words`
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/` 🔒✉️ | Liste: `?jlptLevel=&type=&q=&page=&limit=&includeAll=` |
| GET | `/search?q=` 🔒✉️ | `kanji`, `kana`, `romaji`, `meaning`, `meaningTr` üzerinde arama |
| GET | `/:id` 🔒✉️ | Tek kelime |

<sub>Kelime CRUD uçları kapalıdır: içerik seed'den gelir, elle düzenlenmez.</sub>

Arama girdisi regex-escape'lenir (ReDoS/injection) ve sonuçlar **alaka puanına** göre sıralanır: tam eşleşme → baştan eşleşme → içerme. Salt "içeriyor" araması sonucu kullanılmaz yapıyordu — "eki" yazan kullanıcı 257 sonuç arasında 駅'i ilk sayfada göremiyordu.

### Günlük çalışma — `/userwords`
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/today` 🔒✉️ | Günün havuzu — seviye `activeLevel`'dan gelir, parametre almaz |
| POST | `/answer` 🔒✉️ | `{ wordId, result }` veya `{ wordId, answer }` → SM-2 + masteryLevel + streak + kilit |
| GET | `/stats` 🔒✉️ | Toplam/öğrenilen/öğreniliyor + `byMasteryLevel` dağılımı |
| GET | `/mistakes` 🔒✉️ | Bugünün yanlışları (sayfalı) |
| GET | `/list` 🔒✉️ | Kullanıcının kelimeleri: `?jlptLevel=&masteryLevel=&page=&limit=` |

### İlerleme ve hafıza — `/progress`, `/memory`
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/progress` 🔒✉️ | Seviye listesi: kilit durumu, %, kelime sayısı |
| GET | `/progress/:jlptLevel/distribution` 🔒✉️ | 1–5 ustalık dağılımı + `notStarted` |
| PUT | `/progress/active-level` 🔒✉️ | Günlük dersin çekildiği seviyeyi değiştir (açık seviyeler arası) |
| GET | `/memory` 🔒✉️ | Seviye kartı + beş kutu + "bu hafta iyiye geçen" sayısı |
| GET | `/memory/words?box=weak` 🔒✉️ | Seçili kutunun kelime listesi (sayfalı) |

### Seviye tespit sınavı — `/quiz`
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/status` 🔒✉️ | Sınav önü ekranı: uygunluk, cooldown, soru dağılımı, yarım sınav |
| POST | `/start` 🔒✉️ | Sınavı aç (40 soru üretilir) |
| POST | `/:id/answer` 🔒✉️ | `{ index, answer }` → anlık geri bildirim; son soruda sonuç |
| POST | `/:id/abandon` 🔒✉️ | Sınavı geçersiz kıl |
| POST | `/placement/defer` 🔒✉️ | "Daha Sonra" — anasayfa modalı bir daha çıkmaz |

### Oturumlar, seri, ana ekran
| Metot | Yol | Açıklama |
|---|---|---|
| POST/PUT | `/sessions/start`, `/update`, `/complete` 🔒✉️ | Günün çalışma oturumu |
| GET | `/sessions/today`, `/sessions/history` 🔒✉️ | Bugün / son 30 oturum |
| GET | `/streak` 🔒✉️ · PUT `/streak/update` | Seri bilgisi |
| GET | `/home/summary`, `/home/calendar`, `/home/day/:date` 🔒✉️ | Ana ekran verileri |
| GET/PUT | `/notifications`, `/notifications/:id/read`, `/notifications/read-all` 🔒✉️ | Bildirimler (sayfalı, `unreadCount` ile) |

### Hikâyeler ve görseller
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/stories` 🔒✉️ | Anasayfa şeridi (`seen` bilgisiyle) |
| POST | `/stories/:id/opened`, `/stories/:id/seen` 🔒✉️ | Açıldı / tamamlandı |
| GET/POST/PUT/DELETE | `/stories/admin`, `/stories`, `/stories/order` 🔒✉️ (admin) | Hikâye yönetimi |
| POST/DELETE | `/uploads` 🔒✉️ (admin) | Görsel yükleme/silme (`multipart/form-data`, alan `image`) |
| GET | `/uploads/:key` | Yüklenen görselin kendisi (auth istemez) |

### Hukuki metinler — `/legal`
Kullanıcı Sözleşmesi, Gizlilik Politikası ve KVKK Aydınlatma & Açık Rıza Metni **backend'den servis edilir** (uygulamaya gömülü değil): hukuki bir düzeltme mağaza onayı beklemeden yayına girer.

| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/legal`, `/legal/:doc` | Tarayıcı sayfası (`terms`, `privacy`, `kvkk`) |
| GET | `/api/legal`, `/api/legal/:doc` | JSON — başlık, sürüm, yürürlük tarihi + `sections[]` |

Hepsi oturumsuz çalışır. Kanonik kaynak `config/legal/texts.js`; rıza sürümleri (`config/consents.js`) oradan **türetilir**, elle yazılmaz. Mağaza kayıtlarının istediği gizlilik politikası URL'si `/legal/privacy` (bu sayfalar `index`, token taşıyan landing sayfaları `noindex`).

### E-posta linklerinin indiği web sayfaları
`GET /verify-email/:token` ve `GET /reset-password/:token` (API dışında, HTML). Yan etkisizdirler — mail tarayıcılarının prefetch'i doğrulama yapmaz; işlem kullanıcının sayfada tetiklediği POST ile biter.

Uygulama kuruluysa aynı linkler **uygulamada** açılır (`/.well-known/apple-app-site-association` ve `assetlinks.json`). Custom scheme (`musubi://`) bilerek yoktur: aynı şemayı kaydeden başka bir uygulama linki kapıp token'ı çalabilir. Web her koşulda tek kaynaktır, deep link yalnızca hızlandırıcıdır.

### Analitik (event log)

Kritik eylemler `events` koleksiyonuna yazılır (fire-and-forget — ana akışı asla yavaşlatmaz): `register`, `login`, `daily_pool_created`, `answer_submitted`, `quiz_started`, `quiz_completed`, `session_completed`, `story_opened`, `story_completed`.

Hikâye olayları `data` alanına `storyId` ile birlikte **`title`** de yazar: hikâye silindikten sonra da ham event'ler okunabilir kalsın diye. Açılma/tamamlanma oranı `GET /api/stories/admin` üzerinden hesaplanıp panelde kartın üstünde gösterilir — elle Mongo sorgusu gerektiren bir analitik, birkaç hafta sonra kimsenin bakmadığı bir şeye dönüşür.

<details>
<summary>Örnek: son 7 günün günlük aktif kullanıcısı</summary>

```js
db.events.aggregate([
  { $match: { createdAt: { $gte: new Date(Date.now() - 7*86400000) } } },
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, u: { $addToSet: '$user' } } },
  { $project: { dau: { $size: '$u' } } }, { $sort: { _id: 1 } }
])
```

</details>

Hesap silindiğinde kullanıcının event'leri de silinir (KVKK).

## Testler

```bash
npm test
```

`node --test` + in-memory MongoDB: gerçek veritabanına dokunmaz, internet gerektirmez (ilk çalıştırmada mongod binary'si indirilip cache'lenir). Kapsam: auth sözleşmesi (login/refresh/oturum rotasyonu), e-posta akışları (register→doğrulama, rollback, şifre sıfırlama, adres değişikliği), SRS döngüsü, ders akışı ve session güvenilirliği, seviye tespit sınavı, hafıza kutuları, kütüphane, hikâyeler, görsel yükleme güvenliği, mastery decay ve KVKK cascade silme.

> [!IMPORTANT]
> Backend'de davranış değiştiren her değişiklikten sonra `npm test` çalıştırılmalı — mobil entegrasyonun dayandığı API sözleşmesinin bozulmadığını bu süit garanti eder. Aynı süit GitHub Actions'ta her push/PR'da otomatik koşar.

Test ortamında `sendEmail` gerçek gönderim yapmaz; mailler bellek içi bir outbox'a yazılır ve testler maildeki linkleri oradan okuyup uçtan uca doğrular. Rate limit'ler de test ortamında devre dışıdır.

## Zamanlanmış İşler

| Zamanlama | İş |
|---|---|
| Her saat `:05` | Kendi saat diliminde günü kaçıranların serisini sıfırla |
| Her 15 dk | Hatırlatma saati gelen kullanıcılara günlük bildirim; yerel saati 19:00/23:00 olanlara seri hatırlatması/uyarısı |
| Her gün 03:00 | Mastery decay + özet bildirim |
| Her gün 03:30 | 7 gündür doğrulanmamış hesapları yan kayıtlarıyla sil (DB çöpü + e-posta squat temizliği) |

> [!NOTE]
> Cron'lar süreç içinde çalışır. Serverless platformlar (ör. Vercel) uzun ömürlü süreç barındırmadığı için bu backend Railway/Render/Fly.io gibi kalıcı Node host'larında çalıştırılmalıdır.

## Güvenlik Önlemleri

**Taşıma ve erişim**
- `helmet` + production'da origin bazlı CORS (`CORS_ORIGIN`) ve `trust proxy` (rate limit'in proxy arkasında gerçek client IP'sini görmesi için)
- Rate limit: genel 300 istek/15 dk, kimlik uçlarında 20/15 dk, görsel yüklemede 60/15 dk; liste uçlarında `limit` en fazla 100
- Feature modüllerinde `protect + isEmailVerified` **mount seviyesinde** (`app.js`) — yeni bir rota korumayı unutamaz
- JSON body 100 KB limiti, arama girdisinde regex escape (ReDoS koruması)

**Kimlik ve oturum**
- bcrypt (cost 10); şifre kuralları (8+ karakter, büyük harf, rakam, özel karakter) hem servis katmanında hem `User` şemasında, tek kaynaktan (`utils/password.util.js`)
- Refresh token'lar DB'de SHA-256 hash'li; cihaz başına oturum, tek tek iptal edilebilir. Kaydın TTL'i token'ın kendi `exp` claim'inden türer
- Şifre değişimi/sıfırlamada tüm oturumlar düşer
- Doğrulama/sıfırlama token'ları DB'de hash'li ve **API yanıtında hiçbir ortamda dönmez** (yalnızca e-postadaki linkte)
- Hesap bazlı giriş kilidi: 5/10/15 hatalı denemede 1/5/15 dk kademeli. IP limitinin kapatamadığı "çok IP'den tek hesabı deneme" senaryosuna karşı; kilit DoS aracına dönüşmesin diye süreler kısa, başarılı giriş ve şifre sıfırlama kilidi kaldırır
- E-posta enumeration: **bilinçli olarak dürüst cevap** (`check-email` zaten hesap varlığını söylüyor). Karşılığında adres bazlı mail kısıtı — 60 sn cooldown + günde 5 mail, sayaç hesapta tutulduğu için IP değiştirerek aşılamaz

**İçerik ve yönetim**
- Admin paneli (`/admin`) korumasız bir statik sayfadır; koruma çağırdığı uçlardadır. Panel oturumu `sessionStorage`'da (sekme kapanınca düşer), rol yükseltme panelde değil `npm run make-admin` script'inde. Sayfa `noindex` döner ve inline script içermez (production CSP `script-src 'self'`)
- Simülatör (`/sim`) varsayılan olarak **kapalı**; açıkken sayfa parolasızdır ama veriye erişim yine `/api` auth'undan geçer. Simülatör trafiği kendi rate limit kovasında sayılır — testin harcadığı bütçe, aynı IP'nin arkasındaki gerçek kullanıcıyı 429'a düşürmez
- Görsel yükleme: yalnızca admin, 20 MB girdi sınırı, dosya türü **sihirli baytla** belirlenir (istemcinin `Content-Type`'ına güvenilmez), SVG reddedilir (gömülü script → saklı XSS), her dosya sharp ile yeniden kodlanır (EXIF/GPS temizlenir, dekompresyon bombasına karşı 50 MP girdi sınırı), dosya adı içerik hash'i (kullanıcı girdisi dosya yoluna karışmaz)
- Sınav cevap anahtarı sunucuda kalır, sorular her denemede yeniden üretilir

**KVKK**
- Açık rıza kaydı hesap açılışında yazılır (sürüm + zaman + IP), sürüm değişince yeniden rıza istenir
- Hesap silmede tüm koleksiyonlardan cascade temizlik

## Veri Kaynakları ve Atıflar

- **Omurga müfredat (`veri-seti/`):** ders kitabı kökenli, `meaningTr` / örnek cümle / furigana ile zenginleştirilmiş 5816 kelimelik derleme.
- **JLPT kelime listeleri (geçmiş sürümlerde):** [elzup/jlpt-word-list](https://github.com/elzup/jlpt-word-list) — temeli [Jonathan Waller (tanos.co.uk/jlpt)](http://www.tanos.co.uk/jlpt/) listeleri, **CC BY** lisanslı. Resmî bir JLPT kelime listesi yoktur; bunlar topluluk derlemesidir.
- **Frekans sıralaması:** [hingston/japanese](https://github.com/hingston/japanese) — Wikipedia korpusundan türetilmiş ~44k kelimelik liste.
- **Kana→romaji dönüşümü:** [wanakana](https://github.com/WaniKani/WanaKana).

## Yol Haritası

- [ ] XP/puan sistemi (event log üzerine kurulacak)
- [ ] Profil fotoğrafı yükleme (`/uploads` altyapısı hazır; `User.profile_image` hâlâ placeholder)
- [ ] Refresh token rotation + reuse detection (bkz. mağaza öncesi notları)
- [ ] Görseller için CDN'li depolama sürücüsü (`STORAGE_DRIVER` adaptörü hazır; şu an `local` + Railway Volume)
- [ ] Reklam kaldırma / abonelik (IAP makbuz doğrulama)
- [ ] v2: takipleşme ve sosyal özellikler; sonrası: multiplayer kelime savaşları (websocket, kalıcı sunucu gerektirir)

## Lisans

Kod: Tüm hakları saklıdır (All Rights Reserved); yalnızca inceleme amacıyla yayınlanmıştır, izinsiz kullanılamaz. Bkz. [LICENSE](LICENSE). Kelime verisi CC BY — yukarıdaki atıflar korunmalıdır.
