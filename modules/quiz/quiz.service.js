const QuizAttempt = require('../../models/QuizAttempt');
const Word = require('../../models/Word');
const Progress = require('../../models/Progress');
const User = require('../../models/User');
const AppError = require('../../utils/AppError');
const ProgressService = require('../progress/progress.service');
const logEvent = require('../../utils/event.util');
const { gradeTyping, wordAnswerVariants, meaningIn } = require('../../utils/answer.util');

// Soruların dili kullanıcının arayüz dilidir (User.preferences.language)
const userLang = async (userId) =>
    (await User.findById(userId).select('preferences.language'))?.preferences?.language || 'tr';

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

// Seviye Tespit Sınavı: TEK denemede beş seviyeden 40 soru. Dağılım tasarımın
// sınav önü ekranındaki listeyle birebir (N1 ve N2 ağırlıklı: üst seviyeleri
// ayırt etmek daha çok kanıt ister, N5'te birkaç soru yeter).
const PLACEMENT_DISTRIBUTION = { N5: 6, N4: 6, N3: 8, N2: 10, N1: 10 };
const PLACEMENT_TOTAL = Object.values(PLACEMENT_DISTRIBUTION).reduce((a, b) => a + b, 0);

// Seviye belirleme eşiği: bir seviyenin sorularının bu oranını doğru yapan
// kullanıcı o seviyededir (bkz. determineLevel).
const LEVEL_PASS_RATIO = 0.6;

// Sınav tekrarı: SABİT 14 gün. Artan cooldown (eski levelup'taki 3/7/14)
// bilerek kullanılmadı — orada "başarısızlık" diye bir kavram vardı, burada
// yok: sınav geç/kal vermiyor, ölçüm veriyor. Ayrıca tekrar girmenin ödülü
// tek seferlik (açılan kilit bir daha kapanmıyor), yani cezalandırılacak bir
// "tekrar tekrar deneme" davranışı da yok.
const RETAKE_COOLDOWN_DAYS = 14;

// Soru başına süre. Sunucu BU SÜREYİ DENETLEMEZ — sayacı istemci tutar, süre
// dolunca boş cevap gönderir (boş = yanlış). Sunucu tarafı denetim, ağ
// gecikmesinde haksız "süren doldu" üretirdi ve burada hile motivasyonu yok:
// kullanıcı kendi seviyesini belirliyor, yüksek çıkmak ona zor ders getirir.
const SECONDS_PER_QUESTION = 20;

const EXPIRY_MINUTES = 30;

// "Seviyen Belirlendi" ekranındaki tek cümlelik seviye açıklaması
const LEVEL_DESCRIPTIONS = {
    N5: 'Temel selamlaşmaları ve günlük basit kelimeleri tanıyabilecek düzeydesin.',
    N4: 'Günlük konuşmaları ve temel kalıpları anlayabilecek düzeydesin.',
    N3: 'Günlük hayatta geçen konuşmaların çoğunu takip edebilecek düzeydesin.',
    N2: 'Gündelik konuların yanında haber ve makale diline de hakimsin.',
    N1: 'Soyut ve akademik metinleri anlayabilecek ileri düzeydesin.'
};

const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

// Client'a cevap anahtarı sızdırmadan soru listesi (typing sorusunun şıkkı
// yoktur). jlptLevel sızıntı değil, ekranda zaten rozet olarak gösteriliyor.
// answeredToday benzeri bir alan gerekmiyor: yarım sınav devam ederse istemci
// `answered` ile nerede kaldığını görür.
const sanitizeQuestions = (questions) =>
    questions.map((q, index) => ({
        index,
        jlptLevel: q.jlptLevel,   // soru başlığındaki "N4" rozeti
        format: q.format,
        prompt: q.prompt,
        answered: Boolean(q.answeredAt),
        ...(q.format !== 'typing' && { choices: q.choices })
    }));

const attemptResponse = (attempt) => ({
    quizId: attempt._id,
    type: attempt.type,
    expiresAt: new Date(attempt.createdAt.getTime() + EXPIRY_MINUTES * 60 * 1000),
    secondsPerQuestion: SECONDS_PER_QUESTION,
    totalQuestions: attempt.questions.length,
    answeredCount: attempt.questions.filter(q => q.answeredAt).length,
    questions: sanitizeQuestions(attempt.questions)
});

const QuizService = {
    // Bir seviyeden `count` soruluk taze set üretir. Dört format da karışıma
    // girer: şıklı (meaning/reverse/reading), yazma (typing), boşluk doldurma
    // (fillblank) ve görselli (image) — son ikisi yalnızca verisi olan kelimede.
    //
    // Hedefler count'un iki katı çekilir: çeldirici bulunamayan kelimeler
    // eleniyor (aşağıda `continue`), tam count kadar çekseydik sınav eksik
    // soruyla çıkardı.
    // lang: anlam şıkları, "anlam → kelime" sorusunun metni ve yazma sorusunun
    // "doğru cevap" satırı bu dilde üretilir. Eskiden şıklar `meaning`
    // (İngilizce) alanından geliyordu — Türk kullanıcı da İngilizce şık
    // görüyordu (26.09.2026 incelemesi).
    async generateQuestions(jlptLevel, count, lang = 'tr') {
        const targets = await Word.aggregate([
            { $match: { jlptLevel, isCore: true } },
            { $sample: { size: count * 2 } }
        ]);

        if (targets.length < count) {
            throw new AppError('Bu seviyede quiz için yeterli kelime yok', 400);
        }

        // Çeldirici havuzu: aynı seviyenin tamamı. Hedef kelimeleri havuzdan
        // ÇIKARMIYORUZ — dar seviyelerde (ya da count büyükken) targets havuzun
        // tamamını yutup çeldirici bırakmıyordu ve tek bir soru bile
        // üretilemiyordu. Sorunun kendi cevabı zaten `seen` ile eleniyor.
        const pool = await Word.aggregate([
            { $match: { jlptLevel, isCore: true } },
            { $sample: { size: 80 } }
        ]);

        const questions = [];
        for (const word of targets) {
            if (questions.length === count) break;

            const formats = ['meaning', 'reverse'];
            if (word.kanji !== word.romaji) formats.push('reading'); // kana-only kelimede okunuş sorusu anlamsız
            formats.push('typing');
            // İçerik formatları yalnızca verisi olan kelimede seçilebilir
            if (word.example?.includes(word.kanji)) formats.push('fillblank');
            if (word.imageUrl) formats.push('image');
            const format = formats[Math.floor(Math.random() * formats.length)];

            if (format === 'typing') {
                questions.push({
                    word: word._id,
                    jlptLevel,
                    format,
                    // Kelime gösterilir, anlamı yazılır; ses de kelimeyi söyler (cevabı sızdırmaz)
                    prompt: { kanji: word.kanji, romaji: word.romaji, audioUrl: word.audioUrl },
                    correctAnswers: wordAnswerVariants(word, lang)
                });
                continue;
            }

            // fillblank/image cevabı kelimenin kendisidir (kanji şıkları);
            // ses bu ikisinde YOK — kelimeyi seslendirmek cevabı söylemek olur
            const valueOf = (w) => (format === 'meaning') ? meaningIn(w, lang)
                : (format === 'reading') ? w.romaji
                : w.kanji; // reverse | fillblank | image
            const correct = valueOf(word);

            // Aynı tür öncelikli, benzersiz metinli 3 çeldirici
            const sameType = pool.filter(p => p.type === word.type);
            const otherType = pool.filter(p => p.type !== word.type);
            const seen = new Set([correct]);
            const distractors = [];
            for (const cand of [...shuffle(sameType), ...shuffle(otherType)]) {
                const val = valueOf(cand);
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
                format === 'reverse' ? { meaning: meaningIn(word, lang) } :
                format === 'fillblank' ? { sentence: word.example.replaceAll(word.kanji, '____') } :
                format === 'image' ? { imageUrl: word.imageUrl } :
                // reading: ses YOK — kelimeyi seslendirmek okunuşu, yani doğru
                // şıkkı söylemek olur
                { kanji: word.kanji }; // reading

            questions.push({
                word: word._id,
                jlptLevel,
                format,
                prompt,
                choices,
                correctIndex: choices.indexOf(correct)
            });
        }

        if (questions.length < count) {
            throw new AppError('Bu seviyede quiz için yeterli kelime yok', 400);
        }
        return questions;
    },

    // Sınavın tamamı: beş seviyeden PLACEMENT_DISTRIBUTION kadar soru, kolaydan
    // zora (N5 → N1). Sıra bilerek karıştırılmıyor — tasarımda her soruda seviye
    // rozeti var ve zorluğun kademeli artması kullanıcıyı ilk soruda duvara
    // çarptırmıyor.
    async generatePlacementQuestions(lang = 'tr') {
        const questions = [];
        for (const level of LEVELS) {
            questions.push(...await QuizService.generateQuestions(level, PLACEMENT_DISTRIBUTION[level], lang));
        }
        return questions;
    },

    // Seviye belirleme: EN YÜKSEKTEN aşağı taranır, bir seviyenin sorularının
    // LEVEL_PASS_RATIO'sunu doğru yapan kullanıcı o seviyededir. Hiçbiri
    // tutmazsa N5 (sınavın sonucu hep bir seviyedir, "başarısız" yoktur).
    //
    // Yukarıdan taramanın sebebi: N3'ü bilen biri N5/N4 sorularını da bilir,
    // aşağıdan tarasaydık ilk eşiği geçtiği yerde durup seviyeyi düşük
    // gösterirdik. Tek bir şanslı N1 doğrusu da seviyeyi şişiremiyor, çünkü
    // ölçüt tek soru değil o seviyenin ORANI.
    determineLevel(questions) {
        for (const level of [...LEVELS].reverse()) {
            const inLevel = questions.filter(q => q.jlptLevel === level);
            if (!inLevel.length) continue;
            const correct = inLevel.filter(q => q.isCorrect).length;
            if (correct / inLevel.length >= LEVEL_PASS_RATIO) return level;
        }
        return LEVELS[0];
    },

    // Süresi geçmiş in_progress denemeyi expire eder, geçerliyse döndürür.
    //
    // DİKKAT: yarım kalan deneme artık DEVAM ETTİRİLMİYOR (eskiden startPlacement
    // onu geri döndürüyordu). Tasarım "Çık → sınavın geçersiz sayılır" diyor;
    // devam ettirmek o sözü tutmamak olurdu. Terk etme akışı abandonAttempt'te,
    // burası yalnızca zaman aşımına bakar.
    async resolveInProgress(userId) {
        const attempt = await QuizAttempt.findOne({
            user: userId, type: 'placement', status: 'in_progress'
        }).sort({ createdAt: -1 });
        if (!attempt) return null;

        if (Date.now() > attempt.createdAt.getTime() + EXPIRY_MINUTES * 60 * 1000) {
            attempt.status = 'expired';
            await attempt.save();
            return null;
        }
        return attempt;
    },

    // "Çıkmak İçin Emin Misiniz? → Çık": yarım sınav geçersiz sayılır, sonraki
    // girişte baştan başlanır. Cooldown YAKMAZ — kullanıcı bir ölçüm almadı,
    // 14 günü bir sonuç için bekletiyoruz, terk için değil.
    async abandonAttempt(userId, attemptId) {
        const attempt = await QuizAttempt.findOne({ _id: attemptId, user: userId });
        if (!attempt) throw new AppError('Quiz not found', 404);
        if (attempt.status !== 'in_progress') {
            throw new AppError('Bu quiz zaten sonuçlanmış', 400);
        }

        attempt.status = 'abandoned';
        await attempt.save();
        logEvent(userId, 'quiz_abandoned', {
            answeredCount: attempt.questions.filter(q => q.answeredAt).length,
            totalQuestions: attempt.questions.length
        });
        return { abandoned: true };
    },

    // Sınav hakkı: hiç girmemişse serbest, girmişse son TAMAMLANAN sınavın
    // üstünden RETAKE_COOLDOWN_DAYS geçmiş olmalı. Terk edilen/süresi dolan
    // denemeler hak yakmaz.
    async placementAvailability(userId) {
        const lastCompleted = await QuizAttempt.findOne({
            user: userId, type: 'placement', status: 'completed'
        }).sort({ completedAt: -1 });

        if (!lastCompleted) return { available: true, nextAllowedAt: null, hasTaken: false };

        const nextAllowedAt = new Date(
            (lastCompleted.completedAt || lastCompleted.createdAt).getTime()
            + RETAKE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
        );
        return { available: nextAllowedAt <= new Date(), nextAllowedAt, hasTaken: true };
    },

    async startPlacement(userId) {
        const { available, nextAllowedAt } = await QuizService.placementAvailability(userId);
        if (!available) {
            const err = new AppError(
                `Seviye tespit sınavına ${RETAKE_COOLDOWN_DAYS} günde bir girebilirsin`, 403
            );
            err.nextAttemptAllowedAt = nextAllowedAt;
            throw err;
        }

        // Süresi dolmamış yarım deneme varsa yenisini açmıyoruz: aynı anda iki
        // açık sınav, hangisinin cevabının sayılacağını belirsizleştirirdi.
        // Kullanıcı ya onu bitirir ya abandon eder.
        const existing = await QuizService.resolveInProgress(userId);
        if (existing) return attemptResponse(existing);

        const questions = await QuizService.generatePlacementQuestions(await userLang(userId));
        const attempt = await QuizAttempt.create({ user: userId, type: 'placement', questions });
        logEvent(userId, 'quiz_started', { type: 'placement', totalQuestions: questions.length });
        return attemptResponse(attempt);
    },

    async start(userId, { type = 'placement' } = {}) {
        if (type !== 'placement') throw new AppError('Invalid quiz type, use: placement', 400);
        return QuizService.startPlacement(userId);
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
        const [word, lang] = await Promise.all([
            Word.findById(q.word).select('kanji meaning meaningTr'),
            userLang(userId)
        ]);

        const answeredCount = attempt.questions.filter(x => x.answeredAt).length;
        const finished = answeredCount === attempt.questions.length;

        const response = {
            correct: isCorrect,
            word: word ? { kanji: word.kanji, meaning: meaningIn(word, lang) } : null,
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

    // Tüm sorular cevaplanınca çağrılır: seviye belirleme, kilit açma ve
    // "Seviyen Belirlendi" ekranının verisi. Geçme/kalma YOK — sınavın çıktısı
    // bir seviyedir, bir yargı değil.
    async finalizeAttempt(userId, attempt) {
        const correctCount = attempt.questions.filter(q => q.isCorrect).length;
        const score = Math.round((correctCount / attempt.questions.length) * 100);
        const determinedLevel = QuizService.determineLevel(attempt.questions);

        attempt.score = score;
        attempt.correctCount = correctCount;
        attempt.determinedLevel = determinedLevel;
        attempt.status = 'completed';
        attempt.completedAt = new Date();
        await attempt.save();

        // Belirlenen seviyeye KADAR olan her seviye açılır: N3 çıkan kullanıcı
        // N5 ve N4'ü de biliyor demektir, onları tekrar hak etmesi anlamsız.
        // Kilitler yalnızca AÇILIR — tekrar sınava girip düşük sonuç alan
        // kullanıcının önceden hak ettiği seviyeler geri kapanmaz.
        const unlockedNow = [];
        for (const level of LEVELS.slice(0, LEVELS.indexOf(determinedLevel) + 1)) {
            const progress = await Progress.findOne({ user: userId, jlptLevel: level });
            if (progress && !progress.isUnlocked) {
                progress.isUnlocked = true;
                progress.unlockedAt = new Date();
                progress.unlockedBy = 'quiz';
                await progress.save();
                unlockedNow.push(level);
            }
        }

        // Sınav sonucu doğrudan çalışılan seviye olur: STS'yi N3'te bitiren
        // kullanıcı ilk dersinde N5 kelimeleriyle karşılaşmamalı. Ayarlardan
        // her zaman geri inebilir. Seviye KİLİDİ açılınca activeLevel normalde
        // kendiliğinden taşınmaz ("Şimdi Geç" onayı beklenir) — buradaki
        // istisnanın sebebi STS'nin amacının zaten yerleştirme olması.
        await ProgressService.setActiveLevel(userId, determinedLevel);

        const durationSeconds = Math.round(
            (attempt.completedAt - attempt.createdAt) / 1000
        );

        const response = {
            // "Seviyen Belirlendi" ekranının tamamı
            determinedLevel,
            levelLabel: ProgressService.LEVEL_LABELS[determinedLevel],
            levelDescription: LEVEL_DESCRIPTIONS[determinedLevel],
            totalQuestions: attempt.questions.length,
            correctCount,
            wrongCount: attempt.questions.length - correctCount, // boş geçilenler dahil
            score,
            durationSeconds,
            unlockedLevels: unlockedNow,
            // Seviye başına doğru/toplam — sonuç ekranında gösterilmiyor ama
            // "neden N4 çıktım?" sorusunun cevabı burada; istemci isterse açar.
            byLevel: LEVELS.map(level => {
                const inLevel = attempt.questions.filter(q => q.jlptLevel === level);
                return {
                    jlptLevel: level,
                    total: inLevel.length,
                    correct: inLevel.filter(q => q.isCorrect).length
                };
            })
        };

        logEvent(userId, 'quiz_completed', {
            type: attempt.type,
            determinedLevel,
            score,
            unlockedLevels: unlockedNow
        });

        return response;
    },

    // "Seviyeni Öğrenelim Mi?" modalındaki "Daha Sonra". Sınavı iptal etmez,
    // yalnızca modalın bir daha açılmamasını sağlar.
    async deferPlacement(userId) {
        await User.findByIdAndUpdate(userId, { placementDeferredAt: new Date() });
        return { deferred: true };
    },

    // Anasayfada modal çıkacak mı? Modalı yalnızca iki şey kalıcı olarak
    // kapatır: TAMAMLANMIŞ bir sınav ya da kullanıcının "Daha Sonra" demesi.
    //
    // Eskiden HERHANGİ bir deneme kaydı (terk edilmiş/süresi dolmuş dahil)
    // modalı sonsuza kadar kapatıyordu: sınava girip 10. soruda çıkan kullanıcı
    // bir ölçüm almadığı hâlde bir daha hiç davet edilmiyordu. Oysa terk etmek
    // zaten hak yakmıyor (bkz. placementAvailability) — iki kural ayrışmıştı.
    async shouldPromptPlacement(userId, userDoc = null) {
        const user = userDoc || await User.findById(userId).select('placementDeferredAt');
        if (user?.placementDeferredAt) return false;
        return !(await QuizAttempt.exists({ user: userId, type: 'placement', status: 'completed' }));
    },

    // Sınav önü ekranı (Ayarlar > "Seviye Tespit Sınavına Gir") ve anasayfa
    // modalı bunu okur. Ayarlardaki satır ARTIK KOŞULSUZ görünür — sınav
    // tekrar girilebilir olduğu için "gizle/pasifleştir" durumu kalmadı,
    // yalnızca cooldown'daysa geri sayım gösterilir.
    async getStatus(userId) {
        const { available, nextAllowedAt, hasTaken } = await QuizService.placementAvailability(userId);
        const inProgress = await QuizService.resolveInProgress(userId);

        return {
            placementAvailable: available,
            nextAttemptAllowedAt: available ? null : nextAllowedAt,
            hasTakenPlacement: hasTaken,
            retakeCooldownDays: RETAKE_COOLDOWN_DAYS,
            // Sınav önü ekranındaki seviye listesi ("N1 • Uzman — 10 Soru")
            totalQuestions: PLACEMENT_TOTAL,
            secondsPerQuestion: SECONDS_PER_QUESTION,
            distribution: [...LEVELS].reverse().map(level => ({
                jlptLevel: level,
                label: ProgressService.LEVEL_LABELS[level],
                questionCount: PLACEMENT_DISTRIBUTION[level]
            })),
            // Yarım kalmış sınav: istemci "devam et mi, baştan mı" diye sormaz —
            // bu sınav kaldığı yerden sürer, ama kullanıcı çıkarsa geçersizdir.
            inProgressQuizId: inProgress?._id || null
        };
    }
};

module.exports = QuizService;
