// Hesap bazlı giriş denemesi kısıtı.
//
// Neden IP limiti yetmiyor: rateLimiter'daki authLimiter IP başına 20/15dk
// sayar. Elinde çok sayıda IP olan bir saldırgan (VPN havuzu, botnet) TEK bir
// hesabın şifresini bu limite hiç takılmadan deneyebilir. Buradaki sayaç hedef
// HESABIN dokümanında tutulduğu için IP değiştirmek işe yaramaz.
//
// ⚠️ Kilitlemenin kendisi bir DoS aracıdır: kurbanın e-postasını bilen biri
// bilerek yanlış şifre deneyip onu kilitleyebilir. Bu yüzden:
//   - kilit süresi KISA ve kademelidir (dakikalar, saatler değil)
//   - başarılı girişte sayaç tamamen sıfırlanır
//   - hata penceresi dolunca sayaç kendiliğinden sıfırlanır
// Amaç saldırganı imkânsıza zorlamak değil, deneme hızını kaba kuvvetin
// işe yaramayacağı kadar düşürmek.
const AppError = require('./AppError');

// Bu süre içinde biriken hatalar sayılır; son hatadan bu kadar sonra
// sayaç sıfırdan başlar
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

// Eşiği geçen her adımda kilit süresi artar (kademeli). En yüksek adım tavandır.
const LOCK_STEPS = [
    { failures: 5, lockMs: 1 * 60 * 1000 },
    { failures: 10, lockMs: 5 * 60 * 1000 },
    { failures: 15, lockMs: 15 * 60 * 1000 }
];

const slot = (user) => {
    if (!user.loginThrottle) user.loginThrottle = { failureCount: 0 };
    return user.loginThrottle;
};

// Hesap kilitliyse 429 atar. Şifre KARŞILAŞTIRILMADAN önce çağrılmalı:
// kilitliyken bcrypt çalıştırmak hem gereksiz iş hem de saldırgana
// zaman penceresi verir.
const assertLoginAllowed = (user) => {
    const s = slot(user);
    if (!s.lockedUntil) return;

    const remainingMs = new Date(s.lockedUntil).getTime() - Date.now();
    if (remainingMs <= 0) return;

    const err = new AppError(
        'Çok fazla hatalı giriş denemesi yapıldı, lütfen biraz bekleyip tekrar deneyin',
        429
    );
    err.retryAfterSeconds = Math.ceil(remainingMs / 1000);
    throw err;
};

// Hatalı şifre sonrası. Dokümanı KAYDETMEZ — çağıran save() eder.
// Dönen değer: kilit uygulandıysa kilidin bitiş anı, yoksa null.
const recordLoginFailure = (user) => {
    const s = slot(user);
    const now = Date.now();

    // Pencere dolduysa temiz sayfa (eski hatalar sonsuza kadar birikmesin)
    const windowFresh = s.firstFailureAt &&
        (now - new Date(s.firstFailureAt).getTime()) < FAILURE_WINDOW_MS;
    if (!windowFresh) {
        s.firstFailureAt = new Date(now);
        s.failureCount = 0;
    }

    s.failureCount += 1;

    // Ulaşılan en yüksek eşiğin süresi geçerlidir
    const step = [...LOCK_STEPS].reverse().find(x => s.failureCount >= x.failures);
    if (step) {
        s.lockedUntil = new Date(now + step.lockMs);
    }

    user.markModified('loginThrottle');
    return step ? s.lockedUntil : null;
};

// Başarılı giriş: sayaç tamamen sıfırlanır ki meşru kullanıcı, geçmişteki
// dağınık hatalar yüzünden ileride sürpriz bir kilitle karşılaşmasın.
// Yazma gerekiyorsa true döner (her başarılı girişte boş yere save etmeyelim).
const clearLoginFailures = (user) => {
    const s = user.loginThrottle;
    if (!s || (!s.failureCount && !s.lockedUntil && !s.firstFailureAt)) return false;

    user.loginThrottle = { failureCount: 0 };
    user.markModified('loginThrottle');
    return true;
};

module.exports = {
    assertLoginAllowed,
    recordLoginFailure,
    clearLoginFailures,
    FAILURE_WINDOW_MS,
    LOCK_STEPS
};
