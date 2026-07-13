// Google/Apple ID token doğrulama — ek paket gerektirmez: sağlayıcının JWKS
// anahtarları çekilip cache'lenir, imza jsonwebtoken + node:crypto ile doğrulanır.
// Client (mobil SDK) idToken'ı alır, backend burada imza/issuer/audience kontrol eder.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const AppError = require('./AppError');

const PROVIDERS = {
    google: {
        jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audienceEnv: 'GOOGLE_CLIENT_IDS'
    },
    apple: {
        jwksUrl: 'https://appleid.apple.com/auth/keys',
        issuer: 'https://appleid.apple.com',
        audienceEnv: 'APPLE_CLIENT_IDS'
    }
};

const JWKS_TTL = 60 * 60 * 1000;
const jwksCache = {}; // provider -> { keys, fetchedAt }

const getPublicKey = async (provider, kid, forceRefresh = false) => {
    const cached = jwksCache[provider];
    if (!cached || Date.now() - cached.fetchedAt > JWKS_TTL || forceRefresh) {
        const res = await fetch(PROVIDERS[provider].jwksUrl);
        if (!res.ok) throw new AppError('Sağlayıcı anahtarları alınamadı, tekrar deneyin', 502);
        jwksCache[provider] = { keys: (await res.json()).keys, fetchedAt: Date.now() };
    }

    const jwk = jwksCache[provider].keys.find(k => k.kid === kid);
    // Anahtar rotasyonu: kid cache'te yoksa bir kez taze JWKS ile dene
    if (!jwk && !forceRefresh) return getPublicKey(provider, kid, true);
    if (!jwk) throw new AppError('Geçersiz sosyal giriş tokenı', 401);

    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
};

// Doğrulanmış token'dan normalize profil döner:
// { providerId, email, emailVerified, name, surname }
const verifySocialToken = async (provider, idToken) => {
    const conf = PROVIDERS[provider];
    if (!conf) throw new AppError('Desteklenmeyen sağlayıcı (google veya apple olmalı)', 400);
    if (!idToken) throw new AppError('idToken gerekli', 400);

    let payload;
    if (process.env.NODE_ENV === 'test') {
        // Test ortamında dış servise gidilmez (sendEmail'in outbox yaklaşımı):
        // imza doğrulanmadan payload decode edilir, testler sahte token üretir
        payload = jwt.decode(idToken);
        if (!payload) throw new AppError('Geçersiz sosyal giriş tokenı', 401);
    } else {
        const audience = (process.env[conf.audienceEnv] || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        if (!audience.length) {
            throw new AppError(`${conf.audienceEnv} tanımlı değil (.env)`, 500);
        }

        const decoded = jwt.decode(idToken, { complete: true });
        if (!decoded?.header?.kid) throw new AppError('Geçersiz sosyal giriş tokenı', 401);

        const key = await getPublicKey(provider, decoded.header.kid);
        try {
            payload = jwt.verify(idToken, key, {
                algorithms: ['RS256'],
                issuer: conf.issuer,
                audience
            });
        } catch (err) {
            throw new AppError('Geçersiz sosyal giriş tokenı', 401);
        }
    }

    if (!payload.sub || !payload.email) {
        throw new AppError('Sosyal giriş tokenında e-posta bilgisi yok', 400);
    }

    return {
        providerId: payload.sub,
        email: payload.email,
        // Apple bu claim'i boolean yerine 'true' stringi olarak gönderebilir
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: payload.given_name,
        surname: payload.family_name
    };
};

module.exports = verifySocialToken;
