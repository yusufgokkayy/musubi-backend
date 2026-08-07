const StudySession = require('../../models/StudySession');
const Streak = require('../../models/Streak');
const Progress = require('../../models/Progress');
const UserWord = require('../../models/UserWord');
const User = require('../../models/User');
const Word = require('../../models/Word');
const Event = require('../../models/Event');
const DailyWordPool = require('../../models/DailyWordPool');
const Notification = require('../../models/Notification');
const AppError = require('../../utils/AppError');
const {
    startOfDayInTz, startOfDateInTz, addDays,
    localDateStr, localHourInTz, weekDatesInTz
} = require('../../utils/date.util');

// Ürün kararı: yeni tur açılınca payda SABİT kalır (önceki turların boyutu
// eklenmez); kullanıcı hedefini aşarsa StudySession.totalWords (turlar arası
// hiç sıfırlanmaz) paydayı geçer — "23/20" gibi %100'ü aşan bir oran normaldir,
// hedef yerinden oynamaz.
// Havuz boyutunun kendisi modelde (DailyWordPool.goalTotal): bildirim servisi
// de aynı hesabı kullanıyor, iki kopya ayrışmasın.
const poolGoalTotal = DailyWordPool.goalTotal;

// Başlıktaki "こんにちは / Merhaba Emirhan" selamlaması. Kullanıcının KENDİ
// saat dilimine göre seçilir — cihaz saatine bırakılsaydı gün sınırı, seri ve
// hatırlatma saati profil saat dilimini kullanırken tek burası ayrışırdı.
const greetingFor = (hour) => {
    if (hour < 11) return 'おはようございます';
    if (hour < 18) return 'こんにちは';
    return 'こんばんは';
};

// Anasayfadaki hata çipleri bir ÖNİZLEMEDİR; tam liste "Detaya Git" ile
// GET /userwords/mistakes'ten sayfalanarak gelir. 40 hatalı günde 40 çip
// basmanın anlamı yok, başlıktaki sayı (todayMistakeCount) zaten tamamı.
const MISTAKE_PREVIEW_LIMIT = 8;

// Bir günün "çalışıldı" sayılma kuralı, serinin kuralıyla AYNI olmak zorunda:
// alev ikonu ile tik işaretleri aynı şeridin üzerinde duruyor, ayrışırlarsa
// kullanıcı "12 günlük seri" yazarken haftada 5 tik görür.
// StreakService yalnızca gerçek bir cevapta ilerler, "Şimdilik Geç" (empty)
// çalışma sinyali değildir — bu yüzden totalWords DEĞİL, doğru+yanlış bakılır.
const dayStudied = (session) =>
    Boolean(session) && (session.correctCount + session.wrongCount) > 0;

const HomeService = {
    async getSummary(userId) {
        const user = await User.findById(userId).select('timezone name dailyGoal');
        const tz = user?.timezone;

        // Tek bir "şimdi" sabitlenir: her yardımcı kendi new Date()'ini okusaydı
        // gece yarısına denk gelen istekte hafta dünün, todayStr bugünün olur ve
        // şeritte HİÇBİR güne isToday düşmezdi (alev kaybolurdu).
        const now = new Date();
        const today = startOfDayInTz(tz, now);
        const tomorrow = addDays(today, 1);
        const tomorrowEnd = addDays(today, 2);

        // Seri şeridi: içinde bulunulan takvim haftası (Pzt→Paz)
        const weekDates = weekDatesInTz(tz, now);
        const weekStart = startOfDateInTz(tz, weekDates[0]);
        const todayStr = localDateStr(tz, now);

        // "Bugünün Hataları" filtresi: bugün cevaplanmış VE son cevabı yanlış.
        // Başlıktaki sayı ile altındaki çipler aynı kümeden gelmeli, o yüzden
        // filtre tek yerde tanımlanır. Liste ucundakiyle de birebir aynıdır
        // (userword.service.js — ömür boyu wrongCount filtre DEĞİLDİR).
        const mistakeFilter = {
            user: userId,
            lastReviewDate: { $gte: today },
            lastResult: 'wrong'
        };

        const [
            todaySession, streak, progress, reviewCount, tomorrowReviews,
            todayMistakeCount, mistakePreview, todayPools, weekSessions, unreadNotifications
        ] = await Promise.all([
            // Bugünün session'ı
            StudySession.findOne({
                user: userId,
                date: { $gte: today }
            }),

            // Streak
            Streak.findOne({ user: userId }),

            // Tüm seviyelerin ilerlemesi
            Progress.find({ user: userId }),

            // Bekleyen tekrar sayısı
            UserWord.countDocuments({
                user: userId,
                nextReviewDate: { $lte: new Date() },
                status: { $in: ['learning', 'learned'] }
            }),
            UserWord.countDocuments({
                user: userId,
                nextReviewDate: { $gte: tomorrow, $lt: tomorrowEnd }
            }),

            // "Bugünün Hataları — 8 Hata" başlığındaki sayı
            UserWord.countDocuments(mistakeFilter),

            // Aynı kartın altındaki kanji çipleri. Sıralama liste ucuyla aynı
            // (en çok yanlışlanan önce), böylece çipler listenin başıdır.
            UserWord.find(mistakeFilter)
                .populate('word', 'kanji romaji meaning meaningTr jlptLevel')
                .sort({ wrongCount: -1 })
                .limit(MISTAKE_PREVIEW_LIMIT),

            // Çemberin paydası için bugünün havuz(lar)ı
            DailyWordPool.find({ user: userId, date: { $gte: today } }),

            // Seri şeridinin yedi günü. Üst sınır YOK: gelecek tarihli oturum
            // oluşmuyor, koymak DST kenarında bir günü kırpma riski getirirdi.
            StudySession.find({ user: userId, date: { $gte: weekStart } })
                .select('date correctCount wrongCount'),

            // Zil ikonunun rozeti
            Notification.countDocuments({ user: userId, read: false })
        ]);

        // Çemberin paydası = BUGÜNÜN HAVUZU (günün sözleşmesi). dailyGoal canlı
        // tercih değeridir: gün içinde değişince payda anında oynamamalı —
        // havuz genişlerse (hedef artışı) goal zaten onunla birlikte büyür.
        // Birden fazla tur olduysa (aynı gün içinde oturum tamamlanıp yeniden
        // açıldıysa) kapanan turların hedefleri de dahil edilir (bkz. poolGoalTotal).
        const todayPoolSize = todayPools.reduce((sum, p) => sum + poolGoalTotal(p), 0);

        // Oturumlar kendi TAKVİM gününe göre kovalanır: session.date gün
        // başlangıcı değil gerçek oluşturulma anıdır (StudySession.date
        // varsayılanı Date.now), yani sabit ofsetle güne bölünemez.
        const sessionByDay = new Map(
            weekSessions.map(s => [localDateStr(tz, s.date), s])
        );

        // Şeridin her günü ham gerçeklerle döner (çalışıldı mı / bugün mü /
        // gelecek mi); tik–alev–kesikli daire eşlemesi istemcinin işidir.
        // Tek bir `state` metni döndürseydik aynı bilgi iki temsille dolaşır,
        // biri güncellenip diğeri unutulurdu.
        const week = weekDates.map((date, i) => ({
            date,
            weekday: i + 1,         // 1=Pzt … 7=Paz (dizi zaten Pazartesi'den başlar)
            studied: dayStudied(sessionByDay.get(date)),
            isToday: date === todayStr,
            isFuture: date > todayStr
        }));

        return {
            name: user?.name || '',        // "Merhaba Emirhan" başlığı
            greeting: greetingFor(localHourInTz(tz, now)), // ismin üstündeki Japonca satır
            // Kullanıcı avatarı henüz YÜKLENEMİYOR (upload uçları admin'e
            // kapalı, sosyal girişte de fotoğraf saklanmıyor) — alan sözleşmede
            // duruyor ki yükleme geldiğinde istemci başlığı yeniden kurmasın.
            // Bugün her hesapta null; istemci baş harf/placeholder çizmelidir.
            avatarUrl: null,
            unreadNotifications,           // zil ikonunun rozeti
            goal: todayPoolSize || user?.dailyGoal || 20, // ilerleme çemberinin PAYDASI
            dailyGoal: user?.dailyGoal || 20, // ayarlardaki tercih (çember için KULLANMA)
            today: {
                // Çemberin PAYI: ertelenenler sayılmaz (bkz. completedTotal).
                // totalWords "kaç kelimeye dokundun" sorusunun cevabıdır ve
                // yalnızca bilgi olarak duruyor — çemberde KULLANMA.
                completedWords: StudySession.completedTotal(todaySession),
                totalWords: todaySession?.totalWords || 0,
                correctCount: todaySession?.correctCount || 0,
                wrongCount: todaySession?.wrongCount || 0,
                emptyCount: todaySession?.emptyCount || 0,
                isCompleted: todaySession?.isCompleted || false
            },
            streak: {
                current: streak?.currentStreak || 0,
                longest: streak?.longestStreak || 0,
                lastStudyDate: streak?.lastStudyDate || null,
                week                // "🔥 12 Gün" kartının altındaki yedi daire
            },
            todayMistakeCount,
            // Hata kartındaki çipler. Silinmiş bir kelimeye asılı kalan
            // UserWord kayıtları populate sonrası null döner, elenir.
            todayMistakes: mistakePreview
                .filter(uw => uw.word)
                .map(uw => ({
                    id: uw.word._id,
                    kanji: uw.word.kanji,     // çipte yazan yazı
                    romaji: uw.word.romaji,
                    meaning: uw.word.meaning,
                    meaningTr: uw.word.meaningTr,
                    jlptLevel: uw.word.jlptLevel
                })),

            // --- Aşağıdakilerin yeni anasayfa tasarımında karşılığı YOK ---
            // 04.08.2026 revizyonunda "Yarın N Kart Bekliyor" bandı ve seviye
            // ilerleme listesi ekrandan kalktı. Alanlar yalnızca yayındaki
            // uygulamayı kırmamak için duruyor; yeni istemci kodu OKUMAMALI.
            // (Seviye ilerlemesinin asıl yeri zaten /progress uçlarıdır.)
            progress: progress.map(p => ({
                jlptLevel: p.jlptLevel,
                isUnlocked: p.isUnlocked,
                completionRate: p.completionRate
            })),
            pendingReviews: reviewCount,
            tomorrowReviews
        };
    },

    // Takvimden bir güne dokununca açılan detay: o günün sayıları + çalışılan
    // kelimeler (her kelimenin o günkü SON cevabıyla). Kelime listesi
    // answer_submitted event'lerinden geri kurulur.
    async getDayDetail(userId, dateStr) {
        const user = await User.findById(userId).select('timezone dailyGoal');
        const dayStart = startOfDateInTz(user?.timezone, dateStr);
        if (!dayStart) throw new AppError('Geçersiz tarih, YYYY-MM-DD bekleniyor', 400);
        const dayEnd = addDays(dayStart, 1);

        const [session, events, pools] = await Promise.all([
            StudySession.findOne({ user: userId, date: { $gte: dayStart, $lt: dayEnd } }),
            Event.find({
                user: userId,
                type: 'answer_submitted',
                createdAt: { $gte: dayStart, $lt: dayEnd }
            }).sort({ createdAt: 1 }).select('data'),
            DailyWordPool.find({ user: userId, date: { $gte: dayStart, $lt: dayEnd } })
        ]);

        // Kelime başına o günkü son SAYILAN cevap geçerlidir (kronolojik sıra
        // korunur); tekrar çalışma turlarının nötr cevapları (practice) günün
        // sonucunu ezmez
        const resultByWord = new Map();
        for (const e of events) {
            if (e.data?.wordId && !e.data.practice) {
                resultByWord.set(String(e.data.wordId), e.data.result);
            }
        }

        const wordDocs = await Word.find({ _id: { $in: [...resultByWord.keys()] } })
            .select('kanji romaji meaning type jlptLevel');
        const wordById = new Map(wordDocs.map(w => [String(w._id), w]));

        const words = [...resultByWord.entries()]
            .filter(([id]) => wordById.has(id))
            .map(([id, result]) => ({ word: wordById.get(id), result }));

        // Çemberin paydası: o günün havuz büyüklüğü (tarihsel hedef, turlar
        // dahil — bkz. poolGoalTotal); havuz kaydı yoksa güncel dailyGoal'a düşülür
        const poolSize = pools.reduce((sum, p) => sum + poolGoalTotal(p), 0);

        return {
            date: dateStr,
            goal: poolSize || user?.dailyGoal || 20,
            completedWords: StudySession.completedTotal(session), // çemberin PAYI
            totalWords: session?.totalWords || 0,
            correctCount: session?.correctCount || 0,
            wrongCount: session?.wrongCount || 0,
            emptyCount: session?.emptyCount || 0,
            isCompleted: session?.isCompleted || false,
            words
        };
    },

    async getCalendar(userId) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const sessions = await StudySession.find({
            user: userId,
            date: { $gte: thirtyDaysAgo }
        }).select('date totalWords isCompleted');

        return sessions;
    }
};

module.exports = HomeService;