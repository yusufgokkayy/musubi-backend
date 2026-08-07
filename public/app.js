/* Musubi mobil simülatör — gerçek backend API'sine bağlı, 04.08.2026 Figma
   revizyonunu izleyen "telefon" arayüzü. Mobil client hazır olmadığı için
   manuel curl testi yerine gerçek kullanıcı akışıyla (kayıt → doğrulama →
   ders → sınav → hafıza → ayarlar) tıklanarak test edilsin diye yazıldı.
   Aynı origin'den servis edilir (CORS yok); helmet CSP satır içi script'e
   izin vermediği için TÜM JS bu dosyadadır. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
const TAB_ROOTS = ['home', 'library', 'memory', 'settings'];

// Hafıza kutusu → CSS değişkeni. Sunucu kutu anahtarlarını ve etiketlerini
// kendisi veriyor (bkz. GET /memory) — burada YALNIZCA renk eşlemesi var,
// isim/sıra/eşik sözlüğü istemcide TUTULMAZ.
const BOX_COLOR = { new: 'var(--box-new)', weak: 'var(--box-weak)', medium: 'var(--box-medium)', good: 'var(--box-good)', mastered: 'var(--box-mastered)' };

const state = {
  access: localStorage.getItem('musubi_access') || null,
  refresh: localStorage.getItem('musubi_refresh') || null,
  me: null,
  stack: [{ name: 'welcome' }],
  wizard: {},
  devVerificationToken: localStorage.getItem('musubi_dev_vtoken') || null,
  devResetToken: localStorage.getItem('musubi_dev_rtoken') || null,
  promptedPlacement: false,
  home: null,
  lesson: null,
  quiz: null,
  library: { page: 1, totalPages: 1, level: '', q: '' },
  memory: null
};

// ═══════════════════════════════════════════════════════════════
// İkonlar — hepsi stroke tabanlı, renk CSS'ten gelir
// ═══════════════════════════════════════════════════════════════
const I = {
  chevL: '<svg viewBox="0 0 10 18"><path d="M8.5 1 1.5 9l7 8"/></svg>',
  chevR: '<svg viewBox="0 0 8 14"><path d="M1 1l6 6-6 6"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.4V20h13V9.4"/></svg>',
  books: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="4.5" height="16" rx="1"/><rect x="10" y="4" width="4.5" height="16" rx="1"/><path d="M17.2 4.7l3.3.9-3.4 14-3.3-.9"/></svg>',
  brain: '<svg viewBox="0 0 24 24"><path d="M12 4.5v15"/><path d="M12 6a3 3 0 0 0-5.6-1.5A2.8 2.8 0 0 0 4 8.6a3 3 0 0 0-.4 5A3 3 0 0 0 5.6 19 3 3 0 0 0 12 18"/><path d="M12 6a3 3 0 0 1 5.6-1.5A2.8 2.8 0 0 1 20 8.6a3 3 0 0 1 .4 5A3 3 0 0 1 18.4 19 3 3 0 0 1 12 18"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.4v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8.5" r="4.5"/><path d="M11.3 11.8 20 20.5"/><path d="M17 17.5l2-2"/></svg>',
  bellRing: '<svg viewBox="0 0 24 24"><path d="M17.5 9a5.5 5.5 0 1 0-11 0c0 5.5-1.8 6.5-1.8 6.5h14.6S17.5 14.5 17.5 9"/><path d="M13.5 19a1.8 1.8 0 0 1-3 0"/><path d="M20 3.5A9 9 0 0 1 21.8 7M4 3.5A9 9 0 0 0 2.2 7"/></svg>',
  translate: '<svg viewBox="0 0 24 24"><path d="M2.5 5.5h9"/><path d="M7 3.5v2"/><path d="M9.5 5.5c0 3.5-2.4 6.5-6 8"/><path d="M4 9.5c1.4 2.4 3.6 4 6 4.6"/><path d="M12.5 20.5l4-11 4 11"/><path d="M14 17h5"/></svg>',
  palette: '<svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 1 9-9c0 2-1.6 3-3 3h-1.5a2 2 0 0 0-1.4 3.4c.4.5.4 1.3-.2 1.9-.5.5-1.3.7-1.9.7"/><circle cx="7.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.2" cy="8" r="1.1" fill="currentColor" stroke="none"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="11.5" cy="12.5" r="8.5"/><circle cx="11.5" cy="12.5" r="4.6"/><circle cx="11.5" cy="12.5" r="1.1" fill="currentColor" stroke="none"/><path d="M14.5 9.5 20 4"/><path d="M17.4 3.2l.4 2.6 2.6.4"/></svg>',
  bookOpen: '<svg viewBox="0 0 24 24"><path d="M12 6.5S10 4.5 3.5 4.5v13C10 17.5 12 19.5 12 19.5s2-2 8.5-2v-13C14 4.5 12 6.5 12 6.5z"/><path d="M12 6.5v13"/></svg>',
  typeface: '<svg viewBox="0 0 24 24"><path d="M2.5 18 7 6l4.5 12"/><path d="M4 14.2h6"/><path d="M14 18l3.5-8L21 18"/><path d="M15.2 15.4h4.6"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M14 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h8"/><path d="M15.5 16.5 20 12l-4.5-4.5"/><path d="M20 12H9"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 6.5h16"/><path d="M9 6.5V4.5h6v2"/><path d="M6.5 6.5 7.4 20a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-13.5"/><path d="M10.5 10.5v7M13.5 10.5v7"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.5-2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M10 5.7A9.9 9.9 0 0 1 12 5.5C18.2 5.5 22 12 22 12a17 17 0 0 1-3 3.8M6.3 7.9A17 17 0 0 0 2 12s3.8 6.5 10 6.5a9.6 9.6 0 0 0 4-.8"/><path d="M3 3l18 18"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M16.4 4.6a2.3 2.3 0 0 1 3.3 3.3L8.2 19.4 3.5 20.5l1.1-4.7z"/></svg>',
  check: '<svg viewBox="0 0 14 14"><path d="M2 7.4 5.3 10.7 12 4"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2"/><path d="m7.8 12.2 2.9 2.9 5.6-6"/></svg>',
  xCircle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
  qCircle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4"/><circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M13 2.5s.9 3.2-1.2 5.6c-2 2.3-4.6 3.4-4.6 7.1a6.3 6.3 0 0 0 12.6.3c0-3.6-2.2-5.5-3.2-6.6 0 1.6-.8 2.6-1.8 2.9.6-2.6-.3-6.7-1.8-9.3z"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M3 11v2M6.5 8.5v7M10 5.5v13M13.5 8v8M17 10v4M20.5 11.5v1"/></svg>',
  snail: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="13" r="7.5"/><path d="M10.5 13a3 3 0 1 1 3 3 4.5 4.5 0 0 1-4.5-4.5A6 6 0 0 1 15 5.5"/><path d="M18 20.5h-7.5"/><path d="M18.5 7.5 21 4.5M20.2 5.7l1.6.6"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.6 7a7 7 0 0 1 0 10"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9.5 18.5h5"/><path d="M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.7 11.8c.6.5 1 1.2 1.1 2h5.2c.1-.8.5-1.5 1.1-2A6.5 6.5 0 0 0 12 2.5z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/></svg>',
  trend: '<svg viewBox="0 0 24 24"><path d="M3 17 9.5 10.5l4 4L21 7"/><path d="M15.5 7H21v5.5"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2"/><path d="M10 9v6M14 9v6"/></svg>',
  close: '<svg viewBox="0 0 20 20"><path d="m4 4 12 12M16 4 4 16"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>',
  levels: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>'
};

// ═══════════════════════════════════════════════════════════════
// API istemcisi
// ═══════════════════════════════════════════════════════════════
async function api(method, path, body, opts = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && state.access) headers.Authorization = 'Bearer ' + state.access;

  let res, json;
  try {
    res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    json = await res.json().catch(() => ({}));
  } catch {
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
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

// ═══════════════════════════════════════════════════════════════
// Navigasyon
// ═══════════════════════════════════════════════════════════════
function go(name, data) { state.stack.push({ name, data }); renderCurrent(); }
function reset(name, data) { state.stack = [{ name, data }]; renderCurrent(); }
function back() { if (state.stack.length > 1) state.stack.pop(); renderCurrent(); }
function current() { return state.stack[state.stack.length - 1]; }

// Ekranlar arası hızlı geçişte bir önceki ekranın bekleyen async render'ı
// güncel ekranı sessizce ezebiliyordu. Her navigasyonda artan bu token,
// async fonksiyonların "hâlâ güncel ekran ben miyim?" diye sormasını sağlar.
let activeToken = 0;
const stale = (t) => t !== activeToken;

function renderCurrent() {
  activeToken++;
  closeSheet();
  const top = current();
  renderTabbar(top.name);
  SHOW[top.name](top.data || {});
}

function renderTabbar(name) {
  const slot = $('#tabbar-slot');
  if (!TAB_ROOTS.includes(name)) { slot.innerHTML = ''; return; }
  const tabs = [['home', I.home, 'Anasayfa'], ['library', I.books, 'Kütüphane'], ['memory', I.brain, 'Hafıza'], ['settings', I.gear, 'Ayarlar']];
  slot.innerHTML = `<nav class="tabbar">${tabs.map(([id, ic, lbl]) =>
    `<button data-tab="${id}" class="${name === id ? 'on' : ''}">${ic}<span>${lbl}</span></button>`).join('')}</nav>`;
}

function paint(html) { $('#screen').innerHTML = html; }
function loading(topbarHtml = '') { paint(topbarHtml + '<div class="loading"><div class="spinner"></div></div>'); }

function topbar(title = 'Geri') {
  return `<div class="topbar"><button data-back>${I.chevL}<span>${esc(title)}</span></button></div>`;
}
function pagehead(jp, title, opts = {}) {
  return `<div class="pagehead">
    <div><div class="jp">${esc(jp)}</div><h1>${esc(title)}</h1></div>
    <div class="headtools">
      <div class="bell" data-nav="notifications">${I.bell}<span class="dot" ${opts.unread ? '' : 'hidden'}></span></div>
      ${avatarHtml()}
    </div>
  </div>`;
}
function avatarHtml() {
  const url = state.home?.avatarUrl;
  const initial = (state.me?.name || 'M').trim().charAt(0).toLocaleUpperCase('tr');
  return url ? `<img class="avatar" src="${esc(url)}" alt="">` : `<div class="avatar" data-tab="settings">${esc(initial)}</div>`;
}

function sheet(html) { $('#sheet-slot').innerHTML = `<div class="overlay" data-overlay><div class="sheet">${html}</div></div>`; }
function closeSheet() { $('#sheet-slot').innerHTML = ''; }

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) return reset(tab.dataset.tab);
  if (e.target.closest('[data-back]')) return back();
  const nav = e.target.closest('[data-nav]');
  if (nav) return go(nav.dataset.nav);
  if (e.target.matches('[data-overlay]')) return closeSheet();
});

// ═══════════════════════════════════════════════════════════════
// Ortak parçalar
// ═══════════════════════════════════════════════════════════════
function ringSvg(pct, { size = 168, stroke = 13, color = 'var(--brand)', track = 'var(--line)', second = 0, secondColor = 'var(--warn)' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const a = c * Math.min(1, Math.max(0, pct));
  const b = c * Math.min(1 - Math.min(1, pct), Math.max(0, second));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="${b > 0.5 ? 'butt' : 'round'}" stroke-dasharray="${a} ${c - a}"/>
    ${b > 0.5 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${secondColor}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${b} ${c - b}" stroke-dashoffset="${-a}"/>` : ''}
  </svg>`;
}

function badge(level, cls = '') { return `<span class="badge ${cls}">${esc(level)}</span>`; }

function wordRow(w, { right, tail, click } = {}) {
  return `<button class="wordrow" ${click ? `data-word="${esc(w._id || w.id)}"` : ''}>
    <span class="jp"><b>${esc(w.kanji)}</b><span>${esc(w.romaji || w.kana || '')}</span></span>
    <span class="tr">${esc(right ?? (w.meaningTr || w.meaning))}</span>
    ${tail || ''}
  </button>`;
}

// Ses: "Yavaş" ayrı bir dosya değil, aynı sesin düşük hızda çalınmasıdır
// (audioUrlSlow henüz backend'de yok — geldiğinde burası tek satır değişir).
function audioRow(url) {
  if (!url) return '';
  return `<div class="pillbtns gap-16">
    <button class="pillbtn" data-audio="${esc(url)}">${I.wave}<span>Dinle</span></button>
    <button class="pillbtn" data-audio="${esc(url)}" data-slow="1">${I.snail}<span>Yavaş</span></button>
  </div>`;
}
function wireAudio() {
  $$('[data-audio]').forEach(b => b.addEventListener('click', () => {
    const a = new Audio(b.dataset.audio);
    if (b.dataset.slow) a.playbackRate = 0.6;
    a.play().catch(() => toast('Ses çalınamadı (URL erişilemiyor olabilir)', 'err'));
  }));
}

// exampleFurigana biçimi: 東京[とうきょう]**駅[えき]**で会[あ]いましょう。
// Köşeli parantez kendinden önceki kanji dizisinin okunuşu, ** ** ise
// cümledeki hedef kelime (tasarımdaki kırmızı vurgu).
function furigana(src, plain) {
  if (!src) return esc(plain || '');
  return esc(src)
    .replace(/\*\*(.+?)\*\*/g, '<em>$1</em>')
    .replace(/([一-鿿々]+|[぀-ヿ]+)\[([^\]]+)\]/g, '<ruby>$1<rt>$2</rt></ruby>');
}

function exampleBlock(w) {
  if (!w.example && !w.exampleFurigana) return '';
  return `<div class="row between gap-24" style="margin-bottom:8px">
      <span class="slabel">Örnek Kullanım</span>
      ${w.audioUrl ? `<button class="bell" data-audio="${esc(w.audioUrl)}" style="width:22px;height:22px">${I.speaker}</button>` : ''}
    </div>
    <div class="example">${furigana(w.exampleFurigana, w.example)}</div>
    ${w.exampleTr ? `<p class="tiny gap-8">${esc(w.exampleTr)}</p>` : ''}`;
}

function pwScore(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-zçğıöşü]/.test(pw) && /[A-ZÇĞİÖŞÜ]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
function pwBars(score) {
  const cls = score <= 1 ? 'weak' : score <= 2 ? 'mid' : 'strong';
  const label = ['Çok zayıf şifre', 'Zayıf şifre', 'Orta şifre', 'İyi şifre', 'Güçlü şifre'][score];
  return `<div class="strength">${[0, 1, 2, 3].map(i => `<i class="${i < score ? 'on ' + cls : ''}"></i>`).join('')}</div>
    <div class="strength-label">${label}</div>`;
}
function pwField(id, placeholder = 'En az 8 karakter') {
  return `<div class="input">${I.lock}<input id="${id}" type="password" placeholder="${esc(placeholder)}">
    <button type="button" class="eye" data-eye="${id}">${I.eye}</button></div>`;
}
function wireEyes() {
  $$('[data-eye]').forEach(b => b.addEventListener('click', () => {
    const inp = $('#' + b.dataset.eye);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    b.innerHTML = inp.type === 'password' ? I.eye : I.eyeOff;
  }));
}
function wireStrength(inputId, boxId) {
  const inp = $('#' + inputId), box = $('#' + boxId);
  box.innerHTML = pwBars(0);
  inp.addEventListener('input', () => { box.innerHTML = pwBars(pwScore(inp.value)); });
}

// Genel durum ekranı (Hesabınız Oluşturuldu, Şifreniz Değiştirildi, …)
function statusScreen({ icon = I.checkCircle, tone = '', title, body, primary, secondary }) {
  paint(`<div class="center-scr">
      <div class="blob ${tone}">${icon}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
      <button class="btn btn-primary" id="s-primary" style="max-width:300px">${esc(primary.label)}</button>
      ${secondary ? `<button class="btn btn-ghost" id="s-secondary" style="max-width:300px">${esc(secondary.label)}</button>` : ''}
    </div>`);
  $('#s-primary').addEventListener('click', primary.onClick);
  if (secondary) $('#s-secondary').addEventListener('click', secondary.onClick);
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════
function showWelcome() {
  paint(`<div class="pad" style="display:flex;flex-direction:column">
      <div style="flex:1;display:grid;place-items:center;padding:28px 0">
        <img src="/assets/musubi-logo.png" alt="Musubi" style="width:172px;height:172px">
      </div>
      <h1 class="title-xl">Kelime Ezberlemenin<br>En Hızlı Yolu</h1>
      <p class="lead">Hesabını kurmaya devam etmek için lütfen tercih ettiğin yöntemi seç.</p>
      <button class="btn btn-primary" id="b-register">Kayıt Ol</button>
      <button class="btn btn-outline" id="b-login">Giriş Yap</button>
      <p class="legal gap-24">Yeni bir hesap oluşturuyorsanız
        <button class="link" data-legal="terms">Kullanıcı Sözleşmesi</button>,
        <button class="link" data-legal="kvkk">KVKK Aydınlatma &amp; Açık Rıza Metni</button> ve
        <button class="link" data-legal="privacy">Gizlilik Politikası</button> geçerli olacaktır.</p>
    </div>`);
  $('#b-register').addEventListener('click', () => { state.wizard = {}; go('reg-email'); });
  $('#b-login').addEventListener('click', () => go('login'));
  $$('[data-legal]').forEach(b => b.addEventListener('click', () => go('legal-doc', { key: b.dataset.legal })));
}

// Form iskeleti: başlık + alanlar üstte, birincil buton EKRANIN ALTINDA sabit
function formScreen({ title, lead, body, action, backLabel = 'Geri' }) {
  paint(topbar(backLabel) + `
    <div class="pad">
      <h1 class="title-xl">${esc(title)}</h1>
      ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
      ${body}
    </div>
    <div class="footer"><button class="btn btn-primary" id="f-action">${esc(action)}</button></div>`);
}

function showRegEmail() {
  formScreen({
    title: 'E-posta ile Devam Et',
    lead: 'Lütfen bir sonraki adıma geçmek için e-postanızı giriniz.',
    action: 'Devam Et',
    body: `<div class="input" id="w-email">${I.mail}<input id="in-email" type="email" placeholder="ornek@ornek.com" value="${esc(state.wizard.email || '')}"></div>
           <div class="errline" id="err"></div>`
  });
  const input = $('#in-email'), err = $('#err'), wrap = $('#w-email');
  input.addEventListener('input', () => { wrap.classList.remove('bad'); err.textContent = ''; });
  $('#f-action').addEventListener('click', async () => {
    const email = input.value.trim();
    const fail = (msg, html) => { wrap.classList.add('bad'); if (html) err.innerHTML = html; else err.textContent = msg; };
    if (!/^[\w.-]+@([\w-]+\.)+[\w-]{2,}$/.test(email)) return fail('E-posta formatınız yanlış');
    const res = await api('POST', '/auth/check-email', { email }, { auth: false });
    if (!res.ok) return fail(res.json.message || 'Bir şeyler ters gitti');
    if (!res.json.available) {
      fail(null, 'Bu e-posta ile zaten hesap açılmış. Lütfen <button class="link" id="to-login">giriş yapın</button>.');
      $('#to-login').addEventListener('click', () => { state.wizard.email = email; go('login'); });
      return;
    }
    state.wizard.email = email;
    go('reg-name');
  });
}

function showRegName() {
  formScreen({
    title: 'Adın Soyadın',
    lead: 'Sana nasıl seslenelim?',
    action: 'Devam Et',
    body: `<div class="field"><label>Ad</label><div class="input">${I.user}<input id="in-name" placeholder="Adın" value="${esc(state.wizard.name || '')}"></div></div>
           <div class="field"><label>Soyad</label><div class="input">${I.user}<input id="in-surname" placeholder="Soyadın" value="${esc(state.wizard.surname || '')}"></div></div>
           <div class="errline" id="err"></div>`
  });
  $('#f-action').addEventListener('click', () => {
    const name = $('#in-name').value.trim();
    if (!name) { $('#err').textContent = 'Adını girmen gerekiyor'; return; }
    state.wizard.name = name;
    state.wizard.surname = $('#in-surname').value.trim();
    go('reg-password');
  });
}

function showRegPassword() {
  formScreen({
    title: 'Yeni Şifre Oluştur',
    lead: 'Lütfen şifreni gir ve doğrula.',
    action: 'Devam Et',
    body: `<div class="field"><label>Şifre</label>${pwField('in-pw')}</div>
           <div id="pwbox"></div>
           <div class="field gap-12"><label>Şifre (tekrar)</label>${pwField('in-pw2', 'Şifreni tekrar gir')}</div>
           <div class="errline" id="err"></div>`
  });
  wireEyes(); wireStrength('in-pw', 'pwbox');
  $('#f-action').addEventListener('click', async () => {
    const p1 = $('#in-pw').value, p2 = $('#in-pw2').value, err = $('#err');
    if (p1.length < 8) { err.textContent = 'Şifre en az 8 karakter olmalı'; return; }
    if (p1 !== p2) { err.textContent = 'Şifreler eşleşmiyor'; return; }
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

const clearVToken = () => { state.devVerificationToken = null; localStorage.removeItem('musubi_dev_vtoken'); };

function showRegSuccess() {
  statusScreen({
    title: 'Hesabın Oluşturuldu',
    body: 'Devam etmeden önce e-postana gönderdiğimiz bağlantıyla hesabını doğrulaman gerekiyor.',
    primary: { label: 'Doğrulama Ekranına Git', onClick: () => reset('verify-nudge') }
  });
}

function showVerifyOk() {
  statusScreen({
    icon: I.mail, tone: 'ok', title: 'E-postan Doğrulandı',
    body: 'Harika! Artık öğrenmeye başlayabilirsin.',
    primary: { label: 'Devam Et', onClick: () => enterApp() }
  });
}

function showVerifyFail() {
  statusScreen({
    icon: I.xCircle, title: 'E-postan Doğrulanamadı',
    body: 'Bağlantının süresi dolmuş olabilir. Doğrulama e-postasını tekrar gönderelim.',
    primary: {
      label: 'Tekrar Gönder',
      onClick: async () => {
        const email = state.wizard.email || state.me?.email;
        if (!email) return toast('E-posta adresi bulunamadı, girişten devam et', 'err');
        guard(await api('POST', '/auth/resend-verification-email', { email }, { auth: false }), 'Doğrulama e-postası tekrar gönderildi');
      }
    },
    secondary: { label: 'Geri', onClick: back }
  });
}

// Doğrulanmamış hesapta backend TÜM ana uçları kapatıyor (isEmailVerified) —
// burası süslü bir banner değil, gerçek bir kapı.
//
// Doğrulama akışı WEB'DE tamamlanır (ürün kararı: deep link yok): kullanıcı
// e-postadaki linke tıklar, /verify-email/:token sayfası işi bitirir. Uygulama
// yalnızca "doğruladım" diyebilir ve /auth/me ile teyit eder. Token kutusu
// yalnızca simülatör kolaylığı — gerçek istemcide böyle bir alan olmayacak.
function showVerifyNudge() {
  paint(`<div class="pad">
      <div class="blob" style="margin:24px auto 20px">${I.mail}</div>
      <h1 class="title-xl" style="text-align:center">E-postanı Doğrula</h1>
      <p class="lead" style="text-align:center">Sana bir doğrulama bağlantısı gönderdik. Bağlantıya tıkladıktan sonra aşağıdaki butonla devam edebilirsin.</p>
      <button class="btn btn-primary" id="b-recheck">Doğruladım, Devam Et</button>
      <button class="btn btn-outline" id="b-resend">Bağlantıyı Tekrar Gönder</button>
      <div class="grouplabel">Simülatör kısayolu</div>
      <div class="input">${I.key}<input id="vtoken" placeholder="Doğrulama tokenını yapıştır" value="${esc(state.devVerificationToken || '')}"></div>
      <button class="btn btn-ghost gap-8" id="b-verify">Tokenla Doğrula</button>
      <button class="btn btn-ghost" id="b-logout">Çıkış Yap</button>
    </div>`);
  $('#b-recheck').addEventListener('click', async () => {
    const res = await api('GET', '/auth/me');
    if (res.status === 403) return toast('Hesap hâlâ doğrulanmamış görünüyor', 'err');
    if (!res.ok) return toast(res.json.message || 'Kontrol edilemedi', 'err');
    state.me = res.json.data;
    go('verify-ok');
  });
  $('#b-verify').addEventListener('click', async () => {
    const token = $('#vtoken').value.trim();
    if (!token) return toast('Token gerekli', 'err');
    const res = await api('GET', '/auth/verify-email/' + token, undefined, { auth: false });
    if (!res.ok) return go('verify-fail');
    if (res.json.data?.accessToken) setTokens(res.json.data.accessToken, res.json.data.refreshToken);
    clearVToken();
    toast('E-posta doğrulandı', 'ok');
    enterApp();
  });
  $('#b-resend').addEventListener('click', async () => {
    const email = state.wizard.email || prompt('Kayıtlı e-posta adresin:');
    if (!email) return;
    guard(await api('POST', '/auth/resend-verification-email', { email }, { auth: false }), 'Doğrulama e-postası gönderildi');
  });
  $('#b-logout').addEventListener('click', doLogout);
}

function showLogin() {
  formScreen({
    title: 'Giriş Yap',
    lead: 'Hesabına giriş yaparak kaldığın yerden devam et.',
    action: 'Giriş Yap',
    body: `<div class="field"><label>E-posta</label><div class="input">${I.mail}<input id="in-email" type="email" placeholder="ornek@ornek.com" value="${esc(state.wizard.email || '')}"></div></div>
           <div class="field"><label>Şifre</label>${pwField('in-pw', 'Şifren')}</div>
           <div class="errline" id="err"></div>
           <div class="row center gap-8"><button class="link" id="b-forgot">Şifremi Unuttum</button></div>`
  });
  wireEyes();
  $('#b-forgot').addEventListener('click', () => go('forgot-email'));
  $('#f-action').addEventListener('click', async () => {
    const email = $('#in-email').value.trim(), password = $('#in-pw').value;
    const res = await api('POST', '/auth/login', { email, password, deviceName: 'web-simülatör' }, { auth: false });
    if (!res.ok) { $('#err').textContent = res.json.message || 'Giriş başarısız'; return; }
    setTokens(res.json.accessToken, res.json.refreshToken);
    state.wizard.email = email;
    if (!res.json.isEmailVerified) return reset('verify-nudge');
    enterApp();
  });
}

function showForgotEmail() {
  formScreen({
    title: 'Şifreni mi Unuttun?',
    lead: 'E-posta adresini gir, sana bir sıfırlama bağlantısı gönderelim.',
    action: 'Sıfırlama Bağlantısı Gönder',
    body: `<div class="input">${I.mail}<input id="in-email" type="email" placeholder="ornek@ornek.com"></div><div class="errline" id="err"></div>`
  });
  $('#f-action').addEventListener('click', async () => {
    const email = $('#in-email').value.trim();
    if (!email) { $('#err').textContent = 'E-posta adresini gir'; return; }
    const res = await api('POST', '/auth/forgot-password', { email }, { auth: false });
    if (!guard(res, 'Bağlantı gönderildi (hesap varsa)')) return;
    if (res.json.resetToken) {
      state.devResetToken = res.json.resetToken;
      localStorage.setItem('musubi_dev_rtoken', res.json.resetToken);
    }
    go('forgot-newpass');
  });
}

function showForgotNewPass() {
  formScreen({
    title: 'Yeni Şifre Oluştur',
    lead: 'Lütfen şifreni gir ve doğrula.',
    action: 'Şifreyi Güncelle',
    body: `<div class="field"><label>Sıfırlama tokenı (dev)</label><div class="input">${I.key}<input id="rtoken" value="${esc(state.devResetToken || '')}"></div></div>
           <div class="field"><label>Şifre</label>${pwField('in-pw')}</div>
           <div id="pwbox"></div>
           <div class="field gap-12"><label>Şifre (tekrar)</label>${pwField('in-pw2', 'Şifreni tekrar gir')}</div>
           <div class="errline" id="err"></div>`
  });
  wireEyes(); wireStrength('in-pw', 'pwbox');
  $('#f-action').addEventListener('click', async () => {
    const token = $('#rtoken').value.trim(), p1 = $('#in-pw').value, p2 = $('#in-pw2').value, err = $('#err');
    if (!token) { err.textContent = 'Sıfırlama tokenı gerekli'; return; }
    if (p1.length < 8) { err.textContent = 'Şifre en az 8 karakter olmalı'; return; }
    if (p1 !== p2) { err.textContent = 'Şifreler eşleşmiyor'; return; }
    // deviceName BİLEREK gönderilmiyor: backend bu akışta oturum açmaz,
    // kullanıcı yeni şifresiyle tekrar giriş yapar — gerçek davranış budur.
    const res = await api('POST', '/auth/reset-password', { token, password: p1 }, { auth: false });
    if (!res.ok) { err.textContent = res.json.message || 'Şifre sıfırlanamadı'; return; }
    localStorage.removeItem('musubi_dev_rtoken'); state.devResetToken = null;
    reset('reset-success');
  });
}

function showResetSuccess() {
  statusScreen({
    title: 'Şifren Değiştirildi',
    body: 'İşlemin başarıyla tamamlandı. Yeni şifrenle giriş yapabilirsin.',
    primary: { label: 'Giriş Yap', onClick: () => reset('login') }
  });
}

async function doLogout() {
  await api('POST', '/auth/logout', { refreshToken: state.refresh });
  setTokens(null, null);
  state.me = null; state.home = null; state.promptedPlacement = false;
  closeSheet();
  reset('welcome');
}

// ═══════════════════════════════════════════════════════════════
// Önyükleme
// ═══════════════════════════════════════════════════════════════
async function boot() {
  applyPrefs();
  if (!state.access) return reset('welcome');
  const res = await api('GET', '/auth/me');
  if (res.status === 403) return reset('verify-nudge');
  if (!res.ok) { setTokens(null, null); return reset('welcome'); }
  state.me = res.json.data;
  await enterApp();
}

async function enterApp() {
  const res = await api('GET', '/auth/me');
  if (res.status === 403) return reset('verify-nudge');
  if (!res.ok) return reset('welcome');
  state.me = res.json.data;
  applyPrefs();
  renderDevBar();
  reset('home');
}

function applyPrefs() {
  const p = state.me?.preferences || {};
  const phone = $('#phone');
  phone.dataset.theme = p.theme === 'dark' ? 'dark'
    : p.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : 'light';
  phone.style.setProperty('--font-scale', p.fontSize === 'small' ? 0.93 : p.fontSize === 'large' ? 1.12 : 1);
}

// ═══════════════════════════════════════════════════════════════
// ANASAYFA
// ═══════════════════════════════════════════════════════════════
async function showHome() {
  const tk = activeToken;
  loading();
  const [sumRes, storyRes] = await Promise.all([api('GET', '/home/summary'), api('GET', '/stories')]);
  if (stale(tk)) return;
  if (sumRes.status === 403) return reset('verify-nudge');
  if (!sumRes.ok) { toast(sumRes.json.message || 'Anasayfa yüklenemedi', 'err'); return reset('welcome'); }

  const d = sumRes.json.data;
  state.home = d;
  const stories = storyRes.ok ? storyRes.json.data : [];
  const pct = d.goal > 0 ? d.today.completedWords / d.goal : 0;

  paint(`<div class="pad">
      ${pagehead(d.greeting, `Merhaba ${d.name}`, { unread: d.unreadNotifications > 0 })}

      ${stories.length ? `<div class="stories">${stories.map(s => `
        <button class="story" data-story="${esc(s.id)}">
          <span class="ring ${s.seen ? 'seen' : ''}"><img src="${esc(s.coverUrl)}" alt=""></span>
          <span class="nm">${esc(s.title)}</span>
        </button>`).join('')}</div>` : ''}

      ${d.advanceableLevel ? `<div class="unlock-card gap-16">
        <div class="kicker">${I.unlock}<span>Kilit Açıldı</span></div>
        <h3>${esc(d.advanceableLevel.jlptLevel)} • ${esc(d.advanceableLevel.label)} Seviyesi Hazır</h3>
        <p>${esc(d.activeLevel)}'i sağlam öğrendin. Hazır olduğunda yeni seviyeye geç.</p>
        <button id="b-advance">Şimdi Geç</button>
      </div>` : ''}

      <div class="card gap-16">
        <div class="today-card">
          <div class="miniring">
            ${ringSvg(pct, { size: 52, stroke: 5, second: d.goal > 0 ? d.today.emptyCount / d.goal : 0 })}
            <span class="v">%${Math.round(pct * 100)}</span>
          </div>
          <div class="txt">
            <b>Bugünün Çalışması</b>
            <span>${d.today.completedWords}/${d.goal} tamamlandı${d.today.emptyCount ? ` · ${d.today.emptyCount} ertelendi` : ''}</span>
          </div>
          <button class="btn btn-primary btn-sm" id="b-lesson">${d.today.completedWords >= d.goal ? 'Tekrar Et' : 'Devam'}</button>
        </div>
        <div class="streakline">
          <span class="flame">${I.flame}${d.streak.current} Gün</span>
          <div class="weekdots">${d.streak.week.map(w => `
            <span class="weekdot ${w.studied ? 'done' : ''} ${w.isToday ? 'today' : ''}" title="${esc(w.date)}">${w.studied ? I.check : ''}</span>`).join('')}</div>
        </div>
      </div>

      ${d.todayMistakeCount > 0 ? `<div class="mistake-card gap-16">
        <div class="hd">${I.xCircle}<b>Bugünün Hataları</b><button class="n" data-nav="mistakes">${d.todayMistakeCount} Hata</button></div>
        <div class="chips">${d.todayMistakes.map(m => `<span class="chip">${esc(m.kanji)}</span>`).join('')}</div>
        <button class="btn btn-outline" data-nav="mistakes">Detaya Git</button>
      </div>` : `<div class="card fill gap-16" style="text-align:center;padding:22px">
        <div class="row center" style="gap:8px;color:var(--ok)">${I.checkCircle}<b style="font-size:15px">Bugün hiç hata yok</b></div>
        <p class="tiny gap-8" style="margin:0">Böyle devam! Hatalı kelimelerin burada listelenir.</p>
      </div>`}

      <div class="tiny gap-24" style="text-align:center">Aktif seviyen ${esc(d.activeLevel)} • ${esc(d.activeLevelLabel)}</div>
    </div>`);

  $('#b-lesson').addEventListener('click', startLesson);
  const adv = $('#b-advance');
  if (adv) adv.addEventListener('click', () => confirmLevelSwitch(d.advanceableLevel));
  $$('[data-story]').forEach(b => b.addEventListener('click', () => openStory(stories, stories.findIndex(s => String(s.id) === b.dataset.story))));

  // "Seviyeni Öğrenelim Mi?" — oturum başına bir kez, ayrı istek gerekmiyor
  if (d.placementPrompt && !state.promptedPlacement) {
    state.promptedPlacement = true;
    placementSheet();
  }
}

function placementSheet() {
  sheet(`<div class="grab"></div>
    <div class="blob">${I.target}</div>
    <h3>Seviyeni Öğrenelim Mi?</h3>
    <p>Sana uygun içerikleri gösterebilmemiz için kısa bir sınav yapmak istiyoruz. Dilersen daha sonra Ayarlar'dan da girebilirsin.</p>
    <button class="btn btn-primary" id="sh-start">Sınava Başla</button>
    <button class="btn btn-ghost" id="sh-later">Daha Sonra</button>`);
  $('#sh-start').addEventListener('click', () => { closeSheet(); go('quiz-intro'); });
  $('#sh-later').addEventListener('click', async () => {
    closeSheet();
    // "Daha Sonra" kalıcıdır: bayrak sunucuda söner, modal bir daha çıkmaz
    await api('POST', '/quiz/placement/defer');
  });
}

async function confirmLevelSwitch(level) {
  sheet(`<div class="grab"></div>
    <div class="blob">${I.unlock}</div>
    <h3>${esc(level.jlptLevel)} • ${esc(level.label)} seviyesine geçilsin mi?</h3>
    <p>İlerlemen kaybolmaz — dilediğin an eski seviyene geri dönebilirsin. Serilerin de bozulmaz.</p>
    <button class="btn btn-primary" id="sh-yes">Evet, Geç</button>
    <button class="btn btn-ghost" id="sh-no">Vazgeç</button>`);
  $('#sh-no').addEventListener('click', closeSheet);
  $('#sh-yes').addEventListener('click', async () => {
    const res = await api('PUT', '/progress/active-level', { jlptLevel: level.jlptLevel });
    closeSheet();
    if (guard(res, `Seviyen ${level.jlptLevel} olarak güncellendi`)) showHome();
  });
}

// ─────────────────── Bugünün hataları (tam liste) ───────────────────
async function showMistakes() {
  const tk = activeToken;
  loading(topbar());
  const res = await api('GET', '/userwords/mistakes?limit=50');
  if (stale(tk)) return;
  if (!guard(res)) return back();
  const { mistakes, total } = res.json.data;
  paint(topbar() + `<div class="pad">
      <h1 class="title-xl">Bugünün Hataları</h1>
      <p class="lead">${total} kelimeyi bugün yanlış cevapladın. Yarınki tekrarda bunlar öncelikli gelecek.</p>
      ${total === 0 ? `<div class="empty">${I.checkCircle}<div>Bugün hiç hatan yok.</div></div>`
        : `<div class="wordlist">${mistakes.filter(m => m.word).map(m => wordRow(m.word, { click: true, tail: badge(m.word.jlptLevel) })).join('')}</div>`}
    </div>`);
  wireWordRows();
}

function wireWordRows() {
  $$('[data-word]').forEach(el => el.addEventListener('click', () => go('word-detail', { id: el.dataset.word })));
}

// ─────────────────── Hikâyeler ───────────────────
function openStory(stories, startIndex) {
  if (startIndex < 0) return;
  let si = startIndex, sl = 0;
  const host = document.createElement('div');
  host.className = 'storyview';
  $('.viewport').appendChild(host);

  const close = () => { host.remove(); showHome(); };

  const draw = async () => {
    const s = stories[si];
    host.innerHTML = `
      <div class="bars">${s.slides.map((_, i) => `<i><b style="width:${i < sl ? 100 : 0}%"></b></i>`).join('')}</div>
      <div class="hd"><img src="${esc(s.coverUrl)}" alt=""><b>${esc(s.title)}</b>
        <button id="sv-close">${I.close}</button></div>
      <div class="slide"><img src="${esc(s.slides[sl].url)}" alt=""></div>
      <div class="nav"><button id="sv-prev"></button><button id="sv-next"></button></div>`;
    $('#sv-close', host).addEventListener('click', close);
    $('#sv-prev', host).addEventListener('click', prev);
    $('#sv-next', host).addEventListener('click', next);
    if (sl === 0) await api('POST', `/stories/${s.id}/opened`);
  };

  // "Görüldü" YALNIZCA son slayt izlenince yazılır — yarıda bırakan
  // kullanıcının halkası yanık kalmalı (backend de bunu böyle ayırıyor).
  const next = async () => {
    const s = stories[si];
    if (sl < s.slides.length - 1) { sl++; return draw(); }
    await api('POST', `/stories/${s.id}/seen`);
    if (si < stories.length - 1) { si++; sl = 0; return draw(); }
    close();
  };
  const prev = () => {
    if (sl > 0) { sl--; return draw(); }
    if (si > 0) { si--; sl = 0; return draw(); }
  };
  draw();
}

// ═══════════════════════════════════════════════════════════════
// BİLDİRİMLER
// ═══════════════════════════════════════════════════════════════
const NOTIF_ICON = {
  daily_word: '<span class="jp">あ</span>', streak_reminder: I.flame, streak_warning: I.flame,
  daily_task: I.target, word_level_down: I.trend
};

async function showNotifications() {
  const tk = activeToken;
  loading(topbar());
  const res = await api('GET', '/notifications?limit=30');
  if (stale(tk)) return;
  if (!guard(res)) return back();
  const { notifications, unreadCount } = res.json.data;

  paint(topbar() + `<div class="pad">
      <div class="sec-row" style="margin-top:0">
        <h2>Bildirimler</h2>
        ${unreadCount > 0 ? `<button class="more" id="b-readall">Tümünü Okundu Yap</button>` : ''}
      </div>
      ${notifications.length === 0 ? `<div class="empty">${I.bell}<div>Henüz bildirim yok.</div></div>`
        : notifications.map(n => `
        <div class="notif ${n.read ? 'read' : ''}" data-id="${n._id}">
          <span class="ic">${NOTIF_ICON[n.type] || I.bell}</span>
          <span class="bd"><b>${esc(n.title)}</b><p>${esc(n.body)}</p>
            <time>${new Date(n.createdAt).toLocaleString('tr', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</time></span>
        </div>`).join('')}
    </div>`);

  const all = $('#b-readall');
  if (all) all.addEventListener('click', async () => { await api('PUT', '/notifications/read-all'); showNotifications(); });
  $$('.notif').forEach(el => el.addEventListener('click', async () => {
    if (el.classList.contains('read')) return;
    await api('PUT', `/notifications/${el.dataset.id}/read`);
    showNotifications();
  }));
}

// ═══════════════════════════════════════════════════════════════
// DERS — yazma sorusu, puanlamayı BACKEND yapar
// ═══════════════════════════════════════════════════════════════
async function startLesson() {
  // Dersin seviyesi SUNUCUDAN gelir (User.activeLevel). /userwords/today
  // artık jlptLevel parametresi ALMIYOR; seviye iki yerde saklanınca
  // aynı gün için ikinci bir havuz açılıyordu.
  const level = state.home?.activeLevel || state.me?.activeLevel || 'N5';
  state.lesson = { level, queue: [], idx: 0, streak: 0, phase: 'loading', done: 0, total: 0, pending: 0 };
  go('lesson');
  const tk = activeToken;
  await api('POST', '/sessions/start', { jlptLevel: level });
  const res = await api('GET', '/userwords/today');
  if (stale(tk)) return;
  if (!guard(res)) return back();
  applyTodayPayload(res.json.data);
  state.lesson.phase = state.lesson.queue.length ? 'question' : 'empty';
  renderLesson();
}

function applyTodayPayload(d) {
  const L = state.lesson;
  const queue = [];
  d.reviewWords.forEach(uw => { if (!uw.answeredToday && uw.word) queue.push({ id: uw.word._id, word: uw.word, review: true }); });
  d.newWords.forEach(w => { if (!w.answeredToday) queue.push({ id: w._id, word: w, review: false }); });
  L.queue = queue; L.idx = 0;
  // Sayaçlar HER ZAMAN backend'den okunur, istemcide toplanmaz — Anasayfa ile
  // aynı kaynak. Yerel toplama, "gir-çık'ta oran sıçrıyor" bug sınıfının kökü.
  L.done = d.today.completedWords;
  L.total = d.goal;
  L.pending = d.today.emptyCount;
}

function renderLesson() {
  const L = state.lesson;
  if (L.phase === 'loading') return loading();
  if (L.phase === 'empty') return statusScreen({
    tone: 'ok', title: 'Bugün İçin Kelime Kalmadı',
    body: `Bugünkü ${L.total} kelimenin tamamını cevapladın. Yarın yeni kelimeler seni bekliyor.`,
    primary: { label: 'Ana Sayfaya Dön', onClick: () => reset('home') }
  });
  if (L.phase === 'streak') return renderStreakSplash();
  // Sonuç verisi henüz gelmediyse (geri/ileri ile bu ekrana dönüldü) bekle —
  // finishLesson tamamlanınca kendisi çiziyor
  if (L.phase === 'result') return L.result ? renderLessonResult() : loading();
  if (L.phase === 'streakday') return renderStreakDay();
  renderQuestion();
}

function lessonHead() {
  const L = state.lesson;
  const total = L.total || 1;
  const donePct = Math.min(100, (L.done / total) * 100);
  const pendPct = Math.min(100 - donePct, (L.pending / total) * 100);
  return `<div class="topbar"><button id="b-exit">${I.chevL}<span>Ders</span></button></div>
    <div style="padding:0 20px">
      <div class="lesson-bar">
        <i style="width:${donePct}%">${L.done}</i>
        ${pendPct > 0 ? `<i class="pending" style="width:${pendPct}%"></i>` : ''}
        <span class="total">${L.total}</span>
      </div>
      <p class="lesson-pct">%${Math.round((L.done / total) * 100)} Tamamlandı</p>
    </div>`;
}

function wireExit() {
  $('#b-exit').addEventListener('click', () => {
    sheet(`<div class="grab"></div>
      <div class="blob">${I.pause}</div>
      <h3>Çıkmak istediğine emin misin?</h3>
      <p>Cevapladığın kelimeler kaydedildi — kaldığın yerden istediğin zaman devam edebilirsin.</p>
      <button class="btn btn-primary" id="sh-stay">Derse Devam Et</button>
      <button class="btn btn-ghost" id="sh-leave">Çık</button>`);
    $('#sh-stay').addEventListener('click', closeSheet);
    $('#sh-leave').addEventListener('click', () => { closeSheet(); reset('home'); });
  });
}

function renderQuestion() {
  const L = state.lesson;
  L.busy = false;
  const w = L.queue[L.idx].word;
  paint(lessonHead() + `
    <div class="pad">
      <div class="qhead">${badge(w.jlptLevel)}<span class="instr">Bu kelimenin Türkçesini yazınız.</span></div>
      <div class="wordcard">
        <div class="type">${esc(w.type || '')}</div>
        <div class="kanji">${esc(w.kanji)}</div>
        <div class="kana">${esc(w.kana || w.romaji || '')}</div>
      </div>
      ${audioRow(w.audioUrl)}
      <div class="gap-24">${exampleBlock(w)}</div>
    </div>
    <div class="footer hairline">
      <div class="row center" style="margin-bottom:10px"><button class="link gold" id="b-skip">Şimdilik Geç</button></div>
      <form id="f-answer"><div class="answerbox">${I.pencil}
        <input id="in-answer" placeholder="Cevabını yaz..." autocomplete="off" autofocus></div></form>
    </div>`);
  wireAudio(); wireExit();
  $('#f-answer').addEventListener('submit', (e) => { e.preventDefault(); submitAnswer({ answer: $('#in-answer').value }); });
  $('#b-skip').addEventListener('click', () => submitAnswer({ result: 'empty' }));
  $('#in-answer').focus();
}

async function submitAnswer(payload) {
  const L = state.lesson;
  if (L.busy) return;
  L.busy = true;
  const input = $('#in-answer'), skip = $('#b-skip');
  if (input) input.disabled = true;
  if (skip) skip.disabled = true;

  const tk = activeToken;
  const item = L.queue[L.idx];
  const res = await api('POST', '/userwords/answer', { wordId: item.id, ...payload });
  if (stale(tk)) return;
  L.busy = false;
  if (!guard(res)) {
    if (input) { input.disabled = false; input.focus(); }
    if (skip) skip.disabled = false;
    return;
  }

  const d = res.json.data;
  L.done = d.today.completedWords;
  L.total = d.goal;
  L.pending = d.today.emptyCount;
  L.streak = (d.result === 'correct' || d.result === 'easy') ? L.streak + 1 : 0;

  const tone = d.result === 'wrong' ? 'bad' : d.result === 'empty' ? 'warn' : 'good';
  const icon = d.result === 'wrong' ? I.xCircle : d.result === 'empty' ? I.qCircle : I.checkCircle;
  const head = d.result === 'wrong' ? 'Yanlış Cevap!' : d.result === 'empty' ? 'Cevap:' : 'Doğru!';
  const btn = d.result === 'wrong' ? 'btn-primary' : d.result === 'empty' ? 'btn-warn' : 'btn-ok';

  // Soru kartı yerinde kalır, yalnızca alt bant (cevap kutusu → geri bildirim)
  // değişir: kullanıcı cevabını verdiği kelimeyi görmeye devam etsin diye
  paint(lessonHead() + `
    <div class="pad">
      <div class="qhead">${badge(item.word.jlptLevel)}<span class="instr">Bu kelimenin Türkçesini yazınız.</span></div>
      <div class="wordcard">
        <div class="type">${esc(item.word.type || '')}</div>
        <div class="kanji">${esc(item.word.kanji)}</div>
        <div class="kana">${esc(item.word.kana || item.word.romaji || '')}</div>
      </div>
      ${audioRow(item.word.audioUrl)}
      <div class="gap-24">${exampleBlock(item.word)}</div>
    </div>
    <div class="footer" style="padding:0">
      <div class="feedback ${tone}">
        <div class="hd">${icon}<b>${head}</b></div>
        <div class="ans"><span class="jp">${esc(item.word.kanji)}</span> — ${esc(d.correctAnswer || item.word.meaningTr || item.word.meaning)}</div>
        <button class="btn ${btn}" id="b-next">Devam Et</button>
      </div>
    </div>`);
  wireAudio(); wireExit();
  $('#b-next').addEventListener('click', advance);
}

function advance() {
  const L = state.lesson;
  if (L.streak > 0 && L.streak % 5 === 0) { L.phase = 'streak'; return renderLesson(); }
  nextWord();
}

function nextWord() {
  const L = state.lesson;
  L.phase = 'question';
  L.idx++;
  if (L.idx >= L.queue.length) return refreshQueueOrFinish();
  renderQuestion();
}

// Yerel kuyruk bitince körlemesine "bitti" denmez: "Şimdilik Geç" ile
// ertelenmiş kelimeler gün içinde yeniden sorulmalıdır (backend bunları
// answeredToday:false tutar ve ertelenmişken /sessions/complete 409 döner).
async function refreshQueueOrFinish() {
  const tk = activeToken;
  loading();
  const res = await api('GET', '/userwords/today');
  if (stale(tk)) return;
  if (!guard(res)) return reset('home');
  applyTodayPayload(res.json.data);
  if (state.lesson.queue.length > 0) return renderQuestion();
  state.lesson.phase = 'result';
  finishLesson();
}

function renderStreakSplash() {
  const L = state.lesson;
  paint(`<div class="center-scr">
      <div class="blob">${I.flame}</div>
      <h2>${L.streak} Kere Üstüste!</h2>
      <p>Harika gidiyorsun. Böyle devam et!</p>
      <button class="btn btn-primary" id="b-go" style="max-width:260px">Devam Et</button>
    </div>`);
  $('#b-go').addEventListener('click', nextWord);
}

async function finishLesson() {
  const tk = activeToken;
  loading();
  const res = await api('PUT', '/sessions/complete');
  if (stale(tk)) return;
  if (res.status === 409) { toast(res.json.message, 'err'); return refreshQueueOrFinish(); }
  if (!guard(res)) return reset('home');
  const sum = await api('GET', '/home/summary');
  if (stale(tk)) return;
  state.lesson.result = { ...res.json.data, summary: sum.ok ? sum.json.data : null };
  renderLessonResult();
}

function renderLessonResult() {
  const r = state.lesson.result;
  const s = r.summary;
  const mins = Math.floor((r.duration || 0));
  paint(`<div class="center-scr">
      <div class="bigring">${ringSvg(1, { size: 168, stroke: 13 })}
        <span class="v"><b>${r.totalWords}/${r.totalWords}</b><span>Tamamlandı</span></span></div>
      <h2>Tebrikler! 🎉</h2>
      <p>Dersi başarıyla bitirdin! Bugünkü dersin analizine anasayfadan ulaşabilirsin.</p>
      <div class="tiles">
        <div class="tile"><div class="ic">${I.target}</div><div class="v">%${r.accuracy ?? 0}</div><div class="k">Doğruluk</div></div>
        <div class="tile"><div class="ic">${I.target}</div><div class="v">${mins} dk</div><div class="k">Süre</div></div>
        <div class="tile"><div class="ic"><span class="jp">結</span></div><div class="v">+${r.correctCount ?? 0}</div><div class="k">Doğru</div></div>
      </div>
      <button class="btn btn-primary gap-24" id="b-next" style="max-width:300px">Devam Et</button>
    </div>`);
  $('#b-next').addEventListener('click', () => {
    if (s?.streak?.current > 0) { state.lesson.phase = 'streakday'; return renderLesson(); }
    reset('home');
  });
}

function renderStreakDay() {
  const s = state.lesson.result.summary;
  const dayNames = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  paint(`<div class="center-scr">
      <div class="blob">${I.flame}<span class="count">${s.streak.current}</span></div>
      <h2 style="margin-top:14px">${s.streak.current} Günlük Seridesin!</h2>
      <p>Derslerine her gün devam et.</p>
      <div class="weekstrip">${s.streak.week.map((w, i) => `
        <div class="d"><span>${dayNames[i]}</span>
          <span class="weekdot ${w.studied ? 'done' : ''} ${w.isToday ? 'today' : ''}" style="margin:0 auto">${w.studied ? I.check : (w.isToday ? I.flame : '')}</span>
        </div>`).join('')}</div>
      <button class="btn btn-primary gap-24" id="b-home" style="max-width:300px">Ana Sayfaya Dön</button>
    </div>`);
  $('#b-home').addEventListener('click', () => reset('home'));
}

// ═══════════════════════════════════════════════════════════════
// SEVİYE TESPİT SINAVI — 40 soruluk TEK sınav (merdiven kaldırıldı)
// ═══════════════════════════════════════════════════════════════
async function showQuizIntro() {
  const tk = activeToken;
  loading(topbar());
  const res = await api('GET', '/quiz/status');
  if (stale(tk)) return;
  if (!guard(res)) return back();
  const d = res.json.data;
  const cooldown = d.nextAttemptAllowedAt ? new Date(d.nextAttemptAllowedAt) : null;

  paint(topbar() + `<div class="pad">
      <h1 class="title-xl">Seviye Tespit Sınavı</h1>
      <div class="card soft gap-8" style="display:flex;gap:10px;align-items:flex-start">
        ${I.info}
        <p style="margin:0;font-size:13.5px;line-height:1.55;color:var(--brand)">Seviye tespit sınavı toplam ${d.totalQuestions} sorudan oluşmaktadır. Her soru için ${d.secondsPerQuestion} saniyeniz vardır.</p>
      </div>
      <div class="group gap-16">
        ${d.distribution.map(x => `<div class="row-item" style="cursor:default">
          ${badge(x.jlptLevel)}
          <span class="lbl"><b style="font-weight:700">${esc(x.jlptLevel)} • ${esc(x.label)}</b>
            <span style="display:block;font-size:13px;color:var(--brand);font-weight:650;margin-top:2px">${x.questionCount} Soru</span></span>
        </div>`).join('')}
      </div>
      ${cooldown && !d.placementAvailable ? `<p class="tiny gap-16" style="text-align:center">Yeniden girebileceğin tarih: <b>${cooldown.toLocaleDateString('tr', { day: 'numeric', month: 'long', year: 'numeric' })}</b></p>` : ''}
    </div>
    <div class="footer"><button class="btn btn-primary" id="b-start" ${d.placementAvailable ? '' : 'disabled'}>${d.inProgressQuizId ? 'Sınava Devam Et' : 'Başla'}</button></div>`);
  $('#b-start').addEventListener('click', beginQuiz);
}

async function beginQuiz() {
  const res = await api('POST', '/quiz/start', { type: 'placement' });
  if (!res.ok) {
    const when = res.json.nextAttemptAllowedAt ? ' · ' + new Date(res.json.nextAttemptAllowedAt).toLocaleDateString('tr') : '';
    return toast((res.json.message || 'Sınav başlatılamadı') + when, 'err');
  }
  const d = res.json.data;
  // Yarım kalan sınav aynı id ile döner (answeredCount ile nerede kalındığı belli)
  state.quiz = {
    id: d.quizId, questions: d.questions, total: d.totalQuestions,
    idx: Math.max(0, d.questions.findIndex(q => !q.answered)),
    perQuestion: d.secondsPerQuestion
  };
  if (state.quiz.idx < 0) state.quiz.idx = 0;
  reset('quiz-question');
}

const QUIZ_INSTR = {
  meaning: 'Bu kelimenin Türkçesini seçiniz.', reverse: 'Anlama uyan kelimeyi seçiniz.',
  reading: 'Kelimenin okunuşunu seçiniz.', typing: 'Bu kelimenin Türkçesini yazınız.',
  fillblank: 'Boşluğa uygun kelimeyi yerleştir.', image: 'Doğru şıkkı işaretleyiniz.'
};

function showQuizQuestion() {
  const Q = state.quiz;
  const q = Q.questions[Q.idx];
  const pct = (Q.idx / Q.total) * 100;

  const prompt =
    q.format === 'reverse' ? `<div class="wordcard"><div class="kanji" style="font-size:26px;font-family:inherit;font-weight:750">${esc(q.prompt.meaning)}</div></div>`
    : q.format === 'fillblank' ? `<div class="wordcard"><div class="kanji" style="font-size:28px">${esc(q.prompt.sentence)}</div></div>`
    : q.format === 'image' ? `<img class="qimage" src="${esc(q.prompt.imageUrl)}" alt="soru görseli">`
    : `<div class="wordcard">
         <div class="kanji">${esc(q.prompt.kanji)}</div>
         ${q.prompt.romaji ? `<div class="kana">${esc(q.prompt.romaji)}</div>` : ''}
       </div>`;

  const answer = q.format === 'typing'
    ? `<form id="f-typing"><div class="answerbox">${I.pencil}<input id="in-typing" placeholder="Cevabını yaz..." autocomplete="off"></div></form>`
    : `<div class="choices">${q.choices.map((c, i) => `<button class="choicebtn" data-choice="${i}">${'ABCD'[i]}) <span class="jp">${esc(c)}</span></button>`).join('')}</div>`;

  paint(`<div class="topbar"><button id="b-exit-quiz">${I.chevL}<span>Sınav</span></button>
      <span style="margin-left:auto;padding-right:10px;font-size:13.5px;color:var(--muted);font-variant-numeric:tabular-nums">${Q.idx + 1} / ${Q.total}</span></div>
    <div style="padding:0 20px"><div class="lesson-bar"><i style="width:${pct}%"></i></div></div>
    <div class="pad" style="padding-top:14px">
      <div class="qhead" style="margin-top:6px">${badge(q.jlptLevel)}<span class="instr">${QUIZ_INSTR[q.format] || ''}</span></div>
      ${prompt}
      ${q.prompt?.audioUrl ? audioRow(q.prompt.audioUrl) : ''}
      <div class="gap-24">${answer}</div>
      <div class="row center gap-16"><button class="link gold" data-skip>Şimdilik Geç</button></div>
    </div>
    <div id="q-foot"></div>`);
  wireAudio();
  $('#b-exit-quiz').addEventListener('click', exitQuiz);
  $$('[data-choice]').forEach(b => b.addEventListener('click', () => answerQuiz(Number(b.dataset.choice))));
  $$('[data-skip]').forEach(b => b.addEventListener('click', () => answerQuiz(null)));
  const ft = $('#f-typing');
  if (ft) { ft.addEventListener('submit', (e) => { e.preventDefault(); answerQuiz($('#in-typing').value); }); $('#in-typing').focus(); }
}

function exitQuiz() {
  sheet(`<div class="grab"></div>
    <div class="blob">${I.pause}</div>
    <h3>Sınavdan çıkmak istiyor musun?</h3>
    <p>Cevapların saklanır; 30 dakika içinde geri dönersen kaldığın yerden devam edersin.</p>
    <button class="btn btn-primary" id="sh-stay">Sınava Devam Et</button>
    <button class="btn btn-ghost" id="sh-leave">Çık</button>`);
  $('#sh-stay').addEventListener('click', closeSheet);
  $('#sh-leave').addEventListener('click', () => { closeSheet(); reset('home'); });
}

async function answerQuiz(answer) {
  const tk = activeToken;
  const Q = state.quiz;
  $$('[data-choice], [data-skip]').forEach(b => b.disabled = true);
  const res = await api('POST', `/quiz/${Q.id}/answer`, { index: Q.questions[Q.idx].index, answer });
  if (stale(tk)) return;
  if (!guard(res)) { $$('[data-choice], [data-skip]').forEach(b => b.disabled = false); return; }
  const d = res.json.data;

  if (d.correctIndex !== undefined && d.correctIndex !== null) {
    const ok = $(`[data-choice="${d.correctIndex}"]`); if (ok) ok.classList.add('correct');
    if (!d.correct && typeof answer === 'number') { const bad = $(`[data-choice="${answer}"]`); if (bad) bad.classList.add('wrong'); }
  }
  const shown = d.correctAnswer ?? (d.correctIndex !== undefined ? Q.questions[Q.idx].choices?.[d.correctIndex] : '');
  $('#q-foot').innerHTML = `<div class="footer" style="padding:0">
      <div class="feedback ${d.correct ? 'good' : 'bad'}">
        <div class="hd">${d.correct ? I.checkCircle : I.xCircle}<b>${d.correct ? 'Doğru!' : 'Yanlış Cevap!'}</b></div>
        <div class="ans"><span class="jp">${esc(d.word?.kanji || '')}</span> — ${esc(shown || d.word?.meaning || '')}</div>
        <button class="btn ${d.correct ? 'btn-ok' : 'btn-primary'}" id="b-qnext">${d.finished ? 'Sonucu Gör' : 'Devam Et'}</button>
      </div></div>`;
  $('#b-qnext').addEventListener('click', () => {
    if (d.finished) { state.quiz.result = d.result; return reset('quiz-result'); }
    state.quiz.idx++;
    showQuizQuestion();
  });
}

function showQuizResult() {
  const r = state.quiz.result;
  const mm = Math.floor((r.durationSeconds || 0) / 60), ss = String((r.durationSeconds || 0) % 60).padStart(2, '0');
  const correctPct = r.totalQuestions ? (r.correctCount / r.totalQuestions) * 100 : 0;
  paint(`<div class="center-scr">
      <p class="tiny" style="margin-bottom:14px">Sınav Tamamlandı</p>
      <div class="badge lg">${esc(r.determinedLevel)}</div>
      <h2 style="margin-top:20px">Seviyen Belirlendi</h2>
      <p>${esc(r.levelDescription || '')}</p>
      <div class="card fill" style="width:100%;text-align:left">
        <div class="row between" style="margin-bottom:9px">
          <span style="font-size:14.5px;font-weight:650">${r.totalQuestions} Soru</span>
          <span class="tiny" style="font-variant-numeric:tabular-nums">${mm}:${ss}</span>
        </div>
        <div style="display:flex;height:9px;border-radius:999px;overflow:hidden;gap:2px">
          <i style="width:${correctPct}%;background:var(--ok)"></i>
          <i style="flex:1;background:var(--brand)"></i>
        </div>
        <div class="row gap-12" style="gap:18px;margin-top:11px">
          <span class="row" style="gap:7px;font-size:13px;color:var(--ok)"><b style="width:9px;height:9px;border-radius:50%;background:var(--ok)"></b>${r.correctCount} Doğru</span>
          <span class="row" style="gap:7px;font-size:13px;color:var(--brand)"><b style="width:9px;height:9px;border-radius:50%;background:var(--brand)"></b>${r.wrongCount} Yanlış</span>
        </div>
      </div>
      ${r.unlockedLevels?.length ? `<p class="tiny gap-16">🔓 Bu sınavla açılan seviyeler: <b>${r.unlockedLevels.join(', ')}</b></p>` : ''}
    </div>
    <div class="footer"><button class="btn btn-primary" id="b-home">Ana Sayfaya Dön</button></div>`);
  // Sınav bitince activeLevel sunucu tarafından taşınır — anasayfa tazelenmeli
  $('#b-home').addEventListener('click', () => enterApp());
}

// ═══════════════════════════════════════════════════════════════
// KÜTÜPHANE
// ═══════════════════════════════════════════════════════════════
function showLibrary() {
  const L = state.library;
  paint(`<div class="pad">
      ${pagehead('図書館', 'Kütüphane', { unread: state.home?.unreadNotifications > 0 })}
      <div class="searchbar">${I.search}<input id="lib-q" placeholder="Bir kelime ara..." value="${esc(L.q)}"></div>
      <div class="filters">
        <button class="filterchip ${L.level === '' ? 'on' : ''}" data-level="">Tümü</button>
        ${JLPT.map(l => `<button class="filterchip ${L.level === l ? 'on' : ''}" data-level="${l}">${l}</button>`).join('')}
      </div>
      <div id="lib-list"><div class="loading" style="padding:40px 0"><div class="spinner"></div></div></div>
      <div class="pager" id="lib-pager" hidden>
        <button class="btn btn-outline btn-sm" id="lib-prev">${I.chevL}</button>
        <span class="pg" id="lib-page"></span>
        <button class="btn btn-outline btn-sm" id="lib-next">${I.chevR}</button>
      </div>
    </div>`);
  $('#lib-q').addEventListener('input', debounce(() => { L.q = $('#lib-q').value.trim(); loadLibrary(1); }, 320));
  $$('.filterchip').forEach(c => c.addEventListener('click', () => {
    $$('.filterchip').forEach(x => x.classList.toggle('on', x === c));
    L.level = c.dataset.level;
    loadLibrary(1);
  }));
  loadLibrary(1);
}

async function loadLibrary(page) {
  const tk = activeToken;
  const L = state.library;
  // Arama ve listeleme AYNI uçtan: /words?q= sayfalıdır, eski /words/search
  // sabit 20 sonuç döndürüp sessizce eksik liste gösteriyordu.
  const qs = `page=${page}&limit=15${L.level ? '&jlptLevel=' + L.level : ''}${L.q ? '&q=' + encodeURIComponent(L.q) : ''}`;
  const res = await api('GET', '/words?' + qs);
  if (stale(tk)) return;
  const box = $('#lib-list');
  if (!box) return;
  if (!res.ok) { box.innerHTML = `<div class="empty">${I.search}<div>Liste yüklenemedi.</div></div>`; return; }
  const { words, total, totalPages } = res.json.data;
  L.page = page; L.totalPages = totalPages;
  if (total === 0) {
    box.innerHTML = `<div class="empty">${I.search}<div>${L.q ? 'Aramanla eşleşen kelime yok.' : 'Kelime bulunamadı — <code>npm run seed</code> çalıştırıldı mı?'}</div></div>`;
    $('#lib-pager').hidden = true;
    return;
  }
  box.innerHTML = `<div class="wordlist">${words.map(w => wordRow(w, { click: true, tail: badge(w.jlptLevel) })).join('')}</div>`;
  wireWordRows();
  $('#lib-pager').hidden = totalPages <= 1;
  $('#lib-page').textContent = `${page} / ${totalPages}`;
  $('#lib-prev').disabled = page <= 1;
  $('#lib-next').disabled = page >= totalPages;
  $('#lib-prev').onclick = () => loadLibrary(L.page - 1);
  $('#lib-next').onclick = () => loadLibrary(L.page + 1);
}

async function showWordDetail({ id }) {
  const tk = activeToken;
  loading(topbar());
  const res = await api('GET', '/words/' + id);
  if (stale(tk)) return;
  if (!guard(res)) return back();
  const w = res.json.data;
  paint(topbar() + `<div class="pad">
      <div class="row gap-8" style="margin-bottom:16px">${badge(w.jlptLevel)}<span style="font-size:16px;font-weight:650">Kelime</span></div>
      <div class="wordcard">
        <div class="type">${esc(w.type || '')}</div>
        <div class="kanji">${esc(w.kanji)}</div>
        <div class="kana">${esc(w.kana || w.romaji || '')}</div>
      </div>
      ${audioRow(w.audioUrl)}
      <div class="slabel gap-24">Anlamı</div>
      <div class="card fill gap-8" style="font-size:17px;font-weight:650">${esc(w.meaningTr || w.meaning)}</div>
      ${w.meaningTr && w.meaning && w.meaningTr !== w.meaning ? `<p class="tiny gap-8">İngilizce: ${esc(w.meaning)}</p>` : ''}
      <div class="gap-24">${exampleBlock(w) || `<div class="empty">${I.bookOpen}<div>Örnek cümle henüz eklenmemiş.</div></div>`}</div>
    </div>`);
  wireAudio();
}

// ═══════════════════════════════════════════════════════════════
// HAFIZA
// ═══════════════════════════════════════════════════════════════
async function showMemory() {
  const tk = activeToken;
  loading();
  const res = await api('GET', '/memory');
  if (stale(tk)) return;
  if (!guard(res)) return;
  const d = res.json.data;
  state.memory = d;
  const box = state.memoryBox && d.boxes.some(b => b.key === state.memoryBox) ? state.memoryBox : d.defaultBox;
  state.memoryBox = box;

  paint(`<div class="pad">
      ${pagehead('メモリ', 'Hafıza', { unread: state.home?.unreadNotifications > 0 })}

      <div class="levelcard">
        <div class="top">
          ${badge(d.jlptLevel)}
          <span class="now"><span>Şu an</span><b>${esc(d.label)} Seviyesi</b></span>
          ${d.nextLevel ? `<span class="next"><span>Sonraki</span><b>${esc(d.nextLevel.jlptLevel)} • ${esc(d.nextLevel.label)}</b></span>` : ''}
        </div>
        ${d.nextLevel ? `
          <div class="split"></div>
          <div class="goal">
            <span class="t">${d.nextLevel.isUnlocked
              ? `${esc(d.nextLevel.jlptLevel)} kilidi açıldı`
              : `${esc(d.nextLevel.jlptLevel)}'e geçmene <em>%${d.remainingPercent}</em> kaldı`}</span>
            <span class="f">%${d.completionRate} / %${d.completionThreshold}</span>
          </div>
          <div class="meter">
            <i style="width:${Math.min(100, d.completionRate)}%"></i>
            <span class="notch" style="left:${d.completionThreshold}%"></span>
          </div>
          ${d.unlockHint ? `<p class="hint">${esc(d.unlockHint)}</p>` : ''}` : `
          <div class="split"></div>
          <p class="hint" style="margin:0">En üst seviyedesin — bundan sonrası tekrar ve pekiştirme.</p>`}
      </div>

      <div class="sec-row">
        <h2>Hafıza</h2>
        ${d.weeklyImproved !== null && d.weeklyImproved !== undefined
          ? `<span class="trendchip">${I.trend}Bu hafta +${d.weeklyImproved} kelime iyiye geçti</span>` : ''}
      </div>

      <div class="boxbar">${d.boxes.filter(b => b.count > 0).map(b =>
        `<i style="flex:${b.count};background:${BOX_COLOR[b.key]}"></i>`).join('')}</div>

      <div class="boxes">${d.boxes.map(b => `
        <button class="boxbtn ${b.key === box ? 'on' : ''}" data-box="${b.key}">
          <span class="dot" style="background:${BOX_COLOR[b.key]}"></span>
          <span class="n">${b.count}</span>
          <span class="l">${esc(b.label)}</span>
        </button>`).join('')}</div>

      <div class="sec-row">
        <h2 id="box-title"></h2>
        <button class="more" id="b-seeall">Tümünü Gör</button>
      </div>
      <div id="box-list"><div class="loading" style="padding:30px 0"><div class="spinner"></div></div></div>
      <p class="tiny gap-16" style="text-align:center">${esc(d.jlptLevel)} seviyesinde toplam ${d.totalWords} kelime · %${d.completionRate}'i Orta ve üzeri</p>
    </div>`);

  $$('[data-box]').forEach(b => b.addEventListener('click', () => {
    state.memoryBox = b.dataset.box;
    $$('[data-box]').forEach(x => x.classList.toggle('on', x === b));
    loadBoxPreview(b.dataset.box);
  }));
  $('#b-seeall').addEventListener('click', () => go('memory-box', { box: state.memoryBox }));
  loadBoxPreview(box);
}

async function loadBoxPreview(box) {
  const tk = activeToken;
  const label = state.memory.boxes.find(b => b.key === box)?.label || '';
  const t = $('#box-title'); if (t) t.textContent = `${label} Kutusundakiler`;
  const res = await api('GET', `/memory/words?box=${box}&limit=5`);
  if (stale(tk)) return;
  const host = $('#box-list');
  if (!host) return;
  if (!res.ok) { host.innerHTML = `<div class="empty">${I.brain}<div>Liste yüklenemedi.</div></div>`; return; }
  const { items, total } = res.json.data;
  host.innerHTML = total === 0
    ? `<div class="empty">${I.brain}<div>Bu kutuda kelime yok.</div></div>`
    : `<div class="wordlist">${items.map(i => wordRow(i.word, { click: true })).join('')}</div>`;
  wireWordRows();
}

async function showMemoryBox({ box }) {
  const tk = activeToken;
  loading(topbar());
  const res = await api('GET', `/memory/words?box=${box}&limit=50`);
  if (stale(tk)) return;
  if (!guard(res)) return back();
  const d = res.json.data;
  paint(topbar() + `<div class="pad">
      <div class="row gap-8" style="margin-bottom:6px">
        <span class="dot" style="width:11px;height:11px;border-radius:50%;background:${BOX_COLOR[d.box]}"></span>
        <span class="tiny">${esc(d.jlptLevel)} · ${d.total} kelime</span>
      </div>
      <h1 class="title-xl">${esc(d.label)} Kutusundakiler</h1>
      <p class="lead">${d.box === 'new'
        ? 'Henüz hiç çalışmadığın kelimeler. Sıra, günlük dersinde geleceği sırayla aynı.'
        : 'Vadesi en yakın olan kelime en üstte — yarınki tekrarında ilk bunu göreceksin.'}</p>
      ${d.items.length === 0 ? `<div class="empty">${I.brain}<div>Bu kutuda kelime yok.</div></div>`
        : `<div class="wordlist">${d.items.map(i => wordRow(i.word, {
            click: true,
            tail: i.masteryLevel ? `<span class="tag plain">${i.masteryLevel}. sv</span>` : badge(i.word.jlptLevel)
          })).join('')}</div>`}
      ${d.totalPages > 1 ? `<p class="tiny gap-16" style="text-align:center">İlk ${d.items.length} kelime gösteriliyor (toplam ${d.total}).</p>` : ''}
    </div>`);
  wireWordRows();
}

// ═══════════════════════════════════════════════════════════════
// AYARLAR
// ═══════════════════════════════════════════════════════════════
const THEME_LABEL = { light: 'Açık', dark: 'Koyu', system: 'Sistem' };
const FONT_LABEL = { small: 'Küçük', medium: 'Orta', large: 'Büyük' };

function showSettings() {
  const me = state.me || {};
  const p = me.preferences || {};
  paint(`<div class="pad">
      ${pagehead('設定', 'Ayarlar', { unread: state.home?.unreadNotifications > 0 })}

      <div class="grouplabel" style="margin-top:6px">Hesap</div>
      <div class="group">
        <button class="row-item" data-nav="settings-password"><span class="ic">${I.key}</span><span class="lbl">Şifreyi Değiştir</span><span class="chev">${I.chevR}</span></button>
        <button class="row-item" data-nav="settings-notifications"><span class="ic">${I.bellRing}</span><span class="lbl">Bildirim Ayarları</span><span class="chev">${I.chevR}</span></button>
      </div>

      <div class="grouplabel">Uygulama</div>
      <div class="group">
        <button class="row-item" id="st-lang"><span class="ic">${I.translate}</span><span class="lbl">Dil Ayarları</span><span class="val">Türkçe</span><span class="chev">${I.chevR}</span></button>
        <button class="row-item" id="st-theme"><span class="ic">${I.palette}</span><span class="lbl">Tema Değiştir</span><span class="val">${THEME_LABEL[p.theme] || 'Açık'}</span><span class="chev">${I.chevR}</span></button>
        <button class="row-item" data-nav="settings-level"><span class="ic">${I.levels}</span><span class="lbl">Öğrenme Seviyeni Değiştir</span><span class="val accent">${esc(me.activeLevel || 'N5')}</span><span class="chev">${I.chevR}</span></button>
        <button class="row-item" data-nav="quiz-intro"><span class="ic">${I.bookOpen}</span><span class="lbl">Seviye Tespit Sınavına Gir</span><span class="chev">${I.chevR}</span></button>
        <button class="row-item" id="st-font"><span class="ic">${I.typeface}</span><span class="lbl">Kanji Font Boyutu</span><span class="val">${FONT_LABEL[p.fontSize] || 'Orta'}</span><span class="chev">${I.chevR}</span></button>
        <button class="row-item" data-nav="settings-goal"><span class="ic">${I.target}</span><span class="lbl">Günlük Kelime Hedefi</span><span class="val accent">${me.dailyGoal ?? 20} Kelime</span><span class="chev">${I.chevR}</span></button>
      </div>

      <div class="grouplabel">Diğer</div>
      <div class="group">
        <button class="row-item" data-nav="settings-legal"><span class="ic">${I.doc}</span><span class="lbl">Hakkında</span><span class="chev">${I.chevR}</span></button>
        <button class="row-item danger" id="st-logout"><span class="ic">${I.logout}</span><span class="lbl">Çıkış Yap</span><span class="chev">${I.chevR}</span></button>
        <button class="row-item danger" data-nav="settings-delete"><span class="ic">${I.trash}</span><span class="lbl">Hesabı Sil</span><span class="chev">${I.chevR}</span></button>
      </div>

      <p class="tiny gap-24" style="text-align:center">Musubi · Sürüm 1.0.0<br>${esc(me.email || '')}</p>
    </div>`);

  $('#st-lang').addEventListener('click', () => toast('Şu an yalnızca Türkçe destekleniyor', ''));
  $('#st-theme').addEventListener('click', () => pickPref('theme', ['light', 'dark', 'system'], THEME_LABEL, 'Tema Değiştir'));
  $('#st-font').addEventListener('click', () => pickPref('fontSize', ['small', 'medium', 'large'], FONT_LABEL, 'Kanji Font Boyutu'));
  $('#st-logout').addEventListener('click', () => {
    sheet(`<div class="grab"></div><h3>Çıkış Yap</h3>
      <p>Bu cihazdan çıkış yapmak istediğine emin misin?</p>
      <button class="btn btn-primary" id="sh-yes">Çıkış Yap</button>
      <button class="btn btn-ghost" id="sh-no">Vazgeç</button>`);
    $('#sh-yes').addEventListener('click', doLogout);
    $('#sh-no').addEventListener('click', closeSheet);
  });
}

function pickPref(key, values, labels, title) {
  const cur = state.me?.preferences?.[key];
  sheet(`<div class="grab"></div><h3>${esc(title)}</h3>
    <div style="margin-top:14px">${values.map(v => `
      <button class="choice ${v === cur ? 'on' : ''}" data-val="${v}">
        <span class="txt"><b>${labels[v]}</b></span>
        <span class="mark">${I.check}</span>
      </button>`).join('')}</div>`);
  $$('[data-val]').forEach(b => b.addEventListener('click', async () => {
    const res = await api('PUT', '/auth/update-info', { preferences: { [key]: b.dataset.val } });
    closeSheet();
    if (guard(res)) { state.me = res.json.data; applyPrefs(); showSettings(); }
  }));
}

function showSettingsGoal() {
  const cur = state.me?.dailyGoal ?? 20;
  const opts = [[5, 'Rahat'], [10, 'Orta'], [20, 'Ciddi'], [40, 'Yoğun']];
  paint(topbar() + `<div class="pad">
      <h1 class="title-xl">Günlük Kelime Hedefi</h1>
      <p class="lead">Günde kaç kelime çalışacaksın?</p>
      ${opts.map(([n, label]) => `
        <button class="choice ${n === cur ? 'on' : ''}" data-goal="${n}">
          <span class="txt"><b>${label}</b><span>${n} kelime/gün</span></span>
          <span class="mark">${I.check}</span>
        </button>`).join('')}
      <p class="tiny gap-16">Hedefini gün içinde artırırsan havuz aynı gün genişler; azaltırsan yeni hedef yarın geçerli olur.</p>
    </div>
    <div class="footer"><button class="btn btn-primary" id="b-save">Kaydet</button></div>`);
  let picked = cur;
  $$('[data-goal]').forEach(b => b.addEventListener('click', () => {
    picked = Number(b.dataset.goal);
    $$('[data-goal]').forEach(x => x.classList.toggle('on', x === b));
  }));
  $('#b-save').addEventListener('click', async () => {
    const res = await api('PUT', '/auth/update-info', { dailyGoal: picked });
    if (guard(res, 'Günlük hedefin güncellendi')) { state.me = res.json.data; back(); }
  });
}

// Öğrenme Seviyeni Değiştir — kilit AÇMA değil, açık seviyeler arasında SEÇİM
async function showSettingsLevel() {
  const tk = activeToken;
  loading(topbar());
  const res = await api('GET', '/progress');
  if (stale(tk)) return;
  if (!guard(res)) return back();
  render(res.json.data);

  function render(d) {
    const STATE_TAG = {
      locked: '<span class="tag plain">Kilitli</span>',
      active: '<span class="tag bad">Şu anki seviyen</span>',
      completed: '<span class="tag ok">Tamamlandı</span>',
      available: ''
    };
    paint(topbar() + `<div class="pad">
        <h1 class="title-xl">Öğrenme Seviyen</h1>
        <p class="lead">Günlük dersin bu seviyeden gelir. İlerlemen kaybolmaz — dilediğin an geri dönebilirsin.</p>
        <div class="wordlist">
          ${d.levels.map(l => `
            <div class="wordrow" style="cursor:default;align-items:flex-start;gap:14px;${l.state === 'locked' ? 'opacity:.6' : ''}">
              ${badge(l.jlptLevel, l.state === 'locked' ? 'ghost' : '')}
              <span class="jp" style="flex:1">
                <b style="font-family:inherit;font-size:15.5px">${esc(l.jlptLevel)} • ${esc(l.label)}</b>
                <span>${l.state === 'locked' ? esc(l.unlockHint || '') : `${l.totalWords} kelime · %${l.completionRate} ilerleme`}</span>
                ${l.state !== 'locked' ? `<span class="meter" style="height:6px;margin-top:8px;display:block"><i style="width:${l.completionRate}%"></i></span>` : ''}
              </span>
              ${l.canSelect ? `<button class="link" data-pick="${l.jlptLevel}">Geç</button>` : STATE_TAG[l.state]}
            </div>`).join('')}
        </div>
        <div class="card soft gap-16" style="display:flex;gap:10px;align-items:flex-start">
          ${I.info}<p style="margin:0;font-size:13px;line-height:1.55;color:var(--brand)">Bir sonraki seviyenin kilidi, listeyi %${d.completionThreshold} oranında tamamlayınca açılır.</p>
        </div>
      </div>`);
    $$('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const lvl = d.levels.find(x => x.jlptLevel === b.dataset.pick);
      sheet(`<div class="grab"></div><h3>${esc(lvl.jlptLevel)} • ${esc(lvl.label)} seviyesine geçilsin mi?</h3>
        <p>İlerlemen kaybolmaz, serilerin bozulmaz. Günlük dersin bundan sonra bu seviyeden gelir.</p>
        <button class="btn btn-primary" id="sh-yes">Onayla</button>
        <button class="btn btn-ghost" id="sh-no">Vazgeç</button>`);
      $('#sh-no').addEventListener('click', closeSheet);
      $('#sh-yes').addEventListener('click', async () => {
        const r = await api('PUT', '/progress/active-level', { jlptLevel: lvl.jlptLevel });
        closeSheet();
        if (!guard(r, 'Seviyen güncellendi')) return;
        // Yanıt GET /progress ile aynı gövde — ikinci istek atılmaz
        if (state.me) state.me.activeLevel = lvl.jlptLevel;
        if (state.home) state.home.activeLevel = lvl.jlptLevel;
        render(r.json.data);
      });
    }));
  }
}

function showSettingsPassword() {
  formScreen({
    title: 'Şifre Girin', lead: 'Lütfen mevcut şifrenizi giriniz.', action: 'Devam Et',
    body: `<div class="input" id="w-pw">${I.key}<input id="in-pw" type="password" placeholder="Şifreniz">
             <button type="button" class="eye" data-eye="in-pw">${I.eye}</button></div>
           <div class="errline" id="err"></div>`
  });
  wireEyes();
  $('#f-action').addEventListener('click', async () => {
    const password = $('#in-pw').value;
    const res = await api('POST', '/auth/verify-password', { password });
    if (!res.ok) {
      $('#w-pw').classList.add('bad');
      $('#err').textContent = res.json.message || 'Şifreniz yanlış. Lütfen tekrar deneyin.';
      return;
    }
    state.verifiedPassword = password;
    go('settings-password-new');
  });
}

function showSettingsPasswordNew() {
  formScreen({
    title: 'Yeni Şifre Oluştur', lead: 'Lütfen şifreni gir ve doğrula.', action: 'Şifreyi Değiştir',
    body: `<div class="field"><label>Şifre</label>${pwField('in-pw')}</div>
           <div id="pwbox"></div>
           <div class="field gap-12"><label>Şifre (tekrar)</label>${pwField('in-pw2', 'Şifreni tekrar gir')}</div>
           <div class="errline" id="err"></div>`
  });
  wireEyes(); wireStrength('in-pw', 'pwbox');
  $('#f-action').addEventListener('click', async () => {
    const p1 = $('#in-pw').value, p2 = $('#in-pw2').value, err = $('#err');
    if (p1.length < 8) { err.textContent = 'Şifre en az 8 karakter olmalı'; return; }
    if (p1 !== p2) { err.textContent = 'Şifreler eşleşmiyor'; return; }
    const res = await api('PUT', '/auth/change-password', {
      oldPassword: state.verifiedPassword, newPassword: p1, deviceName: 'web-simülatör'
    });
    if (!res.ok) { err.textContent = res.json.message || 'Şifre değiştirilemedi'; return; }
    // Değişiklik TÜM oturumları kapatır; bu cihaz için taze token çifti döner
    setTokens(res.json.data.accessToken, res.json.data.refreshToken);
    state.verifiedPassword = null;
    reset('settings-password-success');
  });
}

function showSettingsPasswordSuccess() {
  statusScreen({
    title: 'Şifren Değiştirildi',
    body: 'İşlemin başarıyla tamamlandı. Öğrenmeye kaldığın yerden devam edebilirsin!',
    primary: { label: 'Ana Sayfaya Dön', onClick: () => reset('home') }
  });
}

function showSettingsNotifications() {
  const n = state.me?.notificationSettings || {};
  const rows = [
    ['dailyWord', 'Günlük Kelimeler', 'Her gün seçtiğin saatte yeni bir kelime.'],
    ['streakReminder', 'Seri Koruma Uyarısı', 'Serin tehlikedeyken haber verir.'],
    ['dailyReminder', 'Pratik Anımsatıcısı', 'Günün görevini hatırlatır.'],
    ['wordLevelDown', 'Tekrar Gereken Kelimeler', 'Unutulmaya başlayan kelimeler için.']
  ];
  paint(topbar() + `<div class="pad">
      <h1 class="title-xl">Bildirim Ayarları</h1>
      <p class="lead">Dört bildirim türü birbirinden bağımsızdır; biri diğerini kapatmaz.</p>
      <div class="group">
        ${rows.map(([key, label, desc]) => `
          <div class="switch-row">
            <span class="txt"><b>${label}</b><span>${desc}</span></span>
            <span class="switch ${n[key] !== false ? 'on' : ''}" data-key="${key}"><i></i></span>
          </div>`).join('')}
      </div>
      <div class="grouplabel">Hatırlatma Saati</div>
      <div class="input">${I.bellRing}<input id="in-time" type="time" value="${esc(n.reminderTime || '20:00')}"></div>
      <p class="tiny gap-8">Bu saat hem "Pratik Anımsatıcısı" hem "Günlük Kelimeler" için zamanlama kaynağıdır.</p>
    </div>
    <div class="footer"><button class="btn btn-primary" id="b-save">Kaydet</button></div>`);
  $$('.switch').forEach(s => s.addEventListener('click', () => s.classList.toggle('on')));
  $('#b-save').addEventListener('click', async () => {
    const notificationSettings = { reminderTime: $('#in-time').value };
    $$('.switch').forEach(s => { notificationSettings[s.dataset.key] = s.classList.contains('on'); });
    const res = await api('PUT', '/auth/update-info', { notificationSettings });
    if (guard(res, 'Bildirim ayarların kaydedildi')) { state.me = res.json.data; back(); }
  });
}

// Hukuki metinler backend'den gelir (uygulamaya gömülü DEĞİL) — düzeltme
// mağaza onayı beklemeden yayına girsin diye
async function showSettingsLegal() {
  const tk = activeToken;
  loading(topbar());
  const res = await api('GET', '/legal', undefined, { auth: false });
  if (stale(tk)) return;
  if (!guard(res)) return back();
  // GET /api/legal → { lang, company, docs: [...] } — dizi DEĞİL
  const { docs = [], company = '' } = res.json.data;
  paint(topbar() + `<div class="pad">
      <h1 class="title-xl">Hakkında</h1>
      <div class="group gap-16">
        ${docs.map(d => `<button class="row-item" data-doc="${esc(d.key)}">
          <span class="ic">${I.doc}</span>
          <span class="lbl">${esc(d.title)}<span style="display:block;font-size:12px;color:var(--muted);margin-top:2px">Sürüm ${esc(d.version)} · ${esc(d.effectiveDate)}</span></span>
          <span class="chev">${I.chevR}</span></button>`).join('')}
      </div>
      <p class="tiny gap-24" style="text-align:center">Uygulama Sürümü 1.0.0<br>${esc(company)}</p>
    </div>`);
  $$('[data-doc]').forEach(b => b.addEventListener('click', () => go('legal-doc', { key: b.dataset.doc })));
}

async function showLegalDoc({ key }) {
  const tk = activeToken;
  loading(topbar());
  const res = await api('GET', '/legal/' + key, undefined, { auth: false });
  if (stale(tk)) return;
  if (!guard(res)) return back();
  const d = res.json.data;
  paint(topbar() + `<div class="pad prose">
      <h1 class="title-xl">${esc(d.title)}</h1>
      <p class="tiny">Sürüm ${esc(d.version)} · Yürürlük ${esc(d.effectiveDate)}</p>
      <p class="gap-16">${esc(d.intro)}</p>
      ${d.sections.map(s => `<h3>${esc(s.heading)}</h3><p>${esc(s.body)}</p>`).join('')}
    </div>`);
}

function showSettingsDelete() {
  formScreen({
    title: 'Hesabını Sil',
    lead: 'Bu işlem geri alınamaz. Tüm ilerlemen, kelimelerin ve istatistiklerin kalıcı olarak silinir.',
    action: 'Hesabı Kalıcı Olarak Sil',
    body: `<div class="field"><label>Şifren</label>${pwField('in-pw', 'Onaylamak için şifreni gir')}</div>
           <div class="errline" id="err"></div>`
  });
  wireEyes();
  $('#f-action').addEventListener('click', () => {
    const password = $('#in-pw').value;
    if (!password) { $('#err').textContent = 'Şifre gerekli'; return; }
    sheet(`<div class="grab"></div>
      <div class="blob">${I.trash}</div>
      <h3>Hesabın silinsin mi?</h3>
      <p>Bu işlem geri alınamaz ve tüm verilerin (KVKK gereği) kalıcı olarak silinir.</p>
      <button class="btn btn-primary" id="sh-yes">Evet, Hesabımı Sil</button>
      <button class="btn btn-ghost" id="sh-no">Vazgeç</button>`);
    $('#sh-no').addEventListener('click', closeSheet);
    $('#sh-yes').addEventListener('click', async () => {
      const res = await api('DELETE', '/auth/delete-account', { password });
      closeSheet();
      if (!res.ok) { $('#err').textContent = res.json.message || 'Silinemedi'; return; }
      setTokens(null, null); state.me = null; state.home = null;
      toast('Hesabın silindi', 'ok');
      reset('welcome');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Ekran tablosu
// ═══════════════════════════════════════════════════════════════
const SHOW = {
  welcome: showWelcome,
  'reg-email': showRegEmail, 'reg-name': showRegName, 'reg-password': showRegPassword, 'reg-success': showRegSuccess,
  'verify-ok': showVerifyOk, 'verify-fail': showVerifyFail, 'verify-nudge': showVerifyNudge,
  login: showLogin, 'forgot-email': showForgotEmail, 'forgot-newpass': showForgotNewPass, 'reset-success': showResetSuccess,

  home: showHome, notifications: showNotifications, mistakes: showMistakes,
  lesson: renderLesson,
  'quiz-intro': showQuizIntro, 'quiz-question': showQuizQuestion, 'quiz-result': showQuizResult,
  library: showLibrary, 'word-detail': showWordDetail,
  memory: showMemory, 'memory-box': showMemoryBox,

  settings: showSettings, 'settings-goal': showSettingsGoal, 'settings-level': showSettingsLevel,
  'settings-password': showSettingsPassword, 'settings-password-new': showSettingsPasswordNew,
  'settings-password-success': showSettingsPasswordSuccess,
  'settings-notifications': showSettingsNotifications,
  'settings-legal': showSettingsLegal, 'legal-doc': showLegalDoc, 'settings-delete': showSettingsDelete
};

// ═══════════════════════════════════════════════════════════════
// Geliştirici çubuğu
// ═══════════════════════════════════════════════════════════════
function renderDevBar() {
  const bar = $('#dev-bar');
  if (!state.access) { bar.hidden = true; return; }
  bar.hidden = false;
  $('#dev-email').textContent = state.me?.email || state.wizard.email || '(oturum açık)';
}
$('#dev-bar').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-dev]');
  if (!btn) return;
  if (btn.dataset.dev === 'reset') return doLogout();
  if (btn.dataset.dev === 'fresh') {
    setTokens(null, null);
    state.me = null; state.home = null; state.promptedPlacement = false; state.wizard = {};
    reset('welcome'); go('reg-email');
    setTimeout(() => { const i = $('#in-email'); if (i) i.value = `test${Date.now().toString(36)}@musubi.dev`; }, 0);
  }
});

boot();
