// E-posta biçiminin TEK tanımı. Servis (check-email, e-posta değişimi) ve
// User şeması bu deseni kullanır; biri gevşeyip diğeri sıkı kalmasın.
//
// `+` kabul edilir: "ad+etiket@gmail.com" geçerli ve yaygın bir adres. Eski
// desen bunu reddediyor ve kullanıcıya "format yanlış" diyordu (27.10.2026).
// Simülatör (public/app.js) desenin bir kopyasını taşır — değişirse orası da.
const EMAIL_RE = /^[\w.+-]+@([\w-]+\.)+[\w-]{2,}$/;

// Tasarımdaki ("E-posta ile Devam Et") hata metni
const EMAIL_FORMAT_MESSAGE = 'E-posta formatınız yanlış';

// Şemadaki lowercase + trim setter'larının aynısı: desen, şemanın kaydedeceği
// değere karşı denenir ("Emir@X.com " de geçerli sayılır)
const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

module.exports = { EMAIL_RE, EMAIL_FORMAT_MESSAGE, normalizeEmail };
