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

// TURUN ilerlemesi + kuyruğu. Gün sayaçlarından (goal/today) BİLEREK ayrıdır,
// bkz. aşağıdaki "iki ayrı sözleşme" notu.
//
// items: kuyruk sırasında [{ id (Word id), lastReviewDate, lastResult }]
const buildRoundState = (rawItems, roundStart) => {
    const queue = [];
    const postponedIds = [];
    const completedIds = [];

    // Silinmiş bir kelimeye asılı kalan kayıt populate sonrası id'siz gelir;
    // kuyruğa null düşürmektense havuzdan sayılmaz (total da onu içermez)
    const items = rawItems.filter(it => it.id);

    for (const it of items) {
        const touched = !!it.lastReviewDate && it.lastReviewDate >= roundStart;
        if (!touched) queue.push(it.id);
        else if (FINAL_RESULTS.includes(it.lastResult)) completedIds.push(it.id);
        else if (it.lastResult === 'empty') postponedIds.push(it.id);
        else queue.push(it.id); // beklenmedik lastResult: kelimeyi kaybetme, sıraya al
    }

    return {
        queue,
        postponedIds,
        completedIds,
        progress: {
            total: items.length,
            completed: completedIds.length,
            postponed: postponedIds.length,
            remaining: queue.length,
            // DERS BARININ PAYI: dokunulan kelime sayısı (cevaplanan + ertelenen).
            // Mobil barı bununla çiziyor ve bu DOĞRU: "Şimdilik Geç" de bir
            // ilerlemedir, kelime o turda ele alınmıştır. Bar dolduğunda
            // (touched === total) bitiş ekranı açılabilir.
            // Eski adı `answered`'dı; ismi ne saydığını söylemediği için değişti.
            touched: completedIds.length + postponedIds.length
        }
    };
};

// Turun durumunu KELİME GÖVDELERİ OLMADAN okur — /userwords/answer ve
// /sessions/current için. decorateTodayWords ile aynı kuralları (buildRoundState)
// paylaşır; iki uç aynı tur için farklı sayı söyleyemesin diye hesap tek yerde.
const readRoundState = async (userId, pool, today) => {
    const roundStart = pool.roundStartedAt || today;

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

    return { ...buildRoundState(items, roundStart), roundStartedAt: roundStart };
};

// Günün havuzunu "kaldığın yerden devam" bilgisiyle işaretler.
//
// İKİ AYRI SÖZLEŞME döner, karıştırılmamalıdır:
//
//   progress / queue / postponedIds / completedIds  →  TURUN durumu.
//        Kapsamı pool.roundStartedAt'tir, her turda sıfırlanır.
//        Ders ekranının barı ve kuyruğu YALNIZCA bunu okumalıdır.
//
//   goal / today                                    →  GÜNÜN durumu.
//        Kapsamı StudySession'dır, turlar arası hiç sıfırlanmaz.
//        Anasayfa çemberi ve bitiş ekranı bunu okur.
//
// Ayrımın sebebi somut bir hata: 20 kelimelik turu bitirip yeni tur açan
// kullanıcıda today.completedWords 20'de kalıyor (doğru — gün sayacı), ama
// ders barı da onu okuduğu için TAZE turun ilk sorusunda "20/20 · %100
// Tamamlandı" yazıyordu. Bar turun payını (progress.completed) okumalı.
const decorateTodayWords = async (userId, today, reviewWordsRaw, newWordsRaw, roundStart) => {
    // roundStart yoksa (eski havuz kaydı) gün başlangıcına düşülür: bu alan
    // gelmeden önceki davranışın birebir aynısı.
    roundStart = roundStart || today;

    // answeredToday = GÜNÜN nihai cevabı verildi (correct/easy/wrong). Gün
    // kapsamlıdır ve öyle kalmalı: "günün cevabı kuralı" (bkz. submitAnswer)
    // gün kapsamlıdır, bir kelime o gün ikinci kez SM-2'ye işlemez.
    // "Şimdilik Geç" (empty) bilerek false bırakır — kelime hâlâ gerçek cevap
    // bekliyor. todayResult de gün kapsamlıdır: "bugün bu kelimeyi boş
    // geçmiştin" rozeti tur değişince kaybolmamalı.
    //
    // (touchedToday alanı 21.09.2026'da kaldırıldı: kimse okumuyordu, tur
    // kapsamlı karşılığı zaten progress.touched.)
    const reviewWords = reviewWordsRaw.map(uw => {
        const touched = !!uw.lastReviewDate && uw.lastReviewDate >= today;
        return {
            ...uw.toObject(),
            answeredToday: touched && FINAL_RESULTS.includes(uw.lastResult),
            todayResult: touched ? uw.lastResult ?? null : null
        };
    });

    // Yeni kelimelerin bugünkü cevabı (ilk cevapta UserWord oluşur) tek sorguyla.
    // lastReviewDate de çekilir: tur kapsamlı sayaçlar (buildRoundState) onu
    // gün başlangıcıyla değil roundStart ile karşılaştırır.
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

    // Kuyruk sırası SUNUCU sırasıdır: önce tekrarlar (havuzdaki seçim sırası =
    // vadesi en eski + en kırılgan önce), sonra yeni kelimeler (frequencyRank).
    // İstemci kendi sırasını tutmaz — uygulama silinip kurulsa bile ders aynı
    // yerden devam eder.
    const round = buildRoundState([
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
    ], roundStart);

    const session = await StudySessionService.getTodaySession(userId);

    return {
        reviewWords,
        newWords,
        ...round,                    // queue, postponedIds, completedIds, progress
        roundStartedAt: roundStart,
        // goal = bu turun gerçek boyutu (progress.total ile aynı). Yeni tur
        // açılınca SABİT kalır, büyümez — kullanıcı hedefini aşarsa
        // today.totalWords bunu geçebilir (istenen davranış).
        goal: round.progress.total,
        today: {
            // Anasayfa çemberinin PAYI — ertelenenler hariç (bkz.
            // StudySession.completedTotal). Ders barı için DEĞİL: bar turun
            // payını (progress.completed) okur.
            completedWords: StudySession.completedTotal(session),
            totalWords: session?.totalWords || 0,
            correctCount: session?.correctCount || 0,
            wrongCount: session?.wrongCount || 0,
            emptyCount: session?.emptyCount || 0,
            isCompleted: session?.isCompleted || false
        }
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
const selectPoolWords = async (userId, jlptLevel, goal, { excludeReviewIds = [], excludeWordIds = [] } = {}) => {
    // Kontenjan yoksa hiç sorgulama. Mongoose'ta .limit(0) "sınırsız" demektir:
    // goal=0 ile çağrılsaydı (ertelenenler turun tamamını doldurduğunda olur)
    // vadesi gelmiş TÜM kelimeler havuza dolardı.
    if (goal <= 0) return { reviewWordsRaw: [], newWordsRaw: [] };

    const reviewLimit = Math.ceil(goal * 0.7);
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

const UserWordService = {
    async getTodayWords(userId) {
        // Seviye SUNUCUDAN gelir (User.activeLevel), istemciden DEĞİL.
        //
        // Eskiden zorunlu bir jlptLevel parametresiydi ve sebebi şuydu:
        // DailyWordPool'un unique anahtarı {user,date,jlptLevel} olduğu için
        // (bkz. models/DailyWordPool.js) aynı ekran akışında bazen parametreli
        // bazen parametresiz çağıran bir istemci, backend'e İKİ ayrı havuz
        // açtırıyordu — "tekrar başlarken üstüne 20lik daha soruyor" ve home'daki
        // goal'ün havuzları toplarken şişmesi bug'larının kökü buydu. O gün
        // sunucuda güvenilir bir "kullanıcının o anki seviyesi" kaydı olmadığı
        // için varsayılana düşmek yerine hata fırlatmak tercih edilmişti.
        //
        // activeLevel artık o kaydı sağlıyor: tek kullanıcı için tek seviye, tek
        // havuz. Aynı sınıf bug'ın geri dönmemesi bu alanın TEK yazıcısına bağlı
        // (ProgressService.setActiveLevel).
        const user = await User.findById(userId).select('dailyGoal timezone activeLevel');
        const jlptLevel = user?.activeLevel || 'N5';
        const today = startOfDayInTz(user?.timezone);
        const goal = user?.dailyGoal || (NEW_WORD_DAILY_LIMIT + REVIEW_DAILY_LIMIT);

        // Bugün için havuz var mı kontrol et
        let pool = await DailyWordPool.findOne({
            user: userId,
            date: today,
            jlptLevel
        });

        if (pool) {
            // YENİ TUR: havuz `roundClosedAt` ile işaretli (session tamamlanınca
            // studysession.service.js set eder) — aynı kelimeler tekrar gelmesin
            // diye önceki havuzdaki (review'lerin ARKASINDAKİ Word'ler + newWords)
            // hariç tutularak aynı doküman (user,date,jlptLevel) üzerine taze bir
            // set yazılır, oturum yeni tur için yeniden açılır.
            //
            // NOT: StudySession.isCompleted KULLANILMAZ — /sessions/start her
            // çağrıldığında onu hemen false'a sıfırlıyor (bul-veya-yeniden-aç).
            // İstemci doğal olarak "başlat, sonra kelimeleri getir" sırasıyla
            // çağırırsa (ki en olası akış budur), isCompleted bu satıra hiç
            // ulaşmadan silinmiş olurdu — roundClosedAt bu çağrı sırasından
            // tamamen bağımsız, sadece bu fonksiyon temizler.
            if (pool.roundClosedAt) {
                // ERTELENENLER YENİ TURA TAŞINIR (07.08.2026 ürün kararı).
                // /sessions/complete artık ertelenmiş kelime varken de turu
                // kapatıyor; taşıma olmasaydı o kelimeler HARİÇ TUTULANLAR
                // listesine düşer ve gün bitene kadar bir daha hiç sorulmazdı —
                // "Şimdilik Geç" sessiz bir silme tuşuna dönüşürdü.
                //
                // Kontenjandan sayılırlar (taşınan + taze = goal): üstüne
                // eklenselerdi tur boyutu her kapanışta büyür, ders barının
                // paydası "23/20" gibi oynardı.
                const levelWordIds = await Word.find({ jlptLevel }).distinct('_id');
                const carried = await UserWord.find({
                    user: userId,
                    word: { $in: levelWordIds },
                    lastReviewDate: { $gte: today },
                    lastResult: 'empty'
                })
                    .sort({ lastReviewDate: 1 })   // en önce ertelenen en önce sorulur
                    .limit(goal);

                const carriedWordIds = carried.map(uw => uw.word);
                const excludeWordIds = [
                    ...(await UserWord.find({ _id: { $in: pool.reviewWordIds } }).distinct('word')),
                    ...pool.newWordIds,
                    ...carriedWordIds        // taşınanlar taze seçimde ikinci kez çıkmasın
                ];
                const { reviewWordsRaw, newWordsRaw } = await selectPoolWords(
                    userId, jlptLevel, Math.max(0, goal - carried.length), {
                        excludeReviewIds: [...pool.reviewWordIds, ...carried.map(uw => uw._id)],
                        excludeWordIds
                    }
                );

                // Ürün kararı: yeni tur açılınca payda (günün hedefi) SABİT
                // kalır, büyümez — kullanıcı hedefini aşarsa pay (StudySession.
                // totalWords, turlar arası hiç sıfırlanmaz) paydayı geçebilir
                // ("23/20" gibi). Bkz. home.service.js'deki poolGoalTotal.
                //
                // Taşınanlar turun BAŞINA konur: kullanıcının bilerek "sonra"
                // dediği kelimeler yeni turda gerçekten önce gelsin.
                pool.reviewWordIds = [...carried.map(uw => uw._id), ...reviewWordsRaw.map(uw => uw._id)];
                pool.newWordIds = newWordsRaw.map(w => w._id);
                pool.roundClosedAt = null;
                pool.roundStartedAt = new Date();
                pool.targetGoal = goal;
                await pool.save();
                await StudySessionService.startSession(userId, jlptLevel);

                logEvent(userId, 'daily_pool_created', {
                    jlptLevel, reviewCount: reviewWordsRaw.length, newCount: newWordsRaw.length,
                    carriedCount: carried.length, goal, newRound: true
                });

                const { reviewWords, newWords } = await readPoolWords(pool);
                return decorateTodayWords(userId, today, reviewWords, newWords, pool.roundStartedAt);
            }

            // Hedef gün içinde ARTTIYSA havuz fark kadar yeni kelimeyle genişler
            // ("30 yaptım ama 20'de kaldı" bug'ı). Azalma bugünü etkilemez:
            // cevaplanmış kelimeler havuzdan atılamaz, yeni hedef yarın uygulanır.
            //
            // KARŞILAŞTIRMA poolSize'A DEĞİL targetGoal'A YAPILIR: havuz kıtlıktan
            // (yeterli tekrar/yeni kelime yoktu) hedefin altında kurulmuş olabilir;
            // poolSize'ı hedef sanıp her /today çağrısında yeniden doldurmaya
            // çalışmak — dailyGoal hiç değişmese bile — payda'yı (total) sessizce
            // büyütüp cevaplanan/toplam oranını git gide kötüleştiriyordu
            // ("20'de 12 yaptım, girip çıkınca oran düşüyordu" bug'ının kökü).
            const currentGoal = goal;
            const poolSize = pool.reviewWordIds.length + pool.newWordIds.length;
            const targetGoal = pool.targetGoal ?? poolSize; // eski kayıtlarda alan yok — geriye dönük olarak mevcut boyut hedef sayılır
            if (currentGoal > targetGoal) {
                let need = currentGoal - poolSize;

                // Önce VADESİ GELMİŞ tekrarlar: "daha çok çalışmak istiyorum"
                // diyen kullanıcıya önce borcu (due review) verilir; sabahki %70
                // kotasına sığmayanlar burada havuza girer
                const extraReviewFilter = {
                    user: userId,
                    _id: { $nin: pool.reviewWordIds },
                    word: { $nin: pool.newWordIds }, // bugün ertelenen kelime çift girmesin
                    nextReviewDate: { $lte: new Date() },
                    status: { $in: ['learning', 'learned'] }
                };
                if (jlptLevel) {
                    extraReviewFilter.word.$in = await Word.find({ jlptLevel }).distinct('_id');
                }
                const extraReviews = await UserWord.find(extraReviewFilter)
                    .sort({ nextReviewDate: 1, masteryLevel: 1 })
                    .limit(need);
                if (extraReviews.length > 0) {
                    pool.reviewWordIds.push(...extraReviews.map(uw => uw._id));
                    need -= extraReviews.length;
                }

                // Kalan kontenjan müfredat sırasındaki (frequencyRank artan) bir
                // sonraki yeni kelimelerle dolar — bkz. aşağıdaki asıl seçim notu
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
            }

            // Havuz sabit listeyi ve SABİT SIRAYI döndürür (bkz. readPoolWords)
            const { reviewWords, newWords } = await readPoolWords(pool);
            return decorateTodayWords(userId, today, reviewWords, newWords, pool.roundStartedAt || today);
        }

        // Havuz yok, yeni oluştur.
        // Havuz boyutunu kullanıcının günlük hedefi belirler (env limitleri fallback).
        // dailyGoal gün içinde ARTARSA havuz yukarıdaki blokta genişletilir;
        // azalırsa bugünü etkilemez, yarınki havuz yeni hedefle kurulur.
        const { reviewWordsRaw, newWordsRaw } = await selectPoolWords(userId, jlptLevel, goal);

        // Havuzu kaydet. Eşzamanlı iki istek (örn. çift fetch) aynı anda buraya
        // düşerse ikincisi unique index'e (user,date,jlptLevel) çarpar (E11000);
        // hata olarak yansıtmak yerine diğer isteğin oluşturduğu havuz kullanılır.
        try {
            await DailyWordPool.create({
                user: userId,
                date: today,
                jlptLevel,
                reviewWordIds: reviewWordsRaw.map(uw => uw._id),
                newWordIds: newWordsRaw.map(w => w._id),
                targetGoal: goal,
                // Günün İLK turu bilerek gün başlangıcından başlatılır: tur
                // kapsamı ile gün kapsamı ilk turda birebir örtüşsün, bu alan
                // gelmeden önceki sayılar aynen çıksın. Sonraki turlar gerçek
                // zaman damgası alır.
                roundStartedAt: today
            });
        } catch (err) {
            if (err.code !== 11000) throw err;
            const existingPool = await DailyWordPool.findOne({ user: userId, date: today, jlptLevel });
            const { reviewWords, newWords } = await readPoolWords(existingPool);
            return decorateTodayWords(userId, today, reviewWords, newWords, existingPool.roundStartedAt || today);
        }

        logEvent(userId, 'daily_pool_created', {
            jlptLevel,
            reviewCount: reviewWordsRaw.length,
            newCount: newWordsRaw.length,
            goal
        });

        // "Bugünün Görevi" bildirimi BİLEREK burada üretilmiyor: havuz, kullanıcı
        // uygulamayı açtığında kuruluyor — yani kişi zaten içerideyken telefonuna
        // "bugün X kelime seni bekliyor" push'u gidiyordu. Üstelik cron'daki
        // üreticiyle birlikte aynı gün iki kart oluşabiliyordu. Tek üretici artık
        // hatırlatma saatindeki cron (notification.service.js) ve o da yalnızca
        // gerçekten iş kaldıysa gönderiyor.
        return decorateTodayWords(userId, today, reviewWordsRaw, newWordsRaw, today);
    },

    // GET /sessions/current — "kaldığın yerden devam"ın tamamı.
    //
    // TAMAMEN OKUMADIR: havuz açmaz, tur yenilemez, oturum başlatmaz. Bu iş
    // getTodayWords'ün (yan etkili) işi ve iki yerde iki kopya olsaydı
    // ayrışırlardı. Havuz yoksa null döner; istemci normal akışa girer
    // (POST /sessions/start → GET /userwords/today).
    //
    // Kuyruğun sırasını SUNUCU belirler ve deterministiktir (tekrarlar havuz
    // sırasında, yeni kelimeler frequencyRank'te), yani uygulama silinip
    // kurulsa bile ders aynı yerden devam eder — istemcinin hiçbir şey
    // hatırlaması gerekmez.
    async getCurrentRound(userId) {
        const user = await User.findById(userId).select('timezone activeLevel');
        const today = startOfDayInTz(user?.timezone);
        const jlptLevel = user?.activeLevel || 'N5';

        // Gün içinde seviye değiştiyse bugüne ait iki havuz olabilir (anahtar
        // {user, gün, jlptLevel}); ders her zaman activeLevel'ın havuzudur.
        const pool = await DailyWordPool.findOne({ user: userId, date: today, jlptLevel });
        if (!pool || pool.roundClosedAt) return null;

        const [session, round] = await Promise.all([
            StudySessionService.getTodaySession(userId),
            readRoundState(userId, pool, today)
        ]);

        return {
            // GÜNÜN oturum kimliği — tur kimliği DEĞİL. Gün başına tek
            // StudySession var, tur kapanınca yenisi açılmaz (aynı kayıt
            // yeniden açılır). Tur değişimi roundStartedAt'ten anlaşılır.
            sessionId: session?._id || null,
            jlptLevel,
            roundStartedAt: round.roundStartedAt,
            queue: round.queue,
            // queue "KALAN"dır (cevaplanan kelime kuyruktan düşer), yani kaldığın
            // yer her zaman queue[0]'dır. Alan sözleşmede duruyor ki ileride
            // gerçek bir imleç gerekirse istemci yeniden kurmasın.
            currentIndex: 0,
            postponedIds: round.postponedIds,
            completedIds: round.completedIds,
            progress: round.progress
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
        const activeLevel = user?.activeLevel || 'N5';

        // goal/today: Anasayfa ile AYNI kaynak+şekil (bkz. decorateTodayWords).
        // İstemci her cevaptan sonra kendi yerel toplamını artırmak yerine
        // buradaki taze sayılara güvenmeli — iki ekranın ayrı kaynaktan
        // beslenip tutarsız görünmesi (defalarca yakalanan bug sınıfı) böylece
        // yapısal olarak imkânsız olur. Her dönüşte taze okunur (retry
        // sırasında başka bir isteğin güncellediği durumu da doğru yansıtır).
        //
        // Havuz kullanıcının DERS seviyesinden (activeLevel) okunur. Eskiden
        // cevaplanan kelimenin jlptLevel'ıyla aranıyordu: kullanıcı dersi dışı
        // bir kelimeye cevap verdiğinde (örn. hata listesinden) havuz
        // bulunamıyor ve `goal: 0` dönüyordu — ders barının paydası bir anda
        // sıfırlanıyordu.
        const pool = await DailyWordPool.findOne({ user: userId, date: today, jlptLevel: activeLevel });

        // İki ayrı sözleşme, bkz. decorateTodayWords:
        //   progress → TURUN durumu (ders barı bunu okur)
        //   goal/today → GÜNÜN durumu (anasayfa çemberi bunu okur)
        // Her dönüşte taze okunur (retry sırasında başka bir isteğin
        // güncellediği durumu da doğru yansıtır).
        const dayShape = async () => {
            const [s, round] = await Promise.all([
                StudySessionService.getTodaySession(userId),
                pool ? readRoundState(userId, pool, today) : null
            ]);
            return {
                goal: round ? round.progress.total : 0,
                progress: round ? round.progress : { total: 0, completed: 0, postponed: 0, remaining: 0, touched: 0 },
                today: {
                    completedWords: StudySession.completedTotal(s), // anasayfa çemberinin PAYI
                    totalWords: s?.totalWords || 0,
                    correctCount: s?.correctCount || 0,
                    wrongCount: s?.wrongCount || 0,
                    emptyCount: s?.emptyCount || 0,
                    isCompleted: s?.isCompleted || false
                }
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
            // boş geçilmesi: hiçbir şey kaydedilmez, yanıt yalnızca puanlama taşır
            if (finalToday || (emptyToday && result === 'empty')) {
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