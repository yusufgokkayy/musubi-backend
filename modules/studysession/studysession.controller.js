const catchAsync = require('../../utils/catchAsync');
const StudySessionService = require('./studysession.service');
// Turun durumu (kuyruk/ilerleme) günün havuzundan türer, havuz da
// UserWordService'in sorumluluğunda — burada ikinci bir kopyası olmasın.
const UserWordService = require('../userword/userword.service');

const StudySessionController = {
    startSession: catchAsync(async (req, res) => {
        const { jlptLevel } = req.body;
        const session = await StudySessionService.startSession(req.user.id, jlptLevel);
        res.status(200).json({ success: true, data: session });
    }),

    // Bitiş ekranı: oturum özeti + "yeni havuz açabilir miyim" bayrağı.
    // canOpenNextPool havuzun durumundan türer (UserWordService), oturumdan
    // değil — bitiş ekranındaki "Çalışmaya Devam Et" butonu buna bakar.
    //
    // lesson: ekrandaki üç kutu (Doğruluk · Süre · +Kanji). Oturumun kendi
    // alanları GÜNÜN toplamıdır; bitiş ekranı az önce biten DERSİ (havuzu)
    // anlatır, o yüzden sayılar havuzdan gelir.
    completeSession: catchAsync(async (req, res) => {
        const session = await StudySessionService.completeSession(req.user.id);
        const round = await UserWordService.getCurrentRound(req.user.id);
        res.status(200).json({
            success: true,
            data: {
                ...session,
                canOpenNextPool: round?.canOpenNextPool ?? false,
                lesson: round?.lesson ?? null
            }
        });
    }),

    // Günün ikinci (ve son) havuzunu açar. Yalnızca kullanıcı isteğiyle.
    openNextPool: catchAsync(async (req, res) => {
        const data = await UserWordService.openNextPool(req.user.id);
        res.status(201).json({ success: true, data });
    }),

    // Yan etkisiz: havuz açmaz, tur yenilemez, oturum başlatmaz.
    // Havuz yoksa data:null döner — istemci POST /sessions/start +
    // GET /userwords/today ile normal akışa girer.
    getCurrentRound: catchAsync(async (req, res) => {
        const data = await UserWordService.getCurrentRound(req.user.id);
        res.status(200).json({ success: true, data });
    }),

    getTodaySession: catchAsync(async (req, res) => {
        const session = await StudySessionService.getTodaySession(req.user.id);
        res.status(200).json({ success: true, data: session });
    }),

    getSessionHistory: catchAsync(async (req, res) => {
        const sessions = await StudySessionService.getSessionHistory(req.user.id);
        res.status(200).json({ success: true, data: sessions });
    })
};

module.exports = StudySessionController;