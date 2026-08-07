// iOS Universal Links / Android App Links doğrulama dosyaları.
//
// Mail linkleri (/verify-email/:token, /reset-password/:token) HTTPS OLARAK
// KALIR; custom scheme (musubi://) BİLEREK yok, çünkü aynı şemayı kaydeden
// başka bir uygulama linki kapıp token'ı çalabilir. Buradaki iki dosya,
// işletim sistemine "bu alan adı şu uygulamaya aittir" der:
//
//   uygulama kuruluysa  → link uygulamada açılır (uygulama kendi ekranını
//                         gösterip POST /api/auth/reset-password'e gider)
//   kurulu değilse      → aynı link mevcut landing sayfasına iner
//
// Yani web hâlâ TEK KAYNAK; deep link yalnızca hızlandırıcıdır. Masaüstünden
// açılan mail, uygulaması olmayan cihaz ve doğrulaması düşmüş bir kurulum —
// üçü de web sayfasına düşer, hiçbir akış deep link'e BAĞLI değildir.
const express = require('express');

const router = express.Router();

// Yalnızca mail linklerinin indiği yollar iddia edilir. Tüm siteyi (/*)
// iddia etmek admin panelini ve hukuki metin sayfalarını da uygulamaya
// yönlendirirdi: kullanıcı tarayıcıda açtığını sanarken uygulamaya düşerdi.
const LINK_PATHS = ['/verify-email/*', '/reset-password/*'];

const list = (raw) => (raw || '').split(',').map(s => s.trim()).filter(Boolean);

// Değerler HER İSTEKTE okunur (modül yüklenirken değil): kimlikler ortam
// değişkeninden gelir ve eksikken dosyayı 404 tutmak, yarım dosya
// yayımlamaktan iyidir. iOS bu dosyayı kendi CDN'i üzerinden, Android ise
// kurulum anında çeker ve İKİSİ DE ÖNBELLEĞE ALIR; hatalı içerik saatlerce
// yapışır, 404 ise yalnızca "henüz eşleşme yok" demektir (link web'e iner).
const notConfigured = (res) =>
    res.status(404).json({ success: false, message: 'App association not configured' });

// Apple: dosya UZANTISIZ ve application/json olmalı, yönlendirme kabul
// edilmez. iOS 13+ `components`i okur, daha eskiler `paths`i — ikisi de
// yazılır ki tek dosya iki sürüme birden yetsin.
router.get('/.well-known/apple-app-site-association', (req, res) => {
    const appIDs = list(process.env.IOS_APP_IDS);
    if (!appIDs.length) return notConfigured(res);

    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/json').json({
        applinks: {
            apps: [],
            details: appIDs.map(appID => ({
                appID,
                appIDs: [appID],
                paths: LINK_PATHS,
                components: LINK_PATHS.map(path => ({ '/': path }))
            }))
        }
    });
});

// Android: bu dosya YOL KISITI TAŞIMAZ, yalnızca alan adı–uygulama eşlemesi
// kurar; hangi yolların uygulamada açılacağı manifest'teki intent-filter ile
// belirlenir (uygulama tarafının işi). Birden fazla parmak izi verilebilir —
// Play App Signing ile yayınlanan sürümün imzası geliştirme imzasından
// farklıdır, ikisi de listelenmezse bir taraf doğrulamayı geçemez.
router.get('/.well-known/assetlinks.json', (req, res) => {
    const packageName = (process.env.ANDROID_PACKAGE || '').trim();
    const fingerprints = list(process.env.ANDROID_CERT_FINGERPRINTS);
    if (!packageName || !fingerprints.length) return notConfigured(res);

    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/json').json([{
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
            namespace: 'android_app',
            package_name: packageName,
            sha256_cert_fingerprints: fingerprints
        }
    }]);
});

module.exports = router;
module.exports.LINK_PATHS = LINK_PATHS;
