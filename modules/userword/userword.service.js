const mongoose = require('mongoose');
const UserWord = require('../../models/UserWord');
const Word = require('../../models/Word');
const User = require('../../models/User');
const AppError = require('../../utils/AppError');
const DailyWordPool = require('../../models/DailyWordPool');
const StreakService = require('../streak/streak.service');
const ProgressService = require('../progress/progress.service');
const StudySessionService = require('../studysession/studysession.service');
const NotificationService = require('../notification/notification.service');
const { startOfDayInTz } = require('../../utils/date.util');
const logEvent = require('../../utils/event.util');
const { normalizeAnswer, meaningVariants, gradeTyping } = require('../../utils/answer.util');

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

// Günün havuzunu "kaldığın yerden devam" bilgisiyle işaretler: ders yarıda
// kalıp yeniden açıldığında istemci answeredToday=false olanlardan sürdürür,
// progress sayaçlarıyla da çemberi çizer. Yanıt geriye uyumludur (alan ekler).
const decorateTodayWords = async (userId, today, reviewWordsRaw, newWordsRaw) => {
    const reviewWords = reviewWordsRaw.map(uw => {
        const answeredToday = !!uw.lastReviewDate && uw.lastReviewDate >= today;
        return {
            ...uw.toObject(),
            answeredToday,
            todayResult: answeredToday ? uw.lastResult ?? null : null
        };
    });

    // Yeni kelimelerin bugünkü cevabı (ilk cevapta UserWord oluşur) tek sorguyla
    const answeredNew = newWordsRaw.length > 0
        ? await UserWord.find({
            user: userId,
            word: { $in: newWordsRaw.map(w => w._id) },
            lastReviewDate: { $gte: today }
        }).select('word lastResult')
        : [];
    const newResultByWord = new Map(answeredNew.map(uw => [String(uw.word), uw.lastResult ?? null]));

    const newWords = newWordsRaw.map(w => {
        // $sample'dan gelen düz objeler hydrate ile doc'a çevrilir ki
        // isKana virtual'ı burada da hesaplansın
        const obj = typeof w.toObject === 'function' ? w.toObject() : Word.hydrate(w).toObject();
        const answeredToday = newResultByWord.has(String(w._id));
        return {
            ...obj,
            answeredToday,
            todayResult: answeredToday ? newResultByWord.get(String(w._id)) : null
        };
    });

    const answered = reviewWords.filter(w => w.answeredToday).length
        + newWords.filter(w => w.answeredToday).length;
    const total = reviewWords.length + newWords.length;

    return {
        reviewWords,
        newWords,
        progress: { total, answered, remaining: total - answered }
    };
};

const UserWordService = {
    async getTodayWords(userId, jlptLevel) {
        const user = await User.findById(userId).select('dailyGoal timezone');
        const today = startOfDayInTz(user?.timezone);

        // Bugün için havuz var mı kontrol et
        let pool = await DailyWordPool.findOne({
            user: userId,
            date: today,
            jlptLevel
        });

        if (pool) {
            // Havuz zaten var, sabit listeyi döndür
            const reviewWords = await UserWord.find({
                _id: { $in: pool.reviewWordIds }
            }).populate('word');

            const newWords = await Word.find({
                _id: { $in: pool.newWordIds }
            });

            return decorateTodayWords(userId, today, reviewWords, newWords);
        }

        // Havuz yok, yeni oluştur.
        // Havuz boyutunu kullanıcının günlük hedefi belirler (env limitleri fallback).
        // Not: Havuz gün boyu sabittir; dailyGoal gün içinde değişirse yarın etkili olur.
        const goal = user?.dailyGoal || (NEW_WORD_DAILY_LIMIT + REVIEW_DAILY_LIMIT);

        // Tekrarlar öncelikli: hedefin en fazla %70'i tekrar
        const reviewLimit = Math.ceil(goal * 0.7);

        // Seviye filtresi populate-match ile YAPILMAZ: eşleşmeyen kayıtlar
        // word:null olarak dönüp limit kontenjanını yer, havuza boş kelime girerdi.
        // Filtre sorgunun kendisine taşınır.
        const reviewFilter = {
            user: userId,
            nextReviewDate: { $lte: new Date() },
            status: { $in: ['learning', 'learned'] }
        };
        if (jlptLevel) {
            reviewFilter.word = { $in: await Word.find({ jlptLevel }).distinct('_id') };
        }

        const reviewWordsRaw = await UserWord.find(reviewFilter)
        .populate('word')
        // En eski vade önce; eşitlikte en kırılgan (düşük seviyeli) kelime kazanır —
        // uzun aradan dönüşte kontenjan yetmezse sağlam hafızalı kelimeler bekleyebilir
        .sort({ nextReviewDate: 1, masteryLevel: 1 })
        .limit(reviewLimit);

        const learnedWordIds = await UserWord.find({ user: userId }).distinct('word');

        // Kalan hedefi rastgele yeni kelimelerle doldur
        const newLimit = Math.max(0, goal - reviewWordsRaw.length);
        const newWordsRaw = newLimit > 0
            ? await Word.aggregate([
                {
                    $match: {
                        _id: { $nin: learnedWordIds },
                        isCore: true,
                        ...(jlptLevel && { jlptLevel })
                    }
                },
                { $sample: { size: newLimit } }
            ])
            : [];

        // Havuzu kaydet
        await DailyWordPool.create({
            user: userId,
            date: today,
            jlptLevel,
            reviewWordIds: reviewWordsRaw.map(uw => uw._id),
            newWordIds: newWordsRaw.map(w => w._id)
        });

        logEvent(userId, 'daily_pool_created', {
            jlptLevel,
            reviewCount: reviewWordsRaw.length,
            newCount: newWordsRaw.length,
            goal
        });

        // Günün görevi bildirimi (havuz günde bir kez oluşur)
        try {
            const totalToday = reviewWordsRaw.length + newWordsRaw.length;
            if (totalToday > 0) {
                await NotificationService.create(userId, {
                    type: 'daily_task',
                    title: 'Bugünün Görevi',
                    body: `Bugün ${totalToday} ezberlenecek kelime seni bekliyor!`,
                    data: { totalWords: totalToday, jlptLevel }
                });
            }
        } catch (err) {
            // Bildirim hatası kelime akışını bozmasın
        }

        return decorateTodayWords(userId, today, reviewWordsRaw, newWordsRaw);
    },

    async submitAnswer(userId, wordId, result, answer) {
        // wordId gerçekten var mı kontrol et
        const wordExists = await Word.findById(wordId);
        if (!wordExists) throw new AppError('Word not found', 404);

        // Yazma sorusunda istemci result yerine yazılan metni (answer) gönderir;
        // puanlama quiz ile aynı mantıkla BURADA yapılır (tek doğruluk kaynağı:
        // "to see / watch" gibi çok varyantlı anlamlarda her varyant kabul edilir)
        let correctAnswer;
        if (result == null && answer !== undefined) {
            const variants = meaningVariants(wordExists.meaning);
            correctAnswer = variants[0];
            result = !normalizeAnswer(answer) ? 'empty'
                : gradeTyping(answer, variants) ? 'correct'
                : 'wrong';
        }

        const quality = qualityMap[result];
        if (!quality) throw new AppError('Invalid result, use: correct, easy, empty, wrong', 400);

        let userWord = await UserWord.findOne({ user: userId, word: wordId });

        if (!userWord) {
            userWord = await UserWord.create({ user: userId, word: wordId });
        }

        // SM-2 aralıklı tekrar varsayar: aynı gün içinde tekrar verilen doğru
        // cevap SM-2 durumunu İLERLETMEZ (istemci bir kelimeyi öğrenme + test
        // aşamalarında iki kez sorabiliyor; dakikalar arayla iki doğru, kelimeyi
        // 6 günlük interval'a zıplatıp tek oturumda "ustalık 3" yapıyordu).
        // Yanlış cevap ise her koşulda sıfırlar — unutma sinyali gün içinde de geçerli.
        const user = await User.findById(userId).select('timezone');
        const today = startOfDayInTz(user?.timezone);
        const reviewedToday = !!userWord.lastReviewDate && userWord.lastReviewDate >= today;

        if (!(quality >= 3 && reviewedToday)) {
            const { easeFactor, interval, repetitions, nextReviewDate } = sm2(userWord, quality);
            userWord.easeFactor = easeFactor;
            userWord.interval = interval;
            userWord.repetitions = repetitions;
            userWord.nextReviewDate = nextReviewDate;
        }
        userWord.lastReviewDate = new Date();
        userWord.lastResult = result;

        const previousLevel = userWord.masteryLevel || 1;
        userWord.masteryLevel = computeMasteryLevel(userWord);
        const levelDropped = userWord.masteryLevel < previousLevel;

        if (quality >= 3) {
            userWord.correctCount += 1;
            userWord.status = userWord.interval >= 21 ? 'learned' : 'learning';
        } else {
            userWord.wrongCount += 1;
            userWord.status = 'learning';
        }

        await userWord.save();

        if (levelDropped) {
            try {
                await NotificationService.create(userId, {
                    type: 'word_level_down',
                    title: 'Kelimenin Seviyesi Düştü',
                    body: `${wordExists.kanji} (${wordExists.romaji}) kelimesinin seviyesi ${userWord.masteryLevel}. seviyeye düştü. Tekrar hatırla!`,
                    data: {
                        wordId: wordExists._id,
                        kanji: wordExists.kanji,
                        previousLevel,
                        newLevel: userWord.masteryLevel
                    }
                });
            } catch (err) {
                // Bildirim hatası cevap akışını bozmasın
            }
        }

        // İlk cevapta streak güncelle (kısmi ilerleme bile sayılsın)
        await StreakService.updateStreak(userId);
        await ProgressService.checkAndUnlockNextLevel(userId, wordExists.jlptLevel);

        // Aynı-gün tekrarı session sayaçlarına da SAYILMAZ (SM-2 kuralıyla
        // tutarlı: ilk cevap geçerli). Ders yarıda kalıp yeniden başlayınca
        // ana ekran çemberi 19/30 gibi şişmez, hedefi aşamaz.
        if (!reviewedToday) {
            try {
                await StudySessionService.updateSession(userId, result);
            } catch (err) {
                // Session yoksa sessizce geç, hata fırlatma
            }
        }

        logEvent(userId, 'answer_submitted', {
            wordId,
            jlptLevel: wordExists.jlptLevel,
            result,
            masteryLevel: userWord.masteryLevel,
            levelDropped
        });

        return {
            ...userWord.toObject(),
            levelDropped,
            previousLevel,
            result, // backend puanlamasında istemci sonucu buradan öğrenir
            ...(correctAnswer !== undefined && { correctAnswer })
        };
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
                updates.push({
                    updateOne: {
                        filter: { _id: uw._id },
                        update: { $set: { masteryLevel: target } }
                    }
                });
                const key = String(uw.user);
                const entry = perUser.get(key) || { count: 0, sampleWordIds: [] };
                entry.count += 1;
                if (entry.sampleWordIds.length < 3) entry.sampleWordIds.push(uw.word);
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

        // Düz alan karşılaştırması $expr'dan farklı olarak index kullanabilir
        const mistakeFilter = {
            user: userId,
            lastReviewDate: { $gte: today },
            wrongCount: { $gt: 0 }
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