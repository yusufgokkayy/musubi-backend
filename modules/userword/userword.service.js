const mongoose = require('mongoose');
const UserWord = require('../../models/UserWord');
const Word = require('../../models/Word');
const User = require('../../models/User');
const AppError = require('../../utils/AppError');
const DailyWordPool = require('../../models/DailyWordPool');
const StudySession = require('../../models/StudySession');
const StreakService = require('../streak/streak.service');
const ProgressService = require('../progress/progress.service');
const StudySessionService = require('../studysession/studysession.service');
const NotificationService = require('../notification/notification.service');
const { startOfDayInTz } = require('../../utils/date.util');
const logEvent = require('../../utils/event.util');
const { normalizeAnswer, gradeTyping, wordAnswerVariants } = require('../../utils/answer.util');

const NEW_WORD_DAILY_LIMIT = parseInt(process.env.NEW_WORD_DAILY_LIMIT) || 10;
const REVIEW_DAILY_LIMIT = parseInt(process.env.REVIEW_DAILY_LIMIT) || 10;

// 'easy' StudySession sayaçlarında öteden beri doğru sayılıyordu ama burada
// reddediliyordu; SM-2'nin en yüksek kalitesi olarak eklendi (easeFactor'ü
// 'correct'ten biraz daha hızlı büyütür, aynı-gün kuralına o da tabidir)
const qualityMap = {
    easy: 5,
    correct: 4,
    empty: 2,
    wrong: 1
};

// Günün NİHAİ cevabı bunlardan biridir; 'empty' ("Şimdilik Geç") erteleme
// sayılır — kelime gün içinde yeniden sorulabilir ve ilk gerçek cevabı sayılır
const FINAL_RESULTS = ['correct', 'easy', 'wrong'];

const sm2 = (userWord, quality) => {
    // quality: 0-5 arası (0-2 yanlış, 3-5 doğru)
    let { easeFactor, interval, repetitions } = userWord;

    if (quality >= 3) {
        if (repetitions === 0) interval = 1;
        else if (repetitions === 1) interval = 6;
        else interval = Math.round(interval * easeFactor);

        repetitions += 1;
        easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (easeFactor < 1.3) easeFactor = 1.3;
    } else {
        repetitions = 0;
        interval = 1;
    }

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    return { easeFactor, interval, repetitions, nextReviewDate };
};

// SM-2 durumundan 1-5 arası kelime seviyesi türetir.
// Yanlış cevap repetitions'ı sıfırladığı için seviye otomatik 1'e düşer.
const computeMasteryLevel = ({ repetitions, interval }) => {
    if (repetitions === 0) return 1;   // hiç doğru cevap yok / az önce yanlış
    if (interval >= 21) return 5;      // 'learned' eşiğiyle uyumlu
    if (interval >= 10) return 4;
    if (interval >= 6) return 3;       // 2. başarılı tekrar
    return 2;                          // 1. başarılı tekrar
};

// HAVUZUN ilerlemesi + kuyruğu.
//
// KAPSAM = GÜN. Bir kelime gün içinde yalnızca TEK havuzda bulunabilir (ikinci
// havuz kurulurken birincinin kelimeleri hariç tutulur), bu yüzden "bu havuzda
// dokunuldu mu" ile "bugün dokunuldu mu" aynı sorudur. Eskiden havuzun kendi
// başlangıç anıyla (roundStartedAt) ölçülüyordu; gün kapsamlı "aynı gün ikinci
// empty sayılmaz" kuralıyla ayrıştığı için ertelenen kelime yeni turda
// kuyruğun başında takılı kalıyordu (21.09.2026 bulgusu).
//
// KUYRUK SIRASI: önce bu havuzda hiç dokunulmamışlar (havuz sırasında), SONRA
// ertelenenler (en önce ertelenen en önde). Ertelenen kelimenin aynı ders
// içinde geri gelmesi şart: ikinci havuz ancak ertelenmiş kelime kalmayınca
// açılıyor, kelime geri gelmezse kullanıcı o kapıyı hiç açamaz.
//
// items: havuz sırasında [{ id (Word id), lastReviewDate, lastResult }]
const buildPoolState = (rawItems, today, poolNo) => {
    const untouched = [];
    const postponed = [];
    const completedIds = [];

    // Silinmiş bir kelimeye asılı kalan kayıt populate sonrası id'siz gelir;
    // kuyruğa null düşürmektense havuzdan sayılmaz (total da onu içermez)
    const items = rawItems.filter(it => it.id);

    for (const it of items) {
        const touched = !!it.lastReviewDate && it.lastReviewDate >= today;
        if (!touched) untouched.push(it.id);
        else if (FINAL_RESULTS.includes(it.lastResult)) completedIds.push(it.id);
        else if (it.lastResult === 'empty') postponed.push({ id: it.id, at: it.lastReviewDate });
        else untouched.push(it.id); // beklenmedik lastResult: kelimeyi kaybetme, sıraya al
    }

    postponed.sort((x, y) => x.at - y.at);
    const postponedIds = postponed.map(x => x.id);

    const completed = completedIds.length;
    const touched = completed + postponedIds.length;

    return {
        queue: [...untouched, ...postponedIds],
        postponedIds,
        completedIds,
        progress: {
            total: items.length,
            completed,
            postponed: postponedIds.length,
            remaining: untouched.length,   // bu havuzda hiç dokunulmamışlar
            // DERS BARININ PAYI: dokunulan kelime sayısı (cevaplanan + ertelenen).
            // Mobil barı bununla çiziyor ve bu DOĞRU: "Şimdilik Geç" de bir
            // ilerlemedir, kelime ele alınmıştır. Eski adı `answered`'dı.
            touched
        },
        // Bitiş ekranı: en az bir kelimeye dokunulmuş olmalı. Dokunulmamış
        // kelime kalması bitirmeyi ENGELLEMEZ — kullanıcı sonra dönüp devam
        // edebilir, havuz kilitlenmez (bkz. studysession.service completeSession).
        canFinish: touched > 0,
        // Ekstra havuz kapısı: yalnızca 1. havuzdan ve yalnızca havuz GERÇEKTEN
        // bitmişse — ne dokunulmamış ne de ertelenmiş kelime kalacak.
        canOpenNextPool: poolNo === 1 && items.length > 0
            && untouched.length === 0 && postponedIds.length === 0
    };
};

// Havuzun durumunu KELİME GÖVDELERİ OLMADAN okur — /userwords/answer ve
// /sessions/current için. decorateTodayWords ile aynı kuralları (buildPoolState)
// paylaşır; iki uç aynı havuz için farklı sayı söyleyemesin diye hesap tek yerde.
const readPoolState = async (userId, pool, today) => {
    const [reviewDocs, newDocs, newStates] = await Promise.all([
        UserWord.find({ _id: { $in: pool.reviewWordIds } }).select('word lastResult lastReviewDate'),
        Word.find({ _id: { $in: pool.newWordIds } }).sort({ frequencyRank: 1 }).select('_id'),
        pool.newWordIds.length > 0
            ? UserWord.find({
                user: userId,
                word: { $in: pool.newWordIds },
                lastReviewDate: { $gte: today }
            }).select('word lastResult lastReviewDate')
            : []
    ]);

    const reviewById = new Map(reviewDocs.map(uw => [String(uw._id), uw]));
    const newStateByWord = new Map(newStates.map(uw => [String(uw.word), uw]));

    const items = [
        // Havuzun sırası korunur (bkz. readPoolWords)
        ...pool.reviewWordIds
            .map(id => reviewById.get(String(id)))
            .filter(Boolean)
            .map(uw => ({ id: uw.word, lastReviewDate: uw.lastReviewDate, lastResult: uw.lastResult })),
        ...newDocs.map(w => {
            const state = newStateByWord.get(String(w._id));
            return { id: w._id, lastReviewDate: state?.lastReviewDate, lastResult: state?.lastResult };
        })
    ];

    return { poolNo: pool.poolNo, ...buildPoolState(items, today, pool.poolNo) };
};

// GÜNÜN durumu — anasayfa çemberi ve bitiş ekranı bunu okur.
//
// goal = GÜNÜN HEDEFİ = 1. HAVUZUN boyutu. İkinci havuz açılsa bile BÜYÜMEZ:
// çember hedef dolunca dolu kalır, hedefin üstündeki iş `extra` olarak ayrı
// döner ("20/20 · +4 ekstra"). Paydayı büyütmek, hedefini bitirip "devam et"
// diyen kullanıcının çemberini %100'den %50'ye düşürüyordu — ödül olması
// gereken şey cezaya dönüyordu.
const readDayShape = async (userId, today, jlptLevel) => {
    const [session, firstPool] = await Promise.all([
        StudySessionService.getTodaySession(userId),
        DailyWordPool.findOne({ user: userId, date: today, jlptLevel, poolNo: 1 })
    ]);

    const goal = DailyWordPool.goalTotal(firstPool);
    const completedWords = StudySession.completedTotal(session);

    return {
        goal,
        today: {
            // Çemberin PAYI — ertelenenler hariç (bkz. StudySession.completedTotal)
            completedWords,
            // Hedefin ÜSTÜNE yapılan iş; çember dolduktan sonrası buraya yazılır
            extra: Math.max(0, completedWords - goal),
            totalWords: session?.totalWords || 0,
            correctCount: session?.correctCount || 0,
            wrongCount: session?.wrongCount || 0,
            emptyCount: session?.emptyCount || 0,
            isCompleted: session?.isCompleted || false
        }
    };
};

// Havuzu "kaldığın yerden devam" bilgisiyle işaretler.
//
// İKİ AYRI SÖZLEŞME döner, karıştırılmamalıdır:
//
//   progress / queue / postponedIds / completedIds  →  AKTİF HAVUZUN durumu.
//        Ders ekranının barı ve kuyruğu YALNIZCA bunu okumalıdır.
//
//   goal / today                                    →  GÜNÜN durumu.
//        Kapsamı StudySession'dır, havuzlar arası birikir.
//        Anasayfa çemberi ve bitiş ekranı bunu okur.
//
// Ayrımın sebebi somut bir hata: ders barı gün sayacını okuduğu için ikinci
// havuzun ilk sorusunda "20/20 · %100 Tamamlandı" yazıyordu.
const decorateTodayWords = async (userId, today, pool, reviewWordsRaw, newWordsRaw, levelStartsTomorrow = false) => {
    // answeredToday = GÜNÜN nihai cevabı verildi (correct/easy/wrong).
    // "Şimdilik Geç" (empty) bilerek false bırakır — kelime hâlâ gerçek cevap
    // bekliyor. todayResult ise "bugün bu kelimeyi boş geçmiştin" rozetinin
    // tek kaynağıdır.
    const reviewWords = reviewWordsRaw.map(uw => {
        const touched = !!uw.lastReviewDate && uw.lastReviewDate >= today;
        return {
            ...uw.toObject(),
            answeredToday: touched && FINAL_RESULTS.includes(uw.lastResult),
            todayResult: touched ? uw.lastResult ?? null : null
        };
    });

    // Yeni kelimelerin bugünkü cevabı (ilk cevapta UserWord oluşur) tek sorguyla
    const answeredNew = newWordsRaw.length > 0
        ? await UserWord.find({
            user: userId,
            word: { $in: newWordsRaw.map(w => w._id) },
            lastReviewDate: { $gte: today }
        }).select('word lastResult lastReviewDate')
        : [];
    const newStateByWord = new Map(answeredNew.map(uw => [String(uw.word), uw]));

    const newWords = newWordsRaw.map(w => {
        // $sample'dan gelen düz objeler hydrate ile doc'a çevrilir ki
        // isKana virtual'ı burada da hesaplansın
        const obj = typeof w.toObject === 'function' ? w.toObject() : Word.hydrate(w).toObject();
        const state = newStateByWord.get(String(w._id));
        const todayResult = state ? state.lastResult ?? null : null;
        return {
            ...obj,
            answeredToday: FINAL_RESULTS.includes(todayResult),
            todayResult
        };
    });

    // Kuyruk sırası SUNUCU sırasıdır: önce tekrarlar (vadesi en eski + en
    // kırılgan önce), sonra yeni kelimeler (frequencyRank), en sonda bu havuzda
    // ertelenenler. İstemci kendi sırasını tutmaz — uygulama silinip kurulsa
    // bile ders aynı yerden devam eder.
    const poolState = buildPoolState([
        ...reviewWordsRaw.map(uw => ({
            id: uw.word?._id ?? uw.word,
            lastReviewDate: uw.lastReviewDate,
            lastResult: uw.lastResult
        })),
        ...newWordsRaw.map(w => {
            const state = newStateByWord.get(String(w._id));
            return {
                id: w._id,
                lastReviewDate: state?.lastReviewDate,
                lastResult: state?.lastResult
            };
        })
    ], today, pool.poolNo);

    const dayShape = await readDayShape(userId, today, pool.jlptLevel);

    return {
        poolNo: pool.poolNo,
        startedAt: pool.startedAt,
        // Dersin seviyesi. activeLevel'dan FARKLI olabilir: kullanıcı bugün
        // derse başladıktan sonra seviye değiştirdiyse bugün eski seviyede
        // devam eder, yenisi yarın başlar (levelStartsTomorrow: true).
        jlptLevel: pool.jlptLevel,
        levelStartsTomorrow,
        reviewWords,
        newWords,
        ...poolState,   // queue, postponedIds, completedIds, progress, canFinish, canOpenNextPool
        ...dayShape     // goal, today
    };
};

// Havuzdaki kelimeleri HAVUZUN SIRASIYLA okur.
//
// $in dizinin sırasını KORUMAZ. Sıra istemcinin işiyken bu zararsızdı; kuyruğu
// (queue) artık sunucu belirlediği için sıra sözleşmenin parçası: aynı kullanıcı
// iki çağrıda farklı sıra alsaydı "kaldığın yerden devam" kaldığı yerden devam
// etmezdi. Havuz seçim sırasını zaten saklıyor (vadesi en eski + en kırılgan
// önce), burada yalnızca geri kuruluyor.
const readPoolWords = async (pool) => {
    const [reviewDocs, newDocs] = await Promise.all([
        UserWord.find({ _id: { $in: pool.reviewWordIds } }).populate('word'),
        // newWords müfredat sırasında (frequencyRank, küçük = önce öğretilir);
        // havuza yazılırken de bu sırada yazıldığı için ikisi çakışmaz
        Word.find({ _id: { $in: pool.newWordIds } }).sort({ frequencyRank: 1 })
    ]);

    const byId = new Map(reviewDocs.map(uw => [String(uw._id), uw]));
    const reviewWords = pool.reviewWordIds
        .map(id => byId.get(String(id)))
        .filter(Boolean);   // silinmiş UserWord kaydı havuzu bozmasın

    return { reviewWords, newWords: newDocs };
};

// Havuz için tekrar+yeni kelime seçimi — hem ilk kurulumda hem session bitip
// yeni tur açılırken (excludeReviewIds/excludeWordIds ile önceki havuz hariç
// tutularak) kullanılır. jlptLevel çağıran yerde zaten doğrulanmış/zorunlu.
const selectPoolWords = async (userId, jlptLevel, goal, { excludeReviewIds = [], excludeWordIds = [], reviewRatio = 0.7 } = {}) => {
    // Kontenjan yoksa hiç sorgulama. Mongoose'ta .limit(0) "sınırsız" demektir:
    // goal=0 ile çağrılsaydı (ertelenenler turun tamamını doldurduğunda olur)
    // vadesi gelmiş TÜM kelimeler havuza dolardı.
    if (goal <= 0) return { reviewWordsRaw: [], newWordsRaw: [] };

    // Günün havuzunda tekrarlar kontenjanın %70'ini alır (kalanı yeni kelime).
    // EKSTRA havuzda oran 1'dir: "biraz daha çalışayım" diyen kullanıcıya önce
    // borcunu ödetiriz, yeni kelime ancak vadesi gelmiş tekrar kalmayınca
    // girer. Yoksa aynı gün iki kat yeni kelime ertesi güne iki kat tekrar
    // borcu olarak döner ve kullanıcı birkaç gün sonra yığını görüp bırakır.
    const reviewLimit = Math.ceil(goal * reviewRatio);
    const levelWordIds = await Word.find({ jlptLevel }).distinct('_id');

    // Seviye filtresi populate-match ile YAPILMAZ: eşleşmeyen kayıtlar
    // word:null olarak dönüp limit kontenjanını yer, havuza boş kelime girerdi.
    const reviewWordsRaw = await UserWord.find({
        user: userId,
        _id: { $nin: excludeReviewIds },
        word: { $in: levelWordIds, $nin: excludeWordIds },
        nextReviewDate: { $lte: new Date() },
        status: { $in: ['learning', 'learned'] }
    })
        .populate('word')
        // En eski vade önce; eşitlikte en kırılgan (düşük seviyeli) kelime kazanır
        .sort({ nextReviewDate: 1, masteryLevel: 1 })
        .limit(reviewLimit);

    const learnedWordIds = await UserWord.find({ user: userId }).distinct('word');

    // Yeni kelimeler müfredat sırasında (frequencyRank artan, rastgele DEĞİL):
    // ön koşul kelime (örn. "doktor") sonraki kelimeden (örn. "cerrah") önce gelir.
    const newLimit = Math.max(0, goal - reviewWordsRaw.length);
    const newWordsRaw = newLimit > 0
        ? await Word.find({
            _id: { $nin: [...learnedWordIds, ...excludeWordIds] },
            isCore: true,
            jlptLevel
        }).sort({ frequencyRank: 1 }).limit(newLimit)
        : [];

    return { reviewWordsRaw, newWordsRaw };
};

// DERSİN SEVİYESİ — gün içinde seviye değişiminin kuralı (21.09.2026 kararı).
//
// Kullanıcı Ayarlar'dan seviye değiştirdiğinde `activeLevel` ANINDA değişir
// (seviye listesi, rozetler, "Şimdi Geç" kartı hepsi yeni seviyeyi gösterir).
// Ama BUGÜNÜN DERSİ bugün başlamışsa eski seviyede kalır, yeni seviye YARIN
// başlar; istemci "Bugünkü dersine başladığın için N4 yarın başlayacak" der.
//
// Neden: havuz kimliği {user, gün, seviye, havuz no}. Kural olmasaydı seviye
// değişimi aynı güne İKİNCİ bir havuz açardı — anasayfa çemberinin paydası
// iki havuzu toplayıp 40 gösterirken ders ekranı 20 gösteriyordu (21.09
// bulgusu H2). Havuzun karışık seviyeli olması da istenmiyor.
//
// Bugün hiç cevap verilmemişse beklemeye gerek yok: kurulmuş ama dokunulmamış
// havuz silinir, ders anında yeni seviyeden kurulur.
const resolveLessonLevel = async (userId, today, activeLevel) => {
    const pools = await DailyWordPool.find({ user: userId, date: today });
    const yabanci = pools.filter(p => p.jlptLevel !== activeLevel);
    if (yabanci.length === 0) return { jlptLevel: activeLevel, levelStartsTomorrow: false };

    // Eski seviyenin havuzunda bugün dokunulmuş kelime var mı?
    for (const level of [...new Set(yabanci.map(p => p.jlptLevel))]) {
        const seviyeHavuzlari = yabanci.filter(p => p.jlptLevel === level);
        const wordIds = [
            ...seviyeHavuzlari.flatMap(p => p.newWordIds),
            ...(await UserWord.find({ _id: { $in: seviyeHavuzlari.flatMap(p => p.reviewWordIds) } })
                .distinct('word'))
        ];
        const dokunulan = await UserWord.countDocuments({
            user: userId, word: { $in: wordIds }, lastReviewDate: { $gte: today }
        });
        if (dokunulan > 0) {
            return { jlptLevel: level, levelStartsTomorrow: true };
        }
    }

    // Hiç dokunulmamış: o havuzlar hiç kullanılmadı, silinir (güne tek havuz)
    await DailyWordPool.deleteMany({ _id: { $in: yabanci.map(p => p._id) } });
    return { jlptLevel: activeLevel, levelStartsTomorrow: false };
};

// Hedef gün içinde ARTTIYSA GÜNÜN havuzu (poolNo 1) fark kadar genişler
// ("30 yaptım ama 20'de kaldı"). Azalma bugünü etkilemez: cevaplanmış kelimeler
// havuzdan atılamaz, yeni hedef yarın uygulanır.
//
// KARŞILAŞTIRMA poolSize'A DEĞİL targetGoal'A YAPILIR: havuz kıtlıktan (yeterli
// tekrar/yeni kelime yoktu) hedefin altında kurulmuş olabilir; poolSize'ı hedef
// sanıp her /today çağrısında yeniden doldurmaya çalışmak — dailyGoal hiç
// değişmese bile — paydayı sessizce büyütüp oranı git gide kötüleştiriyordu.
const expandPoolIfGoalRaised = async (userId, pool, jlptLevel, currentGoal) => {
    const poolSize = pool.reviewWordIds.length + pool.newWordIds.length;
    const targetGoal = pool.targetGoal ?? poolSize;  // eski kayıtlarda alan yok
    if (currentGoal <= targetGoal) return;

    let need = currentGoal - poolSize;

    // Önce VADESİ GELMİŞ tekrarlar: "daha çok çalışmak istiyorum" diyen
    // kullanıcıya önce borcu verilir; sabahki %70 kotasına sığmayanlar burada
    // havuza girer
    const levelWordIds = await Word.find({ jlptLevel }).distinct('_id');
    const extraReviews = await UserWord.find({
        user: userId,
        _id: { $nin: pool.reviewWordIds },
        word: { $in: levelWordIds, $nin: pool.newWordIds },
        nextReviewDate: { $lte: new Date() },
        status: { $in: ['learning', 'learned'] }
    }).sort({ nextReviewDate: 1, masteryLevel: 1 }).limit(need);

    if (extraReviews.length > 0) {
        pool.reviewWordIds.push(...extraReviews.map(uw => uw._id));
        need -= extraReviews.length;
    }

    // Kalan kontenjan müfredat sırasındaki (frequencyRank artan) yeni kelimelerle dolar
    if (need > 0) {
        const knownWordIds = await UserWord.find({ user: userId }).distinct('word');
        const extraNew = await Word.find({
            _id: { $nin: [...knownWordIds, ...pool.newWordIds] },
            isCore: true,
            jlptLevel
        }).sort({ frequencyRank: 1 }).limit(need);
        if (extraNew.length > 0) pool.newWordIds.push(...extraNew.map(w => w._id));
    }

    pool.targetGoal = currentGoal;
    if (pool.isModified()) {
        await pool.save();
        logEvent(userId, 'daily_pool_extended', {
            jlptLevel, goal: currentGoal,
            total: pool.reviewWordIds.length + pool.newWordIds.length
        });
    }
};

const UserWordService = {
    resolveLessonLevel,

    async getTodayWords(userId) {
        // Seviye SUNUCUDAN gelir (User.activeLevel), istemciden DEĞİL.
        // Havuzun kimliği {user, gün, seviye, havuz no} olduğu için istemcinin
        // seviye göndermesi, aynı akışta farklı değerler geldiğinde ikinci bir
        // havuz açtırıyordu ("tekrar başlarken üstüne 20lik daha soruyor").
        // Tek yazıcı: ProgressService.setActiveLevel.
        const user = await User.findById(userId).select('dailyGoal timezone activeLevel');
        const today = startOfDayInTz(user?.timezone);
        const goal = user?.dailyGoal || (NEW_WORD_DAILY_LIMIT + REVIEW_DAILY_LIMIT);

        // Dersin seviyesi activeLevel'dır — bugünün dersi başlamadıysa. Başladıysa
        // bugün eski seviyede devam eder, yenisi yarın başlar (bkz. resolveLessonLevel)
        const { jlptLevel, levelStartsTomorrow } =
            await resolveLessonLevel(userId, today, user?.activeLevel || 'N5');

        // AKTİF HAVUZ = bugünün en yüksek numaralı havuzu.
        //
        // BU UÇ ASLA YENİ HAVUZ AÇMAZ (21.09.2026). Eskiden oturum tamamlanınca
        // bir sonraki /today çağrısı kendiliğinden taze bir tur üretiyordu;
        // kullanıcı yalnızca ekrana dönerek üstüne yeni bir 20'lik set alıyordu.
        // İkinci havuz artık yalnızca açık bir istekle açılır:
        // POST /sessions/next-pool.
        const pools = await DailyWordPool.find({ user: userId, date: today, jlptLevel })
            .sort({ poolNo: 1 });
        let pool = pools[pools.length - 1];

        if (pool) {
            // Hedef gün içinde ARTTIYSA günün havuzu fark kadar genişler.
            // Ekstra havuz (2) sabit boyutludur, genişlemez.
            if (pool.poolNo === 1) await expandPoolIfGoalRaised(userId, pool, jlptLevel, goal);
            const { reviewWords, newWords } = await readPoolWords(pool);
            return decorateTodayWords(userId, today, pool, reviewWords, newWords, levelStartsTomorrow);
        }

        // Havuz yok: günün ilk havuzunu kur. Boyutunu kullanıcının günlük hedefi
        // belirler (env limitleri fallback). Hedef azalırsa bugünü etkilemez,
        // yarınki havuz yeni hedefle kurulur.
        const { reviewWordsRaw, newWordsRaw } = await selectPoolWords(userId, jlptLevel, goal);

        // Eşzamanlı iki istek (örn. çift fetch) aynı anda buraya düşerse ikincisi
        // unique index'e çarpar (E11000); hata yansıtmak yerine diğer isteğin
        // oluşturduğu havuz kullanılır.
        try {
            pool = await DailyWordPool.create({
                user: userId,
                date: today,
                jlptLevel,
                poolNo: 1,
                reviewWordIds: reviewWordsRaw.map(uw => uw._id),
                newWordIds: newWordsRaw.map(w => w._id),
                targetGoal: goal,
                startedAt: new Date()
            });
        } catch (err) {
            if (err.code !== 11000) throw err;
            const existing = await DailyWordPool.findOne({ user: userId, date: today, jlptLevel, poolNo: 1 });
            const { reviewWords, newWords } = await readPoolWords(existing);
            return decorateTodayWords(userId, today, existing, reviewWords, newWords, levelStartsTomorrow);
        }

        logEvent(userId, 'daily_pool_created', {
            jlptLevel, poolNo: 1,
            reviewCount: reviewWordsRaw.length,
            newCount: newWordsRaw.length,
            goal
        });

        // "Bugünün Görevi" bildirimi BİLEREK burada üretilmiyor: havuz kullanıcı
        // uygulamayı açtığında kuruluyor, yani kişi zaten içerideyken telefonuna
        // "bugün X kelime seni bekliyor" push'u gidiyordu. Tek üretici artık
        // hatırlatma saatindeki cron.
        return decorateTodayWords(userId, today, pool, reviewWordsRaw, newWordsRaw, levelStartsTomorrow);
    },

    // POST /sessions/next-pool — günün İKİNCİ havuzunu açar.
    //
    // Ürün kuralı (21.09.2026): günde en fazla 2 havuz; ikincisi yalnızca
    // kullanıcı isterse ve ancak birinci havuz GERÇEKTEN bitince açılır —
    // ne dokunulmamış ne de ertelenmiş kelime kalacak. Böylece "Şimdilik Geç"
    // dediği kelimeleri bırakıp yeni kelimelere kaçmak mümkün olmuyor, ayrıca
    // ertelenen kelimeyi bir sonraki tura taşıma mekanizmasına da gerek kalmıyor.
    async openNextPool(userId) {
        const user = await User.findById(userId).select('dailyGoal timezone activeLevel');
        const today = startOfDayInTz(user?.timezone);
        const dailyGoal = user?.dailyGoal || (NEW_WORD_DAILY_LIMIT + REVIEW_DAILY_LIMIT);
        const { jlptLevel } = await resolveLessonLevel(userId, today, user?.activeLevel || 'N5');

        const pools = await DailyWordPool.find({ user: userId, date: today, jlptLevel })
            .sort({ poolNo: 1 });
        const first = pools.find(p => p.poolNo === 1);

        if (!first) {
            throw new AppError('Bugünün dersi henüz açılmadı: önce GET /userwords/today', 400);
        }
        if (pools.some(p => p.poolNo === 2)) {
            throw new AppError('Bugün en fazla 2 havuz açılabilir', 400);
        }

        const state = await readPoolState(userId, first, today);
        if (!state.canOpenNextPool) {
            throw new AppError(
                'Yeni havuz için önce bu havuzu bitir: dokunulmamış ve ertelenmiş kelime kalmamalı',
                400,
                { remaining: state.progress.remaining, postponed: state.progress.postponed }
            );
        }

        // Boyut: günlük hedefin YARISI. "Biraz daha çalışayım" diyen kullanıcının
        // önüne yeni bir 20'lik duvar çıkmasın.
        const size = Math.max(1, Math.ceil(dailyGoal / 2));

        // Birinci havuzun kelimeleri hariç tutulur; içerik önce vadesi gelmiş
        // tekrarlardan kurulur (reviewRatio: 1).
        const firstPoolWordIds = await UserWord.find({ _id: { $in: first.reviewWordIds } }).distinct('word');
        const { reviewWordsRaw, newWordsRaw } = await selectPoolWords(userId, jlptLevel, size, {
            excludeReviewIds: first.reviewWordIds,
            excludeWordIds: [...firstPoolWordIds, ...first.newWordIds],
            reviewRatio: 1
        });

        if (reviewWordsRaw.length + newWordsRaw.length === 0) {
            throw new AppError('Bugünlük çalışılacak kelime kalmadı', 400);
        }

        const pool = await DailyWordPool.create({
            user: userId,
            date: today,
            jlptLevel,
            poolNo: 2,
            reviewWordIds: reviewWordsRaw.map(uw => uw._id),
            newWordIds: newWordsRaw.map(w => w._id),
            targetGoal: size,
            startedAt: new Date()
        });

        // Bitiş ekranından dönülüyor olabilir: oturumu yeniden aç
        await StudySessionService.startSession(userId, jlptLevel);

        logEvent(userId, 'daily_pool_created', {
            jlptLevel, poolNo: 2,
            reviewCount: reviewWordsRaw.length,
            newCount: newWordsRaw.length,
            goal: size
        });

        return decorateTodayWords(userId, today, pool, reviewWordsRaw, newWordsRaw);
    },

    // GET /sessions/current — "kaldığın yerden devam"ın tamamı.
    //
    // TAMAMEN OKUMADIR: havuz açmaz, oturum başlatmaz. Havuz yoksa null döner;
    // istemci normal akışa girer (POST /sessions/start → GET /userwords/today).
    async getCurrentRound(userId) {
        const user = await User.findById(userId).select('timezone activeLevel');
        const today = startOfDayInTz(user?.timezone);
        const { jlptLevel, levelStartsTomorrow } =
            await resolveLessonLevel(userId, today, user?.activeLevel || 'N5');

        // Gün içinde seviye değiştiyse ders bugün ESKİ seviyede devam eder
        const pools = await DailyWordPool.find({ user: userId, date: today, jlptLevel })
            .sort({ poolNo: 1 });
        const pool = pools[pools.length - 1];
        if (!pool) return null;

        const [session, state, dayShape] = await Promise.all([
            StudySessionService.getTodaySession(userId),
            readPoolState(userId, pool, today),
            readDayShape(userId, today, jlptLevel)
        ]);

        return {
            // GÜNÜN oturum kimliği — havuz kimliği DEĞİL. Gün başına tek
            // StudySession var, ikinci havuz açılınca yenisi açılmaz.
            sessionId: session?._id || null,
            jlptLevel,              // DERSİN seviyesi (activeLevel'dan farklı olabilir)
            levelStartsTomorrow,    // true ise yeni seviye yarın başlıyor
            poolNo: pool.poolNo,
            startedAt: pool.startedAt,
            queue: state.queue,
            // queue "KALAN"dır (cevaplanan kelime kuyruktan düşer), yani kaldığın
            // yer her zaman queue[0]'dır. Alan sözleşmede duruyor ki ileride
            // gerçek bir imleç gerekirse istemci yeniden kurmasın.
            currentIndex: 0,
            postponedIds: state.postponedIds,
            completedIds: state.completedIds,
            progress: state.progress,
            canFinish: state.canFinish,
            canOpenNextPool: state.canOpenNextPool,
            ...dayShape
        };
    },

    async submitAnswer(userId, wordId, result, answer) {
        // wordId gerçekten var mı kontrol et
        const wordExists = await Word.findById(wordId);
        if (!wordExists) throw new AppError('Word not found', 404);

        // Yazma sorusunda istemci result yerine yazılan metni (answer) gönderir;
        // puanlama quiz ile aynı mantıkla BURADA yapılır (tek doğruluk kaynağı:
        // "to see / watch" gibi çok varyantlı anlamlarda her varyant kabul edilir)
        //
        // BELİRSİZ GÖVDE REDDEDİLİR. Eskiden `result` yokken `answer` null da
        // gelse puanlama çalışıyor ve sonuç sessizce 'empty' oluyordu — yani
        // "kullanıcı hiçbir şey göndermedi" ile "kullanıcı Şimdilik Geç'e
        // bastı" aynı şeye indirgeniyordu. Mobil tarafın 07.08.2026'da
        // bildirdiği "doğru cevapladım, result: empty döndü" vakasının kaynağı
        // bu: kelimeye ait ikinci bir istek gövdesiz gelip cevabı 'empty'
        // puanlatıyordu. İlk dokunuşta olsaydı emptyCount'u da şişirirdi.
        //
        // BOŞ METİN ('') hâlâ 'empty'dir ve öyle kalmalı: yazma sorusunda
        // kutuyu boş bırakıp göndermek gerçekten "boş geçtim" demektir.
        let correctAnswer;
        if (result == null && answer == null) {
            throw new AppError('result veya answer gönderilmeli', 400);
        }
        if (result == null) {
            const variants = wordAnswerVariants(wordExists);
            correctAnswer = variants[0];
            result = !normalizeAnswer(answer) ? 'empty'
                : gradeTyping(answer, variants) ? 'correct'
                : 'wrong';
        }

        const quality = qualityMap[result];
        if (!quality) throw new AppError('Invalid result, use: correct, easy, empty, wrong', 400);

        // Oturum başlamadan cevap kabul edilmez: istemciyi (UI akışını) atlayıp
        // API'ye doğrudan istek atarak sınırsız/rastgele kelime cevaplama
        // girişimini kapatır. `/sessions/start` her zaman önce çağrılmalı.
        const activeSession = await StudySessionService.getTodaySession(userId);
        if (!activeSession) {
            throw new AppError('Önce oturum başlatılmalı: POST /sessions/start', 400);
        }

        const user = await User.findById(userId).select('timezone activeLevel');
        const today = startOfDayInTz(user?.timezone);
        const { jlptLevel: activeLevel } =
            await resolveLessonLevel(userId, today, user?.activeLevel || 'N5');

        // Cevap yalnızca BUGÜNÜN HAVUZLARINDAKİ kelime için kabul edilir.
        //
        // Eskiden hiçbir havuz kontrolü yoktu: hesabının anahtarını bilen biri
        // uygulamayı hiç kullanmadan, doğrudan API'ye `result: "correct"`
        // göndererek havuz dışındaki yüzlerce kelimeyi "doğru" işaretleyebilir,
        // seviye kilitlerini açabilirdi (21.09.2026 bulgusu). Mobil tarafta
        // havuz dışından cevap gönderen bir ekran yok — "Bugünün Hataları" ve
        // Kütüphane salt okunur — yani bu kısıt gerçek bir akışı kapatmıyor.
        //
        // Günün TÜM havuzları kabul edilir (1 ve 2): kullanıcı ikinci havuzu
        // açtıktan sonra da birincinin kelimelerini "Tekrar Çöz" ile yeniden
        // çalışabilmeli; o cevaplar zaten nötrdür (counted: false).
        const pools = await DailyWordPool.find({ user: userId, date: today, jlptLevel: activeLevel })
            .sort({ poolNo: 1 });
        // Havuz tekrarları UserWord id'si tutar; kıyas Word id'si üzerinden yapılır
        const poolReviewWordIds = new Set(
            (await UserWord.find({ _id: { $in: pools.flatMap(p => p.reviewWordIds) } })
                .distinct('word')).map(String)
        );
        const inPool = pools.some(p =>
            p.newWordIds.some(id => String(id) === String(wordId)) ||
            poolReviewWordIds.has(String(wordId))
        );
        const activePool = pools[pools.length - 1];

        if (!inPool) {
            throw new AppError('Bu kelime bugünün havuzunda değil', 400);
        }

        // İki ayrı sözleşme, bkz. decorateTodayWords:
        //   progress → AKTİF HAVUZUN durumu (ders barı bunu okur)
        //   goal/today → GÜNÜN durumu (anasayfa çemberi bunu okur)
        // Her dönüşte taze okunur (retry sırasında başka bir isteğin
        // güncellediği durumu da doğru yansıtır).
        const dayShape = async () => {
            const [state, day] = await Promise.all([
                activePool ? readPoolState(userId, activePool, today) : null,
                readDayShape(userId, today, activeLevel)
            ]);
            return {
                poolNo: activePool?.poolNo ?? null,
                progress: state ? state.progress
                    : { total: 0, completed: 0, postponed: 0, remaining: 0, touched: 0 },
                canFinish: state ? state.canFinish : false,
                canOpenNextPool: state ? state.canOpenNextPool : false,
                ...day
            };
        };

        // Aynı kelimeye eşzamanlı iki istek (çift tıklama, yavaş bağlantıda
        // otomatik yeniden deneme) ikisi de "bugün henüz cevaplanmadı" okuyup
        // ikisini de SM-2/sayaçlara işleyebiliyordu (gerçek bir örnekte
        // görüldü: aynı kelime 50ms arayla iki kez "correct" say ıldı).
        // UserWord artık optimistic concurrency (__v) ile korunuyor: save()
        // sırasında biri kazanırsa diğeri VersionError alır; burada bu durum
        // yakalanıp taze durum yeniden okunur — ikinci deneme doğal olarak
        // "bugün zaten cevaplandı" (pratik/nötr) dalına düşer, çift saymaz.
        for (let attempt = 0; attempt < 5; attempt++) {
            let userWord;
            try {
                userWord = await UserWord.findOne({ user: userId, word: wordId });
                if (!userWord) userWord = await UserWord.create({ user: userId, word: wordId });
            } catch (err) {
                if (err.code === 11000) continue; // başka istek aynı anda oluşturdu
                throw err;
            }

            // GÜNÜN CEVABI KURALI: bir kelimenin günün nihai cevabı, o gün verilen
            // İLK correct/easy/wrong'tur — SM-2 ve sayaçlar yalnızca onunla işler.
            // Nihai cevaptan SONRAKİ her cevap (tekrar çalışma turu) TAM NÖTRDÜR:
            // seviye ne çıkar ne iner ("pratik yap, sadece riske gir" olmasın diye
            // yanlış da düşürmez — yarınki gerçek tekrar zaten dürüst sinyali verir).
            // "Şimdilik Geç" (empty) ise ERTELEMEDİR: nihai cevap değildir, kelime
            // gün içinde yeniden sorulur ve gelen ilk gerçek cevap sayılır.
            const touchedToday = !!userWord.lastReviewDate && userWord.lastReviewDate >= today;
            const finalToday = touchedToday && FINAL_RESULTS.includes(userWord.lastResult);
            const emptyToday = touchedToday && userWord.lastResult === 'empty';

            // result ile todayResult FARKLI şeylerdir, karıştırılmamalı:
            //
            //   result      → BU GÖNDERİMİN puanı. "Doğru!/Yanlış!" geri
            //                 bildirimi bundan çizilir. Tekrar çalışma turunda
            //                 da dolu gelir ama hiçbir yere yazılmaz.
            //   todayResult → Kelimenin GÜNE KAYITLI sonucu. "Bugün bu kelimeyi
            //                 boş geçmiştin" rozetinin tek kaynağı; /userwords/
            //                 today'deki aynı isimli alanla birebir aynı.
            //
            // Rozeti `result`e bağlamak, tekrar turunda verilen nötr bir cevabın
            // kelimeyi "ertelenmiş" göstermesine yol açıyordu (07.08.2026 raporu).
            const baseResponse = () => ({
                ...userWord.toObject(),
                result,
                todayResult: (!!userWord.lastReviewDate && userWord.lastReviewDate >= today)
                    ? userWord.lastResult ?? null
                    : null,
                ...(correctAnswer !== undefined && { correctAnswer })
            });

            // 1) Tekrar çalışma (nihai cevap zaten var) veya boş geçilenin yeniden
            // boş geçilmesi: sayaçlara ve SM-2'ye hiçbir şey işlenmez.
            //
            // ERTELENMİŞİN YENİDEN ERTELENMESİNDE tek istisna: `lastReviewDate`
            // tazelenir. Kuyruk ertelenenleri erteleme sırasına göre sona
            // dizdiği için bu, kelimeyi sıranın sonuna taşır — kullanıcı aynı
            // kelimeyi arka arkaya görmez. Eskiden hiçbir şey yazılmadığı için
            // kelime sıranın başında takılı kalıyordu (21.09.2026 bulgusu H1).
            if (finalToday || (emptyToday && result === 'empty')) {
                if (emptyToday && result === 'empty') {
                    userWord.lastReviewDate = new Date();
                    await userWord.save();
                }
                logEvent(userId, 'answer_submitted', {
                    wordId, jlptLevel: wordExists.jlptLevel, result, practice: true
                });
                return {
                    ...baseResponse(),
                    levelDropped: false,
                    previousLevel: userWord.masteryLevel || 1,
                    counted: false,
                    ...(await dayShape())
                };
            }

            try {
                // 2) Erteleme ("Şimdilik Geç" — günün ilk dokunuşu): SM-2'ye
                // DOKUNULMAZ (vadesi gelmiş kelimeyi geçmek programını
                // sıfırlamamalı), yalnızca iz bırakılır. Yeni kelime 'learning'e
                // alınır ki yarın tekrar olarak dönsün.
                if (result === 'empty') {
                    if (userWord.status === 'new') userWord.status = 'learning';
                    userWord.lastReviewDate = new Date();
                    userWord.lastResult = 'empty';
                    await userWord.save();

                    await StudySessionService.updateSession(userId, 'empty', { jlptLevel: wordExists.jlptLevel });

                    logEvent(userId, 'answer_submitted', {
                        wordId, jlptLevel: wordExists.jlptLevel, result: 'empty'
                    });
                    return {
                        ...baseResponse(),
                        levelDropped: false,
                        previousLevel: userWord.masteryLevel || 1,
                        counted: true,
                        ...(await dayShape())
                    };
                }

                // 3) Günün nihai cevabı (ilk gerçek cevap — doğrudan ya da
                // ertelenmişin yükseltmesi): SM-2 + sayaçlar + streak burada,
                // günde bir kez işler
                const { easeFactor, interval, repetitions, nextReviewDate } = sm2(userWord, quality);
                userWord.easeFactor = easeFactor;
                userWord.interval = interval;
                userWord.repetitions = repetitions;
                userWord.nextReviewDate = nextReviewDate;
                userWord.lastReviewDate = new Date();
                userWord.lastResult = result;

                const previousLevel = userWord.masteryLevel || 1;
                userWord.masteryLevel = computeMasteryLevel(userWord);
                const levelDropped = userWord.masteryLevel < previousLevel;

                // Hafıza ekranındaki "Bu hafta +N kelime iyiye geçti" çipinin
                // kaynağı: kelimenin "sayılan bölgeye" (seviye kilidini açan
                // eşik) GİRDİĞİ an. 3→4→5 yükselişleri tarihi TAZELEMEZ —
                // kelime bölgeye ilk girdiği hafta sayılır, her doğru cevapta
                // yeniden sayılmaz. Bölgeden düşerse iz silinir ki kelime geri
                // tırmandığında o hafta yeniden sayılabilsin.
                const COUNTED = ProgressService.MASTERY_COUNTED_MIN;
                if (userWord.masteryLevel < COUNTED) {
                    userWord.promotedAt = null;
                } else if (previousLevel < COUNTED) {
                    userWord.promotedAt = new Date();
                }

                if (quality >= 3) {
                    userWord.correctCount += 1;
                    userWord.status = userWord.interval >= 21 ? 'learned' : 'learning';
                } else {
                    userWord.wrongCount += 1;
                    userWord.status = 'learning';
                }

                await userWord.save();

                // levelDropped için BİLEREK bildirim atılmıyor: kullanıcı cevabı
                // verirken zaten uygulamanın içinde ve düşüş bilgisi bu çağrının
                // yanıtında (levelDropped/previousLevel/masteryLevel) dönüyor —
                // istemci anlık geri bildirimi oradan verir. Eskiden her yanlış
                // cevap ayrı bir push üretiyordu; 20 kelimelik bir seansta 8
                // yanlış = 8 push demekti. word_level_down'ın tek üreticisi artık
                // gece çalışan decay özeti (NotificationService.createDecaySummary).

                // İlk gerçek cevapta streak güncelle (kısmi ilerleme bile sayılsın;
                // boş geçmek çalışma sinyali değildir, streak'i 2. adım tetiklemez)
                await StreakService.updateStreak(userId);
                await ProgressService.checkAndUnlockNextLevel(userId, wordExists.jlptLevel);

                // Ertelenmiş kelimenin yükseltmesinde sayaç düzeltilir: empty--, sonuç++
                await StudySessionService.updateSession(userId, result, { fromEmpty: emptyToday, jlptLevel: wordExists.jlptLevel });

                logEvent(userId, 'answer_submitted', {
                    wordId,
                    jlptLevel: wordExists.jlptLevel,
                    result,
                    masteryLevel: userWord.masteryLevel,
                    levelDropped
                });

                return {
                    ...baseResponse(),
                    levelDropped,
                    previousLevel,
                    counted: true,
                    ...(await dayShape())
                };
            } catch (err) {
                if (err.name === 'VersionError') continue; // eşzamanlı yazış kazandı, taze oku
                throw err;
            }
        }

        throw new AppError('Cevap işlenemedi, tekrar deneyin', 500);
    },

    // Günlük cron: uzun süre tekrar edilmeyen kelimelerin GÖRÜNEN seviyesini
    // kademeli düşürür. SM-2 alanlarına (interval/easeFactor/repetitions) asla
    // dokunmaz — kullanıcı dönüp doğru cevap verdiği an seviye, SM-2 durumundan
    // yeniden hesaplanıp anında geri zıplar. Kural: kelime vadesini kendi
    // aralığının 2 katı kadar aşınca 1 seviye, sonraki her aralık katında 1
    // seviye daha düşer (taban 1). İdempotent: hedef seviye SM-2 tabanından
    // hesaplandığı için aynı gün tekrar çalışması ek düşüş yaratmaz.
    async applyMasteryDecay() {
        const DAY = 24 * 60 * 60 * 1000;
        const now = Date.now();

        const cursor = UserWord.find({
            masteryLevel: { $gt: 1 },
            $expr: {
                $gte: [
                    { $subtract: [new Date(now), '$nextReviewDate'] },
                    { $multiply: [{ $max: ['$interval', 1] }, 2 * DAY] }
                ]
            }
        }).cursor();

        const updates = [];
        const perUser = new Map();

        for await (const uw of cursor) {
            const overdueRatio = (now - uw.nextReviewDate.getTime()) / (Math.max(uw.interval, 1) * DAY);
            const drops = Math.max(0, Math.floor(overdueRatio) - 1);
            const baseLevel = computeMasteryLevel(uw);
            const target = Math.max(1, baseLevel - drops);

            if (target < uw.masteryLevel) {
                // Sayılan bölgenin (Orta/İyi/Ezber) altına düşen kelime o
                // bölgeden çıkmıştır: promotedAt izi silinir, yoksa kullanıcı
                // geri kazandığında "bu hafta iyiye geçti" bir daha hiç
                // sayılmazdı (bkz. models/UserWord.js promotedAt notu).
                const set = { masteryLevel: target };
                if (target < ProgressService.MASTERY_COUNTED_MIN) set.promotedAt = null;
                updates.push({
                    updateOne: {
                        filter: { _id: uw._id },
                        update: { $set: set }
                    }
                });
                const key = String(uw.user);
                const entry = perUser.get(key) || { count: 0, samples: [] };
                entry.count += 1;
                // Hedef seviye de taşınır: tek kelime düşmüşse bildirim onu
                // adıyla ve YENİ SEVİYESİYLE söylüyor (bkz. createDecaySummary)
                if (entry.samples.length < 3) entry.samples.push({ word: uw.word, level: target });
                perUser.set(key, entry);
            }
        }

        if (updates.length > 0) await UserWord.bulkWrite(updates);

        for (const [userId, info] of perUser) {
            try {
                await NotificationService.createDecaySummary(userId, info);
            } catch (err) {
                // Bildirim hatası decay akışını bozmasın
            }
        }

        return { affectedWords: updates.length, affectedUsers: perUser.size };
    },

    async getUserStats(userId) {
        const [total, learned, learning, review, levelCounts] = await Promise.all([
            UserWord.countDocuments({ user: userId }),
            UserWord.countDocuments({ user: userId, status: 'learned' }),
            UserWord.countDocuments({ user: userId, status: 'learning' }),
            UserWord.countDocuments({ user: userId, nextReviewDate: { $lte: new Date() } }),
            UserWord.aggregate([
                { $match: { user: new mongoose.Types.ObjectId(userId) } },
                { $group: { _id: { $ifNull: ['$masteryLevel', 1] }, count: { $sum: 1 } } }
            ])
        ]);

        const byMasteryLevel = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        levelCounts.forEach(l => { byMasteryLevel[l._id] = l.count; });

        return { total, learned, learning, review, byMasteryLevel };
    },

    // Seviyeler detayındaki "Kelime Listesi": çalışılmış kelimeler,
    // JLPT seviyesi ve mastery seviyesi (dropdown) filtreleriyle
    async getWordList(userId, { jlptLevel, masteryLevel, page = 1, limit = 20 } = {}) {
        page = Math.max(parseInt(page) || 1, 1);
        limit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);

        const filter = { user: userId };
        if (masteryLevel) {
            const lvl = parseInt(masteryLevel);
            if (!(lvl >= 1 && lvl <= 5)) throw new AppError('masteryLevel 1-5 arası olmalı', 400);
            filter.masteryLevel = lvl;
        }
        if (jlptLevel) {
            filter.word = { $in: await Word.find({ jlptLevel, isCore: true }).distinct('_id') };
        }

        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            UserWord.find(filter)
                .populate('word')
                .sort({ lastReviewDate: -1 })
                .skip(skip)
                .limit(limit),
            UserWord.countDocuments(filter)
        ]);

        return { items, total, page, totalPages: Math.ceil(total / limit) };
    },

    async getTodayMistakes(userId, page = 1, limit = 10) {
        page = Math.max(parseInt(page) || 1, 1);
        limit = Math.min(Math.max(parseInt(limit) || 10, 1), 100);

        const user = await User.findById(userId).select('timezone');
        const today = startOfDayInTz(user?.timezone);

        const skip = (page - 1) * limit;

        // "Bugünün Hataları" = bugün cevaplanmış VE son cevabı yanlış olanlar.
        // wrongCount ömür boyu sayaçtır, filtre olarak KULLANILMAZ: dünkü
        // yanlışlar bugün doğru cevaplansa bile listede görünürdü (20 hata
        // varken 30 gösterme bug'ı). "Şimdilik Geç" (empty) hata sayılmaz.
        const mistakeFilter = {
            user: userId,
            lastReviewDate: { $gte: today },
            lastResult: 'wrong'
        };

        const [mistakes, total] = await Promise.all([
            UserWord.find(mistakeFilter)
                .populate('word')
                .sort({ wrongCount: -1 })
                .skip(skip)
                .limit(limit),

            UserWord.countDocuments(mistakeFilter)
        ]);

        return {
            mistakes,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    },
};

module.exports = UserWordService;