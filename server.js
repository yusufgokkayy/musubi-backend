const dotenv = require('dotenv');
dotenv.config({ path: './.env' });

const connectDatabase = require('./config/db');
const cron = require('node-cron');

connectDatabase();

require('./config/firebase');

const app = require('./app');
const StreakService = require('./modules/streak/streak.service');
const NotificationService = require('./modules/notification/notification.service');
const UserWordService = require('./modules/userword/userword.service');

// Her saat başı çalışır: her kullanıcının KENDİ saat diliminde günü geçmişse
// serisi sıfırlanır (timezone-aware, idempotent)
cron.schedule('5 * * * *', async () => {
    try {
        await StreakService.resetExpiredStreaks();
    } catch (err) {
        console.error('Streak reset hatası:', err.message);
    }
});

// Her saat başı çalışır: yerel saati 19:00 olan kullanıcılara, o gün
// çalışmamışlarsa seri hatırlatması/uyarısı oluşturur
cron.schedule('10 * * * *', async () => {
    try {
        await NotificationService.generateDailyNotifications();
    } catch (err) {
        console.error('Bildirim üretim hatası:', err.message);
    }
});

// Günde bir: uzun süre tekrar edilmeyen kelimelerin görünen seviyesini
// kademeli düşürür (SM-2 verisine dokunmaz, ilk doğru cevapta geri zıplar)
cron.schedule('0 3 * * *', async () => {
    try {
        const result = await UserWordService.applyMasteryDecay();
        if (result.affectedWords > 0) {
            console.log(`Mastery decay: ${result.affectedWords} kelime, ${result.affectedUsers} kullanıcı`);
        }
    } catch (err) {
        console.error('Mastery decay hatası:', err.message);
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
