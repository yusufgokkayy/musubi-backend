// Musubi işlem e-postası şablonu — "Sade" tasarım, ORTALI ve ferah düzen.
//
// Tasarım geçmişi (29.10.2026): Emirhan "Sade"yi seçti. Sola hizalı ilk
// sürümde öğeler yerine oturmuyordu; kartlı ikinci sürüm her şeyi sıkıştırdı
// (Yusuf reddetti). Yusuf ortalı düzeni seçti ve daha ferah olmasını istedi:
// büyük logo + altında "Musubi", bölümler arası geniş boşluk, kart ve gri
// zemin yok. Ölçüleri değiştirirken bu geçmişi göz önünde tut.
//
// Mail istemcisi kısıtları (tasarımı bunlar şekillendirdi):
//   • <style> bloğu çoğu istemcide silinir → TÜM stiller inline
//   • flex/grid desteklenmez, Outlook hâlâ tablo motoruyla çizer → tablo düzeni
//   • uzak görseller VARSAYILAN OLARAK ENGELLİDİR → logo yalnızca bonus;
//     altındaki "Musubi" yazısı görsel olmadan da markayı taşır
//   • boyutlar hem öznitelik hem stil olarak yazılır: bazı istemciler
//     yalnızca birini dikkate alıyor
//   • önizleme metni (preheader) gizli bir div'dir: gelen kutusunda konunun
//     yanındaki gri satırı biz belirleriz, gövdenin ilk cümlesi değil
//   • Gmail metindeki e-posta adreslerini kendiliğinden mavi link yapar →
//     adres, rengi ve çizgisi bizim belirlediğimiz bir <a> içinde yazılır
//
// Karanlık tema (29.10.2026, Yusuf: "cihaz temasına uygun olmalı"): renkler
// uygulamanın karanlık temasından ölçüldü (Samsung A54, adb ekran görüntüsü).
// Inline stiller açık temadır; <style> içindeki prefers-color-scheme bloğu
// sınıflar üzerinden karanlık renkleri !important ile basar (Apple Mail, iOS
// Mail, Outlook iOS/Android/Mac). Outlook.com kendi karartmasını yapar ve
// değiştirdiği öğelere data-ogsc/data-ogsb koyar; aynı renkleri onlara da
// veririz. Gmail uygulamaları medya sorgusunu yok sayıp maili kendisi çevirir
// — orada sonucu biz belirleyemeyiz. Logo saydam zeminli kırmızı daire,
// iki temada da aynı görsel kullanılır.
const { t } = require('./i18n');

const BRAND = '#bc002d';
const INK = '#1a1416';
const TEXT = '#4d4548';
const MUTED = '#8c8387';
const LINE = '#ece5e7';

// Uygulamanın karanlık teması
const DARK = {
    bg: '#13141a',
    ink: '#f0f0f0',
    text: '#9ca3af',
    muted: '#80868f',
    line: '#2a2c34',
    brand: '#e8365d',
};

// Inline renk → karanlıkta onu değiştiren sınıf
const COLOR_CLASS = { [INK]: 'm-ink', [TEXT]: 'm-text', [MUTED]: 'm-muted' };

const darkRules = (pre) => `
${pre}.m-bg{background-color:${DARK.bg} !important;}
${pre}.m-ink{color:${DARK.ink} !important;}
${pre}.m-text{color:${DARK.text} !important;}
${pre}.m-muted{color:${DARK.muted} !important;}
${pre}.m-line{border-color:${DARK.line} !important;}
${pre}.m-btn{background-color:${DARK.brand} !important;}
${pre}.m-link{color:${DARK.brand} !important;}`;

// Outlook işaretini kimi sürümde öğenin kendisine, kimi sürümde atasına
// koyar; ikisi de yakalanır.
const OUTLOOK_MARKS = ['[data-ogsc] ', '[data-ogsb] ', '[data-ogsc]', '[data-ogsb]'];

const darkStyle = `<style>
@media (prefers-color-scheme: dark){${darkRules('')}
}${OUTLOOK_MARKS.map(darkRules).join('')}
</style>`;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Metindeki {email} ve {time} yer tutucuları kaçışlanmış değerlerle dolar.
// Adres kalın ve metin renginde: alıcı hangi hesabın söz konusu olduğunu
// hemen görsün, ama butonla yarışan mavi bir link olmasın.
const fill = (text, { email, time } = {}) => esc(text)
    .replace('{email}', `<a class="m-ink" href="mailto:${esc(email)}" style="color:${INK};font-weight:700;text-decoration:none;">${esc(email)}</a>`)
    .replace('{time}', esc(time));

// Gizli önizleme metni. Arkasındaki görünmez dolgu, istemcinin gövdeden metin
// çekip önizlemeye eklemesini engeller.
const preheaderHtml = (text) =>
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(text)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`;

const p = (size, color, html, margin = '0') =>
    `<p class="${COLOR_CLASS[color]}" style="margin:${margin};font-family:${FONT};font-size:${size}px;line-height:1.7;color:${color};text-align:center;">${html}</p>`;

const row = (padding, html) =>
    `<tr><td align="center" style="padding:${padding};text-align:center;">${html}</td></tr>`;

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

    // Buton metni kadar geniş, ortada. <a> tek başına Outlook'ta dolgu
    // almadığı için tablo hücresine oturur.
    const cta = o.ctaLabel ? row('34px 24px 0', `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
  <td class="m-btn" align="center" bgcolor="${BRAND}" style="background:${BRAND};border-radius:12px;">
    <a href="${url}" style="display:block;padding:16px 36px;text-align:center;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(o.ctaLabel)}</a>
  </td></tr></table>`) : '';

    // Bazı istemciler butonu bozar; not ile aynı blokta düz bağlantı yedeği
    const fallback = o.ctaLabel
        ? p(13, MUTED, `${esc(s.mailFallbackPre)} <a class="m-link" href="${url}" style="color:${BRAND};text-decoration:underline;">${esc(s.mailFallbackLink)}</a>${esc(s.mailFallbackPost)}`, '8px 0 0')
        : '';

    return `<!DOCTYPE html>
<html lang="${esc(o.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(o.title)}</title>
${darkStyle}
</head>
<body class="m-bg" style="margin:0;padding:0;background:#ffffff;">
${preheaderHtml(o.preheader)}
<table class="m-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
<tr><td class="m-bg" align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
${row('0 24px', `<img src="${esc(o.logoUrl)}" width="56" height="56" alt="" style="display:block;margin:0 auto;width:56px;height:56px;border:0;outline:none;text-decoration:none;">`)}
${row('10px 24px 0', `<span class="m-ink" style="font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:.2px;color:${INK};">Musubi</span>`)}
${row('36px 24px 0', `<h1 class="m-ink" style="margin:0;font-family:${FONT};font-size:26px;font-weight:700;line-height:1.3;color:${INK};text-align:center;">${esc(o.title)}</h1>`)}
${row('14px 24px 0', p(16, TEXT, fill(o.text, o)))}
${o.warning ? row('16px 24px 0', p(15, INK, `<b>${fill(o.warning, o)}</b>`)) : ''}
${cta}
${row('34px 24px 0', p(13, MUTED, esc(o.note)) + fallback)}
${row('44px 24px 0', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td class="m-line" align="center" style="border-top:1px solid ${LINE};padding-top:22px;">
  ${p(12, MUTED, esc(o.reason))}
  ${p(12, MUTED, `Musubi · Alpsoy Yazılım · <a class="m-muted" href="${esc(o.privacyUrl)}" style="color:${MUTED};text-decoration:underline;">${esc(s.mailPrivacy)}</a>`, '4px 0 0')}
</td></tr></table>`)}
</table>
</td></tr>
</table>
</body>
</html>`;
};

module.exports = ctaEmailHtml;
