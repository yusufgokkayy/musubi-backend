const User = require('../../models/User');
const UserWord = require('../../models/UserWord');
const Progress = require('../../models/Progress');
const Streak = require('../../models/Streak');
const StudySession = require('../../models/StudySession');
const DailyWordPool = require('../../models/DailyWordPool');
const Notification = require('../../models/Notification');
const QuizAttempt = require('../../models/QuizAttempt');
const DeviceSession = require('../../models/DeviceSession');
const StoryView = require('../../models/StoryView');
const AppError = require('../../utils/AppError');
const sendEmail = require('../../utils/sendEmail');
const clientUrl = require('../../utils/clientUrl');
const ctaEmailHtml = require('../../utils/emailTemplate');
const { t, DEFAULT_LANG, normalize } = require('../../utils/i18n');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const ProgressService = require('../progress/progress.service');
const StreakService = require('../streak/streak.service');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../../utils/jwt.util');
const verifySocialToken = require('../../utils/socialAuth');
const { validatePassword } = require('../../utils/password.util');
const { assertMailAllowed, markMailSent, rollbackMailSent } = require('../../utils/mailThrottle');
const { assertLoginAllowed, recordLoginFailure, clearLoginFailures } = require('../../utils/loginThrottle');
const { CONSENT_DOCS, CURRENT_CONSENT_VERSIONS } = require('../../config/consents');
const { DOC_KEYS, docSummary } = require('../../config/legal/texts');
const { safeTimezone } = require('../../utils/date.util');
const Event = require('../../models/Event');
const logEvent = require('../../utils/event.util');
const { revokeAppleTokens } = require('../../utils/appleRevoke');

const MAX_SESSIONS_PER_USER = 5;

// İşlem maillerini kullanıcının dilinde kurar.
// Linke ?lang eklenir ki tıklanınca açılan web sayfası da MAİLLE AYNI dilde
// gelsin — kullanıcı Türkçe mail alıp İngilizce sayfayla karşılaşmasın.
const MAIL_KEYS = {
    verify: ['verifyMailSubject', 'verifyMailTitle', 'verifyMailText', 'verifyMailCta', 'verifyMailNote'],
    change: ['changeMailSubject', 'changeMailTitle', 'changeMailText', 'changeMailCta', 'changeMailNote'],
    reset: ['resetMailSubject', 'resetMailTitle', 'resetMailText', 'resetMailCta', 'resetMailNote']
};

const buildMail = (lang, kind, path) => {
    const s = t(lang);
    const [subject, title, text, ctaLabel, note] = MAIL_KEYS[kind].map(k => s[k]);
    return {
        subject,
        html: ctaEmailHtml({
            lang, title, text, ctaLabel, note,
            ctaUrl: clientUrl(`${path}?lang=${lang}`),
            // Uzak görseller çoğu istemcide varsayılan engelli; şablon logosuz
            // da eksiksiz durur, bu yalnızca bonus
            logoUrl: clientUrl('/assets/musubi-logo.png')
        })
    };
};

const userLang = (user) => user?.preferences?.language || DEFAULT_LANG;

// Onboarding ekranlarının ("Hatırlatma Bildirimi" + "Günlük Kelime Hedefi")
// seçimleri. register ve social AYNI alanları kabul eder ki mobil tarafta tek
// bir kalıp olsun ve sosyal kayıt da tek istekte bitsin.
//
// ⚠️ Yalnızca HESAP AÇILIŞINDA uygulanır. Mevcut kullanıcı Google ile tekrar
// giriş yaptığında bu alanlar YOK SAYILIR — aksi halde her girişte kullanıcının
// Ayarlar'dan değiştirdiği tercihler onboarding varsayılanlarıyla ezilirdi.
// Bu sayede mobil taraf alanları koşulsuz gönderebilir; hesap mevcutsa zararsızdır.
const onboardingFields = ({ dailyGoal, timezone, reminderTime, dailyReminder, language } = {}) => ({
    // Cihaz dili: işlem maillerinin ve mail linklerinin indiği sayfaların dili
    ...(normalize(language) && { preferences: { language: normalize(language) } }),
    ...(dailyGoal !== undefined && { dailyGoal }),
    ...(timezone && { timezone: safeTimezone(timezone) }),
    // Alt alanlar tek tek verilir; komple atamak diğer bildirim
    // tercihlerinin şema varsayılanlarını ezerdi
    ...((reminderTime !== undefined || dailyReminder !== undefined) && {
        notificationSettings: {
            ...(reminderTime !== undefined && { reminderTime }),
            ...(dailyReminder !== undefined && { dailyReminder })
        }
    })
});

// KVKK açık rıza kaydı. Tasarımda ayrı bir onay kutusu YOK: giriş ekranı
// "Yeni bir hesap oluşturuyorsanız ... geçerli olacaktır" diyor, yani rıza
// eylemi kaydın kendisidir. Bu yüzden sürümler istemciden değil SUNUCUDAN
// yazılır; istemci gönderirse yalnızca doğrulama amacıyla karşılaştırılır.
//
// İstemcinin gönderdiği sürüm güncel değilse kayıt REDDEDİLİR: kullanıcının
// hiç görmediği bir metne rıza vermiş gibi kaydetmek, kaydı hükümsüz kılar.
const recordConsents = (user, { consents, ip, userAgent } = {}) => {
    if (consents) {
        const stale = CONSENT_DOCS.find(
            doc => consents[doc] && consents[doc] !== CURRENT_CONSENT_VERSIONS[doc]
        );
        if (stale) {
            throw new AppError(
                'Uygulamanız güncel değil, lütfen güncelleyip tekrar deneyin',
                400
            );
        }
    }

    user.consents = {
        ...CURRENT_CONSENT_VERSIONS,
        acceptedAt: new Date(),
        ip,
        // Uzun UA string'leri dokümanı şişirmesin
        userAgent: userAgent?.slice(0, 200)
    };
};

// Doğrulanmamış hesabın temizlenmeden önce yaşadığı süre. Doğrulama linki
// 24 saat geçerli ama kullanıcı "Tekrar Gönder" ile geç de doğrulayabilir;
// 7 gün fazlasıyla cömert bir pencere.
const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;

// Kullanıcıya ait TÜM veriyi siler (KVKK). deleteAccount ve doğrulanmamış
// hesap temizliği aynı listeyi kullanır — ikisi ayrışırsa biri yetim
// doküman bırakır, o yüzden tek yerde durur.
const purgeUserData = async (userId) => {
    await Promise.all([
        UserWord.deleteMany({ user: userId }),
        Progress.deleteMany({ user: userId }),
        Streak.deleteMany({ user: userId }),
        StudySession.deleteMany({ user: userId }),
        DailyWordPool.deleteMany({ user: userId }),
        Notification.deleteMany({ user: userId }),
        QuizAttempt.deleteMany({ user: userId }),
        DeviceSession.deleteMany({ user: userId }),
        StoryView.deleteMany({ user: userId }),
        Event.deleteMany({ user: userId })
    ]);
    await User.findByIdAndDelete(userId);
};

const hashToken = (token) =>
    crypto.createHash('sha256').update(token).digest('hex');

// Yeni cihaz oturumu aç; kullanıcı başına en fazla 5 oturum (en eskisi düşer)
const createSession = async (userId, refreshToken, deviceName) => {
    const count = await DeviceSession.countDocuments({ user: userId });
    if (count >= MAX_SESSIONS_PER_USER) {
        const oldest = await DeviceSession.find({ user: userId })
            .sort({ lastUsedAt: 1 })
            .limit(count - MAX_SESSIONS_PER_USER + 1);
        await DeviceSession.deleteMany({ _id: { $in: oldest.map(s => s._id) } });
    }
    // expiresAt token'ın kendi exp claim'inden okunur: kayıt ile token aynı
    // anda ölsün ve süre iki ayrı yerde tanımlanmasın. decode imza doğrulamaz
    // ama token'ı biz henüz imzaladık, doğrulanacak bir şey yok.
    const { exp } = jwt.decode(refreshToken);

    await DeviceSession.create({
        user: userId,
        tokenHash: hashToken(refreshToken),
        deviceName: deviceName || 'Bilinmeyen cihaz',
        expiresAt: new Date(exp * 1000)
    });
};

// Şifre değişimi/sıfırlama sonrası tüm oturumları kapatıp mevcut cihaz için
// taze bir token çifti üretir
const rotateAllSessions = async (userId, deviceName) => {
    await DeviceSession.deleteMany({ user: userId });
    const accessToken = signAccessToken(userId);
    const refreshToken = signRefreshToken(userId);
    await createSession(userId, refreshToken, deviceName);
    return { accessToken, refreshToken };
};


// Hassas işlemlerden (hesap silme, e-posta değişimi) önce kimliği yeniden
// kanıtlatır: şifreli hesap şifresiyle, şifresiz sosyal hesap taze idToken ile.
// Access token tek başına yetmez — kilidi açık bırakılmış bir telefonu eline
// geçiren kişi, şifreyi bilmeden hesabı devralamamalı.
// `user` şifre alanıyla (+password) yüklenmiş olmalı.
const assertReauth = async (user, { password, idToken } = {}) => {
    if (user.password) {
        if (typeof password !== 'string' || !(await user.comparePassword(password))) {
            throw new AppError('Şifreniz yanlış. Lütfen tekrar deneyin.', 401);
        }
        return;
    }
    const profile = await verifySocialToken(user.provider, idToken);
    if (profile.providerId !== user.providerId) {
        throw new AppError('Kimlik doğrulanamadı', 401);
    }
};

const EMAIL_RE = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,}$/;

const AuthService = {
    // Onboarding e-posta adımı: ad-soyad/şifre ekranlarına geçmeden önce
    // client adresin biçimini ve müsaitliğini burada öğrenir
    async checkEmail(email) {
        // User modelindeki e-posta regex'i ile aynı desen
        if (!email || !/^[\w-\.]+@([\w-]+\.)+[\w-]{2,}$/.test(email)) {
            throw new AppError('Geçerli bir e-posta adresi girin', 400);
        }
        const exists = await User.exists({ email });
        return { available: !exists };
    },

    // Onboarding tek "Kayıt Ol" ile biter: e-posta/ad/şifre adımlarının yanında
    // hatırlatma saati ve günlük hedef ekranlarının seçimleri de buraya gelir.
    // Hepsi opsiyoneldir — "Şimdilik Geç" diyen kullanıcı bunları göndermez ve
    // şema varsayılanlarıyla (10:00 / 20 kelime) devam eder.
    async register({ name, surname, email, password, deviceName, dailyGoal, timezone, reminderTime, dailyReminder, language, consents, ip, userAgent }) {
        validatePassword(password);

        const user = new User({
            name, surname, email, password,
            ...onboardingFields({ dailyGoal, timezone, reminderTime, dailyReminder, language })
        });

        // Rıza kaydı, ilk save()'den ÖNCE yazılır: hesabın rıza kaydı olmadan
        // var olduğu bir an bile olmamalı (KVKK ispat yükümlülüğü). Güncel
        // olmayan sürüm gelirse burada 400 atar ve hesap hiç oluşmaz.
        recordConsents(user, { consents, ip, userAgent });

        const verificationToken = crypto.randomBytes(20).toString('hex');
        user.emailVerificationToken = crypto
            .createHash('sha256')
            .update(verificationToken)
            .digest('hex');
        user.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;

        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        // Kayıt maili de günlük bütçeye sayılır: sayılmasaydı kullanıcı
        // register(1) + 5 resend = 6 mail alabilirdi. Burada assert YOK —
        // hesap yeni, geçmiş sayaç zaten olamaz.
        markMailSent(user, 'verification');
        await user.save();

        // E-posta gönderimi, yan kayıtlar (Progress/Streak/oturum) oluşmadan ÖNCE
        // denenir: başarısızlıkta yalnızca User silinir, yetim doküman kalmaz.
        try {
            await sendEmail({
                to: email,
                ...buildMail(userLang(user), 'verify', `/verify-email/${verificationToken}`)
            });
        } catch (err) {
            await User.findByIdAndDelete(user._id);
            throw new AppError('Email gönderilemedi, tekrar deneyin', 500);
        }

        // Yan kayıtlar (Progress/Streak/oturum) e-posta gönderildikten sonra
        // oluşur; biri patlarsa yetim User kalmasın diye burada da geri alınır
        // (mail hatasındaki rollback'le aynı mantık, ama User zaten kaydedilmişken)
        try {
            await ProgressService.initializeProgress(user._id);
            await StreakService.initializeStreak(user._id);
            await createSession(user._id, refreshToken, deviceName);
        } catch (err) {
            await Promise.all([
                User.findByIdAndDelete(user._id),
                Progress.deleteMany({ user: user._id }),
                Streak.deleteMany({ user: user._id }),
                DeviceSession.deleteMany({ user: user._id })
            ]);
            throw new AppError('Hesap oluşturulamadı, tekrar deneyin', 500);
        }
        logEvent(user._id, 'register');

        return { user, accessToken, refreshToken, verificationToken };
    },

    async login(email, password, deviceName) {
        const user = await User.findOne({ email }).select('+password');

        // E-posta enumeration koruması BİLEREK yalnızca forgot-password'de:
        // check-email onboarding gereği hesap varlığını zaten söylüyor; login'de
        // netlik UX kazancıdır. Mağaza yayını öncesi yeniden değerlendirilecek.
        if (!user) throw new AppError('Bu e-postayla kayıtlı bir hesap yok', 404);

        // Kilit kontrolü bcrypt'ten ÖNCE: kilitliyken hash karşılaştırmak hem
        // gereksiz iş hem de saldırgana zaman penceresi verir
        assertLoginAllowed(user);

        // Sosyal hesabın şifresi yoktur: "Invalid credentials" çıkmazı yerine
        // kullanıcıyı doğru giriş yöntemine yönlendir. Bu bir şifre denemesi
        // DEĞİLDİR, sayaca işlenmez.
        if (!user.password) {
            const providerName =
                user.provider === 'google' ? 'Google'
                : user.provider === 'apple' ? 'Apple'
                : 'sosyal';
            throw new AppError(`Bu hesap ${providerName} girişiyle açılmış; ${providerName} ile giriş yap`, 400);
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            const lockedUntil = recordLoginFailure(user);
            await user.save();
            if (lockedUntil) {
                const err = new AppError(
                    'Çok fazla hatalı giriş denemesi yapıldı, lütfen biraz bekleyip tekrar deneyin',
                    429
                );
                err.retryAfterSeconds = Math.ceil((lockedUntil - Date.now()) / 1000);
                throw err;
            }
            throw new AppError('Şifreniz yanlış. Lütfen tekrar deneyin.', 401);
        }

        // Başarılı giriş sayacı sıfırlar; yazma yalnızca gerçekten
        // temizlenecek bir şey varsa yapılır
        if (clearLoginFailures(user)) await user.save();

        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        await createSession(user._id, refreshToken, deviceName);
        logEvent(user._id, 'login', { deviceName });

        return {
            user,
            accessToken,
            refreshToken,
            isEmailVerified: user.isEmailVerified
        };
    },

    // Google/Apple ile giriş: hesap yoksa oluşturur (isNewUser: true), varsa
    // giriş yapar. Aynı e-postayla local hesap varsa sosyal hesaba bağlanır —
    // sağlayıcı e-posta sahipliğini zaten doğruladığı için bu güvenlidir.
    async socialLogin({ provider, idToken, name, surname, deviceName, consents, ip, userAgent, dailyGoal, timezone, reminderTime, dailyReminder, language }) {
        const profile = await verifySocialToken(provider, idToken);

        // Doğrulanmamış e-postayla hesap bağlama/oluşturma, hesap ele
        // geçirmeye kapı açar
        if (!profile.emailVerified) {
            throw new AppError('Sosyal hesabınızın e-postası doğrulanmamış', 400);
        }

        let user = await User.findOne({ provider, providerId: profile.providerId });
        let isNewUser = false;

        if (!user) {
            user = await User.findOne({ email: profile.email });
            if (user) {
                // ÖN-KAYIT KORUMASI. Doğrulanmamış bir local hesap, e-postanın
                // sahibi tarafından açılmış olmak zorunda değil: saldırgan
                // kurbanın adresiyle kayıt olup şifreyi kendisi belirleyebilir
                // ve kayıtta bir oturum alır. Kurban sonra Google/Apple ile
                // girince hesap bağlanıp "doğrulanmış" olurdu — saldırgan da
                // kendi şifresi ve oturumuyla içeride kalırdı (26.09.2026,
                // testle doğrulandı). Sağlayıcı adresin GERÇEK sahibini
                // kanıtladığı için doğrulanmamış hesaptaki her şey sahipsiz
                // sayılır: şifre silinir, tüm oturumlar kapanır, ad sağlayıcıdan
                // alınır. Doğrulanmış local hesap (adresin sahibi zaten o)
                // şifresiyle birlikte korunur ve hibrit hesaba dönüşür.
                if (!user.isEmailVerified) {
                    await DeviceSession.deleteMany({ user: user._id });
                    user.password = undefined;
                    user.name = name || profile.name || user.name;
                    user.surname = surname || profile.surname || '';
                    user.emailVerificationToken = undefined;
                    user.emailVerificationExpire = undefined;
                    user.resetPasswordToken = undefined;
                    user.resetPasswordExpire = undefined;
                    user.pendingEmail = undefined;
                    logEvent(user._id, 'unverified_account_claimed', { provider });
                }
                user.provider = provider;
                user.providerId = profile.providerId;
                user.isEmailVerified = true;
                await user.save();
            }
        }

        if (!user) {
            user = new User({
                // Apple ad bilgisini token'da değil ilk girişte ayrıca gönderir;
                // client iletirse body'den, yoksa token'dan, o da yoksa e-postadan
                name: name || profile.name || profile.email.split('@')[0],
                surname: surname || profile.surname || '',
                email: profile.email,
                provider,
                providerId: profile.providerId,
                isEmailVerified: true, // sağlayıcı doğruladı, mail akışı gerekmez
                // Onboarding tercihleri yalnızca BURADA, yani hesap ilk kez
                // açılırken uygulanır (bkz. onboardingFields notu)
                ...onboardingFields({ dailyGoal, timezone, reminderTime, dailyReminder, language })
            });
            // Sosyal kayıt da bir hesap açılışıdır; rıza kaydı e-postayla
            // kayıttakiyle aynı şekilde tutulur
            recordConsents(user, { consents, ip, userAgent });
            await user.save();
            isNewUser = true;
        }

        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);

        if (isNewUser) {
            // register()'daki rollback ile aynı mantık: yeni hesabın yan kayıtları
            // (Progress/Streak/oturum) patlarsa yetim User kalmasın
            try {
                await ProgressService.initializeProgress(user._id);
                await StreakService.initializeStreak(user._id);
                await createSession(user._id, refreshToken, deviceName);
            } catch (err) {
                await Promise.all([
                    User.findByIdAndDelete(user._id),
                    Progress.deleteMany({ user: user._id }),
                    Streak.deleteMany({ user: user._id }),
                    DeviceSession.deleteMany({ user: user._id })
                ]);
                throw new AppError('Hesap oluşturulamadı, tekrar deneyin', 500);
            }
        } else {
            // Var olan hesap: oturum açma hatası User'ı silmeyi gerektirmez
            await createSession(user._id, refreshToken, deviceName);
        }

        logEvent(user._id, isNewUser ? 'register' : 'login', { provider, deviceName });

        return { user, accessToken, refreshToken, isNewUser };
    },

    // Yürürlükteki sürümler + kullanıcının rıza durumu. Uygulama açılışta
    // bunu okuyup sürüm değiştiyse yeni metni gösterir ve tekrar rıza ister.
    // Oturumsuz da çağrılabilir (giriş ekranındaki metin sürümü için).
    async getConsentStatus(userId = null) {
        // docs: her metnin başlığı, sürümü, yürürlük tarihi ve URL'si. Uygulama
        // karşılama ekranındaki linkleri buradan kurar; metin adı/adresi
        // değişirse mağaza güncellemesi gerekmez.
        const response = {
            current: CURRENT_CONSENT_VERSIONS,
            docs: DOC_KEYS.map(docSummary)
        };
        if (!userId) return response;

        const user = await User.findById(userId).select('consents');
        response.accepted = user?.consents || null;
        // Hangi metinlerin yeniden onaylanması gerektiği
        response.outdated = CONSENT_DOCS.filter(
            doc => user?.consents?.[doc] !== CURRENT_CONSENT_VERSIONS[doc]
        );
        response.reconsentRequired = response.outdated.length > 0;
        return response;
    },

    // Sürüm yükseltildikten sonra kullanıcının yeni metinlere rızası.
    // isEmailVerified BİLEREK aranmaz: doğrulamayı bekleyen kullanıcı da
    // güncellenen metne rıza verebilmeli, aksi halde çıkmaza girerdi.
    async acceptConsents(userId, { consents, ip, userAgent } = {}) {
        const user = await User.findById(userId);
        if (!user) throw new AppError('User not found', 404);

        recordConsents(user, { consents, ip, userAgent });
        await user.save();
        return user.consents;
    },

    async refresh(refreshToken) {
        if (!refreshToken) throw new AppError('No refresh token', 401);

        const decoded = verifyRefreshToken(refreshToken);
        const session = await DeviceSession.findOne({
            user: decoded.id,
            tokenHash: hashToken(refreshToken)
        });

        if (!session) throw new AppError('Invalid refresh token', 401);

        session.lastUsedAt = new Date();
        await session.save();

        const accessToken = signAccessToken(decoded.id);
        return { accessToken };
    },

    // refreshToken verilirse sadece o cihazın oturumu, verilmezse tüm oturumlar kapanır.
    //
    // userId null OLABİLİR: bu uç protect değil optionalAuth arkasında duruyor.
    // Access token 15 dakikada ölüyor ve protect'liyken süresi dolmuş token'la
    // gelen çıkış isteği 401 alıyordu — yani oturumu kapatmak isteyen kullanıcı
    // tam da kapatamıyor, DeviceSession ile refresh token'ı ayakta kalıyordu.
    // Refresh token'a sahip olmak o cihaza sahip olmanın kanıtıdır; kimlik
    // bilinmese de o oturum güvenle silinebilir.
    async logout(userId, refreshToken) {
        if (refreshToken) {
            const filter = { tokenHash: hashToken(refreshToken) };
            if (userId) filter.user = userId;
            // findOneAndDelete: kimlik yalnızca refresh token'dan biliniyorsa
            // push token'ını temizlemek için kullanıcıyı silinen kayıttan öğreniriz
            const session = await DeviceSession.findOneAndDelete(filter);
            await AuthService.clearFcmToken(session?.user || userId);
            return;
        }

        if (userId) {
            await DeviceSession.deleteMany({ user: userId });
            await AuthService.clearFcmToken(userId);
            return;
        }

        // Ne geçerli access token ne de refresh token var: kapatılacak oturum
        // belirlenemiyor. Sessizce 200 dönmek kullanıcıda "çıkış yaptım"
        // yanılgısı yaratır, oysa oturum ayakta kalır.
        throw new AppError('No refresh token', 401);
    },

    // Cihazın push kaydını düşürür. Ortak kullanılan bir telefonda çıkış yapan
    // kullanıcının token'ı hesabında kalırsa, bildirimler bir sonraki kişinin
    // eline gitmeye devam ediyordu.
    //
    // Kullanıcı başına TEK token tutulduğu için çıkışta koşulsuz temizlenir:
    // ikinci bir cihaz varsa onun push'u da susar, ama yanlış kişiye bildirim
    // göndermektense bildirim göndermemek doğru taraftır. (Çoklu cihaz desteği
    // ayrı bir iş; geldiğinde token cihaz bazında silinecek.)
    async clearFcmToken(userId) {
        if (!userId) return;
        await User.updateOne({ _id: userId }, { $unset: { fcmToken: 1 } });
    },

    async forgotPassword(email) {
        const user = await User.findOne({ email });
        // Enumeration politikası (ürün kararı): her uçta DÜRÜST cevap.
        // check-email onboarding gereği hesap varlığını zaten açıkça
        // söylüyor, dolayısıyla burada gizlemek sıfır güvenlik kazancı
        // sağlarken kullanıcıyı yazım hatasında sessizce bekletiyordu.
        // Sızıntının karşılığı rate limit + adres bazlı mail kısıtıdır.
        if (!user) throw new AppError('Bu e-postayla kayıtlı bir hesap yok', 404);

        // Doğrulanmamış hesap da sıfırlayabilir — maildeki linke tıklamak
        // zaten adres sahipliğini kanıtlar; 403 dönmek kullanıcıyı çıkmaza sokar.
        assertMailAllowed(user, 'reset');

        const resetToken = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');
        // Fallback 1 saat: env unset ise parseInt NaN üretir ve token anında geçersiz olurdu
        user.resetPasswordExpire = Date.now() + (parseInt(process.env.RESET_PASSWORD_EXPIRE) || 3600000);
        markMailSent(user, 'reset');
        await user.save();

        try {
            await sendEmail({
                to: user.email,
                ...buildMail(userLang(user), 'reset', `/reset-password/${resetToken}`)
            });
        } catch (err) {
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            rollbackMailSent(user, 'reset');
            await user.save();
            throw new AppError('Email gönderilemedi, tekrar deneyin', 500);
        }
    },

    async resetPassword(resetToken, newPassword, deviceName) {
        if (!resetToken) throw new AppError('Invalid or expired token', 400);

        const hashedToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        // +password: aynı-şifre kontrolü için hash gerekli (select: false alandır)
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpire: { $gt: Date.now() }
        }).select('+password');

        if (!user) throw new AppError('Invalid or expired token', 400);

        validatePassword(newPassword);

        // Sıfırlamada eski şifre yazılmadığı için karşılaştırma hash'e karşı
        // yapılır; şifresiz (sosyal) hesap resetle İLK şifresini belirleyebilir
        if (user.password && await user.comparePassword(newPassword)) {
            throw new AppError('Yeni şifre eski şifrenle aynı olamaz', 400);
        }

        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        // Maildeki linke tıklamak adres sahipliğinin kanıtıdır: doğrulama
        // bekleyen hesap ayrıca bir doğrulama maili beklemek zorunda kalmasın
        user.isEmailVerified = true;
        // Kilitli kullanıcı şifresini sıfırladıktan sonra da giremezse çıkmaza
        // girerdi; maildeki linke tıklamak zaten hesap sahipliğini kanıtlıyor
        clearLoginFailures(user);
        await user.save();

        // Web landing sayfasından (deviceName'siz) sıfırlamada tarayıcıya oturum
        // AÇILMAZ: eski oturumlar yine düşer, kullanıcı uygulamadan giriş yapar
        if (!deviceName) {
            await DeviceSession.deleteMany({ user: user._id });
            return {};
        }

        // Güvenlik: şifre sıfırlanınca tüm eski oturumlar kapanır
        const tokens = await rotateAllSessions(user._id, deviceName);
        return tokens; // { accessToken, refreshToken } — login ile aynı sözleşme
    },

    async updateInfo(userId, updates) {
        const user = await User.findById(userId);
        if (!user) throw new AppError('User not found', 404);

        if (updates.name) user.name = updates.name;
        if (updates.surname) user.surname = updates.surname;

        // E-posta DEĞİŞİMİ: yeni adres pendingEmail'de bekler, doğrulama
        // linkine tıklanınca geçerli olur (bkz. verifyEmail). Hesap bu sürede
        // doğrulanmış kalır ve eski adresle giriş sürer — yeni adreste yazım
        // hatası yapan kullanıcı kilitlenmez, gece temizliğine de takılmaz.
        //
        // Hassas işlem: mevcut şifre (şifresiz sosyal hesapta taze idToken)
        // istenir. Aksi halde telefonu eline geçiren kişi adresi kendine çevirip
        // "şifremi unuttum" ile hesabı tamamen devralabilirdi.
        if (updates.email !== undefined && updates.email !== null && updates.email !== '') {
            const newEmail = String(updates.email).trim().toLowerCase();
            if (newEmail !== user.email) {
                if (!EMAIL_RE.test(newEmail)) throw new AppError('Geçerli bir e-posta adresi girin', 400);

                const withSecret = await User.findById(userId).select('+password');
                await assertReauth(withSecret, { password: updates.currentPassword, idToken: updates.idToken });

                const emailTaken = await User.exists({ email: newEmail });
                if (emailTaken) throw new AppError('Bu e-posta adresi zaten kullanımda', 400);

                // Değişim maili de adres bazlı kısıta tabi: aksi halde her
                // update-info çağrısı keyfi bir adrese mail göndertebilirdi
                assertMailAllowed(user, 'verification');

                const verificationToken = crypto.randomBytes(20).toString('hex');
                try {
                    await sendEmail({
                        to: newEmail,
                        ...buildMail(userLang(user), 'change', `/verify-email/${verificationToken}`)
                    });
                } catch (err) {
                    throw new AppError('Doğrulama maili gönderilemedi, e-posta değiştirilmedi', 500);
                }

                user.pendingEmail = newEmail;
                user.emailVerificationToken = hashToken(verificationToken);
                user.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;
                markMailSent(user, 'verification');
            }
        }

        // Şifre bu uçtan DEĞİŞTİRİLEMEZ: eski şifre doğrulaması ve oturum
        // rotasyonu olmadan şifre değişimi, telefonu eline geçirenin şifreyi
        // bilmeden değiştirebilmesi demekti. Tek kapı: change-password (bilen)
        // ve reset-password (unutan) — ikisi de doğrulama + rotasyon garantili.
        if (updates.password) {
            throw new AppError('Şifre bu uçtan değiştirilemez; şifre değiştirme akışını kullan', 400);
        }
        if (updates.dailyGoal) user.dailyGoal = updates.dailyGoal;
        // activeLevel burada BİLEREK yok: seçilen seviyenin AÇIK olması gerekiyor
        // ve o kontrol ProgressService.setActiveLevel'da. Buradan yazılabilseydi
        // kullanıcı kilitli N1'i kendine atayıp müfredatı atlardı.
        // Tek kapı: PUT /api/progress/active-level
        if (updates.fcmToken) {
            user.fcmToken = String(updates.fcmToken);
            // Push token CİHAZA aittir, hesaba değil. Aynı telefonda önce A sonra
            // B giriş yaptıysa (A çıkış yapmadan, ör. oturumu süresi dolduğu
            // için) token iki hesapta birden kalıyor ve A'nın bildirimleri
            // B'nin telefonuna gitmeye devam ediyordu. Token'ı en son kaydeden
            // hesap sahiplenir.
            await User.updateMany(
                { fcmToken: user.fcmToken, _id: { $ne: user._id } },
                { $unset: { fcmToken: 1 } }
            );
        }
        if (updates.timezone) user.timezone = safeTimezone(updates.timezone);
        // Kısmi güncellenir (ör. yalnız reminderTime gelir); geçersiz HH:mm'i
        // şema validasyonu 400'e çevirir
        if (updates.notificationSettings) {
            user.notificationSettings = {
                ...user.notificationSettings?.toObject?.() ?? user.notificationSettings,
                ...updates.notificationSettings
            };
        }
        // Dil/Tema/Font kısmi güncellenir; geçersiz değerleri enum validasyonu 400'e çevirir.
        // isPremium burada BİLEREK yok: yalnızca satın alma doğrulaması set edebilir.
        if (updates.preferences) {
            user.preferences = {
                ...user.preferences?.toObject?.() ?? user.preferences,
                ...updates.preferences
            };
        }

        await user.save();
        return user;
    },

    async verifyEmail(verificationToken, deviceName) {
        if (!verificationToken) throw new AppError('Invalid or expired token', 400);

        const hashedToken = crypto
            .createHash('sha256')
            .update(verificationToken)
            .digest('hex');

        const user = await User.findOne({
            emailVerificationToken: hashedToken,
            emailVerificationExpire: { $gt: Date.now() }
        });

        if (!user) throw new AppError('Invalid or expired token', 400);

        // E-posta değişiminin onayı: bekleyen adres ancak şimdi geçerli olur.
        // Talep ile onay arasında adresi başka bir hesap almış olabilir.
        if (user.pendingEmail) {
            const taken = await User.exists({ email: user.pendingEmail, _id: { $ne: user._id } });
            if (taken) {
                user.pendingEmail = undefined;
                user.emailVerificationToken = undefined;
                user.emailVerificationExpire = undefined;
                await user.save();
                throw new AppError('Bu e-posta adresi artık başka bir hesapta kullanılıyor', 409);
            }
            user.email = user.pendingEmail;
            user.pendingEmail = undefined;
        }

        user.isEmailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpire = undefined;
        await user.save();

        // Web landing sayfasından (deviceName'siz) doğrulamada tarayıcıya token
        // ve oturum ÜRETİLMEZ: kullanılmayacak token sızdırmamak ve 5 oturumluk
        // kotayı mail istemcisi tarayıcısıyla doldurmamak için
        if (!deviceName) return {};

        // Login ile aynı token sözleşmesi: access + refresh çifti
        const accessToken = signAccessToken(user._id);
        const refreshToken = signRefreshToken(user._id);
        await createSession(user._id, refreshToken, deviceName);

        return { accessToken, refreshToken };
    },

    // Landing sayfalarının yan etkisiz ön kontrolü: sayfa, geçersiz/süresi
    // dolmuş linke form göstermek yerine doğrudan hata ekranı basar.
    // E-posta döner ki sayfa hangi hesabın işlendiğini MASKELİ gösterebilsin
    // (bkz. utils/i18n.js maskEmail) — geçersizse null.
    async findVerificationTokenOwner(verificationToken) {
        const user = await User.findOne({
            emailVerificationToken: hashToken(verificationToken),
            emailVerificationExpire: { $gt: Date.now() }
        }).select('email pendingEmail');
        // Değişim linkinde sayfa doğrulanacak YENİ adresi göstermeli
        return user ? (user.pendingEmail || user.email) : null;
    },

    async findResetTokenOwner(resetToken) {
        const user = await User.findOne({
            resetPasswordToken: hashToken(resetToken),
            resetPasswordExpire: { $gt: Date.now() }
        }).select('email');
        return user?.email || null;
    },

    async resendVerificationEmail(email) {
        const user = await User.findOne({ email });
        // Enumeration politikası her uçta aynı: dürüst cevap (bkz. forgotPassword)
        if (!user) throw new AppError('Bu e-postayla kayıtlı bir hesap yok', 404);
        if (user.isEmailVerified) throw new AppError('E-posta zaten doğrulanmış', 400);

        // "Tekrar Gönder" butonu bir kurbanın gelen kutusunu doldurmaya
        // dönüşmesin diye adres bazlı kısıt
        assertMailAllowed(user, 'verification');

        const verificationToken = crypto.randomBytes(20).toString('hex');
        user.emailVerificationToken = crypto
            .createHash('sha256')
            .update(verificationToken)
            .digest('hex');
        user.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;
        markMailSent(user, 'verification');
        await user.save();

        try {
            await sendEmail({
                to: user.email,
                ...buildMail(userLang(user), 'verify', `/verify-email/${verificationToken}`)
            });
        } catch (err) {
            // Gelmeyen mail yüzünden kullanıcı bir dakika boyunca kilitlenmesin
            rollbackMailSent(user, 'verification');
            await user.save();
            throw new AppError('Email gönderilemedi, tekrar deneyin', 500);
        }
    },

    // Ayarlardaki adım adım şifre değiştirme akışının ilk ekranı: mevcut şifre
    // doğrulanmadan yeni şifre ekranına geçilmez ("Şifreniz yanlış" durumu burada)
    async verifyPassword(userId, password) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new AppError('User not found', 404);

        if (!user.password) {
            throw new AppError('Bu hesap sosyal girişle açılmış; şifre belirlemek için şifre sıfırlama akışını kullanın', 400);
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) throw new AppError('Şifreniz yanlış. Lütfen tekrar deneyin.', 401);
    },

    async changePassword(userId, oldPassword, newPassword, deviceName) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new AppError('User not found', 404);

        // Sosyal hesabın şifresi yoktur; şifre belirlemek isterse forgot-password akışını kullanır
        if (!user.password) {
            throw new AppError('Bu hesap sosyal girişle açılmış; şifre belirlemek için şifre sıfırlama akışını kullanın', 400);
        }

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) throw new AppError('Old password is incorrect', 401);

        // Kural kontrolü eski şifre doğrulandıktan SONRA: tasarımda "Şifre Girin"
        // ayrı bir adım, o adımın hatası yeni şifre hatasının önüne geçmeli
        validatePassword(newPassword);

        // Aynı şifreye "değişim" hem anlamsız hem zararlı: kullanıcı fark etmeden
        // tüm diğer oturumları düşürmüş olurdu (rotateAllSessions)
        if (oldPassword === newPassword) {
            throw new AppError('Yeni şifre eski şifrenle aynı olamaz', 400);
        }

        user.password = newPassword;
        // Eski şifreyi bilerek buraya geldi; birikmiş hatalı deneme sayacını
        // yeni şifreye taşımanın anlamı yok
        clearLoginFailures(user);
        await user.save();

        // Güvenlik: diğer tüm cihazların oturumları kapanır, bu cihaz taze çift alır
        return rotateAllSessions(userId, deviceName);
    },

    async deleteAccount(userId, { password, idToken, authorizationCode } = {}) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new AppError('User not found', 404);

        // Silme onayı: şifreli hesap şifresiyle, şifresiz sosyal hesap taze idToken ile
        await assertReauth(user, { password, idToken });

        // Apple ile girişli hesapta Apple'ın verdiği yetki de geri alınmalı
        // (App Store İnceleme Kuralları 5.1.1(v)). En iyi çaba: iptal başarısız
        // olsa da silme SÜRER — kullanıcının silme hakkı Apple'ın API'sine
        // bağlı kalamaz. Sonuç loglanır.
        if (user.provider === 'apple') {
            await revokeAppleTokens(authorizationCode);
        }

        // KVKK: kullanıcıya ait tüm veriler silinir
        await purgeUserData(userId);
    },

    // Cron: doğrulanmamış eski hesapları temizler. İki işi birden yapar —
    // DB'de 8 dokümanlık (User + 5 Progress + Streak + DeviceSession) çöp
    // birikmesini önler VE squat edilmiş e-posta adresini yeniden kayda açar
    // (saldırgan kurbanın adresiyle kaydolup hesabı rehin tutamaz).
    async purgeUnverifiedAccounts(now = new Date()) {
        const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_DAYS * 24 * 60 * 60 * 1000);

        // Sosyal hesaplar sağlayıcı tarafından doğrulanmış sayılır ve zaten
        // isEmailVerified: true ile açılır; yine de provider filtresiyle
        // kazara silinmelerine karşı korunuyoruz
        const stale = await User.find({
            isEmailVerified: false,
            provider: 'local',
            createdAt: { $lt: cutoff }
        }).select('_id');

        // İkinci emniyet: doğrulanmamış hesap hiçbir öğrenme ucuna erişemez
        // (isEmailVerified mount seviyesinde), yani öğrenme verisi olan hesap
        // bir zamanlar doğrulanmıştır ve SİLİNMEZ. Eski e-posta değişimi akışı
        // doğrulanmış hesapları da isEmailVerified: false'a çeviriyordu; o
        // dönemden kalan hesaplar bu kontrolle korunur.
        let purged = 0;
        for (const { _id } of stale) {
            const hasHistory = await UserWord.exists({ user: _id }) ||
                await StudySession.exists({ user: _id });
            if (hasHistory) {
                console.warn(`[purge] öğrenme verisi olan doğrulanmamış hesap atlandı: ${_id}`);
                continue;
            }
            await purgeUserData(_id);
            purged++;
        }
        return { purged };
    }
};

module.exports = AuthService;