// Hata yanıtlarındaki makine-okur `code` değerlerinin TEK listesi.
//
// Neden var: istemci hatayı yalnızca durum kodu ve mesaj metniyle ayırt
// edebiliyordu. 401 iki ayrı anlama geliyordu — "oturumun süresi doldu,
// yenile" ve "şifre yanlış" — ve mobilin oturum yenileme mantığı girişteki
// "şifre yanlış" cevabını da yutuyordu; kullanıcı ekranda hiçbir şey
// görmüyordu (27.10.2026, cihazda doğrulandı). Kod, durum kodundan bağımsız
// olarak istemcinin NE YAPACAĞINI söyler.
//
// Kapsam bilerek dar: giriş, kayıt ve oturum. Kod taşımayan hata eskisi gibi
// { success, message } döner. Yeni kod eklenirse API.md › "Hata kodları"
// tablosu da güncellenmeli.
const ERR = Object.freeze({
    // Oturum
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',               // erişim token'ının süresi doldu → /auth/refresh
    TOKEN_INVALID: 'TOKEN_INVALID',               // token yok/bozuk ya da kullanıcı silinmiş → çıkış
    REFRESH_INVALID: 'REFRESH_INVALID',           // yenileme token'ı yok/geçersiz/süresi dolmuş → giriş ekranı
    EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',     // ✉️ uçlarına doğrulanmamış hesap → "E-postanı Doğrula"
    APP_CHECK_FAILED: 'APP_CHECK_FAILED',         // Firebase App Check başlığı yok/geçersiz

    // Kimlik
    INVALID_PASSWORD: 'INVALID_PASSWORD',         // giriş, şifre doğrulama/değiştirme, hesap silme
    REAUTH_FAILED: 'REAUTH_FAILED',               // şifresiz sosyal hesapta taze idToken başka hesaba ait
    SOCIAL_TOKEN_INVALID: 'SOCIAL_TOKEN_INVALID', // Google/Apple idToken doğrulanamadı
    SOCIAL_ACCOUNT: 'SOCIAL_ACCOUNT',             // şifresiz sosyal hesapta şifre işlemi (details.provider)
    ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',       // bu e-postayla hesap yok
    LOGIN_LOCKED: 'LOGIN_LOCKED',                 // çok fazla hatalı giriş (details.retryAfterSeconds)

    // Mail ve linkler
    MAIL_RATE_LIMITED: 'MAIL_RATE_LIMITED',       // adres bazlı mail kısıtı (details.retryAfterSeconds)
    LINK_INVALID: 'LINK_INVALID',                 // doğrulama/sıfırlama linki geçersiz ya da süresi dolmuş
    ALREADY_VERIFIED: 'ALREADY_VERIFIED',         // tekrar gönder: e-posta zaten doğrulanmış

    // Form
    EMAIL_INVALID: 'EMAIL_INVALID',
    EMAIL_TAKEN: 'EMAIL_TAKEN',
    WEAK_PASSWORD: 'WEAK_PASSWORD',               // utils/password.util.js kurallarından biri tutmadı
    SAME_PASSWORD: 'SAME_PASSWORD'                // yeni şifre eskisiyle aynı
});

module.exports = ERR;
