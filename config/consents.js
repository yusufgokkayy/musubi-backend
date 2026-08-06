// Hukuki metinlerin YÜRÜRLÜKTEKİ sürümleri.
//
// Sürümler METNİN KENDİSİNDEN türetilir (config/legal/texts.js). Eskiden burada
// elle yazılıydı; iki yerde durunca er ya da geç ayrışırlar ve "kullanıcı 1.0'a
// rıza verdi" kaydı hangi metne ait olduğu belirsiz hâle gelir. Tek kaynak:
// metni değiştiren kişi sürümü de aynı dosyada yükseltir.
//
// Backend yalnızca "kim, ne zaman, hangi SÜRÜME rıza verdi" bilgisini
// kanıtlanabilir biçimde saklar. KVKK'da açık rızanın ispatı veri
// sorumlusundadır ve geçmişe dönük rıza üretilemez — bu yüzden kayıt anında
// yazılır.
//
// ⚠️ Bir sürümü yükseltmek = TÜM kullanıcılardan yeniden rıza istemek demektir.
// Uygulama açılışta GET /api/auth/consents ile sürümü okur; değiştiyse yeni
// metni gösterip PUT /api/auth/consents ile tekrar rıza alır.
const { DOC_KEYS, DOCS } = require('./legal/texts');

const CONSENT_DOCS = DOC_KEYS;

const CURRENT_CONSENT_VERSIONS = Object.fromEntries(
    DOC_KEYS.map(key => [key, DOCS[key].version])
);

module.exports = { CONSENT_DOCS, CURRENT_CONSENT_VERSIONS };
