// Misugi API sözleşme testleri — `npm test` ile çalışır.
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
    process.env.MONGO_URI = mongod.getUri('misugi-test');
    process.env.NODE_ENV = 'test';

    const app = require('../app'); // config/.env'i yükler (varsa)
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
        assert.match(mail.subject, /Misugi - Email Doğrulama/);
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

    it('doğru cevaplar masteryLevel yükseltir, yanlış 1\'e düşürür + bildirim', async () => {
        let res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'correct' } });
        assert.equal(res.json.data.masteryLevel, 2);

        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'correct' } });
        assert.equal(res.json.data.masteryLevel, 3);

        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'wrong' } });
        assert.equal(res.json.data.masteryLevel, 1);
        assert.equal(res.json.data.levelDropped, true);
        assert.equal(res.json.data.previousLevel, 3);

        const notifs = await api('GET', '/notifications', { token });
        assert.ok(notifs.json.data.notifications.some(n => n.type === 'word_level_down'));
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
        assert.equal(res.json.data.total, 1);
        assert.equal(res.json.data.byMasteryLevel[1], 1);
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

    const submitFromDb = async (quizId, correct = true) => {
        const attempt = await QuizAttempt.findById(quizId);
        const answers = attempt.questions.map(q =>
            correct ? q.correctIndex : (q.correctIndex + 1) % 4
        );
        return api('POST', `/quiz/${quizId}/submit`, { token, body: { answers } });
    };

    it('placement N5 ile başlar, 12 soru verir, cevap anahtarı sızdırmaz', async () => {
        const res = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.jlptLevel, 'N5');
        assert.equal(res.json.data.totalQuestions, 12);
        assert.ok(!JSON.stringify(res.json).includes('correctIndex'), 'cevap anahtarı sızmamalı');

        const sub = await submitFromDb(res.json.data.quizId, true);
        assert.equal(sub.json.data.passed, true);
        assert.equal(sub.json.data.unlockedLevel, 'N4');
        assert.equal(sub.json.data.nextRung, 'N4');
    });

    it('sonraki basamak N4; kalınca merdiven cezasız biter', async () => {
        const res = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(res.json.data.jlptLevel, 'N4');

        const sub = await submitFromDb(res.json.data.quizId, false);
        assert.equal(sub.json.data.passed, false);
        assert.equal(sub.json.data.placementFinished, true);
        assert.equal(sub.json.data.nextAttemptAllowedAt, undefined, 'placement cooldown yakmaz');

        const again = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(again.status, 400, 'placement tek seferliktir');
    });

    it('levelup: 35 soru, kalınca 3 gün cooldown, tekrar deneme 403', async () => {
        const res = await api('POST', '/quiz/start', { token, body: { type: 'levelup', jlptLevel: 'N4' } });
        assert.equal(res.json.data.totalQuestions, 35);

        const sub = await submitFromDb(res.json.data.quizId, false);
        assert.equal(sub.json.data.passed, false);
        assert.equal(sub.json.data.failCount, 1);
        assert.equal(sub.json.data.cooldownDays, 3);

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
