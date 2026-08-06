// Hukuki metinler — hem tarayıcı sayfası hem JSON.
//
// NEDEN BACKEND'DEN SERVİS EDİLİYOR (uygulamaya gömülü değil):
//   1. Metni güncellemek mağaza onayı beklemez. Hukuki bir düzeltme aynı gün
//      yayına girebilir; gömülü metinde bu 1-2 hafta sürer.
//   2. App Store ve Google Play, mağaza kaydında AÇIK ERİŞİLEBİLİR bir
//      gizlilik politikası URL'si ister. /legal/privacy tam olarak budur —
//      bu yüzden bu sayfalar (landing sayfalarının aksine) noindex DEĞİL.
//   3. Uygulama metni çevrimdışı da gösterebilsin diye JSON ucu var; mobil
//      tarafta son çekilen sürüm yedek kopya olarak saklanır.
//
// Sayfalar oturum İSTEMEZ: kullanıcı kayıt olmadan önce okumak zorunda.
const express = require('express');
const { generalLimiter } = require('../../middlewares/rateLimiter');
const { t, langFromRequest } = require('../../utils/i18n');
const { esc, sendPage, BRAND_BAR } = require('../../utils/webPage');
const { DOCS, DOC_KEYS, getDoc, docSummary, CANONICAL_LANG, COMPANY } = require('../../config/legal/texts');

const pages = express.Router();
const api = express.Router();
pages.use(generalLimiter);

/* -------------------------------------------------------------------- css */
const CSS = `
.doc-wrap{width:100%;max-width:720px}
.paper{
  background:var(--surface);border:1px solid var(--line);border-radius:22px;
  padding:34px 28px 30px;box-shadow:var(--shadow);
}
.paper h1{text-align:center;font-size:23px;margin-bottom:14px}
.meta{
  display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:22px;
}
.tag{
  padding:6px 12px;border-radius:999px;background:var(--field);
  border:1px solid var(--line);font-size:12.5px;font-weight:600;color:var(--text2);
}
.notice{
  padding:12px 15px;border-radius:13px;margin-bottom:22px;font-size:13.5px;
  line-height:1.55;background:rgba(188,0,45,.07);color:var(--accent);
}
.intro{
  color:var(--text2);font-size:15px;line-height:1.75;
  padding-bottom:20px;border-bottom:1px solid var(--line);
}
section{margin-top:22px}
h2{font-size:16px;font-weight:700;line-height:1.4;margin-bottom:7px;color:var(--text)}
section p{color:var(--text2);font-size:14.5px;line-height:1.75}
.foot{
  margin-top:28px;padding-top:18px;border-top:1px solid var(--line);
  font-size:12.5px;line-height:1.6;color:var(--muted);text-align:center;
}
/* Metin listesi (index) */
.doc-list{display:flex;flex-direction:column;gap:11px;margin-top:22px}
.doc-link{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:16px 18px;border-radius:16px;border:1px solid var(--line);
  background:var(--field);color:var(--text);text-decoration:none;text-align:left;
  transition:border-color .15s ease;
}
.doc-link:hover{border-color:var(--accent)}
.doc-link strong{display:block;font-size:15px;font-weight:700;line-height:1.35}
.doc-link small{display:block;margin-top:3px;font-size:12.5px;color:var(--muted)}
.doc-link .chev{color:var(--muted);flex:none}
.back{
  display:inline-block;margin-bottom:18px;font-size:13.5px;color:var(--accent);
  text-decoration:none;font-weight:600;
}
.back:hover{text-decoration:underline}
`;

const CHEVRON = `<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>`;

// Yürürlük tarihi kullanıcının okuduğu dile göre biçimlenir (2026-08-04 →
// "4 Ağustos 2026" / "August 4, 2026"). Tarih dizesi TZ'siz olduğu için
// UTC'de parse edilir; yerel saate göre bir gün kayması olmaz.
const formatDate = (iso, lang) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'tr-TR', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(d);
};

/* ------------------------------------------------------------- sayfalar */

// Metin listesi — mağaza kaydından ya da uygulamadan tek noktaya link verilir
pages.get('/legal', (req, res) => {
    const lang = langFromRequest(req);
    const s = t(lang);

    const items = DOC_KEYS.map(key => {
        const d = DOCS[key];
        return `
    <a class="doc-link" href="/legal/${esc(d.key)}?lang=${esc(lang)}">
      <span>
        <strong>${esc(d.title)}</strong>
        <small>${esc(s.legalVersion)} ${esc(d.version)} · ${esc(formatDate(d.effectiveDate, lang))}</small>
      </span>
      ${CHEVRON}
    </a>`;
    }).join('');

    sendPage(req, res, {
        lang, css: CSS, bodyClass: 'doc', robots: 'index',
        title: s.legalIndexTitle,
        body: `<main class="doc-wrap fade">
  <div class="paper">
    ${BRAND_BAR}
    <h1>${esc(s.legalIndexHeading)}</h1>
    <p class="lead" style="text-align:center">${esc(s.legalIndexLead)}</p>
    <div class="doc-list">${items}</div>
    <div class="foot">${esc(COMPANY)}</div>
  </div>
</main>`
    });
});

pages.get('/legal/:doc', (req, res) => {
    const lang = langFromRequest(req);
    const s = t(lang);
    const doc = getDoc(req.params.doc);

    if (!doc) {
        res.status(404);
        return sendPage(req, res, {
            lang, css: CSS, bodyClass: 'doc',
            title: s.legalNotFoundTitle,
            body: `<main class="doc-wrap fade">
  <div class="paper">
    ${BRAND_BAR}
    <h1>${esc(s.legalNotFoundTitle)}</h1>
    <p class="lead" style="text-align:center">${esc(s.legalNotFoundText)}</p>
    <div class="foot"><a class="back" href="/legal?lang=${esc(lang)}">${esc(s.legalBack)}</a></div>
  </div>
</main>`
        });
    }

    const sections = doc.sections.map(sec => `
    <section>
      <h2>${esc(sec.heading)}</h2>
      <p>${esc(sec.body)}</p>
    </section>`).join('');

    // Metin Türkçe; İngilizce okuyan kullanıcıya bu durum açıkça söylenir
    const notice = lang !== CANONICAL_LANG && s.legalTrOnly
        ? `<div class="notice">${esc(s.legalTrOnly)}</div>`
        : '';

    sendPage(req, res, {
        lang, css: CSS, bodyClass: 'doc', robots: 'index',
        title: doc.title,
        body: `<main class="doc-wrap fade">
  <div class="paper">
    ${BRAND_BAR}
    <a class="back" href="/legal?lang=${esc(lang)}">← ${esc(s.legalBack)}</a>
    <h1>${esc(doc.title)}</h1>
    <div class="meta">
      <span class="tag">${esc(s.legalVersion)} ${esc(doc.version)}</span>
      <span class="tag">${esc(s.legalEffective)}: ${esc(formatDate(doc.effectiveDate, lang))}</span>
    </div>
    ${notice}
    <p class="intro">${esc(doc.intro)}</p>
    ${sections}
    <div class="foot">${esc(COMPANY)}</div>
  </div>
</main>`
    });
});

/* ------------------------------------------------------------ json ucu */
// Uygulama metni kendi tasarımıyla (koyu tema, yazı tipi, kaydırma) göstermek
// isterse WebView yerine bunu kullanır. Yapı sabit: intro + sections[].
api.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        data: { lang: CANONICAL_LANG, company: COMPANY, docs: DOC_KEYS.map(docSummary) }
    });
});

api.get('/:doc', (req, res) => {
    const doc = getDoc(req.params.doc);
    if (!doc) {
        return res.status(404).json({ success: false, message: 'Legal document not found' });
    }
    res.status(200).json({
        success: true,
        data: { ...doc, lang: CANONICAL_LANG, company: COMPANY, url: `/legal/${doc.key}` }
    });
});

module.exports = { pages, api };
