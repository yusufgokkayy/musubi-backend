# Musubi API

Musubi, Türkçe konuşanlar için JLPT (N5–N1) temelli Japonca kelime öğrenme uygulamasının backend servisidir. SM-2 aralıklı tekrar algoritması, kelime başına 1–5 ustalık seviyesi, seviye belirleme/atlama sınavları, günlük seri (streak) takibi ve uygulama içi bildirimler sunar.

## Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Runtime | Node.js + Express 5 |
| Veritabanı | MongoDB (Mongoose ODM) |
| Kimlik doğrulama | JWT (access + refresh), cihaz bazlı oturumlar |
| E-posta | Resend |
| Push bildirimleri | Firebase Admin (FCM) |
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

# Kelime verisi ayrı bir repodan gelir (gitignore'da, elle klonlanmalı):
git clone https://github.com/elzup/jlpt-word-list.git
```

### 3. Ortam değişkenleri

Kök dizindeki örnek dosyayı kopyalayıp doldurun:

```bash
cp .env.example .env
```

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb+srv://...

JWT_SECRET=<rastgele-uzun-string>
JWT_EXPIRE=15m
JWT_REFRESH_SECRET=<farklı-rastgele-uzun-string>
JWT_REFRESH_EXPIRE=7d
RESET_PASSWORD_EXPIRE=3600000

CLIENT_URL=http://localhost:5000
RESEND_API_KEY=re_...
EMAIL_FROM=Musubi <noreply@ornek.com>

# Sosyal giriş (POST /auth/social) — idToken'ın aud claim'i bu listeyle eşleşmeli
# Google: iOS/Android/Web client ID'leri virgülle ayrılır
GOOGLE_CLIENT_IDS=xxxx.apps.googleusercontent.com
# Apple: uygulamanın bundle ID'si (Sign in with Apple)
APPLE_CLIENT_IDS=com.ornek.musubi

# Günlük havuz fallback limitleri (kullanıcının dailyGoal'u yoksa)
NEW_WORD_DAILY_LIMIT=10
REVIEW_DAILY_LIMIT=10

# Production'da izin verilen origin'ler (virgülle ayrılır)
CORS_ORIGIN=https://app.ornek.com
```

Push bildirimleri için ayrıca `config/firebase-service-account.json` konur (gitignore'da).

### 4. Veriyi hazırlama

```bash
npm run seed          # CSV'lerden ~7900 kelimeyi DB'ye yazar (idempotent, tekrar çalıştırılabilir)
npm run select-core   # Frekans listesine göre 3000 çekirdek kelimeyi işaretler
```

`select-core` ilk çalıştırmada Wikipedia tabanlı frekans listesini indirir ve `seeds/data/` altına cache'ler.

### 5. Çalıştırma

```bash
npm run dev    # nodemon ile geliştirme
npm start      # production
```

## Mimari

```
app.js                     # Express app + route mount'ları (DB/cron/listen içermez — testler bunu kullanır)
server.js                  # app + DB bağlantısı + cron'lar + listen + graceful shutdown
.env                       # ortam değişkenleri (gitignore'da; şablonu .env.example)
config/                    # db, firebase, resend
middlewares/               # auth (protect, isEmailVerified, isAdmin), rateLimiter, errorHandler
models/                    # Mongoose şemaları
modules/<özellik>/         # her özellik: routes → controller → service üçlüsü
utils/                     # jwt, catchAsync, AppError, sendEmail, notification (FCM), date.util, event.util
seeds/                     # seed-csv.js, select-core.js
tests/                     # API sözleşme testleri (npm test)
```

- Her istek `routes` → `controller` (`catchAsync` sarmalı) → `service` katmanından geçer; iş mantığı yalnızca service'lerde yaşar.
- Standart yanıt zarfı: `{ success: true, data }` veya `{ success: false, message }`.
- Hatalar `AppError(message, statusCode)` ile fırlatılır, `errorHandler` middleware'i tek noktadan JSON'a çevirir (Mongoose validasyon, duplicate key ve JWT hataları dahil).
- Korumalı endpoint'ler `protect` (Bearer access token) + çoğunlukla `isEmailVerified` middleware'lerini kullanır.

## Temel Akışlar

### Kimlik doğrulama ve cihaz oturumları

1. **Kayıt** → `POST /api/auth/register` — kullanıcı oluşturulur, N5 kilidi açık `Progress` kayıtları ve `Streak` başlatılır, doğrulama e-postası gönderilir. E-posta gönderilemezse kayıt geri alınır.
2. **E-posta doğrulama** → `GET /api/auth/verify-email/:token` — çoğu endpoint doğrulanmamış hesaba kapalıdır (`isEmailVerified`).
3. **Giriş** → `POST /api/auth/login` — `accessToken` (15 dk) + `refreshToken` (7 gün) çifti döner.
4. **Token tazeleme** → `POST /api/auth/refresh` — refresh token ile yeni access token alınır.

Refresh token'lar **cihaz başına oturum** olarak saklanır (`DeviceSession` modeli, SHA-256 hash'lenmiş):

- Aynı hesap en fazla **5 cihazda** aynı anda oturum açık tutabilir (en eski oturum düşer).
- `logout` gövdesinde `refreshToken` verilirse yalnızca o cihaz, verilmezse **tüm cihazlar** çıkış yapar.
- **Şifre değişikliği/sıfırlama tüm oturumları kapatır** ve işlemi yapan cihaza taze token çifti döner.
- E-posta adresi değiştirilirse doğrulama sıfırlanır ve yeni adrese doğrulama maili gider; mail gönderilemezse adres değişmez.

### Günlük öğrenme döngüsü (SRS)

1. Client güne `GET /api/userwords/today?jlptLevel=N5` ile başlar. İlk çağrıda o güne özel **donuk bir havuz** (`DailyWordPool`) oluşturulur: kullanıcının `dailyGoal`'u kadar kelime (varsayılan 20), **tekrarlar öncelikli** (en fazla %70), kalan kontenjan çekirdek havuzdan rastgele yeni kelimelerle dolar. Gün içinde tekrar çağrılırsa aynı liste döner; `dailyGoal` değişikliği ertesi gün etkili olur.
2. Her cevap `POST /api/userwords/answer` ile gönderilir: `{ wordId, result: "correct" | "empty" | "wrong" }`. Tek çağrıda zincirleme şunlar olur:
   - **SM-2** çalışır (`easeFactor`, `interval`, `repetitions`, `nextReviewDate` güncellenir; kalite eşlemesi: correct→4, empty→2, wrong→1).
   - **masteryLevel (1–5)** SM-2 durumundan türetilir: `repetitions=0 → 1`, ilk başarılı tekrar → 2, `interval≥6 → 3`, `≥10 → 4`, `≥21 → 5`. Yanlış cevap repetitions'ı sıfırladığı için seviye otomatik 1'e düşer; düşüşte yanıtta `levelDropped: true` + `word_level_down` bildirimi oluşur.
   - **Streak** güncellenir (günün ilk cevabı yeterli).
   - **Seviye kilidi** kontrol edilir (aşağıda).
   - Açık **StudySession** varsa sayaçları artar (session `POST /api/sessions/start` ile açılır, `PUT /api/sessions/complete` ile kapanır).
3. Bugün yanlış yapılan kelimeler `GET /api/userwords/mistakes` ile listelenir (ana ekrandaki "Bugünün Hataları").

Tüm "bugün" hesapları (havuz, streak, hatalar, oturumlar) **kullanıcının kendi saat dilimine** göre yapılır (`User.timezone`, varsayılan `Europe/Istanbul`).

**Tekrar önceliği:** Vadesi geçmiş kelime sayısı günlük kontenjanı aşarsa (ör. uzun ara sonrası), en eski vadeli ve eşitlikte **en düşük seviyeli** (en kırılgan) kelimeler önce gelir; sağlam hafızalı kelimeler bir sonraki güne bekleyebilir.

### Seviye çürümesi (mastery decay)

Uzun süre tekrar edilmeyen kelimelerin **görünen** seviyesi kademeli düşer — ama SM-2 verisi (interval/easeFactor/repetitions) asla değişmez:

- Kelime, vadesini **kendi aralığının 2 katı** kadar aşınca 1 seviye, sonraki her aralık katında 1 seviye daha düşer (taban 1). Yani seviye 5 bir kelime (aralık 21+ gün) ~6 hafta dokunulmazken, seviye 2 bir kelime birkaç günde düşer — taze hafıza hızlı, oturmuş hafıza yavaş unutulur.
- Kullanıcı dönüp kelimeyi **doğru cevapladığı an** seviye SM-2 durumundan yeniden hesaplanır ve anında geri zıplar; ceza değil, dürüst bir tahmindir.
- İlerleme yüzdesi bu sayede uzun aradan sonra da gerçeği yansıtır; **açılmış seviye kilitleri asla geri kapanmaz.**
- Bildirim: düşüşler tek özette demetlenir ("Kelimeler tazelenmek istiyor 🌱"), günde en fazla 1, iki özet arası en az 3 gün ve son çalışmadan beri en fazla 3 dokunuş — sonra susar. `wordLevelDown` tercihi kapalıysa hiç gitmez.

### Çekirdek kelime seti ve seviye ilerlemesi

DB'de ~7900 kelime bulunur ama aktif oyun **3000 çekirdek kelime** üzerinde oynanır (`isCore: true`): her seviyenin frekansça en işlek kelimeleri — N5: 300, N4: 400, N3: 550, N2: 750, N1: 1000. Kütüphane, arama, günlük havuz, quiz ve ilerleme yüzdesi yalnızca çekirdek seti kullanır (`GET /api/words?includeAll=true` tam listeye erişir).

Bir sonraki JLPT seviyesinin kilidi **iki kapıdan** açılır:

- **Çalışma kapısı:** seviyenin çekirdek kelimelerinin **%80'i** `masteryLevel ≥ 3`'e ulaşınca otomatik açılır (her cevapta kontrol edilir).
- **Sınav kapısı:** seviye atlama quiz'i geçilirse anında açılır (aşağıda).

`GET /api/progress` seviye listesini, `GET /api/progress/:jlptLevel/distribution` o seviyedeki kelimelerin 1–5 ustalık dağılımını döner (Seviyeler ekranındaki grafik için).

### Quiz sistemi

Sorular **her denemede** çekirdek havuzdan taze rastgele üretilir; üç format vardır: kelime→anlam, anlam→kelime, kanji→okunuş. Çeldiriciler aynı seviye ve öncelikle aynı sözcük türünden seçilir. **Cevap anahtarı hiçbir zaman client'a gönderilmez** — skorlama sunucuda yapılır.

| | Seviye belirleme (placement) | Seviye atlama (levelup) |
|---|---|---|
| Ne zaman | İlk giriş, tek seferlik, isteğe bağlı | Sonraki seviyenin kilidi kapalıyken her zaman |
| Soru sayısı | basamak başına 12 | 35 |
| Geçme eşiği | %70 | %85 |
| Başarısızlıkta | Merdiven biter, ceza yok | Kademeli bekleme: 3 → 7 → 14 gün |

- **Placement merdiveni:** `POST /api/quiz/start {"type":"placement"}` N5 sorularıyla başlar; basamak geçilirse bir üst seviye açılır ve `nextRung` ile merdiven devam eder; kalınırsa biter. İlerlemiş hesaplar (birden fazla seviyesi açık) giremez.
- **Levelup:** `POST /api/quiz/start {"type":"levelup","jlptLevel":"N5"}` — geçilirse sonraki seviye açılır; kalınırsa `nextAttemptAllowedAt` döner ve süre dolmadan yeni deneme 403 alır.
- Her quiz **30 dakika** içinde `POST /api/quiz/:id/submit {"answers":[...]}` ile gönderilmelidir, aksi halde `expired` olur (cooldown yakmaz).
- `GET /api/quiz/status` UI için tüm seviyelerin sınav uygunluğunu ve placement hakkını döner.

### Streak (günlük seri)

- Günün ilk cevabıyla seri +1 (dün de çalışıldıysa) veya 1'e döner (ara verildiyse).
- Saatlik cron, **her kullanıcının kendi saat diliminde** günü kaçıranların serisini sıfırlar.
- `GET /api/home/summary` ana ekran verisini (bugünkü oturum, seri, ilerleme, bekleyen tekrarlar), `GET /api/home/calendar` son 30 günün aktivitesini döner.

### Bildirimler (uygulama içi + push)

`GET /api/notifications` (sayfalı, `unreadCount` ile), `PUT /api/notifications/:id/read`, `PUT /api/notifications/read-all`.

**Push akışı (FCM):** Mobil uygulama, Firebase SDK'sından aldığı cihaz token'ını `PUT /api/auth/update-info` ile `fcmToken` olarak kaydeder. Backend bir bildirim oluşturduğunda aynı içerik hem DB'ye (uygulama içi liste) yazılır hem de kullanıcının `fcmToken`'ına FCM üzerinden push olarak gönderilir. Gönderim arkaplandadır (istek gecikmesine eklenmez); FCM "token artık kayıtlı değil" derse token otomatik temizlenir. `firebase-service-account.json` yoksa (CI, anahtarsız makine) push sessizce devre dışı kalır, uygulama çalışmaya devam eder. Push `data` alanında bildirim tipi ve ilgili id'ler string olarak gider — mobil taraf bununla doğru ekrana yönlendirme (deep link) yapabilir.

| Tip | Ne zaman oluşur |
|---|---|
| `daily_task` | Günlük havuz ilk oluşturulduğunda ("Bugün X kelime seni bekliyor") |
| `word_level_down` | Yanlış cevapla seviye düşünce (anlık) veya decay özeti olarak (günde ≤1, `data.source: "decay"`) |
| `streak_warning` | Serisi olup o gün çalışmamış kullanıcıya, yerel saat 19:00'da |
| `streak_reminder` | Serisi olmayan ve o gün çalışmamış kullanıcıya, yerel saat 19:00'da |
| `daily_word` | *Rezerve — günün kelimesi, henüz üretilmiyor* |

Üretim, kullanıcının `notificationSettings` tercihlerine saygı gösterir ve aynı gün aynı tipten mükerrer bildirim oluşturmaz. **FCM push gönderimi henüz bağlı değildir** (altyapı hazır, sonraki faz).

## API Referansı

> **Mobil geliştirici için:** Her endpoint'in tam istek gövdesi, yanıt örneği ve hata durumları **[API.md](API.md)** dosyasındadır. Aşağıdaki tablolar hızlı özet içindir.

Tüm yollar `/api` önekiyle başlar. 🔒 = access token gerekli, ✉️ = ayrıca doğrulanmış e-posta gerekli. Ayrıca `GET /health` (öneksiz, auth'suz) deploy platformlarının canlılık kontrolü için `{ "status": "ok" }` döner.

### Auth — `/auth`
| Metot | Yol | Açıklama |
|---|---|---|
| POST | `/register` | Kayıt (rate limitli) |
| POST | `/login` | Giriş, token çifti döner (rate limitli) |
| POST | `/refresh` | Yeni access token |
| POST | `/logout` 🔒 | Tek cihaz (`refreshToken` gövdede) veya tümü |
| GET | `/me` 🔒✉️ | Mevcut kullanıcı |
| PUT | `/update-info` 🔒✉️ | Ad, e-posta*, şifre, dailyGoal, fcmToken, bildirim tercihleri |
| PUT | `/change-password` 🔒✉️ | Şifre değişimi — tüm oturumlar kapanır, taze çift döner |
| POST | `/forgot-password` | Sıfırlama maili (enumeration korumalı) |
| POST | `/reset-password` | Token ile yeni şifre, taze çift döner |
| GET | `/verify-email/:token` | E-posta doğrulama, taze çift döner |
| POST | `/resend-verification-email` | Doğrulama mailini tekrar gönder |
| DELETE | `/delete-account` 🔒✉️ | Hesap + **tüm ilişkili veri** silinir (KVKK) |

*E-posta değişiminde doğrulama sıfırlanır ve yeni adrese mail gider.

### Kelimeler — `/words`
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/` 🔒✉️ | Liste: `?jlptLevel=&type=&page=&limit=&includeAll=` |
| GET | `/search?q=` 🔒✉️ | Kanji/romaji/anlam araması (regex-injection korumalı) |
| GET | `/:id` 🔒✉️ | Tek kelime |
| POST/PUT/DELETE | `/`, `/:id` 🔒 (admin) | CRUD |

### Günlük çalışma — `/userwords`
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/today?jlptLevel=` 🔒✉️ | Günün havuzu `{ reviewWords, newWords }` |
| POST | `/answer` 🔒✉️ | `{ wordId, result }` → SM-2 + masteryLevel + streak + kilit |
| GET | `/stats` 🔒✉️ | Toplam/öğrenilen/öğreniliyor + `byMasteryLevel` dağılımı |
| GET | `/mistakes` 🔒✉️ | Bugünün yanlışları (sayfalı) |

### Oturumlar — `/sessions`
| Metot | Yol | Açıklama |
|---|---|---|
| POST | `/start` 🔒✉️ | Günün oturumunu başlat/devral |
| PUT | `/update` 🔒✉️ | Sayaç artır (genelde `answer` içinden otomatik) |
| PUT | `/complete` 🔒✉️ | Oturumu bitir, süre hesapla |
| GET | `/today`, `/history` 🔒✉️ | Bugün / son 30 oturum |

### İlerleme — `/progress`
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/` 🔒✉️ | Seviye listesi: kilit durumu, %, kelime sayısı |
| GET | `/:jlptLevel/distribution` 🔒✉️ | 1–5 ustalık dağılımı + `notStarted` |

### Quiz — `/quiz`
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/status` 🔒✉️ | Placement hakkı + seviye bazlı sınav uygunluğu/cooldown |
| POST | `/start` 🔒✉️ | `{ type: "placement" \| "levelup", jlptLevel? }` |
| POST | `/:id/submit` 🔒✉️ | `{ answers: [şık indeksleri] }` → skor, geçme, açılan seviye |

### Diğer
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/streak` 🔒✉️ | Seri bilgisi |
| GET | `/home/summary`, `/home/calendar` 🔒✉️ | Ana ekran verileri |
| GET/PUT | `/notifications`, `/notifications/:id/read`, `/notifications/read-all` 🔒✉️ | Bildirimler |

### Analitik (event log)

Kritik kullanıcı eylemleri `events` koleksiyonuna yazılır (fire-and-forget — ana akışı asla yavaşlatmaz): `register`, `login`, `daily_pool_created`, `answer_submitted`, `quiz_started`, `quiz_completed`, `session_completed`. D1/D7 retention, günlük aktif kullanıcı ve özellik kullanımı bu koleksiyondan hesaplanır; ileride XP sistemi de aynı log'un üzerine kurulur. Örnek — son 7 günün günlük aktif kullanıcısı:

```js
db.events.aggregate([
  { $match: { createdAt: { $gte: new Date(Date.now() - 7*86400000) } } },
  { $group: { _id: { g: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } }, u: { $addToSet: '$user' } } },
  { $project: { dau: { $size: '$u' } } }, { $sort: { _id: 1 } }
])
```

Hesap silindiğinde kullanıcının event'leri de silinir (KVKK).

## Testler

```bash
npm test
```

`node --test` (Node yerleşik test runner'ı) + in-memory MongoDB kullanır: gerçek veritabanına dokunmaz, internet bağlantısı gerektirmez (ilk çalıştırmada mongod binary'si indirilip cache'lenir). Kapsam: auth sözleşmesi (login/refresh/oturum rotasyonu), e-posta akışları (register→doğrulama, rollback, şifre sıfırlama, adres değişikliği), SRS döngüsü (havuz, masteryLevel, hatalar), quiz (placement merdiveni, cooldown, cevap anahtarı sızıntısı kontrolü), mastery decay ve KVKK cascade silme. **Backend'de davranış değiştiren her değişiklikten sonra `npm test` çalıştırılmalı** — mobil entegrasyonun dayandığı API sözleşmesinin bozulmadığını bu süit garanti eder. Aynı süit GitHub Actions'ta her push/PR'da otomatik koşar (`.github/workflows/test.yml`).

> Not: Test ortamında `sendEmail` gerçek gönderim yapmaz; mailler bellek içi bir outbox'a yazılır ve testler maildeki doğrulama/sıfırlama linklerini oradan okuyup uçtan uca doğrular. Rate limit'ler de test ortamında devre dışıdır.

## Zamanlanmış İşler

| Zamanlama | İş |
|---|---|
| Her saat `:05` | Kendi saat diliminde günü kaçıranların serisini sıfırla |
| Her saat `:10` | Yerel saati 19:00 olan kullanıcılara seri hatırlatması/uyarısı oluştur |
| Her gün 03:00 | Mastery decay: uzun süre tekrar edilmeyen kelimelerin görünen seviyesini düşür + özet bildirim |

> **Not:** Cron'lar süreç içinde çalışır. Serverless platformlar (ör. Vercel) uzun ömürlü süreç barındırmadığı için bu backend Railway/Render/Fly.io gibi kalıcı Node host'larında çalıştırılmalıdır.

## Güvenlik Önlemleri

- `helmet` + production'da origin bazlı CORS (`CORS_ORIGIN`) ve `trust proxy` (rate limit'in proxy arkasında gerçek client IP'sini görmesi için)
- Rate limit: genel 300 istek/15 dk, hassas auth endpoint'lerinde 20/15 dk; liste endpoint'lerinde `limit` en fazla 100
- bcrypt (cost 10), şifre min 8 karakter
- Refresh token'lar DB'de SHA-256 hash'li; cihaz başına oturum, tek tek iptal edilebilir; 8 gün kullanılmayan oturum kayıtları TTL index ile otomatik silinir
- Şifre değişimi/sıfırlamada tüm oturumların düşmesi
- E-posta enumeration koruması (forgot-password ve resend-verification hesap varlığını sızdırmaz), doğrulama/sıfırlama token'ları DB'de hash'li
- Arama girdisinde regex escape (ReDoS koruması), JSON body 100 KB limiti
- Quiz cevap anahtarının sunucuda kalması, sorunun her denemede yeniden üretilmesi
- Hesap silmede tüm koleksiyonlardan cascade temizlik (KVKK)

## Veri Kaynakları ve Atıflar

- **JLPT kelime listeleri:** [elzup/jlpt-word-list](https://github.com/elzup/jlpt-word-list) — temeli [Jonathan Waller (tanos.co.uk/jlpt)](http://www.tanos.co.uk/jlpt/) listeleri, **CC BY** lisanslı. Resmî bir JLPT kelime listesi yoktur; bunlar topluluk derlemesidir.
- **Frekans sıralaması:** [hingston/japanese](https://github.com/hingston/japanese) — Wikipedia korpusundan türetilmiş ~44k kelimelik liste (çekirdek set seçiminde kullanılır).
- Kana→romaji dönüşümü: [wanakana](https://github.com/WaniKani/WanaKana).

## Bilinen Eksikler / Yol Haritası

- [ ] Kelime anlamları şu an **İngilizce** (CSV kaynaklı); MVP iki dilli (EN/TR) çıkacağı için Türkçe çeviri katmanı (`meaningTr`) planlanıyor
- [ ] `daily_word` (günün kelimesi) bildirimi üretimi
- [ ] XP/puan sistemi (tasarımdaki "puanları kaybedersin" akışı için — event log üzerine kurulacak)
- [ ] Profil fotoğrafı yükleme
- [ ] Reklam kaldırma / abonelik (IAP makbuz doğrulama)
- [ ] v2: takipleşme ve sosyal özellikler; sonrası: multiplayer kelime savaşları (websocket, kalıcı sunucu gerektirir)

## Lisans

Kod: bkz. [LICENSE](LICENSE). Kelime verisi CC BY — yukarıdaki atıflar korunmalıdır.
