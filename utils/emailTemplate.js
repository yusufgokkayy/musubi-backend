// Musubi işlem e-postası şablonu.
//
// Mail istemcisi kısıtları (tasarımı bunlar şekillendirdi):
//   • <style> bloğu çoğu istemcide silinir → TÜM stiller inline
//   • flex/grid desteklenmez, Outlook hâlâ tablo motoruyla çizer → tablo düzeni
//   • uzak görseller VARSAYILAN OLARAK ENGELLİDİR → tasarım logosuz da eksiksiz
//     durmalı; logo bir bonus, taşıyıcı öğe değil (bu yüzden marka bandı renkli
//     bir tablo hücresi, görsel değil)
//   • dark mode desteği istemciden istemciye değişir → koyu zeminde de okunan
//     renkler seçildi, prefers-color-scheme'e güvenilmiyor
const { t } = require('./i18n');

const BRAND = '#bc002d';
const INK = '#1a1a1a';
const MUTED = '#8a8a8a';
const LINE = '#ececec';

// Kullanıcı verisi gövdeye girmiyor (yalnızca sabit metinler ve bizim
// ürettiğimiz URL) ama şablon ileride adla kişiselleştirilirse diye kaçış hazır
const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * @param {object} o
 * @param {string} o.lang      'tr' | 'en'
 * @param {string} o.title     Başlık (i18n'den)
 * @param {string} o.text      Açıklama paragrafı
 * @param {string} o.ctaLabel  Buton metni
 * @param {string} o.ctaUrl    Buton hedefi (mutlak URL)
 * @param {string} o.note      Küçük punto uyarı notu
 * @param {string} [o.logoUrl] Marka logosu (yoksa bant tek başına yeter)
 */
const ctaEmailHtml = ({ lang = 'tr', title, text, ctaLabel, ctaUrl, note, logoUrl }) => {
    const s = t(lang);
    const url = esc(ctaUrl);

    return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f2f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f2f3;padding:32px 12px;">
<tr><td align="center">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden;
                border:1px solid ${LINE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

    <!-- Marka bandı: renk bir tablo hücresinden gelir, görsel engellense de durur -->
    <tr><td align="center" style="background:${BRAND};padding:26px 24px;">
      ${logoUrl ? `<img src="${esc(logoUrl)}" width="52" height="52" alt=""
           style="display:block;width:52px;height:52px;border:0;outline:none;
                  text-decoration:none;margin:0 auto 10px;">` : ''}
      <div style="color:#ffffff;font-size:21px;font-weight:700;letter-spacing:.3px;line-height:1;">Musubi</div>
      <div style="color:#ffd7e0;font-size:12px;margin-top:6px;line-height:1.4;">${esc(s.brandTagline)}</div>
    </td></tr>

    <tr><td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;color:${INK};font-weight:700;">${esc(title)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.65;color:#4a4a4a;">${esc(text)}</p>
    </td></tr>

    <!-- CTA: <a> tek başına Outlook'ta dolgu almıyor, o yüzden tablo hücresine oturuyor -->
    <tr><td style="padding:24px 28px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td align="center" bgcolor="${BRAND}" style="background:${BRAND};border-radius:12px;">
          <a href="${url}"
             style="display:block;padding:15px 24px;font-size:16px;font-weight:700;
                    color:#ffffff;text-decoration:none;border-radius:12px;">${esc(ctaLabel)}</a>
        </td></tr>
      </table>
    </td></tr>

    <!-- Buton tıklanamazsa (bazı istemciler <a>'yı bozar) düz adres -->
    <tr><td style="padding:18px 28px 0;">
      <p style="margin:0 0 6px;font-size:12px;color:${MUTED};line-height:1.5;">${esc(s.mailButtonFallback)}</p>
      <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">
        <a href="${url}" style="color:${BRAND};text-decoration:underline;">${url}</a>
      </p>
    </td></tr>

    <tr><td style="padding:22px 28px 28px;">
      <div style="border-top:1px solid ${LINE};padding-top:16px;">
        <p style="margin:0 0 8px;font-size:12px;color:${MUTED};line-height:1.6;">${esc(note)}</p>
        <p style="margin:0;font-size:11px;color:#b0b0b0;line-height:1.5;">${esc(s.mailFooter)}</p>
      </div>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
};

module.exports = ctaEmailHtml;
