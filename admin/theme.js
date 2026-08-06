// Temayı sayfa ÇİZİLMEDEN önce uygular.
//
// Ayrı ve minik bir dosya olmasının sebebi: bu iş <head>'de, gövde ayrıştırılmadan
// çalışmalı — yoksa koyu tema seçmiş biri her açılışta bir kare beyaz parlama
// görüyor. Normalde bunun için satır içi <script> yazılır ama production'da
// helmet'in CSP'si `script-src 'self'` olduğu için satır içi script çalışmıyor.
// admin.js gövdenin sonunda yüklendiğinden bu işi ondan devralamaz.
(() => {
    try {
        const secim = localStorage.getItem('musubi_admin_theme');
        // "system" ve geçersiz değerler öznitelik yazmadan geçilir:
        // o durumda prefers-color-scheme medya sorgusu karar verir
        if (secim === 'dark' || secim === 'light') {
            document.documentElement.dataset.theme = secim;
        }
    } catch {
        // localStorage kapalı olabilir (gizli sekme kısıtları) — tema
        // sistem tercihine düşer, panel çalışmaya devam eder
    }
})();
