const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const connectDatabase = require('./config/db');
const cron = require('node-cron');

// Eksik CLIENT_URL bir dönem maillerin "http://undefined/..." linkiyle
// gitmesine yol açtı; artık gönderim anında hata veriyor ama sebebi açılışta
// görünür kılmak teşhisi kolaylaştırır (Railway → Variables → CLIENT_URL)
if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL) {
    console.error('UYARI: CLIENT_URL tanımlı değil — doğrulama/sıfırlama mailleri gönderilemez');
}

connectDatabase();

require('./config/firebase');

const app = require('./app');
const StreakService = require('./modules/streak/streak.service');
const NotificationService = require('./modules/notification/notification.service');
const UserWordService = require('./modules/userword/userword.service');
const AuthService = require('./modules/auth/auth.service');

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
