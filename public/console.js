/* Musubi dev konsolu — backend modüllerini uçtan uca test etmek için.
   Aynı origin'den servis edilir (CORS yok); helmet CSP nedeniyle tüm JS bu dosyadadır. */
'use strict';

// ───────────────────────── Durum ─────────────────────────
const state = {
  access: localStorage.getItem('musubi_access') || null,
  refresh: localStorage.getItem('musubi_refresh') || null,
  verificationToken: null,
  resetToken: null,
  resetEmail: null,
  verifiedOldPassword: null,
  me: null,
  quiz: null,           // { id, questions, idx, total, type, passThreshold }
  lib: { page: 1, totalPages: 1, mode: 'list' },
  levels: { selected: null },
  logCount: 0
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────────────────── API istemcisi ─────────────────────────
async function api(method, path, body, opts = {}) {
  const started = performance.now();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && state.access) headers.Authorization = 'Bearer ' + state.access;

  let res, json;
  try {
    res = await fetch('/api' + path, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    toast('Sunucuya ulaşılamadı — backend çalışıyor mu?', 'err');
    throw e;
  }

  // Access token süresi dolduysa bir kez tazeleyip isteği tekrarla
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
  }

  logRequest(method, path, res.status, performance.now() - started, body, json);
  return { ok: res.ok, status: res.status, json };
}

// Hata mesajını toast'la, başarılıysa sessiz kal
function guard(res, okMsg) {
  if (!res.ok) { toast(res.json.message || `Hata (${res.status})`, 'err'); return false; }
  if (okMsg) toast(okMsg, 'ok');
  return true;
}

// ───────────────────────── Günlük & toast ─────────────────────────
function logRequest(method, path, status, ms, body, json) {
  state.logCount++;
  $('#log-count').textContent = state.logCount;
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML =
    `<span class="st ${status < 400 ? 'ok' : 'err'}">${status}</span>` +
    `<span>${esc(method)} /api${esc(path)}</span>` +
    `<span class="ms">${ms.toFixed(0)} ms</span>` +
    `<pre>${esc(JSON.stringify({ istek: body ?? null, yanit: json }, null, 2))}</pre>`;
  div.addEventListener('click', () => div.classList.toggle('open'));
  $('#log-entries').prepend(div);
}

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

// ───────────────────────── Oturum ─────────────────────────
function setTokens(access, refresh) {
  state.access = access; state.refresh = refresh;
  if (access) localStorage.setItem('musubi_access', access); else localStorage.removeItem('musubi_access');
  if (refresh) localStorage.setItem('musubi_refresh', refresh); else localStorage.removeItem('musubi_refresh');
  $('#tok-access').textContent = access ? access.slice(0, 28) + '…' : '—';
  $('#tok-refresh').textContent = refresh ? refresh.slice(0, 28) + '…' : '—';
  refreshWhoami();
}

async function refreshWhoami() {
  if (!state.access) {
    $('#auth-dot').className = 'dot off';
    $('#auth-label').textContent = 'Oturum yok';
    return;
  }
  const res = await api('GET', '/auth/me');
  if (res.ok) {
    state.me = res.json.data;
    $('#auth-dot').className = 'dot on';
    $('#auth-label').textContent = `${state.me.name} ${state.me.surname || ''} · ${state.me.email}`;
    fillSettingsForm();
  } else {
    $('#auth-dot').className = 'dot off';
    $('#auth-label').textContent = res.status === 403 ? 'E-posta doğrulanmadı' : 'Oturum geçersiz';
  }
}

// ───────────────────────── Görünüm geçişi ─────────────────────────
$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  $$('#nav button').forEach(b => b.classList.toggle('active', b === btn));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === btn.dataset.view));
});

$('#log-toggle').addEventListener('click', () => {
  const el = $('#log-entries');
  el.hidden = !el.hidden;
});

// ───────────────────────── Kimlik ─────────────────────────
const randomEmail = () => `test${Date.now().toString(36)}@musubi.dev`;
$('#f-register').email.value = randomEmail();

$('#f-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const res = await api('POST', '/auth/register', {
    name: f.name.value, surname: f.surname.value,
    email: f.email.value, password: f.password.value, deviceName: 'dev-konsolu'
  }, { auth: false });
  if (!guard(res, 'Kayıt başarılı')) return;
  setTokens(res.json.accessToken, res.json.refreshToken);
  $('#f-login').email.value = f.email.value;
  if (res.json.verificationToken) {           // yalnızca dev ortamında döner
    state.verificationToken = res.json.verificationToken;
    $('#verify-panel').hidden = false;
  }
});

$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const res = await api('POST', '/auth/login', {
    email: f.email.value, password: f.password.value, deviceName: 'dev-konsolu'
  }, { auth: false });
  if (!guard(res, 'Giriş başarılı')) return;
  setTokens(res.json.accessToken, res.json.refreshToken);
  if (!res.json.isEmailVerified) toast('E-posta doğrulanmamış — çoğu endpoint 403 döner', 'err');
});

$('#f-forgot').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = e.target.email.value;
  const res = await api('POST', '/auth/forgot-password', { email }, { auth: false });
  if (!guard(res, 'Sıfırlama isteği gönderildi')) return;
  if (res.json.resetToken) {                  // dev ortamı: token yanıtta döner
    state.resetToken = res.json.resetToken;
    state.resetEmail = email;
    $('#f-reset').hidden = false;
  }
});

$('#f-reset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('POST', '/auth/reset-password', {
    token: state.resetToken, password: e.target.password.value, deviceName: 'dev-konsolu'
  }, { auth: false });
  if (!guard(res, 'Şifre sıfırlandı, oturum açıldı')) return;
  setTokens(res.json.data.accessToken, res.json.data.refreshToken);
  $('#f-reset').hidden = true;
});

$('#f-updateinfo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {};
  if (f.name.value) body.name = f.name.value;
  if (f.surname.value) body.surname = f.surname.value;
  if (f.dailyGoal.value) body.dailyGoal = Number(f.dailyGoal.value);
  if (f.timezone.value) body.timezone = f.timezone.value;
  const prefs = {};
  if (f.theme.value) prefs.theme = f.theme.value;
  if (f.fontSize.value) prefs.fontSize = f.fontSize.value;
  if (Object.keys(prefs).length) body.preferences = prefs;
  const res = await api('PUT', '/auth/update-info', body);
  if (guard(res, 'Profil güncellendi')) refreshWhoami();
});

$('#f-verifypass').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = e.target.password.value;
  const res = await api('POST', '/auth/verify-password', { password: pass });
  if (!guard(res, 'Şifre doğru — yeni şifreyi girebilirsin')) return;
  state.verifiedOldPassword = pass;
  $('#f-changepass').hidden = false;
});

$('#f-changepass').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('PUT', '/auth/change-password', {
    oldPassword: state.verifiedOldPassword,
    newPassword: e.target.newPassword.value,
    deviceName: 'dev-konsolu'
  });
  if (!guard(res, 'Şifre değiştirildi — tüm diğer oturumlar kapandı')) return;
  setTokens(res.json.data.accessToken, res.json.data.refreshToken);
  $('#f-changepass').hidden = true;
});

$('#f-raw').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  let body;
  if (f.body.value.trim()) {
    try { body = JSON.parse(f.body.value); }
    catch { return toast('Gövde geçerli JSON değil', 'err'); }
  }
  const res = await api(f.method.value, f.path.value, body);
  const box = $('#raw-result');
  box.hidden = false;
  box.textContent = JSON.stringify(res.json, null, 2);
});

// ───────────────────────── Buton eylemleri (delegasyon) ─────────────────────────
const actions = {
  'random-email': () => { $('#f-register').email.value = randomEmail(); },

  'check-email': async () => {
    const email = $('#f-register').email.value;
    const res = await api('POST', '/auth/check-email', { email }, { auth: false });
    const el = $('#check-email-result');
    if (!res.ok) { el.className = 'hint err'; el.textContent = res.json.message; return; }
    el.className = 'hint ' + (res.json.available ? 'ok' : 'err');
    el.textContent = res.json.available ? '✓ Adres müsait' : '✗ Bu adres zaten kayıtlı';
  },

  'verify-email': async () => {
    const res = await api('GET', '/auth/verify-email/' + state.verificationToken, undefined, { auth: false });
    if (!guard(res, 'E-posta doğrulandı 🎉')) return;
    setTokens(res.json.data.accessToken, res.json.data.refreshToken);
    $('#verify-panel').hidden = true;
  },

  'resend-verification': async () => {
    const res = await api('POST', '/auth/resend-verification-email', { email: $('#f-register').email.value }, { auth: false });
    guard(res, 'Doğrulama maili tekrar gönderildi');
  },

  'me': async () => {
    const res = await api('GET', '/auth/me');
    const box = $('#me-box');
    box.hidden = false;
    box.textContent = JSON.stringify(res.json, null, 2);
  },

  'refresh-token': async () => {
    const res = await api('POST', '/auth/refresh', { refreshToken: state.refresh }, { auth: false });
    if (guard(res, 'Access token tazelendi')) setTokens(res.json.data.accessToken, state.refresh);
  },

  'logout': async () => {
    await api('POST', '/auth/logout', { refreshToken: state.refresh });
    setTokens(null, null); toast('Bu cihazın oturumu kapandı', 'ok');
  },

  'logout-all': async () => {
    await api('POST', '/auth/logout', {});
    setTokens(null, null); toast('Tüm oturumlar kapandı', 'ok');
  },

  'delete-account': async () => {
    const pass = prompt('Hesap kalıcı silinecek (KVKK). Onay için şifreni yaz:');
    if (!pass) return;
    const res = await api('DELETE', '/auth/delete-account', { password: pass });
    if (guard(res, 'Hesap ve tüm veriler silindi')) setTokens(null, null);
  },

  'save-notif-settings': async () => {
    const res = await api('PUT', '/auth/update-info', {
      notificationSettings: {
        dailyReminder: $('#ns-dailyReminder').checked,
        streakReminder: $('#ns-streakReminder').checked,
        wordLevelDown: $('#ns-wordLevelDown').checked
      }
    });
    guard(res, 'Bildirim ayarları kaydedildi');
  },

  // ── Anasayfa ──
  'load-home': loadHome,
  'load-day': async () => {
    const d = $('#day-input').value;
    if (!d) return toast('Tarih seç', 'err');
    const res = await api('GET', '/home/day/' + d);
    if (!guard(res)) return;
    renderDayDetail(res.json.data);
  },

  // ── Çalışma ──
  'load-today': loadToday,
  'session-start': async () => {
    const res = await api('POST', '/sessions/start', { jlptLevel: $('#study-level').value });
    guard(res, 'Oturum başladı');
  },
  'session-complete': async () => {
    const res = await api('PUT', '/sessions/complete');
    guard(res, 'Oturum tamamlandı');
  },
  'load-mistakes': loadMistakes,
  'load-stats': loadStats,

  // ── Sınav ──
  'quiz-status': loadQuizStatus,
  'quiz-start-placement': () => startQuiz({ type: 'placement' }),
  'quiz-start-levelup': () => startQuiz({ type: 'levelup', jlptLevel: $('#levelup-level').value }),

  // ── Seviyeler ──
  'load-progress': loadProgress,
  'load-wordlist': () => loadWordList(1),

  // ── Kütüphane ──
  'lib-prev': () => { if (state.lib.page > 1) loadLibrary(state.lib.page - 1); },
  'lib-next': () => { if (state.lib.page < state.lib.totalPages) loadLibrary(state.lib.page + 1); },

  // ── Bildirimler ──
  'load-notifications': loadNotifications,
  'read-all': async () => {
    const res = await api('PUT', '/notifications/read-all');
    if (guard(res, 'Hepsi okundu')) loadNotifications();
  }
};

document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (btn && actions[btn.dataset.action]) actions[btn.dataset.action](btn);
});

// ───────────────────────── Anasayfa ─────────────────────────
async function loadHome() {
  const res = await api('GET', '/home/summary');
  if (!guard(res)) return;
  const d = res.json.data;
  $('#home-summary').className = '';
  $('#home-summary').innerHTML = `
    <h2>Merhaba ${esc(d.name)} 👋</h2>
    <div class="tiles">
      <div class="tile"><div class="v">${d.today.totalWords}<small>/${d.dailyGoal}</small></div><div class="k">Bugün tamamlanan</div>
        <div class="meter"><i style="width:${Math.min(100, d.today.totalWords / d.dailyGoal * 100)}%"></i></div></div>
      <div class="tile"><div class="v">🔥 ${d.streak.current}</div><div class="k">Günlük seri · En iyi: ${d.streak.longest}</div></div>
      <div class="tile"><div class="v">${d.pendingReviews}</div><div class="k">Bekleyen tekrar</div></div>
      <div class="tile"><div class="v">${d.tomorrowReviews}</div><div class="k">Yarın bekleyen kart</div></div>
      <div class="tile"><div class="v">${d.todayMistakeCount}</div><div class="k">Bugünün hataları</div></div>
    </div>
    <div class="row wrap">
      ${d.today.correctCount ? `<span class="pill good">✓ ${d.today.correctCount} doğru</span>` : ''}
      ${d.today.wrongCount ? `<span class="pill bad">✗ ${d.today.wrongCount} yanlış</span>` : ''}
      ${d.today.emptyCount ? `<span class="pill warn">○ ${d.today.emptyCount} boş</span>` : ''}
      ${d.progress.map(p => `<span class="pill plain">${esc(p.jlptLevel)} ${p.isUnlocked ? '· %' + p.completionRate : '🔒'}</span>`).join('')}
    </div>`;

  const cal = await api('GET', '/home/calendar');
  if (cal.ok) {
    $('#home-calendar').innerHTML = cal.json.data.length
      ? cal.json.data.map(s => {
          const day = s.date.slice(0, 10);
          return `<button class="chip done" data-day="${day}">${day} · ${s.totalWords} kelime</button>`;
        }).join('')
      : '<div class="empty">Son 30 günde oturum yok.</div>';
    $$('#home-calendar .chip').forEach(c => c.addEventListener('click', async () => {
      $('#day-input').value = c.dataset.day;
      actions['load-day']();
    }));
  }
}

function renderDayDetail(d) {
  const rIcon = { correct: '<span class="pill good">✓ doğru</span>', wrong: '<span class="pill bad">✗ yanlış</span>', empty: '<span class="pill warn">○ boş</span>' };
  $('#day-detail').innerHTML = `
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="v">${d.totalWords}<small>/${d.goal}</small></div><div class="k">${esc(d.date)}</div></div>
      <div class="tile"><div class="v">${d.correctCount}</div><div class="k">Doğru</div></div>
      <div class="tile"><div class="v">${d.wrongCount}</div><div class="k">Yanlış</div></div>
      <div class="tile"><div class="v">${d.emptyCount}</div><div class="k">Boş</div></div>
    </div>
    ${d.words.length ? `<div class="wlist">${d.words.map(w => `
      <div class="witem" style="cursor:default">
        <div class="kj">${esc(w.word.kanji)}<small>${esc(w.word.romaji)}</small></div>
        <div class="mean">${esc(w.word.meaning)}</div>
        ${rIcon[w.result] || ''}
      </div>`).join('')}</div>` : '<div class="empty">Bu günde kelime kaydı yok.</div>'}`;
}

// ───────────────────────── Çalışma (SRS) ─────────────────────────
async function loadToday() {
  const res = await api('GET', '/userwords/today?jlptLevel=' + $('#study-level').value);
  if (!guard(res)) return;
  const { newWords, reviewWords } = res.json.data;
  const all = [...reviewWords.map(w => ({ ...w, isReview: true })), ...newWords];
  if (!all.length) return $('#study-words').innerHTML = '<div class="empty">Bugünlük havuz boş.</div>';
  $('#study-words').innerHTML = all.map(w => {
    const word = w.word || w;   // reviewWords UserWord+word, newWords düz Word döner
    return `
    <div class="study-card" id="sc-${word._id}">
      ${w.isReview ? '<span class="badge gray">tekrar</span>' : '<span class="badge">yeni</span>'}
      <div class="kj">${esc(word.kanji)}</div>
      <div class="rm">${esc(word.romaji)}</div>
      <div class="mean hidden-m" title="Görmek için tıkla">${esc(word.meaning)}</div>
      <div class="actions">
        <button class="b-good" data-answer="correct" data-word="${word._id}">Doğru</button>
        <button class="b-warn" data-answer="empty" data-word="${word._id}">Boş</button>
        <button class="b-bad" data-answer="wrong" data-word="${word._id}">Yanlış</button>
      </div>
      <div class="study-done"></div>
    </div>`;
  }).join('');

  $$('#study-words .mean').forEach(m => m.addEventListener('click', () => m.classList.remove('hidden-m')));
  $$('#study-words [data-answer]').forEach(b => b.addEventListener('click', async () => {
    const res2 = await api('POST', '/userwords/answer', { wordId: b.dataset.word, result: b.dataset.answer });
    if (!guard(res2)) return;
    const card = $('#sc-' + b.dataset.word);
    card.querySelector('.mean').classList.remove('hidden-m');
    card.querySelector('.actions').remove();
    const d = res2.json.data;
    card.querySelector('.study-done').innerHTML =
      `<span class="pill ${b.dataset.answer === 'correct' ? 'good' : b.dataset.answer === 'wrong' ? 'bad' : 'warn'}">
        kayıt ✓ · ustalık ${d.masteryLevel}${d.levelDropped ? ' (düştü!)' : ''}</span>`;
  }));
}

async function loadMistakes() {
  const res = await api('GET', '/userwords/mistakes');
  if (!guard(res)) return;
  const { mistakes, total } = res.json.data;
  $('#mistakes-list').innerHTML = total === 0
    ? '<div class="empty">Bugün hata yok 🎉</div>'
    : `<div class="hint">${total} hata</div><div class="wlist">` + mistakes.map(m => `
      <div class="witem" style="cursor:default">
        <div class="kj">${esc(m.word.kanji)}<small>${esc(m.word.romaji)}</small></div>
        <div class="mean">${esc(m.word.meaning)}</div>
        <span class="pill bad">${m.wrongCount}×</span>
      </div>`).join('') + '</div>';
}

async function loadStats() {
  const res = await api('GET', '/userwords/stats');
  if (!guard(res)) return;
  const d = res.json.data;
  $('#stats-box').innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v">${d.total}</div><div class="k">Toplam çalışılan</div></div>
      <div class="tile"><div class="v">${d.learned}</div><div class="k">Öğrenildi</div></div>
      <div class="tile"><div class="v">${d.review}</div><div class="k">Vadesi gelen</div></div>
    </div>
    ${masteryStack(d.byMasteryLevel, d.total)}`;
}

// Ustalık dağılımı: marka kırmızısının açıktan koyuya sekansı (1→5), 2px aralıklı
function masteryStack(dist, total, notStarted = 0) {
  const colors = ['var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--m4)', 'var(--m5)'];
  const sum = total + notStarted || 1;
  const segs = [1, 2, 3, 4, 5].map(l =>
    dist[l] ? `<i style="width:${dist[l] / sum * 100}%;background:${colors[l - 1]}"></i>` : '').join('');
  const ns = notStarted ? `<i style="width:${notStarted / sum * 100}%;background:var(--line)"></i>` : '';
  return `
    <div class="stack">${segs}${ns}</div>
    <div class="legend">
      ${[1, 2, 3, 4, 5].map(l => `<span><span class="sw" style="background:${colors[l - 1]}"></span>${l}. Seviye (${dist[l] || 0})</span>`).join('')}
      ${notStarted ? `<span><span class="sw" style="background:var(--line)"></span>Başlanmadı (${notStarted})</span>` : ''}
    </div>`;
}

// ───────────────────────── Sınav ─────────────────────────
async function loadQuizStatus() {
  const res = await api('GET', '/quiz/status');
  if (!guard(res)) return;
  const d = res.json.data;
  $('#quiz-status-box').innerHTML = `<div class="card">
    <div class="row wrap">
      <span class="pill ${d.placementAvailable ? 'good' : 'plain'}">Seviye tespiti: ${d.placementAvailable ? 'girebilir' : 'tamamlanmış'}</span>
      ${Object.entries(d.levels).map(([lvl, s]) => `
        <span class="pill ${s.canAttempt ? 'good' : 'plain'}">${lvl}→ ${s.canAttempt ? 'sınav açık' : s.nextLevelUnlocked ? 'geçildi' : s.nextAttemptAllowedAt ? 'cooldown' : 'kapalı'}</span>`).join('')}
    </div></div>`;
}

async function startQuiz(body) {
  const res = await api('POST', '/quiz/start', body);
  if (!res.ok) {
    const msg = res.json.message + (res.json.nextAttemptAllowedAt ? ' · ' + new Date(res.json.nextAttemptAllowedAt).toLocaleString('tr') : '');
    return toast(msg, 'err');
  }
  const d = res.json.data;
  state.quiz = { id: d.quizId, questions: d.questions, idx: 0, total: d.totalQuestions, type: d.type, level: d.jlptLevel, passThreshold: d.passThreshold };
  renderQuestion();
}

function renderQuestion() {
  const q = state.quiz.questions[state.quiz.idx];
  const pct = (state.quiz.idx / state.quiz.total) * 100;
  const head = `
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <span><span class="badge">${esc(state.quiz.level)}</span> <b>${state.quiz.type === 'placement' ? 'Seviye Tespit' : 'Seviye Atlama'}</b></span>
        <span class="hint">${state.quiz.idx + 1} / ${state.quiz.total}</span>
      </div>
      <div class="quiz-progress"><i style="width:${pct}%"></i></div>`;

  const audio = q.prompt.audioUrl
    ? `<div class="row center"><button class="ghost" data-audio="${esc(q.prompt.audioUrl)}">🔊 Dinle</button>
       <button class="ghost" data-audio="${esc(q.prompt.audioUrl)}" data-slow="1">🐌 Yavaş</button></div>` : '';

  let promptHtml = '', answerHtml = '';
  const instr = {
    meaning: 'Bu kelimenin Türkçesini seçiniz', reverse: 'Anlama uyan kelimeyi seçiniz',
    reading: 'Kelimenin okunuşunu seçiniz', typing: 'Bu kelimenin Türkçesini yazınız',
    fillblank: 'Boşluğa uygun kelimeyi yerleştir', image: 'Doğru şıkkı işaretleyiniz'
  }[q.format];

  if (q.format === 'typing') {
    promptHtml = `<div class="q-prompt"><div class="big">${esc(q.prompt.kanji)}</div><div class="sub">${esc(q.prompt.romaji)}</div>${audio}</div>`;
    answerHtml = `
      <form id="f-typing"><div class="row">
        <input name="answer" placeholder="Cevabınızı yazın…" autocomplete="off">
        <button type="submit" class="primary">Cevapla</button>
      </div></form>
      <div class="row center"><button class="ghost" data-skip="1">Şimdilik Geç →</button></div>`;
  } else {
    promptHtml = q.format === 'reverse' ? `<div class="q-prompt"><div class="big" style="font-size:26px">${esc(q.prompt.meaning)}</div></div>`
      : q.format === 'fillblank' ? `<div class="q-prompt"><div class="sentence">${esc(q.prompt.sentence)}</div></div>`
      : q.format === 'image' ? `<div class="q-prompt"><img src="${esc(q.prompt.imageUrl)}" alt="soru görseli"></div>`
      : `<div class="q-prompt"><div class="big">${esc(q.prompt.kanji)}</div>${q.prompt.romaji ? `<div class="sub">${esc(q.prompt.romaji)}</div>` : ''}${audio}</div>`;
    answerHtml = `<div class="q-choices">` + q.choices.map((c, i) =>
      `<button data-choice="${i}">${'ABCD'[i]}) ${esc(c)}</button>`).join('') + `</div>
      <div class="row center"><button class="ghost" data-skip="1">Şimdilik Geç →</button></div>`;
  }

  $('#quiz-player').innerHTML = head + `<div class="hint" style="margin-bottom:8px">${instr}</div>` + promptHtml + answerHtml + `<div id="q-feedback"></div></div>`;

  $$('#quiz-player [data-audio]').forEach(b => b.addEventListener('click', () => {
    const a = new Audio(b.dataset.audio);
    if (b.dataset.slow) a.playbackRate = 0.6;
    a.play().catch(() => toast('Ses çalınamadı (URL erişilemiyor olabilir)', 'err'));
  }));
  $$('#quiz-player [data-choice]').forEach(b => b.addEventListener('click', () => submitAnswer(Number(b.dataset.choice))));
  $$('#quiz-player [data-skip]').forEach(b => b.addEventListener('click', () => submitAnswer(null)));
  const ft = $('#f-typing');
  if (ft) ft.addEventListener('submit', (e) => { e.preventDefault(); submitAnswer(ft.answer.value); });
}

async function submitAnswer(answer) {
  const res = await api('POST', `/quiz/${state.quiz.id}/answer`, { index: state.quiz.questions[state.quiz.idx].index, answer });
  if (!guard(res)) return;
  const d = res.json.data;
  const correctText = d.correctAnswer ?? (d.correctIndex !== undefined ? state.quiz.questions[state.quiz.idx].choices?.[d.correctIndex] : '');
  $('#q-feedback').innerHTML = `
    <div class="feedback ${d.correct ? 'good' : 'bad'}">
      <b>${d.correct ? '✓ Doğru!' : '✗ Yanlış Cevap!'}</b>
      ${esc(d.word?.kanji || '')} — ${esc(d.word?.meaning || '')}
      ${!d.correct && correctText ? `<div>Cevap: <b>${esc(correctText)}</b></div>` : ''}
      <button id="q-continue">${d.finished ? 'Sonucu Gör' : 'Devam Et'}</button>
    </div>`;
  // Şıkları kilitle
  $$('#quiz-player [data-choice], #quiz-player [data-skip]').forEach(b => b.disabled = true);
  const ft = $('#f-typing'); if (ft) ft.querySelector('button').disabled = true;

  $('#q-continue').addEventListener('click', () => {
    if (d.finished) return renderResult(d.result);
    state.quiz.idx++;
    renderQuestion();
  });
}

function renderResult(r) {
  const s = r.summary;
  $('#quiz-player').innerHTML = `<div class="card"><div class="q-result">
    <div class="hint">Sınav Tamamlandı</div>
    ${s ? `<div class="lvl">${esc(s.determinedLevel)}</div><h2 style="justify-content:center">Seviyen Belirlendi!</h2>` : ''}
    <div class="score">%${r.score}</div>
    <div class="row center wrap">
      <span class="pill ${r.passed ? 'good' : 'bad'}">${r.passed ? 'Geçti' : 'Kaldı'} (eşik %${r.passThreshold})</span>
      <span class="pill good">✓ ${r.correctCount} doğru</span>
      <span class="pill bad">✗ ${r.totalQuestions - r.correctCount} yanlış</span>
      ${r.unlockedLevel ? `<span class="pill good">🔓 ${esc(r.unlockedLevel)} açıldı</span>` : ''}
      ${r.cooldownDays ? `<span class="pill warn">⏳ ${r.cooldownDays} gün cooldown</span>` : ''}
    </div>
    ${s ? `<div class="row center wrap" style="margin-top:10px">
      <span class="pill plain">${s.totalQuestions} soru</span>
      <span class="pill plain">${Math.floor(s.durationSeconds / 60)}:${String(s.durationSeconds % 60).padStart(2, '0')} süre</span>
      <span class="pill good">${s.correctCount} doğru</span>
      <span class="pill bad">${s.wrongCount} yanlış</span>
    </div>` : ''}
    ${r.nextRung ? `<div class="row center" style="margin-top:16px">
      <button class="primary" id="q-next-rung">Sonraki Basamak: ${esc(r.nextRung)} →</button></div>` : ''}
  </div></div>`;
  const nx = $('#q-next-rung');
  if (nx) nx.addEventListener('click', () => startQuiz({ type: 'placement' }));
}

// ───────────────────────── Seviyeler ─────────────────────────
async function loadProgress() {
  const res = await api('GET', '/progress');
  if (!guard(res)) return;
  const { completionThreshold, levels } = res.json.data;
  const order = ['N5', 'N4', 'N3', 'N2', 'N1'];
  levels.sort((a, b) => order.indexOf(a.jlptLevel) - order.indexOf(b.jlptLevel));
  $('#progress-list').innerHTML = `
    <div class="card">
      ${levels.map(l => `
        <div class="witem" data-level="${l.jlptLevel}" style="margin-bottom:8px">
          <span class="badge ${l.isUnlocked ? '' : 'gray'}">${l.jlptLevel}</span>
          <div style="flex:1">
            <div class="row" style="justify-content:space-between">
              <span style="font-size:13px">${l.totalWords} kelime ${l.isUnlocked ? '' : '· 🔒 kilitli'}</span>
              <span style="font-size:13px;color:var(--brand);font-weight:700">%${l.completionRate} tamamlandı</span>
            </div>
            <div class="meter"><i style="width:${l.completionRate}%"></i><span class="mark" style="left:${completionThreshold}%"></span></div>
          </div>
        </div>`).join('')}
      <div class="hint">ℹ️ Bir sonraki seviyeye geçmek için listeyi %${completionThreshold} oranında tamamlayın (çizgi eşiği gösterir). Seviyeye tıklayınca dağılım gelir.</div>
    </div>`;
  $$('#progress-list [data-level]').forEach(el => el.addEventListener('click', () => loadDistribution(el.dataset.level)));
}

async function loadDistribution(level) {
  state.levels.selected = level;
  const res = await api('GET', `/progress/${level}/distribution`);
  if (!guard(res)) return;
  const d = res.json.data;
  $('#distribution-card').hidden = false;
  $('#distribution-title').textContent = `${level} Dağılımı — ${d.totalWords} kelime`;
  $('#distribution-box').innerHTML = masteryStack(d.distribution, d.totalWords - d.notStarted, d.notStarted);
  loadWordList(1);
}

async function loadWordList(page) {
  if (!state.levels.selected) return;
  const m = $('#wl-mastery').value;
  const res = await api('GET', `/userwords/list?jlptLevel=${state.levels.selected}${m ? '&masteryLevel=' + m : ''}&page=${page}&limit=10`);
  if (!guard(res)) return;
  const { items, total } = res.json.data;
  $('#wordlist-box').innerHTML = total === 0
    ? '<div class="empty">Bu filtreyle çalışılmış kelime yok.</div>'
    : `<div class="hint">${total} kelime</div><div class="wlist">` + items.map(i => `
      <div class="witem" style="cursor:default">
        <div class="kj">${esc(i.word?.kanji)}<small>${esc(i.word?.romaji)}</small></div>
        <div class="mean">${esc(i.word?.meaning)}</div>
        <span class="pill plain">ustalık ${i.masteryLevel}</span>
      </div>`).join('') + '</div>';
}

// ───────────────────────── Kütüphane ─────────────────────────
let libTimer;
$('#lib-search').addEventListener('input', () => {
  clearTimeout(libTimer);
  libTimer = setTimeout(() => {
    const q = $('#lib-search').value.trim();
    q ? searchLibrary(q) : loadLibrary(1);
  }, 350);
});
$('#lib-level').addEventListener('change', () => loadLibrary(1));

async function loadLibrary(page) {
  const lvl = $('#lib-level').value;
  const res = await api('GET', `/words?page=${page}&limit=10${lvl ? '&jlptLevel=' + lvl : ''}`);
  if (!guard(res)) return;
  const { words, total, totalPages } = res.json.data;
  state.lib = { page, totalPages, mode: 'list' };
  if (total === 0) {
    $('#lib-list').innerHTML = '<div class="empty">DB boş görünüyor — <code>npm run seed</code> çalıştırdın mı?</div>';
    $('#lib-pager').hidden = true;
    return;
  }
  renderLibList(words);
  $('#lib-pager').hidden = false;
  $('#lib-page-label').textContent = `${page} / ${totalPages} · ${total} kelime`;
}

async function searchLibrary(q) {
  const res = await api('GET', '/words/search?q=' + encodeURIComponent(q));
  if (!guard(res)) return;
  $('#lib-pager').hidden = true;
  res.json.data.length ? renderLibList(res.json.data) : $('#lib-list').innerHTML = '<div class="empty">Sonuç yok.</div>';
}

function renderLibList(words) {
  $('#lib-list').innerHTML = '<div class="wlist">' + words.map(w => `
    <div class="witem" data-word="${w._id}">
      <div class="kj">${esc(w.kanji)}<small>${esc(w.kana || w.romaji)}</small></div>
      <div class="mean">${esc(w.meaning)}</div>
      <span class="badge">${esc(w.jlptLevel)}</span>
    </div>`).join('') + '</div>';
  $$('#lib-list [data-word]').forEach(el => el.addEventListener('click', () => loadWordDetail(el.dataset.word)));
}

async function loadWordDetail(id) {
  const res = await api('GET', '/words/' + id);
  if (!guard(res)) return;
  const w = res.json.data;
  $('#word-detail').hidden = false;
  $('#word-detail').innerHTML = `
    <h2><span class="badge">${esc(w.jlptLevel)}</span> Kelime ${w.isCore ? '<span class="pill good">çekirdek</span>' : '<span class="pill plain">pasif</span>'}</h2>
    <div class="wd-head">
      <div class="hint">${esc(w.type)}</div>
      <div class="kj">${esc(w.kanji)}</div>
      <div class="kana">${esc(w.kana || w.romaji)}</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px">${esc(w.meaning)}</div>
      ${w.audioUrl ? `<div class="row center" style="margin-top:10px">
        <button class="ghost" data-audio="${esc(w.audioUrl)}">🔊 Dinle</button>
        <button class="ghost" data-audio="${esc(w.audioUrl)}" data-slow="1">🐌 Yavaş</button></div>` : ''}
    </div>
    ${w.example ? `<div class="hint">ÖRNEK KULLANIM</div><div class="wd-example">${esc(w.example)}</div>`
                : '<div class="hint">Örnek cümle henüz yok (içerik bekleniyor).</div>'}`;
  $$('#word-detail [data-audio]').forEach(b => b.addEventListener('click', () => {
    const a = new Audio(b.dataset.audio);
    if (b.dataset.slow) a.playbackRate = 0.6;
    a.play().catch(() => toast('Ses çalınamadı', 'err'));
  }));
}

// ───────────────────────── Bildirimler ─────────────────────────
const NOTIF_ICONS = { daily_word: 'あ', streak_reminder: '🔥', daily_task: '📅', streak_warning: '☹️', word_level_down: '↘' };

async function loadNotifications() {
  const res = await api('GET', '/notifications');
  if (!guard(res)) return;
  const { notifications, unreadCount } = res.json.data;
  const badge = $('#unread-badge');
  badge.hidden = unreadCount === 0;
  badge.textContent = unreadCount;
  $('#notif-list').innerHTML = notifications.length === 0
    ? '<div class="empty">Bildirim yok. (Cron üretir; test için Ham İstek panelinden tetikleyebilirsin.)</div>'
    : notifications.map(n => `
      <div class="nitem ${n.read ? 'read' : ''}" data-notif="${n._id}" style="cursor:${n.read ? 'default' : 'pointer'}">
        <div class="ic">${NOTIF_ICONS[n.type] || '🔔'}</div>
        <div><b>${esc(n.title)}</b><p>${esc(n.body)}</p></div>
        <span class="when">${new Date(n.createdAt).toLocaleString('tr')}</span>
      </div>`).join('');
  $$('#notif-list [data-notif]').forEach(el => el.addEventListener('click', async () => {
    if (el.classList.contains('read')) return;
    const r = await api('PUT', `/notifications/${el.dataset.notif}/read`);
    if (r.ok) loadNotifications();
  }));
}

// ───────────────────────── Ayarlar formunu doldur ─────────────────────────
function fillSettingsForm() {
  if (!state.me) return;
  const f = $('#f-updateinfo');
  f.name.placeholder = state.me.name || 'Ad';
  f.surname.placeholder = state.me.surname || 'Soyad';
  f.dailyGoal.placeholder = state.me.dailyGoal ?? 20;
  f.timezone.placeholder = state.me.timezone || 'Europe/Istanbul';
  if (state.me.preferences) {
    f.theme.value = state.me.preferences.theme || '';
    f.fontSize.value = state.me.preferences.fontSize || '';
  }
  const ns = state.me.notificationSettings || {};
  $('#ns-dailyReminder').checked = ns.dailyReminder !== false;
  $('#ns-streakReminder').checked = ns.streakReminder !== false;
  $('#ns-wordLevelDown').checked = ns.wordLevelDown !== false;
}

// ───────────────────────── Açılış ─────────────────────────
$('#day-input').value = new Date().toISOString().slice(0, 10);
setTokens(state.access, state.refresh);
