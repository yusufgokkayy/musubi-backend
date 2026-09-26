// Express uygulaması — DB bağlantısı, cron ve listen İÇERMEZ.
// server.js production'da bunları ekler; test süiti app'i doğrudan kullanır.
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const errorHandler = require('./middlewares/errorHandler');
const { generalLimiter, simulatorApiLimiter } = require('./middlewares/rateLimiter');

dotenv.config({ path: './.env' }); // kök dizindeki .env (örnek için .env.example)

const app = express();

// Railway/Render gibi platformlarda uygulama reverse proxy arkasında çalışır;
// bu ayar olmadan rate limiter tüm istekleri proxy'nin IP'sinden sanır ve
// 300/15dk limiti TÜM kullanıcıların toplamına uygulanır.
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Dev konsolu (public/) yalnızca production DIŞINDA servis edilir; CSP'de ses ve
// görsellere https izni verilir ki konsoldan kelime sesi/görseli test edilebilsin
if (process.env.NODE_ENV !== 'production') {
    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'img-src': ["'self'", 'data:', 'https:'],
                'media-src': ["'self'", 'https:']
            }
        }
    }));
    // no-store: bu dev konsolu sık güncelleniyor; tarayıcı eski app.js'i
    // önbellekten kullanınca (özellikle sekme hiç yenilenmeden kalınca)
    // düzeltilmiş bug'lar hâlâ "var" gibi görünüp yanlış teşhise yol açıyordu
    app.use(express.static('public', { etag: false, lastModified: false, setHeaders: (res) => res.set('Cache-Control', 'no-store') }));
} else {
    app.use(helmet());
}

// Marka varlıkları — HER ortamda servis edilir (public/ yalnızca dev'de açık).
// Hem mail linklerinin indiği web sayfaları hem de e-posta şablonu buradaki
// logoyu kullanır; tek dosya, iki tüketici.
app.use('/assets', express.static('assets', {
    maxAge: '30d',
    immutable: false
}));

// Yüklenen görseller — yalnızca `local` sürücüde bizden servis edilir;
// Cloudinary gibi bir sürücüye geçilirse URL'ler oraya işaret eder ve bu mount
// hiç kurulmaz. Dosya adları içeriğin hash'i olduğu için (bkz. upload.service.js)
// bir URL'nin işaret ettiği bayt dizisi ASLA değişmez: immutable + 1 yıl cache
// güvenli, üstelik hikâyeler her anasayfa açılışında istendiği için gerekli.
const storage = require('./config/storage');
if (storage.servesLocally) {
    app.use('/uploads', express.static(storage.root(), {
        maxAge: '365d',
        immutable: true,
        index: false,
        dotfiles: 'ignore',
        fallthrough: false
    }));
}

// Admin paneli (hikâye yönetimi) — public/ aksine HER ortamda servis edilir,
// çünkü içerik canlıdan girilir. Sayfanın kendisi korumasızdır; koruma
// çağırdığı /api uçlarındadır (panel token'sız açılınca giriş ekranı gösterir).
// helmet'in production CSP'si inline script'i engellediği için panelin JS'i
// ayrı dosyada durur — admin/admin.js'e inline <script> EKLENMEMELİ.
app.use('/admin', express.static('admin', {
    setHeaders: (res) => res.set('X-Robots-Tag', 'noindex')
}));

// Mobil simülatör, canlı ortam için. Yukarıdaki public/ mount'u dev'de KÖKTEN
// ve korumasız servis eder; burası ondan bağımsızdır ve NODE_ENV'e DEĞİL,
// SIMULATOR_ENABLED bayrağına bakar. Böylece:
//   - canlıda test yüzeyi açmak/kapatmak deploy değil, tek değişken işidir,
//   - "test için NODE_ENV=production'dan çıkma" gibi çok daha tehlikeli bir
//     çözüme (ayrıntılı hata gövdeleri, gevşek CORS, kapalı trust proxy)
//     başvurmak gerekmez.
// Ayrı yolda (/sim) durur: kök, mail linklerinin ve /health'in yeri.
// Sayfanın kendisi PAROLASIZDIR: amaç "linki alan denesin". Koruma iki yerde:
// bayrak (kapatınca yüzey hiç kurulmaz) ve /api'nin kendi auth'u.
if (process.env.SIMULATOR_ENABLED === 'true') {
    // CSP'yi bu yola özel gevşetiyoruz: kelime sesi/görseli dış kaynaktan
    // gelebiliyor (Word.audioUrl/imageUrl serbest URL). Global helmet() önce
    // çalıştığı için buradaki başlık onu YALNIZCA /sim altında ezer.
    const simulatorCsp = helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'img-src': ["'self'", 'data:', 'https:'],
                'media-src': ["'self'", 'https:']
            }
        }
    });

    app.use('/sim',
        simulatorCsp,
        // index.html varlıklarını GÖRELİ çağırıyor ("./app.css"). Sondaki eğik
        // çizgi olmadan bunlar /app.css'e çözülür ve canlıda 404 döner (dev'de
        // simülatör kökten servis edildiği için sorun görünmez). Bu yüzden
        // /sim → /sim/ yönlendirmesi statikten ÖNCE yapılır.
        (req, res, next) => (req.path === '/' && !req.originalUrl.startsWith('/sim/')
            ? res.redirect(302, '/sim/')
            : next()),
        // no-store: simülatör sık değişiyor; önbellekten gelen eski app.js
        // düzeltilmiş bug'ları "hâlâ var" gibi gösterip yanlış teşhise yol açıyor
        express.static('public', {
            etag: false,
            lastModified: false,
            setHeaders: (res) => {
                res.set('Cache-Control', 'no-store');
                res.set('X-Robots-Tag', 'noindex');
            }
        })
    );
}

// Deploy platformlarının canlılık kontrolü — auth ve rate limit dışında
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Production'da sadece izin verilen origin'ler (CORS_ORIGIN=https://a.com,https://b.com)
const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : undefined;
app.use(cors(
    process.env.NODE_ENV === 'production' && corsOrigins
        ? { origin: corsOrigins }
        : {}
));

app.use(express.json({ limit: '100kb' }));

// Simülatör her isteğine `X-Musubi-Client: simulator` koyar (public/app.js).
// Bu başlık kimlik DEĞİL etikettir — taklit edilebilir, hiçbir yetki vermez;
// tek işi trafiği loglarda ve rate limit kovalarında ayırt edilebilir kılmak.
// Gerçek istemci de ileride kendi etiketini gönderirse ("flutter" vb.) hangi
// trafiğin nereden geldiği tek başlıkla görünür olur.
app.use('/api', (req, res, next) =>
    (req.get('x-musubi-client') === 'simulator' ? simulatorApiLimiter : generalLimiter)(req, res, next));

// Universal Links / App Links doğrulama dosyaları (/.well-known/…). Aynı mail
// linkleri uygulama kuruluysa uygulamada, değilse aşağıdaki landing
// sayfalarında açılsın diye. generalLimiter'ın DIŞINDA: bu dosyaları iOS'un
// CDN'i ve Android'in kurulum doğrulaması çeker, 429 yiyen eşleşme sessizce
// düşer ve deep link hiç çalışmaz.
app.use(require('./modules/auth/auth.applinks.routes'));

// E-posta linklerinin indiği tarayıcı sayfaları (HTML, /api dışında):
// GET /verify-email/:token ve GET /reset-password/:token
app.use(require('./modules/auth/auth.landing.routes'));

// Hukuki metinler: GET /legal (liste) ve GET /legal/:doc (HTML sayfa).
// Mağaza kayıtlarının istediği "açık erişilebilir gizlilik politikası URL'si"
// buradan gelir; uygulama da aynı metni /api/legal'dan JSON olarak çeker.
const legal = require('./modules/legal/legal.routes');
app.use(legal.pages);
app.use('/api/legal', legal.api);

// auth BİLEREK korumasız mount edilir: register/login/refresh/forgot gibi
// uçların açık olması gerekir, koruma o router'da rota rota uygulanır.
app.use('/api/auth', require('./modules/auth/auth.routes'));

// Diğer TÜM modüller giriş + doğrulanmış e-posta ister. Koruma rota bazında
// değil MOUNT seviyesinde uygulanır: eskiden her rotaya tek tek eklenirdi ve
// yeni bir rota yazan kişi unutursa doğrulanmamış kullanıcıya açık kalırdı.
// Artık unutmanın sonucu "açık kalıyor" değil, koruma varsayılan.
// Bir ucun açık olması gerekiyorsa bu listeden çıkarılıp bilinçli olarak
// ayrı mount edilmeli.
const { protect, isEmailVerified } = require('./middlewares/auth.middleware');
const requireVerifiedUser = [protect, isEmailVerified];

app.use('/api/words', requireVerifiedUser, require('./modules/word/word.routes'));
app.use('/api/userwords', requireVerifiedUser, require('./modules/userword/userword.routes'));
app.use('/api/sessions', requireVerifiedUser, require('./modules/studysession/studysession.routes'));
app.use('/api/progress', requireVerifiedUser, require('./modules/progress/progress.routes'));
app.use('/api/memory', requireVerifiedUser, require('./modules/memory/memory.routes'));
app.use('/api/streak', requireVerifiedUser, require('./modules/streak/streak.routes'));
app.use('/api/home', requireVerifiedUser, require('./modules/home/home.routes'));
app.use('/api/notifications', requireVerifiedUser, require('./modules/notification/notification.routes'));
app.use('/api/quiz', requireVerifiedUser, require('./modules/quiz/quiz.routes'));
// Yükleme uçları ayrıca isAdmin ister — o koruma router'ın kendisinde
app.use('/api/uploads', requireVerifiedUser, require('./modules/upload/upload.routes'));
// Hikâyeler: okuma uçları her kullanıcıya açık, yönetim uçları router'da isAdmin'li
app.use('/api/stories', requireVerifiedUser, require('./modules/story/story.routes'));
// Profil fotoğrafı (v2). Kullanıcı adı müsaitliği kayıttan ÖNCE sorulduğu için
// burada değil /api/auth/check-username'de, oturumsuz
app.use('/api/users', requireVerifiedUser, require('./modules/user/user.routes'));

app.use(errorHandler);

module.exports = app;
