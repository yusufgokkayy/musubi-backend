const StudySession = require('../../models/StudySession');
const Streak = require('../../models/Streak');
const Progress = require('../../models/Progress');
const UserWord = require('../../models/UserWord');
const User = require('../../models/User');
const DailyWordPool = require('../../models/DailyWordPool');
const Notification = require('../../models/Notification');
const ProgressService = require('../progress/progress.service');
const QuizService = require('../quiz/quiz.service');
const {
    startOfDayInTz, startOfDateInTz,
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
        const user = await User.findById(userId)
            .select('timezone name dailyGoal activeLevel placementDeferredAt');
        const tz = user?.timezone;

        // Tek bir "şimdi" sabitlenir: her yardımcı kendi new Date()'ini okusaydı
        // gece yarısına denk gelen istekte hafta dünün, todayStr bugünün olur ve
        // şeritte HİÇBİR güne isToday düşmezdi (alev kaybolurdu).
        const now = new Date();
        const today = startOfDayInTz(tz, now);

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
            todaySession, streak, foundProgress,
            todayMistakeCount, mistakePreview, todayPools, weekSessions, unreadNotifications
        ] = await Promise.all([
            // Bugünün session'ı
            StudySession.findOne({
                user: userId,
                date: { $gte: today }
            }),

            // Streak
            Streak.findOne({ user: userId }),

            // Seviye bandı ve "Şimdi Geç" kartı için (yanıtta DÖNMEZ, bkz. aşağıda)
            Progress.find({ user: userId }),

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

        // Seviye kayıtları eksik olan hesapta "Şimdi Geç" bandı ve progress
        // dizisi sessizce kayboluyordu; seviye listesindeki onarımın aynısı
        const progress = await ProgressService.ensureProgress(userId, foundProgress);

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

        // Başlığın altındaki seviye bandı ve "Kilit Açıldı → Şimdi Geç" kartı.
        // advanceableLevel, aktif seviyenin BİR SONRAKİSİ açıldıysa doludur;
        // kart yalnızca o zaman çizilir. Kilit açılınca activeLevel kendiliğinden
        // taşınmaz — geçiş kullanıcının onayına bağlı, "Şimdi Geç" butonu
        // PUT /progress/active-level çağırır.
        const activeLevel = user?.activeLevel || 'N5';
        const nextLevel = ProgressService.LEVELS[ProgressService.LEVELS.indexOf(activeLevel) + 1];
        const nextUnlocked = nextLevel &&
            progress.some(p => p.jlptLevel === nextLevel && p.isUnlocked);

        // "Seviyeni Öğrenelim Mi?" modalı. Ayrı bir /quiz/status isteği
        // gerekmesin diye burada: modal anasayfa açılışında çıkıyor.
        // İkisi FARKLI sorulardır ve ikisi de lazım:
        //   placementPrompt   → "modal kendiliğinden açılsın mı" (hiç girmemiş
        //                       ve ertelememiş kullanıcı)
        //   placementAvailable→ "sınava şu an girilebilir mi" (14 günlük
        //                       cooldown). Ayarlardaki satır koşulsuz görünür,
        //                       Başla butonu buna bakar.
        // İkincisi eskiden yalnız /quiz/status'ta vardı; anasayfa modalı için
        // istemci ikinci bir istek atmak zorunda kalıyordu.
        const [placementPrompt, placement] = await Promise.all([
            QuizService.shouldPromptPlacement(userId, user),
            QuizService.placementAvailability(userId)
        ]);

        return {
            name: user?.name || '',        // "Merhaba Emirhan" başlığı
            greeting: greetingFor(localHourInTz(tz, now)), // ismin üstündeki Japonca satır
            activeLevel,
            activeLevelLabel: ProgressService.LEVEL_LABELS[activeLevel], // "N4 • Temel" bandı
            advanceableLevel: nextUnlocked
                ? { jlptLevel: nextLevel, label: ProgressService.LEVEL_LABELS[nextLevel] }
                : null,
            // true ise "Seviyeni Öğrenelim Mi?" modalı açılır. "Daha Sonra"
            // POST /quiz/placement/defer çağırır ve bayrak kalıcı olarak söner.
            placementPrompt,
            placementAvailable: placement.available,
            // available:false ise geri sayımın bitiş anı; true ise null
            nextAttemptAllowedAt: placement.available ? null : placement.nextAllowedAt,
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

            // KALDIRILDI: progress / pendingReviews / tomorrowReviews.
            // 04.08.2026 revizyonunda "Yarın N Kart Bekliyor" bandı ve seviye
            // ilerleme listesi ekrandan kalkmıştı; alanlar yayındaki uygulamayı
            // kırmamak için duruyordu. Mobil taraf 07.08.2026'da hiçbirinin
            // okunmadığını yazılı olarak teyit etti, arkalarındaki iki
            // countDocuments sorgusuyla birlikte silindiler. Seviye
            // ilerlemesinin asıl yeri /progress uçlarıdır.
        };
    }
};

module.exports = HomeService;