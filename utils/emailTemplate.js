// Musubi işlem e-postası şablonu — "Sade" tasarım (29.10.2026, Emirhan'ın
// seçimi): az öğe, sola hizalı, tek kırmızı vurgu (buton).
//
// İlk sürüm kartsızdı; Gmail'in beyaz sayfasında dar sütun ortada yüzüyor,
// logo yalnız kalıyordu (Yusuf: "yerleri düzgün durmuyor"). Bu yüzden içerik
// açık zemin üstünde beyaz bir karta oturur, başlıkta logo + "Musubi" yan
// yana durur, alt bilgi kartın dışına çıkar.
//
// Mail istemcisi kısıtları (tasarımı bunlar şekillendirdi):
//   • <style> bloğu çoğu istemcide silinir → TÜM stiller inline
//   • flex/grid desteklenmez, Outlook hâlâ tablo motoruyla çizer → tablo düzeni
//   • uzak görseller VARSAYILAN OLARAK ENGELLİDİR → logo yalnızca bonus;
//     yanındaki "Musubi" yazısı görsel olmadan da markayı taşır
//   • önizleme metni (preheader) gizli bir div'dir: gelen kutusunda konunun
//     yanındaki gri satırı biz belirleriz, gövdenin ilk cümlesi değil
//   • Gmail metindeki e-posta adreslerini kendiliğinden mavi link yapar →
//     adres, rengi ve çizgisi bizim belirlediğimiz bir <a> içinde yazılır
const { t } = require('./i18n');

const BRAND = '#bc002d';
const INK = '#1a1416';
const TEXT = '#4d4548';
const MUTED = '#8c8387';
const LINE = '#ece5e7';
const PAGE = '#f6f3f4';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const PAD = '32px';

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Metindeki {email} ve {time} yer tutucuları kaçışlanmış değerlerle dolar.
// Adres kalın ve metin renginde (alıcı hangi hesabın söz konusu olduğunu
// hemen görsün, ama butonla yarışan mavi bir link olmasın).
const fill = (text, { email, time } = {}) => esc(text)
    .replace('{email}', `<a href="mailto:${esc(email)}" style="color:${INK};font-weight:700;text-decoration:none;">${esc(email)}</a>`)
    .replace('{time}', esc(time));

// Gizli önizleme metni. Arkasındaki görünmez dolgu, istemcinin gövdeden metin
// çekip önizlemeye eklemesini engeller.
const preheaderHtml = (text) =>
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(text)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`;

const p = (size, color, html, margin = '0') =>
    `<p style="margin:${margin};font-family:${FONT};font-size:${size}px;line-height:1.6;color:${color};">${html}</p>`;

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

    // Tam genişlik buton: telefonda kolay dokunulur, kartın iki kenarına
    // hizalanıp düzeni toparlar. <a> tek başına Outlook'ta dolgu almadığı
    // için tablo hücresine oturur.
    // Boyutlar hem öznitelik hem stil olarak yazılır: bazı istemciler
    // yalnızca birini dikkate alıyor (logo dev, buton dar çiziliyordu)
    const cta = o.ctaLabel ? row(`28px ${PAD} 0`, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
  <td align="center" bgcolor="${BRAND}" style="background:${BRAND};border-radius:12px;">
    <a href="${url}" style="display:block;padding:15px 24px;text-align:center;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(o.ctaLabel)}</a>
  </td></tr></table>`) : '';

    // Not ve yedek bağlantı tek küçük blokta (bazı istemciler butonu bozar)
    const fallback = o.ctaLabel
        ? p(13, MUTED, `${esc(s.mailFallbackPre)} <a href="${url}" style="color:${BRAND};text-decoration:underline;">${esc(s.mailFallbackLink)}</a>${esc(s.mailFallbackPost)}`, '6px 0 0')
        : '';

    return `<!DOCTYPE html>
<html lang="${esc(o.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
${preheaderHtml(o.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
<tr><td align="center" style="padding:32px 12px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;">
${row(`24px ${PAD} 20px`, `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td style="vertical-align:middle;"><img src="${esc(o.logoUrl)}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border:0;outline:none;text-decoration:none;"></td>
  <td style="vertical-align:middle;padding-left:10px;font-family:${FONT};font-size:17px;font-weight:700;color:${INK};">Musubi</td>
</tr></table>`)}
<tr><td style="padding:0 ${PAD};"><div style="border-top:1px solid ${LINE};font-size:0;line-height:0;">&nbsp;</div></td></tr>
${row(`28px ${PAD} 0`, `<h1 style="margin:0;font-family:${FONT};font-size:24px;font-weight:700;line-height:1.3;color:${INK};">${esc(o.title)}</h1>`)}
${row(`12px ${PAD} 0`, p(15, TEXT, fill(o.text, o)))}
${o.warning ? row(`14px ${PAD} 0`, p(15, INK, `<b>${fill(o.warning, o)}</b>`)) : ''}
${cta}
${row(`24px ${PAD} 30px`, p(13, MUTED, esc(o.note)) + fallback)}
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
${row(`18px ${PAD} 0`, p(12, MUTED, esc(o.reason)) + p(12, MUTED,
    `Musubi · AlpsoySoft · <a href="${esc(o.privacyUrl)}" style="color:${MUTED};text-decoration:underline;">${esc(s.mailPrivacy)}</a>`, '4px 0 0'))}
</table>

</td></tr>
</table>
</body>
</html>`;
};

module.exports = ctaEmailHtml;
