const StudySession = require('../../models/StudySession');
const DailyWordPool = require('../../models/DailyWordPool');
const UserWord = require('../../models/UserWord');
const AppError = require('../../utils/AppError');
const StreakService = require('../streak/streak.service');
const { startOfTodayForUser } = require('../../utils/date.util');
const logEvent = require('../../utils/event.util');

const StudySessionService = {
    // GÜNLÜK TEK OTURUM: gün içinde tekrar giriş aynı kaydı sürdürür,
    // bitirilmiş oturum yeniden açılır. Aynı güne ikinci doküman asla oluşmaz
    // (eskiden complete sonrası start yeni doküman açıyor, home rastgele
    // birini okuyordu). Oturum "günün ilk gerçek cevaplarının" özetidir;
    // tekrar çalışma turları buraya yazılmaz (submitAnswer nötr geçer).
    async startSession(userId, jlptLevel) {
        const today = await startOfTodayForUser(userId);

        const existingSession = await StudySession.findOne({
            user: userId,
            date: { $gte: today }
        });

        if (existingSession) {
            if (existingSession.isCompleted) {
                existingSession.isCompleted = false;
                await existingSession.save();
            }
            return existingSession;
        }

        return StudySession.create({
            user: userId,
            jlptLevel
        });
    },

    // fromEmpty: ertelenmiş ("Şimdilik Geç") kelimenin günün ilk gerçek cevabı —
    // kelime totalWords'e empty olarak zaten sayılmıştı; sayaç devredilir
    // (emptyCount--, sonuç sayacı++), toplam değişmez
    //
    // Session YOKSA artık 404 atmak yerine startSession ile açılır (bul-veya-
    // yeniden-aç aynı mantık). Eskiden burada "session yoksa sessizce geç" diye
    // yutuluyordu (submitAnswer'da try/catch) — istemci /sessions/start'ı geç
    // çağırırsa ya da hiç çağırmazsa o cevaplar UserWord'e yazılıp günün
    // sayaçlarına HİÇ yansımıyordu, geri telafisi de yoktu ("sayılar bazen
    // tutmuyor" bug'ının olası kaynaklarından biri). Artık submitAnswer'ın
    // session sırasına bağımlılığı yok.
    async updateSession(userId, result, { fromEmpty = false, jlptLevel } = {}) {
        await this.startSession(userId, jlptLevel);
        const today = await startOfTodayForUser(userId);

        // $inc ile atomik güncelleme: read-modify-write (findOne + save) iki
        // eşzamanlı cevapta (network retry/double-tap) birinin sayacını kaybediyordu
        // ("sayılar bazen tutmuyor" bug'ının olası bir kaynağı) — $inc bu yarışı önler.
        const inc = {};
        if (fromEmpty) inc.emptyCount = -1;
        else inc.totalWords = 1;
        if (result === 'correct' || result === 'easy') inc.correctCount = 1;
        else if (result === 'wrong') inc.wrongCount = 1;
        else if (result === 'empty') inc.emptyCount = 1;

        const session = await StudySession.findOneAndUpdate(
            { user: userId, date: { $gte: today } },
            { $inc: inc },
            { returnDocument: 'after' }
        );

        // Taban altına inme yalnızca beklenmedik bir sırayla (empty eşleşmeden
        // decrement) olabilir; negatif göstermemek için düzeltilir
        if (session.emptyCount < 0) {
            session.emptyCount = 0;
            await session.save();
        }

        return session;
    },

    async completeSession(userId) {
        const today = await startOfTodayForUser(userId);

        const session = await StudySession.findOne({
            user: userId,
            date: { $gte: today }
        });

        if (!session) throw new AppError('No active session found', 404);

        // ERTELENMİŞ KELİME ARTIK TURU KAPATMAYI ENGELLEMEZ (07.08.2026 ürün
        // kararı). Eskiden 409 dönüyordu ve gerekçesi şuydu: turu kapatmak
        // (roundClosedAt) ertelenen kelimeleri günün havuzundan düşürüyor,
        // kullanıcı cevaplamadığı hâlde "Tebrikler" ekranını görüyordu.
        //
        // O gerekçe artık geçersiz: yeni tur açılırken ertelenenler havuza
        // TAŞINIYOR (bkz. userword.service.js carry-over notu), yani kelime
        // kaybolmuyor, turun başına geçiyor. 409'un tek yaptığı, "Şimdilik
        // Geç"e basan kullanıcıyı dersten çıkamaz hale getirmekti — oysa
        // "Şimdilik Geç" tam olarak "şimdi cevaplamak istemiyorum" demek.
        //
        // Sayı yine de yanıtta döner (pendingWords): bitiş ekranı "3 kelimeyi
        // sonraya bıraktın" diyebilsin. Sayaç yerine UserWord sayılır —
        // emptyCount türetilmiş bir sayaçtır, gerçeği kaydın kendisi söyler.
        const pendingWords = await UserWord.countDocuments({
            user: userId,
            lastReviewDate: { $gte: today },
            lastResult: 'empty'
        });

        // İdempotent: zaten tamamlanmışsa completedAt/duration'ı yeniden
        // hesaplamadan (her tıklamada büyümesin) ve tekrar session_completed
        // event'i loglamadan (analytics'te sahte tekrar kayıt olmasın) aynı
        // özeti döner — istemci "Oturumu Bitir"e birden çok kez basabiliyor.
        if (!session.isCompleted) {
            session.isCompleted = true;
            session.completedAt = new Date();
            session.duration = Math.round(
                (session.completedAt - session.date) / 60000
            );

            await session.save();

            logEvent(userId, 'session_completed', {
                totalWords: session.totalWords,
                correctCount: session.correctCount,
                wrongCount: session.wrongCount,
                duration: session.duration
            });

            // Günün havuz(lar)ını "tur bitti" olarak işaretle — bir sonraki
            // /userwords/today çağrısı taze bir set üretir (bkz. DailyWordPool.
            // roundClosedAt yorumu: StudySession.isCompleted KULLANILMAZ, çünkü
            // /sessions/start onu hemen sıfırlıyor).
            await DailyWordPool.updateMany(
                { user: userId, date: { $gte: today } },
                { $set: { roundClosedAt: new Date() } }
            );
        }

        // Bitiş ekranındaki "Accuracy %" hazır gelsin — istemci hesaplamasın.
        //
        // Payda totalWords DEĞİL completedTotal'dır: totalWords ertelenenleri de
        // sayar, yani "Şimdilik Geç"e basmak doğruluk oranını düşürüyordu.
        // Doğruluk yalnızca gerçekten cevaplanan kelimeler üzerinden ölçülür.
        const answered = StudySession.completedTotal(session);
        const accuracy = answered > 0
            ? Math.round((session.correctCount / answered) * 100)
            : 0;
        return { ...session.toObject(), accuracy, pendingWords };
    },

    async getTodaySession(userId) {
        const today = await startOfTodayForUser(userId);

        const session = await StudySession.findOne({
            user: userId,
            date: { $gte: today }
        });

        return session;
    },

    async getSessionHistory(userId) {
        const sessions = await StudySession.find({ user: userId })
            .sort({ date: -1 })
            .limit(30);

        return sessions;
    }
};

module.exports = StudySessionService;