const crypto = require('crypto');
const AppError = require('../../utils/AppError');
const storage = require('../../config/storage');
const { sniffFormat, reencodeToWebp } = require('../../utils/image.util');

// Ön ayarlar hem klasörü hem hedef boyutu belirler. İstemcinin serbest metin
// klasör adı göndermesine izin verilmez: "../../" ile dizin dışına yazmayı
// engellemenin en sağlam yolu, kabul edilen adları saymaktır.
//
// Boyutlar tasarımdan gelir (~/Masaüstü/Figma Roadmap/Anasayfa.png):
// anasayfanın üstündeki daireler küçük kapaklar, dokununca açılan hikâye ise
// tam ekran dikey bir kart.
const PRESETS = {
    story:      { folder: 'stories',      maxWidth: 1080, maxHeight: 1920 },
    storyCover: { folder: 'story-covers', maxWidth: 512,  maxHeight: 512 },
    word:       { folder: 'words',        maxWidth: 800,  maxHeight: 800 }
};

// Silme ucu key'i dışarıdan alır; dizin dışına çıkan ("../") veya hiç bu
// sistemin üretmediği bir yol gelirse dosya sistemine hiç dokunulmaz.
const KEY_PATTERN = /^[a-z0-9-]{1,32}\/[a-f0-9]{32}\.webp$/;

const UploadService = {
    PRESETS,
    KEY_PATTERN,

    /**
     * Ham dosya buffer'ını doğrular, yeniden kodlar ve depolamaya yazar.
     * @returns {{key: string, url: string, width: number, height: number, bytes: number}}
     */
    async storeImage(buffer, presetName = 'story') {
        const preset = PRESETS[presetName];
        if (!preset) {
            throw new AppError(
                `Geçersiz preset "${presetName}". Geçerli değerler: ${Object.keys(PRESETS).join(', ')}`, 400
            );
        }

        const format = sniffFormat(buffer);
        if (!format) {
            throw new AppError(
                'Desteklenmeyen dosya biçimi. JPEG, PNG, WebP veya GIF yükleyin (SVG kabul edilmez).', 400
            );
        }

        let image;
        try {
            image = await reencodeToWebp(buffer, preset);
        } catch (err) {
            // Sihirli baytı doğru ama gövdesi bozuk dosya: sunucu hatası değil,
            // istemcinin gönderdiği veri hatalı — 500 dönmek yanıltıcı olurdu.
            throw new AppError('Görsel çözümlenemedi, dosya bozuk olabilir', 400);
        }

        // Dosya adı İÇERİĞİN hash'i: aynı görsel iki kez yüklenirse aynı dosyaya
        // yazılır (kopya birikmez) ve içerik değişmediği sürece URL de değişmez,
        // bu da /uploads'ı "immutable" olarak sonsuza dek cache'lemeyi güvenli kılar.
        const hash = crypto.createHash('sha256').update(image.buffer).digest('hex').slice(0, 32);
        const key = await storage.put(image.buffer, { folder: preset.folder, filename: `${hash}.webp` });

        return {
            key,
            url: storage.publicUrl(key),
            width: image.width,
            height: image.height,
            bytes: image.bytes
        };
    },

    async deleteImage(key) {
        if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
            throw new AppError('Geçersiz görsel anahtarı', 400);
        }
        await storage.remove(key);
    },

    // Kayıtlarda key saklanır; istemciye çıkarken URL'e çevrilir. Modeller
    // (Word.imageUrl, ileride Story) bu fonksiyondan geçirilirse sürücü
    // değişimi tek satırlık bir env değişikliği olarak kalır.
    urlFor(key) {
        if (!key) return null;
        return /^https?:\/\//.test(key) ? key : storage.publicUrl(key);
    }
};

module.exports = UploadService;
