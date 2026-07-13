const QuizAttempt = require('../../models/QuizAttempt');
const Word = require('../../models/Word');
const Progress = require('../../models/Progress');
const AppError = require('../../utils/AppError');
const ProgressService = require('../progress/progress.service');
const logEvent = require('../../utils/event.util');

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

const QUIZ_CONFIG = {
    levelup: { questionCount: 35, passThreshold: 85 },
    // 10 soru × 5 basamak = tasarımın sonuç ekranındaki 50 soru
    placement: { questionCount: 10, passThreshold: 70 }
};
const COOLDOWN_DAYS = [3, 7, 14]; // 1., 2., 3.+ başarısız deneme
const EXPIRY_MINUTES = 30;
const MIN_QUESTIONS = 10;

const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

// Client'a cevap anahtarı sızdırmadan soru listesi (typing sorusunun şıkkı yoktur)
const sanitizeQuestions = (questions) =>
    questions.map((q, index) => ({
        index,
        format: q.format,
        prompt: q.prompt,
        ...(q.format !== 'typing' && { choices: q.choices })
    }));

// Yazma cevabı puanlama: Türkçe küçük harf, parantez içleri opsiyonel,
// noktalama/fazla boşluk yok sayılır
const normalizeAnswer = (s) => String(s ?? '')
    .toLocaleLowerCase('tr')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const gradeTyping = (answer, correctAnswers) => {
    const typed = normalizeAnswer(answer);
    if (!typed) return false; // boş bırakılan ("Şimdilik Geç") yanlış sayılır
    return correctAnswers.some(c => normalizeAnswer(c) === typed);
};

// "gelecek yıl, seneye" gibi anlamlarda her varyant tek başına da kabul edilir
const meaningVariants = (meaning) => {
    const variants = [meaning, ...meaning.split(/[,;/]/)]
        .map(v => v.trim())
        .filter(Boolean);
    return [...new Set(variants)];
};

const attemptResponse = (attempt) => ({
    quizId: attempt._id,
    type: attempt.type,
    jlptLevel: attempt.jlptLevel,
    passThreshold: QUIZ_CONFIG[attempt.type].passThreshold,
    expiresAt: new Date(attempt.createdAt.getTime() + EXPIRY_MINUTES * 60 * 1000),
    totalQuestions: attempt.questions.length,
    questions: sanitizeQuestions(attempt.questions)
});

const QuizService = {
    // Havuzdan rastgele, her denemede taze soru seti üretir.
    // extendedFormats (placement): yazma sorusu + içeriği olan kelimelerde
    // boşluk doldurma (example) ve görselli soru (imageUrl) da karışıma girer;
    // levelup klasik 3 şıklı formatla kalır
    async generateQuestions(jlptLevel, count, extendedFormats = false) {
        const targets = await Word.aggregate([
            { $match: { jlptLevel, isCore: true } },
            { $sample: { size: count } }
        ]);

        if (targets.length < MIN_QUESTIONS) {
            throw new AppError('Bu seviyede quiz için yeterli kelime yok', 400);
        }

        // Çeldirici havuzu: aynı seviyeden, hedef kelimeler hariç
        const pool = await Word.aggregate([
            { $match: { jlptLevel, isCore: true, _id: { $nin: targets.map(t => t._id) } } },
            { $sample: { size: 80 } }
        ]);

        const questions = [];
        for (const word of targets) {
            const formats = ['meaning', 'reverse'];
            if (word.kanji !== word.romaji) formats.push('reading'); // kana-only kelimede okunuş sorusu anlamsız
            if (extendedFormats) {
                formats.push('typing');
                // İçerik formatları yalnızca verisi olan kelimede seçilebilir
                if (word.example?.includes(word.kanji)) formats.push('fillblank');
                if (word.imageUrl) formats.push('image');
            }
            const format = formats[Math.floor(Math.random() * formats.length)];

            if (format === 'typing') {
                questions.push({
                    word: word._id,
                    format,
                    // Kelime gösterilir, anlamı yazılır; ses de kelimeyi söyler (cevabı sızdırmaz)
                    prompt: { kanji: word.kanji, romaji: word.romaji, audioUrl: word.audioUrl },
                    correctAnswers: meaningVariants(word.meaning)
                });
                continue;
            }

            // fillblank/image cevabı kelimenin kendisidir (kanji şıkları);
            // ses bu ikisinde YOK — kelimeyi seslendirmek cevabı söylemek olur
            const field = (format === 'meaning') ? 'meaning'
                : (format === 'reading') ? 'romaji'
                : 'kanji'; // reverse | fillblank | image
            const correct = word[field];

            // Aynı tür öncelikli, benzersiz metinli 3 çeldirici
            const sameType = pool.filter(p => p.type === word.type);
            const otherType = pool.filter(p => p.type !== word.type);
            const seen = new Set([correct]);
            const distractors = [];
            for (const cand of [...shuffle(sameType), ...shuffle(otherType)]) {
                const val = cand[field];
                if (!val || seen.has(val)) continue;
                seen.add(val);
                distractors.push(val);
                if (distractors.length === 3) break;
            }
            if (distractors.length < 3) continue; // yeterli çeldirici yoksa soruyu atla

            const choices = shuffle([correct, ...distractors]);
            // reverse/fillblank/image'da ses YOK: kelimeyi seslendirmek doğru şıkkı söylemek olur
            const prompt =
                format === 'meaning' ? { kanji: word.kanji, romaji: word.romaji, audioUrl: word.audioUrl } :
                format === 'reverse' ? { meaning: word.meaning } :
                format === 'fillblank' ? { sentence: word.example.replaceAll(word.kanji, '____') } :
                format === 'image' ? { imageUrl: word.imageUrl } :
                { kanji: word.kanji, audioUrl: word.audioUrl }; // reading

            questions.push({
                word: word._id,
                format,
                prompt,
                choices,
                correctIndex: choices.indexOf(correct)
            });
        }

        if (questions.length < MIN_QUESTIONS) {
            throw new AppError('Bu seviyede quiz için yeterli kelime yok', 400);
        }
        return questions;
    },

    // Süresi geçmiş in_progress denemeyi expire eder, geçerliyse döndürür
    async resolveInProgress(userId, type, jlptLevel = null) {
        const filter = { user: userId, type, status: 'in_progress' };
        if (jlptLevel) filter.jlptLevel = jlptLevel;

        const attempt = await QuizAttempt.findOne(filter).sort({ createdAt: -1 });
        if (!attempt) return null;

        if (Date.now() > attempt.createdAt.getTime() + EXPIRY_MINUTES * 60 * 1000) {
            attempt.status = 'expired';
            await attempt.save();
            return null;
        }
        return attempt;
    },

    async startLevelup(userId, jlptLevel) {
        const currentIndex = LEVELS.indexOf(jlptLevel);
        if (currentIndex === -1) throw new AppError('Invalid level', 400);
        if (currentIndex === LEVELS.length - 1) throw new AppError('N1 son seviye, atlanacak seviye yok', 400);

        const current = await Progress.findOne({ user: userId, jlptLevel });
        if (!current?.isUnlocked) throw new AppError('Bu seviye henüz kilitli', 403);

        const next = await Progress.findOne({ user: userId, jlptLevel: LEVELS[currentIndex + 1] });
        if (next?.isUnlocked) throw new AppError('Sonraki seviye zaten açık', 400);

        // Cooldown: son başarısız denemenin beklemesi bitti mi?
        const lastFailed = await QuizAttempt.findOne({
            user: userId, type: 'levelup', jlptLevel, status: 'completed', passed: false
        }).sort({ createdAt: -1 });

        if (lastFailed?.nextAttemptAllowedAt && lastFailed.nextAttemptAllowedAt > new Date()) {
            const err = new AppError('Sınav hakkın henüz yenilenmedi', 403);
            err.nextAttemptAllowedAt = lastFailed.nextAttemptAllowedAt;
            throw err;
        }

        // Yarım kalmış geçerli deneme varsa onu döndür (soru sızdırma avantajı yok, sorular zaten rastgele)
        const existing = await QuizService.resolveInProgress(userId, 'levelup', jlptLevel);
        if (existing) return attemptResponse(existing);

        const questions = await QuizService.generateQuestions(jlptLevel, QUIZ_CONFIG.levelup.questionCount);
        const attempt = await QuizAttempt.create({ user: userId, type: 'levelup', jlptLevel, questions });
        logEvent(userId, 'quiz_started', { type: 'levelup', jlptLevel });
        return attemptResponse(attempt);
    },

    // Merdiven mantığı: N5'ten başlar, her geçilen basamak bir sonraki seviyeyi açar
    async startPlacement(userId) {
        const completedPlacement = await QuizAttempt.findOne({
            user: userId, type: 'placement', status: 'completed', passed: false
        });
        const unlockedCount = await Progress.countDocuments({ user: userId, isUnlocked: true });

        if (completedPlacement || unlockedCount > LEVELS.length - 1) {
            throw new AppError('Seviye belirleme sınavı tamamlanmış', 400);
        }

        // Basamak: son geçilen placement basamağının bir üstü, hiç yoksa N5
        const lastPassed = await QuizAttempt.find({
            user: userId, type: 'placement', status: 'completed', passed: true
        }).sort({ createdAt: -1 }).limit(1);

        let rung = 'N5';
        if (lastPassed.length > 0) {
            const idx = LEVELS.indexOf(lastPassed[0].jlptLevel);
            if (idx === LEVELS.length - 1) throw new AppError('Seviye belirleme sınavı tamamlanmış', 400);
            rung = LEVELS[idx + 1];
        } else if (unlockedCount > 1) {
            // Placement'a hiç girmemiş ama seviye açmış kullanıcı yerleştirme alamaz
            throw new AppError('Seviye belirleme sınavı yalnızca yeni hesaplar için', 400);
        }

        const existing = await QuizService.resolveInProgress(userId, 'placement');
        if (existing) return attemptResponse(existing);

        const questions = await QuizService.generateQuestions(rung, QUIZ_CONFIG.placement.questionCount, true);
        const attempt = await QuizAttempt.create({ user: userId, type: 'placement', jlptLevel: rung, questions });
        logEvent(userId, 'quiz_started', { type: 'placement', jlptLevel: rung });
        return attemptResponse(attempt);
    },

    async start(userId, { type, jlptLevel }) {
        if (type === 'placement') return QuizService.startPlacement(userId);
        if (type === 'levelup') return QuizService.startLevelup(userId, jlptLevel);
        throw new AppError('Invalid quiz type, use: placement, levelup', 400);
    },

    // Tasarımdaki soru→anlık geri bildirim akışı: her cevap anında puanlanır,
    // "Doğru!/Yanlış Cevap!" kartının verisi döner; son soru cevaplanınca
    // deneme otomatik sonuçlanır ve yanıta result eklenir.
    async answerQuestion(userId, attemptId, index, answer) {
        const attempt = await QuizAttempt.findOne({ _id: attemptId, user: userId });
        if (!attempt) throw new AppError('Quiz not found', 404);
        if (attempt.status !== 'in_progress') throw new AppError('Bu quiz zaten sonuçlanmış', 400);

        if (Date.now() > attempt.createdAt.getTime() + EXPIRY_MINUTES * 60 * 1000) {
            attempt.status = 'expired';
            await attempt.save();
            throw new AppError('Quiz süresi doldu, yeniden başlat', 400);
        }

        if (!Number.isInteger(index) || index < 0 || index >= attempt.questions.length) {
            throw new AppError(`index 0-${attempt.questions.length - 1} arası olmalı`, 400);
        }

        const q = attempt.questions[index];
        if (q.answeredAt) throw new AppError('Bu soru zaten cevaplandı', 400);

        // Şıklı soruda cevap index (number), yazma sorusunda metin (string);
        // boş/null gönderilen yanlış sayılır ("Şimdilik Geç")
        const isCorrect = q.format === 'typing'
            ? gradeTyping(answer, q.correctAnswers)
            : answer === q.correctIndex;

        q.yourAnswer = answer ?? null;
        q.isCorrect = isCorrect;
        q.answeredAt = new Date();

        // Geri bildirim kartındaki "駅 — istasyon" satırı
        const word = await Word.findById(q.word).select('kanji meaning');

        const answeredCount = attempt.questions.filter(x => x.answeredAt).length;
        const finished = answeredCount === attempt.questions.length;

        const response = {
            correct: isCorrect,
            word: word ? { kanji: word.kanji, meaning: word.meaning } : null,
            // Yanlışta "Cevap: ..." satırı için anahtar (soru artık cevaplandı, sızıntı değil)
            ...(q.format === 'typing'
                ? { correctAnswer: q.correctAnswers[0] }
                : { correctIndex: q.correctIndex }),
            answeredCount,
            totalQuestions: attempt.questions.length,
            finished
        };

        if (finished) {
            response.result = await QuizService.finalizeAttempt(userId, attempt);
        } else {
            await attempt.save();
        }

        return response;
    },

    // Tüm sorular cevaplanınca çağrılır: skor, geçme, kilit açma, cooldown,
    // placement merdiven kararı ve (bittiyse) sonuç özeti
    async finalizeAttempt(userId, attempt) {
        const config = QUIZ_CONFIG[attempt.type];
        const correctCount = attempt.questions.filter(q => q.isCorrect).length;
        const score = Math.round((correctCount / attempt.questions.length) * 100);
        const passed = score >= config.passThreshold;

        attempt.score = score;
        attempt.correctCount = correctCount;
        attempt.passed = passed;
        attempt.status = 'completed';
        attempt.completedAt = new Date();

        const response = {
            score,
            passed,
            passThreshold: config.passThreshold,
            correctCount,
            totalQuestions: attempt.questions.length
        };

        const currentIndex = LEVELS.indexOf(attempt.jlptLevel);
        const nextLevel = currentIndex < LEVELS.length - 1 ? LEVELS[currentIndex + 1] : null;

        if (passed && nextLevel) {
            try {
                const unlock = await ProgressService.unlockByQuiz(userId, attempt.jlptLevel);
                response.unlockedLevel = unlock.level;
            } catch (err) {
                // Zaten açıksa sorun değil, quiz sonucu geçerli
            }
        }

        if (attempt.type === 'levelup' && !passed) {
            const lastFailed = await QuizAttempt.findOne({
                user: userId, type: 'levelup', jlptLevel: attempt.jlptLevel,
                status: 'completed', passed: false, _id: { $ne: attempt._id }
            }).sort({ createdAt: -1 });

            attempt.failCount = (lastFailed?.failCount || 0) + 1;
            const days = COOLDOWN_DAYS[Math.min(attempt.failCount - 1, COOLDOWN_DAYS.length - 1)];
            attempt.nextAttemptAllowedAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

            response.failCount = attempt.failCount;
            response.cooldownDays = days;
            response.nextAttemptAllowedAt = attempt.nextAttemptAllowedAt;
        }

        if (attempt.type === 'placement') {
            // Geçtiyse ve üst basamak varsa merdiven devam eder; kaldıysa veya N1 geçildiyse biter
            response.nextRung = passed && nextLevel ? nextLevel : null;
            response.placementFinished = !response.nextRung;
        }

        await attempt.save();

        // "Seviyen Belirlendi" ekranı: tüm basamakların toplamları + belirlenen seviye
        // (attempt.save() sonrası — bu basamağın sayıları da toplama girsin)
        if (attempt.type === 'placement' && response.placementFinished) {
            response.summary = await QuizService.placementSummary(userId);
        }

        logEvent(userId, 'quiz_completed', {
            type: attempt.type,
            jlptLevel: attempt.jlptLevel,
            score,
            passed,
            unlockedLevel: response.unlockedLevel || null
        });

        return response;
    },

    // Placement merdiveninin tamamı üzerinden sonuç ekranı özeti.
    // Belirlenen seviye = en yüksek kilidi açık seviye (her geçilen basamak bir üstünü açar)
    async placementSummary(userId) {
        const attempts = await QuizAttempt.find({
            user: userId, type: 'placement', status: 'completed'
        });

        let totalQuestions = 0, correctCount = 0, durationMs = 0;
        for (const a of attempts) {
            totalQuestions += a.questions.length;
            correctCount += a.correctCount || 0;
            if (a.completedAt) durationMs += a.completedAt - a.createdAt;
        }

        const unlocked = await Progress.find({ user: userId, isUnlocked: true });
        const highestIdx = unlocked.reduce((max, p) => Math.max(max, LEVELS.indexOf(p.jlptLevel)), 0);

        return {
            determinedLevel: LEVELS[highestIdx],
            totalQuestions,
            correctCount,
            wrongCount: totalQuestions - correctCount,
            durationSeconds: Math.round(durationMs / 1000)
        };
    },

    // UI için: hangi seviyeye sınav açık, cooldown ne zaman bitiyor, placement hakkı var mı
    async getStatus(userId) {
        const progress = await Progress.find({ user: userId });
        const unlockedMap = {};
        progress.forEach(p => { unlockedMap[p.jlptLevel] = p.isUnlocked; });

        const levels = {};
        for (let i = 0; i < LEVELS.length - 1; i++) {
            const level = LEVELS[i];
            const nextUnlocked = unlockedMap[LEVELS[i + 1]] || false;

            const lastFailed = await QuizAttempt.findOne({
                user: userId, type: 'levelup', jlptLevel: level, status: 'completed', passed: false
            }).sort({ createdAt: -1 });

            const onCooldown = !!(lastFailed?.nextAttemptAllowedAt && lastFailed.nextAttemptAllowedAt > new Date());

            levels[level] = {
                unlocked: unlockedMap[level] || false,
                nextLevelUnlocked: nextUnlocked,
                canAttempt: (unlockedMap[level] || false) && !nextUnlocked && !onCooldown,
                failCount: lastFailed?.failCount || 0,
                nextAttemptAllowedAt: onCooldown ? lastFailed.nextAttemptAllowedAt : null
            };
        }

        const placementDone = await QuizAttempt.exists({
            user: userId, type: 'placement', status: 'completed', passed: false
        });
        const passedN1 = await QuizAttempt.exists({
            user: userId, type: 'placement', status: 'completed', passed: true, jlptLevel: 'N1'
        });
        const unlockedCount = progress.filter(p => p.isUnlocked).length;
        const hasPlacementHistory = await QuizAttempt.exists({ user: userId, type: 'placement' });

        return {
            placementAvailable: !placementDone && !passedN1 && (unlockedCount <= 1 || !!hasPlacementHistory),
            levels
        };
    }
};

module.exports = QuizService;
