const Story = require('../../models/Story');
const StoryView = require('../../models/StoryView');
const Event = require('../../models/Event');
const AppError = require('../../utils/AppError');
const logEvent = require('../../utils/event.util');
const UploadService = require('../upload/upload.service');

// Gövdeden gelen her görsel anahtarı, yükleme servisinin ÜRETTİĞİ biçime
// uymalı. Aksi halde "coverKey": "../../.env" gibi bir değer kayda girer ve
// silme akışında dosya sistemine taşınır.
const assertValidKey = (key, alan) => {
    if (typeof key !== 'string' || !UploadService.KEY_PATTERN.test(key)) {
        throw new AppError(`Geçersiz görsel anahtarı (${alan})`, 400);
    }
};

// Sabitlenenler önce, sonra her grup kendi `order`ında. createdAt yalnızca
// eşitlik bozucu (aynı order'a düşen kayıtlar rastgele sıralanmasın).
const SIRALAMA = { isPinned: -1, order: 1, createdAt: 1 };

const normalizeSlides = (slides) => {
    if (!Array.isArray(slides) || slides.length === 0) {
        throw new AppError('En az bir slayt gerekli', 400);
    }
    return slides.map((s, i) => {
        // Panel düz key dizisi gönderiyor; {imageKey} nesnesi de kabul edilir
        const key = typeof s === 'string' ? s : s?.imageKey;
        assertValidKey(key, `slayt ${i + 1}`);
        return { imageKey: key };
    });
};

const parseExpiresAt = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new AppError('Geçersiz bitiş tarihi', 400);
    return date;
};

// Bir görsel iki hikâyede aynı key'e sahip olabilir: dosya adı içeriğin hash'i,
// yani aynı görsel yeniden yüklenirse aynı dosyaya düşer. Bu yüzden hikâye
// silinirken dosya körlemesine silinemez — başka kullanan varsa dosya kalmalı,
// yoksa o hikâyenin görselleri kırılır.
const removeUnusedImages = async (keys) => {
    for (const key of [...new Set(keys)]) {
        const stillUsed = await Story.exists({
            $or: [{ coverKey: key }, { 'slides.imageKey': key }]
        });
        if (!stillUsed) await UploadService.deleteImage(key);
    }
};

const StoryService = {
    /**
     * Kullanıcıya gösterilecek hikâyeler: yayında, süresi geçmemiş, sırada.
     * Slaytlar listeyle BİRLİKTE döner — hikâye sayısı düşük, her daireye
     * dokunuşta ikinci bir istek atmanın anlamı yok.
     */
    async getActiveStories(userId) {
        const now = new Date();
        const stories = await Story.find({
            isActive: true,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
        }).sort(SIRALAMA).lean();

        const views = await StoryView.find({
            user: userId,
            story: { $in: stories.map(s => s._id) }
        }).lean();
        const viewedAtByStory = new Map(views.map(v => [String(v.story), v.viewedAt]));

        return stories.map(s => {
            const viewedAt = viewedAtByStory.get(String(s._id));
            // Karşılaştırma updatedAt'e DEĞİL contentUpdatedAt'e yapılır:
            // sıralama veya yayın durumu değişikliği halkayı yakmamalı, yalnızca
            // görsel içerik değişikliği yakmalı. Alanı olmayan eski kayıtlar
            // için updatedAt'e düşülür.
            const contentAt = s.contentUpdatedAt || s.updatedAt;
            return {
                id: s._id,
                title: s.title,
                coverUrl: UploadService.urlFor(s.coverKey),
                seen: Boolean(viewedAt) && viewedAt >= contentAt,
                // Liste zaten sıralı geliyor; bu alan istemci isterse rozet
                // göstersin diye ve sıranın nedenini belgelemek için var
                isPinned: Boolean(s.isPinned),
                slides: s.slides.map(sl => ({ url: UploadService.urlFor(sl.imageKey) }))
            };
        });
    },

    /**
     * Hikâye açıldığında çağrılır. `seen` İŞARETLEMEZ — yarıda bırakan
     * kullanıcı yalnızca bu olayı üretir, `story_completed` üretmez. İkisinin
     * oranı "kaç kişi açtı, kaçı sonuna gitti" sorusunu cevaplar; hikâye
     * üretmeye devam etmeye değip değmediği buradan görülür.
     */
    async markOpened(userId, storyId) {
        const story = await Story.findById(storyId);
        if (!story) throw new AppError('Hikâye bulunamadı', 404);

        // title da yazılıyor: hikâye silindikten SONRA da ham event'ler
        // okunabilir kalsın, elde anlamsız id'ler kalmasın
        logEvent(userId, 'story_opened', {
            storyId: String(story._id),
            title: story.title,
            slideCount: story.slides.length
        });
    },

    async markSeen(userId, storyId) {
        const story = await Story.findById(storyId);
        if (!story) throw new AppError('Hikâye bulunamadı', 404);

        logEvent(userId, 'story_completed', {
            storyId: String(story._id),
            title: story.title,
            slideCount: story.slides.length
        });

        try {
            await StoryView.findOneAndUpdate(
                { user: userId, story: storyId },
                { $set: { viewedAt: new Date() } },
                { upsert: true }
            );
        } catch (err) {
            // Aynı anda gelen iki işaretleme, unique index'te çakışabilir.
            // Kaydın zaten var olması istenen sonuç — hata değil.
            if (err.code !== 11000) throw err;
        }
    },

    // Panel görünümü: pasif ve süresi dolmuş olanlar dahil hepsi + görüntülenme
    async listForAdmin() {
        const stories = await Story.find().sort(SIRALAMA).lean();

        // Tamamlama: StoryView kaydı yalnızca hikâye sonuna kadar izlenince
        // açılıyor, yani kayıt sayısı = tamamlayan farklı kullanıcı sayısı
        const tamamlama = await StoryView.aggregate([
            { $match: { story: { $in: stories.map(s => s._id) } } },
            { $group: { _id: '$story', count: { $sum: 1 } } }
        ]);
        const tamamlayan = new Map(tamamlama.map(c => [String(c._id), c.count]));

        // Açılma: aynı kullanıcı hikâyeyi birden çok kez açabilir; oranın
        // anlamlı olması için TEKİL kullanıcı sayılıyor (iki kademeli $group).
        // $match type üzerinden Event'in {type,createdAt} indeksini kullanır.
        const acilma = await Event.aggregate([
            {
                $match: {
                    type: 'story_opened',
                    'data.storyId': { $in: stories.map(s => String(s._id)) }
                }
            },
            { $group: { _id: { story: '$data.storyId', user: '$user' } } },
            { $group: { _id: '$_id.story', count: { $sum: 1 } } }
        ]);
        const acan = new Map(acilma.map(c => [String(c._id), c.count]));

        return stories.map(s => ({
            id: s._id,
            title: s.title,
            coverKey: s.coverKey,
            coverUrl: UploadService.urlFor(s.coverKey),
            slides: s.slides.map(sl => ({
                imageKey: sl.imageKey,
                url: UploadService.urlFor(sl.imageKey)
            })),
            isActive: s.isActive,
            isPinned: Boolean(s.isPinned),
            order: s.order,
            expiresAt: s.expiresAt,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            ...(() => {
                const acildi = acan.get(String(s._id)) || 0;
                const tamamlandi = tamamlayan.get(String(s._id)) || 0;
                return {
                    openCount: acildi,
                    completedCount: tamamlandi,
                    // Hiç açılmamışsa oran YOK — 0 yazmak "kimse bitirmedi"
                    // gibi okunur, oysa henüz kimse bakmamış demek
                    completionRate: acildi ? tamamlandi / acildi : null
                };
            })()
        }));
    },

    async createStory({ title, coverKey, slides, isActive, expiresAt }, adminId) {
        assertValidKey(coverKey, 'kapak');

        // Yeni hikâye sabitlenmemiş grubun SONUNA eklenir: mevcut sıralama
        // bozulmasın ve sabitlenenlerin arasına dalmasın
        const last = await Story.findOne({ isPinned: false })
            .sort({ order: -1 }).select('order').lean();

        const story = await Story.create({
            title,
            coverKey,
            slides: normalizeSlides(slides),
            isActive: isActive !== undefined ? Boolean(isActive) : true,
            expiresAt: parseExpiresAt(expiresAt) ?? null,
            order: (last?.order ?? -1) + 1,
            createdBy: adminId
        });

        return story._id;
    },

    async updateStory(id, { title, coverKey, slides, isActive, expiresAt }) {
        const story = await Story.findById(id);
        if (!story) throw new AppError('Hikâye bulunamadı', 404);

        const eskiKeyler = [story.coverKey, ...story.slides.map(s => s.imageKey)];

        if (title !== undefined) story.title = title;
        if (coverKey !== undefined) {
            assertValidKey(coverKey, 'kapak');
            story.coverKey = coverKey;
        }
        if (slides !== undefined) story.slides = normalizeSlides(slides);
        if (isActive !== undefined) story.isActive = Boolean(isActive);
        if (expiresAt !== undefined) story.expiresAt = parseExpiresAt(expiresAt);

        // Halka yalnızca GÖRSEL içerik değişince yeniden yanar. Panel her
        // kaydetmede tüm alanları gönderdiği için "alan gönderildi mi" yetmez,
        // değerin gerçekten değişip değişmediğine bakılır — aksi halde başlıktaki
        // bir yazım düzeltmesi de hikâyeyi herkese yeniden "yeni" gösterirdi.
        const yeniKeyDizisi = [story.coverKey, ...story.slides.map(s => s.imageKey)];
        const icerikDegisti =
            eskiKeyler.length !== yeniKeyDizisi.length ||
            eskiKeyler.some((k, i) => k !== yeniKeyDizisi[i]);
        if (icerikDegisti) story.contentUpdatedAt = new Date();

        await story.save();

        // Değişiklikten sonra artık hiçbir hikâyede geçmeyen görselleri temizle
        const yeniKeyler = new Set([story.coverKey, ...story.slides.map(s => s.imageKey)]);
        await removeUnusedImages(eskiKeyler.filter(k => !yeniKeyler.has(k)));
    },

    async deleteStory(id) {
        const story = await Story.findById(id);
        if (!story) throw new AppError('Hikâye bulunamadı', 404);

        const keys = [story.coverKey, ...story.slides.map(s => s.imageKey)];

        await story.deleteOne();
        await StoryView.deleteMany({ story: id });
        await removeUnusedImages(keys);
    },

    /**
     * Panelde sürükle-bırak sonrası TEK çağrı. İki liste birden gelir:
     * sabitlenenler ve diğerleri. Hem `isPinned` hem `order` konumdan yazılır.
     *
     * Neden tek çağrı: "pinle" ve "sırala" ayrı uçlar olsaydı, bir hikâyeyi
     * gruplar arasında sürüklemek iki isteğe bölünür ve arada tutarsız bir an
     * oluşurdu. Burada gönderilen iki liste, ekranda görülenin tamamıdır.
     */
    async reorder({ pinnedIds, normalIds }) {
        const pinned = pinnedIds ?? [];
        const normal = normalIds ?? [];
        if (!Array.isArray(pinned) || !Array.isArray(normal)) {
            throw new AppError('pinnedIds ve normalIds birer dizi olmalı', 400);
        }
        if (pinned.length + normal.length === 0) {
            throw new AppError('Sıralama listesi gerekli', 400);
        }

        const ops = [
            ...pinned.map((id, index) => ({ id, isPinned: true, order: index })),
            ...normal.map((id, index) => ({ id, isPinned: false, order: index }))
        ];

        // timestamps:false ŞART — Mongoose bulkWrite'a varsayılan olarak
        // updatedAt basıyor (ölçüldü). Sıralama ve pinleme içerik değişikliği
        // olmadığı hâlde, basılsaydı kartları sürüklemek TÜM kullanıcılarda
        // TÜM halkaları yeniden yakardı. contentUpdatedAt'e de dokunulmuyor.
        await Story.bulkWrite(
            ops.map(({ id, isPinned, order }) => ({
                updateOne: { filter: { _id: id }, update: { $set: { isPinned, order } } }
            })),
            { timestamps: false }
        );
    }
};

module.exports = StoryService;
