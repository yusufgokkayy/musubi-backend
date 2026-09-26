const User = require('../../models/User');
const AppError = require('../../utils/AppError');
const storage = require('../../config/storage');
const UploadService = require('../upload/upload.service');
const { normalizeUsername, usernameViolation, REASON_MESSAGES } = require('../../utils/username.util');

// /auth/me ve update-info yanıtından ÇIKARILAN alanlar. Bunlar sunucunun iç
// muhasebesidir: token hash'leri, giriş/mail kısıt sayaçları. İstemcinin
// hiçbirine ihtiyacı yok; dönmeleri yalnızca saldırı yüzeyini büyütüyordu.
// avatarKey de çıkar — istemci key'i değil avatarUrl'i kullanır.
const PRIVATE_FIELDS = [
    'password', 'fcmToken',
    'emailVerificationToken', 'emailVerificationExpire',
    'resetPasswordToken', 'resetPasswordExpire',
    'loginThrottle', 'mailThrottle',
    'avatarKey', 'profile_image', '__v'
];

const UserService = {
    avatarUrl(user) {
        return UploadService.urlFor(user?.avatarKey);
    },

    // Kullanıcının kendisine dönen biçim (GET /auth/me, PUT /auth/update-info).
    // needsUsername: v2 öncesi hesaplarda kullanıcı adı yok; true ise istemci
    // "Kişisel Bilgiler" ekranını göstermeli.
    toMe(user) {
        const data = user.toJSON();
        for (const field of PRIVATE_FIELDS) delete data[field];
        data.avatarUrl = UserService.avatarUrl(user);
        data.needsUsername = !user.username;
        return data;
    },

    /**
     * Kullanıcı adını doğrular ve müsaitliğine bakar; uygun değilse AppError atar.
     * excludeUserId: kullanıcının KENDİ mevcut adı "alınmış" sayılmasın diye.
     * @returns {string} normalize edilmiş kullanıcı adı
     */
    async assertUsernameUsable(input, { excludeUserId } = {}) {
        const username = normalizeUsername(input);
        const reason = usernameViolation(username) ||
            (await UserService.isTaken(username, excludeUserId) ? 'taken' : null);
        if (reason) {
            // taken 409'dur (çakışma), diğerleri istemcinin düzeltebileceği biçim hatası
            throw new AppError(REASON_MESSAGES[reason], reason === 'taken' ? 409 : 400, { reason });
        }
        return username;
    },

    async isTaken(username, excludeUserId) {
        return Boolean(await User.exists({
            username,
            ...(excludeUserId && { _id: { $ne: excludeUserId } })
        }));
    },

    // Müsaitlik ucu (yazarken kontrol). Hata ATMAZ: "alınmış" bu uç için
    // beklenen bir cevaptır, hata değil — form alanının altına yazılır.
    async checkUsername(input, currentUserId) {
        const username = normalizeUsername(input);
        const reason = usernameViolation(username) ||
            (await UserService.isTaken(username, currentUserId) ? 'taken' : null);
        return {
            username,
            available: !reason,
            reason,
            message: reason ? REASON_MESSAGES[reason] : null
        };
    },

    // save() anında iki istek aynı adı yakalarsa (kontrol ile yazma arasındaki
    // yarış) unique index E11000 atar. errorHandler bunu "username already in
    // use" diye İngilizce verirdi; kontrol ucuyla aynı mesaj ve kodla döner.
    async saveWithUsername(user) {
        try {
            await user.save();
        } catch (err) {
            if (err.code === 11000 && err.keyValue?.username !== undefined) {
                throw new AppError(REASON_MESSAGES.taken, 409, { reason: 'taken' });
            }
            throw err;
        }
    },

    async setAvatar(userId, buffer) {
        const user = await User.findById(userId);
        if (!user) throw new AppError('User not found', 404);

        const { key } = await UploadService.storeImage(buffer, 'avatar');
        const previous = user.avatarKey;
        user.avatarKey = key;
        await user.save();

        // Aynı görsel tekrar yüklendiyse key değişmez; silinecek bir şey yok
        if (previous && previous !== key) await UserService.releaseAvatarFile(previous);
        return { avatarUrl: UserService.avatarUrl(user) };
    },

    async removeAvatar(userId) {
        const user = await User.findById(userId);
        if (!user) throw new AppError('User not found', 404);

        const previous = user.avatarKey;
        if (previous) {
            user.avatarKey = undefined;
            await user.save();
            await UserService.releaseAvatarFile(previous);
        }
        return { avatarUrl: null };
    },

    // Dosya adları İÇERİĞİN hash'i (bkz. upload.service.js): iki kullanıcı aynı
    // görseli yüklerse aynı dosyayı paylaşırlar. Biri fotoğrafını değiştirdiğinde
    // dosya körlemesine silinseydi diğerinin fotoğrafı kırılırdı — o yüzden
    // yalnızca artık kimse kullanmıyorsa silinir.
    async releaseAvatarFile(key) {
        const stillUsed = await User.exists({ avatarKey: key });
        if (stillUsed) return;
        // Dosya silinemese de (disk hatası) kullanıcının işlemi başarılıdır;
        // yetim bir dosya, yarım kalmış bir profil güncellemesinden iyidir
        await storage.remove(key).catch(err =>
            console.error(`Avatar dosyası silinemedi (${key}):`, err.message));
    }
};

module.exports = UserService;
