// Musubi admin paneli — hikâye (bilgi kutucuğu) yönetimi.
//
// Derleme adımı yok, çerçeve yok: repodaki public/ dev konsolu da böyle.
// helmet'in production CSP'si `script-src 'self'` olduğu için bu dosya ayrı
// durmak ZORUNDA — index.html'e inline <script> eklenirse canlıda sessizce
// çalışmaz (dev'de CSP gevşetilmiş olduğundan orada fark edilmez).
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Görsel URL'leri key'den GÖRELİ kurulur. API'nin döndüğü mutlak `url`
    // CLIENT_URL'e bağlı; panel her zaman backend'in kendi origin'inden
    // açıldığı için göreli yol ortam farklarından etkilenmez.
    const imgUrl = (key) => '/uploads/' + key;

    // ---- oturum -------------------------------------------------------------
    // accessToken yalnızca bellekte; refreshToken sessionStorage'da (sekme
    // kapanınca gider). localStorage bilinçli olarak kullanılmıyor: panel
    // ortak bir bilgisayarda açık unutulursa oturum sekmeyle birlikte biter.
    const RT_KEY = 'musubi_admin_rt';
    let accessToken = null;
    let me = null;

    const setRefreshToken = (t) => {
        if (t) sessionStorage.setItem(RT_KEY, t);
        else sessionStorage.removeItem(RT_KEY);
    };
    const getRefreshToken = () => sessionStorage.getItem(RT_KEY);

    async function tryRefresh() {
        const refreshToken = getRefreshToken();
        if (!refreshToken) return false;
        const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });
        if (!res.ok) { setRefreshToken(null); return false; }
        const json = await res.json();
        accessToken = json.data.accessToken;
        return true;
    }

    // Access token 15 dakikada bir ölüyor; her isteği tek seferlik refresh ile
    // sarmak, panelin uzun süre açık kalınca ortada bozulmasını engelliyor
    async function api(method, path, body, { form } = {}) {
        const send = () => fetch('/api' + path, {
            method,
            headers: {
                ...(accessToken && { Authorization: 'Bearer ' + accessToken }),
                ...(!form && body !== undefined && { 'Content-Type': 'application/json' })
            },
            ...(body !== undefined && { body: form ? body : JSON.stringify(body) })
        });

        let res = await send();
        if (res.status === 401 && await tryRefresh()) res = await send();

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(json.message || 'İstek başarısız oldu');
            err.status = res.status;
            throw err;
        }
        return json;
    }

    // ---- tema ---------------------------------------------------------------
    // Üç durum: system (öznitelik yazılmaz, medya sorgusu karar verir), light, dark.
    // İlk uygulama theme.js'te yapılıyor (bkz. oradaki açıklama); burada yalnızca
    // seçim ve kalıcılık var.
    const THEME_KEY = 'musubi_admin_theme';

    function applyTheme(choice) {
        if (choice === 'light' || choice === 'dark') {
            document.documentElement.dataset.theme = choice;
        } else {
            delete document.documentElement.dataset.theme;
        }
        try { localStorage.setItem(THEME_KEY, choice); } catch { /* localStorage kapalı */ }

        for (const btn of $('theme-seg').querySelectorAll('[data-theme-choice]')) {
            btn.setAttribute('aria-pressed', String(btn.dataset.themeChoice === choice));
        }
    }

    $('theme-seg').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-theme-choice]');
        if (btn) applyTheme(btn.dataset.themeChoice);
    });

    (() => {
        let kayitli = 'system';
        try { kayitli = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* yok say */ }
        applyTheme(kayitli);
    })();

    // ---- toast --------------------------------------------------------------
    let toastTimer;
    function toast(message, isError) {
        const el = $('toast');
        el.textContent = message;
        el.classList.toggle('error', Boolean(isError));
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
    }

    // ---- giriş --------------------------------------------------------------
    $('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('login-submit');
        const err = $('login-error');
        err.hidden = true;
        btn.disabled = true;
        btn.textContent = 'Giriş yapılıyor…';

        try {
            const json = await api('POST', '/auth/login', {
                email: $('login-email').value.trim(),
                password: $('login-password').value,
                deviceName: 'admin-panel'
            });
            accessToken = json.accessToken;
            setRefreshToken(json.refreshToken);
            await start();
        } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
        } finally {
            btn.disabled = false;
            btn.textContent = 'Giriş Yap';
        }
    });

    $('logout').addEventListener('click', async () => {
        const refreshToken = getRefreshToken();
        try { await api('POST', '/auth/logout', { refreshToken }); } catch { /* oturum zaten düşmüş olabilir */ }
        accessToken = null;
        setRefreshToken(null);
        me = null;
        $('app-view').hidden = true;
        $('login-view').hidden = false;
    });

    // Panelin kendisi korumasız bir statik dosya; asıl koruma uçlarda. Yine de
    // yönetici olmayan birine boş bir panel göstermek yerine durumu söylüyoruz.
    async function start() {
        const { data } = await api('GET', '/auth/me');
        if (data.role !== 'admin') {
            accessToken = null;
            setRefreshToken(null);
            const err = $('login-error');
            err.textContent = 'Bu hesabın yönetici yetkisi yok.';
            err.hidden = false;
            return;
        }
        me = data;
        $('me-email').textContent = data.email;
        $('login-view').hidden = true;
        $('app-view').hidden = false;
        await loadStories();
    }

    // ---- hikâye listesi -----------------------------------------------------
    // Ekrandaki düzen iki gruptan oluşuyor. Kaynak doğru sayılan şey bu iki id
    // dizisi; `stories` yalnızca id → hikâye çözümü için duruyor.
    let stories = [];
    let pinned = [];
    let normal = [];

    const byId = (id) => stories.find(s => s.id === id);
    const displayOrder = () => [...pinned, ...normal].map(byId).filter(Boolean);

    const statusOf = (s) => {
        if (!s.isActive) return { cls: 'off', label: 'Pasif' };
        if (s.expiresAt && new Date(s.expiresAt) <= new Date()) return { cls: 'expired', label: 'Süresi doldu' };
        return { cls: 'live', label: 'Yayında' };
    };

    async function loadStories() {
        const { data } = await api('GET', '/stories/admin');
        stories = data;
        // Sunucu zaten sıralı döndürüyor (sabitlenenler önce)
        pinned = data.filter(s => s.isPinned).map(s => s.id);
        normal = data.filter(s => !s.isPinned).map(s => s.id);
        renderList();
    }

    // Sayılar kartın üzerinde duruyor çünkü bakılmayan analitik ölü ağırlıktır:
    // Mongo'ya elle sorgu atmak gereken bir kurulum birkaç hafta sonra kimsenin
    // dönüp bakmadığı bir şeye dönüşür. "Hikâye üretmeye devam edeyim mi"
    // sorusunun cevabı burada görünmeli.
    const istatistik = (s) => {
        if (!s.openCount) return 'henüz açılmadı';
        const oran = Math.round(s.completionRate * 100);
        return `${s.openCount} açılma · %${oran} tamamlandı`;
    };

    const cardHtml = (s) => {
        const st = statusOf(s);
        return `
          <article class="story-card ${s.isActive ? '' : 'off'} ${s.isPinned ? 'pinned' : ''}"
                   draggable="true" data-id="${s.id}">
            <button class="pin-btn" data-pin="${s.id}"
                    title="${s.isPinned ? 'Sabitlemeyi kaldır' : 'Başa sabitle'}"
                    aria-label="${s.isPinned ? 'Sabitlemeyi kaldır' : 'Başa sabitle'}">📌</button>
            <div class="story-cover" style="background-image:url('${esc(imgUrl(s.coverKey))}')"></div>
            <span class="badge ${st.cls}">${st.label}</span>
            <h3>${esc(s.title)}</h3>
            <p class="story-meta">${s.slides.length} slayt</p>
            <p class="story-stat">${istatistik(s)}</p>
            <button class="edit-link" data-edit="${s.id}">Düzenle</button>
          </article>`;
    };

    function renderList() {
        $('empty-state').hidden = stories.length > 0;
        // Sabitlenen yokken başlık gösterilmiyor; ama grup varken "Diğerleri"
        // etiketi gerekiyor ki iki bölüm birbirine karışmasın
        $('pinned-section').hidden = pinned.length === 0;
        $('normal-heading').hidden = pinned.length === 0;

        $('pinned-grid').innerHTML = pinned.map(byId).filter(Boolean).map(cardHtml).join('');
        $('story-grid').innerHTML = normal.map(byId).filter(Boolean).map(cardHtml).join('');
    }

    // Kart üzerindeki tıklamalar: düzenle veya pin
    for (const grid of [$('pinned-grid'), $('story-grid')]) {
        grid.addEventListener('click', (e) => {
            const duzenle = e.target.closest('[data-edit]');
            if (duzenle) return openEditor(byId(duzenle.dataset.edit));

            const pin = e.target.closest('[data-pin]');
            if (pin) togglePin(pin.dataset.pin);
        });
    }

    // Grup değiştirme tek yerden geçer: sürükleyerek de, pin düğmesiyle de
    // aynı iki liste yazılır. Hedef grubun SONUNA eklenir.
    function moveToGroup(id, hedefGrup, oncekiId = null) {
        pinned = pinned.filter(x => x !== id);
        normal = normal.filter(x => x !== id);

        const liste = hedefGrup === 'pinned' ? pinned : normal;
        const konum = oncekiId ? liste.indexOf(oncekiId) : -1;
        if (konum === -1) liste.push(id);
        else liste.splice(konum, 0, id);
    }

    async function persistOrder() {
        renderList();
        try {
            await api('PUT', '/stories/order', { pinnedIds: pinned, normalIds: normal });
            // Sunucudaki isPinned değişti; kartların rozeti/başlığı buna bağlı
            const guncel = new Set(pinned);
            for (const s of stories) s.isPinned = guncel.has(s.id);
            renderList();
        } catch (ex) {
            toast(ex.message, true);
            await loadStories(); // sunucu reddettiyse ekranı gerçeğe geri döndür
        }
    }

    function togglePin(id) {
        const s = byId(id);
        if (!s) return;
        moveToGroup(id, pinned.includes(id) ? 'normal' : 'pinned');
        persistOrder();
    }

    // Sürükle-bırak sıralama. Kütüphane yok: HTML5 DnD hem kart ızgarası hem
    // slayt şeridi için yeterli, ikisi de aynı yardımcıyı kullanıyor.
    function enableDrag(container, itemSelector, onMove) {
        let dragged = null;

        container.addEventListener('dragstart', (e) => {
            const item = e.target.closest(itemSelector);
            if (!item) return;
            dragged = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', ''); // Firefox veri olmadan sürüklemeyi başlatmıyor
        });

        container.addEventListener('dragend', () => {
            container.querySelectorAll('.dragging, .drop-target')
                .forEach(el => el.classList.remove('dragging', 'drop-target'));
            dragged = null;
        });

        container.addEventListener('dragover', (e) => {
            if (!dragged) return;
            e.preventDefault();
            const over = e.target.closest(itemSelector);
            container.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
            if (over && over !== dragged) over.classList.add('drop-target');
        });

        container.addEventListener('drop', (e) => {
            if (!dragged) return;
            e.preventDefault();
            const over = e.target.closest(itemSelector);
            if (!over || over === dragged) return;
            const items = [...container.querySelectorAll(itemSelector)];
            onMove(items.indexOf(dragged), items.indexOf(over));
        });
    }

    const moveInArray = (arr, from, to) => {
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
    };

    // Kart sürüklemesi İKİ ızgara arasında çalışmak zorunda (gruplar arası
    // sürükleme = pinle/pinden çıkar), o yüzden sürüklenen eleman ortak
    // durumda tutuluyor — enableDrag'in kapanış içindeki hâli buna yetmiyor.
    let draggedCard = null;

    const temizleIsaretler = () => {
        document.querySelectorAll('.story-card.dragging, .story-card.drop-target')
            .forEach(el => el.classList.remove('dragging', 'drop-target'));
        document.querySelectorAll('.story-grid.drop-zone')
            .forEach(el => el.classList.remove('drop-zone'));
    };

    for (const grid of [$('pinned-grid'), $('story-grid')]) {
        grid.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.story-card');
            if (!item) return;
            draggedCard = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', ''); // Firefox veri olmadan başlatmıyor
        });

        grid.addEventListener('dragend', () => { temizleIsaretler(); draggedCard = null; });

        grid.addEventListener('dragover', (e) => {
            if (!draggedCard) return;
            e.preventDefault();
            document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
            document.querySelectorAll('.story-grid.drop-zone').forEach(el => el.classList.remove('drop-zone'));

            const over = e.target.closest('.story-card');
            if (over && over !== draggedCard) over.classList.add('drop-target');
            // Kartın üstünde değilse hedef grubun kendisi vurgulanır — boş
            // "Sabitlenenler" grubuna ilk kartı bırakabilmenin tek yolu bu
            else if (!over) grid.classList.add('drop-zone');
        });

        grid.addEventListener('drop', (e) => {
            if (!draggedCard) return;
            e.preventDefault();
            const id = draggedCard.dataset.id;
            const over = e.target.closest('.story-card');
            temizleIsaretler();
            draggedCard = null;

            if (over && over.dataset.id === id) return;
            moveToGroup(id, grid.dataset.group, over ? over.dataset.id : null);
            persistOrder();
        });
    }

    // ---- düzenleyici --------------------------------------------------------
    // form.slides key dizisidir; görseller seçilir seçilmez yüklenir, kaydetme
    // anında yalnızca key'ler gönderilir.
    let form = null;
    // Telefon önizlemesinde gösterilen slaytın sırası. Admin yayımlamadan önce
    // tüm slaytları görebilsin diye: küçük resme tıklayınca önizleme oraya geçer.
    let previewIndex = 0;

    function openEditor(story) {
        previewIndex = 0;
        previewMode = 'home';
        form = story
            ? {
                id: story.id,
                title: story.title,
                coverKey: story.coverKey,
                slides: story.slides.map(s => s.imageKey),
                isActive: story.isActive,
                expiresAt: story.expiresAt
            }
            : { id: null, title: '', coverKey: null, slides: [], isActive: true, expiresAt: null };

        $('drawer-title').textContent = story ? 'Hikâyeyi Düzenle' : 'Yeni Hikâye';
        $('story-delete').hidden = !story;
        $('story-title').value = form.title;
        $('story-active').checked = form.isActive;
        $('story-expires').value = toLocalInput(form.expiresAt);
        $('editor-error').hidden = true;

        renderEditor();
        $('drawer').hidden = false;
        $('drawer-scrim').hidden = false;
        $('story-title').focus();
    }

    function closeEditor() {
        form = null;
        $('drawer').hidden = true;
        $('drawer-scrim').hidden = true;
    }

    // datetime-local YEREL saat ister; ISO string doğrudan verilirse tarayıcı
    // saat dilimi farkı kadar kaydırıyor
    function toLocalInput(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function renderEditor() {
        const cover = $('cover-preview');
        cover.classList.toggle('has-image', Boolean(form.coverKey));
        cover.style.backgroundImage = form.coverKey ? `url('${imgUrl(form.coverKey)}')` : '';

        // Silinen/eklenen slayttan sonra seçim diziden taşabilir
        if (previewIndex >= form.slides.length) previewIndex = Math.max(0, form.slides.length - 1);

        $('slide-list').innerHTML = form.slides.map((key, i) => `
          <div class="slide-item ${i === previewIndex ? 'selected' : ''}" draggable="true"
               data-index="${i}" title="Önizlemede göster"
               style="background-image:url('${esc(imgUrl(key))}')">
            <span class="num">${i + 1}</span>
            <button type="button" class="remove" data-remove="${i}" aria-label="Slaytı kaldır">✕</button>
          </div>`).join('');

        renderPreview();
    }

    // 'home' = anasayfa şeridi bağlamı, 'slide' = hikâyenin gerçek tam ekran hâli
    let previewMode = 'home';

    $('pv-modes').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn || !form) return;
        previewMode = btn.dataset.mode;
        renderPreview();
    });

    function renderPreview() {
        for (const btn of $('pv-modes').querySelectorAll('[data-mode]')) {
            btn.setAttribute('aria-pressed', String(btn.dataset.mode === previewMode));
        }
        $('pv-home').hidden = previewMode !== 'home';
        $('pv-slide').hidden = previewMode !== 'slide';
        $('pv-bars').hidden = previewMode !== 'slide' || form.slides.length < 2;

        // Şerit: düzenlenen hikâye, ekrandaki gerçek grup sırasına göre
        // sabitlenmişse başta, değilse sabitlenenlerin ardında görünür
        const digerleri = displayOrder().filter(s => s.id !== form.id && s.isActive);
        const bu = { title: $('story-title').value || 'başlık', coverKey: form.coverKey, seen: false };
        const kendiSirasi = form.id && pinned.includes(form.id) ? 0 : pinned.length;
        const strip = [
            ...digerleri.slice(0, kendiSirasi).map(s => ({ title: s.title, coverKey: s.coverKey, seen: true })),
            bu,
            ...digerleri.slice(kendiSirasi).map(s => ({ title: s.title, coverKey: s.coverKey, seen: true }))
        ].slice(0, 4);

        $('pv-strip').innerHTML = strip.map(s => `
          <div class="pv-story">
            <div class="pv-ring ${s.seen ? 'seen' : ''}"
                 style="${s.coverKey ? `background-image:url('${esc(imgUrl(s.coverKey))}')` : ''}"></div>
            <span>${esc(s.title)}</span>
          </div>`).join('');

        $('pv-bars').innerHTML = form.slides
            .map((_, i) => `<i class="${i === previewIndex ? 'on' : ''}"></i>`).join('');

        const slayt = $('pv-slide');
        const gosterilen = form.slides[previewIndex];
        slayt.classList.toggle('has-image', Boolean(gosterilen));
        slayt.style.backgroundImage = gosterilen ? `url('${imgUrl(gosterilen)}')` : '';
        slayt.textContent = gosterilen ? '' : 'Slayt ekleyince burada tam ekran görünecek';
    }

    $('story-title').addEventListener('input', renderPreview);
    $('drawer-close').addEventListener('click', closeEditor);
    $('drawer-scrim').addEventListener('click', closeEditor);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && form) closeEditor();
    });

    // ---- görsel yükleme -----------------------------------------------------
    async function uploadImage(file, preset) {
        const body = new FormData();
        body.append('preset', preset);
        body.append('image', file);
        const { data } = await api('POST', '/uploads', body, { form: true });
        return data.key;
    }

    $('cover-pick').addEventListener('click', () => $('cover-input').click());
    $('cover-input').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = ''; // aynı dosya art arda seçilebilsin
        if (!file) return;
        try {
            form.coverKey = await uploadImage(file, 'storyCover');
            renderEditor();
        } catch (ex) {
            toast(ex.message, true);
        }
    });

    $('slide-pick').addEventListener('click', () => $('slide-input').click());
    $('slide-input').addEventListener('change', async (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        if (!files.length) return;

        const btn = $('slide-pick');
        btn.disabled = true;
        btn.textContent = `Yükleniyor… (0/${files.length})`;
        try {
            // Sıralı yükleme: hem slayt sırası korunur hem sunucudaki yükleme
            // limitine (30/15dk) tek seferde yığılmaz
            for (let i = 0; i < files.length; i++) {
                form.slides.push(await uploadImage(files[i], 'story'));
                btn.textContent = `Yükleniyor… (${i + 1}/${files.length})`;
                renderEditor();
            }
        } catch (ex) {
            toast(ex.message, true);
        } finally {
            btn.disabled = false;
            btn.textContent = '+ Slayt Ekle';
        }
    });

    $('slide-list').addEventListener('click', (e) => {
        // Silme butonu slaytın İÇİNDE; önce onu ele al, yoksa tıklama
        // "bu slaytı önizle" olarak yorumlanır
        const sil = e.target.closest('[data-remove]');
        if (sil) {
            form.slides.splice(Number(sil.dataset.remove), 1);
            renderEditor();
            return;
        }
        const slayt = e.target.closest('.slide-item');
        if (slayt) {
            previewIndex = Number(slayt.dataset.index);
            // Slayta tıklayan onu görmek istiyor; anasayfa modunda kalırsa
            // tıklamanın hiçbir görünür etkisi olmaz
            previewMode = 'slide';
            renderEditor();
        }
    });

    enableDrag($('slide-list'), '.slide-item', (from, to) => {
        moveInArray(form.slides, from, to);
        renderEditor();
    });

    // ---- kaydet / sil -------------------------------------------------------
    $('story-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('editor-error');
        err.hidden = true;

        const title = $('story-title').value.trim();
        if (!title) return showEditorError('Başlık gerekli.');
        if (!form.coverKey) return showEditorError('Kapak görseli gerekli.');
        if (!form.slides.length) return showEditorError('En az bir slayt ekle.');

        const expiresInput = $('story-expires').value;
        const payload = {
            title,
            coverKey: form.coverKey,
            slides: form.slides,
            isActive: $('story-active').checked,
            expiresAt: expiresInput ? new Date(expiresInput).toISOString() : null
        };

        const btn = $('story-save');
        btn.disabled = true;
        btn.textContent = 'Kaydediliyor…';
        try {
            if (form.id) await api('PUT', '/stories/' + form.id, payload);
            else await api('POST', '/stories', payload);
            closeEditor();
            await loadStories();
            toast('Hikâye kaydedildi');
        } catch (ex) {
            showEditorError(ex.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Kaydet';
        }
    });

    function showEditorError(message) {
        const err = $('editor-error');
        err.textContent = message;
        err.hidden = false;
    }

    $('story-delete').addEventListener('click', async () => {
        if (!confirm('Bu hikâye ve görselleri silinecek. Emin misin?')) return;
        try {
            await api('DELETE', '/stories/' + form.id);
            closeEditor();
            await loadStories();
            toast('Hikâye silindi');
        } catch (ex) {
            showEditorError(ex.message);
        }
    });

    $('new-story').addEventListener('click', () => openEditor(null));

    // ---- açılış -------------------------------------------------------------
    // Sayfa yenilendiğinde sessionStorage'daki refresh token varsa giriş
    // ekranını hiç göstermeden panele dön
    (async () => {
        if (!getRefreshToken()) return;
        try {
            if (await tryRefresh()) await start();
        } catch {
            setRefreshToken(null);
        }
    })();
})();
