// E-postadaki linklerin indiği tarayıcı sayfaları — /api DIŞINDA, HTML döner.
//
// Mail istemcilerinin link tarayıcıları (Gmail prefetch, Outlook SafeLinks)
// GET linklerini kullanıcı tıklamadan takip edebilir; bu yüzden bu sayfalar
// YAN ETKİSİZDİR. Doğrulama/sıfırlama, kullanıcının sayfada tetiklediği
// POST /api/auth/... çağrısıyla ya da uygulamaya deep link ile geçilerek yapılır.
const express = require('express');
const crypto = require('crypto');
const AuthService = require('./auth.service');
const { generalLimiter } = require('../../middlewares/rateLimiter');

const router = express.Router();
router.use(generalLimiter);

const APP_SCHEME = 'musubi';

// crypto.randomBytes(20).toString('hex') → 40 hex karakter. Uymayan token
// DB'ye hiç sorulmadan reddedilir; HTML'e yalnızca bu desenden geçen değer
// gömüldüğü için XSS riski de kalmaz.
const TOKEN_RE = /^[0-9a-f]{40}$/;

const shell = ({ title, body, script, nonce }) => `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Musubi</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f6f5f4; color: #1a1a1a; padding: 16px; }
  .card { background: #fff; border-radius: 16px; padding: 32px 24px; max-width: 400px;
          width: 100%; box-shadow: 0 2px 16px rgba(0,0,0,.08); text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #171514; color: #eee; }
    .card { background: #211f1e; box-shadow: none; }
    p { color: #aaa; }
    input { border-color: #444; }
  }
  .logo { font-size: 32px; margin-bottom: 12px; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  p { color: #666; line-height: 1.5; margin-bottom: 20px; font-size: 15px; }
  .btn { display: block; width: 100%; padding: 14px; border-radius: 12px; border: 0;
         font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none;
         margin-bottom: 10px; font-family: inherit; }
  .btn-primary { background: #c0392b; color: #fff; }
  .btn-secondary { background: transparent; color: #c0392b; border: 1px solid #c0392b; }
  input { width: 100%; padding: 13px; border: 1px solid #ccc; border-radius: 12px;
          font-size: 16px; margin-bottom: 10px; background: transparent; color: inherit; }
  .msg { padding: 12px; border-radius: 10px; font-size: 14px; margin-top: 8px; }
  .msg.ok { background: #e6f6ea; color: #1c7c35; }
  .msg.err { background: #fdecea; color: #b3261e; }
  .hidden { display: none; }
</style>
</head>
<body>
<main class="card">${body}</main>
${script ? `<script nonce="${nonce}">${script}</script>` : ''}
</body>
</html>`;

const sendPage = (res, { title, body, script }) => {
    // helmet'in genel CSP'si inline script'e izin vermez; bu sayfaların script'i
    // istek başına üretilen nonce ile açılır (unsafe-inline'a gerek kalmadan)
    const nonce = crypto.randomBytes(16).toString('base64');
    res.set('Content-Security-Policy',
        `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'`);
    res.type('html').send(shell({ title, body, script, nonce }));
};

const invalidLinkPage = (res) => sendPage(res, {
    title: 'Bağlantı Geçersiz',
    body: `
  <div class="logo">結</div>
  <h1>Bağlantı Geçersiz</h1>
  <p>Bu bağlantı geçersiz veya süresi dolmuş. Uygulamadan yeni bir bağlantı isteyebilirsin.</p>`
});

// Mobil cihazda sayfa açılır açılmaz uygulamayı dener; kurulu değilse veya
// masaüstündeyse sayfadaki butonlar devrededir. (Link tarayıcıları genelde
// JS çalıştırmaz; çalıştırsa bile şema yönlendirmesi yan etkisizdir.)
const autoOpenSnippet = (deepLink) =>
    `if (/android|iphone|ipad|ipod/i.test(navigator.userAgent)) location.href = '${deepLink}';`;

router.get('/verify-email/:token', async (req, res, next) => {
    try {
        const { token } = req.params;
        if (!TOKEN_RE.test(token) || !(await AuthService.isVerificationTokenValid(token))) {
            return invalidLinkPage(res);
        }

        const deepLink = `${APP_SCHEME}://verify-email/${token}`;
        sendPage(res, {
            title: 'E-posta Doğrulama',
            body: `
  <div class="logo">結</div>
  <h1>E-posta Doğrulama</h1>
  <p>Musubi hesabını doğrulamak için uygulamada aç ya da doğrudan burada doğrula.</p>
  <a class="btn btn-primary" href="${deepLink}">Uygulamada Aç</a>
  <button class="btn btn-secondary" id="verify-btn">Burada Doğrula</button>
  <div id="msg"></div>`,
            script: `
var btn = document.getElementById('verify-btn');
var msg = document.getElementById('msg');
btn.addEventListener('click', function () {
  btn.disabled = true;
  btn.textContent = 'Doğrulanıyor…';
  fetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: '${token}' })
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.ok) {
        btn.classList.add('hidden');
        msg.className = 'msg ok';
        msg.textContent = 'E-postan doğrulandı. Artık uygulamaya dönebilirsin.';
      } else {
        btn.disabled = false;
        btn.textContent = 'Burada Doğrula';
        msg.className = 'msg err';
        msg.textContent = j.message || 'Doğrulama başarısız, tekrar dene.';
      }
    });
  }).catch(function () {
    btn.disabled = false;
    btn.textContent = 'Burada Doğrula';
    msg.className = 'msg err';
    msg.textContent = 'Bağlantı hatası, tekrar dene.';
  });
});
${autoOpenSnippet(deepLink)}`
        });
    } catch (err) { next(err); }
});

router.get('/reset-password/:token', async (req, res, next) => {
    try {
        const { token } = req.params;
        if (!TOKEN_RE.test(token) || !(await AuthService.isResetTokenValid(token))) {
            return invalidLinkPage(res);
        }

        const deepLink = `${APP_SCHEME}://reset-password/${token}`;
        sendPage(res, {
            title: 'Yeni Şifre Belirle',
            body: `
  <div class="logo">結</div>
  <h1>Yeni Şifre Belirle</h1>
  <p>Musubi hesabın için yeni şifreni oluştur (en az 8 karakter) ya da uygulamada devam et.</p>
  <a class="btn btn-primary" href="${deepLink}">Uygulamada Aç</a>
  <form id="reset-form">
    <input type="password" name="p1" placeholder="Yeni şifre" minlength="8" required autocomplete="new-password">
    <input type="password" name="p2" placeholder="Yeni şifre (tekrar)" minlength="8" required autocomplete="new-password">
    <button class="btn btn-secondary" type="submit">Şifreyi Güncelle</button>
  </form>
  <div id="msg"></div>`,
            script: `
var form = document.getElementById('reset-form');
var msg = document.getElementById('msg');
form.addEventListener('submit', function (e) {
  e.preventDefault();
  msg.className = '';
  msg.textContent = '';
  if (form.p1.value !== form.p2.value) {
    msg.className = 'msg err';
    msg.textContent = 'Şifreler eşleşmiyor.';
    return;
  }
  var submitBtn = form.querySelector('button');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Güncelleniyor…';
  // deviceName bilerek gönderilmez: tarayıcı için oturum açılmaz,
  // kullanıcı uygulamadan yeni şifresiyle giriş yapar
  fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: '${token}', password: form.p1.value })
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.ok) {
        form.classList.add('hidden');
        msg.className = 'msg ok';
        msg.textContent = 'Şifren güncellendi. Uygulamadan yeni şifrenle giriş yapabilirsin.';
      } else {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Şifreyi Güncelle';
        msg.className = 'msg err';
        msg.textContent = j.message || 'Şifre güncellenemedi, tekrar dene.';
      }
    });
  }).catch(function () {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Şifreyi Güncelle';
    msg.className = 'msg err';
    msg.textContent = 'Bağlantı hatası, tekrar dene.';
  });
});
${autoOpenSnippet(deepLink)}`
        });
    } catch (err) { next(err); }
});

module.exports = router;
