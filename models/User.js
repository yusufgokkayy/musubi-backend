const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { firstPasswordViolation } = require('../utils/password.util');

const UserSchema = new mongoose.Schema({
    name: {
        // trim: yalnız boşluktan oluşan isim `required`'ı geçip ekranda
        // "Merhaba " diye görünürdü; trim sonrası boş kalınca required yakalar
        type: String,
        required: [true, 'Please provide a name'],
        trim: true,
        maxlength: [50, 'İsim en fazla 50 karakter olabilir']
    },
    surname: {
        type: String,
        // Apple ilk girişte bile soyadı göndermeyebilir; sosyal hesapta zorunlu değil
        required: [function () { return this.provider === 'local'; }, 'Please provide a surname'],
        default: '',
        trim: true,
        maxlength: [50, 'Soyisim en fazla 50 karakter olabilir']
    },
    email: {
        // lowercase + trim ŞART: unique index büyük-küçük harf duyarlıdır ve
        // mobil klavyeler ilk harfi otomatik büyütür. Olmazsa Emir@x.com ile
        // emir@x.com iki ayrı hesap olur, kullanıcı kendi hesabına giriş
        // yapamaz. Mongoose bu setter'ları sorgu filtrelerine de uygular,
        // yani findOne/exists de normalize edilmiş değerle arar (ölçüldü).
        type: String,
        required: [true, 'Please provide an email'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^[\w-\.]+@([\w-]+\.)+[\w-]{2,}$/, 'Please provide a valid email']
    },
    password: {
        type: String,
        minlength: [8, 'Şifreniz çok kısa (en az 8 karakter olmalı)'],
        // Sosyal girişle açılan hesapların şifresi yoktur; sonradan
        // forgot-password ile şifre belirlerse hibrit hesaba dönüşür
        required: [function () { return this.provider === 'local'; }, 'Please provide a password'],
        select: false,
        // Şifre kurallarının veri katmanı yedeği. Asıl uygulama servis
        // katmanındadır (ordered mesaj + güç göstergesi için); bu validator
        // servisi atlayan bir yol (seed, script, ileride eklenecek bir uç)
        // zayıf şifre yazmasın diye vardır. İkisi de password.util'deki AYNI
        // kural dizisinden beslenir.
        validate: {
            // isModified koruması ŞART: Mongoose, SELECT EDİLMİŞ bir alanı
            // değişmemiş olsa bile save()'de doğrular. Şifre select edilip
            // alakasız bir sebeple kaydedilirse (pre-save hash'i çalışmaz)
            // buraya gelen değer ham şifre DEĞİL bcrypt hash'idir; kural
            // hash'e karşı koşup anlamsız sonuç üretirdi — hash genelde
            // büyük harf/rakam/'$' içerdiği için tesadüfen "geçer" ve hata
            // sessizce gizlenirdi. Regresyon testi: "şifre kuralları veri
            // katmanında da uygulanır" (tests/api.test.js).
            validator: function (value) {
                if (!this.isModified?.('password')) return true;
                return firstPasswordViolation(value) === null;
            },
            message: (props) => firstPasswordViolation(props.value) || 'Geçersiz şifre'
        }
    },
    provider: {
        type: String,
        enum: ['local', 'google', 'apple'],
        default: 'local'
    },
    providerId: String,
    // Profilde, sıralamada ve davet linkinde (/u/<username>) görünen ad.
    // Küçük harfle ve "@" olmadan saklanır; kuralları utils/username.util.js.
    //
    // Şemada required DEĞİL: v2'den önce açılan hesapların kullanıcı adı yok.
    // Eksik olduğu /auth/me'deki needsUsername bayrağıyla istemciye söylenir
    // ve istemci "Kişisel Bilgiler" ekranını gösterir.
    username: {
        type: String,
        trim: true,
        lowercase: true
    },
    // Profil fotoğrafının depolama anahtarı (ör. "avatars/<hash>.webp").
    // URL DEĞİL key saklanır — bkz. config/storage/index.js. İstemciye
    // UploadService.urlFor ile avatarUrl olarak çıkar; yoksa null ve istemci
    // baş harf çizer. (Eski `profile_image: 'default.jpg'` placeholder'ının yerini aldı.)
    avatarKey: {
        type: String
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    active: {
        type: Boolean,
        default: true
    },
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    dailyGoal: {
        type: Number,
        default: 20,
        min: 5,
        max: 50
    },
    // Ayarlar > "Öğrenme Seviyeni Değiştir" ile seçilen, günlük dersin çekildiği
    // seviye. Kullanıcı başına TEK seçim olduğu için Progress'te (seviye başına
    // bir doküman) değil burada durur.
    //
    // Sunucudaki tek doğru kaynaktır: GET /userwords/today seviyeyi ARTIK
    // istemciden almaz. İki kaynak olsaydı (ayarlarda N4, istemci elindeki eski
    // değerle N5 isterken) kullanıcı seçtiğinden başka seviyenin dersini görürdü.
    //
    // Yalnızca PROGRESS'TE AÇIK bir seviyeye ayarlanabilir; kuralı
    // ProgressService.setActiveLevel uygular. Seviye kilidi açılınca BURASI
    // kendiliğinden değişmez — tasarımda geçiş "Şimdi Geç" onayına bağlı.
    activeLevel: {
        type: String,
        enum: ['N5', 'N4', 'N3', 'N2', 'N1'],
        default: 'N5'
    },
    // "Seviyeni Öğrenelim Mi?" modalındaki "Daha Sonra" damgası. Bu alan
    // olmadan modal her anasayfa açılışında yeniden çıkıyordu: sınav bitene
    // kadar "girilebilir" bayrağı hep true kalıyor, erteleme hiçbir yerde
    // tutulmuyordu. Kullanıcı sınava Ayarlar'dan istediği zaman girebilir.
    placementDeferredAt: {
        type: Date
    },
    // Alanlar "Bildirim Ayarları" ekranındaki kontrollerle BİREBİR eşleşir;
    // eşleme notification.service.js'teki SETTING_MAP'te tutulur.
    notificationSettings: {
        // "Pratik Anımsatıcısı" + detay ekranındaki "Anımsatıcıyı Kapat"
        // (takvim+saat ikonu) → daily_task
        dailyReminder: { type: Boolean, default: true },
        // "Günlük Kelimeler" (あ ikonu) → daily_word.
        // dailyReminder'dan AYRI: tasarımda iki ayrı kontrol var ve ikisi de
        // tek bayrağa bağlıyken "Günlük Kelimeler"i kapatan kullanıcının
        // pratik anımsatıcısı da susuyordu.
        dailyWord: { type: Boolean, default: true },
        // Onboarding'deki "Hatırlatma Bildirimi" saat seçicisi ve ayarlardaki
        // karşılığı. Kullanıcının KENDİ saat diliminde HH:mm; bildirim üreten
        // cron bu saati geçmiş kullanıcılara günün hatırlatmasını gönderir.
        // İKİ tip için de zamanlama kaynağıdır: dailyReminder kapalı ama
        // dailyWord açıksa günlük kelime yine bu saatte gider.
        reminderTime: {
            type: String,
            default: '10:00',
            match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Hatırlatma saati HH:mm biçiminde olmalı']
        },
        // "Seri Koruma Uyarısı" (alev ikonu) → streak_reminder + streak_warning
        streakReminder: { type: Boolean, default: true },
        // "Tekrar Gereken Kelimeler" (↘ ikonu) → word_level_down
        wordLevelDown: { type: Boolean, default: true }
    },
    // Ayarlar ekranındaki cihazlar arası senkron tercihler (Dil/Tema/Font Boyutu)
    preferences: {
        language: { type: String, enum: ['tr', 'en'], default: 'tr' },
        theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
        fontSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' }
    },
    // "Reklamları Kaldır" — yalnızca satın alma doğrulaması set eder,
    // update-info üzerinden değiştirilemez
    isPremium: {
        type: Boolean,
        default: false
    },
    fcmToken: {
        type: String,
        select: false
    },
    timezone: {
        type: String,
        default: 'Europe/Istanbul'
    },
    // KVKK açık rıza kanıtı. Rızanın ispatı veri sorumlusundadır ve geçmişe
    // dönük üretilemez — bu yüzden hesap açılış anında yazılır ve bir daha
    // yalnızca yeniden rıza (sürüm değişimi) ile güncellenir.
    // Metinler mobil uygulamada gömülü; burada yalnızca hangi SÜRÜME rıza
    // verildiği tutulur (bkz. config/consents.js).
    consents: {
        terms: String,
        privacy: String,
        kvkk: String,
        acceptedAt: Date,
        // İspat gücü için: rızanın hangi bağlamda verildiği. Bunlar da
        // kişisel veridir, hesap silinince purgeUserData ile birlikte gider.
        ip: String,
        userAgent: String
    },
    // Hesap bazlı giriş denemesi sayacı. IP limitinden farkı: çok sayıda IP'ye
    // sahip bir saldırgan tek hesabı IP limitine takılmadan deneyebilirdi.
    // Kilit kademeli ve KISA tutulur — kilidin kendisi bir DoS aracıdır
    // (bkz. utils/loginThrottle.js).
    loginThrottle: {
        failureCount: { type: Number, default: 0 },
        firstFailureAt: Date,
        lockedUntil: Date
    },
    // Adres bazlı mail gönderim kısıtı. IP limitinden farkı: saldırgan IP
    // değiştirerek aşamaz, çünkü sayaç hedef HESABIN üzerinde tutulur.
    // Bir kurbanın gelen kutusunu doğrulama/sıfırlama maili ile doldurmayı
    // engeller (bkz. utils/mailThrottle.js).
    mailThrottle: {
        verification: {
            lastSentAt: Date,
            dayCount: { type: Number, default: 0 },
            dayStart: Date
        },
        reset: {
            lastSentAt: Date,
            dayCount: { type: Number, default: 0 },
            dayStart: Date
        }
    },
    // E-posta DEĞİŞİMİNDE yeni adres burada bekler; doğrulama linkine
    // tıklanınca `email`'e taşınır. Değişim sırasında hesap doğrulanmış kalır,
    // giriş eski adresle sürer.
    //
    // Eskiden yeni adres doğrudan `email`'e yazılıp isEmailVerified false
    // yapılıyordu. İki sonucu vardı: (1) yeni adreste yazım hatası yapan
    // kullanıcı hesabından kilitleniyordu, (2) gece çalışan doğrulanmamış hesap
    // temizliği hesabı açılış tarihine baktığı için AYLARCA eski bir hesabı
    // tüm öğrenme verisiyle siliyordu (26.09.2026 incelemesi, doğrulandı).
    pendingEmail: {
        type: String,
        lowercase: true,
        trim: true
    },
    emailVerificationToken: String,
    emailVerificationExpire: Date,
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Aynı sağlayıcı hesabı iki kullanıcıya bağlanamaz; local kullanıcıların
// providerId'si olmadığından partial filter ile index dışında tutulurlar
UserSchema.index(
    { provider: 1, providerId: 1 },
    { unique: true, partialFilterExpression: { providerId: { $exists: true } } }
);

// Kullanıcı adı benzersizdir. Partial filter: kullanıcı adı henüz olmayan
// (v2 öncesi) hesaplar index'e girmez — aksi halde "username yok" değeri
// iki hesapta birden bulunamazdı.
UserSchema.index(
    { username: 1 },
    { unique: true, partialFilterExpression: { username: { $type: 'string' } } }
);

// Profil fotoğrafını silerken dosyayı başka hesabın kullanıp kullanmadığına
// bakılır (dosya adları içerik hash'i, aynı görsel aynı key'i üretir)
UserSchema.index({ avatarKey: 1 }, { sparse: true });

UserSchema.pre('save', async function () {
    // Şifrenin KALDIRILMASI da bir değişikliktir (ön-kayıt koruması: sosyal
    // girişle bağlanan doğrulanmamış hesabın şifresi silinir) — boş değeri
    // hash'lemeye çalışmak bcrypt'i patlatırdı
    if (!this.isModified('password') || !this.password) return;
    this.password = await bcrypt.hash(this.password, 10);
});

UserSchema.methods.comparePassword = async function (enteredPassword) {
    // Sosyal hesapta şifre yoktur; bcrypt'e undefined geçmek exception atar
    if (!enteredPassword || !this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);