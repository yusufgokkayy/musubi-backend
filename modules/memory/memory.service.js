const UserWord = require('../../models/UserWord');
const Word = require('../../models/Word');
const User = require('../../models/User');
const Progress = require('../../models/Progress');
const AppError = require('../../utils/AppError');
const ProgressService = require('../progress/progress.service');
const { weekDatesInTz, startOfDateInTz } = require('../../utils/date.util');

const { LEVELS, COMPLETION_THRESHOLD, MASTERY_COUNTED_MIN, levelLabel } = ProgressService;

// Hafıza ekranındaki beş kutu. Figma'daki cümle "İyi ve Ezber kutularının
// toplamı %75'i geçince N4 açılır" der: kilide sayılan kutular tam olarak
// masteryLevel >= MASTERY_COUNTED_MIN kümesidir. Kilit kuralıyla aynı eşiği
// paylaşırlar ve ProgressService'ten okunur, burada yeniden tanımlanmaz.
// (Aynı mockup'taki %65, 30.10.2026'dan önceki Orta+İyi+Ezber kuralıyla
// hesaplanmış; o sayı artık örnek değil.)
//
// "Yeni" kutusu UserWord kaydı HİÇ olmayan kelimelerdir (ürün kararı).
// "Şimdilik Geç"lenmiş bir kelimenin kaydı açılmıştır ve masteryLevel'ı 1'dir,
// yani Yeni'de değil Zayıf'ta görünür.
const BOXES = [
    { key: 'new',      masteryLevels: [] },
    { key: 'weak',     masteryLevels: [1, 2] },
    { key: 'medium',   masteryLevels: [3] },
    { key: 'good',     masteryLevels: [4] },
    { key: 'mastered', masteryLevels: [5] }
];

// Kutu adları ve kilit cümlesi kullanıcının dilinde (preferences.language).
// Türkçe metinler Figma › Versiyon 1.x.x › Seviyeler ile birebir.
const TEXTS = {
    tr: {
        boxes: { new: 'Yeni', weak: 'Zayıf', medium: 'Orta', good: 'İyi', mastered: 'Ezber' },
        unlockHint: (labels, threshold, next) =>
            `${labels.slice(0, -1).join(', ')} ve ${labels.at(-1)} kutularının toplamı %${threshold}'i geçince ${next} açılır.`,
        unlocked: (next) => `${next} kilidi açıldı.`
    },
    en: {
        boxes: { new: 'New', weak: 'Weak', medium: 'Medium', good: 'Good', mastered: 'Mastered' },
        unlockHint: (labels, threshold, next) =>
            `${next} unlocks once the ${labels.slice(0, -1).join(', ')} and ${labels.at(-1)} boxes together pass ${threshold}%.`,
        unlocked: (next) => `${next} unlocked.`
    }
};
const textsFor = (lang) => TEXTS[lang] || TEXTS.tr;

const BOX_KEYS = BOXES.map(b => b.key);
const boxByKey = new Map(BOXES.map(b => [b.key, b]));

// Tasarımda açılışta seçili gelen kutu
const DEFAULT_BOX = 'weak';

// UserWord.promotedAt'in yazılmaya başladığı an. Bundan ÖNCE başlayan haftalar
// için "bu hafta kaç kelime iyiye geçti" sorusunun dürüst cevabı yoktur (veri
// geriye dönük üretilemez) — o haftalarda alan null döner ve istemci çipi hiç
// çizmez. Yanlış bir "+0" göstermektense hiç göstermemek tercih edildi.
// Env her çağrıda okunur (import anında değil) ki test/staging tarihi geriye
// çekip çipi doğrulayabilsin.
// Varsayılan, eşiğin 3'ten 4'e çekildiği gün: o haftaya kadar promotedAt
// eski eşiğe (Orta'ya giriş) göre yazıldı, İyi'ye girişler eksik kalır.
const trackingSince = () =>
    new Date(process.env.MEMORY_TRACKING_SINCE || '2026-10-30T00:00:00.000Z');

// masteryLevel alanı olmayan ESKİ kayıtlar 1 sayılır — getLevelDistribution
// aynı şeyi $ifNull ile yapıyor; ikisi ayrışırsa kutunun sayısı ile listesinin
// uzunluğu tutmazdı. Mongo'da { alan: null } hem null'ı hem yokluğu eşler.
const masteryFilterFor = (box) => box.masteryLevels.includes(1)
    ? { $or: [{ masteryLevel: { $in: box.masteryLevels } }, { masteryLevel: null }] }
    : { masteryLevel: { $in: box.masteryLevels } };

const MemoryService = {
    BOXES,
    DEFAULT_BOX,

    // GET /memory — ekranın tamamı (seviye kartı + beş kutu + haftalık çip).
    // Kapsam varsayılan olarak AKTİF seviyedir: karttaki %65/%75 oranı da,
    // kutuların toplamı da o seviyenin core kelime sayısına göre hesaplanır.
    async getMemory(userId, jlptLevel) {
        const user = await User.findById(userId).select('activeLevel timezone preferences.language');
        const activeLevel = user?.activeLevel || 'N5';
        const level = jlptLevel || activeLevel;
        const lang = user?.preferences?.language;
        const texts = textsFor(lang);

        // Seviye doğrulaması (400 "Invalid level") ve dağılım buradan gelir;
        // ikinci bir aggregate yazılmaz.
        const { totalWords, distribution, notStarted } =
            await ProgressService.getLevelDistribution(userId, level);

        const boxes = BOXES.map(box => ({
            key: box.key,
            label: texts.boxes[box.key],
            count: box.key === 'new'
                ? notStarted
                : box.masteryLevels.reduce((sum, l) => sum + (distribution[l] || 0), 0),
            masteryLevels: box.masteryLevels,
            countsTowardUnlock: box.masteryLevels.some(l => l >= MASTERY_COUNTED_MIN)
        }));

        // Oran Progress.completionRate alanından DEĞİL kutuların kendisinden
        // türetilir: o alan yalnızca cevap anında tazeleniyor, buradan okunsaydı
        // kart "%65" derken altındaki kutular %68 gösterebilirdi.
        const countedWords = boxes
            .filter(b => b.countsTowardUnlock)
            .reduce((sum, b) => sum + b.count, 0);
        const completionRate = totalWords > 0
            ? Math.round((countedWords / totalWords) * 100)
            : 0;

        const nextLevelKey = LEVELS[LEVELS.indexOf(level) + 1];
        const nextProgress = nextLevelKey
            ? await Progress.findOne({ user: userId, jlptLevel: nextLevelKey }).select('isUnlocked')
            : null;
        const nextUnlocked = !!nextProgress?.isUnlocked;

        // "İyi ve Ezber kutularının toplamı %75'i geçince N4 açılır."
        // Kutu adları listeden üretilir ki eşik ya da kutu isimleri değişirse
        // metin de kendiliğinden değişsin.
        const countedLabels = boxes.filter(b => b.countsTowardUnlock).map(b => b.label);
        const unlockHint = !nextLevelKey ? null
            : nextUnlocked ? texts.unlocked(nextLevelKey)
            : texts.unlockHint(countedLabels, COMPLETION_THRESHOLD, nextLevelKey);

        return {
            jlptLevel: level,
            label: levelLabel(level, lang),
            isActiveLevel: level === activeLevel,
            totalWords,
            completionThreshold: COMPLETION_THRESHOLD,
            completionRate,
            // "N4'e geçmene %10 kaldı" — N1'de ve kilit zaten açıksa anlamsız
            remainingPercent: !nextLevelKey ? null
                : nextUnlocked ? 0
                : Math.max(0, COMPLETION_THRESHOLD - completionRate),
            nextLevel: nextLevelKey
                ? { jlptLevel: nextLevelKey, label: levelLabel(nextLevelKey, lang), isUnlocked: nextUnlocked }
                : null,
            unlockHint,
            boxes,
            defaultBox: DEFAULT_BOX,
            weeklyImproved: await MemoryService.weeklyImproved(userId, level, user?.timezone)
        };
    },

    // "↗ Bu hafta +23 kelime iyiye geçti": bu hafta sayılan bölgeye (İyi+)
    // GİREN kelime sayısı. Hafta sınırı Anasayfa'daki seri şeridiyle AYNI
    // kuraldır (Pzt→Paz, kullanıcının saat diliminde) — iki ekran "bu hafta"
    // derken farklı yedi günü kastedemez.
    async weeklyImproved(userId, jlptLevel, timezone) {
        const weekStart = startOfDateInTz(timezone, weekDatesInTz(timezone)[0]);
        if (weekStart < trackingSince()) return null; // o hafta için veri eksik

        const wordIds = await Word.find({ jlptLevel, isCore: true }).distinct('_id');
        // masteryLevel filtresi: eşik 3'ken bölgeye girip promotedAt almış,
        // bugün 3'te duran kelimeler (Orta) artık bölgede değildir. İzleri
        // kendiliğinden silinmez (yalnızca bir sonraki cevap ya da decay
        // siler), o yüzden burada elenir.
        return UserWord.countDocuments({
            user: userId,
            word: { $in: wordIds },
            masteryLevel: { $gte: MASTERY_COUNTED_MIN },
            promotedAt: { $gte: weekStart }
        });
    },

    // GET /memory/words — "Zayıf Kutusundakiler" listesi ve "Tümünü Gör".
    async getBoxWords(userId, { box, jlptLevel, page = 1, limit = 20 } = {}) {
        const boxDef = boxByKey.get(box);
        if (!boxDef) throw new AppError(`box: ${BOX_KEYS.join(', ')} olmalı`, 400);

        page = Math.max(parseInt(page) || 1, 1);
        limit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
        const skip = (page - 1) * limit;

        if (jlptLevel && !LEVELS.includes(jlptLevel)) throw new AppError('Invalid level', 400);
        const user = await User.findById(userId).select('activeLevel preferences.language');
        const level = jlptLevel || user?.activeLevel || 'N5';

        let items;
        let total;

        if (box === 'new') {
            // Hiç dokunulmamış kelimeler UserWord üzerinden listelenemez (kayıt
            // yok) — Word koleksiyonundan, kullanıcının kayıtları düşülerek
            // gelir. Sıra MÜFREDAT sırasıdır (frequencyRank): listenin başı,
            // günlük derste sıradaki yeni kelimedir (bkz. selectPoolWords).
            const knownWordIds = await UserWord.find({ user: userId }).distinct('word');
            const filter = { jlptLevel: level, isCore: true, _id: { $nin: knownWordIds } };

            [items, total] = await Promise.all([
                Word.find(filter).sort({ frequencyRank: 1, _id: 1 }).skip(skip).limit(limit),
                Word.countDocuments(filter)
            ]);

            items = items.map(word => ({
                word,
                box,
                masteryLevel: null,
                nextReviewDate: null,
                lastReviewDate: null,
                lastResult: null
            }));
        } else {
            const levelWordIds = await Word.find({ jlptLevel: level, isCore: true }).distinct('_id');
            const filter = {
                user: userId,
                word: { $in: levelWordIds },
                ...masteryFilterFor(boxDef)
            };

            // Sıralama günlük havuzun tekrar sırasıyla AYNI (en eski vade önce,
            // eşitlikte en kırılgan kelime): kullanıcı listenin başında yarınki
            // dersinde ilk karşılaşacağı kelimeyi görür.
            const [docs, count] = await Promise.all([
                UserWord.find(filter)
                    .populate('word')
                    .sort({ nextReviewDate: 1, masteryLevel: 1 })
                    .skip(skip)
                    .limit(limit),
                UserWord.countDocuments(filter)
            ]);

            total = count;
            // Silinmiş bir kelimeye asılı kalan kayıtlar populate sonrası
            // word:null döner, elenir (Anasayfa hata çipleriyle aynı koruma).
            items = docs.filter(uw => uw.word).map(uw => ({
                word: uw.word,
                box,
                masteryLevel: uw.masteryLevel ?? 1,
                nextReviewDate: uw.nextReviewDate,
                lastReviewDate: uw.lastReviewDate,
                lastResult: uw.lastResult ?? null
            }));
        }

        return {
            box,
            label: textsFor(user?.preferences?.language).boxes[box],
            jlptLevel: level,
            items,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    }
};

module.exports = MemoryService;
