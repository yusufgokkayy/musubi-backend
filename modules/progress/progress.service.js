const mongoose = require('mongoose');
const Progress = require('../../models/Progress');
const UserWord = require('../../models/UserWord');
const Word = require('../../models/Word');
const User = require('../../models/User');
const AppError = require('../../utils/AppError');

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
// Seviyeler ekranındaki "listeyi %75 oranında tamamlayın" metniyle aynı değer;
// client bu sayıyı GET /progress yanıtındaki completionThreshold'dan okur
const COMPLETION_THRESHOLD = 75;

// Bir kelimenin "öğrenildi" sayıldığı en düşük mastery seviyesi (2 başarılı
// tekrar). Hem seviye kilidinin oranını hem Hafıza ekranındaki Orta/İyi/Ezber
// kutularını bu sabit tanımlar — ikisi ayrışırsa kullanıcı "%65" yazan bir
// çubuğun altında toplamı %65 tutmayan kutular görür.
const MASTERY_COUNTED_MIN = 3;

// "Öğrenme Seviyen" ekranındaki satır başlıkları (N5 • Başlangıç). Sunucuda
// tutulur ki seviye adı tek yerden gelsin; istemci kendi sözlüğünü taşımasın.
const LEVEL_LABELS = {
    N5: 'Başlangıç',
    N4: 'Temel',
    N3: 'Orta',
    N2: 'İleri',
    N1: 'Uzman'
};

// Seviye adının tamlayan eki, okunuşuna göre: N5 "beş" → N5'in, N4 "dört" →
// N4'ün, N3 "üç" → N3'ün, N2 "iki" → N2'nin, N1 "bir" → N1'in.
const LEVEL_GENITIVE = { N5: "N5'in", N4: "N4'ün", N3: "N3'ün", N2: "N2'nin", N1: "N1'in" };

// Kilitli satırın açıklaması: bir seviye, KENDİNDEN ÖNCEKİ seviyenin eşiği
// aşılınca açılır (checkAndUnlockNextLevel ile aynı kural). N5 hiç kilitli
// olmadığı için buraya düşmez.
const unlockHintFor = (jlptLevel) => {
    const prev = LEVELS[LEVELS.indexOf(jlptLevel) - 1];
    return prev ? `${LEVEL_GENITIVE[prev]} %${COMPLETION_THRESHOLD}'i ile açılır` : null;
};

const ProgressService = {
    // Seviye adları dışarıdan da okunur (anasayfadaki "N4 • Temel Seviyesi
    // Hazır" bandı) — iki yerde iki sözlük tutulmasın.
    LEVELS,
    LEVEL_LABELS,
    // Hafıza modülü bu iki eşiği yeniden tanımlamaz, buradan okur
    COMPLETION_THRESHOLD,
    MASTERY_COUNTED_MIN,

    async initializeProgress(userId) {
        // Kullanıcı kayıt olunca sadece N5 açık
        await Progress.create({
            user: userId,
            jlptLevel: 'N5',
            isUnlocked: true,
            unlockedAt: new Date(),
            unlockedBy: 'study'
        });

        // Diğer seviyeler kilitli
        const lockedLevels = ['N4', 'N3', 'N2', 'N1'].map(level => ({
            user: userId,
            jlptLevel: level,
            isUnlocked: false
        }));

        await Progress.insertMany(lockedLevels);
    },

    // Ayarlar > "Öğrenme Seviyen" ekranının tamamı. Sıra N1→N5'tir (jlptLevel
    // alfabetik = tasarımdaki liste sırası: kilitli üstte, tamamlanan altta).
    async getProgress(userId) {
        const [progress, user] = await Promise.all([
            Progress.find({ user: userId }).sort({ jlptLevel: 1 }),
            User.findById(userId).select('activeLevel')
        ]);
        const activeLevel = user?.activeLevel || 'N5';

        const levels = await Promise.all(
            progress.map(async (p) => {
                const totalWords = await Word.countDocuments({ jlptLevel: p.jlptLevel, isCore: true });
                const isActive = p.jlptLevel === activeLevel;

                return {
                    jlptLevel: p.jlptLevel,
                    label: LEVEL_LABELS[p.jlptLevel],
                    isUnlocked: p.isUnlocked,
                    completionRate: p.completionRate,
                    totalWords,
                    isActive,
                    // Tasarımdaki satır rozetleri. "completed" ile "active" ayrık:
                    // %75'i geçmiş seviyede çalışmaya devam eden kullanıcı
                    // "Tamamlandı" değil "Şu anki seviyen" görmeli.
                    state: !p.isUnlocked ? 'locked'
                        : isActive ? 'active'
                        : p.completionRate >= COMPLETION_THRESHOLD ? 'completed'
                        : 'available',
                    // Satırdaki "Geç" bağlantısı: açık ve şu an seçili olmayan
                    // her seviye seçilebilir — tamamlananlar dahil (kullanıcı
                    // eski seviyesine dönebilir).
                    canSelect: p.isUnlocked && !isActive,
                    // Kilitli satırın altındaki "N4'ün %75'i ile açılır"
                    unlockHint: p.isUnlocked ? null : unlockHintFor(p.jlptLevel)
                };
            })
        );

        return {
            completionThreshold: COMPLETION_THRESHOLD, // "listeyi %75 oranında tamamlayın" bilgi kutusu
            activeLevel,
            levels
        };
    },

    // Ayarlar > "Öğrenme Seviyeni Değiştir" onayı. Yalnızca AÇIK bir seviyeye
    // geçilebilir; kilitli seviyeye geçiş 403'tür (aynı cümle quiz akışında da
    // kullanılıyor). İlerleme hiçbir şekilde silinmez — geçiş sadece günlük
    // dersin hangi havuzdan çekileceğini değiştirir, kullanıcı dilediği an
    // eski seviyesine döner.
    async setActiveLevel(userId, jlptLevel) {
        if (!LEVELS.includes(jlptLevel)) {
            throw new AppError('jlptLevel N5-N1 arasında olmalı', 400);
        }

        const target = await Progress.findOne({ user: userId, jlptLevel });
        if (!target) throw new AppError('Progress not found', 404);
        if (!target.isUnlocked) throw new AppError('Bu seviye henüz kilitli', 403);

        await User.findByIdAndUpdate(userId, { activeLevel: jlptLevel });

        // İstemci "Seviyen Güncellendi!" ekranından doğrudan listeye döndüğü
        // için güncel listeyi de veriyoruz; ikinci bir GET gerekmesin.
        return ProgressService.getProgress(userId);
    },

    async calculateCompletionRate(userId, jlptLevel) {
        const totalWords = await Word.countDocuments({ jlptLevel, isCore: true });
        if (totalWords === 0) return 0;

        // masteryLevel >= 3 (2 başarılı tekrar) "sayılır" — 'learned' (21 gün) beklenirse
        // çalışkan bir kullanıcı bile seviyeyi aylarca açamaz
        const learnedWords = await UserWord.countDocuments({
            user: userId,
            masteryLevel: { $gte: MASTERY_COUNTED_MIN },
            word: { $in: await Word.find({ jlptLevel, isCore: true }).distinct('_id') }
        });

        return Math.round((learnedWords / totalWords) * 100);
    },

    async checkAndUnlockNextLevel(userId, jlptLevel) {
        const completionRate = await ProgressService.calculateCompletionRate(userId, jlptLevel);

        // Tamamlanma oranını güncelle
        await Progress.findOneAndUpdate(
            { user: userId, jlptLevel },
            { completionRate }
        );

        if (completionRate >= COMPLETION_THRESHOLD) {
            const currentIndex = LEVELS.indexOf(jlptLevel);
            // N1 son seviye, sonrası yok
            if (currentIndex === -1 || currentIndex === LEVELS.length - 1) return;

            const nextLevel = LEVELS[currentIndex + 1];

            const nextProgress = await Progress.findOne({
                user: userId,
                jlptLevel: nextLevel
            });

            if (!nextProgress.isUnlocked) {
                nextProgress.isUnlocked = true;
                nextProgress.unlockedAt = new Date();
                nextProgress.unlockedBy = 'study';
                await nextProgress.save();

                return { unlocked: true, level: nextLevel };
            }
        }

        return { unlocked: false };
    },

    // Seviyeler ekranındaki donut grafik için: bu JLPT seviyesindeki
    // kelimelerin 1-5 mastery seviyelerine göre dağılımı
    async getLevelDistribution(userId, jlptLevel) {
        if (!LEVELS.includes(jlptLevel)) {
            throw new AppError('Invalid level', 400);
        }

        const wordIds = await Word.find({ jlptLevel, isCore: true }).distinct('_id');
        const totalWords = wordIds.length;

        const counts = await UserWord.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(userId),
                    word: { $in: wordIds }
                }
            },
            // Eski kayıtlarda masteryLevel alanı olmayabilir, 1 say
            { $group: { _id: { $ifNull: ['$masteryLevel', 1] }, count: { $sum: 1 } } }
        ]);

        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let started = 0;
        counts.forEach(c => {
            distribution[c._id] = c.count;
            started += c.count;
        });

        return {
            jlptLevel,
            totalWords,
            distribution,
            notStarted: totalWords - started
        };
    },

    // unlockByQuiz kaldırıldı: "bir basamağı geçince BİR ÜSTÜNÜ aç" merdiven
    // kuralıydı, seviye tespit sınavı artık tek seferde belirlenen seviyeye
    // KADAR olan hepsini açıyor (bkz. quiz.service.js finalizeAttempt).
    // Seviye atlama sınavı (levelup) da kalktı; kilidin diğer tek yolu
    // çalışmayla %75'e ulaşmak (checkAndUnlockNextLevel).
};

module.exports = ProgressService;