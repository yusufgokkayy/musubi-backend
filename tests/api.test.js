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
let User, Word, UserWord, Notification, QuizAttempt, Event, Progress, Streak, DeviceSession;
let UserWordService, NotificationService, ProgressService, StreakService, StudySessionService, AuthService, sendEmail;

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
    StudySessionService = require('../modules/studysession/studysession.service');
    AuthService = require('../modules/auth/auth.service');

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
        assert.equal(fresh.notificationSettings.wordLevelDown, true);
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
            ['GET', '/home/summary'], ['GET', '/home/calendar'],
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

        // Ertesi günkü yanlış gerçek unutma sinyalidir: sıfırlar + bildirim
        await UserWord.updateOne(
            { user: userId, word: wordId },
            { $set: { lastReviewDate: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        );
        res = await api('POST', '/userwords/answer', { token, body: { wordId, result: 'wrong' } });
        assert.equal(res.json.data.masteryLevel, 1);
        assert.equal(res.json.data.levelDropped, true);
        assert.equal(res.json.data.previousLevel, 3);

        const notifs = await api('GET', '/notifications', { token });
        assert.ok(notifs.json.data.notifications.some(n => n.type === 'word_level_down'));
    });

    it('easy doğru sayılır ve SM-2\'yi ilerletir (studysession ile tutarlı)', async () => {
        // Sıralama havuz sırasıyla aynı olmayabilir; cevaplanmamış bir kelime seç
        const w = (await api('GET', '/userwords/today?jlptLevel=N5', { token }))
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
        const w = (await api('GET', '/userwords/today?jlptLevel=N5', { token }))
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

describe('Ders akışı (devam + backend puanlama + session)', () => {
    let token, w0, w1;

    before(async () => {
        await createVerifiedUser('ders@test.com', { dailyGoal: 20 });
        token = (await login('ders@test.com')).accessToken;
        const today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
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
        res = await api('POST', '/userwords/answer', { token, body: { wordId: wrong._id, answer: 'aşağı' } });
        assert.equal(res.json.data.result, 'wrong');
        assert.equal(res.json.data.correctAnswer, 'up / above');

        // Boş bırakılan → empty
        const empty = await Word.create({ kanji: '右', romaji: 'migi', meaning: 'right', type: 'isim', jlptLevel: 'N5' });
        res = await api('POST', '/userwords/answer', { token, body: { wordId: empty._id, answer: '  ' } });
        assert.equal(res.json.data.result, 'empty');
    });

    it('today yanıtı kaldığın yerden devam bilgisi ve isKana verir', async () => {
        const today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        const d = today.json.data;

        assert.deepEqual(d.progress, { total: 20, answered: 2, remaining: 18 },
            'havuzdan yalnızca w0 ve w1 cevaplandı');

        const a0 = d.newWords.find(w => w._id === w0._id);
        const a1 = d.newWords.find(w => w._id === w1._id);
        assert.equal(a0.answeredToday, true);
        assert.equal(a0.todayResult, 'correct');
        assert.equal(a1.todayResult, 'wrong');
        assert.ok(d.newWords.filter(w => !w.answeredToday).length === 18, 'kalanlar işaretsiz');

        assert.equal(a0.isKana, false, 'kanji içeren kelimede isKana false');
        const itsumo = await Word.findOne({ romaji: 'itsumo' });
        const detail = await api('GET', `/words/${itsumo._id}`, { token });
        assert.equal(detail.json.data.isKana, true, 'kana-only kelimede isKana true');
    });

    it('today jlptLevel zorunludur — yoksa/geçersizse 400 (hayalet ikinci havuz açılmasın)', async () => {
        const missing = await api('GET', '/userwords/today', { token });
        assert.equal(missing.status, 400);

        const invalid = await api('GET', '/userwords/today?jlptLevel=N6', { token });
        assert.equal(invalid.status, 400);
    });

    it('dailyGoal gün içinde artınca havuz genişler: önce vadesi gelen tekrarlar, sonra yeni kelimeler', async () => {
        const up = await api('PUT', '/auth/update-info', { token, body: { dailyGoal: 25 } });
        assert.equal(up.status, 200);

        const today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        const d = today.json.data;
        assert.equal(d.progress.total, 25, 'havuz 20→25 genişlemeli');
        // migi (右) bugün ertelendi (empty) ve vadesi geçmiş durumda: genişleme
        // kontenjanına yeni kelimeden ÖNCE, tekrar olarak girer — dokunulmuş
        // (empty dahil) sayıldığı için w0/w1 + migi = 3
        assert.equal(d.progress.answered, 3, 'önceki cevaplar (w0, w1) + dokunulan migi (empty) sayılır');
        assert.ok(d.reviewWords.some(r => r.word.kanji === '右'),
            'vadesi gelmiş kelime top-up kontenjanına önce girer');

        // İkinci çağrı tekrar büyütmemeli (idempotent)
        const again = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        assert.equal(again.json.data.progress.total, 25);
    });

    it('sessions/complete hazır accuracy yüzdesi döner', async () => {
        const res = await api('PUT', '/sessions/complete', { token });
        assert.equal(res.status, 200);
        const d = res.json.data;
        // w0 correct, w1 wrong, miru/shita/itsumo correct, ue wrong, migi empty → 4/7
        assert.equal(d.totalWords, 7);
        assert.equal(d.correctCount, 4);
        assert.equal(d.accuracy, 57);
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
        const before = (await api('GET', '/userwords/today?jlptLevel=N5', { token })).json.data;
        const w = before.newWords.find(x => !x.answeredToday);
        const s0 = (await api('GET', '/sessions/today', { token })).json.data;

        let res = await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'empty' } });
        assert.equal(res.json.data.counted, true);

        let today = (await api('GET', '/userwords/today?jlptLevel=N5', { token })).json.data;
        let item = today.newWords.find(x => x._id === w._id);
        assert.equal(item.answeredToday, false, 'nihai cevap yok: kelime yeniden sorulmalı');
        assert.equal(item.touchedToday, true, 'ama dokunuldu: ilerleme sayacında görünmeli');
        assert.equal(item.todayResult, 'empty', 'istemci "ertelendi" bilgisini görebilmeli');
        assert.equal(today.progress.answered, before.progress.answered + 1,
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

        today = (await api('GET', '/userwords/today?jlptLevel=N5', { token })).json.data;
        item = today.newWords.find(x => x._id === w._id);
        assert.equal(item.answeredToday, true);
        assert.equal(item.todayResult, 'correct');
        assert.equal(today.progress.answered, before.progress.answered + 1,
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

describe('Session güvenilirliği (zorunlu session + idempotent bitirme + yeni tur)', () => {
    let token, w0, w1, w2;

    before(async () => {
        await createVerifiedUser('guvenlik@test.com', { dailyGoal: 20 });
        token = (await login('guvenlik@test.com')).accessToken;
        const today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
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

    it('session tamamlandıktan sonra today yeni bir tur açar: önceki havuzun kelimeleri tekrar gelmez', async () => {
        // Önceki testte w0/w1 cevaplandı, session tamamlandı (isCompleted:true).
        // BİLEREK gerçek istemci sırasıyla: start ÖNCE, today SONRA. Bu sıra
        // StudySession.isCompleted'ı today'den önce sıfırlardı (regresyon riski);
        // tetikleyici artık DailyWordPool.roundClosedAt olduğu için etkilenmemeli.
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        const newRound = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        const newIds = new Set([...newRound.json.data.newWords, ...newRound.json.data.reviewWords].map(w => (w.word || w)._id));

        // w2 önceki turda hiç cevaplanmamıştı (havuzda kalmıştı) — yine de yeni
        // turda tekrar gelmemeli, çünkü önceki havuzun TAMAMI hariç tutulur
        const oldPoolWordIds = [w0._id, w1._id, w2._id];
        const overlap = oldPoolWordIds.filter(id => newIds.has(id));
        assert.equal(overlap.length, 0, 'yeni tur önceki havuzun kelimelerini İÇERMEMELİ');

        const s = await api('GET', '/sessions/today', { token });
        assert.equal(s.json.data.isCompleted, false, 'yeni tur session\'ı yeniden açmalı');
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
        assert.equal(d.goal, 20, 'çemberin PAYDASI: bugünün havuz boyutu');
        assert.equal(d.dailyGoal, 20, 'ayarlardaki tercih değeri');
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

    it('hedef değişimi çemberin paydasını ANINDA oynatmaz; payda havuzla birlikte büyür', async () => {
        await api('PUT', '/auth/update-info', { token, body: { dailyGoal: 40 } });

        let res = await api('GET', '/home/summary', { token });
        assert.equal(res.json.data.goal, 20, 'havuz büyümeden payda değişmez (20/40 tutarsızlığı olmaz)');
        assert.equal(res.json.data.dailyGoal, 40, 'tercih değeri ise anında güncellenir');

        // Havuz bir sonraki today çağrısında genişler; payda onunla birlikte büyür
        await api('GET', '/userwords/today?jlptLevel=N5', { token });
        res = await api('GET', '/home/summary', { token });
        assert.equal(res.json.data.goal, 30, 'test setinde 30 core N5 var: 20 + kalan 10');
    });
});

describe('Anasayfa — çoklu tur: payda SABİT kalır, pay hedefi aşabilir', () => {
    let token;

    it('1. tur tamamlanıp 2. tur açılınca goal SABİT kalır (büyümez), totalWords aşabilir', async () => {
        await createVerifiedUser('coklutur@test.com', { dailyGoal: 5 });
        token = (await login('coklutur@test.com')).accessToken;

        // 1. tur: 5 kelime, hepsini cevapla, oturumu bitir (roundClosedAt set edilir)
        let today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        for (const w of today.json.data.newWords) {
            await api('POST', '/userwords/answer', { token, body: { wordId: w._id, result: 'correct' } });
        }
        await api('PUT', '/sessions/complete', { token });

        let summary = await api('GET', '/home/summary', { token });
        assert.equal(summary.json.data.goal, 5, '1. tur bitince payda 5');
        assert.equal(summary.json.data.today.totalWords, 5);

        // 2. tur: today çağrısı yeni turu açar (roundClosedAt -> null, taze 5 kelime daha)
        today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        assert.equal(today.json.data.newWords.length, 5, '2. tur da 5 taze kelime getirir');
        assert.equal(today.json.data.goal, 5, 'ürün kararı: yeni tur paydayı büyütmez, sabit kalır');

        // 2. turda yalnızca 1 kelime cevapla (tur tamamlanmadı)
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
        const ans = await api('POST', '/userwords/answer', {
            token, body: { wordId: today.json.data.newWords[0]._id, result: 'correct' }
        });

        // /userwords/answer yanıtı da AYNI goal/today şeklini taşır — istemci
        // her cevaptan sonra kendi toplamını hesaplamak yerine buna güvenir
        assert.equal(ans.json.data.today.totalWords, 6, 'session sayacı turlar arası birikir: 5 + 1');
        assert.equal(ans.json.data.goal, 5, 'payda hâlâ 5 — büyümedi');

        summary = await api('GET', '/home/summary', { token });
        assert.equal(summary.json.data.today.totalWords, 6);
        assert.equal(summary.json.data.goal, 5, 'Anasayfa da aynı sabit paydayı görmeli');
        assert.ok(summary.json.data.today.totalWords > summary.json.data.goal,
            'hedefi aşmak normaldir: 6 > 5, ring %100\'ü geçer, payda yerinden oynamaz');

        // /userwords/today da (yeniden çağrılınca) AYNI sayıları görmeli —
        // üç uç nokta (today/answer/home) tek kaynaktan (StudySession) besleniyor
        today = await api('GET', '/userwords/today?jlptLevel=N5', { token });
        assert.equal(today.json.data.today.totalWords, 6);
        assert.equal(today.json.data.goal, 5);
    });
});

describe('Seviyeler ekranı', () => {
    let token;

    before(async () => {
        await createVerifiedUser('seviye@test.com');
        token = (await login('seviye@test.com')).accessToken;
        await api('POST', '/sessions/start', { token, body: { jlptLevel: 'N5' } });
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

describe('Kelime havuzu sıralaması (müfredat/frequencyRank)', () => {
    let token;

    before(async () => {
        // Bilerek TERS sırada eklendi: kayıt sırası değil frequencyRank belirlemeli
        await Word.insertMany([
            { kanji: '外科医', romaji: 'gekai', meaning: 'surgeon', type: 'isim', jlptLevel: 'N3', isCore: true, frequencyRank: 30 },
            { kanji: '医者', romaji: 'isha', meaning: 'doctor', type: 'isim', jlptLevel: 'N3', isCore: true, frequencyRank: 10 },
            { kanji: '看護師', romaji: 'kangoshi', meaning: 'nurse', type: 'isim', jlptLevel: 'N3', isCore: true, frequencyRank: 20 }
        ]);
        await createVerifiedUser('siralama@test.com');
        token = (await login('siralama@test.com')).accessToken;
    });

    it('yeni kelimeler frequencyRank artan sırada gelir (rastgele DEĞİL — ön koşul kelime önce)', async () => {
        const res = await api('GET', '/userwords/today?jlptLevel=N3', { token });
        assert.equal(res.status, 200);
        const kanjis = res.json.data.newWords.map(w => w.kanji);
        assert.deepEqual(kanjis, ['医者', '看護師', '外科医'], 'doktor → hemşire → cerrah sırası korunmalı');

        // Aynı gün tekrar çağrıldığında (havuz zaten var) sıra yine korunur
        const again = await api('GET', '/userwords/today?jlptLevel=N3', { token });
        assert.deepEqual(again.json.data.newWords.map(w => w.kanji), ['医者', '看護師', '外科医']);
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
        await StudySessionService.startSession(userId, 'N4');
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

    it('5 MB üstü dosya ve tanınmayan preset reddedilir', async () => {
        const buyuk = Buffer.alloc(6 * 1024 * 1024, 0x00);
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
