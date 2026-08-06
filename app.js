// Express uygulaması — DB bağlantısı, cron ve listen İÇERMEZ.
// server.js production'da bunları ekler; test süiti app'i doğrudan kullanır.
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const errorHandler = require('./middlewares/errorHandler');
const { generalLimiter } = require('./middlewares/rateLimiter');

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

app.use('/api', generalLimiter);

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
app.use('/api/streak', requireVerifiedUser, require('./modules/streak/streak.routes'));
app.use('/api/home', requireVerifiedUser, require('./modules/home/home.routes'));
app.use('/api/notifications', requireVerifiedUser, require('./modules/notification/notification.routes'));
app.use('/api/quiz', requireVerifiedUser, require('./modules/quiz/quiz.routes'));

app.use(errorHandler);

module.exports = app;
