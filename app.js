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
    app.use(express.static('public'));
} else {
    app.use(helmet());
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

app.use('/api', generalLimiter);

app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/words', require('./modules/word/word.routes'));
app.use('/api/userwords', require('./modules/userword/userword.routes'));
app.use('/api/sessions', require('./modules/studysession/studysession.routes'));
app.use('/api/progress', require('./modules/progress/progress.routes'));
app.use('/api/streak', require('./modules/streak/streak.routes'));
app.use('/api/home', require('./modules/home/home.routes'));
app.use('/api/notifications', require('./modules/notification/notification.routes'));
app.use('/api/quiz', require('./modules/quiz/quiz.routes'));

app.use(errorHandler);

module.exports = app;
