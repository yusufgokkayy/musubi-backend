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

        // Mail: doğrulama
        verifyMailSubject: 'Musubi - E-posta Doğrulama',
        verifyMailTitle: 'E-postanı doğrula',
        verifyMailText: 'Musubi hesabını kullanmaya başlamak için e-posta adresini doğrulaman gerekiyor.',
        verifyMailCta: 'E-postamı Doğrula',
        verifyMailNote: 'Bu bağlantı 24 saat geçerlidir. Bu hesabı sen açmadıysan bu e-postayı yok sayabilirsin.',

        // Mail: yeni adres doğrulama
        changeMailSubject: 'Musubi - Yeni E-posta Doğrulama',
        changeMailTitle: 'Yeni adresini doğrula',
        changeMailText: 'Musubi hesabının e-posta adresini değiştirdin. Yeni adresi doğrulamak için aşağıdaki butona bas.',
        changeMailCta: 'Yeni Adresimi Doğrula',
        changeMailNote: 'Bu bağlantı 24 saat geçerlidir. Bu değişikliği sen yapmadıysan bu e-postayı yok sayabilirsin.',

        // Mail: şifre sıfırlama
        resetMailSubject: 'Musubi - Şifre Sıfırlama',
        resetMailTitle: 'Şifreni sıfırla',
        resetMailText: 'Musubi hesabının şifresini sıfırlamak için aşağıdaki butona bas.',
        resetMailCta: 'Şifremi Sıfırla',
        resetMailNote: 'Bu bağlantı 1 saat geçerlidir. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.',
        mailFooter: 'Bu e-posta Musubi tarafından gönderildi.',
        mailButtonFallback: 'Buton çalışmıyorsa bu adresi tarayıcına yapıştır:',

        // Sayfa: doğrulama
        verifyPageTitle: 'E-posta Doğrulama',
        verifyHeading: 'E-postanı Doğrula',
        verifyLead: 'Aşağıdaki butona basarak hesabını doğrula.',
        verifyBtn: 'E-postamı Doğrula',
        verifyBtnBusy: 'Doğrulanıyor…',
        verifyOkHeading: 'E-postan Doğrulandı',
        verifyOkText: 'Hesabın hazır. Uygulamaya dönüp kaldığın yerden devam edebilirsin.',
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
        resetErr: 'Şifre güncellenemedi, tekrar dene.',
        mismatch: 'Şifreler eşleşmiyor.',
        showPassword: 'Şifreyi göster',

        // Şifre kuralları (password.util.js ile aynı sıra)
        ruleLength: 'Şifren çok kısa (en az 8 karakter olmalı).',
        ruleUpperDigit: 'Şifrende en az bir büyük harf, bir rakam ve bir özel karakter olmalı.',
        ruleSpecial: 'Şifreni daha sağlam yapmak için bir özel karakter kullan.',
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

        verifyMailSubject: 'Musubi - Verify Your Email',
        verifyMailTitle: 'Verify your email',
        verifyMailText: 'To start using your Musubi account, please verify your email address.',
        verifyMailCta: 'Verify My Email',
        verifyMailNote: 'This link is valid for 24 hours. If you did not create this account, you can ignore this email.',

        changeMailSubject: 'Musubi - Verify Your New Email',
        changeMailTitle: 'Verify your new address',
        changeMailText: 'You changed the email address on your Musubi account. Tap the button below to verify it.',
        changeMailCta: 'Verify New Address',
        changeMailNote: 'This link is valid for 24 hours. If you did not make this change, you can ignore this email.',

        resetMailSubject: 'Musubi - Password Reset',
        resetMailTitle: 'Reset your password',
        resetMailText: 'Tap the button below to reset the password for your Musubi account.',
        resetMailCta: 'Reset My Password',
        resetMailNote: 'This link is valid for 1 hour. If you did not request this, you can ignore this email.',
        mailFooter: 'This email was sent by Musubi.',
        mailButtonFallback: 'If the button does not work, paste this address into your browser:',

        verifyPageTitle: 'Email Verification',
        verifyHeading: 'Verify Your Email',
        verifyLead: 'Tap the button below to verify your account.',
        verifyBtn: 'Verify My Email',
        verifyBtnBusy: 'Verifying…',
        verifyOkHeading: 'Email Verified',
        verifyOkText: 'Your account is ready. Head back to the app and pick up where you left off.',
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
        resetErr: 'Could not update password, please try again.',
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
