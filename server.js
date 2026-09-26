const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

// Ortam doğrulaması — her şeyden ÖNCE. Bazı davranışlar NODE_ENV'e bağlı ve
// "test" değeri bilerek gevşektir: sosyal giriş token imzası doğrulanmaz, mail
// gönderilmez, rate limit kapalıdır. Test süiti app.js'i doğrudan kullanır,
// server.js'i hiç çalıştırmaz; yani gerçek bir sunucunun test modunda açılması
// yalnızca yanlış yapılandırma olabilir ve bu, herkesin herkes olarak giriş
// yapabildiği bir sunucu demektir. Tanınmayan/boş değerde de açılmaz.
const ALLOWED_ENVS = ['production', 'development'];
if (!ALLOWED_ENVS.includes(process.env.NODE_ENV)) {
    console.error(`NODE_ENV="${process.env.NODE_ENV ?? ''}" geçersiz — production veya development olmalı. Sunucu başlatılmadı.`);
    process.exit(1);
}

const connectDatabase = require('./config/db');
const cron = require('node-cron');

// Eksik CLIENT_URL bir dönem maillerin "http://undefined/..." linkiyle
// gitmesine yol açtı; artık gönderim anında hata veriyor ama sebebi açılışta
// görünür kılmak teşhisi kolaylaştırır (Railway → Variables → CLIENT_URL)
if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL) {
    console.error('UYARI: CLIENT_URL tanımlı değil — doğrulama/sıfırlama mailleri gönderilemez');
}

// Açılışta kelime seed'inin durumu loglanır. Seed manuel çalıştırılıyor
// (npm run seed) ve çalıştırılmadığında uygulama HATA VERMEZ: kütüphane boş,
// ders boş, seviye listesinde totalWords 0 — hepsi 200 OK. Eksikliğin tek
// görünür olduğu yer burası olsun.
// Zincire .catch EKLENMEZ: bağlantı hatası eskisi gibi unhandledRejection'a
// düşüp süreci kapatmalı. Sayımın kendi hatası aşağıda yutulur.
connectDatabase().then(async () => {
    try {
        const WordService = require('./modules/word/word.service');
        const counts = await WordService.coreWordCounts();
        const bos = Object.entries(counts).filter(([, n]) => n === 0).map(([lvl]) => lvl);
        const ozet = Object.entries(counts).map(([lvl, n]) => `${lvl}:${n}`).join(' ');

        if (bos.length === 5) {
            console.error('[seed] HİÇ çekirdek kelime yok — "npm run seed" çalıştırılmadı. Kütüphane, ders ve quiz boş gelecek.');
        } else if (bos.length) {
            console.error(`[seed] çekirdek kelimesi olmayan seviye(ler): ${bos.join(', ')} — ${ozet}`);
        } else {
            console.log(`[seed] çekirdek kelime sayımı: ${ozet}`);
        }
    } catch (err) {
        console.error('[seed] kelime sayımı yapılamadı:', err.message);
    }
});

require('./config/firebase');

const app = require('./app');
const StreakService = require('./modules/streak/streak.service');
const NotificationService = require('./modules/notification/notification.service');
const UserWordService = require('./modules/userword/userword.service');
const AuthService = require('./modules/auth/auth.service');

// Zamanlanmış görevler sunucu sürecinin İÇİNDE çalışır. Servis birden fazla
// kopyayla (replica) çalıştırılırsa her kopya her görevi ayrı çalıştırır:
// bildirimler iki kez gider, temizlik iki kez koşar. Ek kopyalarda
// CRON_ENABLED=false verilir; görevleri yalnızca bir kopya yürütür.
if (process.env.CRON_ENABLED === 'false') {
    console.log('[cron] CRON_ENABLED=false — bu kopyada zamanlanmış görev çalışmıyor');
} else {
    // Cron logları "[cron]" önekiyle basılır: deploy loglarında bu kelimeyle
    // filtreleyince görevlerin çalıştığı/çalışmadığı doğrudan görülür
    console.log('[cron] 4 görev zamanlandı: streak reset (saatlik :05), bildirim üretimi (15 dk), mastery decay (03:00 UTC), doğrulanmamış hesap temizliği (03:30 UTC)');

    // Her saat başı çalışır: her kullanıcının KENDİ saat diliminde günü geçmişse
    // serisi sıfırlanır (timezone-aware, idempotent)
    cron.schedule('5 * * * *', async () => {
        try {
            await StreakService.resetExpiredStreaks();
            console.log('[cron] streak reset tamamlandı');
        } catch (err) {
            console.error('[cron] Streak reset hatası:', err.message);
        }
    });

    // Çeyrek saatte bir çalışır: hatırlatma saati kullanıcı tercihidir (HH:mm) ve
    // saatlik tur 14:30 seçen kullanıcıyı 15:10'a kaydırırdı. Seri hatırlatmaları
    // (19:00/23:00) aynı turda, gün içi dedupe ile tek sefer üretilir.
    cron.schedule('*/15 * * * *', async () => {
        try {
            await NotificationService.generateDailyNotifications();
            console.log('[cron] bildirim üretimi tamamlandı');
        } catch (err) {
            console.error('[cron] Bildirim üretim hatası:', err.message);
        }
    });

    // Günde bir: uzun süre tekrar edilmeyen kelimelerin görünen seviyesini
    // kademeli düşürür (SM-2 verisine dokunmaz, ilk doğru cevapta geri zıplar)
    cron.schedule('0 3 * * *', async () => {
        try {
            const result = await UserWordService.applyMasteryDecay();
            console.log(`[cron] mastery decay tamamlandı: ${result.affectedWords} kelime, ${result.affectedUsers} kullanıcı`);
        } catch (err) {
            console.error('[cron] Mastery decay hatası:', err.message);
        }
    });

    // Günde bir: 7 gündür doğrulanmamış hesapları ve yan kayıtlarını siler.
    // DB'de çöp birikmesini önler VE squat edilmiş e-posta adresini yeniden
    // kayda açar (saldırgan kurbanın adresiyle kaydolup hesabı rehin tutamaz)
    cron.schedule('30 3 * * *', async () => {
        try {
            const { purged } = await AuthService.purgeUnverifiedAccounts();
            console.log(`[cron] doğrulanmamış hesap temizliği tamamlandı: ${purged} hesap silindi`);
        } catch (err) {
            console.error('[cron] Doğrulanmamış hesap temizliği hatası:', err.message);
        }
    });
}

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} - ${process.env.NODE_ENV}`);
});

// Graceful shutdown: tek bir başıboş promise tüm sunucuyu anında düşürmesin;
// açık istekler tamamlanır, sonra süreç kapanır
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
    server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
    console.log('SIGTERM alındı, sunucu kapatılıyor...');
    server.close(() => process.exit(0));
});
