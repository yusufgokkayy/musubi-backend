// Musubi API sözleşme testleri — `npm test` ile çalışır.
// In-memory MongoDB kullanır: gerçek DB'ye dokunmaz, internet gerektirmez
// (ilk çalıştırmada mongod binary'si indirilir ve cache'lenir).
//
// Not: register akışı Resend'e gerçek e-posta atmaya çalıştığı için burada
// test edilmez; kullanıcılar doğrudan model üzerinden oluşturulur.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod, server, BASE;
let User, Word, UserWord, Notification, QuizAttempt, Event, Progress, Streak, DeviceSession;
let UserWordService, NotificationService, ProgressService, StreakService, sendEmail;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Bazı ortamlarda linux dağıtımı algılanamıyor; ubuntu binary'sine düş
async function startMemoryServer() {
    try {
        return await MongoMemoryServer.create();
    } catch (err) {
        process.env.MONGOMS_DISTRO = 'ubuntu-22.04';
        return MongoMemoryServer.create();
    }
}

const api = async (method, path, { body, token } = {}) => {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: 'Bearer ' + token })
        },
        ...(body && { body: JSON.stringify(body) })
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
};

const createVerifiedUser = async (email, overrides = {}) => {
    const user = await User.create({
        name: 'Test', surname: 'User', email,
        password: 'testsifre123', isEmailVerified: true,
        ...overrides
    });
    await ProgressService.initializeProgress(user._id);
    await StreakService.initializeStreak(user._id);
    return user;
};

const login = async (email) => {
    const res = await api('POST', '/auth/login', {
        body: { email, password: 'testsifre123', deviceName: 'test-suite' }
    });
    assert.equal(res.status, 200, 'login başarılı olmalı');
    return res.json;
};

before(async () => {
    mongod = await startMemoryServer();
    process.env.MONGO_URI = mongod.getUri('musubi-test');
    process.env.NODE_ENV = 'test';

    const app = require('../app'); // kökteki .env'i yükler (varsa)
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

    await mongoose.connect(process.env.MONGO_URI);

    User = require('../models/User');
    Word = require('../models/Word');
    UserWord = require('../models/UserWord');
    Notification = require('../models/Notification');
    QuizAttempt = require('../models/QuizAttempt');
    Event = require('../models/Event');
    Progress = require('../models/Progress');
    Streak = require('../models/Streak');
    DeviceSession = require('../models/DeviceSession');
    sendEmail = require('../utils/sendEmail');
    UserWordService = require('../modules/userword/userword.service');
    NotificationService = require('../modules/notification/notification.service');
    ProgressService = require('../modules/progress/progress.service');
    StreakService = require('../modules/streak/streak.service');

    // Test kelime seti: 30 N5 + 50 N4 core kelime (quiz çeldiricileri için yeterli havuz)
    const words = [];
    for (let i = 0; i < 30; i++) {
        words.push({ kanji: `語五${i}`, romaji: `gon${i}`, meaning: `meaning n5 ${i}`, type: 'isim', jlptLevel: 'N5', isCore: true });
    }
    for (let i = 0; i < 50; i++) {
        words.push({ kanji: `語四${i}`, romaji: `gyon${i}`, meaning: `meaning n4 ${i}`, type: 'isim', jlptLevel: 'N4', isCore: true });
    }
    // Core olmayan kelime: havuza/aramaya girmemeli
    words.push({ kanji: '非核', romaji: 'hikaku', meaning: 'non-core word', type: 'isim', jlptLevel: 'N5', isCore: false });
    await Word.insertMany(words);

    server = require('../app').listen(0);
    BASE = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
    server?.close();
    await mongoose.disconnect();
    await mongod?.stop();
});

describe('Auth', () => {
    it('yanlış şifreyle login 401 döner', async () => {
        await createVerifiedUser('auth@test.com');
        const res = await api('POST', '/auth/login', {
            body: { email: 'auth@test.com', password: 'yanlis-sifre' }
        });
        assert.equal(res.status, 401);
    });

    it('login access+refresh çifti döner, /me çalışır', async () => {
        const tokens = await login('auth@test.com');
        assert.ok(tokens.accessToken && tokens.refreshToken);

        const me = await api('GET', '/auth/me', { token: tokens.accessToken });
        assert.equal(me.status, 200);
        assert.equal(me.json.data.email, 'auth@test.com');
    });

    it('8 karakterden kısa şifre reddedilir', async () => {
        await assert.rejects(
            User.create({ name: 'A', surname: 'B', email: 'kisa@test.com', password: '1234567' }),
            /8 karakter/
        );
    });

    it('refresh geçerli token ile 200, bozuk token ile 401', async () => {
        const tokens = await login('auth@test.com');
        const ok = await api('POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken } });
        assert.equal(ok.status, 200);
        assert.ok(ok.json.data.accessToken);

        const bad = await api('POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken + 'x' } });
        assert.equal(bad.status, 401);
    });

    it('şifre değişimi tüm eski oturumları düşürür, taze çift döner', async () => {
        const devA = await login('auth@test.com');
        const devB = await login('auth@test.com');

        const cp = await api('PUT', '/auth/change-password', {
            token: devA.accessToken,
            body: { oldPassword: 'testsifre123', newPassword: 'testsifre123', deviceName: 'test-suite' }
        });
        assert.equal(cp.status, 200);
        assert.ok(cp.json.data.accessToken && cp.json.data.refreshToken);

        const oldB = await api('POST', '/auth/refresh', { body: { refreshToken: devB.refreshToken } });
        assert.equal(oldB.status, 401, 'eski cihazın oturumu düşmeli');

        const fresh = await api('POST', '/auth/refresh', { body: { refreshToken: cp.json.data.refreshToken } });
        assert.equal(fresh.status, 200);
    });

    it('tokensiz korumalı endpoint 401 döner', async () => {
        const res = await api('GET', '/userwords/stats');
        assert.equal(res.status, 401);
    });
});

describe('E-posta akışları', () => {
    const registerBody = (email, name = 'Posta') => ({
        body: { name, surname: 'Test', email, password: 'testsifre123', deviceName: 'test-suite' }
    });

    it('register doğrulama maili gönderir; maildeki token e-postayı doğrular', async () => {
        const res = await api('POST', '/auth/register', registerBody('posta@test.com'));
        assert.equal(res.status, 201);
        assert.ok(res.json.accessToken && res.json.refreshToken);
        assert.ok(res.json.verificationToken, 'test/dev ortamında token yanıtta döner');

        const mail = sendEmail.outbox.at(-1);
        assert.equal(mail.to, 'posta@test.com');
        assert.match(mail.subject, /Musubi - Email Doğrulama/);
        assert.ok(mail.html.includes(res.json.verificationToken), 'maildeki link yanıttaki token ile aynı olmalı');

        // Yan kayıtlar oluşmuş olmalı
        const user = await User.findOne({ email: 'posta@test.com' });
        assert.equal(await Progress.countDocuments({ user: user._id }), 5);
        assert.equal(await Streak.countDocuments({ user: user._id }), 1);

        // Doğrulanmadan ✉️ endpoint 403
        const me = await api('GET', '/auth/me', { token: res.json.accessToken });
        assert.equal(me.status, 403);

        const verify = await api('GET', `/auth/verify-email/${res.json.verificationToken}`);
        assert.equal(verify.status, 200);
        assert.ok(verify.json.data.accessToken && verify.json.data.refreshToken, 'doğrulama taze çift dönmeli');

        const meAfter = await api('GET', '/auth/me', { token: verify.json.data.accessToken });
        assert.equal(meAfter.status, 200);
        assert.equal(meAfter.json.data.isEmailVerified, true);
    });

    it('kayıtlı e-postayla register 400 döner', async () => {
        const res = await api('POST', '/auth/register', registerBody('posta@test.com'));
        assert.equal(res.status, 400);
    });

    it('mail gönderilemezse register geri alınır, yetim kayıt kalmaz', async () => {
        const before = await Promise.all([
            Progress.countDocuments({}), Streak.countDocuments({}), DeviceSession.countDocuments({})
        ]);

        sendEmail.failNextSend();
        const res = await api('POST', '/auth/register', registerBody('rollback@test.com'));
        assert.equal(res.status, 500);

        assert.equal(await User.countDocuments({ email: 'rollback@test.com' }), 0, 'kullanıcı silinmeli');
        const after = await Promise.all([
            Progress.countDocuments({}), Streak.countDocuments({}), DeviceSession.countDocuments({})
        ]);
        assert.deepEqual(after, before, 'yetim Progress/Streak/oturum kalmamalı');
    });

    it('resend-verification: bilinmeyen adres de 200 döner, bilinene yeni token gider', async () => {
        const outLenBefore = sendEmail.outbox.length;
        const unknown = await api('POST', '/auth/resend-verification-email', { body: { email: 'yok@test.com' } });
        assert.equal(unknown.status, 200, 'enumeration koruması: hesap yoksa da 200');
        assert.equal(sendEmail.outbox.length, outLenBefore, 'bilinmeyen adrese mail atılmamalı');

        await api('POST', '/auth/register', registerBody('tekrar@test.com'));
        const res = await api('POST', '/auth/resend-verification-email', { body: { email: 'tekrar@test.com' } });
        assert.equal(res.status, 200);

        const mail = sendEmail.outbox.at(-1);
        assert.equal(mail.to, 'tekrar@test.com');
        const token = mail.html.match(/verify-email\/([0-9a-f]+)/)[1];
        const verify = await api('GET', `/auth/verify-email/${token}`);
        assert.equal(verify.status, 200, 'yeniden gönderilen token çalışmalı');
    });

    it('forgot→reset: yeni şifre çalışır, eski şifre ve eski oturumlar düşer', async () => {
        await createVerifiedUser('sifirla@test.com');
        const oldDevice = await login('sifirla@test.com');

        const unknown = await api('POST', '/auth/forgot-password', { body: { email: 'hicyok@test.com' } });
        assert.equal(unknown.status, 200, 'enumeration koruması');

        const fp = await api('POST', '/auth/forgot-password', { body: { email: 'sifirla@test.com' } });
        assert.equal(fp.status, 200);
        assert.ok(fp.json.resetToken, 'test/dev ortamında token yanıtta döner');

        const mail = sendEmail.outbox.at(-1);
        assert.equal(mail.to, 'sifirla@test.com');
        assert.match(mail.subject, /Şifre Sıfırlama/);
        assert.ok(mail.html.includes(fp.json.resetToken));

        const rp = await api('POST', '/auth/reset-password', {
            body: { token: fp.json.resetToken, password: 'yenisifre123', deviceName: 'test-suite' }
        });
        assert.equal(rp.status, 200);
        assert.ok(rp.json.data.accessToken && rp.json.data.refreshToken);

        // Aynı token ikinci kez kullanılamaz
        const replay = await api('POST', '/auth/reset-password', {
            body: { token: fp.json.resetToken, password: 'baskasifre123' }
        });
        assert.equal(replay.status, 400);

        const oldRefresh = await api('POST', '/auth/refresh', { body: { refreshToken: oldDevice.refreshToken } });
        assert.equal(oldRefresh.status, 401, 'eski cihazın oturumu düşmeli');

        const oldLogin = await api('POST', '/auth/login', {
            body: { email: 'sifirla@test.com', password: 'testsifre123' }
        });
        assert.equal(oldLogin.status, 401, 'eski şifre çalışmamalı');

        const newLogin = await api('POST', '/auth/login', {
            body: { email: 'sifirla@test.com', password: 'yenisifre123' }
        });
        assert.equal(newLogin.status, 200);
    });

    it('doğrulanmamış hesap da şifre sıfırlayabilir', async () => {
        await api('POST', '/auth/register', registerBody('dogrulanmamis@test.com'));
        const fp = await api('POST', '/auth/forgot-password', { body: { email: 'dogrulanmamis@test.com' } });
        assert.equal(fp.status, 200);
        assert.ok(fp.json.resetToken, 'doğrulanmamış hesaba 403 dönülmemeli — link sahipliği zaten kanıtlar');
    });

    // HTML landing sayfaları /api dışında yaşar
    const pageGet = async (path) => {
        const res = await fetch(BASE.replace(/\/api$/, '') + path);
        return { status: res.status, text: await res.text() };
    };

    it('mail linkleri /api yerine landing sayfalarına gider', async () => {
        const reg = await api('POST', '/auth/register', registerBody('landing-mail@test.com'));
        const vMail = sendEmail.outbox.at(-1);
        assert.ok(vMail.html.includes(`/verify-email/${reg.json.verificationToken}`));
        assert.ok(!vMail.html.includes('/api/auth/'), 'mail linki API endpointine gitmemeli');
        assert.ok(/<a href="[^"]*verify-email/.test(vMail.html), 'link <a href> içinde olmalı');

        const fp = await api('POST', '/auth/forgot-password', { body: { email: 'landing-mail@test.com' } });
        const rMail = sendEmail.outbox.at(-1);
        assert.ok(rMail.html.includes(`/reset-password/${fp.json.resetToken}`));
        assert.ok(!rMail.html.includes('/api/auth/'));
    });

    it('verify landing: geçerli tokende deep link, geçersizde hata sayfası; sayfa yan etkisizdir', async () => {
        const reg = await api('POST', '/auth/register', registerBody('landing-verify@test.com'));
        const token = reg.json.verificationToken;

        const page = await pageGet(`/verify-email/${token}`);
        assert.equal(page.status, 200);
        assert.ok(page.text.includes(`musubi://verify-email/${token}`), 'deep link sayfada olmalı');

        // Sayfayı açmak (scanner prefetch senaryosu) doğrulamaz
        const user = await User.findOne({ email: 'landing-verify@test.com' });
        assert.equal(user.isEmailVerified, false, 'GET sayfası doğrulama YAPMAMALI');

        const bogus = await pageGet(`/verify-email/${'0'.repeat(40)}`);
        assert.ok(bogus.text.includes('Bağlantı Geçersiz'));

        const malformed = await pageGet('/verify-email/' + encodeURIComponent('<script>alert(1)</script>'));
        assert.ok(malformed.text.includes('Bağlantı Geçersiz'), 'bozuk biçimli token DB\'ye sorulmadan reddedilir');
        assert.ok(!malformed.text.includes('<script>alert'), 'token sayfaya kaçışsız gömülmemeli');
    });

    it('POST /auth/verify-email: deviceName yoksa oturum/token üretmez, varsa taze çift döner', async () => {
        const reg = await api('POST', '/auth/register', registerBody('post-verify@test.com'));
        const user = await User.findOne({ email: 'post-verify@test.com' });
        const sessionsBefore = await DeviceSession.countDocuments({ user: user._id });

        const web = await api('POST', '/auth/verify-email', { body: { token: reg.json.verificationToken } });
        assert.equal(web.status, 200);
        assert.ok(!web.json.data.accessToken && !web.json.data.refreshToken, 'web doğrulamada token dönmemeli');
        assert.equal(await DeviceSession.countDocuments({ user: user._id }), sessionsBefore, 'web doğrulama oturum açmamalı');

        const me = await api('GET', '/auth/me', { token: reg.json.accessToken });
        assert.equal(me.status, 200, 'doğrulama yine de gerçekleşmeli');

        // deviceName ile: login sözleşmesi (uygulama akışı)
        const reg2 = await api('POST', '/auth/register', registerBody('post-verify2@test.com'));
        const app2 = await api('POST', '/auth/verify-email', {
            body: { token: reg2.json.verificationToken, deviceName: 'Pixel 8' }
        });
        assert.equal(app2.status, 200);
        assert.ok(app2.json.data.accessToken && app2.json.data.refreshToken, 'uygulama doğrulamasında taze çift dönmeli');

        const missing = await api('POST', '/auth/verify-email', { body: {} });
        assert.equal(missing.status, 400, 'tokensiz istek 400 dönmeli');
    });

    it('reset landing: form sayfası açılır; deviceName\'siz reset oturum açmadan tüm oturumları düşürür', async () => {
        await createVerifiedUser('landing-reset@test.com');
        await login('landing-reset@test.com');

        const fp = await api('POST', '/auth/forgot-password', { body: { email: 'landing-reset@test.com' } });
        const page = await pageGet(`/reset-password/${fp.json.resetToken}`);
        assert.equal(page.status, 200);
        assert.ok(page.text.includes(`musubi://reset-password/${fp.json.resetToken}`));
        assert.ok(page.text.includes('reset-form'), 'yeni şifre formu olmalı');

        const rp = await api('POST', '/auth/reset-password', {
            body: { token: fp.json.resetToken, password: 'websifre123' }
        });
        assert.equal(rp.status, 200);
        assert.ok(!rp.json.data.accessToken, 'web resetinde token dönmemeli');

        const user = await User.findOne({ email: 'landing-reset@test.com' });
        assert.equal(await DeviceSession.countDocuments({ user: user._id }), 0, 'tüm oturumlar düşmeli, yenisi açılmamalı');

        const newLogin = await api('POST', '/auth/login', {
            body: { email: 'landing-reset@test.com', password: 'websifre123' }
        });
        assert.equal(newLogin.status, 200);

        // Kullanılmış token ile landing artık hata sayfası basar
        const usedPage = await pageGet(`/reset-password/${fp.json.resetToken}`);
        assert.ok(usedPage.text.includes('Bağlantı Geçersiz'));
    });

    it('e-posta değişikliği doğrulamayı sıfırlar, yeni adrese mail gider', async () => {
        await createVerifiedUser('eskiadres@test.com');
        const token = (await login('eskiadres@test.com')).accessToken;

        const res = await api('PUT', '/auth/update-info', {
            token, body: { email: 'yeniadres@test.com' }
        });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.isEmailVerified, false);
        assert.equal(res.json.data.email, 'yeniadres@test.com');

        const mail = sendEmail.outbox.at(-1);
        assert.equal(mail.to, 'yeniadres@test.com', 'doğrulama YENİ adrese gitmeli');

        // Artık ✉️ endpoint'ler 403; maildeki token doğrulamayı geri açar
        const me = await api('GET', '/auth/me', { token });
        assert.equal(me.status, 403);

        const vToken = mail.html.match(/verify-email\/([0-9a-f]+)/)[1];
        const verify = await api('GET', `/auth/verify-email/${vToken}`);
        assert.equal(verify.status, 200);

        const meAfter = await api('GET', '/auth/me', { token });
        assert.equal(meAfter.status, 200);
    });

    it('mail gönderilemezse e-posta değişikliği uygulanmaz', async () => {
        await createVerifiedUser('sabitadres@test.com');
        const token = (await login('sabitadres@test.com')).accessToken;

        sendEmail.failNextSend();
        const res = await api('PUT', '/auth/update-info', {
            token, body: { email: 'ulasilmaz@test.com' }
        });
        assert.equal(res.status, 500);

        const me = await api('GET', '/auth/me', { token });
        assert.equal(me.json.data.email, 'sabitadres@test.com', 'adres değişmemiş olmalı');
        assert.equal(me.json.data.isEmailVerified, true, 'doğrulama bozulmamış olmalı');
    });
});

describe('Onboarding — e-posta kontrolü ve sosyal giriş', () => {
    // Test ortamında socialAuth imza doğrulamadan payload'ı decode eder;
    // sahte ID token'ı HS256 ile imzalamak decode için yeterlidir
    const jwt = require('jsonwebtoken');
    const fakeIdToken = (payload) => jwt.sign(payload, 'sahte-imza');
    const googleBody = (overrides = {}) => ({
        body: {
            provider: 'google',
            idToken: fakeIdToken({
                sub: 'google-sub-1', email: 'sosyal@test.com', email_verified: true,
                given_name: 'Sosyal', family_name: 'Kullanıcı', ...overrides
            }),
            deviceName: 'test-suite'
        }
    });

    it('check-email: müsait adres available:true, kayıtlı adres false, bozuk biçim 400', async () => {
        const free = await api('POST', '/auth/check-email', { body: { email: 'bostaadres@test.com' } });
        assert.equal(free.status, 200);
        assert.equal(free.json.available, true);

        await createVerifiedUser('dolu@test.com');
        const taken = await api('POST', '/auth/check-email', { body: { email: 'dolu@test.com' } });
        assert.equal(taken.status, 200);
        assert.equal(taken.json.available, false);

        const bad = await api('POST', '/auth/check-email', { body: { email: 'gecersiz-adres' } });
        assert.equal(bad.status, 400);
        const empty = await api('POST', '/auth/check-email', { body: {} });
        assert.equal(empty.status, 400);
    });

    it('sosyal giriş: ilk seferde hesap oluşturur (201), sonrakinde giriş yapar (200)', async () => {
        const outLenBefore = sendEmail.outbox.length;
        const first = await api('POST', '/auth/social', googleBody());
        assert.equal(first.status, 201);
        assert.equal(first.json.isNewUser, true);
        assert.ok(first.json.accessToken && first.json.refreshToken);
        assert.equal(sendEmail.outbox.length, outLenBefore, 'sosyal kayıtta doğrulama maili atılmaz');

        // Yan kayıtlar oluşmuş, e-posta doğrulanmış olmalı — ✉️ endpoint direkt çalışır
        const me = await api('GET', '/auth/me', { token: first.json.accessToken });
        assert.equal(me.status, 200);
        assert.equal(me.json.data.isEmailVerified, true);
        const user = await User.findOne({ email: 'sosyal@test.com' });
        assert.equal(await Progress.countDocuments({ user: user._id }), 5);
        assert.equal(await Streak.countDocuments({ user: user._id }), 1);

        const second = await api('POST', '/auth/social', googleBody());
        assert.equal(second.status, 200);
        assert.equal(second.json.isNewUser, false);
        assert.equal(second.json.data.id, first.json.data.id, 'aynı hesaba girmeli');
    });

    it('aynı e-postalı local hesap sosyal girişe bağlanır, yeni hesap açılmaz', async () => {
        await createVerifiedUser('hibrit@test.com');
        const res = await api('POST', '/auth/social', googleBody({
            sub: 'google-sub-2', email: 'hibrit@test.com'
        }));
        assert.equal(res.status, 200);
        assert.equal(res.json.isNewUser, false);
        assert.equal(await User.countDocuments({ email: 'hibrit@test.com' }), 1);

        // Bağlanan hesabın şifresi korunur: e-posta+şifre girişi çalışmaya devam eder
        const pwLogin = await api('POST', '/auth/login', {
            body: { email: 'hibrit@test.com', password: 'testsifre123' }
        });
        assert.equal(pwLogin.status, 200);
    });

    it('doğrulanmamış sosyal e-posta 400, desteklenmeyen sağlayıcı 400 döner', async () => {
        const unverified = await api('POST', '/auth/social', googleBody({
            sub: 'google-sub-3', email: 'suphe@test.com', email_verified: false
        }));
        assert.equal(unverified.status, 400);

        const badProvider = await api('POST', '/auth/social', {
            body: { provider: 'facebook', idToken: fakeIdToken({ sub: 'x', email: 'x@test.com' }) }
        });
        assert.equal(badProvider.status, 400);

        const noToken = await api('POST', '/auth/social', { body: { provider: 'google' } });
        assert.equal(noToken.status, 400);
    });

    it('sosyal hesaba şifreyle giriş denemesi 401 döner (crash değil)', async () => {
        const res = await api('POST', '/auth/login', {
            body: { email: 'sosyal@test.com', password: 'rastgele-sifre' }
        });
        assert.equal(res.status, 401);
    });

    it('sosyal hesap şifre değiştiremez (400), silme taze idToken ile onaylanır', async () => {
        const tokens = (await api('POST', '/auth/social', googleBody())).json;

        const cp = await api('PUT', '/auth/change-password', {
            token: tokens.accessToken,
            body: { oldPassword: 'x', newPassword: 'yenisifre123' }
        });
        assert.equal(cp.status, 400, 'şifresiz hesap change-password kullanamaz');

        // Yanlış sub'lı idToken ile silme reddedilir
        const wrong = await api('DELETE', '/auth/delete-account', {
            token: tokens.accessToken,
            body: { idToken: fakeIdToken({ sub: 'baskasi', email: 'sosyal@test.com' }) }
        });
        assert.equal(wrong.status, 401);

        const del = await api('DELETE', '/auth/delete-account', {
            token: tokens.accessToken,
            body: { idToken: fakeIdToken({ sub: 'google-sub-1', email: 'sosyal@test.com' }) }
        });
        assert.equal(del.status, 200);
        assert.equal(await User.countDocuments({ email: 'sosyal@test.com' }), 0);
    });
});

describe('Öğrenme döngüsü (SRS)', () => {
    let token, userId, wordId;

    before(async () => {
        const user = await createVerifiedUser('srs@test.com', { dailyGoal: 20 });
        userId = user._id;
        token = (await login('srs@test.com')).accessToken;
    });

    it('günlük havuz dailyGoal kadar kelime verir ve gün içinde sabittir', async () => {
        const first = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        assert.equal(first.status, 200);
        assert.equal(first.json.data.newWords.length, 20);
        assert.equal(first.json.data.reviewWords.length, 0);
        wordId = first.json.data.newWords[0]._id;

        const second = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        assert.deepEqual(
            second.json.data.newWords.map(w => w._id).sort(),
            first.json.data.newWords.map(w => w._id).sort(),
            'havuz gün boyu donuk olmalı'
        );
    });

    it('core olmayan kelime havuza ve aramaya girmez', async () => {
        const today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        assert.ok(!today.json.data.newWords.some(w => w.kanji === '非核'));

        const search = await api('GET', '/words/search?q=non-core', { token });
        assert.equal(search.status, 200);
        assert.equal(search.json.data.length, 0);
    });

    it('regex injection içeren arama 500 vermez', async () => {
        const res = await api('GET', '/words/search?q=' + encodeURIComponent('(a+)+$*['), { token });
        assert.equal(res.status, 200);
    });

    it('doğru cevap seviye yükseltir; AYNI GÜN ikinci doğru SM-2\'yi ilerletmez; yanlış 1\'e düşürür + bildirim', async () => {
        let res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'correct' } });
        assert.equal(res.json.data.masteryLevel, 2);

        // İstemci aynı kelimeyi öğrenme + test aşamalarında iki kez sorabiliyor;
        // dakikalar arayla ikinci doğru, kelimeyi tek oturumda seviye 3'e zıplatmamalı
        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'correct' } });
        assert.equal(res.json.data.masteryLevel, 2, 'aynı gün ikinci doğru seviyeyi İLERLETMEMELİ');
        assert.equal(res.json.data.repetitions, 1, 'SM-2 tekrarı saymamalı');
        assert.equal(res.json.data.interval, 1, 'interval büyümemeli');
        assert.equal(res.json.data.correctCount, 2, 'istatistik sayacı yine de işlemeli');

        // Ertesi gün gelen doğru normal ilerler (gerçek aralıklı tekrar)
        await UserWord.updateOne(
            { user: userId, word: wordId },
            { $set: { lastReviewDate: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        );
        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'correct' } });
        assert.equal(res.json.data.masteryLevel, 3, 'ertesi günkü doğru → 2. tekrar → interval 6 → seviye 3');

        // Yanlış cevap aynı gün bile her koşulda sıfırlar (unutma sinyali)
        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'wrong' } });
        assert.equal(res.json.data.masteryLevel, 1);
        assert.equal(res.json.data.levelDropped, true);
        assert.equal(res.json.data.previousLevel, 3);

        const notifs = await api('GET', '/notifications', { token });
        assert.ok(notifs.json.data.notifications.some(n => n.type === 'word_level_down'));
    });

    it('easy doğru sayılır ve SM-2\'yi ilerletir (studysession ile tutarlı)', async () => {
        const w = (await api('GET', '/userwords/today?jlptLevel=N5', { token })).json.data.newWords[1];
        const res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'easy' } });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.masteryLevel, 2);
        assert.equal(res.json.data.correctCount, 1);
    });

    it('geçersiz result 400 döner', async () => {
        const res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'belki' } });
        assert.equal(res.status, 400);
    });

    it('bugünün hataları yanlış yapılan kelimeyi içerir', async () => {
        const res = await api('GET', '/userwords/mistakes', { token });
        assert.ok(res.json.data.mistakes.some(m => m.word._id === wordId));
    });

    it('stats byMasteryLevel dağılımı döner', async () => {
        const res = await api('GET', '/userwords/stats', { token });
        assert.equal(res.json.data.total, 2);
        assert.equal(res.json.data.byMasteryLevel[1], 1, 'yanlışla biten kelime');
        assert.equal(res.json.data.byMasteryLevel[2], 1, 'easy ile öğrenilen kelime');
    });

    it('distribution toplamları tutarlıdır', async () => {
        const res = await api('GET', '/progress/N5/distribution', { token });
        const d = res.json.data;
        const sum = Object.values(d.distribution).reduce((a, b) => a + b, 0);
        assert.equal(sum + d.notStarted, d.totalWords);
        assert.equal(d.totalWords, 30); // sadece core kelimeler
    });

    it('answer_submitted event\'leri yazılır', async () => {
        await sleep(100); // event yazımı fire-and-forget
        const count = await Event.countDocuments({ user: userId, type: 'answer_submitted' });
        assert.ok(count >= 3);
    });
});

describe('Quiz', () => {
    let token, userId;

    before(async () => {
        const user = await createVerifiedUser('quiz@test.com');
        userId = user._id;
        token = (await login('quiz@test.com')).accessToken;
    });

    // Soru başına cevap akışı: her soru sırayla cevaplanır, son yanıt final result içerir
    const answerAllFromDb = async (quizId, correct = true, tok = token, startIndex = 0) => {
        const attempt = await QuizAttempt.findById(quizId);
        let last;
        for (let i = startIndex; i < attempt.questions.length; i++) {
            const q = attempt.questions[i];
            const answer = q.format === 'typing'
                ? (correct ? q.correctAnswers[0] : 'kesin-yanlis-cevap')
                : (correct ? q.correctIndex : (q.correctIndex + 1) % 4);
            last = await api('POST', `/quiz/${quizId}/answer`, { token: tok, body: { index: i, answer } });
        }
        return last;
    };

    it('placement N5 ile başlar, 10 soru verir, cevap anahtarı sızdırmaz', async () => {
        const res = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.jlptLevel, 'N5');
        assert.equal(res.json.data.totalQuestions, 10, '10 soru × 5 basamak = 50');
        assert.ok(!JSON.stringify(res.json).includes('correctIndex'), 'cevap anahtarı sızmamalı');
        assert.ok(!JSON.stringify(res.json).includes('correctAnswers'), 'yazma cevap anahtarı sızmamalı');

        const last = await answerAllFromDb(res.json.data.quizId, true);
        assert.equal(last.json.data.finished, true);
        const result = last.json.data.result;
        assert.equal(result.passed, true);
        assert.equal(result.unlockedLevel, 'N4');
        assert.equal(result.nextRung, 'N4');
        assert.equal(result.summary, undefined, 'merdiven sürerken özet dönmez');
    });

    it('cevaplar anlık geri bildirim döner; N4\'te kalınca merdiven cezasız biter ve özet döner', async () => {
        const res = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(res.json.data.jlptLevel, 'N4');
        const quizId = res.json.data.quizId;

        // İlk soruya yanlış cevap: "Yanlış Cevap!" kartının verisi dönmeli
        const attempt = await QuizAttempt.findById(quizId);
        const q0 = attempt.questions[0];
        const wrongAnswer = q0.format === 'typing' ? 'kesin-yanlis-cevap' : (q0.correctIndex + 1) % 4;
        const fb = await api('POST', `/quiz/${quizId}/answer`, { token, body: { index: 0, answer: wrongAnswer } });
        assert.equal(fb.status, 200);
        assert.equal(fb.json.data.correct, false);
        assert.ok(fb.json.data.word.kanji && fb.json.data.word.meaning, '"駅 — istasyon" satırı için kelime dönmeli');
        assert.ok('correctIndex' in fb.json.data || 'correctAnswer' in fb.json.data, 'doğru cevap gösterilebilmeli');
        assert.equal(fb.json.data.finished, false);
        assert.equal(fb.json.data.answeredCount, 1);

        // Aynı soru ikinci kez cevaplanamaz, index sınırları denetlenir
        const dup = await api('POST', `/quiz/${quizId}/answer`, { token, body: { index: 0, answer: wrongAnswer } });
        assert.equal(dup.status, 400);
        const badIdx = await api('POST', `/quiz/${quizId}/answer`, { token, body: { index: 99, answer: 0 } });
        assert.equal(badIdx.status, 400);

        // Kalanları da yanlış cevapla → merdiven biter
        const last = await answerAllFromDb(quizId, false, token, 1);
        const result = last.json.data.result;
        assert.equal(result.passed, false);
        assert.equal(result.placementFinished, true);
        assert.equal(result.nextAttemptAllowedAt, undefined, 'placement cooldown yakmaz');

        // "Seviyen Belirlendi" ekranı: iki basamağın toplamları (10 doğru + 10 yanlış)
        const summary = result.summary;
        assert.equal(summary.determinedLevel, 'N4', 'N5 geçildi, N4\'te kalındı → seviye N4');
        assert.equal(summary.totalQuestions, 20);
        assert.equal(summary.correctCount, 10);
        assert.equal(summary.wrongCount, 10);
        assert.ok(typeof summary.durationSeconds === 'number' && summary.durationSeconds >= 0);

        const again = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(again.status, 400, 'placement tek seferliktir');
    });

    it('yazma sorusu: büyük harf/noktalama/parantez toleranslı puanlanır, boş yanlış sayılır', async () => {
        const user = await createVerifiedUser('yazma@test.com');
        const t = (await login('yazma@test.com')).accessToken;
        const word = await Word.findOne({ jlptLevel: 'N5', isCore: true });

        // Deterministik test için deneme doğrudan oluşturulur (start'ta format rastgele)
        const attempt = await QuizAttempt.create({
            user: user._id, type: 'placement', jlptLevel: 'N5',
            questions: [
                { word: word._id, format: 'typing', prompt: { kanji: word.kanji, romaji: word.romaji }, correctAnswers: ['gelecek yıl', 'seneye'] },
                { word: word._id, format: 'typing', prompt: { kanji: word.kanji, romaji: word.romaji }, correctAnswers: ['tehlikeli'] },
                { word: word._id, format: 'typing', prompt: { kanji: word.kanji, romaji: word.romaji }, correctAnswers: ['mavi'] },
                { word: word._id, format: 'meaning', prompt: { kanji: word.kanji }, choices: ['a', 'b', 'c', 'd'], correctIndex: 2 }
            ]
        });

        const answers = ['  SENEYE!! ', 'Tehlikeli (çok)', '', 2];
        const notes = [
            'varyant + boşluk/noktalama/büyük harf kabul edilmeli',
            'parantez içi yok sayılmalı',
            'boş bırakılan (Şimdilik Geç) yanlış sayılmalı',
            'şıklı soru index ile puanlanmalı'
        ];
        const expected = [true, true, false, true];
        const feedbacks = [];
        for (let i = 0; i < answers.length; i++) {
            const r = await api('POST', `/quiz/${attempt._id}/answer`, {
                token: t, body: { index: i, answer: answers[i] }
            });
            assert.equal(r.status, 200);
            assert.equal(r.json.data.correct, expected[i], notes[i]);
            feedbacks.push(r);
        }
        assert.equal(feedbacks[0].json.data.correctAnswer, 'gelecek yıl', 'geri bildirim kartı için cevap dönmeli');
        assert.equal(feedbacks.at(-1).json.data.result.correctCount, 3);
    });

    it('levelup: 35 soru, kalınca 3 gün cooldown, tekrar deneme 403', async () => {
        const res = await api('POST', '/quiz/start', { token, body: { type: 'levelup', jlptLevel: 'N4' } });
        assert.equal(res.json.data.totalQuestions, 35);

        const last = await answerAllFromDb(res.json.data.quizId, false);
        const result = last.json.data.result;
        assert.equal(result.passed, false);
        assert.equal(result.failCount, 1);
        assert.equal(result.cooldownDays, 3);

        const retry = await api('POST', '/quiz/start', { token, body: { type: 'levelup', jlptLevel: 'N4' } });
        assert.equal(retry.status, 403);
        assert.ok(retry.json.nextAttemptAllowedAt, 'UI için cooldown bitişi dönmeli');
    });

    it('kilitli seviyeye levelup 403 döner', async () => {
        const res = await api('POST', '/quiz/start', { token, body: { type: 'levelup', jlptLevel: 'N2' } });
        assert.equal(res.status, 403);
    });

    it('quiz_completed event\'leri yazılır', async () => {
        await sleep(100);
        const count = await Event.countDocuments({ user: userId, type: 'quiz_completed' });
        assert.equal(count, 3);
    });
});

describe('İçerikli soru tipleri (boşluk doldurma & görselli)', () => {
    before(async () => {
        // Tüm N5 kelimelerine örnek cümle + görsel işle: içerik formatları seçilebilir olsun
        await Word.updateMany({ jlptLevel: 'N5' }, [{
            $set: {
                example: { $concat: ['これは', '$kanji', 'です。'] },
                imageUrl: { $concat: ['https://img.test/', '$romaji', '.jpg'] }
            }
        }], { updatePipeline: true });
    });

    it('içeriği olan kelimede fillblank/image üretilir ve doğru biçimlidir', async () => {
        const QuizService = require('../modules/quiz/quiz.service');
        // 6 formatlı 40 çekilişte içerik formatlarından en az biri pratikte kesin çıkar
        const questions = [
            ...await QuizService.generateQuestions('N5', 20, true),
            ...await QuizService.generateQuestions('N5', 20, true)
        ];

        const fillblanks = questions.filter(q => q.format === 'fillblank');
        const images = questions.filter(q => q.format === 'image');
        assert.ok(fillblanks.length + images.length > 0, 'içerik formatları karışıma girmeli');

        for (const q of fillblanks) {
            assert.match(q.prompt.sentence, /____/, 'cümlede boşluk olmalı');
            assert.ok(!q.prompt.audioUrl, 'ses cevabı söylerdi — fillblank\'te olmamalı');
            assert.equal(q.choices.length, 4);
            assert.ok(q.choices[q.correctIndex], 'doğru şık listede olmalı');
        }
        for (const q of images) {
            assert.ok(q.prompt.imageUrl);
            assert.ok(!q.prompt.audioUrl, 'ses cevabı söylerdi — image\'da olmamalı');
            assert.equal(q.choices.length, 4);
        }

        // levelup üretimi içerik formatlarını kullanmaz (klasik 3 şıklı)
        const classic = await QuizService.generateQuestions('N5', 20, false);
        assert.ok(classic.every(q => ['meaning', 'reverse', 'reading'].includes(q.format)));
    });

    it('fillblank/image cevapları API üzerinden puanlanır', async () => {
        const user = await createVerifiedUser('icerik@test.com');
        const t = (await login('icerik@test.com')).accessToken;
        const word = await Word.findOne({ jlptLevel: 'N5', isCore: true });

        const attempt = await QuizAttempt.create({
            user: user._id, type: 'placement', jlptLevel: 'N5',
            questions: [
                { word: word._id, format: 'fillblank', prompt: { sentence: 'これは____です。' }, choices: ['あ', word.kanji, 'い', 'う'], correctIndex: 1 },
                { word: word._id, format: 'image', prompt: { imageUrl: 'https://img.test/x.jpg' }, choices: [word.kanji, 'あ', 'い', 'う'], correctIndex: 0 }
            ]
        });

        const a1 = await api('POST', `/quiz/${attempt._id}/answer`, { token: t, body: { index: 0, answer: 1 } });
        assert.equal(a1.json.data.correct, true);

        const a2 = await api('POST', `/quiz/${attempt._id}/answer`, { token: t, body: { index: 1, answer: 3 } });
        assert.equal(a2.json.data.correct, false);
        assert.equal(a2.json.data.correctIndex, 0);
        assert.equal(a2.json.data.finished, true);
        assert.equal(a2.json.data.result.score, 50);
    });
});

describe('Ana ekran (Home)', () => {
    let token, todayStr;

    before(async () => {
        await createVerifiedUser('home@test.com', { dailyGoal: 20 });
        token = (await login('home@test.com')).accessToken;
        // Varsayılan timezone Europe/Istanbul — gün string'i ona göre
        todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());

        // Havuz + oturum aç, 2 kelime cevapla (1 doğru 1 yanlış)
        const today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        const [w1, w2] = today.json.data.newWords;
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        await api('POST', '/userwords/answer', { token, body: { wordId: w1._id, result: 'correct' } });
        await api('POST', '/userwords/answer', { token, body: { wordId: w2._id, result: 'wrong' } });
        await sleep(100); // answer_submitted event'leri fire-and-forget yazılır
    });

    it('summary ana ekranın tüm başlık verisini döner', async () => {
        const res = await api('GET', '/home/summary', { token });
        assert.equal(res.status, 200);
        const d = res.json.data;

        assert.equal(d.name, 'Test', '"Merhaba <ad>" başlığı için');
        assert.equal(d.dailyGoal, 20, 'ilerleme çemberinin paydası (14/20)');
        assert.equal(d.today.totalWords, 2);
        assert.equal(d.today.correctCount, 1);
        assert.equal(d.today.wrongCount, 1);
        assert.equal(d.todayMistakeCount, 1, '"Bugünün Hataları — N Hata" başlığı için');
        assert.equal(d.streak.current, 1);
        assert.ok(typeof d.tomorrowReviews === 'number', '"Yarın N Kart Bekliyor" bandı için');
    });

    it('gün detayı: sayılar + o gün çalışılan kelimeler sonuçlarıyla döner', async () => {
        const res = await api('GET', `/home/day/${todayStr}`, { token });
        assert.equal(res.status, 200);
        const d = res.json.data;

        assert.equal(d.date, todayStr);
        assert.equal(d.goal, 20, 'o günün havuz büyüklüğü çemberin paydasıdır');
        assert.equal(d.totalWords, 2);
        assert.equal(d.correctCount, 1);
        assert.equal(d.wrongCount, 1);
        assert.equal(d.words.length, 2);
        assert.ok(d.words.every(w => w.word.kanji && ['correct', 'wrong', 'empty'].includes(w.result)));
        assert.equal(d.words.filter(w => w.result === 'wrong').length, 1);
    });

    it('gün detayı: veri olmayan gün sıfırlarla döner, bozuk tarih 400', async () => {
        const empty = await api('GET', '/home/day/2020-01-01', { token });
        assert.equal(empty.status, 200);
        assert.equal(empty.json.data.totalWords, 0);
        assert.deepEqual(empty.json.data.words, []);

        const bad = await api('GET', '/home/day/22-nisan', { token });
        assert.equal(bad.status, 400);

        const badCalendar = await api('GET', '/home/day/2026-13-45', { token });
        assert.equal(badCalendar.status, 400);
    });
});

describe('Seviyeler ekranı', () => {
    let token;

    before(async () => {
        await createVerifiedUser('seviye@test.com');
        token = (await login('seviye@test.com')).accessToken;
        const today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        const [w1, w2] = today.json.data.newWords;
        await api('POST', '/userwords/answer', { token, body: { wordId: w1._id, result: 'correct' } });
        await api('POST', '/userwords/answer', { token, body: { wordId: w2._id, result: 'wrong' } });
    });

    it('progress %75 eşiğini ve seviye listesini döner', async () => {
        const res = await api('GET', '/progress', { token });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.completionThreshold, 75, '"listeyi %75 oranında tamamlayın" kutusu için');
        assert.equal(res.json.data.levels.length, 5);
        const n5 = res.json.data.levels.find(l => l.jlptLevel === 'N5');
        assert.ok(n5.isUnlocked && n5.totalWords > 0);
    });

    it('kelime listesi jlptLevel + masteryLevel filtreleriyle çalışır', async () => {
        const all = await api('GET', '/userwords/list?jlptLevel=N5', { token });
        assert.equal(all.status, 200);
        assert.equal(all.json.data.total, 2);
        assert.ok(all.json.data.items[0].word.kanji, 'kelime dokümanı gömülü gelmeli');

        const lvl1 = await api('GET', '/userwords/list?jlptLevel=N5&masteryLevel=1', { token });
        assert.equal(lvl1.json.data.total, 1, 'yanlış cevaplanan kelime 1. seviyede olmalı');

        const bad = await api('GET', '/userwords/list?masteryLevel=9', { token });
        assert.equal(bad.status, 400);
    });
});

describe('Ayarlar ekranı', () => {
    let token;

    before(async () => {
        await createVerifiedUser('ayar@test.com');
        token = (await login('ayar@test.com')).accessToken;
    });

    it('verify-password: doğru şifre 200, yanlış 401 döner', async () => {
        const ok = await api('POST', '/auth/verify-password', {
            token, body: { password: 'testsifre123' }
        });
        assert.equal(ok.status, 200);

        const wrong = await api('POST', '/auth/verify-password', {
            token, body: { password: 'yanlis-sifre' }
        });
        assert.equal(wrong.status, 401);
        assert.match(wrong.json.message, /Şifreniz yanlış/);
    });

    it('tercihler (dil/tema/font) kısmi güncellenir, geçersiz değer 400', async () => {
        const me = await api('GET', '/auth/me', { token });
        assert.deepEqual(me.json.data.preferences, { language: 'tr', theme: 'light', fontSize: 'medium' });
        assert.equal(me.json.data.isPremium, false);

        const res = await api('PUT', '/auth/update-info', {
            token, body: { preferences: { theme: 'dark' } }
        });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.preferences.theme, 'dark');
        assert.equal(res.json.data.preferences.fontSize, 'medium', 'gönderilmeyen tercih korunmalı');

        const bad = await api('PUT', '/auth/update-info', {
            token, body: { preferences: { theme: 'neon' } }
        });
        assert.equal(bad.status, 400);
    });

    it('isPremium update-info ile değiştirilemez, timezone değiştirilebilir', async () => {
        const res = await api('PUT', '/auth/update-info', {
            token, body: { isPremium: true, timezone: 'Europe/Berlin' }
        });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.isPremium, false, 'premium yalnızca satın almayla açılır');
        assert.equal(res.json.data.timezone, 'Europe/Berlin');

        // Geçersiz timezone patlatmaz, varsayılana düşer
        const badTz = await api('PUT', '/auth/update-info', {
            token, body: { timezone: 'Mars/Olympus' }
        });
        assert.equal(badTz.json.data.timezone, 'Europe/Istanbul');
    });
});

describe('Bildirim üretimi (cron)', () => {
    let userId;
    // Europe/Istanbul = UTC+3 (DST yok) — kullanıcının yerel saatine denk gelen an
    const atIstanbulHour = (h) => {
        const d = new Date();
        d.setUTCHours(h - 3, 30, 0, 0);
        return d;
    };

    before(async () => {
        const user = await createVerifiedUser('bildirim@test.com', { dailyGoal: 25 });
        userId = user._id;
        await Streak.updateOne(
            { user: userId },
            { currentStreak: 12, lastStudyDate: new Date(Date.now() - 2 * 86400000) }
        );
    });

    it('10:00 — Bugünün Görevi + Günlük Kelime üretilir; tekrar çağrı çoğaltmaz', async () => {
        await NotificationService.generateDailyNotifications(atIstanbulHour(10));
        await NotificationService.generateDailyNotifications(atIstanbulHour(10));

        const tasks = await Notification.find({ user: userId, type: 'daily_task' });
        assert.equal(tasks.length, 1, 'dedupe: günde 1 görev bildirimi');
        assert.match(tasks[0].body, /25 ezberlenecek/, 'gövde kullanıcının dailyGoal\'unu içermeli');

        const words = await Notification.find({ user: userId, type: 'daily_word' });
        assert.equal(words.length, 1);
        assert.match(words[0].body, /Bugünün günlük kelimesi/);
        assert.ok(words[0].data.wordId, 'push deep-link için wordId dönmeli');
    });

    it('19:00 nazik seri hatırlatması, 23:00 son uyarı üretir', async () => {
        await NotificationService.generateDailyNotifications(atIstanbulHour(19));
        const reminder = await Notification.findOne({ user: userId, type: 'streak_reminder' });
        assert.equal(reminder.title, '12 Günlük Seri!');
        assert.match(reminder.body, /devam ettirmeyi unutma/);

        await NotificationService.generateDailyNotifications(atIstanbulHour(23));
        const warning = await Notification.findOne({ user: userId, type: 'streak_warning' });
        assert.match(warning.body, /1 saat sonra/);
    });

    it('bugün çalışana seri bildirimi gitmez; tercihi kapalıya günlükler gitmez', async () => {
        const calisan = await createVerifiedUser('calisan@test.com');
        await Streak.updateOne({ user: calisan._id }, { currentStreak: 5, lastStudyDate: new Date() });

        const kapali = await createVerifiedUser('kapali@test.com', {
            notificationSettings: { dailyReminder: false, streakReminder: true, wordLevelDown: true }
        });

        await NotificationService.generateDailyNotifications(atIstanbulHour(19));
        await NotificationService.generateDailyNotifications(atIstanbulHour(10));

        assert.equal(
            await Notification.countDocuments({ user: calisan._id, type: { $in: ['streak_reminder', 'streak_warning'] } }),
            0, 'bugün çalışmış kullanıcı rahatsız edilmez'
        );
        assert.equal(
            await Notification.countDocuments({ user: kapali._id, type: { $in: ['daily_task', 'daily_word'] } }),
            0, 'dailyReminder kapalıysa günlük bildirimler oluşmaz'
        );
    });
});

describe('Mastery decay', () => {
    let userId, words;

    before(async () => {
        const user = await createVerifiedUser('decay@test.com');
        userId = user._id;
        await Streak.updateOne({ user: userId }, { lastStudyDate: new Date(Date.now() - 60 * 86400000) });
        words = await Word.find({ jlptLevel: 'N4', isCore: true }).limit(3);

        const DAY = 86400000;
        const mk = (word, masteryLevel, repetitions, interval, overdueDays) => ({
            user: userId, word: word._id, status: 'learning',
            masteryLevel, repetitions, interval, easeFactor: 2.5,
            correctCount: repetitions, wrongCount: 0,
            nextReviewDate: new Date(Date.now() - overdueDays * DAY)
        });
        await UserWord.insertMany([
            mk(words[0], 4, 3, 10, 25),  // ratio 2.5 → hedef 3
            mk(words[1], 4, 3, 10, 45),  // ratio 4.5 → hedef 1
            mk(words[2], 5, 5, 25, 30)   // ratio 1.2 → grace içinde
        ]);
    });

    it('vadesi 2× aşan kelimeler kademeli düşer, grace içindekiler korunur', async () => {
        await UserWordService.applyMasteryDecay();
        const levels = await Promise.all(words.map(async w =>
            (await UserWord.findOne({ user: userId, word: w._id })).masteryLevel
        ));
        assert.deepEqual(levels, [3, 1, 5]);
    });

    it('SM-2 alanlarına dokunulmaz ve idempotenttir', async () => {
        const before = await UserWord.findOne({ user: userId, word: words[0]._id });
        assert.equal(before.repetitions, 3);
        assert.equal(before.interval, 10);

        await UserWordService.applyMasteryDecay();
        const afterRun = await UserWord.findOne({ user: userId, word: words[0]._id });
        assert.equal(afterRun.masteryLevel, 3, 'ikinci çalıştırma ek düşüş yapmamalı');
    });

    it('düşüşler tek özet bildirimde demetlenir', async () => {
        const notifs = await Notification.find({ user: userId, type: 'word_level_down', 'data.source': 'decay' });
        assert.equal(notifs.length, 1);
        assert.equal(notifs[0].data.count, 2);
    });

    it('doğru cevap seviyeyi SM-2\'den anında geri yükseltir', async () => {
        const result = await UserWordService.submitAnswer(userId, words[0]._id, 'correct');
        assert.ok(result.masteryLevel >= 4, 'düşen seviye ilk doğru cevapta geri zıplamalı');
    });
});

describe('Hesap silme (KVKK)', () => {
    it('kullanıcının tüm verisi silinir', async () => {
        const user = await createVerifiedUser('kvkk@test.com');
        const tokens = await login('kvkk@test.com');

        // Biraz veri üret
        await api('GET', '/userwords/today?jlptLevel=N5', { token: tokens.accessToken });

        const del = await api('DELETE', '/auth/delete-account', {
            token: tokens.accessToken,
            body: { password: 'testsifre123' }
        });
        assert.equal(del.status, 200);

        await sleep(100);
        const leftovers = await Promise.all([
            User.countDocuments({ _id: user._id }),
            UserWord.countDocuments({ user: user._id }),
            Progress.countDocuments({ user: user._id }),
            Streak.countDocuments({ user: user._id }),
            Notification.countDocuments({ user: user._id }),
            Event.countDocuments({ user: user._id })
        ]);
        assert.deepEqual(leftovers, [0, 0, 0, 0, 0, 0]);
    });
});
