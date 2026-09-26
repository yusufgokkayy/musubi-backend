// Görsel doğrulama ve yeniden kodlama.
//
// Gelen dosyaya iki aşamalı yaklaşılır: önce SİHİRLİ BAYT ile gerçekte ne
// olduğuna bakılır, sonra sharp ile baştan kodlanır. İkisi de güvenlik içindir:
// istemcinin gönderdiği `mimetype` ve dosya adı uydurmadır, tek başına
// "image/png yazıyorsa PNG'dir" demek yükleme ucunu keyfi dosya sunucusuna çevirir.
const sharp = require('sharp');

// Zip bombası muadili: 100x100 görünen ama açılınca gigabaytlarca RAM isteyen
// dosyalar. sharp'ın varsayılanı ~268 megapiksel; 50 MP zaten 8K'nın üstü.
const MAX_INPUT_PIXELS = 50 * 1000 * 1000;

const startsWith = (buf, bytes) =>
    buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

// SVG BİLEREK yok: içine <script> gömülebiliyor ve aynı origin'den servis
// edildiğinde saklı XSS oluyor. "Görsel" olması onu zararsız yapmıyor.
const sniffFormat = (buf) => {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
    if (startsWith(buf, [0xFF, 0xD8, 0xFF])) return 'jpeg';
    if (startsWith(buf, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'png';
    if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    return null;
};

// Yeniden kodlama üç işi birden yapar:
//  1. EXIF/IPTC/XMP temizlenir — telefon fotoğrafları GPS koordinatı taşır ve
//     bir admin kendi konumunu farkında olmadan yayımlayabilir. sharp metadata'yı
//     withMetadata() çağrılmadıkça atar; .rotate() öncesi yön bilgisini uygular
//     ki görsel yan yatmasın.
//  2. Boyut sınırlanır — 6000px'lik bir fotoğraf hikâye dairesinde ekstra bir şey
//     göstermez, yalnızca trafik yakar.
//  3. WebP'e çevrilir — aynı kalitede JPEG'in yarısı kadar; hikâyeler her
//     anasayfa açılışında indirildiği için tek kazançlı yer burası.
// effort 6 (varsayılan 4): aynı kalitede ~%17 küçük dosya, karşılığında ~120 ms
// ekstra encode süresi. Yükleme admin'e özel ve seyrek olduğu için bu takas
// tek taraflı kazanç — kaliteden hiçbir şey verilmiyor.
const WEBP_EFFORT = 6;

// fit: 'inside' en-boy oranını korur (hikâye kartı dikey kalır); 'cover'
// kareyi ortadan kırpar — profil fotoğrafı her yerde daire içinde gösterildiği
// için yatay bir fotoğraf 512x512'lik kareye oturtulur, kenarları boşa gitmez.
const reencodeToWebp = async (buffer, { maxWidth, maxHeight, fit = 'inside', quality = 82 }) => {
    const pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: maxWidth, height: maxHeight, fit, withoutEnlargement: true })
        .webp({ quality, effort: WEBP_EFFORT });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, bytes: data.length };
};

module.exports = { sniffFormat, reencodeToWebp, MAX_INPUT_PIXELS };
