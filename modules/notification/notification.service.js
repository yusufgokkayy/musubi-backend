const Notification = require('../../models/Notification');
const User = require('../../models/User');
const Streak = require('../../models/Streak');
const Word = require('../../models/Word');
const AppError = require('../../utils/AppError');
const sendNotification = require('../../utils/notification');
const { startOfDayInTz, localHourInTz } = require('../../utils/date.util');

// Push'u arkaplanda gönderir; asla hata fırlatmaz, cevap gecikmesine eklenmez.
// FCM "token artık kayıtlı değil" derse token'ı kullanıcıdan siler ki
// ölü cihaza tekrar tekrar denenmesin.
const sendPushSafe = (fcmToken, { title, body, data }) => {
    if (!fcmToken) return;
    sendNotification({ token: fcmToken, title, body, data })
        .catch(async (err) => {
            if (err.code === 'messaging/registration-token-not-registered' ||
                err.code === 'messaging/invalid-argument') {
                await User.updateOne({ fcmToken }, { $unset: { fcmToken: 1 } }).catch(() => {});
            }
        });
};

// Decay özetleri: kayıp kullanıcıya spam yapma — son çalışmadan beri en fazla
// 3 dokunuş, iki özet arasında en az 3 gün
const DECAY_MAX_TOUCHES = 3;
const DECAY_MIN_GAP_DAYS = 3;

// Bildirim tipi -> kullanıcının notificationSettings bayrağı
const SETTING_MAP = {
    daily_word: 'dailyReminder',
    daily_task: 'dailyReminder',
    streak_reminder: 'streakReminder',
    streak_warning: 'streakReminder',
    word_level_down: 'wordLevelDown'
};

const NotificationService = {
    // userDoc verilirse (toplu işlerde tekrar sorgu atmamak için) onun
    // notificationSettings + fcmToken alanları kullanılır.
    async create(userId, { type, title, body, data = {} }, userDoc = null) {
        const user = userDoc ||
            await User.findById(userId).select('notificationSettings +fcmToken');

        // Kullanıcı bu bildirim tipini kapattıysa oluşturma
        const flag = SETTING_MAP[type];
        if (flag && user?.notificationSettings?.[flag] === false) return null;

        const notification = await Notification.create({ user: userId, type, title, body, data });

        // Uygulama içi kayıt + telefona push (arkaplanda)
        sendPushSafe(user?.fcmToken, { title, body, data });

        return notification;
    },

    async list(userId, page = 1, limit = 20) {
        page = Math.max(parseInt(page) || 1, 1);
        limit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const skip = (page - 1) * limit;

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find({ user: userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Notification.countDocuments({ user: userId }),
            Notification.countDocuments({ user: userId, read: false })
        ]);

        return {
            notifications,
            total,
            unreadCount,
            page,
            totalPages: Math.ceil(total / limit)
        };
    },

    async markAsRead(userId, notificationId) {
        const notification = await Notification.findOne({
            _id: notificationId,
            user: userId
        });
        if (!notification) throw new AppError('Notification not found', 404);

        notification.read = true;
        await notification.save();
        return notification;
    },

    async markAllAsRead(userId) {
        const result = await Notification.updateMany(
            { user: userId, read: false },
            { read: true }
        );
        return { modifiedCount: result.modifiedCount };
    },

    // Decay cron'undan çağrılır: seviyesi düşen kelimeler için TEK özet bildirim.
    // Kurallar: kullanıcının wordLevelDown tercihi açık olmalı; aynı gün başka
    // word_level_down bildirimi yoksa; son çalışmadan beri en fazla 3 özet;
    // iki özet arasında en az 3 gün. Dil cezalandırıcı değil, davet edici.
    async createDecaySummary(userId, { count, sampleWordIds = [] }) {
        const user = await User.findById(userId).select('notificationSettings timezone +fcmToken');
        if (!user || user.notificationSettings?.wordLevelDown === false) return null;

        const streak = await Streak.findOne({ user: userId });
        const since = streak?.lastStudyDate || new Date(0);

        const previousSummaries = await Notification.find({
            user: userId,
            type: 'word_level_down',
            'data.source': 'decay',
            createdAt: { $gte: since }
        }).sort({ createdAt: -1 }).limit(DECAY_MAX_TOUCHES);

        if (previousSummaries.length >= DECAY_MAX_TOUCHES) return null;
        if (previousSummaries[0] &&
            Date.now() - previousSummaries[0].createdAt.getTime() < DECAY_MIN_GAP_DAYS * 24 * 60 * 60 * 1000) {
            return null;
        }

        // Aynı gün (kullanıcının saat diliminde) zaten bir seviye bildirimi varsa atla
        const today = startOfDayInTz(user.timezone);
        const todayAny = await Notification.exists({
            user: userId,
            type: 'word_level_down',
            createdAt: { $gte: today }
        });
        if (todayAny) return null;

        const sampleWords = await Word.find({ _id: { $in: sampleWordIds } }).select('kanji');
        const sample = sampleWords.map(w => w.kanji).join(', ');
        const rest = count - sampleWords.length;

        const title = 'Kelimeler tazelenmek istiyor 🌱';
        const body = `${sample}${rest > 0 ? ` ve ${rest} kelime daha` : ''} seni bekliyor. Birkaç dakikada hafızanı tazele!`;
        const data = { source: 'decay', count };

        const notification = await Notification.create({
            user: userId, type: 'word_level_down', title, body, data
        });

        sendPushSafe(user.fcmToken, { title, body, data });

        return notification;
    },

    // Cron tarafından her saat başı çağrılır (server.js). Her kullanıcı için
    // KENDİ saat diliminde saat 19:00'a denk gelen turda, o gün çalışmamışsa
    // seri hatırlatması / uyarısı oluşturur.
    async generateDailyNotifications() {
        const users = await User.find({ active: true }).select('notificationSettings timezone +fcmToken');

        for (const user of users) {
            try {
                // Kullanıcının yerel saati 19 değilse bu tur ona ait değil
                if (localHourInTz(user.timezone) !== 19) continue;

                const today = startOfDayInTz(user.timezone);

                // Aynı gün aynı tipten tekrar oluşturma (restart dedupe)
                const existing = await Notification.findOne({
                    user: user._id,
                    type: { $in: ['streak_reminder', 'streak_warning'] },
                    createdAt: { $gte: today }
                });
                if (existing) continue;

                const streak = await Streak.findOne({ user: user._id });
                const studiedToday = streak?.lastStudyDate && streak.lastStudyDate >= today;
                if (studiedToday) continue;

                if (streak?.currentStreak > 0) {
                    await NotificationService.create(user._id, {
                        type: 'streak_warning',
                        title: 'Serini Kaybedeceksin',
                        body: `${streak.currentStreak} günlük serin bitmek üzere. Acele et, dersini kaçırma...`,
                        data: { currentStreak: streak.currentStreak }
                    }, user);
                } else {
                    await NotificationService.create(user._id, {
                        type: 'streak_reminder',
                        title: 'Bugünün Görevi',
                        body: 'Bugün ezberlenecek kelimeler seni bekliyor!',
                        data: {}
                    }, user);
                }
            } catch (err) {
                console.error(`Notification generation failed for user ${user._id}:`, err.message);
            }
        }
    }
};

module.exports = NotificationService;
