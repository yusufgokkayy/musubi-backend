// Ana sayfa (/) ve /indir: uygulamanın tanıtım ve indirme sayfası.
//
// İki işi var:
//   1. Mağaza linklerinin YER TUTUCUSU. Uygulama henüz mağazada değil;
//      doğrulama/sıfırlama sonrası uygulama kurulu değilse kullanıcı buraya
//      gelir ve "çok yakında" görür (bkz. utils/appOpen.js). PLAY_STORE_URL /
//      APP_STORE_URL girilince aynı sayfada mağaza butonları belirir ve
//      yönlendirmeler doğrudan mağazaya gider — kod değişmez.
//   2. Ana adres eskiden "Cannot GET /" diyordu; mail linkini ya da alan adını
//      açan kişi artık ürünü görür.
//
// Geliştirme ortamında (NODE_ENV=development) "/" simülatörü açar: public/
// statik servisi app.js'te bu router'dan ÖNCE bağlı. /indir her ortamda burada.
const express = require('express');
const { generalLimiter } = require('../../middlewares/rateLimiter');
const { t, langFromRequest } = require('../../utils/i18n');
const { esc, sendPage } = require('../../utils/webPage');
const { storeLinks } = require('../../utils/appOpen');

const router = express.Router();

const CSS = `
.card{
  background:var(--surface); border:1px solid var(--line); border-radius:22px;
  padding:40px 26px 30px; width:100%; max-width:410px;
  box-shadow:var(--shadow); text-align:center;
}
.logo{width:84px;height:84px;display:block;margin:0 auto 14px;border-radius:22px}
.word{font-size:15px;font-weight:700;letter-spacing:.3px;color:var(--accent);margin-bottom:18px}
h1{font-size:24px}
.stores{margin-top:26px;display:flex;flex-direction:column;gap:10px}
.btn{text-decoration:none}
.btn.alt{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
.btn.alt:hover{background:var(--halo)}
.soon{
  display:inline-block;margin-top:26px;padding:10px 18px;border-radius:999px;
  background:var(--halo);color:var(--accent);font-size:14px;font-weight:700;
}
.links{margin-top:26px;font-size:13px;color:var(--muted)}
.links a{color:var(--muted);text-underline-offset:3px}
`;

const downloadPage = (req, res) => {
    const lang = langFromRequest(req);
    const s = t(lang);
    const { play, appStore } = storeLinks();

    // Link girilmiş mağaza butonla, hiçbiri yoksa "çok yakında" rozetiyle
    const stores = play || appStore
        ? `<div class="stores">
    ${play ? `<a class="btn" href="${esc(play)}" rel="noopener">${esc(s.dlPlay)}</a>` : ''}
    ${appStore ? `<a class="btn${play ? ' alt' : ''}" href="${esc(appStore)}" rel="noopener">${esc(s.dlAppStore)}</a>` : ''}
  </div>`
        : `<div class="soon">${esc(s.dlSoon)}</div>`;

    sendPage(req, res, {
        lang,
        title: s.dlTitle,
        css: CSS,
        robots: 'index',
        body: `<main class="card fade">
  <img class="logo" src="/assets/musubi-logo.png" alt="Musubi" width="84" height="84">
  <div class="word">Musubi</div>
  <h1>${esc(s.brandTagline)}</h1>
  <p class="lead">${esc(s.dlLead)}</p>
  ${stores}
  <p class="links">
    <a href="/legal/privacy?lang=${lang}">${esc(s.dlPrivacy)}</a> ·
    <a href="/legal?lang=${lang}">${esc(s.dlLegal)}</a>
  </p>
</main>`
    });
};

router.get('/', generalLimiter, downloadPage);
router.get('/indir', generalLimiter, downloadPage);

module.exports = router;
