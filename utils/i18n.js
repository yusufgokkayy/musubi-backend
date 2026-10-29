// Mail gövdeleri ve mail linklerinin indiği web sayfaları için TR/EN metinler.
//
// Dil seçimi sırası:
//   1. ?lang=tr|en  — mail linkleri bunu taşır, böylece sayfa mailin diliyle açılır
//   2. Accept-Language başlığı — linke elle gelen kullanıcı için
//   3. tr (varsayılan)
// Mail dili kullanıcının kendi tercihidir (User.preferences.language).
const SUPPORTED = ['tr', 'en'];
const DEFAULT_LANG = 'tr';

const STRINGS = {
    tr: {
        brandTagline: 'Kelime Ezberlemenin En Hızlı Yolu',

        // Mailler (utils/emailTemplate.js). Text/Warning içindeki {email} alıcının
        // adresiyle (kalın), {time} değişiklik zamanıyla dolar. Preheader gelen
        // kutusunda konunun yanında görünen gri satırdır.
        // Mail: doğrulama
        verifyMailSubject: 'E-postanı doğrula, Musubi\'ye bir adım kaldı',
        verifyMailPreheader: 'Hesabını tek dokunuşla etkinleştir. Bağlantı 24 saat geçerli.',
        verifyMailTitle: 'E-postanı doğrula',
        verifyMailText: 'Merhaba, Musubi hesabını açmak için {email} adresini doğrulaman yeterli.',
        verifyMailCta: 'E-postamı Doğrula',
        verifyMailNote: 'Bağlantı 24 saat geçerli. Bu hesabı sen açmadıysan bu e-postayı yok sayabilirsin.',
        verifyMailReason: 'Bu e-postayı, Musubi\'de bu adresle hesap açıldığı için aldın.',

        // Mail: yeni adres doğrulama
        changeMailSubject: 'Yeni e-posta adresini doğrula',
        changeMailPreheader: 'Değişiklik, yeni adresini doğruladığında geçerli olur.',
        changeMailTitle: 'Yeni adresini doğrula',
        changeMailText: 'Merhaba, Musubi hesabının e-posta adresini {email} olarak değiştirmek istedin. Değişiklik, bu adresi doğruladığında geçerli olur.',
        changeMailCta: 'Yeni Adresimi Doğrula',
        changeMailNote: 'Bağlantı 24 saat geçerli. Bu değişikliği sen istemediysen bu e-postayı yok sayabilirsin; adresin değişmez.',
        changeMailReason: 'Bu e-postayı, bir Musubi hesabına bu adres eklenmek istendiği için aldın.',

        // Mail: şifre sıfırlama
        resetMailSubject: 'Musubi şifreni sıfırla',
        resetMailPreheader: 'Bağlantı 1 saat geçerli. Bu isteği sen yapmadıysan yok sayabilirsin.',
        resetMailTitle: 'Şifreni sıfırla',
        resetMailText: 'Merhaba, {email} hesabı için şifre sıfırlama isteği aldık. Yeni şifreni belirlemek için butona dokun.',
        resetMailCta: 'Şifremi Sıfırla',
        resetMailNote: 'Bağlantı 1 saat geçerli. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.',
        resetMailReason: 'Bu e-postayı, Musubi hesabın için şifre sıfırlama istendiği için aldın.',

        // Mail: şifre değiştirildi (bilgi maili, butonsuz)
        passwordChangedMailSubject: 'Musubi şifren değiştirildi',
        passwordChangedMailPreheader: 'Bunu sen yapmadıysan hemen şifreni sıfırla.',
        passwordChangedMailTitle: 'Şifren değiştirildi',
        passwordChangedMailText: 'Merhaba, {email} hesabının şifresi değiştirildi ({time}). Bunu sen yaptıysan başka bir şey yapmana gerek yok.',
        passwordChangedMailWarning: 'Bunu sen yapmadıysan uygulamadaki Giriş Yap ekranından "Şifremi Unuttum" ile şifreni hemen sıfırla.',
        passwordChangedMailNote: 'Şifre değişince açık olan diğer oturumların kapatıldı.',
        passwordChangedMailReason: 'Bu e-postayı, Musubi hesabının güvenliği için gönderiyoruz.',

        mailFallbackPre: 'Buton çalışmazsa',
        mailFallbackLink: 'bu bağlantıyı',
        mailFallbackPost: ' aç.',
        mailPrivacy: 'Gizlilik',

        // Sayfa: doğrulama
        verifyPageTitle: 'E-posta Doğrulama',
        verifyHeading: 'E-postanı Doğrula',
        verifyLead: 'Aşağıdaki butona basarak hesabını doğrula.',
        verifyBtn: 'E-postamı Doğrula',
        verifyBtnBusy: 'Doğrulanıyor…',
        verifyOkHeading: 'E-postan Doğrulandı',
        // okText masaüstünde (açılacak uygulama yok), okApp telefonda gösterilir
        verifyOkText: 'Hesabın hazır. Telefonundaki Musubi uygulamasına dönüp devam edebilirsin.',
        verifyOkApp: 'Hesabın hazır. Uygulama açılıyor…',
        verifyErr: 'Doğrulama başarısız, tekrar dene.',

        // Sayfa: şifre sıfırlama
        resetPageTitle: 'Yeni Şifre Belirle',
        resetHeading: 'Yeni Şifre Oluştur',
        resetLead: 'Lütfen yeni şifreni gir ve doğrula.',
        resetPlaceholder: 'Yeni şifren',
        resetPlaceholder2: 'Şifreni tekrar gir',
        resetSubmit: 'Şifreyi Güncelle',
        resetSubmitBusy: 'Güncelleniyor…',
        resetOkHeading: 'Şifreniz Değiştirildi',
        resetOkText: 'Artık yeni şifrenle uygulamadan giriş yapabilirsin.',
        resetOkApp: 'Şifren güncellendi. Uygulama açılıyor…',
        resetErr: 'Şifre güncellenemedi, tekrar dene.',

        // Uygulamaya dönüş yönlendirmesi engellenirse görünen yedek bağlantı
        appNotOpened: 'Uygulama açılmadı mı?',
        openApp: 'Aç',

        // Sayfa: ana sayfa ve /indir (mağaza linkleri gelene kadar yer tutucu)
        dlTitle: 'Japonca Kelime Öğren',
        dlLead: 'Japonca kelimeleri günde birkaç dakikada, unutmadan öğren.',
        dlSoon: 'Çok yakında App Store ve Google Play\'de',
        dlPlay: 'Google Play\'den indir',
        dlAppStore: 'App Store\'dan indir',
        dlPrivacy: 'Gizlilik Politikası',
        dlLegal: 'Hukuki Metinler',
        mismatch: 'Şifreler eşleşmiyor.',
        showPassword: 'Şifreyi göster',

        // Şifre kuralları — tasarımdaki ("Yeni Şifre Oluştur") metinler, API'nin
        // döndürdüğü password.util.js mesajlarıyla birebir aynı
        ruleLength: 'Şifreniz çok kısa (en az 8 karakter olmalı).',
        ruleUpperDigit: 'Şifrenizde en az bir büyük harf, bir rakam ve bir özel karakter olmalı.',
        ruleSpecial: 'Şifrenizi daha sağlam yapmak için bir özel karakter kullanın.',
        strength: ['Kötü', 'Orta', 'İyi', 'Çok iyi'],

        // Sayfa: geçersiz link
        invalidTitle: 'Bağlantı Geçersiz',
        invalidHeading: 'Bağlantı Geçersiz',
        invalidText: 'Bu bağlantı geçersiz veya süresi dolmuş. Uygulamadan yeni bir bağlantı isteyebilirsin.',

        // Sayfa: hukuki metinler
        legalIndexTitle: 'Hukuki Metinler',
        legalIndexHeading: 'Hukuki Metinler',
        legalIndexLead: 'Musubi hesabını oluştururken kabul ettiğin metinler.',
        legalVersion: 'Sürüm',
        legalEffective: 'Yürürlük tarihi',
        legalTrOnly: '',   // Türkçe zaten kanonik dil, not gerekmiyor
        legalBack: 'Tüm metinler',
        legalNotFoundTitle: 'Metin Bulunamadı',
        legalNotFoundText: 'Aradığın hukuki metin bulunamadı.',

        netErr: 'Bağlantı hatası, tekrar dene.',
        // Dilin KENDİ adı; sayfada karşı dilin etiketi gösterilir
        langLabel: 'Türkçe'
    },

    en: {
        brandTagline: 'The Fastest Way to Learn Words',

        verifyMailSubject: 'Verify your email, you\'re one step from Musubi',
        verifyMailPreheader: 'Activate your account with one tap. The link is valid for 24 hours.',
        verifyMailTitle: 'Verify your email',
        verifyMailText: 'Hi, to open your Musubi account just verify {email}.',
        verifyMailCta: 'Verify My Email',
        verifyMailNote: 'The link is valid for 24 hours. If you didn\'t create this account, you can ignore this email.',
        verifyMailReason: 'You received this email because a Musubi account was created with this address.',

        changeMailSubject: 'Verify your new email address',
        changeMailPreheader: 'The change takes effect once you verify your new address.',
        changeMailTitle: 'Verify your new address',
        changeMailText: 'Hi, you asked to change your Musubi account email to {email}. The change takes effect once you verify this address.',
        changeMailCta: 'Verify New Address',
        changeMailNote: 'The link is valid for 24 hours. If you didn\'t ask for this, you can ignore this email; your address won\'t change.',
        changeMailReason: 'You received this email because someone asked to add this address to a Musubi account.',

        resetMailSubject: 'Reset your Musubi password',
        resetMailPreheader: 'The link is valid for 1 hour. If you didn\'t ask for this, you can ignore it.',
        resetMailTitle: 'Reset your password',
        resetMailText: 'Hi, we received a request to reset the password for {email}. Tap the button to set a new one.',
        resetMailCta: 'Reset My Password',
        resetMailNote: 'The link is valid for 1 hour. If you didn\'t ask for this, you can ignore this email; your password won\'t change.',
        resetMailReason: 'You received this email because a password reset was requested for your Musubi account.',

        passwordChangedMailSubject: 'Your Musubi password was changed',
        passwordChangedMailPreheader: 'If this wasn\'t you, reset your password right away.',
        passwordChangedMailTitle: 'Your password was changed',
        passwordChangedMailText: 'Hi, the password for {email} was changed ({time}). If this was you, there\'s nothing else to do.',
        passwordChangedMailWarning: 'If this wasn\'t you, reset your password right away with "Forgot Password" on the app\'s sign-in screen.',
        passwordChangedMailNote: 'Your other open sessions were signed out when the password changed.',
        passwordChangedMailReason: 'We send this email to keep your Musubi account secure.',

        mailFallbackPre: 'If the button doesn\'t work,',
        mailFallbackLink: 'open this link',
        mailFallbackPost: '.',
        mailPrivacy: 'Privacy',

        verifyPageTitle: 'Email Verification',
        verifyHeading: 'Verify Your Email',
        verifyLead: 'Tap the button below to verify your account.',
        verifyBtn: 'Verify My Email',
        verifyBtnBusy: 'Verifying…',
        verifyOkHeading: 'Email Verified',
        verifyOkText: 'Your account is ready. Head back to the Musubi app on your phone to continue.',
        verifyOkApp: 'Your account is ready. Opening the app…',
        verifyErr: 'Verification failed, please try again.',

        resetPageTitle: 'Set a New Password',
        resetHeading: 'Create a New Password',
        resetLead: 'Enter your new password and confirm it.',
        resetPlaceholder: 'New password',
        resetPlaceholder2: 'Confirm password',
        resetSubmit: 'Update Password',
        resetSubmitBusy: 'Updating…',
        resetOkHeading: 'Password Changed',
        resetOkText: 'You can now sign in from the app with your new password.',
        resetOkApp: 'Your password has been updated. Opening the app…',
        resetErr: 'Could not update password, please try again.',

        appNotOpened: "App didn't open?",
        openApp: 'Open',

        dlTitle: 'Learn Japanese Words',
        dlLead: 'Learn Japanese words in a few minutes a day — and actually remember them.',
        dlSoon: 'Coming soon to the App Store and Google Play',
        dlPlay: 'Get it on Google Play',
        dlAppStore: 'Download on the App Store',
        dlPrivacy: 'Privacy Policy',
        dlLegal: 'Legal',
        mismatch: 'Passwords do not match.',
        showPassword: 'Show password',

        ruleLength: 'Your password is too short (at least 8 characters).',
        ruleUpperDigit: 'Your password needs an uppercase letter, a number and a special character.',
        ruleSpecial: 'Add a special character to make your password stronger.',
        strength: ['Weak', 'Fair', 'Good', 'Strong'],

        invalidTitle: 'Invalid Link',
        invalidHeading: 'Invalid Link',
        invalidText: 'This link is invalid or has expired. You can request a new one from the app.',

        legalIndexTitle: 'Legal Documents',
        legalIndexHeading: 'Legal Documents',
        legalIndexLead: 'The documents you accept when creating a Musubi account.',
        legalVersion: 'Version',
        legalEffective: 'Effective date',
        // Metinlerin İngilizcesi yok; makine çevirisi yapılmıyor (bağlayıcı
        // sözleşmenin çevirisi hukuki inceleme ister). Sayfa Türkçe metni
        // gösterir, bunu açıkça söyler.
        legalTrOnly: 'This document is currently available in Turkish only. The Turkish text is the binding version.',
        legalBack: 'All documents',
        legalNotFoundTitle: 'Document Not Found',
        legalNotFoundText: 'The legal document you are looking for could not be found.',

        netErr: 'Connection error, please try again.',
        langLabel: 'English'
    }
};

const normalize = (value) => {
    const lang = String(value || '').trim().toLowerCase().slice(0, 2);
    return SUPPORTED.includes(lang) ? lang : null;
};

// Web sayfaları için: ?lang → Accept-Language → tr
const langFromRequest = (req) =>
    normalize(req.query?.lang) ||
    normalize(req.headers?.['accept-language']?.split(',')[0]) ||
    DEFAULT_LANG;

const t = (lang) => STRINGS[normalize(lang) || DEFAULT_LANG];

// Ekran görüntüsü paylaşılırsa adres tamamen açığa çıkmasın; kullanıcı yine de
// hangi hesabı işlediğini tanısın diye ilk karakterler ve alan adı korunur.
const maskEmail = (email) => {
    const [local, domain] = String(email || '').split('@');
    if (!domain) return '';
    const head = local.length <= 3 ? local.slice(0, 1) : local.slice(0, 3);
    return `${head}${'*'.repeat(3)}@${domain}`;
};

module.exports = { SUPPORTED, DEFAULT_LANG, t, langFromRequest, normalize, maskEmail };
