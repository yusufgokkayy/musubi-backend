// Sign in with Apple — hesap silinirken Apple'ın verdiği yetkiyi geri alır.
//
// App Store İnceleme Kuralları 5.1.1(v): Apple ile girişi olan uygulama, hesap
// silindiğinde kullanıcının token'larını Apple'ın REST API'siyle iptal etmeli.
// Yapılmazsa kullanıcının Apple ID ayarlarında "Apple ile giriş kullanan
// uygulamalar" listesinde Musubi kalmaya devam eder ve inceleme reddedebilir.
//
// Akış: sunucu Apple refresh token'ı SAKLAMIYOR. Bu yüzden istemci hesap silme
// ekranında Apple ile yeniden yetkilendirme yapıp aldığı taze
// `authorizationCode`'u DELETE /auth/delete-account gövdesinde gönderir.
// Sunucu kodu token'a çevirir (/auth/token) ve hemen iptal eder (/auth/revoke).
//
// Gerekli ortam değişkenleri (Apple Developer > Keys > "Sign in with Apple"):
//   APPLE_TEAM_ID            — 10 karakterlik Team ID
//   APPLE_KEY_ID             — anahtarın Key ID'si
//   APPLE_PRIVATE_KEY_B64    — .p8 dosyasının base64'ü (base64 -w0 AuthKey_XXX.p8)
//   APPLE_REVOKE_CLIENT_ID   — opsiyonel; yoksa APPLE_CLIENT_IDS'in ilki
//                              (iOS'ta uygulamanın bundle id'si)
// Değişkenler yoksa iptal ATLANIR ve uyarı loglanır — silme yine de tamamlanır.
const jwt = require('jsonwebtoken');

const APPLE_BASE = 'https://appleid.apple.com';

const config = () => {
    const teamId = process.env.APPLE_TEAM_ID;
    const keyId = process.env.APPLE_KEY_ID;
    const keyB64 = process.env.APPLE_PRIVATE_KEY_B64;
    const clientId = process.env.APPLE_REVOKE_CLIENT_ID ||
        (process.env.APPLE_CLIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
    if (!teamId || !keyId || !keyB64 || !clientId) return null;
    return { teamId, keyId, clientId, privateKey: Buffer.from(keyB64, 'base64').toString('utf8') };
};

// Apple'a karşı istemci kimliği: .p8 anahtarıyla imzalı kısa ömürlü JWT
const clientSecret = ({ teamId, keyId, clientId, privateKey }) =>
    jwt.sign({}, privateKey, {
        algorithm: 'ES256',
        keyid: keyId,
        issuer: teamId,
        subject: clientId,
        audience: APPLE_BASE,
        expiresIn: '5m'
    });

const postForm = async (path, params) => {
    const res = await fetch(APPLE_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString()
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
};

/**
 * En iyi çaba: hiçbir durumda hata FIRLATMAZ, sonucu döner ve loglar.
 * @returns {Promise<{revoked: boolean, reason?: string}>}
 */
const revokeAppleTokens = async (authorizationCode) => {
    const conf = config();
    if (!conf) {
        console.warn('[apple] token iptali atlandı: APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY_B64/CLIENT_ID tanımlı değil');
        return { revoked: false, reason: 'not_configured' };
    }
    if (typeof authorizationCode !== 'string' || !authorizationCode) {
        console.warn('[apple] token iptali atlandı: istemci authorizationCode göndermedi');
        return { revoked: false, reason: 'missing_code' };
    }

    try {
        const secret = clientSecret(conf);
        const exchange = await postForm('/auth/token', {
            client_id: conf.clientId,
            client_secret: secret,
            code: authorizationCode,
            grant_type: 'authorization_code'
        });
        const token = exchange.body.refresh_token || exchange.body.access_token;
        if (!exchange.ok || !token) {
            console.warn(`[apple] kod token'a çevrilemedi (${exchange.status}): ${exchange.body.error || '?'}`);
            return { revoked: false, reason: 'exchange_failed' };
        }

        const revoke = await postForm('/auth/revoke', {
            client_id: conf.clientId,
            client_secret: secret,
            token,
            token_type_hint: exchange.body.refresh_token ? 'refresh_token' : 'access_token'
        });
        if (!revoke.ok) {
            console.warn(`[apple] iptal başarısız (${revoke.status}): ${revoke.body.error || '?'}`);
            return { revoked: false, reason: 'revoke_failed' };
        }
        return { revoked: true };
    } catch (err) {
        console.error('[apple] token iptali hatası:', err.message);
        return { revoked: false, reason: 'error' };
    }
};

module.exports = { revokeAppleTokens };
