/* Musubi mobil simülatör — gerçek backend API'sine bağlı, Figma akışını
   izleyen bir "telefon" arayüzü. Mobil client durduğu için manuel curl/dev-panel
   testi yerine gerçek kullanıcı akışıyla (kayıt→doğrulama→ders→sınav→ayarlar)
   tıklanarak test edilsin diye yazıldı. Aynı origin'den servis edilir (CORS yok);
   helmet CSP nedeniyle tüm JS bu dosyadadır. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];

// ───────────────────────── Durum ─────────────────────────
const state = {
  access: localStorage.getItem('musubi_access') || null,
  refresh: localStorage.getItem('musubi_refresh') || null,
  me: null,                 // GET /auth/me sonucu (yalnızca doğrulanmış hesapta dolu)
  stack: [{ name: 'welcome' }],
  wizard: {},                // kayıt sihirbazı: email/name/surname biriktirir
  devVerificationToken: localStorage.getItem('musubi_dev_vtoken') || null,
  devResetToken: localStorage.getItem('musubi_dev_rtoken') || null,
  checkedPlacement: false,   // "Seviyeni Öğrenelim mi?" oturum başına bir kez
  lesson: null,
  quiz: null,
  library: { page: 1, totalPages: 1 },
  levels: { selected: null, mastery: '' }
};

const TAB_ROOTS = ['home', 'library', 'levels', 'settings'];

// ───────────────────────── API istemcisi ─────────────────────────
async function api(method, path, body, opts = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && state.access) headers.Authorization = 'Bearer ' + state.access;

  let res, json;
  try {
    res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    toast('Sunucuya ulaşılamadı — backend çalışıyor mu?', 'err');
    return { ok: false, status: 0, json: { message: 'network error' } };
  }

  if (res.status === 401 && json.message === 'Token expired' && state.refresh && !opts._retried) {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: state.refresh })
    });
    const rj = await r.json().catch(() => ({}));
    if (r.ok && rj.data?.accessToken) {
      setTokens(rj.data.accessToken, state.refresh);
      return api(method, path, body, { ...opts, _retried: true });
    }
    setTokens(null, null);
    reset('welcome');
    toast('Oturum süresi doldu, tekrar giriş yap', 'err');
  }

  return { ok: res.ok, status: res.status, json };
}

function guard(res, okMsg) {
  if (!res.ok) { toast(res.json.message || `Hata (${res.status})`, 'err'); return false; }
  if (okMsg) toast(okMsg, 'ok');
  return true;
}

function setTokens(access, refresh) {
  state.access = access; state.refresh = refresh;
  if (access) localStorage.setItem('musubi_access', access); else localStorage.removeItem('musubi_access');
  if (refresh) localStorage.setItem('musubi_refresh', refresh); else localStorage.removeItem('musubi_refresh');
  renderDevBar();
}

function toast(msg, kind = '') {
  const host = $('#toasts') || (() => { const d = document.createElement('div'); d.id = 'toasts'; $('.phone').appendChild(d); return d; })();
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

// ───────────────────────── Navigasyon ─────────────────────────
function go(name, data) { state.stack.push({ name, data }); renderCurrent(); }
function reset(name, data) { state.stack = [{ name, data }]; renderCurrent(); }
function back() { if (state.stack.length > 1) state.stack.pop(); renderCurrent(); }
function current() { return state.stack[state.stack.length - 1]; }

// Ekranlar arası hızlı geçişte (örn. veri henüz dönmeden geri tuşuna basmak)
// bir önceki ekranın bekleyen async render'ı DOM'a yazmaya çalışırsa ya var
// olmayan bir alt elemente null.innerHTML hatası atar ya da güncel ekranı
// sessizce ezer. Her navigasyonda artan token, async fonksiyonların "hâlâ
// güncel ekran ben miyim?" diye kontrol etmesini sağlar.
let activeToken = 0;
function stale(token) { return token !== activeToken; }

function renderCurrent() {
  activeToken++;
  const top = current();
  renderTabbar(top.name);
  SHOW[top.name](top.data || {});
}

function renderTabbar(name) {
  const slot = $('#tabbar-slot');
  if (!TAB_ROOTS.includes(name)) { slot.innerHTML = ''; return; }
  const tabs = [
    ['home', '🏠', 'Anasayfa'], ['library', '📚', 'Kütüphane'],
    ['levels', '📊', 'Seviyeler'], ['settings', '⚙️', 'Ayarlar']
  ];
  slot.innerHTML = `<div class="tabbar">${tabs.map(([id, ic, lbl]) =>
    `<button data-tab="${id}" class="${name === id ? 'active' : ''}"><span class="ic">${ic}</span>${lbl}</button>`).join('')}</div>`;
}

function showModal(html) {
  $('#modal-slot').innerHTML = `<div class="modal-overlay" data-modal-close>${html}</div>`;
}
function closeModal() { $('#modal-slot').innerHTML = ''; }

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) return reset(tabBtn.dataset.tab);
  const backBtn = e.target.closest('[data-back]');
  if (backBtn) return back();
  if (e.target.closest('[data-modal-close]') && e.target.matches('.modal-overlay')) return closeModal();
});

// ───────────────────────── Ortak parçalar ─────────────────────────
function topbar(title) {
  return `<div class="topbar"><button class="back" data-back>‹ Geri</button><div class="title">${esc(title)}</div></div>`;
}
function spinner() { return `<div class="screen-pad"><div class="spinner"></div></div>`; }

// pending>0 ise halka iki tona ayrılır: koyu kırmızı (gerçek cevap) + amber
// (hâlâ "Şimdilik Geç" ile ertelenmiş) — Ders ekranındaki çubukla aynı mantık,
// kullanıcı isteği: Anasayfa'daki yuvarlak da aynı ayrımı göstersin.
// completed = NİHAİ cevaplı kelime sayısı (backend'in today.completedWords'ü),
// pending = ertelenmiş kelime sayısı; ikisi ayrı yay olarak çizilir.
// Eskiden buraya dokunulan toplam (totalWords) geçiliyor ve pending burada
// çıkarılıyordu — çember doğru çiziliyordu ama ortadaki sayı aynı değeri
// çıkarmadığı için "20/20 Tamamlandı" derken ders bitmiyordu.
function ringSvg(completed, total, size = 168, stroke = 14, pending = 0) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const finalFrac = total > 0 ? Math.min(1, Math.max(0, completed) / total) : 0;
  const pendingFrac = total > 0 ? Math.min(1 - finalFrac, Math.max(0, pending) / total) : 0;
  const finalLen = c * finalFrac;
  const pendingLen = c * pendingFrac;
  const hasPending = pendingLen > 0.5;
  return `<svg width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--brand)" stroke-width="${stroke}"
      stroke-linecap="${hasPending ? 'butt' : 'round'}" stroke-dasharray="${finalLen} ${c - finalLen}"/>
    ${hasPending ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#D9A441" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${pendingLen} ${c - pendingLen}" stroke-dashoffset="${-finalLen}"/>` : ''}
  </svg>`;
}

function donutStyle(distribution, totalForDonut) {
  const colors = ['var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--m4)', 'var(--m5)'];
  if (!totalForDonut) return 'var(--line)';
  let acc = 0; const stops = [];
  for (let lvl = 1; lvl <= 5; lvl++) {
    const v = distribution[lvl] || 0;
    if (!v) continue;
    const start = acc / totalForDonut * 360; acc += v;
    stops.push(`${colors[lvl - 1]} ${start}deg ${acc / totalForDonut * 360}deg`);
  }
  if (acc < totalForDonut) stops.push(`var(--line) ${acc / totalForDonut * 360}deg 360deg`);
  return stops.length ? `conic-gradient(${stops.join(',')})` : 'var(--line)';
}

function pwScore(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-zçğıöşü]/.test(pw) && /[A-ZÇĞİÖŞÜ]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
function pwBarsHtml(score) {
  const cls = score <= 1 ? 'weak' : score <= 2 ? 'mid' : 'strong';
  const label = score <= 1 ? 'Zayıf şifre' : score <= 2 ? 'Orta şifre' : score === 3 ? 'İyi şifre' : 'Güçlü şifre';
  return `<div class="strength">${[0, 1, 2, 3].map(i => `<i class="${i < score ? 'on ' + cls : ''}"></i>`).join('')}</div>
    <div class="strength-label">${label}</div>`;
}
function wirePwStrength(inputEl, boxEl) {
  inputEl.addEventListener('input', () => { boxEl.innerHTML = pwBarsHtml(pwScore(inputEl.value)); });
}

function audioButtons(url) {
  if (!url) return '';
  return `<div class="audio-row">
    <button data-audio="${esc(url)}">🔊 Dinle</button>
    <button data-audio="${esc(url)}" data-slow="1">🐌 Yavaş</button>
  </div>`;
}
function wireAudioButtons(root) {
  $$('[data-audio]', root).forEach(b => b.addEventListener('click', () => {
    const a = new Audio(b.dataset.audio);
    if (b.dataset.slow) a.playbackRate = 0.6;
    a.play().catch(() => toast('Ses çalınamadı (URL erişilemiyor olabilir)', 'err'));
  }));
}

// Genel "durum" ekranı: başarı/hata bildirimleri (Hesabınız Oluşturuldu,
// Şifreniz Değiştirildi, E-postanız Doğrulandı, vb.) hepsi bunu kullanır.
function statusScreen({ icon = '✓', kind = 'ok', title, body, buttonLabel = 'Devam Et', onContinue, secondary }) {
  $('#screen').innerHTML = `
    <div class="status-scr">
      <div class="status-ic ${kind}">${icon}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
      <button class="btn btn-primary" id="status-continue">${esc(buttonLabel)}</button>
      ${secondary ? `<button class="btn btn-ghost gap-8" id="status-secondary">${esc(secondary.label)}</button>` : ''}
    </div>`;
  $('#status-continue').addEventListener('click', onContinue);
  if (secondary) $('#status-secondary').addEventListener('click', secondary.onClick);
}

// ═══════════════════════════════════════════════════════════════
// AUTH — welcome / register wizard / login / forgot password
// ═══════════════════════════════════════════════════════════════

function showWelcome() {
  $('#screen').innerHTML = `
    <div class="screen-pad center" style="padding-top:90px">
      <div class="brandmark">結</div>
      <h1 class="scr-title">Musubi</h1>
      <p class="muted" style="margin-bottom:44px">Kelime Ezberlemenin En Kolay Yolu</p>
      <button class="btn btn-google" id="btn-google">🔵 Google ile Devam Et</button>
      <button class="btn btn-primary gap-12" id="btn-email">E-posta ile Devam Et</button>
      <button class="btn btn-ghost gap-8" id="btn-login">Zaten bir hesabım var · Giriş Yap</button>
    </div>`;
  $('#btn-google').addEventListener('click', () => toast('Bu simülatörde Google girişi desteklenmiyor — e-posta ile devam et', 'err'));
  $('#btn-email').addEventListener('click', () => { state.wizard = {}; go('reg-email'); });
  $('#btn-login').addEventListener('click', () => go('login'));
}

function showRegEmail() {
  $('#screen').innerHTML = topbar('Kayıt Ol') + `
    <div class="screen-pad">
      <h1 class="scr-title">E-posta Adresin</h1>
      <p class="muted gap-8" style="margin-bottom:20px">Giriş yaparken bu adresi kullanacaksın.</p>
      <div class="field"><label>E-posta</label><input id="in-email" type="email" placeholder="ornek@eposta.com" value="${esc(state.wizard.email || '')}"></div>
      <div class="err-line" id="email-err"></div>
      <button class="btn btn-primary gap-8" id="btn-continue">Devam Et</button>
    </div>`;
  const input = $('#in-email'), err = $('#email-err');
  $('#btn-continue').addEventListener('click', async () => {
    const email = input.value.trim();
    if (!/^[\w.-]+@([\w-]+\.)+[\w-]{2,}$/.test(email)) { err.textContent = 'Geçerli bir e-posta adresi girin'; return; }
    err.textContent = '';
    const res = await api('POST', '/auth/check-email', { email }, { auth: false });
    if (!res.ok) { err.textContent = res.json.message || 'Bir şeyler ters gitti'; return; }
    if (!res.json.available) {
      err.innerHTML = `Bu e-posta adresi zaten kayıtlı · <button class="link" id="go-login">Giriş Yap</button>`;
      $('#go-login').addEventListener('click', () => { state.wizard.email = email; go('login'); });
      return;
    }
    state.wizard.email = email;
    go('reg-name');
  });
}

function showRegName() {
  $('#screen').innerHTML = topbar('Kayıt Ol') + `
    <div class="screen-pad">
      <h1 class="scr-title">Ad Soyad</h1>
      <p class="muted gap-8" style="margin-bottom:20px">Sana nasıl seslenelim?</p>
      <div class="field"><label>Ad</label><input id="in-name" placeholder="Ad" value="${esc(state.wizard.name || '')}"></div>
      <div class="field"><label>Soyad</label><input id="in-surname" placeholder="Soyad" value="${esc(state.wizard.surname || '')}"></div>
      <button class="btn btn-primary gap-8" id="btn-continue">Devam Et</button>
    </div>`;
  $('#btn-continue').addEventListener('click', () => {
    const name = $('#in-name').value.trim(), surname = $('#in-surname').value.trim();
    if (!name) return toast('Ad gerekli', 'err');
    state.wizard.name = name; state.wizard.surname = surname;
    go('reg-password');
  });
}

function showRegPassword() {
  $('#screen').innerHTML = topbar('Kayıt Ol') + `
    <div class="screen-pad">
      <h1 class="scr-title">Yeni Şifre Oluştur</h1>
      <p class="muted gap-8" style="margin-bottom:20px">Lütfen şifreni gir ve doğrula.</p>
      <div class="field">
        <label>Şifre</label>
        <div class="wrap"><input id="in-pw" type="password" placeholder="En az 8 karakter"><button type="button" class="eye" data-toggle-eye="in-pw">👁</button></div>
      </div>
      <div id="pw-strength"></div>
      <div class="field gap-12"><label>Şifre (tekrar)</label><input id="in-pw2" type="password" placeholder="Şifreni tekrar gir"></div>
      <div class="err-line" id="pw-err"></div>
      <button class="btn btn-primary gap-8" id="btn-continue">Devam Et</button>
    </div>`;
  const pw = $('#in-pw'), box = $('#pw-strength');
  box.innerHTML = pwBarsHtml(0);
  wirePwStrength(pw, box);
  wireEyeToggle();
  $('#btn-continue').addEventListener('click', async () => {
    const p1 = $('#in-pw').value, p2 = $('#in-pw2').value, err = $('#pw-err');
    if (p1.length < 8) { err.textContent = 'Şifre en az 8 karakter olmalı'; return; }
    if (p1 !== p2) { err.textContent = 'Şifreler eşleşmiyor'; return; }
    err.textContent = '';
    const res = await api('POST', '/auth/register', {
      name: state.wizard.name, surname: state.wizard.surname,
      email: state.wizard.email, password: p1, deviceName: 'web-simülatör'
    }, { auth: false });
    if (!res.ok) { err.textContent = res.json.message || 'Kayıt başarısız'; return; }
    setTokens(res.json.accessToken, res.json.refreshToken);
    if (res.json.verificationToken) {
      state.devVerificationToken = res.json.verificationToken;
      localStorage.setItem('musubi_dev_vtoken', res.json.verificationToken);
    }
    reset('reg-success');
  });
}

function showRegSuccess() {
  statusScreen({
    icon: '✓', kind: 'ok', title: 'Hesabınız Oluşturuldu',
    body: 'Devam etmeden önce e-postana gönderdiğimiz bağlantıyla hesabını doğrulaman gerekiyor.',
    buttonLabel: state.devVerificationToken ? '(dev) E-postamı Doğrula' : 'E-postamı Doğrula',
    onContinue: async () => {
      if (!state.devVerificationToken) return go('verify-nudge');
      const res = await api('GET', '/auth/verify-email/' + state.devVerificationToken, undefined, { auth: false });
      if (!res.ok) return go('verify-fail');
      if (res.json.data?.accessToken) setTokens(res.json.data.accessToken, res.json.data.refreshToken);
      clearDevVerificationToken();
      go('verify-ok');
    },
    secondary: { label: 'Daha Sonra', onClick: () => reset('verify-nudge') }
  });
}

function clearDevVerificationToken() { state.devVerificationToken = null; localStorage.removeItem('musubi_dev_vtoken'); }

function showVerifyOk() {
  statusScreen({
    icon: '📩', kind: 'ok', title: 'E-postanız Doğrulandı',
    body: 'Harika! Artık öğrenmeye başlayabilirsin.',
    buttonLabel: 'Devam Et', onContinue: () => enterApp()
  });
}
function showVerifyFail() {
  statusScreen({
    icon: '📪', kind: 'err', title: 'E-postanız Doğrulanamadı',
    body: 'Bağlantının süresi dolmuş olabilir. Doğrulama mailini tekrar gönderelim.',
    buttonLabel: 'Tekrar Gönder',
    onContinue: async () => {
      const email = state.wizard.email || state.profile?.email;
      if (!email) return toast('E-posta adresi bulunamadı, girişten devam et', 'err');
      const res = await api('POST', '/auth/resend-verification-email', { email }, { auth: false });
      guard(res, 'Doğrulama maili tekrar gönderildi');
    },
    secondary: { label: 'Geri', onClick: back }
  });
}

// Doğrulanmamış ama giriş yapmış kullanıcı — /auth/me 403 döndüğü sürece
// backend TÜM ana uç noktaları (isEmailVerified) kapatıyor; bu yüzden burası
// gerçek bir kapı, süslü bir banner değil.
function showVerifyNudge() {
  $('#screen').innerHTML = `
    <div class="status-scr">
      <div class="status-ic brand">✉️</div>
      <h2>E-postanı Doğrula</h2>
      <p>Devam etmeden önce e-postana gelen bağlantıyla hesabını doğrulaman gerekiyor. Doğrulama linki backend tarafından web sayfası olarak açılır; test için tokenı burada elle de kullanabilirsin.</p>
      <div class="field" style="text-align:left"><label>(dev) Doğrulama tokenı</label>
        <input id="vtoken" placeholder="40 haneli token" value="${esc(state.devVerificationToken || '')}"></div>
      <button class="btn btn-primary gap-8" id="btn-verify">Doğrula</button>
      <button class="btn btn-outline gap-8" id="btn-resend">Doğrulama Mailini Tekrar Gönder</button>
      <button class="btn btn-ghost gap-8" id="btn-logout">Çıkış Yap</button>
    </div>`;
  $('#btn-verify').addEventListener('click', async () => {
    const token = $('#vtoken').value.trim();
    if (!token) return toast('Token gerekli', 'err');
    const res = await api('GET', '/auth/verify-email/' + token, undefined, { auth: false });
    if (!res.ok) return toast(res.json.message || 'Doğrulanamadı', 'err');
    if (res.json.data?.accessToken) setTokens(res.json.data.accessToken, res.json.data.refreshToken);
    clearDevVerificationToken();
    toast('E-posta doğrulandı 🎉', 'ok');
    enterApp();
  });
  $('#btn-resend').addEventListener('click', async () => {
    const email = prompt('Kayıtlı e-posta adresini gir:', state.wizard.email || '');
    if (!email) return;
    const res = await api('POST', '/auth/resend-verification-email', { email }, { auth: false });
    if (guard(res, 'Doğrulama maili tekrar gönderildi')) {
      // dev ortamında token'ı tekrar yakalamak için kullanıcı e-posta kutusuna
      // bakamayacağı için manuel giriş kutusu bırakılır.
    }
  });
  $('#btn-logout').addEventListener('click', async () => {
    await api('POST', '/auth/logout', { refreshToken: state.refresh });
    setTokens(null, null);
    reset('welcome');
  });
}

function showLogin() {
  $('#screen').innerHTML = topbar('Giriş Yap') + `
    <div class="screen-pad">
      <h1 class="scr-title">Giriş Yap</h1>
      <div class="field gap-16"><label>E-posta</label><input id="in-email" type="email" placeholder="ornek@eposta.com" value="${esc(state.wizard.email || '')}"></div>
      <div class="field">
        <label>Şifre</label>
        <div class="wrap"><input id="in-pw" type="password" placeholder="Şifren"><button type="button" class="eye" data-toggle-eye="in-pw">👁</button></div>
      </div>
      <div class="err-line" id="login-err"></div>
      <button class="btn btn-primary gap-8" id="btn-login">Giriş Yap</button>
      <button class="btn btn-ghost gap-8" id="btn-forgot">Şifremi Unuttum</button>
    </div>`;
  wireEyeToggle();
  $('#btn-forgot').addEventListener('click', () => go('forgot-email'));
  $('#btn-login').addEventListener('click', async () => {
    const email = $('#in-email').value.trim(), password = $('#in-pw').value, err = $('#login-err');
    const res = await api('POST', '/auth/login', { email, password, deviceName: 'web-simülatör' }, { auth: false });
    if (!res.ok) { err.textContent = res.json.message || 'Giriş başarısız'; return; }
    err.textContent = '';
    setTokens(res.json.accessToken, res.json.refreshToken);
    state.profile = { name: res.json.data.name, email };
    if (!res.json.isEmailVerified) return reset('verify-nudge');
    enterApp();
  });
}

function showForgotEmail() {
  $('#screen').innerHTML = topbar('Şifremi Unuttum') + `
    <div class="screen-pad">
      <h1 class="scr-title">Şifreni mi Unuttun?</h1>
      <p class="muted gap-8" style="margin-bottom:20px">E-posta adresini gir, sana bir sıfırlama bağlantısı gönderelim.</p>
      <div class="field"><label>E-posta</label><input id="in-email" type="email" placeholder="ornek@eposta.com"></div>
      <button class="btn btn-primary gap-8" id="btn-send">Sıfırlama Maili Gönder</button>
    </div>`;
  $('#btn-send').addEventListener('click', async () => {
    const email = $('#in-email').value.trim();
    if (!email) return toast('E-posta gir', 'err');
    const res = await api('POST', '/auth/forgot-password', { email }, { auth: false });
    if (!guard(res, 'Sıfırlama maili gönderildi (varsa)')) return;
    if (res.json.resetToken) {
      state.devResetToken = res.json.resetToken;
      localStorage.setItem('musubi_dev_rtoken', res.json.resetToken);
    }
    go('forgot-newpass');
  });
}

function showForgotNewPass() {
  $('#screen').innerHTML = topbar('Şifremi Unuttum') + `
    <div class="screen-pad">
      <h1 class="scr-title">Yeni Şifre Oluştur</h1>
      <p class="muted gap-8" style="margin-bottom:20px">Lütfen şifreni gir ve doğrula.</p>
      <div class="field" style="text-align:left"><label>(dev) Sıfırlama tokenı</label>
        <input id="rtoken" value="${esc(state.devResetToken || '')}"></div>
      <div class="field">
        <label>Şifre</label>
        <div class="wrap"><input id="in-pw" type="password" placeholder="En az 8 karakter"><button type="button" class="eye" data-toggle-eye="in-pw">👁</button></div>
      </div>
      <div id="pw-strength"></div>
      <div class="field gap-12"><label>Şifre (tekrar)</label><input id="in-pw2" type="password"></div>
      <div class="err-line" id="pw-err"></div>
      <button class="btn btn-primary gap-8" id="btn-continue">Şifreyi Güncelle</button>
    </div>`;
  const pw = $('#in-pw'), box = $('#pw-strength');
  box.innerHTML = pwBarsHtml(0);
  wirePwStrength(pw, box);
  wireEyeToggle();
  $('#btn-continue').addEventListener('click', async () => {
    const token = $('#rtoken').value.trim(), p1 = $('#in-pw').value, p2 = $('#in-pw2').value, err = $('#pw-err');
    if (!token) { err.textContent = 'Sıfırlama tokenı gerekli'; return; }
    if (p1.length < 8) { err.textContent = 'Şifre en az 8 karakter olmalı'; return; }
    if (p1 !== p2) { err.textContent = 'Şifreler eşleşmiyor'; return; }
    // deviceName BİLEREK gönderilmiyor: backend web-akışında oturum açmıyor,
    // gerçek davranış budur — kullanıcı yeni şifreyle tekrar giriş yapar.
    const res = await api('POST', '/auth/reset-password', { token, password: p1 }, { auth: false });
    if (!res.ok) { err.textContent = res.json.message || 'Şifre sıfırlanamadı'; return; }
    localStorage.removeItem('musubi_dev_rtoken'); state.devResetToken = null;
    reset('reset-success');
  });
}

function showResetSuccess() {
  statusScreen({
    icon: '✱', kind: 'brand', title: 'Şifreniz Değiştirildi',
    body: 'Başarıyla işleminiz tamamlandı. Yeni şifrenle giriş yapabilirsin.',
    buttonLabel: 'Giriş Yap', onContinue: () => reset('login')
  });
}

function wireEyeToggle() {
  $$('[data-toggle-eye]').forEach(b => b.addEventListener('click', () => {
    const inp = $('#' + b.dataset.toggleEye);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }));
}

// ═══════════════════════════════════════════════════════════════
// Uygulamaya giriş / önyükleme
// ═══════════════════════════════════════════════════════════════

async function boot() {
  applyThemeFont();
  if (!state.access) return reset('welcome');
  const res = await api('GET', '/auth/me');
  if (res.status === 403) return reset('verify-nudge');
  if (!res.ok) { setTokens(null, null); return reset('welcome'); }
  state.me = res.json.data;
  await enterApp();
}

async function enterApp() {
  const meRes = await api('GET', '/auth/me');
  if (!meRes.ok) return reset('welcome');
  state.me = meRes.json.data;
  applyThemeFont();

  if (!state.checkedPlacement) {
    state.checkedPlacement = true;
    const qs = await api('GET', '/quiz/status');
    if (qs.ok && qs.json.data.placementAvailable) {
      reset('home');
      showModal(quizIntroHtml({ type: 'placement' }));
      wireQuizIntroModal({ type: 'placement' });
      return;
    }
  }
  reset('home');
}

function applyThemeFont() {
  const prefs = state.me?.preferences || {};
  const phone = $('#phone');
  const theme = prefs.theme === 'dark' ? 'dark'
    : prefs.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : 'light';
  phone.dataset.theme = theme;
  const scale = prefs.fontSize === 'small' ? 0.92 : prefs.fontSize === 'large' ? 1.14 : 1;
  phone.style.setProperty('--font-scale', scale);
}

// ═══════════════════════════════════════════════════════════════
// ANASAYFA
// ═══════════════════════════════════════════════════════════════

async function showHome() {
  const myToken = activeToken;
  $('#screen').innerHTML = spinner();
  const [sumRes, calRes, misRes] = await Promise.all([
    api('GET', '/home/summary'), api('GET', '/home/calendar'), api('GET', '/userwords/mistakes?limit=4')
  ]);
  if (stale(myToken)) return;
  if (!sumRes.ok) { toast(sumRes.json.message || 'Anasayfa yüklenemedi', 'err'); return reset('welcome'); }
  const d = sumRes.json.data;
  const cal = calRes.ok ? calRes.json.data : [];
  const mistakes = misRes.ok ? misRes.json.data : { mistakes: [], total: 0 };

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const entry = cal.find(s => s.date.slice(0, 10) === key);
    days.push({ label: 'PSÇPCCP'[dt.getDay()] || '·', done: !!entry && entry.totalWords > 0, today: i === 0 });
  }

  $('#screen').innerHTML = `
    <div class="screen-pad">
      <div class="hello">
        <h1>Merhaba ${esc(d.name)} 👋</h1>
        <div class="bell" data-nav="notifications">🔔<span class="dot" hidden></span></div>
      </div>
      <div class="ring-wrap"><div class="ring">${ringSvg(d.today.completedWords, d.goal, 168, 14, d.today.emptyCount)}
        <div class="num"><b>${d.today.completedWords}/${d.goal}</b><span>Tamamlandı</span></div></div></div>
      ${d.today.emptyCount > 0 ? `<div class="center muted" style="font-size:12.5px;margin:-8px 0 14px">🟡 ${d.today.emptyCount} kelime ertelendi — tekrar sorulacak</div>` : ''}
      <button class="btn btn-primary" id="btn-start-lesson">Bugünkü Kelimelerine Geç</button>
      ${d.tomorrowReviews > 0 ? `<div class="pending-banner">📅 Yarın ${d.tomorrowReviews} kart seni bekliyor</div>` : ''}
      <div class="card">
        <div class="streak-row">🔥 ${d.streak.current} Günlük Seri <span class="muted" style="font-weight:400">· En iyi ${d.streak.longest}</span></div>
        <div class="day-strip">${days.map(x => `<div class="day-chip ${x.done ? 'done' : ''} ${x.today ? 'today' : ''}"><div class="d">${x.done ? '✓' : ''}</div><span>${x.label}</span></div>`).join('')}</div>
      </div>
      <div class="card">
        <div class="row between"><h2 style="margin:0">Bugünün Hataları</h2><span class="badge">${mistakes.total}</span></div>
        ${mistakes.total === 0
          ? '<div class="empty-state" style="padding:14px 0">Bugün hata yok 🎉</div>'
          : `<div class="wlist gap-8">${mistakes.mistakes.map(m => `
              <div class="witem" style="cursor:default">
                <div class="kj">${esc(m.word.kanji)}<small>${esc(m.word.romaji)}</small></div>
                <div class="mean">${esc(m.word.meaning)}</div>
              </div>`).join('')}</div>`}
      </div>
    </div>`;

  api('GET', '/notifications').then(r => {
    if (stale(myToken) || !r.ok) return;
    const dot = $('.bell .dot'); if (dot) dot.hidden = r.json.data.unreadCount === 0;
  });

  $('#btn-start-lesson').addEventListener('click', () => startLesson());
  $('[data-nav="notifications"]').addEventListener('click', () => go('notifications'));
}

// ═══════════════════════════════════════════════════════════════
// BİLDİRİMLER
// ═══════════════════════════════════════════════════════════════
const NOTIF_ICONS = { daily_word: 'あ', streak_reminder: '🔥', daily_task: '📅', streak_warning: '☹️', word_level_down: '↘' };

async function showNotifications() {
  const myToken = activeToken;
  $('#screen').innerHTML = topbar('Bildirimler') + spinner();
  const res = await api('GET', '/notifications');
  if (stale(myToken)) return;
  if (!guard(res)) return back();
  const { notifications } = res.json.data;
  $('#screen').innerHTML = topbar('Bildirimler') + `
    <div class="screen-pad">
      ${notifications.length ? `<button class="btn btn-outline" id="btn-readall" style="margin-bottom:12px">Tümünü Okundu Yap</button>` : ''}
      ${notifications.length === 0 ? '<div class="empty-state">Bildirim yok.</div>' : notifications.map(n => `
        <div class="notif-item ${n.read ? 'read' : ''}" data-id="${n._id}">
          <div class="ic">${NOTIF_ICONS[n.type] || '🔔'}</div>
          <div><b>${esc(n.title)}</b><p>${esc(n.body)}</p></div>
        </div>`).join('')}
    </div>`;
  if (notifications.length) $('#btn-readall').addEventListener('click', async () => {
    await api('PUT', '/notifications/read-all'); showNotifications();
  });
  $$('.notif-item').forEach(el => el.addEventListener('click', async () => {
    if (el.classList.contains('read')) return;
    await api('PUT', `/notifications/${el.dataset.id}/read`);
    showNotifications();
  }));
}

// ═══════════════════════════════════════════════════════════════
// DERS (SRS çalışma akışı) — yazma sorusu, backend puanlar
// ═══════════════════════════════════════════════════════════════

async function startLesson() {
  const myToken = activeToken;
  const progRes = await api('GET', '/progress');
  if (stale(myToken)) return;
  let jlptLevel = 'N5';
  if (progRes.ok) {
    const unlocked = progRes.json.data.levels.filter(l => l.isUnlocked);
    if (unlocked.length) jlptLevel = unlocked[unlocked.length - 1].jlptLevel;
  }
  state.lesson = { jlptLevel, queue: [], idx: 0, correctStreak: 0, phase: 'loading', doneToday: 0, totalToday: 0, pendingToday: 0 };
  go('lesson', { jlptLevel });
  await loadLessonWords(jlptLevel);
}

async function loadLessonWords(jlptLevel) {
  const myToken = activeToken;
  await api('POST', '/sessions/start', { jlptLevel });
  const res = await api('GET', `/userwords/today?jlptLevel=${jlptLevel}`);
  if (stale(myToken)) return;
  if (!guard(res)) return back();
  const d = res.json.data;
  const queue = [];
  d.reviewWords.forEach(uw => { if (!uw.answeredToday) queue.push({ wordId: uw.word._id, word: uw.word, isReview: true }); });
  d.newWords.forEach(w => { if (!w.answeredToday) queue.push({ wordId: w._id, word: w, isReview: false }); });
  state.lesson.queue = queue;
  state.lesson.idx = 0;
  // Anasayfa (/home/summary) ile AYNI kaynak: backend'in döndürdüğü goal/today
  // doğrudan kullanılır, yerel toplama YAPILMAZ — bkz. submitLessonAnswer.
  state.lesson.doneToday = d.today.completedWords;
  state.lesson.totalToday = d.goal;
  state.lesson.pendingToday = d.today.emptyCount;
  state.lesson.phase = queue.length ? 'question' : 'already-done';
  renderLessonScreen();
}

function renderLessonScreen() {
  const L = state.lesson;
  if (L.phase === 'loading') { $('#screen').innerHTML = spinner(); return; }
  if (L.phase === 'already-done') {
    $('#screen').innerHTML = `
      <div class="status-scr">
        <div class="status-ic ok">✓</div>
        <h2>Bugün İçin Kelime Kalmadı</h2>
        <p>Bugünkü ${L.totalToday} kelimenin tamamını zaten cevapladın. Yarın yeni kelimeler seni bekliyor.</p>
        <button class="btn btn-primary" id="btn-back-home">Ana Sayfaya Dön</button>
      </div>`;
    $('#btn-back-home').addEventListener('click', () => reset('home'));
    return;
  }
  if (L.phase === 'streak-splash') return renderStreakSplash();
  if (L.phase === 'result') return renderLessonResult();
  renderLessonQuestion();
}

function lessonTopbar() {
  const L = state.lesson;
  const total = L.totalToday || 1;
  // doneToday zaten NİHAİ cevap sayısıdır (backend'in completedWords'ü);
  // ertelenenler ayrı bir bant olarak çizilir
  const finalCount = L.doneToday;
  // Kullanıcı günlük hedefi aşabilir (birden fazla tur) — payda SABİT kalır,
  // bar %100'de kilitlenir ama üstteki "X/Y" metni gerçek sayıyı gösterir.
  const finalPct = Math.min(100, (finalCount / total) * 100);
  const pendingPct = Math.min(100 - finalPct, (L.pendingToday / total) * 100);
  return `
    <div class="topbar">
      <button class="back" id="btn-exit-lesson">‹ Ders</button>
      <div class="title">${L.doneToday}/${L.totalToday} Tamamlandı</div>
    </div>
    <div class="screen-pad" style="padding-bottom:0">
      <div class="lesson-progress"><i class="final" style="width:${finalPct}%"></i><i class="pending" style="width:${pendingPct}%"></i></div>
      ${L.pendingToday > 0 ? `<div class="muted" style="font-size:11.5px;margin-top:5px">🟡 ${L.pendingToday} kelime ertelendi — tekrar sorulacak</div>` : ''}
    </div>`;
}

function wireExitLesson() {
  $('#btn-exit-lesson').addEventListener('click', () => {
    showModal(`
      <div class="modal-sheet">
        <div class="ic">⏸</div>
        <h3>Çıkmak istediğine emin misin?</h3>
        <p>Cevapladığın kelimeler kaydedildi — kaldığın yerden istediğin zaman devam edebilirsin.</p>
        <button class="btn btn-primary" id="modal-stay">Devam Et</button>
        <button class="btn btn-ghost gap-8" id="modal-leave">Çık</button>
      </div>`);
    $('#modal-stay').addEventListener('click', closeModal);
    $('#modal-leave').addEventListener('click', () => { closeModal(); reset('home'); });
  });
}

function renderLessonQuestion() {
  const L = state.lesson;
  L.submitting = false;
  const item = L.queue[L.idx];
  const word = item.word;
  $('#screen').innerHTML = lessonTopbar() + `
    <div class="screen-pad" style="padding-top:8px">
      <div class="lesson-card">
        <span class="badge lvl-badge">${esc(word.jlptLevel)}</span>
        <div class="instr">${item.isReview ? 'Tekrar · ' : ''}Bu kelimenin Türkçesini yazınız.</div>
        <div class="kj">${esc(word.kanji)}</div>
        <div class="kana">${esc(word.kana || word.romaji)}</div>
        ${audioButtons(word.audioUrl)}
      </div>
      <form id="f-answer">
        <div class="answer-row">
          <input id="in-answer" placeholder="Cevabınızı yazın…" autocomplete="off" autofocus>
          <button type="submit" class="send">➤</button>
        </div>
      </form>
      <div class="row center"><button class="btn-ghost link" id="btn-skip">Şimdilik Geç →</button></div>
    </div>`;
  wireAudioButtons();
  wireExitLesson();
  $('#f-answer').addEventListener('submit', (e) => { e.preventDefault(); submitLessonAnswer({ answer: $('#in-answer').value }); });
  $('#btn-skip').addEventListener('click', () => submitLessonAnswer({ result: 'empty' }));
}

async function submitLessonAnswer(payload) {
  const L = state.lesson;
  // Hızlı çift dokunuş/Enter+tıklama aynı kelime için iki istek atıp aynı
  // cevabı iki kez saydırabiliyordu (backend artık buna karşı korunuyor ama
  // burada da önlemek gereksiz isteği baştan engeller). Cevap dönene kadar
  // kontrolleri kilitle.
  if (L.submitting) return;
  L.submitting = true;
  const sendBtn = $('.answer-row .send'), skipBtn = $('#btn-skip'), input = $('#in-answer');
  if (sendBtn) sendBtn.disabled = true;
  if (skipBtn) skipBtn.disabled = true;
  if (input) input.disabled = true;

  const myToken = activeToken;
  const item = L.queue[L.idx];
  const res = await api('POST', '/userwords/answer', { wordId: item.wordId, ...payload });
  if (stale(myToken)) return;
  L.submitting = false;
  if (!guard(res)) {
    if (sendBtn) sendBtn.disabled = false;
    if (skipBtn) skipBtn.disabled = false;
    if (input) input.disabled = false;
    return;
  }
  const d = res.json.data;
  // Yerel toplama YAPILMAZ: her yanıt kendi goal/today'ini taşır (Anasayfa'yla
  // aynı kaynak) — istemci sadece bunu görüntüler. Çift sayma, gir-çık'ta
  // sıçrama/düşme gibi bütün bir bug sınıfı böylece yapısal olarak kapanır.
  L.doneToday = d.today.completedWords;
  L.totalToday = d.goal;
  L.pendingToday = d.today.emptyCount;
  if (d.result === 'correct' || d.result === 'easy') L.correctStreak++; else L.correctStreak = 0;

  const kind = d.result === 'wrong' ? 'bad' : d.result === 'empty' ? 'warn' : 'good';
  const headText = d.result === 'wrong' ? '✗ Yanlış Cevap!' : d.result === 'empty' ? '○ Şimdilik Geçildi' : '✓ Doğru!';
  $('#screen').innerHTML = lessonTopbar() + `
    <div class="screen-pad" style="padding-top:8px">
      <div class="lesson-card" style="margin-top:0">
        <span class="badge lvl-badge">${esc(item.word.jlptLevel)}</span>
        <div class="kj">${esc(item.word.kanji)}</div>
        <div class="kana">${esc(item.word.kana || item.word.romaji)}</div>
      </div>
      <div class="feedback-card ${kind}">
        <div class="head">${headText}</div>
        <div class="word">${esc(item.word.kanji)} — ${esc(item.word.meaning)}</div>
        ${d.correctAnswer && d.result !== 'correct' && d.result !== 'easy' ? `<div class="ans">Cevap: <b>${esc(d.correctAnswer)}</b></div>` : ''}
        <button id="btn-next">Devam Et</button>
      </div>
    </div>`;
  wireExitLesson();
  $('#btn-next').addEventListener('click', () => advanceLesson());
}

function advanceLesson() {
  const L = state.lesson;
  if (L.correctStreak > 0 && L.correctStreak % 5 === 0) {
    L.phase = 'streak-splash';
    return renderLessonScreen();
  }
  proceedToNextWord();
}

function proceedToNextWord() {
  const L = state.lesson;
  L.idx++;
  if (L.idx >= L.queue.length) return verifyQueueEmptyThenFinish();
  renderLessonQuestion();
}

// Yerel kuyruk bittiğinde körlemesine "bitti" denilmez: "Şimdilik Geç"
// ile ertelenmiş ama henüz gerçek cevap almamış kelimeler olabilir (backend
// bunları answeredToday:false tutar, gün içinde yeniden sorulmalıdır).
// Tamamlamadan (/sessions/complete → roundClosedAt) önce backend'e sorup
// gerçekten kimse kalmadığını doğrularız — yoksa erteleneni tamamlanmış
// sayıp bir daha hiç sormama riski vardı.
async function verifyQueueEmptyThenFinish() {
  const L = state.lesson;
  const myToken = activeToken;
  $('#screen').innerHTML = spinner();
  const res = await api('GET', `/userwords/today?jlptLevel=${L.jlptLevel}`);
  if (stale(myToken)) return;
  if (!guard(res)) return reset('home');
  const d = res.json.data;
  const queue = [];
  d.reviewWords.forEach(uw => { if (!uw.answeredToday) queue.push({ wordId: uw.word._id, word: uw.word, isReview: true }); });
  d.newWords.forEach(w => { if (!w.answeredToday) queue.push({ wordId: w._id, word: w, isReview: false }); });
  L.doneToday = d.today.completedWords;
  L.totalToday = d.goal;
  L.pendingToday = d.today.emptyCount;

  if (queue.length > 0) {
    // Hâlâ ertelenmiş (empty) kelime var — kuyruğu tazeleyip devam et
    L.queue = queue;
    L.idx = 0;
    return renderLessonQuestion();
  }
  L.phase = 'result';
  return finishLessonSession();
}

function renderStreakSplash() {
  const L = state.lesson;
  $('#screen').innerHTML = `
    <div class="streak-splash">
      <div class="ic">🔥</div>
      <h2>${L.correctStreak} Kere Üstüste!</h2>
      <p>Harika gidiyorsun. Böyle devam et!</p>
      <button class="btn btn-primary" id="btn-continue-splash" style="width:220px">Devam Et</button>
    </div>`;
  $('#btn-continue-splash').addEventListener('click', proceedToNextWord);
}

async function finishLessonSession() {
  const myToken = activeToken;
  $('#screen').innerHTML = spinner();
  const res = await api('PUT', '/sessions/complete');
  if (stale(myToken)) return;
  // 409 = backend'de hâlâ ertelenmiş kelime var. Normal akışta buraya
  // düşülmez (kuyruk zaten doğrulanıyor), ama düşülürse kullanıcıyı ana
  // sayfaya atmak yerine kalan kelimelerle derse geri dönmek doğrusu.
  if (res.status === 409) {
    toast(res.json.message, 'err');
    return verifyQueueEmptyThenFinish();
  }
  if (!guard(res)) return reset('home');
  const sumRes = await api('GET', '/home/summary');
  if (stale(myToken)) return;
  state.lesson.resultData = {
    ...res.json.data,
    streak: sumRes.ok ? sumRes.json.data.streak.current : 0
  };
  renderLessonResult();
}

// L.phase==='result' iken geri/ileri navigasyonla renderLessonScreen tekrar
// çağrılabilir — API'yi tekrar vurmadan önbellekteki resultData'dan çizilir.
function renderLessonResult() {
  const d = state.lesson.resultData;
  $('#screen').innerHTML = `
    <div class="screen-pad result-scr">
      <div class="ring-wrap"><div class="ring">${ringSvg(d.totalWords, d.totalWords)}
        <div class="num"><b>${d.totalWords}/${d.totalWords}</b><span>Tamamlandı</span></div></div></div>
      <h2>Tebrikler!</h2>
      <p class="muted" style="margin-bottom:18px">Bugünkü çalışma serüvenin başarıyla sona erdi.</p>
      <div class="result-tiles">
        <div class="t"><div class="v">%${d.accuracy}</div><div class="k">Doğruluk</div></div>
        <div class="t"><div class="v">${d.duration} dk</div><div class="k">Süre</div></div>
        <div class="t"><div class="v">+${d.streak}</div><div class="k">Seri</div></div>
      </div>
      <button class="btn btn-primary" id="btn-back-home">Ana Sayfaya Dön</button>
    </div>`;
  $('#btn-back-home').addEventListener('click', () => reset('home'));
}

// ═══════════════════════════════════════════════════════════════
// SINAV (placement / level-up)
// ═══════════════════════════════════════════════════════════════

function quizIntroHtml({ type, jlptLevel }) {
  return `
    <div class="modal-sheet">
      <div class="ic">🎯</div>
      <h3>${type === 'placement' ? 'Seviyeni Öğrenelim Mi?' : `${esc(jlptLevel)} Seviye Atlama Sınavı`}</h3>
      <p>Sana uygun içerikleri gösterebilmemiz için kısa bir sınav yapmak istiyoruz. Dilersen daha sonra da ayarlardan devam edebilirsin.</p>
      <button class="btn btn-primary" id="modal-start-quiz">Sınava Başla</button>
      <button class="btn btn-ghost gap-8" id="modal-later">Daha Sonra</button>
    </div>`;
}
function wireQuizIntroModal({ type, jlptLevel }) {
  $('#modal-start-quiz').addEventListener('click', async () => {
    closeModal();
    await beginQuiz({ type, jlptLevel });
  });
  $('#modal-later').addEventListener('click', closeModal);
}

async function beginQuiz(body) {
  const res = await api('POST', '/quiz/start', body);
  if (!res.ok) {
    const msg = res.json.message + (res.json.nextAttemptAllowedAt ? ' · ' + new Date(res.json.nextAttemptAllowedAt).toLocaleDateString('tr') : '');
    toast(msg, 'err');
    return;
  }
  const d = res.json.data;
  state.quiz = { id: d.quizId, questions: d.questions, idx: 0, total: d.totalQuestions, type: d.type, level: d.jlptLevel, passThreshold: d.passThreshold };
  go('quiz-question');
}

function showQuizQuestion() {
  const Q = state.quiz;
  const q = Q.questions[Q.idx];
  const pct = (Q.idx / Q.total) * 100;
  const instr = {
    meaning: 'Bu kelimenin Türkçesini seçiniz', reverse: 'Anlama uyan kelimeyi seçiniz',
    reading: 'Kelimenin okunuşunu seçiniz', typing: 'Bu kelimenin Türkçesini yazınız',
    fillblank: 'Boşluğa uygun kelimeyi yerleştir', image: 'Doğru şıkkı işaretleyiniz'
  }[q.format];

  let promptHtml, answerHtml;
  if (q.format === 'typing') {
    promptHtml = `<div class="q-prompt"><div class="big">${esc(q.prompt.kanji)}</div><div class="sub">${esc(q.prompt.romaji)}</div>${audioButtons(q.prompt.audioUrl)}</div>`;
    answerHtml = `<form id="f-typing"><div class="answer-row"><input id="in-typing" placeholder="Cevabınızı yazın…" autocomplete="off"><button type="submit" class="send">➤</button></div></form>
      <div class="row center"><button class="btn-ghost link" data-skip="1">Şimdilik Geç →</button></div>`;
  } else {
    promptHtml = q.format === 'reverse' ? `<div class="q-prompt"><div class="big" style="font-size:24px">${esc(q.prompt.meaning)}</div></div>`
      : q.format === 'fillblank' ? `<div class="q-prompt"><div class="sentence">${esc(q.prompt.sentence)}</div></div>`
      : q.format === 'image' ? `<div class="q-prompt"><img src="${esc(q.prompt.imageUrl)}" alt="soru görseli"></div>`
      : `<div class="q-prompt"><div class="big">${esc(q.prompt.kanji)}</div>${q.prompt.romaji ? `<div class="sub">${esc(q.prompt.romaji)}</div>` : ''}${audioButtons(q.prompt.audioUrl)}</div>`;
    answerHtml = `<div class="q-choices">${q.choices.map((c, i) => `<button data-choice="${i}">${'ABCD'[i]}) ${esc(c)}</button>`).join('')}</div>
      <div class="row center"><button class="btn-ghost link" data-skip="1">Şimdilik Geç →</button></div>`;
  }

  $('#screen').innerHTML = `
    <div class="topbar"><button class="back" id="btn-exit-quiz">‹ Sınav</button>
      <div class="title">${Q.idx + 1} / ${Q.total}</div></div>
    <div class="screen-pad" style="padding-top:8px">
      <div class="lesson-progress"><i style="width:${pct}%"></i></div>
      <div class="row between gap-16"><span class="badge">${esc(Q.level)}</span><span class="muted">${instr}</span></div>
      ${promptHtml}${answerHtml}
      <div id="q-feedback"></div>
    </div>`;
  wireAudioButtons();
  $('#btn-exit-quiz').addEventListener('click', () => reset('home'));
  $$('[data-choice]').forEach(b => b.addEventListener('click', () => submitQuizAnswer(Number(b.dataset.choice))));
  $$('[data-skip]').forEach(b => b.addEventListener('click', () => submitQuizAnswer(null)));
  const ft = $('#f-typing');
  if (ft) ft.addEventListener('submit', (e) => { e.preventDefault(); submitQuizAnswer($('#in-typing').value); });
}

async function submitQuizAnswer(answer) {
  const myToken = activeToken;
  const Q = state.quiz;
  const res = await api('POST', `/quiz/${Q.id}/answer`, { index: Q.questions[Q.idx].index, answer });
  if (stale(myToken)) return;
  if (!guard(res)) return;
  const d = res.json.data;
  const correctText = d.correctAnswer ?? (d.correctIndex !== undefined ? Q.questions[Q.idx].choices?.[d.correctIndex] : '');
  $$('[data-choice], [data-skip]').forEach(b => b.disabled = true);
  const ft = $('#f-typing'); if (ft) ft.querySelector('button').disabled = true;
  if (d.correctIndex !== undefined) {
    const btn = $(`[data-choice="${d.correctIndex}"]`); if (btn) btn.classList.add('correct');
    if (!d.correct && typeof answer === 'number') { const wb = $(`[data-choice="${answer}"]`); if (wb) wb.classList.add('wrong'); }
  }
  $('#q-feedback').innerHTML = `
    <div class="feedback-card ${d.correct ? 'good' : 'bad'}">
      <div class="head">${d.correct ? '✓ Doğru!' : '✗ Yanlış Cevap!'}</div>
      <div class="word">${esc(d.word?.kanji || '')} — ${esc(d.word?.meaning || '')}</div>
      ${!d.correct && correctText ? `<div class="ans">Cevap: <b>${esc(correctText)}</b></div>` : ''}
      <button id="btn-quiz-next">${d.finished ? 'Sonucu Gör' : 'Devam Et'}</button>
    </div>`;
  $('#btn-quiz-next').addEventListener('click', () => {
    if (d.finished) { state.quiz.result = d.result; return go('quiz-result'); }
    state.quiz.idx++;
    showQuizQuestion();
  });
}

function showQuizResult() {
  const r = state.quiz.result;
  const s = r.summary;
  $('#screen').innerHTML = `
    <div class="screen-pad result-scr">
      ${s ? `<div class="badge lvl-badge" style="font-size:22px;padding:8px 24px;margin-bottom:12px;display:inline-block">${esc(s.determinedLevel)}</div><h2>Seviyen Belirlendi!</h2>` : `<h2>Sınav Tamamlandı</h2>`}
      <div class="result-tiles" style="grid-template-columns:1fr">
        <div class="t"><div class="v" style="font-size:38px;color:var(--brand)">%${r.score}</div><div class="k">Puan</div></div>
      </div>
      <div class="row center wrap" style="gap:8px;flex-wrap:wrap;justify-content:center">
        <span class="pill ${r.passed ? 'good' : 'bad'}">${r.passed ? 'Geçti' : 'Kaldı'} (eşik %${r.passThreshold})</span>
        <span class="pill good">✓ ${r.correctCount}</span>
        <span class="pill bad">✗ ${r.totalQuestions - r.correctCount}</span>
        ${r.unlockedLevel ? `<span class="pill good">🔓 ${esc(r.unlockedLevel)} açıldı</span>` : ''}
        ${r.cooldownDays ? `<span class="pill warn">⏳ ${r.cooldownDays} gün beklemelisin</span>` : ''}
      </div>
      ${s ? `<div class="row center wrap gap-16" style="flex-wrap:wrap;justify-content:center">
        <span class="pill plain">${s.totalQuestions} soru</span>
        <span class="pill good">${s.correctCount} doğru</span>
        <span class="pill bad">${s.wrongCount} yanlış</span>
      </div>` : ''}
      ${r.nextRung ? `<button class="btn btn-primary gap-16" id="btn-next-rung">Sonraki Basamak: ${esc(r.nextRung)} →</button>` : ''}
      <button class="btn ${r.nextRung ? 'btn-ghost' : 'btn-primary'} gap-8" id="btn-back-home">Ana Sayfaya Dön</button>
    </div>`;
  $('#btn-back-home').addEventListener('click', () => reset('home'));
  const nx = $('#btn-next-rung');
  if (nx) nx.addEventListener('click', () => beginQuiz({ type: 'placement' }));
}

// ═══════════════════════════════════════════════════════════════
// KÜTÜPHANE
// ═══════════════════════════════════════════════════════════════

async function showLibrary() {
  $('#screen').innerHTML = `
    <div class="screen-pad">
      <h1 class="scr-title">Kütüphane</h1>
      <div class="field"><input id="lib-search" placeholder="Bir kelime ara… (kanji / romaji / anlam)"></div>
      <div class="chip-row" id="lib-levels">
        <div class="chip active" data-level="">Tümü</div>
        ${JLPT.map(l => `<div class="chip" data-level="${l}">${l}</div>`).join('')}
      </div>
      <div id="lib-list"><div class="spinner"></div></div>
      <div class="row center gap-16" id="lib-pager" hidden>
        <button class="btn-sm btn-outline" id="lib-prev">‹ Önceki</button>
        <span class="muted" id="lib-page-label"></span>
        <button class="btn-sm btn-outline" id="lib-next">Sonraki ›</button>
      </div>
    </div>`;
  $('#lib-search').addEventListener('input', debounce(() => {
    const q = $('#lib-search').value.trim();
    q ? searchLibrary(q) : loadLibrary(1);
  }, 350));
  $$('#lib-levels .chip').forEach(c => c.addEventListener('click', () => {
    $$('#lib-levels .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    state.library.level = c.dataset.level;
    loadLibrary(1);
  }));
  loadLibrary(1);
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function loadLibrary(page) {
  const myToken = activeToken;
  const lvl = state.library.level || '';
  const res = await api('GET', `/words?page=${page}&limit=12${lvl ? '&jlptLevel=' + lvl : ''}`);
  if (stale(myToken)) return;
  if (!res.ok) { $('#lib-list').innerHTML = '<div class="empty-state">Yüklenemedi.</div>'; return; }
  const { words, total, totalPages } = res.json.data;
  state.library.page = page; state.library.totalPages = totalPages;
  if (total === 0) {
    $('#lib-list').innerHTML = '<div class="empty-state">Kelime bulunamadı — <code>npm run seed</code> çalıştırıldı mı?</div>';
    $('#lib-pager').hidden = true; return;
  }
  renderLibList(words);
  $('#lib-pager').hidden = false;
  $('#lib-page-label').textContent = `${page} / ${totalPages}`;
  $('#lib-prev').onclick = () => { if (state.library.page > 1) loadLibrary(state.library.page - 1); };
  $('#lib-next').onclick = () => { if (state.library.page < state.library.totalPages) loadLibrary(state.library.page + 1); };
}

async function searchLibrary(q) {
  const myToken = activeToken;
  const res = await api('GET', '/words/search?q=' + encodeURIComponent(q));
  if (stale(myToken) || !res.ok) return;
  $('#lib-pager').hidden = true;
  res.json.data.length ? renderLibList(res.json.data) : $('#lib-list').innerHTML = '<div class="empty-state">Sonuç yok.</div>';
}

function renderLibList(words) {
  $('#lib-list').innerHTML = `<div class="wlist">${words.map(w => `
    <div class="witem" data-id="${w._id}">
      <div class="kj">${esc(w.kanji)}<small>${esc(w.kana || w.romaji)}</small></div>
      <div class="mean">${esc(w.meaning)}</div>
      <span class="badge">${esc(w.jlptLevel)}</span>
    </div>`).join('')}</div>`;
  $$('#lib-list .witem').forEach(el => el.addEventListener('click', () => go('word-detail', { id: el.dataset.id })));
}

async function showWordDetail({ id }) {
  const myToken = activeToken;
  $('#screen').innerHTML = topbar('Kelime') + spinner();
  const res = await api('GET', '/words/' + id);
  if (stale(myToken)) return;
  if (!guard(res)) return back();
  const w = res.json.data;
  $('#screen').innerHTML = topbar('Kelime') + `
    <div class="screen-pad">
      <div class="row between"><span class="badge">${esc(w.jlptLevel)}</span>${w.isCore ? '<span class="pill good">çekirdek</span>' : '<span class="pill plain">pasif</span>'}</div>
      <div class="wd-head gap-12">
        <div class="muted">${esc(w.type)}</div>
        <div class="kj">${esc(w.kanji)}</div>
        <div class="kana">${esc(w.kana || w.romaji)}</div>
        <div style="font-size:18px;font-weight:700;margin-top:8px">${esc(w.meaningTr || w.meaning)}</div>
        ${audioButtons(w.audioUrl)}
      </div>
      ${w.example ? `<div class="muted" style="margin-bottom:6px">ÖRNEK KULLANIM</div><div class="wd-example">${esc(w.example)}</div>`
                  : '<div class="empty-state">Örnek cümle henüz yok.</div>'}
    </div>`;
  wireAudioButtons();
}

// ═══════════════════════════════════════════════════════════════
// SEVİYELER
// ═══════════════════════════════════════════════════════════════

async function showLevels() {
  const myToken = activeToken;
  $('#screen').innerHTML = `<div class="screen-pad"><h1 class="scr-title">Seviyeler</h1><div class="spinner"></div></div>`;
  const res = await api('GET', '/progress');
  if (stale(myToken)) return;
  if (!res.ok) { $('#screen').innerHTML = `<div class="screen-pad"><h1 class="scr-title">Seviyeler</h1><div class="empty-state">Yüklenemedi.</div></div>`; return; }
  const { completionThreshold, levels } = res.json.data;
  levels.sort((a, b) => JLPT.indexOf(a.jlptLevel) - JLPT.indexOf(b.jlptLevel));
  $('#screen').innerHTML = `
    <div class="screen-pad">
      <h1 class="scr-title">Seviyeler</h1>
      <div class="card">
        ${levels.map(l => `
          <div class="level-row" data-level="${l.jlptLevel}" style="${l.isUnlocked ? 'cursor:pointer' : 'opacity:.55'}">
            <div class="lvl-chip ${l.isUnlocked ? '' : 'locked'}">${l.jlptLevel}</div>
            <div style="flex:1">
              <div class="row between" style="margin-bottom:4px"><span style="font-size:12.5px">${l.totalWords} kelime</span>${!l.isUnlocked ? '<span class="muted">🔒</span>' : ''}</div>
              <div class="meter"><i style="width:${l.completionRate}%"></i></div>
            </div>
            <div class="pct">%${l.completionRate}</div>
          </div>`).join('')}
      </div>
      <div class="muted">ℹ️ Bir sonraki seviyeye geçmek için listeyi %${completionThreshold} oranında tamamlayın.</div>
    </div>`;
  $$('.level-row').forEach(el => {
    const l = levels.find(x => x.jlptLevel === el.dataset.level);
    if (l.isUnlocked) el.addEventListener('click', () => go('level-detail', { level: l.jlptLevel }));
  });
}

async function showLevelDetail({ level }) {
  const myToken = activeToken;
  $('#screen').innerHTML = topbar(`${level} Seviyesi`) + spinner();
  const [distRes, quizStatusRes] = await Promise.all([api('GET', `/progress/${level}/distribution`), api('GET', '/quiz/status')]);
  if (stale(myToken)) return;
  if (!guard(distRes)) return back();
  const d = distRes.json.data;
  const started = d.totalWords - d.notStarted;
  const progRes = await api('GET', '/progress');
  if (stale(myToken)) return;
  const progressLevel = progRes.json.data.levels.find(l => l.jlptLevel === level);
  const canAttempt = quizStatusRes.ok && quizStatusRes.json.data.levels[level]?.canAttempt;

  $('#screen').innerHTML = topbar(`${level} Seviyesi`) + `
    <div class="screen-pad">
      <div class="donut-wrap card">
        <div class="donut" style="background:${donutStyle(d.distribution, d.totalWords)}"><div class="hole"><b>%${progressLevel?.completionRate ?? 0}</b><span>Tamamlandı</span></div></div>
        <div class="legend">
          ${[5, 4, 3, 2, 1].map(l => `<span><span class="sw" style="background:var(--m${l})"></span>${l}. Seviye (${d.distribution[l] || 0})</span>`).join('')}
          <span><span class="sw" style="background:var(--line)"></span>Başlanmadı (${d.notStarted})</span>
        </div>
      </div>
      ${canAttempt ? `<button class="btn btn-secondary" id="btn-levelup-quiz">Seviye Atlama Sınavı Başlat</button>` : ''}
      <h2 class="gap-16">Kelime Listesi</h2>
      <select id="wl-mastery" class="gap-8">
        <option value="">Tüm seviyeler</option>
        ${[1, 2, 3, 4, 5].map(l => `<option value="${l}">${l}. Seviye</option>`).join('')}
      </select>
      <div id="wl-box" class="gap-8"><div class="spinner"></div></div>
    </div>`;
  if (canAttempt) $('#btn-levelup-quiz').addEventListener('click', () => beginQuiz({ type: 'levelup', jlptLevel: level }));
  $('#wl-mastery').addEventListener('change', () => loadLevelWordList(level, $('#wl-mastery').value));
  loadLevelWordList(level, '');
}

async function loadLevelWordList(level, mastery) {
  const myToken = activeToken;
  const res = await api('GET', `/userwords/list?jlptLevel=${level}${mastery ? '&masteryLevel=' + mastery : ''}&limit=15`);
  if (stale(myToken) || !res.ok) return;
  const { items, total } = res.json.data;
  $('#wl-box').innerHTML = total === 0 ? '<div class="empty-state">Bu filtreyle çalışılmış kelime yok.</div>' :
    `<div class="wlist">${items.map(i => `
      <div class="witem" style="cursor:default">
        <div class="kj">${esc(i.word?.kanji)}<small>${esc(i.word?.romaji)}</small></div>
        <div class="mean">${esc(i.word?.meaningTr || i.word?.meaning)}</div>
        <span class="pill plain">${i.masteryLevel}. seviye</span>
      </div>`).join('')}</div>`;
}

// ═══════════════════════════════════════════════════════════════
// AYARLAR
// ═══════════════════════════════════════════════════════════════

function showSettings() {
  const me = state.me || {};
  const prefs = me.preferences || {};
  $('#screen').innerHTML = `
    <div class="screen-pad">
      <h1 class="scr-title">Ayarlar</h1>
      <div class="settings-list card">
        <button class="settings-item" id="st-ads"><span class="ic">🚫</span><span class="lbl">Reklamları Kaldır</span><span class="chev">›</span></button>
        <button class="settings-item" id="st-goal"><span class="ic">🎯</span><span class="lbl">Günlük Kelime Hedefi</span><span class="val">${me.dailyGoal ?? 20}</span><span class="chev">›</span></button>
        <button class="settings-item" id="st-password"><span class="ic">🔑</span><span class="lbl">Şifreyi Değiştir</span><span class="chev">›</span></button>
        <button class="settings-item" id="st-notif"><span class="ic">🔔</span><span class="lbl">Bildirim Ayarları</span><span class="chev">›</span></button>
        <button class="settings-item" id="st-lang"><span class="ic">🌐</span><span class="lbl">Dil Ayarları</span><span class="val">Türkçe</span><span class="chev">›</span></button>
        <button class="settings-item" id="st-theme"><span class="ic">🌗</span><span class="lbl">Tema Değiştir</span><span class="val">${themeLabel(prefs.theme)}</span><span class="chev">›</span></button>
        <button class="settings-item" id="st-font"><span class="ic">🔤</span><span class="lbl">Font Boyutu</span><span class="val">${fontLabel(prefs.fontSize)}</span><span class="chev">›</span></button>
        <button class="settings-item" id="st-about"><span class="ic">ℹ️</span><span class="lbl">Hakkında</span><span class="chev">›</span></button>
        <button class="settings-item" id="st-logout"><span class="ic">↪</span><span class="lbl">Çıkış Yap</span><span class="chev">›</span></button>
        <button class="settings-item danger" id="st-delete"><span class="ic">🗑</span><span class="lbl">Hesabı Sil</span><span class="chev">›</span></button>
      </div>
    </div>`;
  $('#st-ads').addEventListener('click', () => toast('Bu özellik yakında', ''));
  $('#st-goal').addEventListener('click', () => go('settings-goal'));
  $('#st-password').addEventListener('click', () => go('settings-password-current'));
  $('#st-notif').addEventListener('click', () => go('settings-notifications'));
  $('#st-lang').addEventListener('click', () => toast('Şu an yalnızca Türkçe destekleniyor', ''));
  $('#st-theme').addEventListener('click', () => cycleTheme());
  $('#st-font').addEventListener('click', () => cycleFont());
  $('#st-about').addEventListener('click', () => go('settings-about'));
  $('#st-logout').addEventListener('click', () => {
    showModal(`<div class="modal-sheet"><div class="ic">↪</div><h3>Çıkış Yap</h3><p>Bu cihazdan çıkış yapmak istediğine emin misin?</p>
      <button class="btn btn-danger" id="modal-confirm-logout">Çıkış Yap</button>
      <button class="btn btn-ghost gap-8" id="modal-cancel">Vazgeç</button></div>`);
    $('#modal-confirm-logout').addEventListener('click', async () => {
      await api('POST', '/auth/logout', { refreshToken: state.refresh });
      setTokens(null, null); state.me = null; state.checkedPlacement = false;
      closeModal(); reset('welcome');
    });
    $('#modal-cancel').addEventListener('click', closeModal);
  });
  $('#st-delete').addEventListener('click', () => go('settings-delete'));
}

function themeLabel(t) { return t === 'dark' ? 'Koyu' : t === 'system' ? 'Sistem' : 'Açık'; }
function fontLabel(f) { return f === 'small' ? 'Küçük' : f === 'large' ? 'Büyük' : 'Orta'; }

async function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const cur = state.me?.preferences?.theme || 'light';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  const res = await api('PUT', '/auth/update-info', { preferences: { theme: next } });
  if (guard(res)) { state.me = res.json.data; applyThemeFont(); showSettings(); }
}
async function cycleFont() {
  const order = ['small', 'medium', 'large'];
  const cur = state.me?.preferences?.fontSize || 'medium';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  const res = await api('PUT', '/auth/update-info', { preferences: { fontSize: next } });
  if (guard(res)) { state.me = res.json.data; applyThemeFont(); showSettings(); }
}

function showSettingsGoal() {
  const options = [10, 15, 20, 25, 30, 40, 50];
  const cur = state.me?.dailyGoal ?? 20;
  $('#screen').innerHTML = topbar('Günlük Kelime Hedefi') + `
    <div class="screen-pad">
      <p class="muted gap-8" style="margin-bottom:16px">Her gün kaç kelime çalışmak istersin?</p>
      <select id="goal-select">${options.map(o => `<option value="${o}" ${o === cur ? 'selected' : ''}>${o} kelime</option>`).join('')}</select>
      <button class="btn btn-primary gap-16" id="btn-save-goal">Kaydet</button>
    </div>`;
  $('#btn-save-goal').addEventListener('click', async () => {
    const res = await api('PUT', '/auth/update-info', { dailyGoal: Number($('#goal-select').value) });
    if (guard(res, 'Günlük hedef güncellendi')) { state.me = res.json.data; back(); }
  });
}

function showSettingsPasswordCurrent() {
  $('#screen').innerHTML = topbar('Şifreyi Değiştir') + `
    <div class="screen-pad">
      <h1 class="scr-title">Mevcut Şifren</h1>
      <p class="muted gap-8" style="margin-bottom:20px">Devam etmek için mevcut şifreni gir.</p>
      <div class="field"><div class="wrap"><input id="in-pw" type="password" placeholder="Mevcut şifren"><button type="button" class="eye" data-toggle-eye="in-pw">👁</button></div></div>
      <div class="err-line" id="pw-err"></div>
      <button class="btn btn-primary gap-8" id="btn-verify">Devam Et</button>
    </div>`;
  wireEyeToggle();
  $('#btn-verify').addEventListener('click', async () => {
    const password = $('#in-pw').value, err = $('#pw-err');
    const res = await api('POST', '/auth/verify-password', { password });
    if (!res.ok) { err.textContent = res.json.message || 'Şifreniz yanlış. Lütfen tekrar deneyin.'; return; }
    state.verifiedOldPassword = password;
    go('settings-password-new');
  });
}

function showSettingsPasswordNew() {
  $('#screen').innerHTML = topbar('Şifreyi Değiştir') + `
    <div class="screen-pad">
      <h1 class="scr-title">Yeni Şifre Oluştur</h1>
      <p class="muted gap-8" style="margin-bottom:20px">Lütfen şifreni gir ve doğrula.</p>
      <div class="field">
        <label>Şifre</label>
        <div class="wrap"><input id="in-pw" type="password" placeholder="En az 8 karakter"><button type="button" class="eye" data-toggle-eye="in-pw">👁</button></div>
      </div>
      <div id="pw-strength"></div>
      <div class="field gap-12"><label>Şifre (tekrar)</label><input id="in-pw2" type="password"></div>
      <div class="err-line" id="pw-err"></div>
      <button class="btn btn-primary gap-8" id="btn-continue">Şifreyi Değiştir</button>
    </div>`;
  const pw = $('#in-pw'), box = $('#pw-strength');
  box.innerHTML = pwBarsHtml(0);
  wirePwStrength(pw, box);
  wireEyeToggle();
  $('#btn-continue').addEventListener('click', async () => {
    const p1 = $('#in-pw').value, p2 = $('#in-pw2').value, err = $('#pw-err');
    if (p1.length < 8) { err.textContent = 'Şifre en az 8 karakter olmalı'; return; }
    if (p1 !== p2) { err.textContent = 'Şifreler eşleşmiyor'; return; }
    const res = await api('PUT', '/auth/change-password', {
      oldPassword: state.verifiedOldPassword, newPassword: p1, deviceName: 'web-simülatör'
    });
    if (!res.ok) { err.textContent = res.json.message || 'Şifre değiştirilemedi'; return; }
    setTokens(res.json.data.accessToken, res.json.data.refreshToken);
    reset('settings-password-success');
  });
}

function showSettingsPasswordSuccess() {
  statusScreen({
    icon: '✱', kind: 'brand', title: 'Şifreniz Değiştirildi',
    body: 'Başarıyla işleminiz tamamlandı. Öğrenmeye kaldığınız yerden devam edebilirsiniz!',
    buttonLabel: 'Ana Sayfaya Dön', onContinue: () => reset('home')
  });
}

function showSettingsNotifications() {
  const ns = state.me?.notificationSettings || {};
  $('#screen').innerHTML = topbar('Bildirim Ayarları') + `
    <div class="screen-pad">
      <div class="toggle-row"><span class="lbl">Günlük Kelime Bildirimleri</span><div class="switch ${ns.dailyReminder !== false ? 'on' : ''}" data-key="dailyReminder"><i></i></div></div>
      <div class="toggle-row"><span class="lbl">Hatırlatma Bildirimleri</span><div class="switch ${ns.streakReminder !== false ? 'on' : ''}" data-key="streakReminder"><i></i></div></div>
      <div class="toggle-row"><span class="lbl">Seviye Bildirimleri</span><div class="switch ${ns.wordLevelDown !== false ? 'on' : ''}" data-key="wordLevelDown"><i></i></div></div>
      <button class="btn btn-primary gap-16" id="btn-save-notif">Kaydet</button>
    </div>`;
  $$('.switch').forEach(s => s.addEventListener('click', () => s.classList.toggle('on')));
  $('#btn-save-notif').addEventListener('click', async () => {
    const notificationSettings = {};
    $$('.switch').forEach(s => { notificationSettings[s.dataset.key] = s.classList.contains('on'); });
    const res = await api('PUT', '/auth/update-info', { notificationSettings });
    if (guard(res, 'Bildirim ayarları kaydedildi')) { state.me = res.json.data; back(); }
  });
}

function showSettingsAbout() {
  const lorem = 'Lorem ipsum dolor sit amet consectetur adipiscing elit. In cursus id tellus vitae pellentesque. Tempus leo an aenean pretium volutpat placerat. In curius massa lacinia integer posuere, ad litora torquent per conubia nostra inceptos himenaeos.';
  $('#screen').innerHTML = topbar('Hakkında') + `
    <div class="screen-pad legal-text">
      <h2>Kullanıcı Sözleşmesi</h2><p>${lorem}</p>
      <div class="hairline"></div>
      <h2>Gizlilik Politikası</h2><p>${lorem}</p>
      <div class="hairline"></div>
      <h2>KVKK Aydınlatma &amp; Açık Rıza Metni</h2><p>${lorem}</p>
      <div class="center gap-16 muted">Uygulama Versiyonu 1.0.0<br>© Gökyüzü Herkesindir 2026</div>
    </div>`;
}

function showSettingsDelete() {
  $('#screen').innerHTML = topbar('Hesabı Sil') + `
    <div class="screen-pad">
      <h1 class="scr-title">Hesabını Sil</h1>
      <p class="muted gap-8" style="margin-bottom:20px">Bu işlem geri alınamaz. Tüm ilerlemen, kelimelerin ve istatistiklerin kalıcı olarak silinir.</p>
      <div class="field"><label>Şifren</label><input id="in-pw" type="password" placeholder="Onaylamak için şifreni gir"></div>
      <div class="err-line" id="del-err"></div>
      <button class="btn btn-danger gap-8" id="btn-delete">Hesabı Kalıcı Olarak Sil</button>
    </div>`;
  $('#btn-delete').addEventListener('click', async () => {
    const password = $('#in-pw').value, err = $('#del-err');
    if (!password) { err.textContent = 'Şifre gerekli'; return; }
    const res = await api('DELETE', '/auth/delete-account', { password });
    if (!res.ok) { err.textContent = res.json.message || 'Silinemedi'; return; }
    setTokens(null, null); state.me = null; state.checkedPlacement = false;
    toast('Hesap silindi', 'ok');
    reset('welcome');
  });
}

// ═══════════════════════════════════════════════════════════════
// Ekran tablosu + önyükleme
// ═══════════════════════════════════════════════════════════════

const SHOW = {
  welcome: showWelcome,
  'reg-email': showRegEmail, 'reg-name': showRegName, 'reg-password': showRegPassword, 'reg-success': showRegSuccess,
  'verify-ok': showVerifyOk, 'verify-fail': showVerifyFail, 'verify-nudge': showVerifyNudge,
  login: showLogin, 'forgot-email': showForgotEmail, 'forgot-newpass': showForgotNewPass, 'reset-success': showResetSuccess,
  home: showHome, notifications: showNotifications,
  lesson: renderLessonScreen, 'quiz-question': showQuizQuestion, 'quiz-result': showQuizResult,
  library: showLibrary, 'word-detail': showWordDetail,
  levels: showLevels, 'level-detail': showLevelDetail,
  settings: showSettings, 'settings-goal': showSettingsGoal,
  'settings-password-current': showSettingsPasswordCurrent, 'settings-password-new': showSettingsPasswordNew,
  'settings-password-success': showSettingsPasswordSuccess, 'settings-notifications': showSettingsNotifications,
  'settings-about': showSettingsAbout, 'settings-delete': showSettingsDelete
};

function renderDevBar() {
  const bar = $('#dev-bar');
  if (!state.access) { bar.hidden = true; return; }
  bar.hidden = false;
  $('#dev-email').textContent = state.profile?.email || state.wizard.email || state.me?.email || '(oturum açık)';
}
$('#dev-bar')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-dev]');
  if (!btn) return;
  if (btn.dataset.dev === 'reset') {
    await api('POST', '/auth/logout', { refreshToken: state.refresh }).catch(() => {});
    setTokens(null, null); state.me = null; state.checkedPlacement = false;
    reset('welcome');
  }
  if (btn.dataset.dev === 'fresh') {
    setTokens(null, null); state.me = null; state.checkedPlacement = false; state.wizard = {};
    reset('welcome'); go('reg-email');
    setTimeout(() => { $('#in-email').value = `test${Date.now().toString(36)}@musubi.dev`; }, 0);
  }
});

boot();
