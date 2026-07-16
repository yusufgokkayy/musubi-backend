// Tek CTA'lı e-posta gövdesi. Link buton görünümlü <a href> olarak gömülür:
// düz metin URL'ler bazı mail istemcilerinin link sarmalayıcılarından geçerken
// bozulabiliyor. Stiller inline'dır — mail istemcileri <style> bloğu desteklemez.
const ctaEmailHtml = ({ text, ctaLabel, ctaUrl, note }) => `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="color:#c0392b;margin:0 0 16px">Musubi</h2>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px">${text}</p>
  <a href="${ctaUrl}" style="display:inline-block;background:#c0392b;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:bold">${ctaLabel}</a>
  <p style="font-size:12px;color:#888;margin:24px 0 0">${note}</p>
</div>`;

module.exports = ctaEmailHtml;
