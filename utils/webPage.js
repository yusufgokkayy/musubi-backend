// Tarayıcıya HTML dönen sayfaların ortak kabuğu (mail landing sayfaları +
// hukuki metin sayfaları).
//
// Neden ortak: renk paleti, koyu tema eşikleri ve marka başlığı iki yerde
// yaşarsa biri güncellenip diğeri unutulur. Tasarım tek yerde durur, sayfalar
// yalnızca kendi ek CSS'ini ekler.
//
// Dış kaynak YOK: font, script, stil hepsi gövdenin içinde. Sayfalar
// `default-src 'none'` altında tek istekte açılır — mail istemcisinin
// tarayıcısında, uçak modunda kalmış bir WebView'da bile aynı görünür.
const crypto = require('crypto');
const { t, SUPPORTED } = require('./i18n');

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Renkler Figma'daki Giriş Ekranları tasarımından örneklendi
const BASE_CSS = `
:root{
  --brand:#bc002d; --brand-press:#8f0022; --on-brand:#fff;
  --accent:#bc002d;                 /* metin/çerçeve vurgusu */
  --halo:#f2ccd5;                   /* ikon dairesi */
  --ok:#1d9e75; --warn:#e8b93b; --mid:#ff7700;
  --bg:#f4f2f3; --surface:#fff; --field:#fafafa;
  --text:#1a1a1a; --text2:#4a4a4a; --muted:#8a8a8a; --line:#e6e2e4;
  --shadow:0 1px 2px rgba(0,0,0,.04), 0 12px 32px rgba(60,0,20,.07);
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){
  :root{
    /* Marka kırmızısı koyu zeminde metin olarak okunmuyor; dolgular markada
       kalır (beyaz yazı kontrastı yeterli), vurgu metni açılır */
    --accent:#ff6b85; --halo:rgba(188,0,45,.26);
    --bg:#111013; --surface:#1a181b; --field:#221f23;
    --text:#f3f1f2; --text2:#c6c1c4; --muted:#8d8790; --line:#2f2b31;
    --shadow:0 12px 32px rgba(0,0,0,.4);
  }
}
*{box-sizing:border-box;margin:0}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg); color:var(--text);
  min-height:100vh; min-height:100dvh; display:flex; flex-direction:column;
  align-items:center; justify-content:center; padding:24px 16px; gap:14px;
  -webkit-font-smoothing:antialiased;
}
/* Uzun metin sayfası ortalanmaz, tepeden başlar */
body.doc{justify-content:flex-start;padding:28px 16px 40px}
.brand{display:flex;align-items:center;justify-content:center;gap:9px;margin-bottom:26px}
.brand img{width:30px;height:30px;display:block}
.brand span{font-size:16px;font-weight:700;letter-spacing:.2px}
h1{font-size:21px;line-height:1.3;font-weight:700;margin-bottom:9px;letter-spacing:-.2px}
.lead{color:var(--text2);font-size:15px;line-height:1.6}
.btn{
  display:flex;align-items:center;justify-content:center;gap:8px;
  width:100%;padding:15px;border-radius:14px;border:0;cursor:pointer;
  font-size:16px;font-weight:700;font-family:inherit;
  background:var(--brand);color:var(--on-brand);
  transition:transform .12s ease, background .12s ease, opacity .12s ease;
}
.btn:hover{background:var(--brand-press)}
.btn:active{transform:scale(.985)}
.btn:disabled{opacity:.6;cursor:default;transform:none}
.btn:focus-visible,.eye:focus-visible,input:focus-visible,.lang:focus-visible,a:focus-visible{
  outline:2px solid var(--accent); outline-offset:2px;
}
.fade{animation:fade .28s ease both}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.lang{
  background:none;border:0;font:inherit;font-size:13px;color:var(--muted);
  text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:4px 8px;
}
/* !important ŞART: bu kural BASE_CSS'in içinde, sayfaya özel CSS ise ondan
   SONRA ekleniyor (bkz. sendPage). Aynı özgüllükteki .stack (display:flex) ve
   .mail-chip (display:inline-block) sonra geldiği için düz display:none
   eziliyordu — doğrulama başarılı olduğu hâlde buton ekranda kalıp sonsuza
   kadar dönüyordu. */
.hidden{display:none!important}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

// Marka başlığı (logo + isim). Logo /assets'ten gelir; img-src 'self' yeter.
const BRAND_BAR = `
  <div class="brand">
    <img src="/assets/musubi-logo.png" alt="" width="30" height="30">
    <span>Musubi</span>
  </div>`;

/**
 * Sayfayı CSP nonce'ı ve dil bağlantısıyla birlikte gönderir.
 *
 * @param {string}  o.lang       Aktif dil
 * @param {string}  o.title      <title> (sonuna "— Musubi" eklenir)
 * @param {string}  o.body       <body> içeriği (kendi kapsayıcısıyla birlikte)
 * @param {string} [o.css]       Sayfaya özel ek CSS
 * @param {string} [o.script]    Satır içi script (nonce ile açılır)
 * @param {string} [o.bodyClass] <body> sınıfı ('doc' uzun metin düzeni)
 * @param {string} [o.robots]    'noindex' (varsayılan) | 'index'
 */
const sendPage = (req, res, { lang, title, body, css = '', script, bodyClass = '', robots = 'noindex' }) => {
    // helmet'in genel CSP'si inline script'e izin vermez; bu sayfaların script'i
    // istek başına üretilen nonce ile açılır (unsafe-inline'a gerek kalmadan).
    // img-src 'self': marka logosu /assets'ten gelir, dış kaynak yok.
    const nonce = crypto.randomBytes(16).toString('base64');
    res.set('Content-Security-Policy',
        `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src 'nonce-${nonce}'; connect-src 'self'`);

    const other = SUPPORTED.find(l => l !== lang) || 'en';

    res.type('html').send(`<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${esc(robots)}">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} — Musubi</title>
<style>${BASE_CSS}${css}</style>
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
${body}
<a class="lang" href="${esc(req.path)}?lang=${other}">${esc(t(other).langLabel)}</a>
${script ? `<script nonce="${nonce}">${script}</script>` : ''}
</body>
</html>`);
};

module.exports = { esc, sendPage, BASE_CSS, BRAND_BAR };
