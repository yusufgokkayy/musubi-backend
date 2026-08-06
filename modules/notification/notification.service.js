const Notification = require('../../models/Notification');
const User = require('../../models/User');
const Streak = require('../../models/Streak');
const Word = require('../../models/Word');
const Progress = require('../../models/Progress');
const AppError = require('../../utils/AppError');
const sendNotification = require('../../utils/notification');
const { startOfDayInTz, localHourInTz, localMinutesInTz, parseHHmm } = require('../../utils/date.util');

// notificationSettings.reminderTime yoksa/bozuksa kullanılan eski sabit saat
const DEFAULT_REMINDER_MINUTES = 10 * 60;
// Hatırlatma saatinden sonra bildirimin hâlâ "zamanında" sayıldığı süre
const REMINDER_GRACE_MINUTES = 120;

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

    // Cron tarafından çeyrek saatte bir çağrılır (server.js). Her kullanıcının
    // KENDİ saat dilimindeki saate göre günün bildirimleri üretilir:
    //   reminderTime — "Bugünün Görevi" (daily_task) + "Günlük Kelime" (daily_word)
    //   19:00 — serisi olup henüz çalışmamışsa nazik hatırlatma (streak_reminder)
    //   23:00 — hâlâ çalışmamışsa son uyarı: "1 saat sonra serini kaybedeceksin" (streak_warning)
    // `now` parametresi test edilebilirlik içindir.
    async generateDailyNotifications(now = new Date()) {
        const users = await User.find({ active: true })
            .select('notificationSettings timezone dailyGoal +fcmToken');

        for (const user of users) {
            try {
                const hour = localHourInTz(user.timezone, now);
                const localMinutes = localMinutesInTz(user.timezone, now);

                // Hatırlatma saati kullanıcı tercihidir (onboarding'deki saat
                // seçici). Bozuk/eksik değerde eski sabit davranışa düşülür.
                const reminderMinutes =
                    parseHHmm(user.notificationSettings?.reminderTime) ?? DEFAULT_REMINDER_MINUTES;
                const sinceReminder = localMinutes - reminderMinutes;
                // Cron kaçırılırsa (deploy/restart) hatırlatma bir sonraki turda
                // yakalanır; ama gecikme payını aşınca hiç gönderilmez —
                // gece yarısı düşen "Bugünün Görevi" bildirimi rahatsız edicidir
                const inReminderWindow =
                    sinceReminder >= 0 && sinceReminder < REMINDER_GRACE_MINUTES;

                if (!inReminderWindow && hour !== 19 && hour !== 23) continue;

                const today = startOfDayInTz(user.timezone, now);

                // Aynı gün aynı tipten tekrar oluşturma (restart + çeyrek saatlik
                // tekrar tetikleme dedupe'u)
                const dedupe = async (type) => Notification.exists({
                    user: user._id, type, createdAt: { $gte: today }
                });

                if (inReminderWindow) {
                    if (!(await dedupe('daily_task'))) {
                        await NotificationService.create(user._id, {
                            type: 'daily_task',
                            title: 'Bugünün Görevi',
                            body: `Bugün ${user.dailyGoal || 20} ezberlenecek kelime seni bekliyor!`,
                            data: { dailyGoal: user.dailyGoal || 20 }
                        }, user);
                    }
                    if (!(await dedupe('daily_word'))) {
                        const word = await NotificationService.pickDailyWord(user._id);
                        if (word) {
                            await NotificationService.create(user._id, {
                                type: 'daily_word',
                                title: 'Günlük Kelime',
                                body: `Bugünün günlük kelimesi; ${word.kanji} (${word.romaji}) = ${word.meaning}`,
                                data: { wordId: word._id, kanji: word.kanji }
                            }, user);
                        }
                    }
                    // BİLEREK continue YOK: hatırlatma saatini 19:00/23:00 seçen
                    // kullanıcı aynı turda seri bildirimini de almalı
                }

                // 19:00 ve 23:00 yalnızca seri riski taşıyanlara gider
                if (hour !== 19 && hour !== 23) continue;

                const streak = await Streak.findOne({ user: user._id });
                const studiedToday = streak?.lastStudyDate && streak.lastStudyDate >= today;
                if (studiedToday || !(streak?.currentStreak > 0)) continue;

                if (hour === 19 && !(await dedupe('streak_reminder'))) {
                    await NotificationService.create(user._id, {
                        type: 'streak_reminder',
                        title: `${streak.currentStreak} Günlük Seri!`,
                        body: 'Serini devam ettirmeyi unutma.',
                        data: { currentStreak: streak.currentStreak }
                    }, user);
                }

                if (hour === 23 && !(await dedupe('streak_warning'))) {
                    await NotificationService.create(user._id, {
                        type: 'streak_warning',
                        title: 'Serini Kaybedeceksin',
                        body: '1 saat sonra serini kaybedeceksin. Acele et, dersini kaçırma...',
                        data: { currentStreak: streak.currentStreak }
                    }, user);
                }
            } catch (err) {
                console.error(`Notification generation failed for user ${user._id}:`, err.message);
            }
        }
    },

    // Günlük kelime: kullanıcının açık en yüksek seviyesinden rastgele bir core kelime
    async pickDailyWord(userId) {
        const unlocked = await Progress.find({ user: userId, isUnlocked: true }).select('jlptLevel');
        const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
        const highestIdx = unlocked.reduce((max, p) => Math.max(max, LEVELS.indexOf(p.jlptLevel)), 0);

        const [word] = await Word.aggregate([
            { $match: { jlptLevel: LEVELS[highestIdx], isCore: true } },
            { $sample: { size: 1 } }
        ]);
        return word || null;
    }
};

module.exports = NotificationService;
