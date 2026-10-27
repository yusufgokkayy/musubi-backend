// Web sayfalarından uygulamaya dönüş. Doğrulama ve şifre sıfırlama web'de
// bitince sayfa KENDİLİĞİNDEN uygulamayı açar; uygulama kurulu değilse
// mağazaya gider (Yusuf'un kararı, 27.10.2026 — "Uygulamaya Dön" butonu yok).
//
// Uygulamayı açan link `musubi://open` ve içinde token YOK. Özel şemaya
// itirazımız token taşımasıydı: aynı şemayı kaydeden başka bir uygulama linki
// kapıp token'ı alabilir. Hiçbir şey taşımayan "uygulamayı aç" linki güvenli.
// Token taşıyan asıl linkler (/verify-email, /reset-password) https kalır;
// uygulama kuruluysa App Links onları doğrudan uygulamaya verir
// (bkz. auth.applinks.routes.js) ve bu sayfaya hiç gelinmez.
//
// Mağaza linkleri ortam değişkeninden gelir. Uygulama mağazada değilken boştur;
// o sürede yer tutucu /indir sayfasına ("çok yakında") gidilir. Linkler
// Railway'e girilince kod değişmeden doğrudan mağazaya gidilir.
const APP_SCHEME_URL = 'musubi://open';

// Paket adı uygulamanın sabit kimliği; ANDROID_PACKAGE yalnızca App Links
// dosyasını açan anahtar olduğu için yoksa da intent çalışmalı
const androidPackage = () => (process.env.ANDROID_PACKAGE || '').trim() || 'com.alpsoy.musubi';

// İstek anında okunur (applinks'teki gibi): değer değişince yeniden başlatma
// yeter, testler de süreç içinde değiştirebilir
const storeLinks = () => ({
    play: (process.env.PLAY_STORE_URL || '').trim() || null,
    appStore: (process.env.APP_STORE_URL || '').trim() || null
});

// Yer tutucunun mutlak adresi: Android intent'inin yedek adresi mutlak olmak
// zorunda. Sayfayı hangi alan adı sunduysa onunkini kullanır (production ve
// staging ayrı alan adlarında).
const placeholderUrl = (req, lang) =>
    `${req.protocol}://${req.get('host')}/indir?lang=${encodeURIComponent(lang)}`;

// Sayfa betiğine gömülecek yapılandırma
const appOpenConfig = (req, lang) => {
    const { play, appStore } = storeLinks();
    const placeholder = placeholderUrl(req, lang);
    return {
        scheme: APP_SCHEME_URL,
        // Chrome intent'i: uygulama kuruluysa açar, değilse yedek adrese gider
        androidIntent: `intent://open#Intent;scheme=musubi;package=${androidPackage()};`
            + `S.browser_fallback_url=${encodeURIComponent(play || placeholder)};end`,
        iosStore: appStore || placeholder
    };
};

// <script> içine güvenle gömülür: "</script>" dizisi JSON'u bölemesin
const inlineJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

// Tarayıcı tarafı. openApp(c) mobilde uygulamayı açmayı dener ve true döner;
// masaüstünde açılacak uygulama olmadığı için hiçbir şey yapmaz, false döner.
//   Android: intent linki uygulamayı açar ya da yedek adrese gider.
//   iOS:     özel şema denenir (Safari "Musubi'de açılsın mı?" diye sorar);
//            1,5 sn sonra sayfa hâlâ önplandaysa uygulama yok demektir →
//            mağaza. Zaman farkı koruması: uygulama açılıp kullanıcı geri
//            dönünce donmuş zamanlayıcı geç tetiklenip mağazaya atmasın.
// Yönlendirme kullanıcının "Doğrula"ya dokunmasının hemen ardından olur;
// tarayıcılar dokunuşa bağlı uygulama açmaya izin verir. Yine de engellenirse
// sayfadaki yedek "Aç" bağlantısı aynı fonksiyonu çağırır.
const APP_OPEN_JS = `
function musubiPlatform(){var u=navigator.userAgent||'';
  if(/Android/i.test(u)) return 'android';
  if(/iPhone|iPad|iPod/i.test(u)||(/Macintosh/.test(u)&&navigator.maxTouchPoints>1)) return 'ios';
  return 'desktop';}
function openApp(c){var p=musubiPlatform();
  if(p==='android'){location.href=c.androidIntent;return true;}
  if(p==='ios'){var t0=Date.now();location.href=c.scheme;
    setTimeout(function(){if(!document.hidden&&Date.now()-t0<3000)location.href=c.iosStore;},1500);
    return true;}
  return false;}
`;

module.exports = { APP_SCHEME_URL, appOpenConfig, storeLinks, inlineJson, APP_OPEN_JS };
