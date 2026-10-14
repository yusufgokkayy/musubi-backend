const QuizAttempt = require('../../models/QuizAttempt');
const Word = require('../../models/Word');
const Progress = require('../../models/Progress');
const User = require('../../models/User');
const AppError = require('../../utils/AppError');
const ProgressService = require('../progress/progress.service');
const logEvent = require('../../utils/event.util');
const { gradeTyping, wordAnswerVariants, meaningIn, normalizeAnswer } = require('../../utils/answer.util');
const { readingMutations } = require('../../utils/kana.util');
const storage = require('../../config/storage');

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

// ——— SORU KARIŞIMI (13.10.2026) ———
//
// JLPT'nin kelime bölümünün (文字・語彙) bizim veriyle kurulabilen üç soru tipi
// + uygulamanın öğrettiği şeyin kendisi (Türkçe anlam). Hepsi 4 şıklıdır:
//
//   meaning   → kelime (kanji + kana) gösterilir, ANLAMI seçilir
//   reading   → kanji gösterilir, OKUNUŞU seçilir            (漢字読み)
//   spelling  → okunuş (kana) gösterilir, YAZILIŞI seçilir    (表記)
//   fillblank → cümledeki boşluğa uyan kelime seçilir         (文脈規定)
//
// Eski karışımdan çıkanlar ve nedenleri:
//   typing  — 20 saniyede Türkçe yazmak bilgiden çok klavye hızını ve eş
//             anlamlı eşleşmesini ölçüyordu; derslerde zaten var.
//   reverse — "anlam → kelime seç" meaning ile aynı bilgiyi ölçüyordu.
//   image   — yalnızca somut isimler çizilebilir, 5816 kelimeye görsel yok.
// Bu üçü artık ÜRETİLMEZ ama şemada ve puanlamada durur: yarım kalmış eski bir
// denemenin soruları cevaplanabilmeli.
const FORMAT_MIX = { meaning: 0.5, reading: 0.2, spelling: 0.15, fillblank: 0.15 };

// count soruyu karışıma böler (en büyük kalan yöntemi): 6 → 3/1/1/1,
// 8 → 4/2/1/1, 10 → 5/2/2/1. Oranlar seviye başına uygulanır ki her seviyenin
// soruları aynı çeşitlilikte olsun.
const allocateFormats = (count) => {
    const parts = Object.entries(FORMAT_MIX).map(([format, share]) => {
        const exact = count * share;
        return { format, n: Math.floor(exact), rest: exact - Math.floor(exact) };
    });
    let left = count - parts.reduce((sum, p) => sum + p.n, 0);
    for (const p of [...parts].sort((a, b) => b.rest - a.rest)) {
        if (left-- <= 0) break;
        p.n += 1;
    }
    return parts.flatMap(p => Array(p.n).fill(p.format));
};

const KANJI_RE = /[㐀-䶿一-鿿]/;
const hasKanji = (w) => KANJI_RE.test(w.kanji || '');

// Kelimenin "kalıbı": kanjiler K'ye çevrilir, okurigana olduğu gibi kalır
// (努める → Kめる, 家族 → KK). Aynı kalıptaki kelimeler birbirinin inandırıcı
// yanlış şıkkıdır; kalıbı farklı olan şık bakmadan elenir.
const shapeOf = (w) => [...w.kanji].map(c => (KANJI_RE.test(c) ? 'K' : c)).join('');

// Okunuşu kanjinin karşıladığı kısım ile ekranda zaten yazan okurigana'ya
// ayırır: 食べる / たべる → { prefix: '', core: 'た', suffix: 'べる' }.
// Okunuş sorusunda yalnızca `core` bozulur — okurigana soruda göründüğü için
// onu değiştiren şık (たへる) kendini ele verir.
const splitOkurigana = (kanji, kana) => {
    const chars = [...kanji];
    let start = 0;
    while (start < chars.length && !KANJI_RE.test(chars[start])) start++;
    let end = chars.length;
    while (end > start && !KANJI_RE.test(chars[end - 1])) end--;
    const prefix = chars.slice(0, start).join('');
    const suffix = chars.slice(end).join('');
    return kana.startsWith(prefix) && kana.endsWith(suffix) && kana.length > prefix.length + suffix.length
        ? { prefix, core: kana.slice(prefix.length, kana.length - suffix.length), suffix }
        : { prefix: '', core: kana, suffix: '' };
};

// Boşluk doldurma yalnızca içerik kelimelerinde sorulur. İşlev kelimelerinde
// (この / あの / どの, と / や …) aynı türden her şık boşluğa dilbilgisi olarak
// oturur; "____音楽をよく聞きますか" sorusunun tek doğru cevabı olmaz.
const FILLBLANK_TYPES = new Set(['isim', 'fiil', 'i-sıfat', 'na-sıfat', 'zarf', 'kalıp']);
const BLANK = '____';
// Örnek cümledeki hedef kelime işareti: 東京**駅**で会いましょう。
const BOLD = /\*\*(.+?)\*\*/;
const audioUrlOf = (word) => (word.audioKey ? storage.publicUrl(word.audioKey) : undefined);

// Boşluk doldurma cümlesi. Hedef kelime cümlede ** ile işaretlidir; işaretli
// parça kelimenin SÖZLÜK biçimi değilse (食べ**ました**) soru kurulmaz —
// şıklar sözlük biçimindedir, çekimli boşluğa oturmazlar.
//
// Eskiden cümle `example.replaceAll(kanji, '____')` ile kuruluyordu ve veri
// setindeki her cümle ** taşıdığı için istemciye "**____**はどこで…" gidiyordu
// (13.10.2026 bulgusu). Furigana da artık ayrı alanla gider: tasarımdaki
// soru kartı diğer kanjilerin okunuşunu gösteriyor.
const buildBlank = (word) => {
    const example = word.example || '';
    const marked = BOLD.exec(example);
    let sentence;
    if (marked) {
        if (marked[1] !== word.kanji) return null;
        sentence = example.replace(BOLD, BLANK).replaceAll('**', '');
    } else if (example.includes(word.kanji)) {
        // İşaretsiz (eski) kayıt
        sentence = example.replace(word.kanji, BLANK);
    } else {
        return null;
    }
    // Kelime cümlede ikinci kez geçiyorsa cevap ekranda yazıyor demektir
    if (sentence.includes(word.kanji)) return null;

    const furigana = word.exampleFurigana || '';
    const markedF = BOLD.exec(furigana);
    // İşaretli parçanın okunuşu ([えき]) atılınca kelimenin kendisi kalmalı
    const sentenceFurigana = markedF && markedF[1].replace(/\[[^\]]*\]/g, '') === word.kanji
        ? furigana.replace(BOLD, BLANK).replaceAll('**', '')
        : undefined;

    return { sentence, ...(sentenceFurigana && { sentenceFurigana }) };
};

// Aday kelimelerden `valueOf` ile 3 benzersiz yanlış şık seçer. `tiers`
// öncelik sırasıdır (ör. önce aynı türden kelimeler); her katman kendi içinde
// karıştırılır. `allow` false dönen aday hiçbir katmandan alınmaz.
const pickDistractors = (tiers, valueOf, correct, allow = () => true, need = 3) => {
    const seen = new Set([correct]);
    const picked = [];
    if (need <= 0) return picked;
    for (const tier of tiers) {
        for (const cand of shuffle(tier)) {
            const value = valueOf(cand);
            if (!value || seen.has(value) || !allow(cand)) continue;
            seen.add(value);
            picked.push(value);
            if (picked.length === need) return picked;
        }
    }
    return null;
};

// Boş alanlar soruya hiç yazılmaz (sesi olmayan kelimede audioUrl: null
// dönmesin — Word yanıtlarındaki "boş alan yanıtta bulunmaz" kuralı)
const compact = (obj) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

// Tek kelimeden tek soru; kelime bu formata uygun değilse ya da 3 yanlış şık
// bulunamıyorsa null.
const buildQuestion = (word, format, levelWords, lang) => {
    const others = levelWords.filter(w => w !== word);
    const sameType = others.filter(w => w.type === word.type);
    const otherType = others.filter(w => w.type !== word.type);
    let prompt, correct, distractors;

    if (format === 'meaning') {
        correct = meaningIn(word, lang);
        // Eş anlamlı eleme: Türkçe anlamlar sık çakışır ("büyük" / "büyük, iri").
        // Doğru cevabın kabul edilen HERHANGİ bir varyantını taşıyan aday şık
        // olursa soruda iki doğru cevap olurdu.
        const accepted = new Set(wordAnswerVariants(word, lang).map(normalizeAnswer));
        const isSynonym = (cand) =>
            wordAnswerVariants(cand, lang).some(v => accepted.has(normalizeAnswer(v)));
        distractors = pickDistractors(
            [sameType, otherType], (w) => meaningIn(w, lang), correct, (w) => !isSynonym(w)
        );
        // Ses kelimeyi okur; okunuş (kana) zaten ekranda, anlamı sızdırmaz
        prompt = {
            kanji: word.kanji, kana: word.kana, romaji: word.romaji, type: word.type,
            isKana: !hasKanji(word), audioUrl: audioUrlOf(word)
        };
    } else if (format === 'reading') {
        // Kana ile yazılan kelimenin "okunuşu" sorulmaz
        if (!hasKanji(word) || !word.kana) return null;
        correct = word.kana;
        // Aynı yazımın veritabanındaki başka bir okunuşu yanlış şık olamaz (今日: きょう / こんにち)
        const valid = new Set(levelWords.filter(w => w.kanji === word.kanji).map(w => w.kana));
        const { prefix, core, suffix } = splitOkurigana(word.kanji, word.kana);
        const groups = Object.values(readingMutations(core))
            .map(group => shuffle(group.map(v => prefix + v + suffix).filter(v => !valid.has(v))));
        // Türler arasında dönerek seç: üç şık da aynı bozulma türünden olmasın
        const mutated = [];
        for (let round = 0; mutated.length < 3 && groups.some(g => g.length > round); round++) {
            for (const g of groups) {
                if (g[round] && !mutated.includes(g[round]) && mutated.length < 3) mutated.push(g[round]);
            }
        }
        // Kısa kelimede (目 → め) yeterli bozulma çıkmaz; kalanı başka
        // kelimelerin okunuşuyla tamamlanır. Önce aynı okurigana ile biten ve
        // benzer uzunlukta olanlar (貰う için 洗う, 習う): okurigana'sı tutmayan
        // şık soruya bakılarak elenir.
        const readable = others.filter(w => hasKanji(w) && w.kana);
        const similar = readable.filter(w =>
            Math.abs([...w.kana].length - [...word.kana].length) <= 1);
        const rest = pickDistractors(
            [
                similar.filter(w => w.type === word.type && suffix && w.kana.endsWith(suffix)),
                similar.filter(w => w.type === word.type),
                similar,
                readable
            ],
            (w) => w.kana, correct,
            (w) => !valid.has(w.kana) && !mutated.includes(w.kana), 3 - mutated.length
        );
        if (rest === null) return null;
        distractors = [...mutated, ...rest];
        // Ses YOK: kelimeyi seslendirmek okunuşu, yani doğru şıkkı söylerdi
        prompt = { kanji: word.kanji, type: word.type };
    } else if (format === 'spelling') {
        if (!hasKanji(word) || !word.kana) return null;
        correct = word.kanji;
        const chars = [...word.kanji].filter(c => KANJI_RE.test(c));
        const shape = shapeOf(word);
        const written = others.filter(hasKanji);
        const sameShape = written.filter(w => shapeOf(w) === shape);
        const sharesKanji = (w) => chars.some(c => w.kanji.includes(c));
        distractors = pickDistractors(
            [
                // En zor çeldiriciler: aynı kalıp + ortak kanji (電車 için 電話, 電気)
                sameShape.filter(sharesKanji),
                sameShape.filter(w => w.type === word.type),
                sameShape,
                written.filter(sharesKanji),
                written.filter(w => w.type === word.type),
                written
            ],
            (w) => w.kanji, correct,
            // Eş sesli kelime (紙 / 髪 / 神 → かみ) de doğru cevap olurdu
            (w) => w.kana !== word.kana
        );
        // Ses okunuşu söyler — o zaten ekranda yazıyor, yazılışı sızdırmaz
        prompt = { kana: word.kana, type: word.type, audioUrl: audioUrlOf(word) };
    } else if (format === 'fillblank') {
        const blank = FILLBLANK_TYPES.has(word.type) ? buildBlank(word) : null;
        if (!blank) return null;
        correct = word.kanji;
        // Cümlede zaten geçen kelime şık olmasın
        distractors = pickDistractors(
            [sameType, otherType], (w) => w.kanji, correct, (w) => !blank.sentence.includes(w.kanji)
        );
        // Ses YOK: kelimeyi seslendirmek cevabı söylerdi
        prompt = blank;
    } else {
        return null;
    }

    if (!distractors || distractors.length < 3) return null;
    const choices = shuffle([correct, ...distractors]);
    return {
        word: word._id,
        jlptLevel: word.jlptLevel,
        format,
        prompt: compact(prompt),
        choices,
        correctIndex: choices.indexOf(correct)
    };
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
    // Bir seviyeden `count` soruluk taze set üretir (karışım: FORMAT_MIX).
    //
    // KELİME SEÇİMİ: seviye müfredat sırasına (frequencyRank) göre `count`
    // eşit dilime bölünür ve her dilimden bir kelime alınır. Eskiden kelimeler
    // tamamen rastgele çekiliyordu; 6 soruluk N5 sınavı tesadüfen hep ilk
    // derslerin kelimelerine düşebiliyor, seviyenin sonunu hiç yoklamıyordu.
    // Dilimleme her sınavın seviyeyi baştan sona örneklemesini sağlar.
    //
    // Bir dilimde istenen formata uygun kelime yoksa (kana ile yazılan kelimede
    // okunuş sorusu, örnek cümlesi uymayan kelimede boşluk doldurma) aynı
    // dilimden anlam sorusu, o da olmazsa seviyenin herhangi bir yerinden anlam
    // sorusu kurulur — sınav hiçbir zaman eksik soruyla çıkmaz.
    //
    // lang: anlam şıkları kullanıcının arayüz dilinde üretilir.
    async generateQuestions(jlptLevel, count, lang = 'tr') {
        const words = await Word.find({ jlptLevel, isCore: true })
            .sort({ frequencyRank: 1, _id: 1 })
            .select('kanji kana romaji meaning meaningTr meaningTrAccepted meaningEnAccepted type jlptLevel example exampleFurigana audioKey')
            .lean();

        if (words.length < count) {
            throw new AppError('Bu seviyede quiz için yeterli kelime yok', 400);
        }

        const formats = shuffle(allocateFormats(count));
        const used = new Set();
        const firstQuestion = (candidates, format) => {
            for (const word of shuffle(candidates)) {
                if (used.has(word)) continue;
                const question = buildQuestion(word, format, words, lang);
                if (question) {
                    used.add(word);
                    return question;
                }
            }
            return null;
        };

        const questions = [];
        for (let i = 0; i < count; i++) {
            const slice = words.slice(
                Math.floor(i * words.length / count),
                Math.floor((i + 1) * words.length / count)
            );
            const question = firstQuestion(slice, formats[i])
                || firstQuestion(slice, 'meaning')
                || firstQuestion(words, 'meaning');
            if (!question) throw new AppError('Bu seviyede quiz için yeterli kelime yok', 400);
            questions.push(question);
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
            Word.findById(q.word).select('kanji kana meaning meaningTr'),
            userLang(userId)
        ]);

        const answeredCount = attempt.questions.filter(x => x.answeredAt).length;
        const finished = answeredCount === attempt.questions.length;

        const response = {
            correct: isCorrect,
            // kana: okunuş ve yazılış sorularının geri bildiriminde "駅 (えき) — istasyon"
            word: word ? { kanji: word.kanji, kana: word.kana, meaning: meaningIn(word, lang) } : null,
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
