// Musubi API sözleşme testleri — `npm test` ile çalışır.
// In-memory MongoDB kullanır: gerçek DB'ye dokunmaz, internet gerektirmez
// (ilk çalıştırmada mongod binary'si indirilir ve cache'lenir).
//
// Not: register akışı Resend'e gerçek e-posta atmaya çalıştığı için burada
// test edilmez; kullanıcılar doğrudan model üzerinden oluşturulur.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod, server, BASE, uploadDir;
let User, Word, UserWord, Notification, QuizAttempt, Event, Progress, Streak, DeviceSession, DailyWordPool;
let UserWordService, NotificationService, ProgressService, StreakService, StudySessionService, AuthService, WordService, sendEmail;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Bir instant'ın varsayılan saat dilimindeki takvim günü ("YYYY-MM-DD")
const localDay = (value) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(value));

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
        password: 'Testsifre123!', isEmailVerified: true,
        ...overrides
    });
    await ProgressService.initializeProgress(user._id);
    await StreakService.initializeStreak(user._id);
    return user;
};

// Doğrulama/sıfırlama token'ları API yanıtında BİLEREK dönmüyor (fail-open
// NODE_ENV kontrolü kaldırıldı — bkz. auth.controller.js). Testler de gerçek
// kullanıcının izlediği yolu taklit eder: token maildeki linkten okunur.
const tokenFromLastMail = (path) => {
    const html = sendEmail.outbox.at(-1)?.html || '';
    const match = new RegExp(`/${path}/([a-f0-9]{40})`).exec(html);
    assert.ok(match, `son mailde /${path}/<token> linki bulunamadı`);
    return match[1];
};
const lastVerificationToken = () => tokenFromLastMail('verify-email');
const lastResetToken = () => tokenFromLastMail('reset-password');

// Adres bazlı mail cooldown'ını geçmiş gibi gösterir — gerçek 60 saniyeyi
// beklemeden throttle SONRASI akışları test edebilmek için
const expireMailCooldown = (email, kind = 'verification') =>
    User.updateOne(
        { email },
        { [`mailThrottle.${kind}.lastSentAt`]: new Date(Date.now() - 2 * 60 * 1000) }
    );

// Cevap ucu yalnızca BUGÜNÜN HAVUZUNDAKİ kelimeyi kabul ediyor (havuz dışı
// cevap, API'ye doğrudan istek atarak seviye açmanın kapısıydı). Testlerde
// ad-hoc üretilen kelimeler bu yardımcıyla havuza sokulur — gerçek kullanıcının
// yolu da budur, kelime derse girmeden cevaplanamaz.
const havuzaEkleId = async (userId, wordIds) => {
    const { startOfDayInTz } = require('../utils/date.util');
    // Cevap ucu havuzu kullanıcının activeLevel'ından arar; havuz da o seviyede olmalı
    const user = await User.findById(userId).select('activeLevel timezone');
    const jlptLevel = user?.activeLevel || 'N5';
    const date = startOfDayInTz(user?.timezone);
    let pool = await DailyWordPool.findOne({ user: userId, date, jlptLevel, poolNo: 1 });
    if (!pool) {
        pool = await DailyWordPool.create({
            user: userId, date, jlptLevel,
            poolNo: 1, newWordIds: [], reviewWordIds: [], targetGoal: 20
        });
    }
    pool.newWordIds.push(...wordIds);
    await pool.save();
    return pool;
};

const havuzaEkle = async (email, wordIds) => {
    const user = await User.findOne({ email });
    return havuzaEkleId(user._id, wordIds);
};

const login = async (email) => {
    const res = await api('POST', '/auth/login', {
        body: { email, password: 'Testsifre123!', deviceName: 'test-suite' }
    });
    assert.equal(res.status, 200, 'login başarılı olmalı');
    return res.json;
};

before(async () => {
    mongod = await startMemoryServer();
    process.env.MONGO_URI = mongod.getUri('musubi-test');
    process.env.NODE_ENV = 'test';
    // Yüklemeler geçici dizine gitsin: app.js statik mount'u require anında
    // kurduğu için bu satır require'dan ÖNCE olmak zorunda
    uploadDir = path.join(os.tmpdir(), `musubi-uploads-${process.pid}-${Date.now()}`);
    process.env.UPLOAD_DIR = uploadDir;
    // Simülatör mount'u da require anında kurulur (bkz. app.js SIMULATOR_ENABLED)
    process.env.SIMULATOR_ENABLED = 'true';

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
    DailyWordPool = require('../models/DailyWordPool');
    sendEmail = require('../utils/sendEmail');
    UserWordService = require('../modules/userword/userword.service');
    NotificationService = require('../modules/notification/notification.service');
    ProgressService = require('../modules/progress/progress.service');
    StreakService = require('../modules/streak/streak.service');
    StudySessionService = require('../modules/studysession/studysession.service');
    AuthService = require('../modules/auth/auth.service');
    WordService = require('../modules/word/word.service');

    // Test kelime seti: 30 N5 + 50 N4 core kelime (quiz çeldiricileri için yeterli havuz)
    const words = [];
    for (let i = 0; i < 30; i++) {
        words.push({ kanji: `語五${i}`, romaji: `gon${i}`, meaning: `meaning n5 ${i}`, type: 'isim', jlptLevel: 'N5', isCore: true });
    }
    for (let i = 0; i < 50; i++) {
        words.push({ kanji: `語四${i}`, romaji: `gyon${i}`, meaning: `meaning n4 ${i}`, type: 'isim', jlptLevel: 'N4', isCore: true });
    }
    // Seviye tespit sınavı TEK denemede beş seviyeden soru soruyor (N3:8, N2:10,
    // N1:10) — üst seviyelerde de çeldiriciye yetecek havuz olmalı.
    // Kanji'leri bilerek "語" içermiyor: arama testleri "語" ile sayı sayıyor.
    // frequencyRank yüksek: müfredat sırası testleri kendi kelimelerini başta
    // görmeli, bu dolgu kelimeler arkaya düşsün.
    for (const [level, prefix, romaji] of [['N3', '参', 'sanx'], ['N2', '弐', 'nix'], ['N1', '壱', 'ichix']]) {
        for (let i = 0; i < 30; i++) {
            words.push({
                kanji: `${prefix}${i}`, romaji: `${romaji}${i}`,
                meaning: `meaning ${level.toLowerCase()} ${i}`,
                type: 'isim', jlptLevel: level, isCore: true, frequencyRank: 1000 + i
            });
        }
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
    if (uploadDir) await fs.rm(uploadDir, { recursive: true, force: true });
});

describe('Auth', () => {
    it('login hata ayrımı: yanlış şifre 401, bilinmeyen e-posta 404', async () => {
        await createVerifiedUser('auth@test.com');
        const res = await api('POST', '/auth/login', {
            body: { email: 'auth@test.com', password: 'yanlis-sifre' }
        });
        assert.equal(res.status, 401);
        assert.match(res.json.message, /Şifreniz yanlış/);

        // Enum koruması bilinçli olarak yalnızca forgot-password'de
        const unknown = await api('POST', '/auth/login', {
            body: { email: 'hicyok@test.com', password: 'Testsifre123!' }
        });
        assert.equal(unknown.status, 404);
        assert.match(unknown.json.message, /kayıtlı bir hesap yok/);
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

    it('şifre kuralları: yeni şifre belirlenen her kapıda büyük harf, rakam ve özel karakter aranır', async () => {
        const zayif = [
            ['kisa1A!', /çok kısa/],
            ['hepsikucuk123!', /büyük harf/],
            ['SadeceHarfler!', /büyük harf/],   // rakam yok → aynı birleşik mesaj
            ['OzelKarakterYok123', /özel karakter/]
        ];

        // Kapı 1: kayıt
        for (const [password, beklenen] of zayif) {
            const res = await api('POST', '/auth/register', {
                body: { name: 'A', surname: 'B', email: `zayif-${Date.now()}@test.com`, password }
            });
            assert.equal(res.status, 400, `${password} reddedilmeli`);
            assert.match(res.json.message, beklenen);
        }
        assert.equal(
            await User.countDocuments({ email: /^zayif-/ }), 0,
            'reddedilen kayıttan yetim kullanıcı kalmamalı'
        );

        // Kapı 2: şifre sıfırlama
        await createVerifiedUser('kural-reset@test.com');
        await api('POST', '/auth/forgot-password', { body: { email: 'kural-reset@test.com' } });
        const rp = await api('POST', '/auth/reset-password', {
            body: { token: lastResetToken(), password: 'ozelkarakteryok123' }
        });
        assert.equal(rp.status, 400);
        assert.match(rp.json.message, /büyük harf/);

        // Kapı 3: şifre değiştirme — eski şifre hatası kural hatasının ÖNÜNDE gelir
        const token = (await login('kural-reset@test.com')).accessToken;
        const yanlisEski = await api('PUT', '/auth/change-password', {
            token, body: { oldPassword: 'bambaska-sifre', newPassword: 'zayif' }
        });
        assert.equal(yanlisEski.status, 401, 'önce mevcut şifre doğrulanır');

        const cp = await api('PUT', '/auth/change-password', {
            token, body: { oldPassword: 'Testsifre123!', newPassword: 'zayifsifre' }
        });
        assert.equal(cp.status, 400);
        assert.match(cp.json.message, /büyük harf/);

        // Kural öncesi açılmış zayıf şifreli hesap giriş yapmaya DEVAM eder.
        // Böyle bir hesabı YAZMAK artık validasyondan açık muafiyet ister —
        // kural veri katmanında da uygulanıyor (migration/import için kaçış yolu)
        const eski = new User({
            name: 'Test', surname: 'User', email: 'eski-zayif@test.com',
            password: 'zayifsifre', isEmailVerified: true
        });
        await eski.save({ validateBeforeSave: false });

        const eskiLogin = await api('POST', '/auth/login', {
            body: { email: 'eski-zayif@test.com', password: 'zayifsifre' }
        });
        assert.equal(eskiLogin.status, 200, 'login kuralı BİLEREK uygulamaz');
    });

    it('şifre kuralları veri katmanında da uygulanır (servisi atlayan yollar için)', async () => {
        // Servis çağrılmadan doğrudan model üzerinden zayıf şifre yazılamaz
        await assert.rejects(
            User.create({ name: 'A', surname: 'B', email: 'model-zayif@test.com', password: 'hepsikucuk123' }),
            /büyük harf/
        );
        assert.equal(await User.countDocuments({ email: 'model-zayif@test.com' }), 0);

        // Kurala uyan şifre sorunsuz yazılır
        const ok = await User.create({
            name: 'A', surname: 'B', email: 'model-uygun@test.com', password: 'Kuralauyan1!'
        });
        assert.ok(ok._id);

        // KRİTİK: şifre select edilip ALAKASIZ bir sebeple kaydedilirse kural
        // bcrypt hash'ine karşı çalışmamalı (isModified koruması)
        const selected = await User.findById(ok._id).select('+password');
        selected.name = 'Değişti';
        await assert.doesNotReject(
            selected.save(),
            'hash yeniden doğrulanmamalı'
        );

        // Gerçek şifre değişimi ise hâlâ denetlenir
        selected.password = 'yinehepsikucuk123';
        await assert.rejects(selected.save(), /büyük harf/);
    });

    it('register onboarding seçimlerini kabul eder: günlük hedef, hatırlatma saati, timezone', async () => {
        const email = `onboarding-${Date.now()}@test.com`;
        const res = await api('POST', '/auth/register', {
            body: {
                name: 'Emir', surname: 'Soylu', email, password: 'Emechar1905!',
                dailyGoal: 40, reminderTime: '14:30', timezone: 'Europe/Berlin'
            }
        });
        assert.equal(res.status, 201);

        const user = await User.findOne({ email });
        assert.equal(user.dailyGoal, 40);
        assert.equal(user.notificationSettings.reminderTime, '14:30');
        assert.equal(user.timezone, 'Europe/Berlin');
        assert.equal(user.notificationSettings.streakReminder, true,
            'tek alan verilince diğer bildirim tercihleri varsayılanda kalmalı');
    });

    it('"Şimdilik Geç": hatırlatma kapatılır, saat varsayılanda kalır', async () => {
        const email = `gec-${Date.now()}@test.com`;
        const res = await api('POST', '/auth/register', {
            body: { name: 'A', surname: 'B', email, password: 'Emechar1905!', dailyReminder: false }
        });
        assert.equal(res.status, 201);

        const user = await User.findOne({ email });
        assert.equal(user.notificationSettings.dailyReminder, false);
        assert.equal(user.notificationSettings.reminderTime, '10:00');
    });

    it('geçersiz hatırlatma saati 400 döner', async () => {
        const res = await api('PUT', '/auth/update-info', {
            token: (await login('auth@test.com')).accessToken,
            body: { notificationSettings: { reminderTime: '25:00' } }
        });
        assert.equal(res.status, 400);
    });

    it('Bildirim Ayarları: tek alan güncellenir, kardeş tercihler korunur', async () => {
        const user = await createVerifiedUser('bildirim-ayar@test.com');
        const token = (await login('bildirim-ayar@test.com')).accessToken;

        // Önce bir kardeş alanı varsayılandan farklılaştır
        await api('PUT', '/auth/update-info', {
            token, body: { notificationSettings: { streakReminder: false } }
        });

        // Sonra yalnız saati değiştir — kardeşi ezmemeli
        const res = await api('PUT', '/auth/update-info', {
            token, body: { notificationSettings: { reminderTime: '21:15' } }
        });
        assert.equal(res.status, 200);

        const fresh = await User.findById(user._id);
        assert.equal(fresh.notificationSettings.reminderTime, '21:15');
        assert.equal(fresh.notificationSettings.streakReminder, false, 'önceki değişiklik korunmalı');
        assert.equal(fresh.notificationSettings.dailyReminder, true, 'dokunulmayan varsayılan korunmalı');
        assert.equal(fresh.notificationSettings.dailyWord, true);
        assert.equal(fresh.notificationSettings.wordLevelDown, true);

        // Ayarlar ekranı anahtarların açık/kapalı halini /auth/me'den okuyor:
        // dailyWord yanıtta görünmezse yeni satır boş açılırdı
        const me = await api('GET', '/auth/me', { token });
        assert.equal(me.json.data.notificationSettings.dailyWord, true);
    });

    it('hesap bazlı giriş kilidi: 5 hatalı denemeden sonra kilitlenir, doğru şifre bile geçmez', async () => {
        await createVerifiedUser('kilit@test.com');

        // İlk 4 hata: normal 401
        for (let i = 0; i < 4; i++) {
            const res = await api('POST', '/auth/login', {
                body: { email: 'kilit@test.com', password: 'YanlisSifre1!' }
            });
            assert.equal(res.status, 401, `${i + 1}. deneme henüz kilitlememeli`);
        }

        // 5. hata eşiği geçer → kilit
        const besinci = await api('POST', '/auth/login', {
            body: { email: 'kilit@test.com', password: 'YanlisSifre1!' }
        });
        assert.equal(besinci.status, 429);
        assert.match(besinci.json.message, /hatalı giriş/);

        // Kilitliyken DOĞRU şifre de geçmemeli — yoksa kilit anlamsız olurdu
        const dogruSifre = await api('POST', '/auth/login', {
            body: { email: 'kilit@test.com', password: 'Testsifre123!' }
        });
        assert.equal(dogruSifre.status, 429, 'kilit doğru şifreyi de reddetmeli');

        // Kilit süresi dolunca giriş çalışır ve sayaç sıfırlanır
        await User.updateOne({ email: 'kilit@test.com' },
            { 'loginThrottle.lockedUntil': new Date(Date.now() - 1000) });
        const sonra = await api('POST', '/auth/login', {
            body: { email: 'kilit@test.com', password: 'Testsifre123!', deviceName: 'test-suite' }
        });
        assert.equal(sonra.status, 200);

        const user = await User.findOne({ email: 'kilit@test.com' });
        assert.equal(user.loginThrottle.failureCount, 0, 'başarılı giriş sayacı sıfırlamalı');
        assert.equal(user.loginThrottle.lockedUntil, undefined);
    });

    it('giriş kilidi: sosyal hesap uyarısı ve bilinmeyen adres sayaca işlenmez', async () => {
        // Şifresiz sosyal hesaba yapılan denemeler şifre denemesi değildir
        const sosyal = await User.create({
            name: 'S', surname: 'T', email: 'kilit-sosyal@test.com',
            provider: 'google', providerId: 'kilit-google-1', isEmailVerified: true
        });
        for (let i = 0; i < 6; i++) {
            const res = await api('POST', '/auth/login', {
                body: { email: 'kilit-sosyal@test.com', password: 'Herhangi1!' }
            });
            assert.equal(res.status, 400, 'sosyal hesap yönlendirmesi 400 kalmalı, kilide dönüşmemeli');
        }
        const fresh = await User.findById(sosyal._id);
        assert.ok(!fresh.loginThrottle?.failureCount, 'sosyal uyarı sayaca işlenmemeli');
    });

    it('giriş kilidi: şifre sıfırlama kilidi kaldırır (çıkmaza girilmemeli)', async () => {
        await createVerifiedUser('kilit-reset@test.com');
        for (let i = 0; i < 5; i++) {
            await api('POST', '/auth/login', {
                body: { email: 'kilit-reset@test.com', password: 'YanlisSifre1!' }
            });
        }
        const kilitli = await api('POST', '/auth/login', {
            body: { email: 'kilit-reset@test.com', password: 'Testsifre123!' }
        });
        assert.equal(kilitli.status, 429);

        await api('POST', '/auth/forgot-password', { body: { email: 'kilit-reset@test.com' } });
        const rp = await api('POST', '/auth/reset-password', {
            body: { token: lastResetToken(), password: 'Yepyeni1Sifre!' }
        });
        assert.equal(rp.status, 200);

        // Sıfırlamadan hemen sonra giriş çalışmalı
        const giris = await api('POST', '/auth/login', {
            body: { email: 'kilit-reset@test.com', password: 'Yepyeni1Sifre!', deviceName: 'test-suite' }
        });
        assert.equal(giris.status, 200, 'sıfırlama sonrası kilit kalkmalı');
    });

    it('verification-status: doğrulama bekleme ekranı durumu 200 ile okur, 403 ile değil', async () => {
        const email = `durum-${Date.now()}@test.com`;
        const reg = await api('POST', '/auth/register', {
            body: { name: 'A', surname: 'B', email, password: 'Emechar1905!', deviceName: 'test-suite' }
        });
        const token = reg.json.accessToken;

        // Doğrulanmadan önce: 200 + false (403 DEĞİL — durum sinyali hata kodu olmamalı)
        const once = await api('GET', '/auth/verification-status', { token });
        assert.equal(once.status, 200, 'doğrulanmamış kullanıcı da bu ucu okuyabilmeli');
        assert.equal(once.json.data.isEmailVerified, false);
        assert.equal(once.json.data.email, email, 'ekranda gösterilecek adres');

        // Aynı token'la /auth/me hâlâ 403 — bu uç onun yerine geçmiyor
        const me = await api('GET', '/auth/me', { token });
        assert.equal(me.status, 403);

        // Kullanıcı web'den doğrular (deviceName yok → oturum açılmaz)
        await api('POST', '/auth/verify-email', { body: { token: lastVerificationToken() } });

        // Uygulamadaki buton aynı token'la tekrar sorar → artık true
        const sonra = await api('GET', '/auth/verification-status', { token });
        assert.equal(sonra.json.data.isEmailVerified, true);

        // Ve mevcut token'la doğrudan içeri girebilmeli — yeniden giriş gerekmez
        const meSonra = await api('GET', '/auth/me', { token });
        assert.equal(meSonra.status, 200, 'kayıt token\'ı doğrulama sonrası çalışmalı');
    });

    it('KVKK: rıza kaydı hesap açılışında yazılır, ispat için bağlam saklanır', async () => {
        const { CURRENT_CONSENT_VERSIONS } = require('../config/consents');
        const email = `riza-${Date.now()}@test.com`;

        const res = await api('POST', '/auth/register', {
            body: { name: 'A', surname: 'B', email, password: 'Emechar1905!' }
        });
        assert.equal(res.status, 201);

        const user = await User.findOne({ email });
        assert.equal(user.consents.terms, CURRENT_CONSENT_VERSIONS.terms);
        assert.equal(user.consents.privacy, CURRENT_CONSENT_VERSIONS.privacy);
        assert.equal(user.consents.kvkk, CURRENT_CONSENT_VERSIONS.kvkk);
        assert.ok(user.consents.acceptedAt, 'rıza zamanı kaydedilmeli');
        assert.ok(user.consents.ip, 'ispat için IP kaydedilmeli');
    });

    it('KVKK: güncel olmayan sürüm gönderen istemcinin kaydı reddedilir', async () => {
        const email = `eskisurum-${Date.now()}@test.com`;
        const res = await api('POST', '/auth/register', {
            body: {
                name: 'A', surname: 'B', email, password: 'Emechar1905!',
                consents: { terms: '0.9', privacy: '1.0', kvkk: '1.0' }
            }
        });
        assert.equal(res.status, 400, 'kullanıcının görmediği metne rıza kaydedilemez');
        assert.match(res.json.message, /güncel değil/);
        assert.equal(await User.countDocuments({ email }), 0, 'rızasız hesap oluşmamalı');
    });

    it('KVKK: sürüm değişince yeniden rıza gerekir ve kaydedilebilir', async () => {
        const consentsConfig = require('../config/consents');
        const email = `yeniden-${Date.now()}@test.com`;
        await api('POST', '/auth/register', {
            body: { name: 'A', surname: 'B', email, password: 'Emechar1905!' }
        });
        await User.updateOne({ email }, { isEmailVerified: true });
        const token = (await api('POST', '/auth/login', {
            body: { email, password: 'Emechar1905!', deviceName: 'test-suite' }
        })).json.accessToken;

        // Başlangıçta güncel
        const before = await api('GET', '/auth/consents', { token });
        assert.equal(before.json.data.reconsentRequired, false);

        // Gizlilik politikası sürümü yükseltilir
        const original = consentsConfig.CURRENT_CONSENT_VERSIONS.privacy;
        consentsConfig.CURRENT_CONSENT_VERSIONS.privacy = '2.0';
        try {
            const after = await api('GET', '/auth/consents', { token });
            assert.equal(after.json.data.reconsentRequired, true);
            assert.deepEqual(after.json.data.outdated, ['privacy'], 'yalnız değişen metin listelenmeli');

            const accept = await api('PUT', '/auth/consents', {
                token, body: { consents: { privacy: '2.0' } }
            });
            assert.equal(accept.status, 200);

            const done = await api('GET', '/auth/consents', { token });
            assert.equal(done.json.data.reconsentRequired, false);
            assert.equal(done.json.data.accepted.privacy, '2.0');
        } finally {
            consentsConfig.CURRENT_CONSENT_VERSIONS.privacy = original;
        }
    });

    it('KVKK: oturumsuz da güncel sürümler okunabilir (giriş ekranı)', async () => {
        const res = await api('GET', '/auth/consents');
        assert.equal(res.status, 200);
        assert.ok(res.json.data.current.kvkk, 'güncel sürümler oturumsuz dönmeli');
        assert.equal(res.json.data.accepted, undefined, 'oturumsuz istekte kullanıcı verisi dönmemeli');

        // Karşılama ekranı metin linklerini buradan kurar
        const kvkk = res.json.data.docs.find(d => d.key === 'kvkk');
        assert.equal(kvkk.url, '/legal/kvkk');
        assert.equal(kvkk.version, res.json.data.current.kvkk,
            'listedeki sürüm, rıza karşılaştırmasındaki sürümle aynı olmalı');
        assert.ok(kvkk.title && kvkk.effectiveDate);
    });

    it('doğrulanmamış kullanıcı hiçbir feature modülüne giremez (mount seviyesi koruma)', async () => {
        const email = `korumasiz-${Date.now()}@test.com`;
        const reg = await api('POST', '/auth/register', {
            body: { name: 'A', surname: 'B', email, password: 'Emechar1905!', deviceName: 'test-suite' }
        });
        const token = reg.json.accessToken;

        // app.js'te requireVerifiedUser ile mount edilen HER prefix burada olmalı.
        // Yeni bir modül eklenip listeye yazılmazsa bu test onu yakalamaz —
        // ama mount seviyesindeki koruma sayesinde yeni modül zaten korumalı doğar.
        const korumali = [
            ['GET', '/words'], ['GET', '/words/search?q=a'],
            ['GET', '/userwords/stats'], ['GET', '/userwords/list'],
            ['GET', '/sessions/today'], ['GET', '/sessions/history'],
            ['GET', '/progress'],
            ['GET', '/streak'],
            ['GET', '/home/summary'],
            ['GET', '/notifications'],
            ['GET', '/quiz/status']
        ];

        for (const [method, path] of korumali) {
            const res = await api(method, path, { token });
            assert.equal(res.status, 403, `${method} ${path} doğrulanmamış kullanıcıya 403 dönmeli`);
        }

        // Tokensiz istek 401 (protect), doğrulanmamış token 403 (isEmailVerified)
        const anon = await api('GET', '/home/summary');
        assert.equal(anon.status, 401, 'tokensiz istek 401 olmalı');
    });

    it('e-posta büyük/küçük harf ve boşluktan bağımsız tek hesaptır', async () => {
        const res = await api('POST', '/auth/register', {
            body: { name: 'Emir', surname: 'S', email: '  Emir@Gmail.COM ', password: 'Emechar1905!' }
        });
        assert.equal(res.status, 201);

        // Depolanan değer normalize edilmiş olmalı
        assert.ok(await User.findOne({ email: 'emir@gmail.com' }), 'küçük harfle saklanmalı');

        // check-email aynı adresi farklı yazımla "müsait" göstermemeli
        const check = await api('POST', '/auth/check-email', { body: { email: 'EMIR@GMAIL.COM' } });
        assert.equal(check.json.available, false, 'farklı yazım ikinci hesap açmamalı');

        // Login farklı yazımla çalışmalı (asıl kullanıcı acısı buydu)
        const upper = await api('POST', '/auth/login', {
            body: { email: 'Emir@Gmail.com', password: 'Emechar1905!' }
        });
        assert.equal(upper.status, 200, 'büyük harfli giriş de aynı hesabı bulmalı');

        // Şifre sıfırlama da aynı hesabı bulmalı
        const fp = await api('POST', '/auth/forgot-password', { body: { email: 'EMIR@gmail.com' } });
        assert.equal(fp.status, 200);
    });

    it('ad-soyad kırpılır; yalnız boşluktan oluşan ve aşırı uzun isim reddedilir', async () => {
        const ok = await api('POST', '/auth/register', {
            body: { name: '  Emirhan  ', surname: '  Soylu ', email: `kirp-${Date.now()}@test.com`, password: 'Emechar1905!' }
        });
        assert.equal(ok.status, 201);
        assert.equal(ok.json.data.name, 'Emirhan', 'baştaki/sondaki boşluk kırpılmalı');

        const bosluk = await api('POST', '/auth/register', {
            body: { name: '   ', surname: 'S', email: `bos-${Date.now()}@test.com`, password: 'Emechar1905!' }
        });
        assert.equal(bosluk.status, 400, 'yalnız boşluktan oluşan isim required\'ı geçmemeli');

        const uzun = await api('POST', '/auth/register', {
            body: { name: 'A'.repeat(51), surname: 'S', email: `uzun-${Date.now()}@test.com`, password: 'Emechar1905!' }
        });
        assert.equal(uzun.status, 400, '50 karakteri aşan isim reddedilmeli');
    });

    it('mail bombardımanı: aynı adrese arka arkaya doğrulama maili gönderilemez', async () => {
        const email = `bombardiman-${Date.now()}@test.com`;
        await api('POST', '/auth/register', { body: { name: 'A', surname: 'B', email, password: 'Emechar1905!' } });

        // Kayıt maili de sayaca girer; ilk "Tekrar Gönder" ancak cooldown
        // dolunca çalışır (mobilde bu buton geri sayım göstermeli)
        const erken = await api('POST', '/auth/resend-verification-email', { body: { email } });
        assert.equal(erken.status, 429, 'kayıttan hemen sonra tekrar gönderim engellenmeli');

        await expireMailCooldown(email);
        const ilk = await api('POST', '/auth/resend-verification-email', { body: { email } });
        assert.equal(ilk.status, 200);

        const outLen = sendEmail.outbox.length;
        const ikinci = await api('POST', '/auth/resend-verification-email', { body: { email } });
        assert.equal(ikinci.status, 429, 'cooldown dolmadan ikinci mail gönderilmemeli');
        assert.equal(sendEmail.outbox.length, outLen, 'engellenen istek mail ATMAMALI');

        // Kısıt IP'de değil hesapta tutulduğu için sayaç kullanıcıda görünür
        const user = await User.findOne({ email });
        assert.ok(user.mailThrottle.verification.lastSentAt);
        assert.equal(user.mailThrottle.verification.dayCount, 2, 'register + resend');
    });

    it('doğrulanmamış hesap 7 gün sonra yan kayıtlarıyla temizlenir, adres yeniden kayda açılır', async () => {
        const email = `cop-${Date.now()}@test.com`;
        await api('POST', '/auth/register', { body: { name: 'A', surname: 'B', email, password: 'Emechar1905!' } });
        const user = await User.findOne({ email });
        assert.equal(await Progress.countDocuments({ user: user._id }), 5);

        // Henüz taze — temizlik dokunmamalı
        await AuthService.purgeUnverifiedAccounts();
        assert.ok(await User.findById(user._id), 'yeni hesap silinmemeli');

        // 8 gün öncesine çek
        await User.updateOne({ _id: user._id }, { createdAt: new Date(Date.now() - 8 * 86400000) });
        const { purged } = await AuthService.purgeUnverifiedAccounts();
        assert.ok(purged >= 1);

        assert.equal(await User.findById(user._id), null, 'hesap silinmeli');
        assert.equal(await Progress.countDocuments({ user: user._id }), 0, 'yan kayıtlar da silinmeli');
        assert.equal(await Streak.countDocuments({ user: user._id }), 0);
        assert.equal(await DeviceSession.countDocuments({ user: user._id }), 0);

        // Squat edilmiş adres yeniden kullanılabilir olmalı
        const tekrar = await api('POST', '/auth/register', {
            body: { name: 'C', surname: 'D', email, password: 'Emechar1905!' }
        });
        assert.equal(tekrar.status, 201, 'temizlenen adres yeniden kayda açılmalı');
    });

    it('doğrulanmış hesap temizlikten etkilenmez', async () => {
        const user = await createVerifiedUser('kalici@test.com');
        await User.updateOne({ _id: user._id }, { createdAt: new Date(Date.now() - 90 * 86400000) });
        await AuthService.purgeUnverifiedAccounts();
        assert.ok(await User.findById(user._id), 'doğrulanmış hesap asla silinmemeli');
    });

    it('oturum kaydının ömrü refresh token\'ın kendi exp claim\'inden gelir', async () => {
        const user = await createVerifiedUser('ttl@test.com');
        const tokens = await login('ttl@test.com');

        const session = await DeviceSession.findOne({ user: user._id });
        const { exp } = require('jsonwebtoken').decode(tokens.refreshToken);

        assert.ok(session.expiresAt, 'expiresAt set edilmeli (TTL index bu alanda)');
        assert.equal(
            session.expiresAt.getTime(), exp * 1000,
            'kayıt ile token TAM olarak aynı anda ölmeli — JWT_REFRESH_EXPIRE değişince TTL kendiliğinden uymalı'
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

    // Access token 15 dakikada ölüyor. Uç protect altındayken süresi dolmuş
    // token'la gelen çıkış isteği 401 alıyordu: kullanıcı "çıkış yaptım"
    // sanıyor, oysa DeviceSession ve refresh token ayakta kalıyordu.
    it('süresi dolmuş access token çıkışı engellemez, o cihazın oturumu düşer', async () => {
        const jwt = require('jsonwebtoken');
        const user = await createVerifiedUser('cikis@test.com');
        const tokens = await login('cikis@test.com');
        const expired = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '-1s' });

        const korumali = await api('GET', '/auth/me', { token: expired });
        assert.equal(korumali.status, 401, 'token gerçekten süresi dolmuş olmalı');

        const out = await api('POST', '/auth/logout', {
            token: expired,
            body: { refreshToken: tokens.refreshToken }
        });
        assert.equal(out.status, 200);

        const sonra = await api('POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken } });
        assert.equal(sonra.status, 401, 'oturum gerçekten kapanmalı');
    });

    it('access token hiç olmadan da refreshToken ile çıkılır; ikisi de yoksa 401', async () => {
        await createVerifiedUser('cikis2@test.com');
        const tokens = await login('cikis2@test.com');

        const out = await api('POST', '/auth/logout', { body: { refreshToken: tokens.refreshToken } });
        assert.equal(out.status, 200);
        assert.equal(
            await DeviceSession.countDocuments({ user: tokens.data.id }), 0,
            'oturum kaydı silinmeli'
        );

        // Kapatılacak oturum belirlenemiyorsa sessizce 200 dönmek yanıltıcı olur
        const bos = await api('POST', '/auth/logout', { body: {} });
        assert.equal(bos.status, 401);
    });

    // Ortak kullanılan bir telefonda çıkış yapan kullanıcının push token'ı
    // hesabında kalırsa bildirimler bir sonraki kişinin eline gider.
    it('çıkış push token\'ını da düşürür; DELETE /auth/fcm-token elle temizler', async () => {
        const user = await createVerifiedUser('push@test.com');
        const tokens = await login('push@test.com');
        const storedToken = async () =>
            (await User.findById(user._id).select('+fcmToken')).fcmToken;

        await api('PUT', '/auth/update-info', {
            token: tokens.accessToken, body: { fcmToken: 'cihaz-token-1' }
        });
        assert.equal(await storedToken(), 'cihaz-token-1');

        // OS'ten bildirim izni kapatılınca istemci bunu çağırır
        const del = await api('DELETE', '/auth/fcm-token', { token: tokens.accessToken });
        assert.equal(del.status, 200);
        assert.equal(await storedToken(), undefined, 'token silinmeli');

        await api('PUT', '/auth/update-info', {
            token: tokens.accessToken, body: { fcmToken: 'cihaz-token-2' }
        });
        await api('POST', '/auth/logout', {
            token: tokens.accessToken, body: { refreshToken: tokens.refreshToken }
        });
        assert.equal(await storedToken(), undefined, 'çıkışta da temizlenmeli');
    });

    it('geçerli access token + gövdesiz çıkış TÜM cihazları düşürür', async () => {
        await createVerifiedUser('cikis3@test.com');
        const devA = await login('cikis3@test.com');
        const devB = await login('cikis3@test.com');

        const out = await api('POST', '/auth/logout', { token: devA.accessToken });
        assert.equal(out.status, 200);

        for (const dev of [devA, devB]) {
            const r = await api('POST', '/auth/refresh', { body: { refreshToken: dev.refreshToken } });
            assert.equal(r.status, 401, 'her iki cihazın oturumu da kapanmalı');
        }
    });

    it('şifre değişimi tüm eski oturumları düşürür, taze çift döner', async () => {
        const devA = await login('auth@test.com');
        const devB = await login('auth@test.com');

        const cp = await api('PUT', '/auth/change-password', {
            token: devA.accessToken,
            body: { oldPassword: 'Testsifre123!', newPassword: 'Yepyenisifre123!', deviceName: 'test-suite' }
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
        body: { name, surname: 'Test', email, password: 'Testsifre123!', deviceName: 'test-suite' }
    });

    it('register doğrulama maili gönderir; maildeki token e-postayı doğrular', async () => {
        const res = await api('POST', '/auth/register', registerBody('posta@test.com'));
        assert.equal(res.status, 201);
        assert.ok(res.json.accessToken && res.json.refreshToken);
        assert.equal(res.json.verificationToken, undefined,
            'doğrulama token\'ı hiçbir ortamda yanıtta dönmemeli');

        const mail = sendEmail.outbox.at(-1);
        assert.equal(mail.to, 'posta@test.com');
        assert.match(mail.subject, /Musubi - E-posta Doğrulama/);
        const verificationToken = lastVerificationToken();

        // Yan kayıtlar oluşmuş olmalı
        const user = await User.findOne({ email: 'posta@test.com' });
        assert.equal(await Progress.countDocuments({ user: user._id }), 5);
        assert.equal(await Streak.countDocuments({ user: user._id }), 1);

        // Doğrulanmadan ✉️ endpoint 403
        const me = await api('GET', '/auth/me', { token: res.json.accessToken });
        assert.equal(me.status, 403);

        const verify = await api('GET', `/auth/verify-email/${verificationToken}`);
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

    it('resend-verification: bilinmeyen adres 404, doğrulanmış 400, bilinene yeni token gider', async () => {
        const outLenBefore = sendEmail.outbox.length;
        const unknown = await api('POST', '/auth/resend-verification-email', { body: { email: 'yok@test.com' } });
        assert.equal(unknown.status, 404, 'yazım hatası kullanıcıya söylenir (enum koruması yalnızca forgot-password)');
        assert.equal(sendEmail.outbox.length, outLenBefore, 'bilinmeyen adrese mail atılmamalı');

        await createVerifiedUser('zatendogru@test.com');
        const verified = await api('POST', '/auth/resend-verification-email', { body: { email: 'zatendogru@test.com' } });
        assert.equal(verified.status, 400, 'zaten doğrulanmışa tekrar mail atılmaz');

        await api('POST', '/auth/register', registerBody('tekrar@test.com'));
        await expireMailCooldown('tekrar@test.com'); // kayıt maili sayaca girdi
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

        // Enumeration politikası: her uçta dürüst cevap (check-email zaten
        // hesap varlığını söylüyor; gizlemek sıfır kazanç, UX kaybıydı)
        const outLen = sendEmail.outbox.length;
        const unknown = await api('POST', '/auth/forgot-password', { body: { email: 'hicyok@test.com' } });
        assert.equal(unknown.status, 404, 'bilinmeyen adres dürüstçe söylenir');
        assert.equal(sendEmail.outbox.length, outLen, 'bilinmeyen adrese mail atılmamalı');

        const fp = await api('POST', '/auth/forgot-password', { body: { email: 'sifirla@test.com' } });
        assert.equal(fp.status, 200);
        assert.equal(fp.json.resetToken, undefined, 'sıfırlama token\'ı yanıtta dönmemeli');

        const mail = sendEmail.outbox.at(-1);
        assert.equal(mail.to, 'sifirla@test.com');
        assert.match(mail.subject, /Şifre Sıfırlama/);
        const resetToken = lastResetToken();

        const rp = await api('POST', '/auth/reset-password', {
            body: { token: resetToken, password: 'Yenisifre123!', deviceName: 'test-suite' }
        });
        assert.equal(rp.status, 200);
        assert.ok(rp.json.data.accessToken && rp.json.data.refreshToken);

        // Aynı token ikinci kez kullanılamaz
        const replay = await api('POST', '/auth/reset-password', {
            body: { token: resetToken, password: 'Baskasifre123!' }
        });
        assert.equal(replay.status, 400);

        const oldRefresh = await api('POST', '/auth/refresh', { body: { refreshToken: oldDevice.refreshToken } });
        assert.equal(oldRefresh.status, 401, 'eski cihazın oturumu düşmeli');

        const oldLogin = await api('POST', '/auth/login', {
            body: { email: 'sifirla@test.com', password: 'Testsifre123!' }
        });
        assert.equal(oldLogin.status, 401, 'eski şifre çalışmamalı');

        const newLogin = await api('POST', '/auth/login', {
            body: { email: 'sifirla@test.com', password: 'Yenisifre123!' }
        });
        assert.equal(newLogin.status, 200);
    });

    it('doğrulanmamış hesap da şifre sıfırlayabilir', async () => {
        await api('POST', '/auth/register', registerBody('dogrulanmamis@test.com'));
        const fp = await api('POST', '/auth/forgot-password', { body: { email: 'dogrulanmamis@test.com' } });
        assert.equal(fp.status, 200, 'doğrulanmamış hesaba 403 dönülmemeli — link sahipliği zaten kanıtlar');
        assert.ok(lastResetToken(), 'sıfırlama maili gitmeli');
    });

    it('yeni şifre eskisiyle aynı olamaz: change-password, reset-password ve update-info kapıları', async () => {
        await createVerifiedUser('aynisifre@test.com');
        const token = (await login('aynisifre@test.com')).accessToken;

        // change-password: eski === yeni → 400 (oturumlar sebepsiz düşürülmez)
        const cp = await api('PUT', '/auth/change-password', {
            token, body: { oldPassword: 'Testsifre123!', newPassword: 'Testsifre123!' }
        });
        assert.equal(cp.status, 400);
        assert.match(cp.json.message, /aynı olamaz/);

        // reset-password: eski şifre yazılmadan geldiği için hash'e karşı kontrol
        await api('POST', '/auth/forgot-password', { body: { email: 'aynisifre@test.com' } });
        const resetToken = lastResetToken();
        const rp = await api('POST', '/auth/reset-password', {
            body: { token: resetToken, password: 'Testsifre123!' }
        });
        assert.equal(rp.status, 400);
        assert.match(rp.json.message, /aynı olamaz/);

        // Aynı token farklı şifreyle hâlâ kullanılabilir (400 token'ı tüketmez)
        const rp2 = await api('POST', '/auth/reset-password', {
            body: { token: resetToken, password: 'Apayrisifre123!' }
        });
        assert.equal(rp2.status, 200);

        // update-info şifre kabul ETMEZ: eski şifre doğrulamasız + rotasyonsuz
        // değişim güvenlik açığıydı — tek kapı change/reset akışları
        const newToken = (await api('POST', '/auth/login', {
            body: { email: 'aynisifre@test.com', password: 'Apayrisifre123!', deviceName: 'test-suite' }
        })).json.accessToken;
        const upd = await api('PUT', '/auth/update-info', {
            token: newToken, body: { password: 'Baskabirsifre123!' }
        });
        assert.equal(upd.status, 400);

        const still = await api('POST', '/auth/login', {
            body: { email: 'aynisifre@test.com', password: 'Apayrisifre123!' }
        });
        assert.equal(still.status, 200, 'şifre update-info ile değişmemiş olmalı');
    });

    // HTML landing sayfaları /api dışında yaşar
    const pageGet = async (path) => {
        const res = await fetch(BASE.replace(/\/api$/, '') + path);
        return { status: res.status, text: await res.text() };
    };

    it('mail linkleri /api yerine landing sayfalarına gider', async () => {
        await api('POST', '/auth/register', registerBody('landing-mail@test.com'));
        const vMail = sendEmail.outbox.at(-1);
        assert.ok(vMail.html.includes(`/verify-email/${lastVerificationToken()}`));
        assert.ok(!vMail.html.includes('/api/auth/'), 'mail linki API endpointine gitmemeli');
        assert.ok(/<a href="[^"]*verify-email/.test(vMail.html), 'link <a href> içinde olmalı');

        await api('POST', '/auth/forgot-password', { body: { email: 'landing-mail@test.com' } });
        const rMail = sendEmail.outbox.at(-1);
        assert.ok(rMail.html.includes(`/reset-password/${lastResetToken()}`));
        assert.ok(!rMail.html.includes('/api/auth/'));
    });

    it('landing sayfaları TR/EN: ?lang, Accept-Language ve dil bağlantısı', async () => {
        await api('POST', '/auth/register', registerBody('dil@test.com'));
        const token = lastVerificationToken();

        const tr = await pageGet(`/verify-email/${token}`);
        assert.ok(tr.text.includes('E-postanı Doğrula'), 'varsayılan TR olmalı');
        assert.ok(tr.text.includes('lang="tr"'));
        assert.ok(tr.text.includes('>Türkçe<') === false && tr.text.includes('>English<'),
            'TR sayfada karşı dilin etiketi (English) gösterilmeli');

        const en = await pageGet(`/verify-email/${token}?lang=en`);
        assert.ok(en.text.includes('Verify Your Email'), '?lang=en İngilizce açmalı');
        assert.ok(en.text.includes('lang="en"'));
        assert.ok(en.text.includes('>Türkçe<'), 'EN sayfada Türkçe bağlantısı olmalı');

        // Bilinmeyen dil sessizce varsayılana düşer
        const bogus = await pageGet(`/verify-email/${token}?lang=zz`);
        assert.ok(bogus.text.includes('E-postanı Doğrula'));

        // Geçersiz link sayfası da çevrilir
        const invalidEn = await pageGet(`/verify-email/${'0'.repeat(40)}?lang=en`);
        assert.ok(invalidEn.text.includes('Invalid Link'));
    });

    it('landing: e-posta maskeli gösterilir, açık adres sayfada geçmez', async () => {
        await api('POST', '/auth/register', registerBody('maskeleme@test.com'));
        const page = await pageGet(`/verify-email/${lastVerificationToken()}`);
        assert.ok(page.text.includes('mas***@test.com'), 'maskeli adres görünmeli');
        assert.ok(!page.text.includes('maskeleme@test.com'), 'açık adres sayfada olmamalı');
    });

    it('mail dili kullanıcının tercihini izler ve link aynı dili taşır', async () => {
        await createVerifiedUser('ingilizce@test.com', { preferences: { language: 'en' } });
        await api('POST', '/auth/forgot-password', { body: { email: 'ingilizce@test.com' } });

        const mail = sendEmail.outbox.at(-1);
        assert.match(mail.subject, /Password Reset/, 'konu İngilizce olmalı');
        assert.ok(mail.html.includes('Reset My Password'), 'buton İngilizce olmalı');
        assert.ok(mail.html.includes('?lang=en'),
            'link dili taşımalı — mail İngilizce, açılan sayfa Türkçe olmasın');

        // Tercihi olmayan kullanıcı Türkçe alır
        await createVerifiedUser('turkce@test.com');
        await api('POST', '/auth/forgot-password', { body: { email: 'turkce@test.com' } });
        const trMail = sendEmail.outbox.at(-1);
        assert.match(trMail.subject, /Şifre Sıfırlama/);
        assert.ok(trMail.html.includes('?lang=tr'));
    });

    it('register cihaz dilini kabul eder; marka logosu her ortamda servis edilir', async () => {
        const email = `dilkayit-${Date.now()}@test.com`;
        await api('POST', '/auth/register', {
            body: { name: 'A', surname: 'B', email, password: 'Emechar1905!', language: 'en' }
        });
        const user = await User.findOne({ email });
        assert.equal(user.preferences.language, 'en');
        assert.match(sendEmail.outbox.at(-1).subject, /Verify Your Email/,
            'kayıt maili de seçilen dilde gitmeli');

        // Logo public/ altında değil: production'da da servis edilmeli
        const res = await fetch(BASE.replace(/\/api$/, '') + '/assets/musubi-logo.png');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /image\/png/);
    });

    it('verify landing: geçerli tokende doğrulama butonu, geçersizde hata sayfası; sayfa yan etkisizdir', async () => {
        await api('POST', '/auth/register', registerBody('landing-verify@test.com'));
        const token = lastVerificationToken();

        const page = await pageGet(`/verify-email/${token}`);
        assert.equal(page.status, 200);
        assert.ok(page.text.includes('verify-btn'), 'doğrulama butonu olmalı');
        assert.ok(!page.text.includes('musubi://'), 'ürün kararı: deep link YOK, doğrulama webde biter');

        // Sayfayı açmak (scanner prefetch senaryosu) doğrulamaz
        const user = await User.findOne({ email: 'landing-verify@test.com' });
        assert.equal(user.isEmailVerified, false, 'GET sayfası doğrulama YAPMAMALI');

        const bogus = await pageGet(`/verify-email/${'0'.repeat(40)}`);
        assert.ok(bogus.text.includes('Bağlantı Geçersiz'));

        const malformed = await pageGet('/verify-email/' + encodeURIComponent('<script>alert(1)</script>'));
        assert.ok(malformed.text.includes('Bağlantı Geçersiz'), 'bozuk biçimli token DB\'ye sorulmadan reddedilir');
        assert.ok(!malformed.text.includes('<script>alert'), 'token sayfaya kaçışsız gömülmemeli');
    });

    // Başarı dalı chip'i ve butonu .hidden ile gizliyor. Bu iki eleman
    // .mail-chip / .stack sınıflarını taşıyor ve o kurallar BASE_CSS'ten SONRA
    // ekleniyor — aynı özgüllükte olduğu için düz `display:none` eziliyordu:
    // doğrulama başarılı olduğu hâlde buton ekranda kalıp sonsuza dek dönüyordu.
    it('landing: .hidden sayfaya özel display kurallarını yener', async () => {
        await api('POST', '/auth/register', registerBody('gizleme@test.com'));
        const page = await pageGet(`/verify-email/${lastVerificationToken()}`);

        assert.ok(page.text.includes('.hidden{display:none!important}'),
            '.hidden !important olmadan .stack/.mail-chip tarafından eziliyor');
        assert.ok(/\.stack\{[^}]*display:flex/.test(page.text),
            'ezen kural hâlâ burada — kalkarsa bu testin koruduğu şey de değişmiş demektir');
    });

    it('POST /auth/verify-email: deviceName yoksa oturum/token üretmez, varsa taze çift döner', async () => {
        const reg = await api('POST', '/auth/register', registerBody('post-verify@test.com'));
        const user = await User.findOne({ email: 'post-verify@test.com' });
        const sessionsBefore = await DeviceSession.countDocuments({ user: user._id });

        const web = await api('POST', '/auth/verify-email', { body: { token: lastVerificationToken() } });
        assert.equal(web.status, 200);
        assert.ok(!web.json.data.accessToken && !web.json.data.refreshToken, 'web doğrulamada token dönmemeli');
        assert.equal(await DeviceSession.countDocuments({ user: user._id }), sessionsBefore, 'web doğrulama oturum açmamalı');

        const me = await api('GET', '/auth/me', { token: reg.json.accessToken });
        assert.equal(me.status, 200, 'doğrulama yine de gerçekleşmeli');

        // deviceName ile: login sözleşmesi (uygulama akışı)
        const reg2 = await api('POST', '/auth/register', registerBody('post-verify2@test.com'));
        const app2 = await api('POST', '/auth/verify-email', {
            body: { token: lastVerificationToken(), deviceName: 'Pixel 8' }
        });
        assert.equal(app2.status, 200);
        assert.ok(app2.json.data.accessToken && app2.json.data.refreshToken, 'uygulama doğrulamasında taze çift dönmeli');

        const missing = await api('POST', '/auth/verify-email', { body: {} });
        assert.equal(missing.status, 400, 'tokensiz istek 400 dönmeli');
    });

    it('reset landing: form sayfası açılır; deviceName\'siz reset oturum açmadan tüm oturumları düşürür', async () => {
        await createVerifiedUser('landing-reset@test.com');
        await login('landing-reset@test.com');

        await api('POST', '/auth/forgot-password', { body: { email: 'landing-reset@test.com' } });
        const resetToken = lastResetToken();
        const page = await pageGet(`/reset-password/${resetToken}`);
        assert.equal(page.status, 200);
        assert.ok(!page.text.includes('musubi://'), 'ürün kararı: deep link YOK, sıfırlama webde biter');
        assert.ok(page.text.includes('id="reset-form"'), 'şifre formu doğrudan görünmeli (uygulama tasarımıyla aynı)');
        assert.ok(page.text.includes('id="p1"') && page.text.includes('id="p2"'), 'şifre ve tekrar alanları olmalı');
        assert.ok(page.text.includes('id="meter"'), 'güç göstergesi olmalı');
        // Hesabı maskeli göster: ekran görüntüsü paylaşılırsa adres açığa çıkmasın
        assert.ok(page.text.includes('***@test.com'), 'e-posta maskeli gösterilmeli');
        assert.ok(!page.text.includes('landing-reset@test.com'), 'açık adres sayfada olmamalı');

        const rp = await api('POST', '/auth/reset-password', {
            body: { token: resetToken, password: 'Websifre123!' }
        });
        assert.equal(rp.status, 200);
        assert.ok(!rp.json.data.accessToken, 'web resetinde token dönmemeli');

        const user = await User.findOne({ email: 'landing-reset@test.com' });
        assert.equal(await DeviceSession.countDocuments({ user: user._id }), 0, 'tüm oturumlar düşmeli, yenisi açılmamalı');

        const newLogin = await api('POST', '/auth/login', {
            body: { email: 'landing-reset@test.com', password: 'Websifre123!' }
        });
        assert.equal(newLogin.status, 200);

        // Kullanılmış token ile landing artık hata sayfası basar
        const usedPage = await pageGet(`/reset-password/${resetToken}`);
        assert.ok(usedPage.text.includes('Bağlantı Geçersiz'));
    });

    // Deep link: aynı https linki uygulama kuruluysa uygulamada açılsın diye
    // işletim sistemine sunulan eşleşme dosyaları
    const wellKnownGet = async (path) => {
        const res = await fetch(BASE.replace(/\/api$/, '') + path, { redirect: 'manual' });
        return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() };
    };

    it('well-known: uygulama kimlikleri tanımlıyken Universal Links / App Links dosyaları yayımlanır', async () => {
        process.env.IOS_APP_IDS = 'ABCDE12345.com.test.musubi, ABCDE12345.com.test.musubi.dev';
        process.env.ANDROID_PACKAGE = 'com.test.musubi';
        process.env.ANDROID_CERT_FINGERPRINTS = 'AA:BB, CC:DD';
        try {
            // Apple: uzantısız yol, application/json, YÖNLENDİRME YOK
            const aasa = await wellKnownGet('/.well-known/apple-app-site-association');
            assert.equal(aasa.status, 200, 'Apple yönlendirme kabul etmez, doğrudan 200 dönmeli');
            assert.match(aasa.type, /application\/json/);
            const { applinks } = JSON.parse(aasa.text);
            assert.equal(applinks.details.length, 2, 'her app ID için ayrı kayıt');
            // iOS 13+ `components`, eskiler `paths` okur — tek dosya ikisini de taşır
            assert.deepEqual(applinks.details[0].paths, ['/verify-email/*', '/reset-password/*']);
            assert.deepEqual(applinks.details[0].components, [{ '/': '/verify-email/*' }, { '/': '/reset-password/*' }]);
            assert.equal(applinks.details[0].appID, 'ABCDE12345.com.test.musubi');

            const android = await wellKnownGet('/.well-known/assetlinks.json');
            assert.equal(android.status, 200);
            assert.match(android.type, /application\/json/);
            const [link] = JSON.parse(android.text);
            assert.deepEqual(link.relation, ['delegate_permission/common.handle_all_urls']);
            assert.equal(link.target.package_name, 'com.test.musubi');
            // Play App Signing imzası geliştirme imzasından farklı: ikisi de listelenmeli
            assert.deepEqual(link.target.sha256_cert_fingerprints, ['AA:BB', 'CC:DD']);

            // İddia edilen yollar mail linkleriyle aynı olmalı; biri değişip
            // diğeri kalırsa link uygulamada AÇILMAZ, sessizce web'e düşer
            await createVerifiedUser('deeplink@test.com');
            await api('POST', '/auth/forgot-password', { body: { email: 'deeplink@test.com' } });
            const mailLink = sendEmail.outbox.at(-1).html.match(/href="(https?:\/\/[^"]*\/reset-password\/[0-9a-f]{40}[^"]*)"/);
            assert.ok(mailLink, 'sıfırlama maili tam URL taşımalı');
            const mailUrl = new URL(mailLink[1]);
            // Link ?lang= ile geliyor; desen YOL üzerinden eşleştiği için
            // sorgu dizesi eşleşmeyi bozmaz (hem iOS components hem Android
            // intent-filter yol öneki bakar)
            assert.ok(mailUrl.search, 'linkte sorgu dizesi var — desen buna rağmen tutmalı');
            const claimed = applinks.details[0].paths.map(p => p.replace(/\*$/, ''));
            assert.ok(claimed.some(prefix => mailUrl.pathname.startsWith(prefix)), 'maildeki yol iddia edilen desene uymalı');

            // Tüm site iddia EDİLMEZ: admin paneli ve hukuki metinler tarayıcıda kalmalı
            assert.ok(!claimed.some(prefix => '/admin/'.startsWith(prefix) || '/legal/terms'.startsWith(prefix)));
        } finally {
            delete process.env.IOS_APP_IDS;
            delete process.env.ANDROID_PACKAGE;
            delete process.env.ANDROID_CERT_FINGERPRINTS;
        }
    });

    it('well-known: kimlikler tanımsızken 404 — yarım eşleşme dosyası yayımlanmaz', async () => {
        // Yanlış/boş dosya 404'ten KÖTÜDÜR: iOS CDN'i ve Android'in kurulum
        // doğrulaması içeriği önbelleğe alır, 404 ise sadece "eşleşme yok"tur
        // ve link mevcut web sayfasına iner — akış kırılmaz
        assert.equal((await wellKnownGet('/.well-known/apple-app-site-association')).status, 404);
        assert.equal((await wellKnownGet('/.well-known/assetlinks.json')).status, 404);

        process.env.ANDROID_PACKAGE = 'com.test.musubi';
        try {
            assert.equal((await wellKnownGet('/.well-known/assetlinks.json')).status, 404,
                'paket adı var ama parmak izi yoksa dosya yayımlanmamalı');
        } finally {
            delete process.env.ANDROID_PACKAGE;
        }
    });

    it('e-posta değişikliği: yeni adres doğrulanınca geçerli olur, hesap bu arada doğrulanmış kalır', async () => {
        await createVerifiedUser('eskiadres@test.com');
        const token = (await login('eskiadres@test.com')).accessToken;

        // Hassas işlem: mevcut şifre olmadan veya yanlışken reddedilir
        const sifresiz = await api('PUT', '/auth/update-info', { token, body: { email: 'yeniadres@test.com' } });
        assert.equal(sifresiz.status, 401);
        const yanlis = await api('PUT', '/auth/update-info', {
            token, body: { email: 'yeniadres@test.com', currentPassword: 'Yanlis123!' }
        });
        assert.equal(yanlis.status, 401);

        const res = await api('PUT', '/auth/update-info', {
            token, body: { email: 'YeniAdres@test.com', currentPassword: 'Testsifre123!' }
        });
        assert.equal(res.status, 200, JSON.stringify(res.json));
        assert.equal(res.json.data.email, 'eskiadres@test.com', 'adres doğrulanana kadar DEĞİŞMEZ');
        assert.equal(res.json.data.pendingEmail, 'yeniadres@test.com');
        assert.equal(res.json.data.isEmailVerified, true, 'hesap kilitlenmemeli');

        const mail = sendEmail.outbox.at(-1);
        assert.equal(mail.to, 'yeniadres@test.com', 'doğrulama YENİ adrese gitmeli');

        // Doğrulanmadan önce her şey eskisi gibi çalışır
        assert.equal((await api('GET', '/auth/me', { token })).status, 200);

        const vToken = mail.html.match(/verify-email\/([0-9a-f]+)/)[1];
        const verify = await api('GET', `/auth/verify-email/${vToken}`);
        assert.equal(verify.status, 200);

        const me = (await api('GET', '/auth/me', { token })).json.data;
        assert.equal(me.email, 'yeniadres@test.com');
        assert.ok(!me.pendingEmail);
        await login('yeniadres@test.com'); // yeni adresle giriş (login 200 bekler)
    });

    it('mail gönderilemezse e-posta değişikliği uygulanmaz', async () => {
        await createVerifiedUser('sabitadres@test.com');
        const token = (await login('sabitadres@test.com')).accessToken;

        sendEmail.failNextSend();
        const res = await api('PUT', '/auth/update-info', {
            token, body: { email: 'ulasilmaz@test.com', currentPassword: 'Testsifre123!' }
        });
        assert.equal(res.status, 500);

        const me = await api('GET', '/auth/me', { token });
        assert.equal(me.json.data.email, 'sabitadres@test.com', 'adres değişmemiş olmalı');
        assert.ok(!me.json.data.pendingEmail);
        assert.equal(me.json.data.isEmailVerified, true, 'doğrulama bozulmamış olmalı');
    });

    it('bekleyen adresi arada başka hesap alırsa onay 409 döner, eski adres korunur', async () => {
        await createVerifiedUser('yaris-a@test.com');
        const token = (await login('yaris-a@test.com')).accessToken;
        await api('PUT', '/auth/update-info', {
            token, body: { email: 'yaris-hedef@test.com', currentPassword: 'Testsifre123!' }
        });
        const vToken = sendEmail.outbox.at(-1).html.match(/verify-email\/([0-9a-f]+)/)[1];

        await createVerifiedUser('yaris-hedef@test.com');
        const verify = await api('GET', `/auth/verify-email/${vToken}`);
        assert.equal(verify.status, 409);
        const me = (await api('GET', '/auth/me', { token })).json.data;
        assert.equal(me.email, 'yaris-a@test.com');
        assert.ok(!me.pendingEmail);
    });

    it('temizlik görevi e-posta değiştiren ESKİ hesabı silmez (veri kaybı regresyonu)', async () => {
        const eski = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const user = await createVerifiedUser('eski-hesap@test.com', { createdAt: eski });
        const token = (await login('eski-hesap@test.com')).accessToken;
        await api('GET', '/userwords/today', { token });
        await UserWord.create({ user: user._id, word: new mongoose.Types.ObjectId() });

        // Yeni akış: değişim hesabı doğrulanmamışa çevirmez
        await api('PUT', '/auth/update-info', {
            token, body: { email: 'eski-hesap-yeni@test.com', currentPassword: 'Testsifre123!' }
        });
        // Eski akıştan kalmış bir kayıt da korunur: öğrenme verisi olan hesap
        // bir zamanlar doğrulanmıştır
        const legacy = await createVerifiedUser('legacy-degisim@test.com', { createdAt: eski, isEmailVerified: false });
        await UserWord.create({ user: legacy._id, word: new mongoose.Types.ObjectId() });
        // Hiç doğrulanmamış, verisiz eski kayıt ise silinmeye devam eder
        const cop = await User.create({
            name: 'Cop', surname: 'X', email: 'cop-kayit@test.com', password: 'Testsifre123!',
            isEmailVerified: false, createdAt: eski
        });

        await AuthService.purgeUnverifiedAccounts();
        assert.equal(await User.countDocuments({ _id: user._id }), 1);
        assert.equal(await UserWord.countDocuments({ user: user._id }), 1);
        assert.equal(await User.countDocuments({ _id: legacy._id }), 1);
        assert.equal(await User.countDocuments({ _id: cop._id }), 0);
    });

    it('şifre sıfırlama e-postayı da doğrulanmış sayar (link sahipliği kanıtlar)', async () => {
        await User.create({
            name: 'Sifirla', surname: 'X', email: 'sifirla-dogrula@test.com',
            password: 'Testsifre123!', isEmailVerified: false
        });
        await api('POST', '/auth/forgot-password', { body: { email: 'sifirla-dogrula@test.com' } });
        const res = await api('POST', '/auth/reset-password', {
            body: { token: lastResetToken(), password: 'YeniSifre456!' }
        });
        assert.equal(res.status, 200);
        const u = await User.findOne({ email: 'sifirla-dogrula@test.com' });
        assert.equal(u.isEmailVerified, true);
    });

    it('push token cihaza aittir: aynı token başka hesaptan kaydedilince eski hesaptan düşer', async () => {
        await createVerifiedUser('fcm-a@test.com');
        await createVerifiedUser('fcm-b@test.com');
        const a = (await login('fcm-a@test.com')).accessToken;
        const b = (await login('fcm-b@test.com')).accessToken;
        await api('PUT', '/auth/update-info', { token: a, body: { fcmToken: 'ortak-cihaz' } });
        await api('PUT', '/auth/update-info', { token: b, body: { fcmToken: 'ortak-cihaz' } });

        const ua = await User.findOne({ email: 'fcm-a@test.com' }).select('+fcmToken');
        const ub = await User.findOne({ email: 'fcm-b@test.com' }).select('+fcmToken');
        assert.equal(ua.fcmToken, undefined, 'A\'nın bildirimleri B\'nin telefonuna gitmemeli');
        assert.equal(ub.fcmToken, 'ortak-cihaz');
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
        assert.ok(user.consents?.acceptedAt,
            'sosyal kayıt da hesap açılışıdır — KVKK rıza kaydı tutulmalı');
        assert.equal(user.consents.kvkk, require('../config/consents').CURRENT_CONSENT_VERSIONS.kvkk);

        const second = await api('POST', '/auth/social', googleBody());
        assert.equal(second.status, 200);
        assert.equal(second.json.isNewUser, false);
        assert.equal(second.json.data.id, first.json.data.id, 'aynı hesaba girmeli');
    });

    it('sosyal kayıt onboarding tercihlerini tek istekte alır; mevcut hesapta YOK SAYAR', async () => {
        const body = googleBody({ sub: 'google-onb-1', email: 'sosyal-onb@test.com' });
        const first = await api('POST', '/auth/social', {
            body: {
                ...body.body,
                dailyGoal: 40, reminderTime: '21:30',
                dailyReminder: true, timezone: 'Europe/Berlin'
            }
        });
        assert.equal(first.status, 201);
        assert.equal(first.json.isNewUser, true);

        const user = await User.findOne({ email: 'sosyal-onb@test.com' });
        assert.equal(user.dailyGoal, 40, 'hesap açılışında uygulanmalı');
        assert.equal(user.notificationSettings.reminderTime, '21:30');
        assert.equal(user.timezone, 'Europe/Berlin');
        assert.equal(user.notificationSettings.streakReminder, true,
            'dokunulmayan bildirim tercihleri varsayılanda kalmalı');

        // Kullanıcı sonradan Ayarlar'dan değiştirsin
        await User.updateOne({ _id: user._id },
            { dailyGoal: 10, 'notificationSettings.reminderTime': '08:00' });

        // Aynı hesapla tekrar giriş — tercihler EZİLMEMELİ
        const second = await api('POST', '/auth/social', {
            body: {
                ...body.body,
                dailyGoal: 40, reminderTime: '21:30', timezone: 'Europe/Berlin'
            }
        });
        assert.equal(second.status, 200);
        assert.equal(second.json.isNewUser, false);

        const after = await User.findById(user._id);
        assert.equal(after.dailyGoal, 10, 'mevcut hesabın tercihi korunmalı');
        assert.equal(after.notificationSettings.reminderTime, '08:00');
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
            body: { email: 'hibrit@test.com', password: 'Testsifre123!' }
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

    it('sosyal hesaba şifreyle giriş denemesi sağlayıcıya yönlendirir (400)', async () => {
        const res = await api('POST', '/auth/login', {
            body: { email: 'sosyal@test.com', password: 'rastgele-sifre' }
        });
        assert.equal(res.status, 400, '"Invalid credentials" çıkmazı yerine yol gösterilir');
        assert.match(res.json.message, /Google girişiyle açılmış/);
    });

    it('sosyal hesap şifre değiştiremez (400), silme taze idToken ile onaylanır', async () => {
        const tokens = (await api('POST', '/auth/social', googleBody())).json;

        const cp = await api('PUT', '/auth/change-password', {
            token: tokens.accessToken,
            body: { oldPassword: 'x', newPassword: 'Yenisifre123!' }
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
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
    });

    it('günlük havuz dailyGoal kadar kelime verir ve gün içinde sabittir', async () => {
        const first = await api('GET', '/userwords/today', { token });
        assert.equal(first.status, 200);
        assert.equal(first.json.data.newWords.length, 20);
        assert.equal(first.json.data.reviewWords.length, 0);
        wordId = first.json.data.newWords[0]._id;

        const second = await api('GET', '/userwords/today', { token });
        assert.deepEqual(
            second.json.data.newWords.map(w => w._id).sort(),
            first.json.data.newWords.map(w => w._id).sort(),
            'havuz gün boyu donuk olmalı'
        );
    });

    it('core olmayan kelime havuza ve aramaya girmez', async () => {
        const today = await api('GET', '/userwords/today', { token });
        assert.ok(!today.json.data.newWords.some(w => w.kanji === '非核'));

        const search = await api('GET', '/words/search?q=non-core', { token });
        assert.equal(search.status, 200);
        assert.equal(search.json.data.length, 0);
    });

    it('regex injection içeren arama 500 vermez', async () => {
        const res = await api('GET', '/words/search?q=' + encodeURIComponent('(a+)+$*['), { token });
        assert.equal(res.status, 200);
    });

    it('doğru cevap seviye yükseltir; nihai cevaptan sonrası TAM NÖTR; ertesi günkü yanlış düşürür + bildirim', async () => {
        let res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'correct' } });
        assert.equal(res.json.data.masteryLevel, 2);
        assert.equal(res.json.data.counted, true);

        // Günün nihai cevabı verildi; sonrası tekrar çalışma turudur — NÖTR:
        // ne SM-2 ne sayaçlar oynar (tek oturumda "ustalık 3" şişmesi imkânsız)
        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'correct' } });
        assert.equal(res.json.data.counted, false, 'tekrar turu kaydedilmez');
        assert.equal(res.json.data.masteryLevel, 2);
        assert.equal(res.json.data.repetitions, 1, 'SM-2 tekrarı saymamalı');
        assert.equal(res.json.data.interval, 1, 'interval büyümemeli');
        assert.equal(res.json.data.correctCount, 1, 'nötr: istatistik sayacı da oynamaz');

        // Tekrar turunda YANLIŞ da düşürmez ("pratik yap, sadece riske gir" olmasın)
        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'wrong' } });
        assert.equal(res.json.data.counted, false);
        assert.equal(res.json.data.masteryLevel, 2, 'tekrar turunda yanlış seviye DÜŞÜRMEZ');
        assert.equal(res.json.data.levelDropped, false);

        // Ertesi gün gelen doğru normal ilerler (gerçek aralıklı tekrar)
        await UserWord.updateOne(
            { user: userId, word: wordId },
            { $set: { lastReviewDate: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        );
        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'correct' } });
        assert.equal(res.json.data.masteryLevel, 3, 'ertesi günkü doğru → 2. tekrar → interval 6 → seviye 3');

        // Ertesi günkü yanlış gerçek unutma sinyalidir: seviyeyi sıfırlar
        await UserWord.updateOne(
            { user: userId, word: wordId },
            { $set: { lastReviewDate: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        );
        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'wrong' } });
        assert.equal(res.json.data.masteryLevel, 1);
        assert.equal(res.json.data.levelDropped, true);
        assert.equal(res.json.data.previousLevel, 3);

        // Düşüş BİLDİRİM ÜRETMEZ: kullanıcı cevabı verirken zaten uygulamanın
        // içinde ve bilgi yukarıdaki yanıtta dönüyor. Eskiden her yanlış cevap
        // ayrı bir push atıyordu (20 kelimelik seansta 8 yanlış = 8 push).
        const notifs = await api('GET', '/notifications', { token });
        assert.ok(
            !notifs.json.data.notifications.some(n => n.type === 'word_level_down'),
            'cevap anında word_level_down üretilmemeli — tek üretici gece decay özeti'
        );
    });

    it('easy doğru sayılır ve SM-2\'yi ilerletir (studysession ile tutarlı)', async () => {
        // Sıralama havuz sırasıyla aynı olmayabilir; cevaplanmamış bir kelime seç
        const w = (await api('GET', '/userwords/today', { token }))
            .json.data.newWords.find(x => !x.answeredToday);
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

    it('eşzamanlı çift cevap aynı kelimeyi iki kez saymaz (race condition)', async () => {
        // Gerçek bir kullanıcı raporunda aynı kelime 50ms arayla iki kez
        // "correct" sayılmıştı (çift tıklama/yavaş bağlantıda erken yeniden
        // deneme): UserWord optimistic concurrency + submitAnswer'daki retry
        // bunu önlemeli — eşzamanlı iki istekten yalnızca biri sayılmalı.
        const w = (await api('GET', '/userwords/today', { token }))
            .json.data.newWords.find(x => !x.answeredToday);
        const sBefore = (await api('GET', '/sessions/today', { token })).json.data;

        const [r1, r2] = await Promise.all([
            api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'correct' } }),
            api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'correct' } })
        ]);

        const countedTrue = [r1, r2].filter(r => r.json.data.counted).length;
        assert.equal(countedTrue, 1, 'aynı kelimeye eşzamanlı iki cevaptan yalnızca biri sayılmalı');

        const sAfter = (await api('GET', '/sessions/today', { token })).json.data;
        assert.equal(sAfter.totalWords, sBefore.totalWords + 1, 'session sayacı 2 değil 1 artmalı');
        assert.equal(sAfter.correctCount, sBefore.correctCount + 1);

        const uw = await UserWord.findOne({ user: userId, word: w._id });
        assert.equal(uw.repetitions, 1, 'SM-2 yalnızca bir kez ilerlemeli');
    });
});

describe('Öğrenme seviyesi (Ayarlar > Öğrenme Seviyeni Değiştir)', () => {
    let token, userId;

    before(async () => {
        const user = await createVerifiedUser('aktifseviye@test.com');
        userId = user._id;
        token = (await login('aktifseviye@test.com')).accessToken;
    });

    it('yeni kullanıcı N5\'te başlar; liste rozetleri ve kilit ipucu döner', async () => {
        const res = await api('GET', '/progress', { token });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.activeLevel, 'N5');

        const byLevel = Object.fromEntries(res.json.data.levels.map(l => [l.jlptLevel, l]));
        assert.equal(byLevel.N5.state, 'active');
        assert.equal(byLevel.N5.label, 'Başlangıç');
        assert.equal(byLevel.N5.canSelect, false, 'zaten seçili seviyede "Geç" bağlantısı olmamalı');
        assert.equal(byLevel.N5.unlockHint, null);

        assert.equal(byLevel.N4.state, 'locked');
        assert.equal(byLevel.N4.canSelect, false);
        // Türkçe ek okunuşa göre: N5 "beş" → N5'in, N4 "dört" → N4'ün
        assert.equal(byLevel.N4.unlockHint, "N5'in %75'i ile açılır");
        assert.equal(byLevel.N3.unlockHint, "N4'ün %75'i ile açılır");
    });

    it('kilitli seviyeye geçilemez (403); geçersiz seviye 400', async () => {
        const locked = await api('PUT', '/progress/active-level', { token, body: { jlptLevel: 'N4' } });
        assert.equal(locked.status, 403);

        const bad = await api('PUT', '/progress/active-level', { token, body: { jlptLevel: 'N6' } });
        assert.equal(bad.status, 400);

        const user = await User.findById(userId);
        assert.equal(user.activeLevel, 'N5', 'reddedilen istek profili DEĞİŞTİRMEMELİ');
    });

    it('seviye kilidi açılınca activeLevel kendiliğinden taşınmaz; anasayfa "Şimdi Geç" kartını gösterir', async () => {
        await Progress.findOneAndUpdate(
            { user: userId, jlptLevel: 'N4' },
            { isUnlocked: true, unlockedAt: new Date(), unlockedBy: 'study' }
        );

        const user = await User.findById(userId);
        assert.equal(user.activeLevel, 'N5', 'kilit açılması tek başına seviye DEĞİŞTİRMEZ');

        const home = await api('GET', '/home/summary', { token });
        assert.equal(home.json.data.activeLevel, 'N5');
        assert.equal(home.json.data.activeLevelLabel, 'Başlangıç');
        assert.deepEqual(home.json.data.advanceableLevel, { jlptLevel: 'N4', label: 'Temel' },
            'açılmış ama geçilmemiş seviye "Kilit Açıldı" kartını doldurmalı');
    });

    it('açık seviyeye geçilir ve günlük ders O seviyeden gelir', async () => {
        const res = await api('PUT', '/progress/active-level', { token, body: { jlptLevel: 'N4' } });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.activeLevel, 'N4', 'yanıt güncel listeyi taşımalı (ikinci GET gerekmesin)');

        const byLevel = Object.fromEntries(res.json.data.levels.map(l => [l.jlptLevel, l]));
        assert.equal(byLevel.N4.state, 'active');
        assert.equal(byLevel.N5.state, 'available');
        assert.equal(byLevel.N5.canSelect, true, 'eski seviyeye geri dönülebilmeli');

        // Asıl sözleşme: ders havuzu artık N4'ten çekilir
        const today = await api('GET', '/userwords/today', { token });
        assert.equal(today.status, 200);
        const levels = new Set(today.json.data.newWords.map(w => w.jlptLevel));
        assert.deepEqual([...levels], ['N4'], 'günlük ders yeni seviyeden gelmeli');

        // Anasayfada geçilecek seviye kalmadı (N3 hâlâ kilitli)
        const home = await api('GET', '/home/summary', { token });
        assert.equal(home.json.data.activeLevel, 'N4');
        assert.equal(home.json.data.advanceableLevel, null);
    });

    it('seviye değişimi: bugün hiç cevap yoksa ders ANINDA yeni seviyeden kurulur', async () => {
        // Havuz kurulmuş ama hiç dokunulmamışsa beklemeye gerek yok: eski
        // seviyenin havuzu silinir, güne yine TEK havuz düşer.
        const back = await api('PUT', '/progress/active-level', { token, body: { jlptLevel: 'N5' } });
        assert.equal(back.status, 200);

        const today = await api('GET', '/userwords/today', { token });
        assert.deepEqual([...new Set(today.json.data.newWords.map(w => w.jlptLevel))], ['N5']);
        assert.equal(today.json.data.jlptLevel, 'N5', 'dersin seviyesi de N5');
        assert.equal(today.json.data.levelStartsTomorrow, false);

        const pools = await mongoose.connection.db.collection('dailywordpools')
            .countDocuments({ user: userId });
        assert.equal(pools, 1, 'dokunulmamış eski havuz silinir: güne tek havuz');
    });

    it('seviye değişimi: derse başlandıysa yeni seviye YARIN başlar', async () => {
        // Bugünkü derse dokunulduysa havuz değişmez. Eskiden aynı güne ikinci
        // bir havuz açılıyordu: anasayfa çemberi iki havuzu toplayıp 40,
        // ders ekranı 20 gösteriyordu (21.09.2026 bulgusu H2).
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        const d = (await api('GET', '/userwords/today', { token })).json.data;
        await api('POST', '/userwords/answer', { token, body: { wordId: d.queue[0], result: 'correct' } });

        const gec = await api('PUT', '/progress/active-level', { token, body: { jlptLevel: 'N4' } });
        assert.equal(gec.status, 200);
        assert.equal(gec.json.data.activeLevel, 'N4', 'seviye ANINDA değişir');

        const sonra = (await api('GET', '/userwords/today', { token })).json.data;
        assert.equal(sonra.jlptLevel, 'N5', 'bugünkü ders eski seviyede devam eder');
        assert.equal(sonra.levelStartsTomorrow, true, 'istemci "yarın başlayacak" diyebilsin');
        assert.deepEqual([...new Set(sonra.newWords.map(w => w.jlptLevel))], ['N5']);

        const pools = await mongoose.connection.db.collection('dailywordpools')
            .countDocuments({ user: userId });
        assert.equal(pools, 1, 'ikinci havuz AÇILMAZ');

        // Anasayfa ile ders ekranı AYNI paydayı göstermeli (H2'nin kendisi)
        const home = (await api('GET', '/home/summary', { token })).json.data;
        assert.equal(home.activeLevel, 'N4', 'seviye bandı yeni seviyeyi gösterir');
        assert.equal(home.lessonLevel, 'N5', 'ders bugün N5');
        assert.equal(home.levelStartsTomorrow, true);
        assert.equal(home.goal, sonra.goal, 'çemberin paydası ders ekranıyla aynı');
        assert.equal(home.today.completedWords, sonra.today.completedWords);
    });
});

describe('Quiz', () => {
    let token, userId;

    before(async () => {
        const user = await createVerifiedUser('quiz@test.com');
        userId = user._id;
        token = (await login('quiz@test.com')).accessToken;
    });

    // Belirli seviyelerin sorularını doğru, kalanını yanlış cevaplar — seviye
    // belirleme kuralını sınamanın tek yolu bu (sorular rastgele üretiliyor).
    const answerByLevel = async (quizId, correctLevels, tok = token) => {
        const attempt = await QuizAttempt.findById(quizId);
        let last;
        for (let i = 0; i < attempt.questions.length; i++) {
            const q = attempt.questions[i];
            const correct = correctLevels.includes(q.jlptLevel);
            const answer = q.format === 'typing'
                ? (correct ? q.correctAnswers[0] : 'kesin-yanlis-cevap')
                : (correct ? q.correctIndex : (q.correctIndex + 1) % 4);
            last = await api('POST', `/quiz/${quizId}/answer`, { token: tok, body: { index: i, answer } });
        }
        return last;
    };

    it('sınav tek seferde 40 soru, beş seviyeden; cevap anahtarı sızdırmaz', async () => {
        const res = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.totalQuestions, 40);
        assert.equal(res.json.data.secondsPerQuestion, 20);
        assert.ok(!JSON.stringify(res.json).includes('correctIndex'), 'cevap anahtarı sızmamalı');
        assert.ok(!JSON.stringify(res.json).includes('correctAnswers'), 'yazma cevap anahtarı sızmamalı');

        // Tasarımdaki dağılım: N5:6, N4:6, N3:8, N2:10, N1:10
        const perLevel = {};
        for (const q of res.json.data.questions) {
            assert.ok(q.jlptLevel, 'her soru rozeti için seviye taşımalı');
            perLevel[q.jlptLevel] = (perLevel[q.jlptLevel] || 0) + 1;
        }
        assert.deepEqual(perLevel, { N5: 6, N4: 6, N3: 8, N2: 10, N1: 10 });

        // Zorluk kademeli artar: sorular N5'ten N1'e sıralı gelir
        const order = res.json.data.questions.map(q => q.jlptLevel);
        assert.deepEqual(order, [...order].sort(
            (a, b) => ['N5', 'N4', 'N3', 'N2', 'N1'].indexOf(a) - ['N5', 'N4', 'N3', 'N2', 'N1'].indexOf(b)
        ), 'sorular kolaydan zora sıralanmalı');
    });

    it('anlık geri bildirim döner, aynı soru iki kez cevaplanamaz', async () => {
        const quizId = (await QuizAttempt.findOne({ user: userId, status: 'in_progress' }))._id;
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

        const dup = await api('POST', `/quiz/${quizId}/answer`, { token, body: { index: 0, answer: wrongAnswer } });
        assert.equal(dup.status, 400);
        const badIdx = await api('POST', `/quiz/${quizId}/answer`, { token, body: { index: 99, answer: 0 } });
        assert.equal(badIdx.status, 400);
    });

    it('çıkışta sınav geçersiz sayılır, sonraki giriş BAŞTAN başlar', async () => {
        const quizId = (await QuizAttempt.findOne({ user: userId, status: 'in_progress' }))._id;

        const bye = await api('POST', `/quiz/${quizId}/abandon`, { token });
        assert.equal(bye.status, 200);
        assert.equal((await QuizAttempt.findById(quizId)).status, 'abandoned');

        // Terk edilen sınava cevap gönderilemez
        const late = await api('POST', `/quiz/${quizId}/answer`, { token, body: { index: 1, answer: 0 } });
        assert.equal(late.status, 400);

        // Terk cooldown YAKMAZ: kullanıcı bir ölçüm almadı
        const fresh = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(fresh.status, 200);
        assert.notEqual(String(fresh.json.data.quizId), String(quizId), 'yeni sınav açılmalı');
        assert.equal(fresh.json.data.answeredCount, 0, 'baştan başlamalı');
    });

    it('seviye en yüksekten aşağı taranarak belirlenir; altındaki seviyeler de açılır', async () => {
        const quizId = (await QuizAttempt.findOne({ user: userId, status: 'in_progress' }))._id;

        // N5/N4/N3 doğru, N2/N1 yanlış → N3'ün %100'ü doğru, seviye N3
        const last = await answerByLevel(quizId, ['N5', 'N4', 'N3']);
        const result = last.json.data.result;

        assert.equal(result.determinedLevel, 'N3');
        assert.equal(result.levelLabel, 'Orta');
        assert.ok(result.levelDescription?.length, 'sonuç ekranı için açıklama cümlesi dönmeli');
        assert.equal(result.totalQuestions, 40);
        assert.equal(result.correctCount, 20, 'N5:6 + N4:6 + N3:8');
        assert.equal(result.wrongCount, 20);
        assert.ok(typeof result.durationSeconds === 'number' && result.durationSeconds >= 0);
        assert.equal(result.passed, undefined, 'geçme/kalma kavramı kalktı');

        // Belirlenen seviyeye KADAR hepsi açılır — N3 bilen N5/N4'ü de bilir
        assert.deepEqual(result.unlockedLevels.sort(), ['N3', 'N4'], 'N5 zaten açıktı');
        const unlocked = await Progress.find({ user: userId, isUnlocked: true }).distinct('jlptLevel');
        assert.deepEqual(unlocked.sort(), ['N3', 'N4', 'N5']);

        // Sınav sonucu doğrudan çalışılan seviye olur (kilit açılışının aksine
        // "Şimdi Geç" onayı beklenmez; STS'nin işi zaten yerleştirme)
        assert.equal((await User.findById(userId)).activeLevel, 'N3');
        const firstLesson = await api('GET', '/userwords/today', { token });
        const lessonLevels = new Set(firstLesson.json.data.newWords.map(w => w.jlptLevel));
        assert.deepEqual([...lessonLevels], ['N3'], 'ilk ders belirlenen seviyeden gelmeli');
    });

    it('hepsi yanlışsa sonuç N5 olur — sınavda "başarısızlık" yoktur', async () => {
        const user = await createVerifiedUser('sifir@test.com');
        const t = (await login('sifir@test.com')).accessToken;

        const res = await api('POST', '/quiz/start', { token: t, body: { type: 'placement' } });
        const last = await answerByLevel(res.json.data.quizId, [], t);
        const result = last.json.data.result;

        assert.equal(result.determinedLevel, 'N5');
        assert.equal(result.correctCount, 0);
        assert.deepEqual(result.unlockedLevels, [], 'N5 zaten açıktı, yeni kilit açılmadı');
        assert.equal((await User.findById(user._id)).activeLevel, 'N5');
    });

    it('tekrar giriş 14 gün sonra; kilitler geri KAPANMAZ', async () => {
        // Az önce N3 belirlenmiş kullanıcı hemen tekrar giremez
        const soon = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(soon.status, 403);
        assert.ok(soon.json.nextAttemptAllowedAt, 'UI geri sayımı için tarih dönmeli');

        const status = await api('GET', '/quiz/status', { token });
        assert.equal(status.json.data.placementAvailable, false);
        assert.equal(status.json.data.retakeCooldownDays, 14);
        assert.equal(status.json.data.hasTakenPlacement, true);

        // 15 gün öncesine çek → hak yenilenir
        await QuizAttempt.updateMany(
            { user: userId, status: 'completed' },
            { completedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) }
        );
        const retry = await api('POST', '/quiz/start', { token, body: { type: 'placement' } });
        assert.equal(retry.status, 200);

        // Bu kez hepsi yanlış → N5 çıkar, AMA N4/N3 kilitleri açık kalmalı
        await answerByLevel(retry.json.data.quizId, []);
        const unlocked = await Progress.find({ user: userId, isUnlocked: true }).distinct('jlptLevel');
        assert.deepEqual(unlocked.sort(), ['N3', 'N4', 'N5'], 'hak edilmiş seviye geri alınamaz');
        assert.equal((await User.findById(userId)).activeLevel, 'N5', 'activeLevel yeni sonuca taşınır');
    });

    it('modal bir kez ertelenince bir daha çıkmaz', async () => {
        await createVerifiedUser('modal@test.com');
        const t = (await login('modal@test.com')).accessToken;

        const before = await api('GET', '/home/summary', { token: t });
        assert.equal(before.json.data.placementPrompt, true, 'hiç sınava girmemiş kullanıcıya modal çıkar');

        const defer = await api('POST', '/quiz/placement/defer', { token: t });
        assert.equal(defer.status, 200);

        const after = await api('GET', '/home/summary', { token: t });
        assert.equal(after.json.data.placementPrompt, false, '"Daha Sonra" kalıcı olmalı');

        // Erteleme sınavı iptal etmez: Ayarlar'daki satır hâlâ çalışır
        assert.equal((await api('GET', '/quiz/status', { token: t })).json.data.placementAvailable, true);
    });

    it('yarıda bırakılan sınav modalı kapatmaz: kullanıcı yeniden davet edilir', async () => {
        // Modalı yalnızca TAMAMLANMIŞ sınav ya da "Daha Sonra" kapatır. Eskiden
        // herhangi bir deneme kaydı yetiyordu: 10. soruda çıkan kullanıcı ölçüm
        // almadığı hâlde bir daha hiç davet edilmiyordu.
        await createVerifiedUser('yarimsinav@test.com');
        const t = (await login('yarimsinav@test.com')).accessToken;

        const start = await api('POST', '/quiz/start', { token: t, body: { type: 'placement' } });
        assert.equal(start.status, 200);
        await api('POST', `/quiz/${start.json.data.quizId}/abandon`, { token: t });

        const home = await api('GET', '/home/summary', { token: t });
        assert.equal(home.json.data.placementPrompt, true,
            'sınavı yarıda bırakan kullanıcı ölçüm almadı, modal yeniden çıkmalı');
        assert.equal(home.json.data.placementAvailable, true, 'terk hak da yakmaz');
    });

    it('sınava girmiş kullanıcıya modal bir daha çıkmaz', async () => {
        const home = await api('GET', '/home/summary', { token });
        assert.equal(home.json.data.placementPrompt, false);
    });

    it('yazma sorusu: büyük harf/noktalama/parantez toleranslı puanlanır, boş yanlış sayılır', async () => {
        const user = await createVerifiedUser('yazma@test.com');
        const t = (await login('yazma@test.com')).accessToken;
        const word = await Word.findOne({ jlptLevel: 'N5', isCore: true });

        // Deterministik test için deneme doğrudan oluşturulur (start'ta format rastgele)
        const attempt = await QuizAttempt.create({
            user: user._id, type: 'placement',
            questions: [
                { word: word._id, jlptLevel: 'N5', format: 'typing', prompt: { kanji: word.kanji, romaji: word.romaji }, correctAnswers: ['gelecek yıl', 'seneye'] },
                { word: word._id, jlptLevel: 'N5', format: 'typing', prompt: { kanji: word.kanji, romaji: word.romaji }, correctAnswers: ['tehlikeli'] },
                { word: word._id, jlptLevel: 'N5', format: 'typing', prompt: { kanji: word.kanji, romaji: word.romaji }, correctAnswers: ['mavi'] },
                { word: word._id, jlptLevel: 'N5', format: 'meaning', prompt: { kanji: word.kanji }, choices: ['a', 'b', 'c', 'd'], correctIndex: 2 }
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

    it('seviye atlama sınavı (levelup) kaldırıldı', async () => {
        // Seviye artık yalnızca ustalıkla (%75) açılıyor ve geçiş kullanıcının
        // onayına bağlı — ayrı bir atlama sınavı yok.
        const res = await api('POST', '/quiz/start', { token, body: { type: 'levelup', jlptLevel: 'N4' } });
        assert.equal(res.status, 400);
    });

    it('quiz_completed event\'leri yazılır', async () => {
        await sleep(100);
        const count = await Event.countDocuments({ user: userId, type: 'quiz_completed' });
        assert.equal(count, 2, 'ilk sınav + 14 gün sonraki tekrar');
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
            ...await QuizService.generateQuestions('N5', 20),
            ...await QuizService.generateQuestions('N5', 20)
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

        // Üretilen her soru rozeti için kendi seviyesini taşımalı
        assert.ok(questions.every(q => q.jlptLevel === 'N5'));
    });

    it('fillblank/image cevapları API üzerinden puanlanır', async () => {
        const user = await createVerifiedUser('icerik@test.com');
        const t = (await login('icerik@test.com')).accessToken;
        const word = await Word.findOne({ jlptLevel: 'N5', isCore: true });

        const attempt = await QuizAttempt.create({
            user: user._id, type: 'placement',
            questions: [
                { word: word._id, jlptLevel: 'N5', format: 'fillblank', prompt: { sentence: 'これは____です。' }, choices: ['あ', word.kanji, 'い', 'う'], correctIndex: 1 },
                { word: word._id, jlptLevel: 'N5', format: 'image', prompt: { imageUrl: 'https://img.test/x.jpg' }, choices: [word.kanji, 'あ', 'い', 'う'], correctIndex: 0 }
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

describe('Ders akışı (devam + backend puanlama + session)', () => {
    let token, w0, w1;

    before(async () => {
        await createVerifiedUser('ders@test.com', { dailyGoal: 20 });
        token = (await login('ders@test.com')).accessToken;
        const today = await api('GET', '/userwords/today', { token });
        [w0, w1] = today.json.data.newWords;
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
    });

    it('aynı gün ikinci cevap session sayaçlarını şişirmez', async () => {
        await api('POST', '/userwords/answer', { token, body: { wordId: w0._id, result: 'correct' } });
        let s = await api('GET', '/sessions/today', { token });
        assert.equal(s.json.data.totalWords, 1);

        // Ders yarıda kalıp yeniden başladı: aynı kelime tekrar cevaplanıyor
        await api('POST', '/userwords/answer', { token, body: { wordId: w0._id, result: 'correct' } });
        s = await api('GET', '/sessions/today', { token });
        assert.equal(s.json.data.totalWords, 1, 'aynı gün tekrarı sayaca EKLENMEMELİ (19/30 şişmesi)');
        assert.equal(s.json.data.correctCount, 1);

        await api('POST', '/userwords/answer', { token, body: { wordId: w1._id, result: 'wrong' } });
        s = await api('GET', '/sessions/today', { token });
        assert.equal(s.json.data.totalWords, 2, 'farklı kelime normal sayılır');
    });

    it('yazılan cevabı backend puanlar: varyantlar kabul, yanlışta cevap döner, boş empty', async () => {
        const miru = await Word.create({ kanji: '見る', romaji: 'miru', meaning: 'to see / watch', type: 'fiil', jlptLevel: 'N5' });
        const shita = await Word.create({ kanji: '下', romaji: 'shita', meaning: 'down / below', type: 'isim', jlptLevel: 'N5' });
        const itsumo = await Word.create({ kanji: 'いつも', romaji: 'itsumo', meaning: 'always, usually, every time, never (with neg. verb)', type: 'zarf', jlptLevel: 'N5' });
        await havuzaEkle('ders@test.com', [miru._id, shita._id, itsumo._id]);

        // "to see / watch" → "to see" tek başına doğru (Emirhan'ın bug'ı)
        let res = await api('POST', '/userwords/answer', { token, body: { wordId: miru._id, answer: 'to see' } });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.result, 'correct');
        assert.equal(res.json.data.masteryLevel, 2);

        // "down / below" → "Down" (büyük harf) doğru
        res = await api('POST', '/userwords/answer', { token, body: { wordId: shita._id, answer: 'Down' } });
        assert.equal(res.json.data.result, 'correct');

        // Parantez içi opsiyonel: "never" tek başına kabul
        res = await api('POST', '/userwords/answer', { token, body: { wordId: itsumo._id, answer: 'never' } });
        assert.equal(res.json.data.result, 'correct');

        // Yanlış metin → wrong + "Cevap: ..." satırı için correctAnswer
        const wrong = await Word.create({ kanji: '上', romaji: 'ue', meaning: 'up / above', type: 'isim', jlptLevel: 'N5' });
        await havuzaEkle('ders@test.com', [wrong._id]);
        res = await api('POST', '/userwords/answer', { token, body: { wordId: wrong._id, answer: 'aşağı' } });
        assert.equal(res.json.data.result, 'wrong');
        assert.equal(res.json.data.correctAnswer, 'up / above');

        // Boş bırakılan → empty
        const empty = await Word.create({ kanji: '右', romaji: 'migi', meaning: 'right', type: 'isim', jlptLevel: 'N5' });
        await havuzaEkle('ders@test.com', [empty._id]);
        res = await api('POST', '/userwords/answer', { token, body: { wordId: empty._id, answer: '  ' } });
        assert.equal(res.json.data.result, 'empty');
    });

    it('today yanıtı kaldığın yerden devam bilgisi ve isKana verir', async () => {
        const today = await api('GET', '/userwords/today', { token });
        const d = today.json.data;

        // progress HAVUZUN durumudur (today ise GÜNÜN) — ikisi bilerek ayrıdır.
        // Havuz 20 kelimeyle kuruldu, yazma testleri 5 kelime daha ekledi.
        // Cevaplananlar: w0, w1 + miru, shita, itsumo, ue = 6; migi ertelendi.
        assert.deepEqual(d.progress,
            { total: 25, completed: 6, postponed: 1, remaining: 18, touched: 7 });
        assert.equal(d.queue.length, 19,
            'kuyruk = dokunulmamışlar + SONDA ertelenenler');
        assert.equal(String(d.queue.at(-1)), String(d.postponedIds[0]),
            'ertelenen kelime kuyruğun SONUNA konur, aynı ders içinde geri gelir');
        assert.ok(d.completedIds.map(String).includes(String(w0._id)));
        assert.equal(d.postponedIds.length, 1, 'migi (右) ertelenmiş durumda');

        const a0 = d.newWords.find(w => w._id === w0._id);
        const a1 = d.newWords.find(w => w._id === w1._id);
        assert.equal(a0.answeredToday, true);
        assert.equal(a0.todayResult, 'correct');
        assert.equal(a1.todayResult, 'wrong');
        assert.equal(d.newWords.filter(w => !w.answeredToday).length, 19,
            'kalanlar işaretsiz: 18 dokunulmamış + 1 ertelenmiş');

        assert.equal(a0.isKana, false, 'kanji içeren kelimede isKana false');
        const itsumo = await Word.findOne({ romaji: 'itsumo' });
        const detail = await api('GET', `/words/${itsumo._id}`, { token });
        assert.equal(detail.json.data.isKana, true, 'kana-only kelimede isKana true');
    });

    it('today seviyeyi activeLevel\'dan alır; query\'deki jlptLevel YOK SAYILIR (hayalet ikinci havuz açılmasın)', async () => {
        // Eskiden jlptLevel zorunlu bir query parametresiydi ve yoksa 400'dü;
        // sunucuda güvenilir bir "o anki seviye" kaydı olmadığı içindi. Artık
        // User.activeLevel var: parametresiz çağrı normal çalışmalı.
        const missing = await api('GET', '/userwords/today', { token });
        assert.equal(missing.status, 200);

        // Uydurma bir seviye artık hata DEĞİL, sessizce yok sayılır — istemci
        // seviyeyi belirleyemez, tek yazıcı PUT /progress/active-level'dır.
        const invalid = await api('GET', '/userwords/today?jlptLevel=N6', { token });
        assert.equal(invalid.status, 200);

        // Kritik olan: üç çağrı da AYNI havuzu görmeli (ikinci doküman açılmamalı)
        const pools = await mongoose.connection.db.collection('dailywordpools')
            .countDocuments({ user: (await User.findOne({ email: 'ders@test.com' }))._id });
        assert.equal(pools, 1, 'query ne gelirse gelsin günde tek havuz açılmalı');
    });

    it('dailyGoal gün içinde artınca havuz genişler: önce vadesi gelen tekrarlar, sonra yeni kelimeler', async () => {
        // Havuz DIŞINDA, vadesi gelmiş bir tekrar kelimesi hazırla: genişleme
        // kontenjanına YENİ kelimeden önce bunun girmesi gerekiyor ("daha çok
        // çalışmak istiyorum" diyene önce borcu verilir).
        // Yeni kelime ÜRETİLMEZ — kelime sayıları başka testlerin sözleşmesi.
        const dersUser = await User.findOne({ email: 'ders@test.com' });
        const havuz = await DailyWordPool.findOne({ user: dersUser._id, poolNo: 1 }).sort({ date: -1 });
        const havuzKelimeleri = [
            ...havuz.newWordIds,
            ...(await UserWord.find({ _id: { $in: havuz.reviewWordIds } }).distinct('word'))
        ];
        const borc = await Word.findOne({
            jlptLevel: 'N5', isCore: true, _id: { $nin: havuzKelimeleri }
        });
        assert.ok(borc, 'havuz dışında N5 kelimesi kalmalı');
        await UserWord.create({
            user: dersUser._id, word: borc._id, status: 'learning',
            masteryLevel: 2, repetitions: 1, interval: 1, easeFactor: 2.5,
            nextReviewDate: new Date(Date.now() - 86400000)
        });

        const up = await api('PUT', '/auth/update-info', { token, body: { dailyGoal: 30 } });
        assert.equal(up.status, 200);

        const today = await api('GET', '/userwords/today', { token });
        const d = today.json.data;
        assert.equal(d.progress.total, 30, 'havuz 25→30 genişlemeli');
        // migi (右) bugün ertelendi (empty) ve vadesi geçmiş durumda: genişleme
        // kontenjanına yeni kelimeden ÖNCE, tekrar olarak girer — dokunulmuş
        // (empty dahil) sayıldığı için w0/w1 + migi = 3
        assert.equal(d.progress.touched, 7,
            'cevaplananlar (w0, w1, miru, shita, itsumo, ue) + dokunulan migi (empty)');
        assert.ok(d.reviewWords.some(r => String(r.word._id) === String(borc._id)),
            'vadesi gelmiş kelime top-up kontenjanına yeni kelimeden ÖNCE girer');

        // İkinci çağrı tekrar büyütmemeli (idempotent)
        const again = await api('GET', '/userwords/today', { token });
        assert.equal(again.json.data.progress.total, 30);
    });

    it('ertelenmiş kelime dururken ders TAMAMLANABİLİR (409 kalktı)', async () => {
        // migi (右) "Şimdilik Geç" ile ertelenmiş durumda. Eskiden burada 409
        // dönüyor ve kullanıcı dersten çıkamıyordu.
        const res = await api('PUT', '/sessions/complete', { token });
        assert.equal(res.status, 200, '"Şimdilik Geç" dersten çıkmayı engellememeli');
        assert.equal(res.json.data.pendingWords, 1,
            'bitiş ekranı "1 kelimeyi sonraya bıraktın" diyebilsin diye sayı yine döner');
        assert.equal(res.json.data.canOpenNextPool, false,
            'ertelenmiş kelime varken ikinci havuz AÇILAMAZ');

        const summary = await api('GET', '/home/summary', { token });
        assert.equal(summary.json.data.today.isCompleted, true);
    });

    it('sessions/complete hazır accuracy yüzdesi döner', async () => {
        // Ertelenen kelimenin gerçek cevabı: emptyCount düşer, totalWords
        // DEĞİŞMEZ (kelime zaten dokunulmuş sayılıyordu)
        const migi = await Word.findOne({ kanji: '右' });
        await api('POST', '/userwords/answer', { token, body: { wordId: migi._id, result: 'correct' } });

        const res = await api('PUT', '/sessions/complete', { token });
        assert.equal(res.status, 200);
        const d = res.json.data;
        // w0 correct, w1 wrong, miru/shita/itsumo correct, ue wrong, migi correct → 5/7
        assert.equal(d.totalWords, 7);
        assert.equal(d.correctCount, 5);
        assert.equal(d.emptyCount, 0);
        // Payda cevaplananlardır (correct+wrong), totalWords DEĞİL: "Şimdilik
        // Geç"e basmak doğruluk oranını düşürmemeli
        assert.equal(d.accuracy, 71);
        assert.equal(d.pendingWords, 0);
        assert.equal(d.isCompleted, true);
    });

    it('bugünün hataları yalnızca bugün YANLIŞ cevaplananlardır (empty ve eski yanlışlar sayılmaz)', async () => {
        let res = await api('GET', '/userwords/mistakes', { token });
        // w1 ve ue bugün yanlış; migi empty (hata değil), diğerleri doğru
        assert.equal(res.json.data.total, 2, 'yalnızca son cevabı yanlış olanlar');
        const kanjis = res.json.data.mistakes.map(m => m.word.kanji);
        assert.ok(kanjis.includes('上'), 'yanlış cevaplanan listede olmalı');
        assert.ok(!kanjis.includes('右'), '"Şimdilik Geç" (empty) hata DEĞİL');

        // Geçmişte yanlışı olan kelime bugün doğru cevaplanınca listeden düşer
        // (wrongCount ömür boyu 1 kalsa bile)
        const ue = await Word.findOne({ kanji: '上' });
        const user = await User.findOne({ email: 'ders@test.com' });
        await UserWord.updateOne(
            { user: user._id, word: ue._id },
            { $set: { lastReviewDate: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        );
        await api('POST', '/userwords/answer', { token, body: { wordId: ue._id, result: 'correct' } });

        res = await api('GET', '/userwords/mistakes', { token });
        assert.equal(res.json.data.total, 1, 'bugün doğruya dönen kelime hatalardan düşmeli');
        assert.ok(!res.json.data.mistakes.some(m => m.word.kanji === '上'));
    });

    it('tekrar çalışma turu TAM NÖTRDÜR: doğru yükseltmez, yanlış düşürmez, puanlama yine döner', async () => {
        const miru = await Word.findOne({ kanji: '見る' });
        // miru'nun bugünkü nihai cevabı verilmişti (correct); tekrar turu:
        let res = await api('POST', '/userwords/answer', { token, body: { wordId: miru._id, result: 'wrong' } });
        assert.equal(res.json.data.counted, false, 'tekrar turu kaydedilmez');
        assert.equal(res.json.data.masteryLevel, 2, 'yanlış da seviye DÜŞÜRMEZ');
        assert.equal(res.json.data.levelDropped, false);

        // Yazma puanlaması nötr turda da çalışır (UI "Doğru!/Yanlış!" için)
        res = await api('POST', '/userwords/answer', { token, body: { wordId: miru._id, answer: 'watch' } });
        assert.equal(res.json.data.result, 'correct');
        assert.equal(res.json.data.counted, false);
    });

    it('"Şimdilik Geç" ertelemedir: kelime tekrar sorulur, günün ilk gerçek cevabı sayılır', async () => {
        const before = (await api('GET', '/userwords/today', { token })).json.data;
        const w = before.newWords.find(x => !x.answeredToday);
        const s0 = (await api('GET', '/sessions/today', { token })).json.data;

        let res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'empty' } });
        assert.equal(res.json.data.counted, true);

        let today = (await api('GET', '/userwords/today', { token })).json.data;
        let item = today.newWords.find(x => x._id === w._id);
        assert.equal(item.answeredToday, false, 'nihai cevap yok: kelime yeniden sorulmalı');
        assert.equal(item.todayResult, 'empty', 'istemci "ertelendi" bilgisini görebilmeli');
        assert.equal(today.progress.touched, before.progress.touched + 1,
            'erteleme de Anasayfa\'daki (StudySession) sayaçla tutarlı şekilde ilerleme sayılır');

        // İkinci boş geçiş nötrdür, emptyCount şişmez
        await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'empty' } });
        const s1 = (await api('GET', '/sessions/today', { token })).json.data;
        assert.equal(s1.totalWords, s0.totalWords + 1);
        assert.equal(s1.emptyCount, s0.emptyCount + 1, 'aynı kelime tek empty sayılmalı');

        // Günün ilk gerçek cevabı: SM-2 işler, session sayacı empty→correct devredilir
        res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'correct' } });
        assert.equal(res.json.data.counted, true, 'ertelenmişin ilk gerçek cevabı SAYILIR');
        assert.equal(res.json.data.masteryLevel, 2);

        const s2 = (await api('GET', '/sessions/today', { token })).json.data;
        assert.equal(s2.totalWords, s1.totalWords, 'toplam değişmez (kelime zaten sayılmıştı)');
        assert.equal(s2.emptyCount, s0.emptyCount, 'empty sayacı geri düşer');
        assert.equal(s2.correctCount, s1.correctCount + 1);

        today = (await api('GET', '/userwords/today', { token })).json.data;
        item = today.newWords.find(x => x._id === w._id);
        assert.equal(item.answeredToday, true);
        assert.equal(item.todayResult, 'correct');
        assert.equal(today.progress.touched, before.progress.touched + 1,
            'ertelenmişin nihai cevabı ilerlemeyi tekrar artırmaz (kelime zaten sayılmıştı)');
    });

    it('günlük oturum TEKTİR: complete sonrası start aynı kaydı yeniden açar', async () => {
        const StudySession = require('../models/StudySession');
        const user = await User.findOne({ email: 'ders@test.com' });

        const before = await api('GET', '/sessions/today', { token });
        const started = await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        assert.equal(started.json.data._id, before.json.data._id, 'aynı günlük kayıt dönmeli');
        assert.equal(started.json.data.isCompleted, false, 'bitmiş oturum yeniden açılmalı');
        assert.equal(await StudySession.countDocuments({ user: user._id }), 1,
            'güne İKİNCİ doküman asla açılmamalı');
    });
});

describe('Cevap sözleşmesi (result / todayResult / belirsiz gövde)', () => {
    let token;

    before(async () => {
        await createVerifiedUser('cevap@test.com', { dailyGoal: 20 });
        token = (await login('cevap@test.com')).accessToken;
        await api('GET', '/userwords/today', { token });
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
    });

    it('belirsiz gövde reddedilir: result yok + answer yok → 400 (sessizce "empty" sayılmaz)', async () => {
        // 07.08.2026 raporu: "doğru cevapladım ama result: empty döndü".
        // Kaynak buydu — gövdesiz/boş bir ikinci istek 'empty' puanlanıyordu.
        // İlk dokunuşta olsaydı emptyCount'u da şişirirdi.
        const w = await Word.create({ kanji: '私', romaji: 'watashi', meaning: 'I', meaningTr: 'ben', type: 'zamir', jlptLevel: 'N5' });
        await havuzaEkle('cevap@test.com', [w._id]);

        let res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id } });
        assert.equal(res.status, 400, 'ne result ne answer varsa istek belirsizdir');

        res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id, answer: null } });
        assert.equal(res.status, 400, 'answer:null "boş geçtim" DEMEK DEĞİLDİR');

        // Ama yazma sorusunda kutuyu boş bırakıp göndermek gerçekten empty'dir
        res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id, answer: '' } });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.result, 'empty');
    });

    it('result BU CEVABIN puanı, todayResult GÜNE KAYITLI sonuç — tekrar turu rozeti bozmaz', async () => {
        const w = await Word.create({ kanji: '君', romaji: 'kimi', meaning: 'you', meaningTr: 'sen', type: 'zamir', jlptLevel: 'N5' });
        await havuzaEkle('cevap@test.com', [w._id]);

        let res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'correct' } });
        assert.equal(res.json.data.result, 'correct');
        assert.equal(res.json.data.todayResult, 'correct');
        assert.equal(res.json.data.counted, true);

        // Tekrar çalışma turu: nihai cevap zaten var, hiçbir şey yazılmaz.
        // result bu gönderimin puanını verir ("Doğru!/Yanlış!" için), ama günün
        // kayıtlı sonucu DEĞİŞMEZ — rozet todayResult'a bakmalı.
        res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'empty' } });
        assert.equal(res.json.data.counted, false);
        assert.equal(res.json.data.result, 'empty', 'bu gönderimin puanı');
        assert.equal(res.json.data.todayResult, 'correct', 'günün kayıtlı sonucu ezilmemeli');
    });

});

describe('Session güvenilirliği (zorunlu session + idempotent bitirme + yeni tur)', () => {
    let token, w0, w1, w2;

    before(async () => {
        await createVerifiedUser('guvenlik@test.com', { dailyGoal: 20 });
        token = (await login('guvenlik@test.com')).accessToken;
        const today = await api('GET', '/userwords/today', { token });
        [w0, w1, w2] = today.json.data.newWords;
        // BİLEREK /sessions/start çağrılmadı: bypass/hacking senaryosunu test ediyoruz.
    });

    it('sessions/start çağrılmadan cevap verilemez (UI atlanıp API\'ye doğrudan istek atılamasın)', async () => {
        const res = await api('POST', '/userwords/answer', { token, body: { wordId: w0._id, result: 'correct' } });
        assert.equal(res.status, 400, 'session yokken cevap KABUL EDİLMEMELİ');

        const s = await api('GET', '/sessions/today', { token });
        assert.equal(s.json.data, null, "reddedilen cevap session'ı da kendiliğinden açmamalı");
    });

    it('sessions/complete birden çok kez çağrılırsa idempotenttir (duration/event tekrarlanmaz)', async () => {
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        await api('POST', '/userwords/answer', { token, body: { wordId: w0._id, result: 'correct' } });
        await api('POST', '/userwords/answer', { token, body: { wordId: w1._id, result: 'wrong' } });

        const first = await api('PUT', '/sessions/complete', { token });
        assert.equal(first.status, 200);
        const firstDuration = first.json.data.duration;
        const firstCompletedAt = first.json.data.completedAt;

        await new Promise(r => setTimeout(r, 20));
        const second = await api('PUT', '/sessions/complete', { token });
        assert.equal(second.status, 200);
        assert.equal(second.json.data.completedAt, firstCompletedAt, 'ikinci çağrı completedAt\'i değiştirmemeli');
        assert.equal(second.json.data.duration, firstDuration, 'ikinci çağrı duration\'ı büyütmemeli');
        assert.equal(second.json.data.totalWords, first.json.data.totalWords, 'sayaçlar aynı kalmalı');

        const events = await Event.countDocuments({ user: (await User.findOne({ email: 'guvenlik@test.com' }))._id, type: 'session_completed' });
        assert.equal(events, 1, 'ikinci tamamlama ayrı bir session_completed event\'i YAZMAMALI');
    });

    it('complete KENDİLİĞİNDEN yeni havuz AÇMAZ: today aynı havuzu döndürür', async () => {
        // Eskiden complete havuzu "kapandı" damgalıyor, bir sonraki /today
        // çağrısı taze bir 20'lik set üretiyordu: kullanıcı yalnızca ekrana
        // dönerek üstüne yeni kelimeler alıyordu ("tekrar başlarken üstüne
        // 20lik daha soruyor"). Artık ikinci havuz yalnızca açık istekle açılır.
        const oncesi = await api('GET', '/userwords/today', { token });
        const oncekiIds = oncesi.json.data.newWords.map(w => String(w._id)).sort();

        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        const sonrasi = await api('GET', '/userwords/today', { token });

        assert.equal(sonrasi.json.data.poolNo, 1, 'hâlâ günün ilk havuzu');
        assert.deepEqual(sonrasi.json.data.newWords.map(w => String(w._id)).sort(), oncekiIds,
            'complete sonrası aynı havuz dönmeli, taze set ÜRETİLMEMELİ');
        assert.ok(sonrasi.json.data.progress.remaining > 0, 'dokunulmamış kelimeler duruyor');
    });
});

describe('Havuz kuralları (21.09.2026): kapı, kilit ve ikinci havuz', () => {
    let token, userId;

    before(async () => {
        const u = await createVerifiedUser('havuz@test.com', { dailyGoal: 6 });
        userId = u._id;
        token = (await login('havuz@test.com')).accessToken;
    });

    it('havuz dışındaki kelimeye cevap verilemez (API ile seviye açma kapısı)', async () => {
        await api('GET', '/userwords/today', { token });
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });

        // Hesabının anahtarını bilen biri uygulamayı hiç kullanmadan doğrudan
        // API'ye "correct" gönderip yüzlerce kelimeyi ilerletebiliyordu.
        const disarida = await Word.findOne({ jlptLevel: 'N4' });
        const res = await api('POST', '/userwords/answer', {
            token, body: { wordId: disarida._id, result: 'correct' }
        });
        assert.equal(res.status, 400);
        assert.match(res.json.message, /havuzunda değil/);
        assert.equal(await UserWord.countDocuments({ user: userId, word: disarida._id }), 0,
            'reddedilen cevap kayıt da oluşturmamalı');
    });

    it('hiç kelimeye dokunmadan ders bitirilemez', async () => {
        const res = await api('PUT', '/sessions/complete', { token });
        assert.equal(res.status, 400, 'hiç çalışmadan "Tebrikler" ekranı anlamsız');
        assert.match(res.json.message, /dokunmadan/);
    });

    it('dokunulmamış kelime varken ders BİTİRİLEBİLİR ama havuz kilitlenmez', async () => {
        const d = (await api('GET', '/userwords/today', { token })).json.data;
        await api('POST', '/userwords/answer', { token, body: { wordId: d.queue[0], result: 'correct' } });

        // Bitirmek = "bitiş ekranını gördüm". Kullanıcı sonra dönüp devam edebilir.
        const bitir = await api('PUT', '/sessions/complete', { token });
        assert.equal(bitir.status, 200);
        assert.equal(bitir.json.data.canOpenNextPool, false, '5 kelime dokunulmadı');

        const sonra = (await api('GET', '/userwords/today', { token })).json.data;
        assert.equal(sonra.poolNo, 1, 'havuz kilitlenmedi, yeni havuz da açılmadı');
        assert.equal(sonra.progress.remaining, 5, 'kalan kelimeler duruyor');
        assert.equal(sonra.canFinish, true);

        const yeni = await api('POST', '/sessions/next-pool', { token });
        assert.equal(yeni.status, 400, 'havuz bitmeden ikinci havuz açılamaz');
        assert.equal(yeni.json.details.remaining, 5);
    });

    it('ikinci havuz önce VADESİ GELMİŞ TEKRARLARDAN kurulur', async () => {
        // Kalan kelimeleri bitir → kapı açılsın
        const d = (await api('GET', '/userwords/today', { token })).json.data;
        for (const id of d.queue) {
            await api('POST', '/userwords/answer', { token, body: { wordId: id, result: 'correct' } });
        }

        // Havuz dışında vadesi gelmiş iki tekrar hazırla
        const havuz = await DailyWordPool.findOne({ user: userId, poolNo: 1 }).sort({ date: -1 });
        const disarisi = await Word.find({
            jlptLevel: 'N5', isCore: true, _id: { $nin: havuz.newWordIds }
        }).limit(3);
        for (const w of disarisi) {
            await UserWord.create({
                user: userId, word: w._id, status: 'learning',
                masteryLevel: 2, repetitions: 1, interval: 1, easeFactor: 2.5,
                nextReviewDate: new Date(Date.now() - 86400000)
            });
        }

        const yeni = await api('POST', '/sessions/next-pool', { token });
        assert.equal(yeni.status, 201);
        // dailyGoal 6 → ikinci havuz 3 kelime; üçü de vadesi gelmiş tekrar olmalı.
        // Yeni kelime ancak tekrar kalmayınca girer: aynı gün iki kat yeni kelime
        // ertesi güne iki kat tekrar borcu demektir.
        assert.equal(yeni.json.data.progress.total, 3, 'hedefin yarısı');
        assert.equal(yeni.json.data.reviewWords.length, 3, 'önce borç: vadesi gelmiş tekrarlar');
        assert.equal(yeni.json.data.newWords.length, 0);
    });
});

describe('Havuz geçiş betiği (eski kayıtlar)', () => {
    it('eski şemadaki havuzlara poolNo/startedAt yazar, eski indeksi düşürür, iki kez çalışsa da bozmaz', async () => {
        const { migratePools, ESKI_INDEX } = require('../scripts/migrate-pools');
        const db = mongoose.connection.db;
        const col = db.collection('dailywordpools');

        const u = await createVerifiedUser('gecis@test.com');
        const eskiTarih = new Date('2026-09-01T00:00:00.000Z');
        const eskiBaslangic = new Date('2026-09-01T06:30:00.000Z');

        // Eski şemadaki iki kayıt: biri roundStartedAt'li, biri hiç
        await col.insertMany([
            { user: u._id, date: eskiTarih, jlptLevel: 'N5', newWordIds: [], reviewWordIds: [],
              roundStartedAt: eskiBaslangic, roundClosedAt: new Date(), targetGoal: 20 },
            { user: u._id, date: new Date('2026-09-02T00:00:00.000Z'), jlptLevel: 'N5',
              newWordIds: [], reviewWordIds: [], targetGoal: 20 }
        ]);
        // Eski indeksi kur ki betik onu düşürebilsin. Canlıda bu indeks TEKİL;
        // testte tekil kurulamaz, çünkü yeni model aynı gün+seviyeye iki havuz
        // (poolNo 1 ve 2) yazıyor ve önceki testler bunu zaten yaptı — düşürme
        // yolu adla çalıştığı için kısıt olmadan da aynı yolu sınar.
        await col.createIndex({ user: 1, date: 1, jlptLevel: 1 }, { name: ESKI_INDEX });

        const sonuc = await migratePools(db);
        assert.equal(sonuc.poolNo, 2, 'iki eski kayda da poolNo:1 yazılmalı');
        assert.equal(sonuc.startedAt, 2);
        assert.equal(sonuc.indexDropped, true);

        const taşınan = await col.findOne({ user: u._id, date: eskiTarih });
        assert.equal(taşınan.poolNo, 1);
        assert.equal(taşınan.startedAt.getTime(), eskiBaslangic.getTime(),
            'roundStartedAt → startedAt taşınmalı');
        assert.ok(taşınan.roundStartedAt, 'eski alan SİLİNMEZ: geri dönüş mümkün kalsın');

        const tarihsiz = await col.findOne({ user: u._id, date: new Date('2026-09-02T00:00:00.000Z') });
        assert.equal(tarihsiz.startedAt.getTime(), new Date('2026-09-02T00:00:00.000Z').getTime(),
            'roundStartedAt yoksa güne düşülür');

        // İdempotent: ikinci çalıştırma hiçbir şeye dokunmamalı
        const ikinci = await migratePools(db);
        assert.deepEqual(ikinci, { poolNo: 0, startedAt: 0, indexDropped: false });
    });
});

describe('Kaldırılan uçlar (21.09.2026)', () => {
    let token;

    before(async () => {
        await createVerifiedUser('kaldirilan@test.com');
        token = (await login('kaldirilan@test.com')).accessToken;
    });

    it('takvim, gün detayı ve elle sayaç güncelleme uçları artık YOK', async () => {
        // Takvim ekranı tasarımda yok; yedi günlük şerit /home/summary içinde
        // geliyor. /sessions/update ise kelime kontrolü olmadan günün sayacını
        // artırabiliyordu ve mobil hiç çağırmıyordu.
        for (const [method, path, body] of [
            ['GET', '/home/calendar', null],
            ['GET', '/home/day/2026-09-21', null],
            ['PUT', '/sessions/update', { result: 'correct' }]
        ]) {
            const res = await api(method, path, { token, ...(body && { body }) });
            assert.equal(res.status, 404, `${method} ${path} kaldırıldı, 404 dönmeli`);
        }
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
        const today = await api('GET', '/userwords/today', { token });
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
        assert.equal(d.goal, 20, 'çemberin PAYDASI: bugünün havuz boyutu');
        assert.equal(d.dailyGoal, 20, 'ayarlardaki tercih değeri');
        assert.equal(d.today.totalWords, 2);
        assert.equal(d.today.correctCount, 1);
        assert.equal(d.today.wrongCount, 1);
        assert.equal(d.todayMistakeCount, 1, '"Bugünün Hataları — N Hata" başlığı için');
        assert.equal(d.streak.current, 1);

        // Seviye Tespit Sınavı modalı için ayrı bir /quiz/status isteği gerekmesin
        assert.equal(d.placementAvailable, true, 'Başla butonu aktif mi');
        assert.equal(d.nextAttemptAllowedAt, null, 'cooldown yoksa null');

        // Yeni tasarımda karşılığı olmayan alanlar yanıttan KALDIRILDI
        assert.ok(!('tomorrowReviews' in d), 'okunmayan alan yanıtta durmamalı');
        assert.ok(!('pendingReviews' in d));
        assert.ok(!('progress' in d));
    });

    it('başlık bloğu: Japonca selamlama, avatar alanı ve zil rozeti', async () => {
        const d = (await api('GET', '/home/summary', { token })).json.data;

        assert.ok(
            ['おはようございます', 'こんにちは', 'こんばんは'].includes(d.greeting),
            'ismin üstündeki satır kullanıcının saat dilimine göre seçilir'
        );
        assert.ok('avatarUrl' in d, 'fotoğrafı olmayan hesapta da sözleşmede durmalı');
        assert.equal(d.avatarUrl, null, 'fotoğraf yüklenmemişse null — istemci baş harf çizer');

        assert.equal(d.unreadNotifications, 0);
        const me = (await api('GET', '/auth/me', { token })).json.data;
        await NotificationService.create(me._id, { type: 'test', title: 'T', body: 'B' });
        const sonra = (await api('GET', '/home/summary', { token })).json.data;
        assert.equal(sonra.unreadNotifications, 1, 'zil ikonunun rozeti');
    });

    it('hata kartı: başlıktaki sayının altında kelime çipleri döner', async () => {
        const d = (await api('GET', '/home/summary', { token })).json.data;

        assert.equal(d.todayMistakes.length, 1, 'ikinci bir istek gerekmemeli');
        assert.equal(d.todayMistakes.length, d.todayMistakeCount,
            'çipler başlıktaki sayıyla AYNI kümeden gelmeli');
        const [cip] = d.todayMistakes;
        assert.ok(cip.id && cip.kanji && cip.romaji, 'çipte yazan yazı ve kimlik');
        assert.ok(['N5', 'N4', 'N3', 'N2', 'N1'].includes(cip.jlptLevel));
    });

    it('seri şeridi: Pazartesi→Pazar yedi gün, bugün çalışılmış işaretli', async () => {
        const d = (await api('GET', '/home/summary', { token })).json.data;
        const week = d.streak.week;

        assert.equal(week.length, 7);
        assert.deepEqual(week.map(g => g.weekday), [1, 2, 3, 4, 5, 6, 7], 'Pzt=1 … Paz=7');

        // Diziyi tarih sırası tutar; ilk gün Pazartesi olmalı
        assert.equal(new Date(week[0].date + 'T00:00:00Z').getUTCDay(), 1);
        assert.deepEqual([...week].sort((a, b) => a.date.localeCompare(b.date)).map(g => g.date),
            week.map(g => g.date), 'günler kronolojik sırada');

        const bugun = week.find(g => g.isToday);
        assert.ok(bugun, 'bugün her zaman haftanın içinde');
        assert.equal(bugun.date, todayStr);
        assert.equal(bugun.studied, true, 'before() içinde gerçek cevap verildi');
        assert.equal(bugun.isFuture, false);

        // Alev ile tiklerin aynı gerçeği anlatması şart. Kıyas SADECE bugün
        // üzerinden yapılabilir: seri haftaları aşar (Çarşamba günü 12 günlük
        // seride hafta içinde 3 tik olur), tik sayısı ile seri sayacı
        // birbirine EŞİT DEĞİLDİR.
        assert.ok(d.streak.current >= 1, 'bugün çalışıldıysa seri en az 1');
        assert.equal(localDay(d.streak.lastStudyDate), todayStr,
            'bugünün tiki ile serinin son çalışma günü aynı günü göstermeli');

        assert.ok(week.filter(g => g.date > todayStr).every(g => g.isFuture && !g.studied),
            'gelecek günler kesikli daire olarak çizilir');
        assert.ok(week.filter(g => g.date < todayStr).every(g => !g.isFuture));
    });

    it('hedef değişimi çemberin paydasını ANINDA oynatmaz; payda havuzla birlikte büyür', async () => {
        await api('PUT', '/auth/update-info', { token, body: { dailyGoal: 40 } });

        let res = await api('GET', '/home/summary', { token });
        assert.equal(res.json.data.goal, 20, 'havuz büyümeden payda değişmez (20/40 tutarsızlığı olmaz)');
        assert.equal(res.json.data.dailyGoal, 40, 'tercih değeri ise anında güncellenir');

        // Havuz bir sonraki today çağrısında genişler; payda onunla birlikte büyür
        await api('GET', '/userwords/today', { token });
        res = await api('GET', '/home/summary', { token });
        assert.equal(res.json.data.goal, 30, 'test setinde 30 core N5 var: 20 + kalan 10');
    });
});

describe('Ders sayacı — "Şimdilik Geç" ilerleme sayılmaz', () => {
    // 06.08.2026'da bildirilen hata: 20 kelimenin hepsi ertelenince başlık
    // "20/20 Tamamlandı" diyor ama ders bitmiyor, kuyruğu baştan soruyordu.
    // Sebep: pay (totalWords) kelimeye DOKUNULUNCA artıyordu, ders ise ancak
    // her kelimenin NİHAİ cevabı olunca bitiyor — iki farklı "bitti" tanımı.
    let token, words;

    before(async () => {
        await createVerifiedUser('sayac@test.com', { dailyGoal: 20 });
        token = (await login('sayac@test.com')).accessToken;
        const today = await api('GET', '/userwords/today', { token });
        words = today.json.data.newWords;
        assert.equal(words.length, 20, 'havuz 20 kelime olmalı');
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
    });

    it('hepsi ertelenince sayaç 0/20 kalır (20/20 DEĞİL)', async () => {
        for (const w of words) {
            await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'empty' } });
        }

        const d = (await api('GET', '/userwords/today', { token })).json.data;
        assert.equal(d.today.completedWords, 0, 'hiçbirinin nihai cevabı yok');
        assert.equal(d.today.totalWords, 20, 'dokunulan kelime sayısı ise 20');
        assert.equal(d.today.emptyCount, 20);

        // Havuzun kendi sayaçları: 20'si de ertelenmiş, dokunulmamış kalmadı
        assert.equal(d.progress.completed, 0);
        assert.equal(d.progress.postponed, 20);
        assert.equal(d.progress.remaining, 0);
        // Ertelenenler AYNI DERS İÇİNDE geri gelir (21.09.2026): kuyruk boş
        // kalsaydı kullanıcı o kelimeleri bir daha göremez, ikinci havuzun
        // kapısını da asla açamazdı.
        assert.equal(d.queue.length, 20, 'ertelenenler kuyruğa geri döner');
        assert.equal(d.canFinish, true, 'dokunulmuş kelime var, ders bitirilebilir');
        assert.equal(d.canOpenNextPool, false, 'ertelenmiş kelime varken yeni havuz YOK');

        // Anasayfa çemberi ile ders başlığı AYNI payı kullanmalı
        const s = (await api('GET', '/home/summary', { token })).json.data;
        assert.equal(s.today.completedWords, 0, 'çember de %0 göstermeli');
    });

    it('ertelenmiş kelime varken ders bitirilir ama İKİNCİ HAVUZ açılamaz', async () => {
        const bitir = await api('PUT', '/sessions/complete', { token });
        assert.equal(bitir.status, 200, 'kullanıcı dersten çıkabilmeli');
        assert.equal(bitir.json.data.pendingWords, 20);
        assert.equal(bitir.json.data.canOpenNextPool, false);

        // İkinci havuz yalnızca havuz GERÇEKTEN bitince açılır: ne dokunulmamış
        // ne de ertelenmiş kelime kalacak. Böylece "Şimdilik Geç" dediklerini
        // bırakıp yeni kelimelere kaçmak mümkün olmuyor.
        const yeni = await api('POST', '/sessions/next-pool', { token });
        assert.equal(yeni.status, 400);
        assert.equal(yeni.json.details.postponed, 20);

        // Havuz duruyor: aynı kelimeler, hepsi kuyrukta, gün sayacı da yerinde
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        const d = (await api('GET', '/userwords/today', { token })).json.data;
        assert.equal(d.poolNo, 1, 'yeni havuz AÇILMADI');
        assert.equal(d.progress.total, 20);
        assert.equal(d.progress.postponed, 20);
        assert.equal(d.queue.length, 20, 'ertelenenler yeniden sorulabilir');
        assert.equal(d.today.emptyCount, 20, 'gün sayacı yerinde');

        const ilk = d.newWords.find(w => String(w._id) === String(words[0]._id));
        assert.equal(ilk.todayResult, 'empty', 'rozet için gün kapsamlı işaret duruyor');
        assert.equal(ilk.answeredToday, false, 'nihai cevap yok');
    });
});

describe('Anasayfa — hafta hesabı yaz saati geçişinde kaymaz', () => {
    // Şeridin 7 günü gerçek instant'lara 24 saat eklenerek üretilseydi, geçiş
    // haftasında bir gün (23/25 saat) atlanır ya da tekrarlanırdı.
    const { weekDatesInTz } = require('../utils/date.util');

    it('geçişin OLDUĞU hafta yedi ayrı gün döner ve Pazartesi başlar', () => {
        // Avrupa'da yaz saati 29.03.2026 Pazar; o günü içeren hafta
        const week = weekDatesInTz('Europe/Berlin', new Date('2026-03-25T12:00:00Z'));
        assert.deepEqual(week, [
            '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26',
            '2026-03-27', '2026-03-28', '2026-03-29'
        ]);
    });

    it('geçişten hemen sonraki gün yeni haftaya sayılır', () => {
        // Berlin'de 30.03 saat 02:30 (UTC+2) — Pazartesi, yeni hafta
        const week = weekDatesInTz('Europe/Berlin', new Date('2026-03-30T00:30:00Z'));
        assert.equal(week[0], '2026-03-30');
        assert.equal(week[6], '2026-04-05');
    });

    it('kullanıcının saat dilimi haftayı belirler, sunucununki değil', () => {
        // Bu an Istanbul'da Pazartesi 00:30 (yeni hafta başladı),
        // Los Angeles'ta ise hâlâ Pazar 14:30 (önceki hafta sürüyor)
        const at = new Date('2026-08-02T21:30:00Z');
        assert.equal(weekDatesInTz('Europe/Istanbul', at)[0], '2026-08-03');
        assert.equal(weekDatesInTz('America/Los_Angeles', at)[0], '2026-07-27');
    });
});

describe('Anasayfa — seri şeridi serinin kuralına uyar', () => {
    it('"Şimdilik Geç" günü çalışılmış saymaz (alev yanmıyorsa tik de yok)', async () => {
        await createVerifiedUser('serit@test.com');
        const token = (await login('serit@test.com')).accessToken;

        const today = await api('GET', '/userwords/today', { token });
        const [w1] = today.json.data.newWords;
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        await api('POST', '/userwords/answer', { token, body: { wordId: w1._id, result: 'empty' } });

        const d = (await api('GET', '/home/summary', { token })).json.data;
        const bugun = d.streak.week.find(g => g.isToday);

        assert.equal(d.streak.current, 0, 'boş geçmek seriyi başlatmaz');
        assert.equal(d.today.totalWords, 1, 'oturum sayacına ise yazılır');
        assert.equal(bugun.studied, false,
            'totalWords>0 diye tik basılsaydı şerit "12 gün" derken hafta boş görünürdü');
    });

    it('hata çipleri önizlemedir: sayı tamamı verir, liste sınırlanır', async () => {
        await createVerifiedUser('cip@test.com');
        const token = (await login('cip@test.com')).accessToken;

        const today = await api('GET', '/userwords/today', { token });
        const words = today.json.data.newWords.slice(0, 9);
        assert.equal(words.length, 9, 'test setinde 9 kelime bulunmalı');

        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        for (const w of words) {
            await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'wrong' } });
        }

        const d = (await api('GET', '/home/summary', { token })).json.data;
        assert.equal(d.todayMistakeCount, 9, 'başlıktaki sayı TAMAMIDIR');
        assert.equal(d.todayMistakes.length, 8, 'çipler ilk 8 ile sınırlı');
    });
});

describe('Anasayfa — çoklu tur: payda SABİT kalır, pay hedefi aşabilir', () => {
    let token;

    it('ikinci havuz: goal SABİT kalır, hedefin üstü today.extra olur', async () => {
        await createVerifiedUser('coklutur@test.com', { dailyGoal: 5 });
        token = (await login('coklutur@test.com')).accessToken;

        // Günün havuzu: 5 kelime, hepsini cevapla, dersi bitir
        let today = await api('GET', '/userwords/today', { token });
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        const ilkHavuz = today.json.data.newWords.map(w => String(w._id));
        for (const id of ilkHavuz) {
            await api('POST', '/userwords/answer', { token, body: { wordId: id, result: 'correct' } });
        }
        const bitir = await api('PUT', '/sessions/complete', { token });
        assert.equal(bitir.json.data.canOpenNextPool, true, 'havuz gerçekten bitti');

        let summary = await api('GET', '/home/summary', { token });
        assert.equal(summary.json.data.goal, 5, 'günün hedefi 5');
        assert.equal(summary.json.data.today.completedWords, 5, 'çember dolu');
        assert.equal(summary.json.data.today.extra, 0);

        // İkinci havuz AÇIK İSTEKLE açılır ve hedefin YARISI kadardır
        const ikinci = await api('POST', '/sessions/next-pool', { token });
        assert.equal(ikinci.status, 201);
        assert.equal(ikinci.json.data.poolNo, 2);
        assert.equal(ikinci.json.data.progress.total, 3, 'hedefin yarısı (5 → 3)');
        assert.equal(ikinci.json.data.goal, 5, 'GÜNÜN hedefi değişmez');
        const ikinciIds = ikinci.json.data.newWords.map(w => String(w._id));
        assert.ok(ikinciIds.every(id => !ilkHavuz.includes(id)),
            'ikinci havuz birinci havuzun kelimelerini içermez');

        // Ekstra havuzdaki cevap çemberi DÜŞÜRMEZ, extra'yı artırır
        const ans = await api('POST', '/userwords/answer', {
            token, body: { wordId: ikinciIds[0], result: 'correct' }
        });
        assert.equal(ans.json.data.goal, 5, 'payda hâlâ 5 — büyümedi');
        assert.equal(ans.json.data.today.completedWords, 6);
        assert.equal(ans.json.data.today.extra, 1, 'hedefin üstündeki iş ayrı sayılır');
        assert.equal(ans.json.data.poolNo, 2);

        summary = await api('GET', '/home/summary', { token });
        assert.equal(summary.json.data.goal, 5, 'anasayfa da aynı sabit paydayı görür');
        assert.equal(summary.json.data.today.extra, 1);

        // Günde en fazla 2 havuz
        const ucuncu = await api('POST', '/sessions/next-pool', { token });
        assert.equal(ucuncu.status, 400);
        assert.match(ucuncu.json.message, /en fazla 2 havuz/);
    });
});

describe('Oturum durumu sunucuda (GET /sessions/current)', () => {
    let token, words;

    before(async () => {
        await createVerifiedUser('oturum@test.com', { dailyGoal: 5 });
        token = (await login('oturum@test.com')).accessToken;
    });

    it('havuz yokken null döner — yan etkisi yoktur (havuz/oturum AÇMAZ)', async () => {
        const res = await api('GET', '/sessions/current', { token });
        assert.equal(res.status, 200);
        assert.equal(res.json.data, null, 'istemci normal akışa girsin: start + today');

        const pools = await mongoose.connection.db.collection('dailywordpools')
            .countDocuments({ user: (await User.findOne({ email: 'oturum@test.com' }))._id });
        assert.equal(pools, 0, 'okuma ucu havuz AÇMAMALI');
        const s = await api('GET', '/sessions/today', { token });
        assert.equal(s.json.data, null, 'oturum da açmamalı');
    });

    it('kuyruk sunucudan gelir: cevaplanan düşer, ertelenen kuyruğun SONUNA gider', async () => {
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        words = (await api('GET', '/userwords/today', { token })).json.data.newWords;
        assert.equal(words.length, 5);

        let d = (await api('GET', '/sessions/current', { token })).json.data;
        assert.equal(d.queue.length, 5);
        assert.equal(d.currentIndex, 0, 'queue "kalan"dır, kaldığın yer her zaman queue[0]');
        assert.equal(d.jlptLevel, 'N5');
        assert.ok(d.sessionId, 'GÜNÜN oturum kimliği');
        assert.deepEqual(d.progress, { total: 5, completed: 0, postponed: 0, remaining: 5, touched: 0 });

        await api('POST', '/userwords/answer', { token, body: { wordId: words[0]._id, result: 'correct' } });
        await api('POST', '/userwords/answer', { token, body: { wordId: words[1]._id, result: 'empty' } });

        d = (await api('GET', '/sessions/current', { token })).json.data;
        assert.deepEqual(d.completedIds.map(String), [String(words[0]._id)]);
        assert.deepEqual(d.postponedIds.map(String), [String(words[1]._id)]);
        assert.equal(d.queue.length, 4, 'cevaplanan düşer; ertelenen kuyrukta KALIR');
        assert.equal(String(d.queue.at(-1)), String(words[1]._id),
            'ertelenen kelime en sona gider: kullanıcı aynı kelimeyi arka arkaya görmez');
        assert.deepEqual(d.progress, { total: 5, completed: 1, postponed: 1, remaining: 3, touched: 2 });
        assert.equal(d.canFinish, true);
        assert.equal(d.canOpenNextPool, false, 'dokunulmamış 3 kelime var');
    });

    it('kuyruk sırası SABİTTİR: iki çağrı aynı sırayı verir (uygulama silinse de aynı yerden devam)', async () => {
        const a = (await api('GET', '/sessions/current', { token })).json.data.queue.map(String);
        const b = (await api('GET', '/sessions/current', { token })).json.data.queue.map(String);
        const c = (await api('GET', '/userwords/today', { token })).json.data.queue.map(String);
        assert.deepEqual(a, b, '$in sırayı garanti etmez; havuz sırası korunmalı');
        assert.deepEqual(a, c, '/sessions/current ile /userwords/today aynı kuyruğu vermeli');
    });

    it('ertelenmiş kelime tekrar ertelenebilir: sayaç oynamaz, kelime sona gider', async () => {
        // 21.09.2026 bulgusu: eskiden bu cevap tamamen yok sayılıyordu, kelime
        // kuyruğun başında takılı kalıyor ve aynı kelime sonsuza dek soruluyordu.
        const once = (await api('GET', '/sessions/current', { token })).json.data;
        const ertelenen = String(once.postponedIds[0]);

        // Önce başka bir kelimeyi de ertele ki sıralama görülebilsin
        const digeri = once.queue.map(String).find(id => id !== ertelenen);
        await api('POST', '/userwords/answer', { token, body: { wordId: digeri, result: 'empty' } });

        const tekrar = await api('POST', '/userwords/answer', { token, body: { wordId: ertelenen, result: 'empty' } });
        assert.equal(tekrar.json.data.counted, false, 'aynı kelime ikinci kez empty sayılmaz');
        assert.equal(tekrar.json.data.today.emptyCount, 2, 'gün sayacı şişmedi');

        const d = (await api('GET', '/sessions/current', { token })).json.data;
        assert.equal(String(d.queue.at(-1)), ertelenen,
            'yeniden ertelenen kelime kuyruğun EN SONUNA gider');
        assert.equal(d.progress.postponed, 2);
    });

    it('ikinci havuz: ertelenenler cevaplanınca kapı açılır', async () => {
        // Bu noktada 1 cevaplanmış + 2 ertelenmiş + 2 dokunulmamış kelime var
        let d = (await api('GET', '/sessions/current', { token })).json.data;
        assert.equal(d.canOpenNextPool, false);

        for (const id of d.queue) {
            await api('POST', '/userwords/answer', { token, body: { wordId: id, result: 'correct' } });
        }

        d = (await api('GET', '/sessions/current', { token })).json.data;
        assert.equal(d.progress.remaining, 0);
        assert.equal(d.progress.postponed, 0);
        assert.equal(d.canOpenNextPool, true, 'havuz gerçekten bitti: kapı açık');

        const yeni = await api('POST', '/sessions/next-pool', { token });
        assert.equal(yeni.status, 201);
        assert.equal(yeni.json.data.poolNo, 2);
        assert.equal(yeni.json.data.canOpenNextPool, false, 'ikinci havuzdan üçüncü açılmaz');
    });
});

describe('Seviyeler ekranı', () => {
    let token;

    before(async () => {
        await createVerifiedUser('seviye@test.com');
        token = (await login('seviye@test.com')).accessToken;
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        const today = await api('GET', '/userwords/today', { token });
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

// Kayıt akışı her hesaba 5 seviye kaydı açar; bu blok kayıtların HERHANGİ bir
// sebeple eksik olduğu hesabı tarif eder (akış dışında doğmuş hesap, koleksiyon
// temizliği, eski veri). Eskiden sonuç sessiz yanlış davranıştı: liste boş,
// anasayfa bandı yok, %75'i geçen kullanıcının cevabı 500.
describe('Seviye kayıtları eksik hesap (onarım)', () => {
    // createVerifiedUser'ın initializeProgress ÇAĞIRMAYAN hâli
    const createUserWithoutProgress = async (email) => {
        const user = await User.create({
            name: 'Test', surname: 'User', email,
            password: 'Testsifre123!', isEmailVerified: true
        });
        await StreakService.initializeStreak(user._id);
        return user;
    };

    it('seviye listesi BOŞ dönmez: eksik kayıtlar okuma anında onarılır', async () => {
        const user = await createUserWithoutProgress('kayitsiz@test.com');
        assert.equal(await Progress.countDocuments({ user: user._id }), 0, 'senaryo: hiç kayıt yok');

        const token = (await login('kayitsiz@test.com')).accessToken;
        const res = await api('GET', '/progress', { token });

        assert.equal(res.status, 200);
        assert.equal(res.json.data.levels.length, 5, 'liste boş dönerdi — asıl hata buydu');
        assert.deepEqual(
            res.json.data.levels.map(l => l.jlptLevel),
            ['N1', 'N2', 'N3', 'N4', 'N5'],
            'sıra tasarımdaki gibi kalmalı (kilitli üstte, N5 altta)'
        );

        const n5 = res.json.data.levels.find(l => l.jlptLevel === 'N5');
        assert.ok(n5.isUnlocked, 'kayıttaki kural: yalnızca N5 açık doğar');
        assert.equal(n5.state, 'active');
        assert.equal(res.json.data.levels.find(l => l.jlptLevel === 'N4').isUnlocked, false);

        assert.equal(await Progress.countDocuments({ user: user._id }), 5,
            'onarım DB\'ye yazılmalı, yalnızca yanıtı süslememeli');
    });

    it('onarım mevcut ilerlemeyi BOZMAZ: açık seviye ve oran yerinde kalır', async () => {
        const user = await createVerifiedUser('kayit-eksik@test.com');
        await Progress.updateOne(
            { user: user._id, jlptLevel: 'N4' },
            { isUnlocked: true, unlockedAt: new Date(), unlockedBy: 'quiz' }
        );
        await Progress.updateOne({ user: user._id, jlptLevel: 'N5' }, { completionRate: 60 });
        // Tek kayıt eksilsin: onarım tetiklenir ama diğer dördüne dokunmamalı
        await Progress.deleteOne({ user: user._id, jlptLevel: 'N3' });

        const token = (await login('kayit-eksik@test.com')).accessToken;
        const res = await api('GET', '/progress', { token });
        const byLevel = Object.fromEntries(res.json.data.levels.map(l => [l.jlptLevel, l]));

        assert.equal(res.json.data.levels.length, 5);
        assert.equal(byLevel.N4.isUnlocked, true, 'quiz ile açılmış seviye tekrar kilitlenemez');
        assert.equal(byLevel.N5.completionRate, 60, 'ilerleme sıfırlanamaz');
        assert.equal(byLevel.N3.isUnlocked, false, 'yeni doğan kayıt kilitli olmalı');
        assert.equal((await Progress.findOne({ user: user._id, jlptLevel: 'N4' })).unlockedBy, 'quiz');
    });

    it('seviye değiştirme eksik kayıtlı hesapta 404 vermez', async () => {
        await createUserWithoutProgress('kayitsiz-gecis@test.com');
        const token = (await login('kayitsiz-gecis@test.com')).accessToken;

        const res = await api('PUT', '/progress/active-level', { token, body: { jlptLevel: 'N5' } });
        assert.equal(res.status, 200, 'eskiden "Progress not found" 404\'ü dönüyordu');
        assert.equal(res.json.data.activeLevel, 'N5');
        assert.equal(res.json.data.levels.length, 5);
    });

    it('%75 eşiğini geçen kayıtsız hesapta cevap akışı 500 vermez', async () => {
        const user = await createUserWithoutProgress('kayitsiz-esik@test.com');
        // N5'in tamamı ezberlenmiş: eşik aşılır, seviye kilidi kontrolü çalışır
        const n5 = await Word.find({ jlptLevel: 'N5', isCore: true });
        await UserWord.insertMany(n5.map(w => ({
            user: user._id, word: w._id, masteryLevel: 5, status: 'learned'
        })));

        // Eskiden burası TypeError atıyordu: findOne null dönüyor, isUnlocked okunuyordu
        const result = await ProgressService.checkAndUnlockNextLevel(user._id, 'N5');
        assert.deepEqual(result, { unlocked: true, level: 'N4' });
        assert.equal((await Progress.findOne({ user: user._id, jlptLevel: 'N5' })).completionRate, 100,
            'oran da yazılabilmeli (kayıt yokken hiçbir yere yazılamıyordu)');
    });
});

// Uygulamadaki her kelime sorgusu isCore:true filtreler. Alan sonradan
// eklendiği için ondan ÖNCE yazılmış kayıtlarda alan hiç yoktur (mongoose'un
// default: false değeri var olan dokümanlara uygulanmaz) — bu kayıtlar
// uygulamaya tamamen görünmezdir ve hiçbir uç hata vermez.
describe('Çekirdek kelime sayımı (seed teşhisi)', () => {
    it('seviye başına isCore sayısı döner — açılış logu bunu basar', async () => {
        const counts = await WordService.coreWordCounts();
        assert.deepEqual(Object.keys(counts), ['N5', 'N4', 'N3', 'N2', 'N1']);
        assert.equal(counts.N5, 30);
        assert.equal(counts.N4, 50);
        assert.equal(counts.N3, 30);
    });

    it('isCore alanı olmayan kelime ne sayıma ne listeye girer', async () => {
        const eski = await Word.collection.insertOne({
            kanji: '旧語', romaji: 'kyuugo', meaning: 'sema oncesi kayit',
            type: 'isim', jlptLevel: 'N5'
        });
        try {
            const counts = await WordService.coreWordCounts();
            assert.equal(counts.N5, 30, 'isCore alanı olmayan kayıt çekirdek sayılmaz');

            const token = (await login('seviye@test.com')).accessToken;
            const list = await api('GET', '/words?q=kyuugo', { token });
            assert.equal(list.json.data.total, 0, 'kütüphanede de görünmez');
        } finally {
            await Word.collection.deleteOne({ _id: eski.insertedId });
        }
    });
});

describe('Hafıza ekranı', () => {
    let token, userId, n5Words, trackingSinceBackup;

    // Tasarımdaki beş kutunun masteryLevel karşılığı mockup'ın kendi
    // sayılarından doğrulandı: 76+57+46+106+95 = 380 (seviyenin TÜM kelimeleri)
    // ve (46+106+95)/380 = %65, karttaki oranla birebir. Yani Orta+İyi+Ezber =
    // masteryLevel >= 3 = seviye kilidini açan küme.
    before(async () => {
        const user = await createVerifiedUser('hafiza@test.com');
        userId = user._id;
        token = (await login('hafiza@test.com')).accessToken;

        // "Bu hafta iyiye geçti" çipi, izleme başlangıcından önceki haftalarda
        // bilerek null döner; testte tarih geriye çekilip sayı doğrulanıyor.
        trackingSinceBackup = process.env.MEMORY_TRACKING_SINCE;
        process.env.MEMORY_TRACKING_SINCE = '2020-01-01T00:00:00.000Z';

        // /memory/words?box=new ile AYNI sıralama; listenin başındaki kelimeyi
        // burada da bilelim
        n5Words = await Word.find({ jlptLevel: 'N5', isCore: true }).sort({ frequencyRank: 1, _id: 1 });

        // Zayıf 3 (1,1,2) · Orta 1 · İyi 2 · Ezber 1 → sayılan 4 kelime.
        // nextReviewDate GELECEKTE: decay testi bu kayıtlara dokunmasın.
        const mk = (word, masteryLevel) => ({
            user: userId, word: word._id, status: 'learning', masteryLevel,
            repetitions: masteryLevel, interval: masteryLevel * 3, easeFactor: 2.5,
            nextReviewDate: new Date(Date.now() + 30 * 86400000)
        });
        await UserWord.insertMany([
            mk(n5Words[0], 1), mk(n5Words[1], 1), mk(n5Words[2], 2),
            mk(n5Words[3], 3), mk(n5Words[4], 4), mk(n5Words[5], 4), mk(n5Words[6], 5)
        ]);
    });

    after(() => {
        if (trackingSinceBackup === undefined) delete process.env.MEMORY_TRACKING_SINCE;
        else process.env.MEMORY_TRACKING_SINCE = trackingSinceBackup;
    });

    it('beş kutu seviyenin tamamını böler, oran kutulardan türetilir', async () => {
        const res = await api('GET', '/memory', { token });
        assert.equal(res.status, 200);
        const d = res.json.data;

        assert.equal(d.jlptLevel, 'N5');
        assert.equal(d.isActiveLevel, true);
        assert.deepEqual(d.boxes.map(b => b.key), ['new', 'weak', 'medium', 'good', 'mastered']);

        const count = k => d.boxes.find(b => b.key === k).count;
        assert.equal(count('weak'), 3, 'Zayıf kutusu masteryLevel 1 ve 2\'yi birlikte tutar');
        assert.equal(count('medium'), 1);
        assert.equal(count('good'), 2);
        assert.equal(count('mastered'), 1);
        assert.equal(count('new'), d.totalWords - 7, 'Yeni = hiç dokunulmamış kelimeler');

        // Kutuların toplamı seviyenin tamamıdır — mockup'taki 380 sayısının kuralı
        assert.equal(d.boxes.reduce((s, b) => s + b.count, 0), d.totalWords);

        // %65 / %75 çubuğu: pay yalnızca countsTowardUnlock kutularından gelir
        assert.deepEqual(
            d.boxes.filter(b => b.countsTowardUnlock).map(b => b.key),
            ['medium', 'good', 'mastered']
        );
        assert.equal(d.completionThreshold, 75);
        assert.equal(d.completionRate, Math.round((4 / d.totalWords) * 100));
        assert.equal(d.remainingPercent, Math.max(0, 75 - d.completionRate));

        assert.deepEqual(d.nextLevel, { jlptLevel: 'N4', label: 'Temel', isUnlocked: false });
        assert.equal(d.unlockHint, 'Orta, İyi ve Ezber kutularının toplamı %75\'i geçince N4 açılır.');
        assert.equal(d.defaultBox, 'weak');
    });

    it('seviye kartındaki oran GET /progress ile aynı sayıyı verir', async () => {
        // Aynı eşik iki ekranda iki farklı sayı gösteremez
        await ProgressService.checkAndUnlockNextLevel(userId, 'N5');
        const [mem, prog] = await Promise.all([
            api('GET', '/memory', { token }),
            api('GET', '/progress', { token })
        ]);
        const n5 = prog.json.data.levels.find(l => l.jlptLevel === 'N5');
        assert.equal(mem.json.data.completionRate, n5.completionRate);
    });

    it('Yeni kutusu hiç dokunulmamış kelimeleri müfredat sırasında listeler', async () => {
        const res = await api('GET', '/memory/words?box=new&limit=5', { token });
        assert.equal(res.status, 200);
        const d = res.json.data;

        assert.equal(d.label, 'Yeni');
        assert.equal(d.jlptLevel, 'N5');
        assert.equal(d.items.length, 5);
        // İlk 7 kelimenin kaydı var; liste 8.'den başlamalı (frequencyRank sırası)
        assert.equal(d.items[0].word.kanji, n5Words[7].kanji);
        assert.equal(d.items[0].masteryLevel, null, 'kayıt yok, seviye de yok');

        // Listenin toplamı kutunun sayacıyla aynı olmalı: ekranda "76 Yeni"
        // yazıp listeye girince 60 kelime çıkması bu satırla imkânsız
        const mem = await api('GET', '/memory', { token });
        assert.equal(d.total, mem.json.data.boxes.find(b => b.key === 'new').count);

        const all = await api('GET', '/memory/words?box=new&limit=100', { token });
        assert.ok(all.json.data.items.every(i => i.box === 'new'));
        assert.ok(all.json.data.items.every(i => i.word.jlptLevel === 'N5' && i.word.isCore));
    });

    it('Zayıf kutusu 1. ve 2. seviyeleri birlikte döndürür', async () => {
        const res = await api('GET', '/memory/words?box=weak', { token });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.total, 3);
        assert.ok(res.json.data.items.every(i => [1, 2].includes(i.masteryLevel)));
        assert.ok(res.json.data.items[0].word.kanji, 'kelime dokümanı gömülü gelmeli');
    });

    it('geçersiz kutu 400 döner', async () => {
        const res = await api('GET', '/memory/words?box=ezberlendi', { token });
        assert.equal(res.status, 400);
        assert.match(res.json.message, /box:/);
    });

    it('haftalık çip yalnızca sayılan bölgeye YENİ girenleri sayar', async () => {
        const before = await api('GET', '/memory', { token });
        assert.equal(before.json.data.weeklyImproved, 0, 'promotedAt yazılmamış kayıtlar sayılmaz');

        await StudySessionService.startSession(userId, 'N5');
        // Cevap ucu havuz dışı kelimeyi kabul etmiyor (hile kapısı kapatıldı)
        await havuzaEkleId(userId, [n5Words[10]._id, n5Words[11]._id, n5Words[12]._id]);

        // 2 → 3: sayılan bölgeye GİRİŞ, çipe eklenir
        await UserWord.create({
            user: userId, word: n5Words[10]._id, status: 'learning',
            masteryLevel: 2, repetitions: 1, interval: 1, easeFactor: 2.5,
            nextReviewDate: new Date(Date.now() - 86400000)
        });
        const giren = await UserWordService.submitAnswer(userId, n5Words[10]._id, 'correct');
        assert.equal(giren.masteryLevel, 3);

        // 3 → 4: zaten bölgedeydi, çip ARTMAZ (yoksa her doğru cevap sayardı)
        await UserWord.create({
            user: userId, word: n5Words[11]._id, status: 'learning',
            masteryLevel: 3, repetitions: 2, interval: 6, easeFactor: 2.5,
            nextReviewDate: new Date(Date.now() - 86400000)
        });
        const zaten = await UserWordService.submitAnswer(userId, n5Words[11]._id, 'correct');
        assert.ok(zaten.masteryLevel >= 4);

        const after = await api('GET', '/memory', { token });
        assert.equal(after.json.data.weeklyImproved, 1);
    });

    it('bölgeden düşen kelimenin izi silinir (cevap ve decay yolunda)', async () => {
        // Cevap yolu: 3 → yanlış → 1. Kelime bugün zaten nihai cevabını aldı,
        // aynı gün ikinci cevap NÖTRDÜR — dünkü cevap gibi davransın diye
        // lastReviewDate geriye çekiliyor.
        await UserWord.updateOne(
            { user: userId, word: n5Words[10]._id },
            { lastReviewDate: new Date(Date.now() - 2 * 86400000) }
        );
        await UserWordService.submitAnswer(userId, n5Words[10]._id, 'wrong');

        const dusenCevap = await UserWord.findOne({ user: userId, word: n5Words[10]._id });
        assert.equal(dusenCevap.masteryLevel, 1);
        assert.equal(dusenCevap.promotedAt, null, 'yanlış cevap kelimeyi bölgeden çıkardı');

        const sonra = await api('GET', '/memory', { token });
        assert.equal(sonra.json.data.weeklyImproved, 0, 'düşen kelime çipte sayılmaz');

        // Decay yolu: bölgedeyken uzun süre dokunulmayan kelime 3'ün altına düşer
        await UserWord.create({
            user: userId, word: n5Words[12]._id, status: 'learning',
            masteryLevel: 3, repetitions: 2, interval: 6, easeFactor: 2.5,
            promotedAt: new Date(),
            nextReviewDate: new Date(Date.now() - 30 * 86400000) // ratio 5 → hedef 1
        });
        await UserWordService.applyMasteryDecay();

        const dusen = await UserWord.findOne({ user: userId, word: n5Words[12]._id });
        assert.equal(dusen.masteryLevel, 1);
        assert.equal(dusen.promotedAt, null, 'bölgeden çıkan kelime çipten de düşmeli');
    });
});

describe('Kelime havuzu sıralaması (müfredat/frequencyRank)', () => {
    let token;

    before(async () => {
        // Bilerek TERS sırada eklendi: kayıt sırası değil frequencyRank belirlemeli
        await Word.insertMany([
            { kanji: '外科医', romaji: 'gekai', meaning: 'surgeon', type: 'isim', jlptLevel: 'N3', isCore: true, frequencyRank: 30 },
            { kanji: '医者', romaji: 'isha', meaning: 'doctor', type: 'isim', jlptLevel: 'N3', isCore: true, frequencyRank: 10 },
            { kanji: '看護師', romaji: 'kangoshi', meaning: 'nurse', type: 'isim', jlptLevel: 'N3', isCore: true, frequencyRank: 20 }
        ]);
        // Ders seviyesi artık query'den değil profilden okunur
        await createVerifiedUser('siralama@test.com', { activeLevel: 'N3' });
        token = (await login('siralama@test.com')).accessToken;
    });

    it('yeni kelimeler frequencyRank artan sırada gelir (rastgele DEĞİL — ön koşul kelime önce)', async () => {
        const res = await api('GET', '/userwords/today', { token });
        assert.equal(res.status, 200);
        // Havuzun geri kalanı sınav için eklenen yüksek rank'li dolgu kelimeler
        const kanjis = res.json.data.newWords.slice(0, 3).map(w => w.kanji);
        assert.deepEqual(kanjis, ['医者', '看護師', '外科医'], 'doktor → hemşire → cerrah sırası korunmalı');

        // Aynı gün tekrar çağrıldığında (havuz zaten var) sıra yine korunur
        const again = await api('GET', '/userwords/today', { token });
        assert.deepEqual(again.json.data.newWords.slice(0, 3).map(w => w.kanji), ['医者', '看護師', '外科医']);
    });
});

describe('Kütüphane (liste, arama, sayfalama)', () => {
    let token;

    before(async () => {
        await Word.insertMany([
            {
                kanji: '電車', kana: 'でんしゃ', romaji: 'densha', meaning: 'train', meaningTr: 'tren',
                type: 'isim', jlptLevel: 'N5', isCore: true, frequencyRank: 501,
                example: '毎朝**電車**で学校へ行きます。',
                exampleFurigana: '毎朝[まいあさ]**電車[でんしゃ]**で学校[がっこう]へ行[い]きます。'
            },
            {
                kanji: '駅', kana: 'えき', romaji: 'eki', meaning: 'station', meaningTr: 'istasyon',
                type: 'isim', jlptLevel: 'N5', isCore: true, frequencyRank: 502
            },
            {
                kanji: '危険', kana: 'きけん', romaji: 'kiken', meaning: 'danger', meaningTr: 'tehlike',
                type: 'isim', jlptLevel: 'N4', isCore: true, frequencyRank: 503
            },
            // "tren" araması için tuzak: anlamı birebir "tren" DEĞİL ama İngilizce
            // anlamındaki "trend" kelimesi "tren" içeriyor. frequencyRank=1 ile
            // 電車'nın (501) çok önünde — yalnızca müfredat sırasına bakan bir
            // sıralama bu tesadüfi eşleşmeyi ilk sıraya koyardı.
            {
                kanji: '傾向', kana: 'けいこう', romaji: 'keikou', meaning: 'trend, tendency',
                meaningTr: 'eğilim', type: 'isim', jlptLevel: 'N2', isCore: true, frequencyRank: 1
            },
            // Anlamı virgülle ayrılmış liste: parçadan arama bunun üzerinde sınanır
            {
                kanji: '停車場', kana: 'ていしゃじょう', romaji: 'teishajou', meaning: 'railway station',
                meaningTr: 'istasyon, durak yeri', type: 'isim', jlptLevel: 'N1', isCore: true, frequencyRank: 900
            }
        ]);
        await createVerifiedUser('kutuphane@test.com');
        token = (await login('kutuphane@test.com')).accessToken;
    });

    it('sayfalama kararlıdır: sayfalar arasında kelime tekrar etmez veya kaybolmaz', async () => {
        const total = (await api('GET', '/words?limit=1', { token })).json.data.total;

        const gorulen = [];
        const sayfaSayisi = Math.ceil(total / 20);
        for (let p = 1; p <= sayfaSayisi; p++) {
            const res = await api('GET', `/words?page=${p}&limit=20`, { token });
            assert.equal(res.status, 200);
            gorulen.push(...res.json.data.words.map(w => w._id));
        }

        assert.equal(gorulen.length, total, 'tüm sayfaların toplamı total ile eşleşmeli');
        assert.equal(new Set(gorulen).size, total, 'aynı kelime iki sayfada birden çıkmamalı');
    });

    it('Türkçe anlamdan arar (kullanıcı gördüğü kelimeyi yazar)', async () => {
        // 危険'in İngilizce anlamı "danger" — "tehlike" YALNIZCA meaningTr'de
        // geçiyor, yani sonuç Türkçe alanın arandığını kanıtlar
        const res = await api('GET', '/words?q=tehlike', { token });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json.data.words.map(w => w.kanji), ['危険']);
    });

    it('kanadan arar', async () => {
        const res = await api('GET', '/words?q=でんしゃ', { token });
        assert.deepEqual(res.json.data.words.map(w => w.kanji), ['電車']);
    });

    it('arama sayfalıdır: total döner ve seviye filtresiyle birleşir', async () => {
        const hepsi = await api('GET', '/words?q=語五', { token });
        assert.equal(hepsi.json.data.total, 30, 'arama kesilmeden gerçek toplamı bildirmeli');
        assert.equal(hepsi.json.data.words.length, 20, 'ilk sayfa limit kadar döner');

        const n4 = await api('GET', '/words?q=語&jlptLevel=N4', { token });
        assert.equal(n4.json.data.total, 50);
        assert.ok(n4.json.data.words.every(w => w.jlptLevel === 'N4'));
    });

    it('core olmayan kelime aramaya girmez', async () => {
        const res = await api('GET', '/words?q=非核', { token });
        assert.equal(res.json.data.total, 0);
    });

    it('tam eşleşme, kelime ortasında geçen sonuçların ÖNÜNE gelir', async () => {
        const res = await api('GET', '/words?q=tren', { token });
        assert.equal(res.json.data.words[0].kanji, '電車', 'anlamı birebir "tren" olan kelime ilk sırada olmalı');
        assert.ok(res.json.data.words.some(w => w.kanji === '傾向'), 'kısmi eşleşme yine de listede kalmalı');
    });

    it('virgülle ayrılmış anlamlarda parçadan da bulur', async () => {
        const res = await api('GET', '/words?q=durak', { token });
        assert.deepEqual(res.json.data.words.map(w => w.kanji), ['停車場']);
    });

    it('seviye içinde müfredat sırasını korur', async () => {
        const res = await api('GET', '/words?q=語三', { token });
        assert.equal(res.json.data.total, 0, 'olmayan kelime boş döner');

        const n3 = await api('GET', '/words?jlptLevel=N3&limit=3', { token });
        assert.deepEqual(n3.json.data.words.map(w => w.kanji), ['医者', '看護師', '外科医']);
    });

    it('detayda her iki anlam da döner — dili istemci seçer', async () => {
        const liste = await api('GET', '/words?q=densha', { token });
        const id = liste.json.data.words[0]._id;

        const res = await api('GET', `/words/${id}`, { token });
        assert.equal(res.status, 200);
        assert.equal(res.json.data.meaning, 'train');
        assert.equal(res.json.data.meaningTr, 'tren');
        assert.equal(res.json.data.exampleFurigana, '毎朝[まいあさ]**電車[でんしゃ]**で学校[がっこう]へ行[い]きます。');
        assert.equal(res.json.data.example, '毎朝**電車**で学校へ行きます。', 'example işaretlemesiz kalmalı');
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
            token, body: { password: 'Testsifre123!' }
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

    it('hatırlatma kullanıcının seçtiği saatte gider, varsayılan 10:00\'da gitmez', async () => {
        const user = await createVerifiedUser('saat@test.com', {
            notificationSettings: { reminderTime: '14:00' }
        });

        // Seçilen saatten önce hiçbir şey üretilmez
        await NotificationService.generateDailyNotifications(atIstanbulHour(10));
        assert.equal(
            await Notification.countDocuments({ user: user._id, type: 'daily_task' }), 0,
            '14:00 seçen kullanıcıya 10:00\'da gitmemeli'
        );

        await NotificationService.generateDailyNotifications(atIstanbulHour(14));
        assert.equal(await Notification.countDocuments({ user: user._id, type: 'daily_task' }), 1);

        // Çeyrek saatlik cron aynı günü tekrar tetiklese de çoğaltmaz
        await NotificationService.generateDailyNotifications(atIstanbulHour(15));
        assert.equal(await Notification.countDocuments({ user: user._id, type: 'daily_task' }), 1);

        // Gecikme payı aşılınca gece yarısına doğru artık gönderilmez
        const gecikmis = await createVerifiedUser('gecikmis@test.com', {
            notificationSettings: { reminderTime: '08:00' }
        });
        await NotificationService.generateDailyNotifications(atIstanbulHour(22));
        assert.equal(
            await Notification.countDocuments({ user: gecikmis._id, type: 'daily_task' }), 0,
            'gecikme payını aşan hatırlatma hiç gönderilmemeli'
        );
    });

    it('hatırlatma saati 19:00 seçilirse günlük VE seri bildirimi aynı turda üretilir', async () => {
        const user = await createVerifiedUser('cakisma@test.com', {
            notificationSettings: { reminderTime: '19:00' }
        });
        await Streak.updateOne(
            { user: user._id },
            { currentStreak: 4, lastStudyDate: new Date(Date.now() - 2 * 86400000) }
        );

        await NotificationService.generateDailyNotifications(atIstanbulHour(19));

        assert.equal(await Notification.countDocuments({ user: user._id, type: 'daily_task' }), 1);
        assert.equal(
            await Notification.countDocuments({ user: user._id, type: 'streak_reminder' }), 1,
            'günlük hatırlatma seri bildirimini yutmamalı'
        );
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

    it('bugün çalışana seri bildirimi gitmez; tüm tercihler kapalıysa hiçbiri oluşmaz', async () => {
        const calisan = await createVerifiedUser('calisan@test.com');
        await Streak.updateOne({ user: calisan._id }, { currentStreak: 5, lastStudyDate: new Date() });

        const kapali = await createVerifiedUser('kapali@test.com', {
            notificationSettings: {
                dailyReminder: false, dailyWord: false, streakReminder: true, wordLevelDown: true
            }
        });

        await NotificationService.generateDailyNotifications(atIstanbulHour(19));
        await NotificationService.generateDailyNotifications(atIstanbulHour(10));

        assert.equal(
            await Notification.countDocuments({ user: calisan._id, type: { $in: ['streak_reminder', 'streak_warning'] } }),
            0, 'bugün çalışmış kullanıcı rahatsız edilmez'
        );
        assert.equal(
            await Notification.countDocuments({ user: kapali._id, type: { $in: ['daily_task', 'daily_word'] } }),
            0, 'ikisi de kapalıysa günlük bildirimler oluşmaz'
        );
    });

    // Tasarımda "Günlük Kelimeler" (あ) ve "Pratik Anımsatıcısı" (takvim+saat)
    // AYRI satırlar; ikisi de dailyReminder'a bağlıyken birini kapatan
    // kullanıcının diğeri de susuyordu.
    it('Günlük Kelimeler ile Pratik Anımsatıcısı birbirinden bağımsız kapanır', async () => {
        const sadeceKelime = await createVerifiedUser('sadecekelime@test.com', {
            notificationSettings: { dailyReminder: false }
        });
        const sadeceGorev = await createVerifiedUser('sadecegorev@test.com', {
            notificationSettings: { dailyWord: false }
        });

        await NotificationService.generateDailyNotifications(atIstanbulHour(10));

        assert.equal(await Notification.countDocuments({ user: sadeceKelime._id, type: 'daily_task' }), 0);
        assert.equal(await Notification.countDocuments({ user: sadeceKelime._id, type: 'daily_word' }), 1,
            'anımsatıcı kapalı olsa da günlük kelime hatırlatma saatinde gider');

        assert.equal(await Notification.countDocuments({ user: sadeceGorev._id, type: 'daily_word' }), 0);
        assert.equal(await Notification.countDocuments({ user: sadeceGorev._id, type: 'daily_task' }), 1);
    });

    // Cron 15 dakikada bir ve pencere ertesi güne sarmıyor: gece yarısından
    // önceki SON tur 23:45. Bu tur kalan dakikaları üstlenmezse 23:46-23:59
    // arası seçilen hatırlatma saati hiç çalışmıyordu.
    it('gün sonuna ayarlanan hatırlatma saati (23:50) son turda üretilir', async () => {
        const gece = await createVerifiedUser('gece@test.com', {
            notificationSettings: { reminderTime: '23:50' }
        });

        // Gün içindeki turlar erken ateşlemez
        await NotificationService.generateDailyNotifications(atIstanbulHour(20));
        assert.equal(await Notification.countDocuments({ user: gece._id, type: 'daily_task' }), 0);

        // Günün son turu (23:45) — 23:50'yi üstlenir
        const sonTur = new Date();
        sonTur.setUTCHours(23 - 3, 45, 0, 0);
        await NotificationService.generateDailyNotifications(sonTur);
        assert.equal(
            await Notification.countDocuments({ user: gece._id, type: 'daily_task' }), 1,
            'gün sonuna ayarlanan hatırlatma kaybolmamalı'
        );
    });

    it('hedefini bitiren kullanıcı hatırlatılmaz; kısmi ilerlemede kalan sayı yazılır', async () => {
        const StudySession = mongoose.model('StudySession');
        const DailyWordPool = mongoose.model('DailyWordPool');
        const gunBasi = new Date();
        gunBasi.setUTCHours(-3, 0, 0, 0); // Europe/Istanbul gün başlangıcı

        const kuranHavuz = async (user, adet) => DailyWordPool.create({
            user: user._id, date: gunBasi, jlptLevel: 'N5',
            newWordIds: (await Word.find({ jlptLevel: 'N5' }).limit(adet)).map(w => w._id),
            reviewWordIds: []
        });

        const biten = await createVerifiedUser('biten@test.com', { dailyGoal: 20 });
        await kuranHavuz(biten, 10);
        await StudySession.create({ user: biten._id, date: gunBasi, totalWords: 10 });

        const yarim = await createVerifiedUser('yarim@test.com', { dailyGoal: 20 });
        await kuranHavuz(yarim, 10);
        await StudySession.create({ user: yarim._id, date: gunBasi, totalWords: 4 });

        await NotificationService.generateDailyNotifications(atIstanbulHour(10));

        assert.equal(
            await Notification.countDocuments({ user: biten._id, type: 'daily_task' }), 0,
            'günün işini bitirene "seni bekliyor" denmez'
        );

        const kalan = await Notification.findOne({ user: yarim._id, type: 'daily_task' });
        assert.ok(kalan, 'iş kaldıysa hatırlatma gitmeli');
        assert.match(kalan.body, /Bugün 6 ezberlenecek/, 'gövde hedefi değil KALANI yazmalı');
        assert.equal(kalan.data.remaining, 6);
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
        assert.equal(notifs[0].title, 'Kelimeler tazelenmek istiyor 🌱');
    });

    // Tasarımdaki "Kelimenin Seviyesi Düştü" kartı: tek kelime düşmüşse onu
    // adıyla söyle. Decay kademeli düşürdüğü için seviye gerçekten 1'den farklı
    // olabilir — cevap yolu repetitions'ı sıfırladığından hep "1" yazardı.
    it('tek kelime düşerse bildirim onu adıyla ve yeni seviyesiyle söyler', async () => {
        const tek = await createVerifiedUser('tekdusus@test.com');
        await Streak.updateOne({ user: tek._id }, { lastStudyDate: new Date(Date.now() - 60 * 86400000) });

        const w = await Word.findOne({ jlptLevel: 'N4', isCore: true });
        await UserWord.create({
            user: tek._id, word: w._id, status: 'learning',
            masteryLevel: 4, repetitions: 3, interval: 10, easeFactor: 2.5,
            correctCount: 3, wrongCount: 0,
            nextReviewDate: new Date(Date.now() - 25 * 86400000) // ratio 2.5 → hedef 3
        });

        await UserWordService.applyMasteryDecay();

        const notif = await Notification.findOne({ user: tek._id, type: 'word_level_down' });
        assert.equal(notif.title, 'Kelimenin Seviyesi Düştü');
        assert.ok(
            notif.body.includes(`${w.kanji} (${w.romaji}) kelimesinin seviyesi 3. seviyeye düştü`),
            `beklenmeyen gövde: ${notif.body}`
        );
        assert.match(notif.body, /Uygulamaya gir tekrar hatırla!/);
        assert.equal(notif.data.newLevel, 3);
        assert.equal(String(notif.data.wordId), String(w._id));
    });

    it('doğru cevap seviyeyi SM-2\'den anında geri yükseltir', async () => {
        await StudySessionService.startSession(userId, 'N4');
        await havuzaEkleId(userId, [words[0]._id]);
        const result = await UserWordService.submitAnswer(userId, words[0]._id, 'correct');
        assert.ok(result.masteryLevel >= 4, 'düşen seviye ilk doğru cevapta geri zıplamalı');
    });
});

describe('Hesap silme (KVKK)', () => {
    it('kullanıcının tüm verisi silinir', async () => {
        const user = await createVerifiedUser('kvkk@test.com');
        const tokens = await login('kvkk@test.com');

        // Biraz veri üret
        await api('GET', '/userwords/today', { token: tokens.accessToken });

        const del = await api('DELETE', '/auth/delete-account', {
            token: tokens.accessToken,
            body: { password: 'Testsifre123!' }
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

describe('Mobil simülatör (canlıda /sim)', () => {
    const ORIGIN = () => BASE.replace(/\/api$/, '');
    const simGet = (path) => fetch(ORIGIN() + path, { redirect: 'manual' });

    it('linki alan açar; sayfa arama motoruna kapalıdır', async () => {
        const res = await simGet('/sim/');
        assert.equal(res.status, 200);
        // Koruma parolada değil: yüzey SIMULATOR_ENABLED ile kapanır, veri ise
        // /api'nin kendi auth'uyla korunur. Kalan tek şart indekslenmemesi.
        assert.equal(res.headers.get('x-robots-tag'), 'noindex');
        assert.match(await res.text(), /Mobil Simülatör/);
    });

    it('/sim sondaki eğik çizgiye yönlendirir — göreli varlıklar 404 olmasın', async () => {
        const res = await simGet('/sim');
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/sim/');

        // Yönlendirmenin ASIL sebebi: index.html "./app.js" diyor
        assert.equal((await simGet('/sim/app.js')).status, 200);
    });

    it('simülatör her API isteğine istemci etiketi koyar', async () => {
        const client = await fs.readFile(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
        // Etiket gitmezse istekler genel kovada sayılır ve simülatör trafiği
        // gerçek kullanıcıların bütçesini yemeye başlar (sessiz bozulma)
        assert.match(client, /'X-Musubi-Client': 'simulator'/);
        // api() sarmalayıcısını ATLAYAN doğrudan çağrılar (token yenileme,
        // çok parçalı fotoğraf yükleme) etiketi ayrıca taşımalı: her doğrudan
        // /api fetch'ine bir etiket düşmeli
        const tags = (client.match(/'X-Musubi-Client': 'simulator'/g) || []).length;
        const fetches = (client.match(/fetch\('\/api/g) || []).length;
        assert.ok(fetches >= 3, 'api(), refresh ve avatar yüklemesi');
        assert.equal(tags, fetches, 'etiketsiz bir /api fetch çağrısı var');
    });

    it('istemci etiketi hiçbir kapı açmaz — yetki değil, etikettir', async () => {
        const res = await fetch(BASE + '/auth/me', {
            headers: { 'X-Musubi-Client': 'simulator' }
        });
        assert.equal(res.status, 401);
    });
});

describe('Hukuki metinler', () => {
    // Sayfalar /api dışında yaşar
    const pageGet = async (path) => {
        const res = await fetch(BASE.replace(/\/api$/, '') + path);
        return { status: res.status, text: await res.text(), robots: res.headers.get('x-robots-tag') };
    };

    it('metinler oturumsuz okunur; JSON ve HTML aynı kaynaktan gelir', async () => {
        const list = await api('GET', '/legal');
        assert.equal(list.status, 200);
        assert.deepEqual(list.json.data.docs.map(d => d.key), ['terms', 'privacy', 'kvkk']);

        const kvkk = await api('GET', '/legal/kvkk');
        assert.equal(kvkk.status, 200);
        assert.equal(kvkk.json.data.sections.length, 6);
        assert.match(kvkk.json.data.intro, /6698 sayılı/);
        assert.match(kvkk.json.data.company, /ALPSOY/);

        // Aynı metin HTML sayfada da görünmeli — iki kopya değil, tek kaynak
        const page = await pageGet('/legal/kvkk');
        assert.equal(page.status, 200);
        assert.ok(page.text.includes('Haklarınız (KVKK m. 11)'));
        assert.ok(page.text.includes('destek@musubi.app'));

        const yok = await api('GET', '/legal/olmayan');
        assert.equal(yok.status, 404);
    });

    it('sürüm tek kaynaktan gelir: metin sürümü = rıza sürümü', async () => {
        const { DOCS } = require('../config/legal/texts');
        const { CURRENT_CONSENT_VERSIONS } = require('../config/consents');
        for (const key of ['terms', 'privacy', 'kvkk']) {
            assert.equal(CURRENT_CONSENT_VERSIONS[key], DOCS[key].version,
                `${key}: rıza sürümü metnin sürümünden türetilmeli`);
        }
    });

    it('mağaza kaydı için indekslenebilir; token sayfaları indekslenmez', async () => {
        const legal = await pageGet('/legal/privacy');
        assert.ok(legal.text.includes('name="robots" content="index"'),
            'gizlilik politikası mağaza kaydı için erişilebilir/indekslenebilir olmalı');

        await api('POST', '/auth/register', {
            body: { name: 'A', surname: 'B', email: `legal-robots-${Date.now()}@test.com`, password: 'Emechar1905!' }
        });
        const landing = await pageGet(`/verify-email/${lastVerificationToken()}`);
        assert.ok(landing.text.includes('name="robots" content="noindex"'),
            'token taşıyan sayfa indekslenmemeli');
    });

    it('EN dilinde metin Türkçe kalır ama bu açıkça söylenir', async () => {
        const en = await pageGet('/legal/terms?lang=en');
        assert.ok(en.text.includes('lang="en"'));
        assert.ok(en.text.includes('Version'), 'arayüz etiketleri çevrilmeli');
        assert.ok(en.text.includes('available in Turkish only'),
            'çevirisi olmayan metin için uyarı gösterilmeli');
        assert.ok(en.text.includes('Hizmetin Tanımı'),
            'metnin kendisi Türkçe (kanonik) kalmalı — makine çevirisi yok');

        const tr = await pageGet('/legal/terms');
        assert.ok(!tr.text.includes('available in Turkish only'),
            'Türkçe sayfada uyarı görünmemeli');
    });
});

describe('Görsel yükleme', () => {
    const sharp = require('sharp');

    // Test görselleri kodun içinde üretilir: repoya binary dosya eklemeden
    // gerçek bir JPEG/PNG akışı test edilir
    const makePng = (width = 1400, height = 2200) =>
        sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 60 } } })
            .png().toBuffer();

    const postImage = async (bytes, { token, filename = 'test.png', preset, field = 'image' } = {}) => {
        const form = new FormData();
        if (preset) form.append('preset', preset);
        if (bytes) form.append(field, new Blob([bytes]), filename);
        const res = await fetch(BASE + '/uploads', {
            method: 'POST',
            headers: { ...(token && { Authorization: 'Bearer ' + token }) },
            body: form
        });
        return { status: res.status, json: await res.json().catch(() => ({})) };
    };

    // Dönen `url` CLIENT_URL'e göre kurulur; test sunucusu rastgele portta
    // olduğu için dosya buradan, sunucunun kendi adresinden indirilir
    const fetchUpload = (key) => fetch(BASE.replace(/\/api$/, '') + '/uploads/' + key);

    let adminToken, userToken;

    before(async () => {
        await createVerifiedUser('yukleme-admin@test.com', { role: 'admin' });
        await createVerifiedUser('yukleme-user@test.com');
        adminToken = (await login('yukleme-admin@test.com')).accessToken;
        userToken = (await login('yukleme-user@test.com')).accessToken;
    });

    it('admin görsel yükler: webp\'e çevrilir, boyut sınırlanır, /uploads\'tan servis edilir', async () => {
        const res = await postImage(await makePng(1400, 2200), { token: adminToken, preset: 'story' });
        assert.equal(res.status, 201, JSON.stringify(res.json));

        const { key, url, width, height, bytes } = res.json.data;
        assert.match(key, /^stories\/[a-f0-9]{32}\.webp$/, 'key içerik hash\'i olmalı');
        assert.ok(url.endsWith('/uploads/' + key), 'url key üzerinden kurulmalı');

        // story ön ayarı 1080x1920'ye sığdırır; oran korunur
        assert.ok(width <= 1080 && height <= 1920, `boyut sınırlanmalı, geldi: ${width}x${height}`);
        assert.equal(width, 1080);
        assert.ok(bytes > 0);

        const served = await fetchUpload(key);
        assert.equal(served.status, 200);
        assert.equal(served.headers.get('content-type'), 'image/webp');
        assert.match(served.headers.get('cache-control') || '', /immutable/,
            'içerik hash\'li dosya sonsuza dek cache\'lenebilmeli');

        const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
        assert.equal(meta.format, 'webp');
        assert.equal(meta.width, width);
    });

    it('EXIF temizlenir — telefon fotoğrafındaki konum/kimlik verisi yayımlanmaz', async () => {
        const withExif = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } } })
            .withExif({ IFD0: { Copyright: 'MUSUBI-GIZLI-KONUM' } })
            .jpeg().toBuffer();
        assert.ok((await sharp(withExif).metadata()).exif, 'girdi EXIF taşımalı (test kurulumu)');

        const res = await postImage(withExif, { token: adminToken, filename: 'foto.jpg', preset: 'storyCover' });
        assert.equal(res.status, 201);

        const served = await fetchUpload(res.json.data.key);
        const buf = Buffer.from(await served.arrayBuffer());
        assert.ok(!(await sharp(buf).metadata()).exif, 'çıktıda EXIF kalmamalı');
        assert.ok(!buf.includes('MUSUBI-GIZLI-KONUM'), 'EXIF içeriği baytlarda da kalmamalı');
    });

    it('aynı görsel iki kez yüklenince aynı key\'e yazılır (kopya birikmez)', async () => {
        const png = await makePng(600, 600);
        const a = await postImage(png, { token: adminToken, preset: 'word' });
        const b = await postImage(png, { token: adminToken, preset: 'word' });
        assert.equal(a.status, 201);
        assert.equal(b.status, 201);
        assert.equal(a.json.data.key, b.json.data.key);
    });

    it('SVG ve bozuk dosyalar reddedilir; mimetype\'a güvenilmez', async () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        // İstemci "image/png" adı ve uzantısı verse bile içeriğe bakılır
        const asSvg = await postImage(svg, { token: adminToken, filename: 'zararsiz.png' });
        assert.equal(asSvg.status, 400);
        assert.match(asSvg.json.message, /SVG kabul edilmez/);

        // Doğru PNG imzası + çöp gövde: 400 olmalı, 500 değil
        const bozuk = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            Buffer.alloc(64, 0x41)
        ]);
        const res = await postImage(bozuk, { token: adminToken });
        assert.equal(res.status, 400);
        assert.match(res.json.message, /çözümlenemedi/);
    });

    it('boyut sınırını aşan dosya ve tanınmayan preset reddedilir', async () => {
        // Sınır sabitten okunur: değeri değişince test yalancı yeşile dönmesin
        const { MAX_UPLOAD_BYTES } = require('../middlewares/upload.middleware');
        const buyuk = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 0x00);
        const res = await postImage(buyuk, { token: adminToken });
        assert.equal(res.status, 400);
        assert.match(res.json.message, /çok büyük/);

        const preset = await postImage(await makePng(100, 100), { token: adminToken, preset: '../../etc' });
        assert.equal(preset.status, 400);
        assert.match(preset.json.message, /Geçersiz preset/);

        const dosyasiz = await postImage(null, { token: adminToken });
        assert.equal(dosyasiz.status, 400);
    });

    it('yükleme yalnızca admin: normal kullanıcı 403, oturumsuz 401', async () => {
        const png = await makePng(100, 100);
        assert.equal((await postImage(png, { token: userToken })).status, 403);
        assert.equal((await postImage(png)).status, 401);
        assert.equal((await api('DELETE', '/uploads?key=stories/' + 'a'.repeat(32) + '.webp', { token: userToken })).status, 403);
    });

    it('silme: dizin dışına çıkan key reddedilir, geçerli key siler, olmayan key hata vermez', async () => {
        const yuklendi = await postImage(await makePng(300, 300), { token: adminToken, preset: 'story' });
        const key = yuklendi.json.data.key;
        assert.equal((await fetchUpload(key)).status, 200);

        for (const kotu of ['../../.env', 'stories/../../.env', '/etc/passwd', 'stories/x.webp']) {
            const res = await api('DELETE', `/uploads?key=${encodeURIComponent(kotu)}`, { token: adminToken });
            assert.equal(res.status, 400, `reddedilmeliydi: ${kotu}`);
        }

        assert.equal((await api('DELETE', `/uploads?key=${key}`, { token: adminToken })).status, 200);
        assert.equal((await fetchUpload(key)).status, 404, 'silinen dosya artık servis edilmemeli');

        // İkinci silme de 200: silme idempotent
        assert.equal((await api('DELETE', `/uploads?key=${key}`, { token: adminToken })).status, 200);
    });
});

describe('Hikâyeler', () => {
    const sharp = require('sharp');
    const Story = require('../models/Story');
    const StoryView = require('../models/StoryView');

    let adminToken, userToken, userId;

    // Her çağrı FARKLI bir görsel üretir (dolayısıyla farklı içerik hash'i),
    // aksi halde tüm hikâyeler aynı key'i paylaşırdı
    let tohum = 0;
    const yeniGorsel = () => {
        tohum += 37;
        return sharp({ create: { width: 300, height: 300, channels: 3, background: { r: tohum % 255, g: 60, b: 90 } } })
            .png().toBuffer();
    };

    const gorselYukle = async (preset = 'story') => {
        const form = new FormData();
        form.append('preset', preset);
        form.append('image', new Blob([await yeniGorsel()]), 'x.png');
        const res = await fetch(BASE + '/uploads', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + adminToken },
            body: form
        });
        const json = await res.json();
        assert.equal(res.status, 201, JSON.stringify(json));
        return json.data.key;
    };

    const dosyaVar = async (key) =>
        (await fetch(BASE.replace(/\/api$/, '') + '/uploads/' + key)).status === 200;

    const hikayeOlustur = async (overrides = {}) => {
        const body = {
            title: 'Bilgi',
            coverKey: overrides.coverKey || await gorselYukle('storyCover'),
            slides: overrides.slides || [await gorselYukle()],
            ...overrides
        };
        const res = await api('POST', '/stories', { token: adminToken, body });
        assert.equal(res.status, 201, JSON.stringify(res.json));
        return res.json.data.id;
    };

    before(async () => {
        await createVerifiedUser('hikaye-admin@test.com', { role: 'admin' });
        const user = await createVerifiedUser('hikaye-user@test.com');
        userId = user._id;
        adminToken = (await login('hikaye-admin@test.com')).accessToken;
        userToken = (await login('hikaye-user@test.com')).accessToken;
    });

    after(async () => {
        await Promise.all([Story.deleteMany({}), StoryView.deleteMany({})]);
    });

    it('admin hikâye yayımlar, kullanıcı şeritte görür (kapak + slaytlar tam URL)', async () => {
        const id = await hikayeOlustur({ title: 'Sakura' });

        const res = await api('GET', '/stories', { token: userToken });
        assert.equal(res.status, 200);
        const story = res.json.data.find(s => s.id === id);
        assert.ok(story, 'yayımlanan hikâye listede olmalı');
        assert.equal(story.title, 'Sakura');
        assert.match(story.coverUrl, /^https?:\/\/.+\/uploads\/story-covers\/[a-f0-9]{32}\.webp$/);
        assert.equal(story.slides.length, 1);
        assert.match(story.slides[0].url, /\/uploads\/stories\//);
        assert.equal(story.seen, false, 'yeni hikâye görülmemiş olmalı');

        await Story.deleteMany({});
    });

    it('pasif ve süresi dolmuş hikâyeler gizlenir; sıra `order`a göre', async () => {
        const yayinda = await hikayeOlustur({ title: 'Yayında' });
        const pasif = await hikayeOlustur({ title: 'Pasif', isActive: false });
        const dolmus = await hikayeOlustur({
            title: 'Dolmuş',
            expiresAt: new Date(Date.now() - 60_000).toISOString()
        });
        const ileride = await hikayeOlustur({
            title: 'İleride',
            expiresAt: new Date(Date.now() + 3600_000).toISOString()
        });

        const gorunen = (await api('GET', '/stories', { token: userToken })).json.data.map(s => s.id);
        assert.deepEqual(gorunen, [yayinda, ileride], 'yalnızca aktif ve süresi geçmemişler, ekleme sırasında');

        // Admin listesi hepsini görür
        const hepsi = (await api('GET', '/stories/admin', { token: adminToken })).json.data;
        assert.equal(hepsi.length, 4);
        assert.ok(hepsi.every(s => typeof s.openCount === 'number' && typeof s.completedCount === 'number'));

        // Sıralamayı tersine çevir
        const ters = await api('PUT', '/stories/order', { token: adminToken, body: { normalIds: [ileride, yayinda] } });
        assert.equal(ters.status, 200);
        const sonra = (await api('GET', '/stories', { token: userToken })).json.data.map(s => s.id);
        assert.deepEqual(sonra, [ileride, yayinda]);

        assert.ok(pasif && dolmus); // yukarıda kullanıldı
        await Story.deleteMany({});
    });

    it('görüldü işareti idempotent; hikâye güncellenince halka tekrar yanar', async () => {
        const id = await hikayeOlustur({ title: 'Duyuru' });
        const seenDurumu = async () =>
            (await api('GET', '/stories', { token: userToken })).json.data.find(s => s.id === id).seen;

        assert.equal(await seenDurumu(), false);

        assert.equal((await api('POST', `/stories/${id}/seen`, { token: userToken })).status, 200);
        assert.equal(await seenDurumu(), true);

        // İkinci işaretleme yeni kayıt açmaz
        assert.equal((await api('POST', `/stories/${id}/seen`, { token: userToken })).status, 200);
        assert.equal(await StoryView.countDocuments({ user: userId, story: id }), 1);

        // Admin slayt ekleyince kullanıcı için tekrar "görülmemiş" olur
        await sleep(10);
        const guncelle = await api('PUT', `/stories/${id}`, {
            token: adminToken,
            body: { slides: [await gorselYukle(), await gorselYukle()] }
        });
        assert.equal(guncelle.status, 200);
        assert.equal(await seenDurumu(), false, 'güncellenen hikâye yeniden görülmemiş sayılmalı');

        assert.equal((await api('POST', '/stories/000000000000000000000000/seen', { token: userToken })).status, 404);
        await Story.deleteMany({});
    });

    it('yönetim uçları admin ister: normal kullanıcı 403, oturumsuz 401', async () => {
        const id = await hikayeOlustur();

        for (const [method, path] of [['GET', '/stories/admin'], ['POST', '/stories'], ['PUT', `/stories/${id}`], ['DELETE', `/stories/${id}`], ['PUT', '/stories/order']]) {
            const govde = method === 'GET' ? undefined : {};
            assert.equal((await api(method, path, { token: userToken, body: govde })).status, 403, `${method} ${path}`);
            assert.equal((await api(method, path, { body: govde })).status, 401, `${method} ${path} (oturumsuz)`);
        }

        // Okuma ucu her doğrulanmış kullanıcıya açık
        assert.equal((await api('GET', '/stories', { token: userToken })).status, 200);
        assert.equal((await api('GET', '/stories')).status, 401);

        await Story.deleteMany({});
    });

    it('görsel anahtarı doğrulanır: dizin dışına çıkan veya uydurma key reddedilir', async () => {
        const gecerli = await gorselYukle('storyCover');

        const kotuKapak = await api('POST', '/stories', {
            token: adminToken,
            body: { title: 'X', coverKey: '../../.env', slides: [await gorselYukle()] }
        });
        assert.equal(kotuKapak.status, 400);
        assert.match(kotuKapak.json.message, /Geçersiz görsel anahtarı \(kapak\)/);

        const kotuSlayt = await api('POST', '/stories', {
            token: adminToken,
            body: { title: 'X', coverKey: gecerli, slides: ['stories/olmayan.png'] }
        });
        assert.equal(kotuSlayt.status, 400);
        assert.match(kotuSlayt.json.message, /slayt 1/);

        const slaytsiz = await api('POST', '/stories', {
            token: adminToken,
            body: { title: 'X', coverKey: gecerli, slides: [] }
        });
        assert.equal(slaytsiz.status, 400);

        const basliksiz = await api('POST', '/stories', {
            token: adminToken,
            body: { coverKey: gecerli, slides: [await gorselYukle()] }
        });
        assert.equal(basliksiz.status, 400);
    });

    it('silme: görüntülenme kayıtları ve görseller gider, PAYLAŞILAN görsele dokunulmaz', async () => {
        const ortakKapak = await gorselYukle('storyCover');
        const kendiSlayt = await gorselYukle();

        const a = await hikayeOlustur({ title: 'A', coverKey: ortakKapak, slides: [kendiSlayt] });
        const b = await hikayeOlustur({ title: 'B', coverKey: ortakKapak, slides: [await gorselYukle()] });

        await api('POST', `/stories/${a}/seen`, { token: userToken });
        assert.equal(await StoryView.countDocuments({ story: a }), 1);

        assert.equal((await api('DELETE', `/stories/${a}`, { token: adminToken })).status, 200);
        assert.equal(await StoryView.countDocuments({ story: a }), 0, 'görüntülenme kayıtları da silinmeli');
        assert.equal(await dosyaVar(kendiSlayt), false, 'yalnızca bu hikâyenin kullandığı görsel silinmeli');
        assert.equal(await dosyaVar(ortakKapak), true, 'B hâlâ kullandığı için ortak kapak DURMALI');

        assert.equal((await api('DELETE', `/stories/${b}`, { token: adminToken })).status, 200);
        assert.equal(await dosyaVar(ortakKapak), false, 'son kullanan da gidince görsel silinmeli');

        assert.equal((await api('DELETE', '/stories/000000000000000000000000', { token: adminToken })).status, 404);
    });

    it('güncellemede değişen görsel temizlenir', async () => {
        const eskiSlayt = await gorselYukle();
        const id = await hikayeOlustur({ slides: [eskiSlayt] });
        const yeniSlayt = await gorselYukle();

        assert.equal((await api('PUT', `/stories/${id}`, {
            token: adminToken, body: { slides: [yeniSlayt] }
        })).status, 200);

        assert.equal(await dosyaVar(eskiSlayt), false, 'artık kullanılmayan görsel silinmeli');
        assert.equal(await dosyaVar(yeniSlayt), true);

        await Story.deleteMany({});
    });

    it('hesap silmede kullanıcının görüntülenme kayıtları da gider (KVKK)', async () => {
        const gecici = await createVerifiedUser('hikaye-kvkk@test.com');
        const token = (await login('hikaye-kvkk@test.com')).accessToken;
        const id = await hikayeOlustur();

        await api('POST', `/stories/${id}/seen`, { token });
        assert.equal(await StoryView.countDocuments({ user: gecici._id }), 1);

        await AuthService.deleteAccount(gecici._id, { password: 'Testsifre123!' });
        assert.equal(await StoryView.countDocuments({ user: gecici._id }), 0);

        await Story.deleteMany({});
    });

    it('admin paneli her ortamda servis edilir ve indekslenmez', async () => {
        const res = await fetch(BASE.replace(/\/api$/, '') + '/admin/');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') || '', /text\/html/);
        assert.equal(res.headers.get('x-robots-tag'), 'noindex');

        const html = await res.text();
        assert.ok(html.includes('admin.js'), 'panel JS ayrı dosyadan yüklenmeli (CSP inline script\'i engelliyor)');
        assert.ok(!/<script(?![^>]*\ssrc=)/i.test(html), 'inline <script> olmamalı — production CSP çalıştırmaz');
    });

    // Panel görünürlüğü `hidden` özniteliğiyle yönetiliyor ve .login-view/.drawer/
    // .btn sınıflarının `display` kuralları tarayıcının [hidden] kuralını eziyor.
    // Tarayıcı olmadan gerçek görünürlük test edilemiyor; en azından kuralın
    // silinmediğini garanti ediyoruz — silinirse giriş ekranı sürekli açık kalır,
    // düzenleyici hiç kapanmaz ve yeni hikâyede "Sil" butonu görünür.
    it('panel CSS\'i [hidden] kuralını taşımalı (görünürlük buna bağlı)', async () => {
        const css = await fs.readFile(path.join(__dirname, '../admin/admin.css'), 'utf8');
        assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
            'admin.css [hidden]{display:none !important} kuralını içermeli');
    });

    it('sıralama değişince "görüldü" bozulmaz', async () => {
        const a = await hikayeOlustur({ title: 'A' });
        const b = await hikayeOlustur({ title: 'B' });

        await api('POST', `/stories/${a}/seen`, { token: userToken });
        await api('POST', `/stories/${b}/seen`, { token: userToken });

        await sleep(10);
        assert.equal((await api('PUT', '/stories/order', { token: adminToken, body: { normalIds: [b, a] } })).status, 200);

        const liste = (await api('GET', '/stories', { token: userToken })).json.data;
        assert.deepEqual(liste.map(s => s.id), [b, a], 'sıra değişmeli');
        assert.deepEqual(liste.map(s => s.seen), [true, true],
            'sıralama içerik değişikliği değil — halkalar yeniden yanmamalı');

        await Story.deleteMany({});
    });

    it('yayın durumu / başlık / bitiş tarihi değişince "görüldü" bozulmaz', async () => {
        const id = await hikayeOlustur({ title: 'Eski' });
        await api('POST', `/stories/${id}/seen`, { token: userToken });

        const seenDurumu = async () =>
            (await api('GET', '/stories', { token: userToken })).json.data.find(s => s.id === id)?.seen;
        assert.equal(await seenDurumu(), true);

        for (const govde of [
            { title: 'Yeni Başlık' },
            { expiresAt: new Date(Date.now() + 7200_000).toISOString() },
            { isActive: false },
            { isActive: true }
        ]) {
            await sleep(10);
            assert.equal((await api('PUT', `/stories/${id}`, { token: adminToken, body: govde })).status, 200);
        }

        assert.equal(await seenDurumu(), true,
            'içerik dışı düzenlemeler halkayı yeniden yakmamalı');

        await Story.deleteMany({});
    });

    it('açılma ve tamamlanma ayrı ayrı kaydedilir; oran panele düşer', async () => {
        const id = await hikayeOlustur({ title: 'Ölçüm' });

        // Üçüncü bir kullanıcı: açan ama bitirmeyen senaryosu için
        await createVerifiedUser('hikaye-yarim@test.com');
        const yarimToken = (await login('hikaye-yarim@test.com')).accessToken;

        // İki kullanıcı açıyor, biri sonuna kadar gidiyor
        assert.equal((await api('POST', `/stories/${id}/opened`, { token: userToken })).status, 200);
        assert.equal((await api('POST', `/stories/${id}/opened`, { token: yarimToken })).status, 200);
        assert.equal((await api('POST', `/stories/${id}/seen`, { token: userToken })).status, 200);

        await sleep(60); // logEvent fire-and-forget, yazımı beklenmez

        // Sorgular bu hikâyeye daraltılıyor: bloktaki diğer testler de /seen
        // çağırıyor ve olay günlüğü ortak
        const acilma = await Event.find({ type: 'story_opened', 'data.storyId': String(id) }).lean();
        assert.equal(acilma.length, 2);
        assert.equal(acilma[0].data.title, 'Ölçüm', 'hikâye silinse de olay okunabilir kalsın diye başlık yazılmalı');
        assert.equal(acilma[0].data.slideCount, 1);

        const tamamlama = await Event.find({ type: 'story_completed', 'data.storyId': String(id) }).lean();
        assert.equal(tamamlama.length, 1);

        const kart = (await api('GET', '/stories/admin', { token: adminToken })).json.data.find(s => s.id === id);
        assert.equal(kart.openCount, 2);
        assert.equal(kart.completedCount, 1);
        assert.equal(kart.completionRate, 0.5);

        // Aynı kullanıcı ikinci kez açarsa oran bozulmamalı — TEKİL kullanıcı sayılır
        await api('POST', `/stories/${id}/opened`, { token: userToken });
        await sleep(60);
        const tekrar = (await api('GET', '/stories/admin', { token: adminToken })).json.data.find(s => s.id === id);
        assert.equal(tekrar.openCount, 2, 'aynı kullanıcının tekrar açması ayrı kişi sayılmamalı');

        await Event.deleteMany({ type: { $in: ['story_opened', 'story_completed'] } });
        await Story.deleteMany({});
    });

    it('açılma kaydı "görüldü" işaretlemez — yarıda bırakan kullanıcının halkası yanık kalır', async () => {
        const id = await hikayeOlustur();

        await api('POST', `/stories/${id}/opened`, { token: userToken });
        const liste = (await api('GET', '/stories', { token: userToken })).json.data;
        assert.equal(liste.find(s => s.id === id).seen, false,
            'yalnızca açmak yeterli değil; halka sonuna kadar izlenince griye dönmeli');

        assert.equal((await api('POST', '/stories/000000000000000000000000/opened', { token: userToken })).status, 404);
        assert.equal((await api('POST', `/stories/${id}/opened`)).status, 401);

        await Event.deleteMany({ type: { $in: ['story_opened', 'story_completed'] } });
        await Story.deleteMany({});
    });

    it('hiç açılmamış hikâyede oran null döner (0 değil)', async () => {
        const id = await hikayeOlustur();
        const kart = (await api('GET', '/stories/admin', { token: adminToken })).json.data.find(s => s.id === id);
        assert.equal(kart.openCount, 0);
        assert.equal(kart.completionRate, null,
            '0 yazmak "kimse bitirmedi" gibi okunur; henüz kimse bakmadı demek');
        await Story.deleteMany({});
    });

    it('sabitlenen hikâyeler şeridin başına geçer, grup içi sıra korunur', async () => {
        const a = await hikayeOlustur({ title: 'A' });
        const b = await hikayeOlustur({ title: 'B' });
        const c = await hikayeOlustur({ title: 'C' });

        const sira = async () => (await api('GET', '/stories', { token: userToken })).json.data;

        assert.deepEqual((await sira()).map(s => s.id), [a, b, c], 'başlangıçta ekleme sırası');
        assert.deepEqual((await sira()).map(s => s.isPinned), [false, false, false]);

        // C ve B sabitlenir (bu sırayla), A sabitlenmemiş kalır
        assert.equal((await api('PUT', '/stories/order', {
            token: adminToken, body: { pinnedIds: [c, b], normalIds: [a] }
        })).status, 200);

        const sonra = await sira();
        assert.deepEqual(sonra.map(s => s.id), [c, b, a], 'sabitlenenler önce, kendi sıralarında');
        assert.deepEqual(sonra.map(s => s.isPinned), [true, true, false]);

        // Sabitlenenlerin kendi içinde sırası değişebilir
        await api('PUT', '/stories/order', { token: adminToken, body: { pinnedIds: [b, c], normalIds: [a] } });
        assert.deepEqual((await sira()).map(s => s.id), [b, c, a]);

        // Sabitlemeyi kaldırmak hikâyeyi kendi grubuna geri gönderir
        await api('PUT', '/stories/order', { token: adminToken, body: { pinnedIds: [], normalIds: [a, b, c] } });
        const bosaltilmis = await sira();
        assert.deepEqual(bosaltilmis.map(s => s.id), [a, b, c]);
        assert.ok(bosaltilmis.every(s => s.isPinned === false));

        await Story.deleteMany({});
    });

    it('yeni hikâye sabitlenenlerin arasına girmez, sona eklenir', async () => {
        const a = await hikayeOlustur({ title: 'A' });
        await api('PUT', '/stories/order', { token: adminToken, body: { pinnedIds: [a], normalIds: [] } });

        const b = await hikayeOlustur({ title: 'B' });
        const liste = (await api('GET', '/stories', { token: userToken })).json.data;
        assert.deepEqual(liste.map(s => s.id), [a, b], 'sabitlenmiş A başta kalmalı');
        assert.deepEqual(liste.map(s => s.isPinned), [true, false]);

        await Story.deleteMany({});
    });

    it('sabitleme "görüldü" bilgisini bozmaz', async () => {
        const a = await hikayeOlustur({ title: 'A' });
        const b = await hikayeOlustur({ title: 'B' });
        await api('POST', `/stories/${a}/seen`, { token: userToken });
        await api('POST', `/stories/${b}/seen`, { token: userToken });

        await sleep(10);
        await api('PUT', '/stories/order', { token: adminToken, body: { pinnedIds: [b], normalIds: [a] } });

        const liste = (await api('GET', '/stories', { token: userToken })).json.data;
        assert.deepEqual(liste.map(s => s.id), [b, a]);
        assert.deepEqual(liste.map(s => s.seen), [true, true],
            'sabitleme içerik değişikliği değil — halkalar yeniden yanmamalı');

        await Story.deleteMany({});
    });

    it('sıralama gövdesi doğrulanır: iki liste de boşsa veya dizi değilse 400', async () => {
        assert.equal((await api('PUT', '/stories/order', { token: adminToken, body: {} })).status, 400);
        assert.equal((await api('PUT', '/stories/order', {
            token: adminToken, body: { pinnedIds: [], normalIds: [] }
        })).status, 400);
        const bozuk = await api('PUT', '/stories/order', {
            token: adminToken, body: { pinnedIds: 'abc', normalIds: [] }
        });
        assert.equal(bozuk.status, 400);
        assert.match(bozuk.json.message, /dizi olmalı/);
    });

    it('kapak veya slayt değişince "görüldü" sıfırlanır', async () => {
        const id = await hikayeOlustur();
        const seenDurumu = async () =>
            (await api('GET', '/stories', { token: userToken })).json.data.find(s => s.id === id).seen;

        // kapak değişimi
        await api('POST', `/stories/${id}/seen`, { token: userToken });
        assert.equal(await seenDurumu(), true);
        await sleep(10);
        await api('PUT', `/stories/${id}`, { token: adminToken, body: { coverKey: await gorselYukle('storyCover') } });
        assert.equal(await seenDurumu(), false, 'kapak değişince halka yeniden yanmalı');

        // slayt değişimi
        await api('POST', `/stories/${id}/seen`, { token: userToken });
        assert.equal(await seenDurumu(), true);
        await sleep(10);
        await api('PUT', `/stories/${id}`, { token: adminToken, body: { slides: [await gorselYukle()] } });
        assert.equal(await seenDurumu(), false, 'slayt değişince halka yeniden yanmalı');

        // aynı slaytlar yeniden gönderilirse (panel her kaydetmede hepsini
        // yolluyor) değişiklik sayılmamalı
        await api('POST', `/stories/${id}/seen`, { token: userToken });
        await sleep(10);
        const mevcut = (await api('GET', '/stories/admin', { token: adminToken })).json.data.find(s => s.id === id);
        await api('PUT', `/stories/${id}`, {
            token: adminToken,
            body: { coverKey: mevcut.coverKey, slides: mevcut.slides.map(s => s.imageKey), title: 'Aynı' }
        });
        assert.equal(await seenDurumu(), true, 'değişmeyen görseller yeniden gönderilince halka yanmamalı');

        await Story.deleteMany({});
    });
});

describe('v2 — Kullanıcı adı ve profil fotoğrafı', () => {
    const sharp = require('sharp');
    const { normalizeUsername, usernameViolation } = require('../utils/username.util');

    const makePng = (width, height, r = 40) =>
        sharp({ create: { width, height, channels: 3, background: { r, g: 120, b: 200 } } })
            .png().toBuffer();

    const putAvatar = async (bytes, token) => {
        const form = new FormData();
        form.append('image', new Blob([bytes]), 'avatar.png');
        const res = await fetch(BASE + '/users/me/avatar', {
            method: 'PUT',
            headers: { Authorization: 'Bearer ' + token },
            body: form
        });
        return { status: res.status, json: await res.json().catch(() => ({})) };
    };

    const keyOf = (url) => /\/uploads\/(avatars\/[a-f0-9]{32}\.webp)$/.exec(url)?.[1];
    const fileExists = (key) =>
        fs.access(path.join(uploadDir, key)).then(() => true, () => false);

    it('kural: biçim, ayrılmış adlar ve küfür filtresi (yanlış pozitif vermeden)', () => {
        assert.equal(normalizeUsername('  @Emo.Mu '), 'emo.mu');
        assert.equal(normalizeUsername(42), '', 'string olmayan girdi 500 değil geçersiz ad olmalı');

        for (const ok of ['emomu', 'yusuf_51', 'emo.mu', 'abc', 'a'.repeat(20), 'klasik', 'sikke', 'gotham']) {
            assert.equal(usernameViolation(ok), null, `${ok} geçerli olmalı`);
        }
        for (const bad of ['ab', 'a'.repeat(21), 'emo mu', 'şeker', '.emo', 'emo.', 'emo..mu', '12345', '___']) {
            assert.equal(usernameViolation(bad), 'invalid', `${bad} geçersiz olmalı`);
        }
        assert.equal(usernameViolation('admin'), 'reserved');
        assert.equal(usernameViolation('musubi'), 'reserved');
        for (const kufur of ['xorospux', '0r0spu', 'sik_123', 'amk', 'the.fuck.er']) {
            assert.equal(usernameViolation(kufur), 'inappropriate', `${kufur} reddedilmeli`);
        }
    });

    it('check-username: oturumsuz çalışır, alınmış ad available:false döner (hata değil)', async () => {
        await createVerifiedUser('kadi-sahip@test.com', { username: 'alinmis' });

        const bos = await api('POST', '/auth/check-username', { body: { username: '@Yepyeni' } });
        assert.equal(bos.status, 200);
        assert.deepEqual(
            { username: bos.json.data.username, available: bos.json.data.available, reason: bos.json.data.reason },
            { username: 'yepyeni', available: true, reason: null }
        );

        const dolu = await api('POST', '/auth/check-username', { body: { username: 'ALINMIS' } });
        assert.equal(dolu.status, 200);
        assert.equal(dolu.json.data.available, false, 'büyük/küçük harf farkı aynı ad sayılır');
        assert.equal(dolu.json.data.reason, 'taken');
        assert.ok(dolu.json.data.message);

        const kotu = await api('POST', '/auth/check-username', { body: { username: 'a b' } });
        assert.equal(kotu.json.data.reason, 'invalid');

        // Profil düzenlemede kullanıcı kendi mevcut adını "alınmış" görmemeli
        const { accessToken } = await login('kadi-sahip@test.com');
        const kendi = await api('POST', '/auth/check-username', { token: accessToken, body: { username: 'alinmis' } });
        assert.equal(kendi.json.data.available, true);
    });

    it('kayıtta kullanıcı adı: küçük harfle saklanır, alınmışsa 409 ve hesap/mail oluşmaz', async () => {
        const body = (email, username) => ({
            name: 'Ad', surname: 'Soyad', email, password: 'Testsifre123!', username
        });

        const ok = await api('POST', '/auth/register', { body: body('kadi-kayit@test.com', '@Kayitli.Ad') });
        assert.equal(ok.status, 201, JSON.stringify(ok.json));
        assert.equal(ok.json.data.username, 'kayitli.ad');
        assert.equal(ok.json.data.needsUsername, false);

        const mailSayisi = sendEmail.outbox.length;
        const cakisan = await api('POST', '/auth/register', { body: body('kadi-kayit2@test.com', 'KAYITLI.AD') });
        assert.equal(cakisan.status, 409);
        assert.equal(cakisan.json.details?.reason, 'taken');
        assert.equal(await User.countDocuments({ email: 'kadi-kayit2@test.com' }), 0, 'hesap oluşmamalı');
        assert.equal(sendEmail.outbox.length, mailSayisi, 'doğrulama maili gitmemeli');

        const uygunsuz = await api('POST', '/auth/register', { body: body('kadi-kayit3@test.com', 'orospu') });
        assert.equal(uygunsuz.status, 400);
        assert.equal(uygunsuz.json.details?.reason, 'inappropriate');
    });

    it('kullanıcı adı olmayan hesap: needsUsername true, update-info ile tamamlanır', async () => {
        const kayit = await api('POST', '/auth/register', {
            body: { name: 'Eski', surname: 'Istemci', email: 'kadi-yok@test.com', password: 'Testsifre123!' }
        });
        assert.equal(kayit.status, 201, 'kullanıcı adı göndermeyen eski istemcinin kaydı bozulmamalı');
        assert.equal(kayit.json.data.needsUsername, true);

        await createVerifiedUser('kadi-tamamla@test.com');
        await createVerifiedUser('kadi-dolu@test.com', { username: 'dolu' });
        const { accessToken: token, data } = await login('kadi-tamamla@test.com');
        assert.equal(data.needsUsername, true, 'login yanıtı da bayrağı taşımalı');

        let me = await api('GET', '/auth/me', { token });
        assert.equal(me.json.data.needsUsername, true);

        const cakisan = await api('PUT', '/auth/update-info', { token, body: { username: 'Dolu' } });
        assert.equal(cakisan.status, 409);
        const bos = await api('PUT', '/auth/update-info', { token, body: { username: '' } });
        assert.equal(bos.status, 400, 'kullanıcı adı boşaltılamaz');

        const ok = await api('PUT', '/auth/update-info', { token, body: { username: 'Tamamlandi' } });
        assert.equal(ok.status, 200, JSON.stringify(ok.json));
        assert.equal(ok.json.data.username, 'tamamlandi');
        assert.equal(ok.json.data.needsUsername, false);

        me = await api('GET', '/auth/me', { token });
        assert.equal(me.json.data.needsUsername, false);

        // Aynı adı yeniden göndermek (form "Güncelle") kendi adıyla çakışmamalı
        const ayni = await api('PUT', '/auth/update-info', { token, body: { username: 'tamamlandi' } });
        assert.equal(ayni.status, 200);
    });

    it('veri katmanı: kullanıcı adı benzersiz, adı olmayan hesaplar birbiriyle çakışmaz', async () => {
        await User.init();
        await createVerifiedUser('kadi-idx1@test.com', { username: 'tekil' });
        await assert.rejects(createVerifiedUser('kadi-idx2@test.com', { username: 'tekil' }), { code: 11000 });
        // İki "adsız" hesap aynı anda var olabilmeli (partial index)
        await createVerifiedUser('kadi-idx3@test.com');
        await createVerifiedUser('kadi-idx4@test.com');
    });

    it('/auth/me iç muhasebe alanlarını sızdırmaz', async () => {
        await createVerifiedUser('kadi-me@test.com', { username: 'mecik' });
        const { accessToken } = await login('kadi-me@test.com');
        const d = (await api('GET', '/auth/me', { token: accessToken })).json.data;
        for (const alan of ['password', 'fcmToken', 'emailVerificationToken', 'resetPasswordToken',
            'loginThrottle', 'mailThrottle', 'avatarKey', 'profile_image']) {
            assert.ok(!(alan in d), `${alan} dönmemeli`);
        }
        assert.equal(d.username, 'mecik');
        assert.equal(d.avatarUrl, null);
    });

    it('profil fotoğrafı: kare kırpılır, /auth/me ve anasayfada görünür, değişince eskisi silinir', async () => {
        await createVerifiedUser('avatar@test.com', { username: 'avatarci' });
        const { accessToken: token } = await login('avatar@test.com');

        const ilk = await putAvatar(await makePng(1400, 800, 10), token);
        assert.equal(ilk.status, 200, JSON.stringify(ilk.json));
        const ilkKey = keyOf(ilk.json.data.avatarUrl);
        assert.ok(ilkKey, 'avatarUrl /uploads/avatars/<hash>.webp olmalı');

        const meta = await sharp(await fs.readFile(path.join(uploadDir, ilkKey))).metadata();
        assert.deepEqual([meta.width, meta.height, meta.format], [512, 512, 'webp'], 'yatay fotoğraf kareye kırpılmalı');

        assert.equal((await api('GET', '/auth/me', { token })).json.data.avatarUrl, ilk.json.data.avatarUrl);
        assert.equal((await api('GET', '/home/summary', { token })).json.data.avatarUrl, ilk.json.data.avatarUrl);

        const ikinci = await putAvatar(await makePng(600, 600, 99), token);
        const ikinciKey = keyOf(ikinci.json.data.avatarUrl);
        assert.notEqual(ikinciKey, ilkKey);
        assert.equal(await fileExists(ilkKey), false, 'kullanılmayan eski dosya silinmeli');
        assert.equal(await fileExists(ikinciKey), true);

        const sil = await api('DELETE', '/users/me/avatar', { token });
        assert.equal(sil.status, 200);
        assert.equal(sil.json.data.avatarUrl, null);
        assert.equal(await fileExists(ikinciKey), false);
        assert.equal((await api('GET', '/auth/me', { token })).json.data.avatarUrl, null);
    });

    it('aynı görseli kullanan iki hesap: biri silince diğerinin fotoğrafı kırılmaz', async () => {
        await createVerifiedUser('avatar-a@test.com');
        await createVerifiedUser('avatar-b@test.com');
        const a = (await login('avatar-a@test.com')).accessToken;
        const b = (await login('avatar-b@test.com')).accessToken;

        const gorsel = await makePng(300, 300, 222);
        const keyA = keyOf((await putAvatar(gorsel, a)).json.data.avatarUrl);
        const keyB = keyOf((await putAvatar(gorsel, b)).json.data.avatarUrl);
        assert.equal(keyA, keyB, 'içerik hash\'i aynı dosyayı üretir');

        await api('DELETE', '/users/me/avatar', { token: a });
        assert.equal(await fileExists(keyB), true, 'B hâlâ kullanıyor');

        // Hesap silme de aynı kurala uyar; son kullanan gidince dosya da gider
        const del = await api('DELETE', '/auth/delete-account', { token: b, body: { password: 'Testsifre123!' } });
        assert.equal(del.status, 200);
        assert.equal(await fileExists(keyB), false);
    });

    it('doğrulanmamış hesap fotoğraf yükleyemez; oturumsuz 401', async () => {
        await User.create({
            name: 'Dogrulanmamis', surname: 'X', email: 'avatar-nv@test.com',
            password: 'Testsifre123!', isEmailVerified: false
        });
        const { accessToken } = await login('avatar-nv@test.com');
        assert.equal((await putAvatar(await makePng(100, 100), accessToken)).status, 403);

        const res = await fetch(BASE + '/users/me/avatar', { method: 'PUT' });
        assert.equal(res.status, 401);
    });

    it('sosyal kayıt: kullanıcı adı yalnızca hesap açılışında uygulanır', async () => {
        const jwt = require('jsonwebtoken');
        const body = (username) => ({
            body: {
                provider: 'google', deviceName: 'test-suite', username,
                idToken: jwt.sign({
                    sub: 'google-sub-kadi', email: 'sosyal-kadi@test.com', email_verified: true,
                    given_name: 'Sosyal', family_name: 'Kadi'
                }, 'sahte-imza')
            }
        });

        const ilk = await api('POST', '/auth/social', body('Sosyal.Kadi'));
        assert.equal(ilk.status, 201, JSON.stringify(ilk.json));
        assert.equal(ilk.json.data.username, 'sosyal.kadi');

        // Mevcut hesaba girişte gönderilen ad (geçersiz olsa bile) yok sayılır
        const tekrar = await api('POST', '/auth/social', body('baska ad'));
        assert.equal(tekrar.status, 200);
        assert.equal(tekrar.json.data.username, 'sosyal.kadi');
    });

    it('bozuk/SVG dosya ve eksik alan reddedilir', async () => {
        await createVerifiedUser('avatar-bozuk@test.com');
        const { accessToken: token } = await login('avatar-bozuk@test.com');
        assert.equal((await putAvatar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), token)).status, 400);

        const res = await fetch(BASE + '/users/me/avatar', {
            method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: new FormData()
        });
        assert.equal(res.status, 400);
    });
});

describe('Güvenlik regresyonları (26.09.2026 incelemesi)', () => {
    const jwt = require('jsonwebtoken');

    it('ön-kayıt: doğrulanmamış hesap sosyal girişle sahiplenilince saldırganın şifresi ve oturumu düşer', async () => {
        const reg = await api('POST', '/auth/register', {
            body: { name: 'Saldirgan', surname: 'X', email: 'onkayit-kurban@test.com', password: 'Saldirgan123!', username: 'saldirgan_adi' }
        });
        assert.equal(reg.status, 201);

        const idToken = jwt.sign({
            sub: 'google-onkayit', email: 'onkayit-kurban@test.com', email_verified: true,
            given_name: 'Kurban', family_name: 'Gercek'
        }, 'sahte-imza');
        const soc = await api('POST', '/auth/social', { body: { provider: 'google', idToken, deviceName: 'test-suite' } });
        assert.equal(soc.status, 200);

        const girisDenemesi = await api('POST', '/auth/login', {
            body: { email: 'onkayit-kurban@test.com', password: 'Saldirgan123!' }
        });
        assert.notEqual(girisDenemesi.status, 200, 'saldırganın şifresi artık çalışmamalı');
        const eskiOturum = await api('POST', '/auth/refresh', { body: { refreshToken: reg.json.refreshToken } });
        assert.equal(eskiOturum.status, 401, 'kayıtta alınan oturum kapanmalı');

        const me = (await api('GET', '/auth/me', { token: soc.json.accessToken })).json.data;
        assert.equal(me.name, 'Kurban', 'ad sağlayıcıdan alınmalı');
        assert.equal(me.needsUsername, true, 'saldırganın seçtiği kullanıcı adı düşmeli');
        assert.equal(await User.countDocuments({ username: 'saldirgan_adi' }), 0);
        assert.equal(me.isEmailVerified, true);
    });

    it('gövdede sorgu operatörü reddedilir (NoSQL enjeksiyonu)', async () => {
        const u = await createVerifiedUser('nosql-hedef@test.com');
        for (const body of [
            { email: { $ne: null }, password: 'x' },
            { email: 'a@b.com', nested: [{ deep: { $regex: '^a' } }] }
        ]) {
            const res = await api('POST', '/auth/login', { body });
            assert.equal(res.status, 400, JSON.stringify(body));
        }
        const hedef = await User.findById(u._id);
        assert.ok(!hedef.loginThrottle?.failureCount, 'rastgele hesaba hatalı deneme yazılmamalı');

        // Derin iç içe gövde yığını taşırmaz (özyinelemesiz tarama)
        let derin = 'x';
        for (let i = 0; i < 5000; i++) derin = [derin];
        const { hasOperatorKey } = require('../middlewares/sanitize');
        assert.equal(hasOperatorKey({ a: derin }), false);
    });

    it('PUT /streak/update kaldırıldı: çalışmadan seri sürdürülemez', async () => {
        await createVerifiedUser('seri-hile@test.com');
        const { accessToken } = await login('seri-hile@test.com');
        const res = await api('PUT', '/streak/update', { token: accessToken });
        assert.equal(res.status, 404);
        const s = await api('GET', '/streak', { token: accessToken });
        assert.equal(s.json.data.currentStreak, 0);
    });

    it('POST /notifications/test yalnızca admin; metin uzunluğu sınırlı', async () => {
        await createVerifiedUser('bildirim-user@test.com');
        await createVerifiedUser('bildirim-admin@test.com', { role: 'admin' });
        const user = (await login('bildirim-user@test.com')).accessToken;
        const admin = (await login('bildirim-admin@test.com')).accessToken;
        assert.equal((await api('POST', '/notifications/test', { token: user, body: {} })).status, 403);
        const ok = await api('POST', '/notifications/test', { token: admin, body: { title: 'x'.repeat(500) } });
        assert.equal(ok.status, 200);
        assert.equal(ok.json.data.title.length, 100);
    });

    it('App Check: zorlama açıkken başlıksız kayıt/giriş 401, kapalıyken geçirgen', async () => {
        process.env.APP_CHECK_ENFORCE = 'true';
        try {
            const res = await api('POST', '/auth/check-email', { body: { email: 'appcheck@test.com' } });
            assert.equal(res.status, 401);
        } finally {
            delete process.env.APP_CHECK_ENFORCE;
        }
        const res = await api('POST', '/auth/check-email', { body: { email: 'appcheck@test.com' } });
        assert.equal(res.status, 200);
    });

    it('dil: yazma sorusu iki dili de kabul eder, doğru cevap kullanıcının dilinde', () => {
        const { wordAnswerVariants, gradeTyping } = require('../utils/answer.util');
        const w = { meaning: 'water', meaningTr: 'su', meaningTrAccepted: ['su'], meaningEnAccepted: ['water'] };
        assert.equal(gradeTyping('water', wordAnswerVariants(w, 'tr')), true, 'İngilizce arayüz regresyonu');
        assert.equal(gradeTyping('su', wordAnswerVariants(w, 'en')), true);
        assert.equal(wordAnswerVariants(w, 'en')[0], 'water');
        assert.equal(wordAnswerVariants(w, 'tr')[0], 'su');
        assert.equal(wordAnswerVariants({ meaning: 'water' }, 'tr')[0], 'water', 'Türkçesi olmayan kelime İngilizceye düşer');
    });

    it('dil: sınav şıkları ve anlam metni kullanıcının dilinde; okunuş sorusunda ses yok', async () => {
        const QuizService = require('../modules/quiz/quiz.service');
        await Word.updateMany({ jlptLevel: 'N3' },
            [{ $set: { meaningTr: { $concat: ['tr ', '$meaning'] }, audioUrl: 'https://ses.test/a.mp3' } }],
            { updatePipeline: true });
        try {
            const byFormat = async (lang) => {
                const qs = [];
                for (let i = 0; i < 6; i++) qs.push(...await QuizService.generateQuestions('N3', 8, lang));
                return qs;
            };
            const tr = await byFormat('tr');
            const en = await byFormat('en');
            const choicesOf = (qs, f) => qs.filter(q => q.format === f).flatMap(q => q.choices);
            assert.ok(choicesOf(tr, 'meaning').length && choicesOf(tr, 'meaning').every(c => c.startsWith('tr ')),
                'Türk kullanıcı Türkçe anlam şıkları görmeli');
            assert.ok(choicesOf(en, 'meaning').every(c => !c.startsWith('tr ')), 'İngilizce kullanıcı İngilizce görmeli');
            for (const q of tr.filter(q => q.format === 'reverse')) assert.ok(q.prompt.meaning.startsWith('tr '));
            for (const q of tr.filter(q => q.format === 'typing')) assert.ok(q.correctAnswers[0].startsWith('tr '));
            for (const q of [...tr, ...en].filter(q => q.format === 'reading')) {
                assert.equal(q.prompt.audioUrl, undefined, 'ses okunuşu, yani cevabı söylerdi');
            }
        } finally {
            await Word.updateMany({ jlptLevel: 'N3' }, { $unset: { meaningTr: 1, audioUrl: 1 } });
        }
    });

    it('aynı anda gelen oturum başlatma istekleri günün TEK oturumunu açar', async () => {
        const u = await createVerifiedUser('cift-oturum@test.com');
        const { accessToken } = await login('cift-oturum@test.com');
        const StudySession = require('../models/StudySession');
        await StudySession.init();
        // Servis doğrudan paralel çağrılır: HTTP üzerinden istekler yarış
        // penceresine nadiren denk geliyor, servis seviyesinde güvenilir üretilir
        const oturumlar = await Promise.all(Array.from({ length: 20 }, () =>
            StudySessionService.startSession(u._id, 'N5')));
        assert.equal(await StudySession.countDocuments({ user: u._id }), 1);
        assert.equal(new Set(oturumlar.map(o => String(o._id))).size, 1);
        const http = await api('POST', '/sessions/start', { token: accessToken, body: {} });
        assert.equal(http.json.data._id, String(oturumlar[0]._id));
    });

    it('seri sıfırlama ön filtresi: dün çalışan korunur, iki gün önce çalışan sıfırlanır', async () => {
        const a = await createVerifiedUser('seri-dun@test.com');
        const b = await createVerifiedUser('seri-eski@test.com');
        const { startOfDayInTz, addDays } = require('../utils/date.util');
        const dun = addDays(startOfDayInTz('Europe/Istanbul'), -1);
        await Streak.updateOne({ user: a._id }, { currentStreak: 5, lastStudyDate: new Date(dun.getTime() + 60 * 1000) });
        await Streak.updateOne({ user: b._id }, { currentStreak: 5, lastStudyDate: addDays(dun, -1) });
        await StreakService.resetExpiredStreaks();
        assert.equal((await Streak.findOne({ user: a._id })).currentStreak, 5);
        assert.equal((await Streak.findOne({ user: b._id })).currentStreak, 0);
    });

    it('bildirimler 90 günlük TTL ile silinir', async () => {
        await Notification.init();
        const idx = await Notification.collection.indexes();
        const ttl = idx.find(i => i.expireAfterSeconds !== undefined);
        assert.equal(ttl?.expireAfterSeconds, 90 * 24 * 60 * 60);
    });

    it('Apple token iptali: yapılandırma yoksa silme yine tamamlanır', async () => {
        const { revokeAppleTokens } = require('../utils/appleRevoke');
        const r = await revokeAppleTokens('kod');
        assert.deepEqual(r, { revoked: false, reason: 'not_configured' });
    });

    it('Apple token iptali: kod token\'a çevrilip /auth/revoke çağrılır', async () => {
        const { generateKeyPairSync } = require('node:crypto');
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const env = {
            APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_REVOKE_CLIENT_ID: 'com.musubi.app',
            APPLE_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64')
        };
        const eski = { ...process.env };
        Object.assign(process.env, env);
        const realFetch = global.fetch;
        const calls = [];
        global.fetch = async (url, opts) => {
            calls.push({ url, body: new URLSearchParams(opts.body) });
            const json = url.endsWith('/auth/token') ? { refresh_token: 'apple-refresh' } : {};
            return { ok: true, status: 200, json: async () => json };
        };
        try {
            const { revokeAppleTokens } = require('../utils/appleRevoke');
            const r = await revokeAppleTokens('taze-kod');
            assert.deepEqual(r, { revoked: true });
            assert.equal(calls[0].url, 'https://appleid.apple.com/auth/token');
            assert.equal(calls[0].body.get('code'), 'taze-kod');
            assert.equal(calls[1].url, 'https://appleid.apple.com/auth/revoke');
            assert.equal(calls[1].body.get('token'), 'apple-refresh');
            const secret = jwt.decode(calls[1].body.get('client_secret'), { complete: true });
            assert.equal(secret.header.alg, 'ES256');
            assert.equal(secret.payload.iss, 'TEAM123456');
            assert.equal(secret.payload.sub, 'com.musubi.app');
        } finally {
            global.fetch = realFetch;
            for (const k of Object.keys(env)) { if (eski[k] === undefined) delete process.env[k]; else process.env[k] = eski[k]; }
        }
    });
});
