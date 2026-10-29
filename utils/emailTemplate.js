// Musubi işlem e-postası şablonu — "Sade" tasarım (29.10.2026, Emirhan'ın
// seçimi). Kartsız, sola hizalı, az öğe: bir ürün bildirimi gibi okunur ve
// koyu modda, dar ekranda en az bozulan düzen budur.
//
// Mail istemcisi kısıtları (tasarımı bunlar şekillendirdi):
//   • <style> bloğu çoğu istemcide silinir → TÜM stiller inline
//   • flex/grid desteklenmez, Outlook hâlâ tablo motoruyla çizer → tablo düzeni
//   • uzak görseller VARSAYILAN OLARAK ENGELLİDİR → logo yalnızca bonus; alt
//     metni "Musubi" olduğu için engelliyken yerinde marka adı görünür
//   • önizleme metni (preheader) gizli bir div'dir: gelen kutusunda konunun
//     yanındaki gri satırı biz belirleriz, gövdenin ilk cümlesi değil
const { t } = require('./i18n');

const BRAND = '#bc002d';
const INK = '#1a1416';
const TEXT = '#4d4548';
const MUTED = '#8c8387';
const LINE = '#ece5e7';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Metindeki {email} ve {time} yer tutucuları kaçışlanmış değerlerle dolar;
// adres kalın yazılır (alıcı hangi hesabın söz konusu olduğunu hemen görsün)
const fill = (text, { email, time } = {}) => esc(text)
    .replace('{email}', `<b style="color:${INK};">${esc(email)}</b>`)
    .replace('{time}', esc(time));

// Gizli önizleme metni. Arkasındaki görünmez dolgu, istemcinin gövdeden metin
// çekip önizlemeye eklemesini engeller.
const preheaderHtml = (text) =>
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(text)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`;

/**
 * @param {object} o
 * @param {string} o.lang        'tr' | 'en'
 * @param {string} o.preheader   Gelen kutusunda konunun yanında görünen satır
 * @param {string} o.title       Başlık
 * @param {string} o.text        Gövde ({email}, {time} yer tutucularıyla)
 * @param {string} [o.warning]   Koyu yazılan uyarı paragrafı (bilgi maillerinde)
 * @param {string} [o.ctaLabel]  Buton metni — yoksa buton ve yedek link çizilmez
 * @param {string} [o.ctaUrl]    Buton hedefi (mutlak URL)
 * @param {string} o.note        Küçük not (geçerlilik süresi, "sen yapmadıysan")
 * @param {string} o.reason      Alt bilgi: bu maili neden aldığı
 * @param {string} o.email       Alıcının adresi
 * @param {string} [o.time]      {time} yer tutucusunun değeri
 * @param {string} o.logoUrl     Marka logosu (mutlak URL)
 * @param {string} o.privacyUrl  Gizlilik politikası (mutlak URL)
 */
const ctaEmailHtml = (o) => {
    const s = t(o.lang);
    const url = esc(o.ctaUrl);
    const row = (padding, html) => `<tr><td style="padding:${padding};">${html}</td></tr>`;
    const p = (size, color, html) =>
        `<p style="margin:0;font-family:${FONT};font-size:${size}px;line-height:1.65;color:${color};">${html}</p>`;

    const cta = o.ctaLabel ? `
${row('26px 20px 0', `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" bgcolor="${BRAND}" style="background:${BRAND};border-radius:12px;">
    <a href="${url}" style="display:block;padding:15px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(o.ctaLabel)}</a>
  </td></tr></table>`)}` : '';

    // Bazı istemciler butonu (<a>) bozar; düz bağlantı yedeği
    const fallback = o.ctaLabel
        ? row('10px 20px 0', p(13, MUTED,
            `${esc(s.mailFallbackPre)} <a href="${url}" style="color:${BRAND};text-decoration:underline;">${esc(s.mailFallbackLink)}</a>${esc(s.mailFallbackPost)}`))
        : '';

    return `<!DOCTYPE html>
<html lang="${esc(o.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
${preheaderHtml(o.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
${row('8px 20px 0', `<img src="${esc(o.logoUrl)}" width="36" height="36" alt="Musubi" style="display:block;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:16px;font-weight:700;color:${BRAND};">`)}
${row('30px 20px 0', `<h1 style="margin:0;font-family:${FONT};font-size:24px;font-weight:700;line-height:1.3;color:${INK};">${esc(o.title)}</h1>`)}
${row('12px 20px 0', p(15, TEXT, fill(o.text, o)))}
${o.warning ? row('14px 20px 0', p(15, INK, `<b>${fill(o.warning, o)}</b>`)) : ''}${cta}
${row('22px 20px 0', p(13, MUTED, esc(o.note)))}${fallback}
${row('30px 20px 0', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${LINE};padding-top:18px;">
  <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">${esc(o.reason)}</p>
  <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">Musubi · AlpsoySoft · <a href="${esc(o.privacyUrl)}" style="color:${MUTED};text-decoration:underline;">${esc(s.mailPrivacy)}</a></p>
</td></tr></table>`)}
</table>
</td></tr>
</table>
</body>
</html>`;
};

module.exports = ctaEmailHtml;
