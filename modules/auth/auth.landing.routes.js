// E-postadaki linklerin indiği tarayıcı sayfaları — /api DIŞINDA, HTML döner.
//
// Mail istemcilerinin link tarayıcıları (Gmail prefetch, Outlook SafeLinks)
// GET linklerini kullanıcı tıklamadan takip edebilir; bu yüzden bu sayfalar
// YAN ETKİSİZDİR. Doğrulama/sıfırlama, kullanıcının sayfada tetiklediği
// POST /api/auth/... çağrısıyla TAMAMEN WEB'DE yapılır (ürün kararı: deep link
// yok). Kullanıcı sonrasında uygulamaya kendisi döner; uygulama
// /auth/verification-status ile durumu öğrenir.
//
// Tasarım: uygulamanın Giriş Ekranları tasarımıyla aynı dil — renkler Figma'dan
// örneklendi (#bc002d marka, #f2ccd5 ikon dairesi, #1d9e75 başarı). Açık/koyu
// tema ve TR/EN desteklenir. Ortak kabuk ve palet utils/webPage.js'te; burada
// yalnızca bu iki sayfaya özel CSS var.
const express = require('express');
const AuthService = require('./auth.service');
const { generalLimiter } = require('../../middlewares/rateLimiter');
const { t, langFromRequest, maskEmail } = require('../../utils/i18n');
const { RULE_PATTERNS } = require('../../utils/password.util');
const { esc, sendPage, BRAND_BAR } = require('../../utils/webPage');

const router = express.Router();
router.use(generalLimiter);

// crypto.randomBytes(20).toString('hex') → 40 hex karakter. Uymayan token
// DB'ye hiç sorulmadan reddedilir; HTML'e yalnızca bu desenden geçen değer
// gömüldüğü için XSS riski de kalmaz.
const TOKEN_RE = /^[0-9a-f]{40}$/;

/* ---------------------------------------------------------------- ikonlar */
// Satır içi SVG: CSP script değil markup saydığı için ek izin gerekmez,
// currentColor sayesinde tema değişince kendiliğinden uyar
const ICON = {
    mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="m3 7 8.2 5.6a1.5 1.5 0 0 0 1.6 0L21 7"/></svg>`,
    mailX: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 11V7.5a3 3 0 0 0-3-3h-13a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3H12"/><path d="m3 7 8.2 5.6a1.5 1.5 0 0 0 1.6 0L21 7"/><path d="m16.5 16.5 5 5m0-5-5 5"/></svg>`,
    key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="4.5"/><path d="M11.2 11.2 20 20m-3-3 2.2-2.2M20 20l1.5-1.5"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.5"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5 20 20"/><path d="M9.9 6c.7-.2 1.4-.3 2.1-.3 6 0 9.5 6.3 9.5 6.3a15 15 0 0 1-3.3 3.9M6.4 8.1A15 15 0 0 0 2.5 12S6 18.3 12 18.3c1.2 0 2.2-.2 3.2-.6"/><path d="M10 10.2a2.7 2.7 0 0 0 3.8 3.8"/></svg>`
};

/* ------------------------------------------- bu iki sayfaya özel css */
const CSS = `
.card{
  background:var(--surface); border:1px solid var(--line); border-radius:22px;
  padding:36px 26px 30px; width:100%; max-width:410px;
  box-shadow:var(--shadow); text-align:center;
}
.halo{
  width:78px;height:78px;border-radius:50%;background:var(--halo);
  display:flex;align-items:center;justify-content:center;margin:0 auto 20px;
  color:var(--accent);
}
.halo svg{width:36px;height:36px}
.halo.ok{background:rgba(29,158,117,.14);color:var(--ok)}
.mail-chip{
  display:inline-block;margin-top:12px;padding:7px 14px;border-radius:999px;
  background:var(--field);border:1px solid var(--line);
  font-size:13.5px;font-weight:600;color:var(--text2);word-break:break-all;
}
.stack{margin-top:24px;display:flex;flex-direction:column;gap:11px}
.field{position:relative;display:flex;align-items:center}
/* Sınıf <span>'de, ikon içinde: seçici span'i hedefler, boyutu svg'ye verir.
   (svg.lead-ico yazılırsa hiç eşleşmez ve ikon boyutsuz kalıp devleşir) */
.field .lead-ico{
  position:absolute;left:14px;display:flex;color:var(--muted);pointer-events:none;
}
.field .lead-ico svg{width:19px;height:19px}
input{
  width:100%;padding:14px 46px 14px 42px;border-radius:14px;
  border:1.5px solid var(--line);background:var(--field);color:var(--text);
  font-size:16px;font-family:inherit;transition:border-color .15s ease;
}
input::placeholder{color:var(--muted)}
input:focus{outline:none;border-color:var(--accent)}
.eye{
  position:absolute;right:8px;width:34px;height:34px;border:0;background:none;
  color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;
  border-radius:9px;
}
.eye svg{width:20px;height:20px}
/* güç göstergesi — uygulamadaki 4 çubukla aynı */
.meter{display:flex;gap:6px;margin-top:2px}
.meter i{flex:1;height:5px;border-radius:99px;background:var(--line);transition:background .2s ease}
.hint{font-size:12.5px;line-height:1.5;text-align:left;color:var(--muted);min-height:17px}
.hint.s1{color:var(--brand)} .hint.s2{color:var(--warn)}
.hint.s3{color:var(--mid)}   .hint.s4{color:var(--ok)}
.msg{padding:13px 15px;border-radius:13px;font-size:14px;line-height:1.5;margin-top:16px;text-align:left}
.msg.err{background:rgba(188,0,45,.09);color:var(--accent)}
.spinner{
  width:17px;height:17px;border:2.2px solid rgba(255,255,255,.4);
  border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}
`;

/* ------------------------------------------------------------------ kabuk */
// Bu iki sayfa da tek bir kart: marka başlığı + içerik. Ortak kabuk
// (palet, CSP nonce, dil bağlantısı) utils/webPage.js'ten gelir.
const sendCard = (req, res, { lang, title, body, script }) =>
    sendPage(req, res, {
        lang, title, script, css: CSS,
        body: `<main class="card fade">${BRAND_BAR}\n  ${body}\n</main>`
    });

const invalidLinkPage = (req, res, lang) => {
    const s = t(lang);
    return sendCard(req, res, {
        lang,
        title: s.invalidTitle,
        body: `
  <div class="halo">${ICON.mailX}</div>
  <h1>${esc(s.invalidHeading)}</h1>
  <p class="lead">${esc(s.invalidText)}</p>`
    });
};

/* --------------------------------------------------------------- sayfalar */
router.get('/verify-email/:token', async (req, res, next) => {
    try {
        const lang = langFromRequest(req);
        const s = t(lang);
        const { token } = req.params;

        const email = TOKEN_RE.test(token)
            ? await AuthService.findVerificationTokenOwner(token)
            : null;
        if (!email) return invalidLinkPage(req, res, lang);

        sendCard(req, res, {
            lang,
            title: s.verifyPageTitle,
            body: `
  <div class="halo" id="icon">${ICON.mail}</div>
  <h1 id="title">${esc(s.verifyHeading)}</h1>
  <p class="lead" id="lead">${esc(s.verifyLead)}</p>
  <div class="mail-chip" id="chip">${esc(maskEmail(email))}</div>
  <div class="stack">
    <button class="btn" id="verify-btn">${esc(s.verifyBtn)}</button>
  </div>
  <div id="msg"></div>`,
            script: `
var btn=document.getElementById('verify-btn'),msg=document.getElementById('msg');
var L=${JSON.stringify({
                busy: s.verifyBtnBusy, label: s.verifyBtn, err: s.verifyErr, net: s.netErr,
                okTitle: s.verifyOkHeading, okText: s.verifyOkText, ok: ICON.check
            })};
function fail(m){btn.disabled=false;btn.innerHTML='';btn.textContent=L.label;
  msg.className='msg err';msg.textContent=m;}
btn.addEventListener('click',function(){
  btn.disabled=true;msg.className='';msg.textContent='';
  btn.innerHTML='<span class="spinner"></span>'+L.busy;
  fetch('/api/auth/verify-email',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:'${token}'})})
   .then(function(r){return r.json().catch(function(){return{};}).then(function(j){
     if(r.ok){
       document.getElementById('icon').className='halo ok';
       document.getElementById('icon').innerHTML=L.ok;
       document.getElementById('title').textContent=L.okTitle;
       document.getElementById('lead').textContent=L.okText;
       document.getElementById('chip').classList.add('hidden');
       btn.parentNode.classList.add('hidden');
       document.querySelector('.card').classList.remove('fade');
       void document.querySelector('.card').offsetWidth;
       document.querySelector('.card').classList.add('fade');
     } else { fail(j.message||L.err); }
   });})
   .catch(function(){fail(L.net);});
});`
        });
    } catch (err) { next(err); }
});

router.get('/reset-password/:token', async (req, res, next) => {
    try {
        const lang = langFromRequest(req);
        const s = t(lang);
        const { token } = req.params;

        const email = TOKEN_RE.test(token)
            ? await AuthService.findResetTokenOwner(token)
            : null;
        if (!email) return invalidLinkPage(req, res, lang);

        sendCard(req, res, {
            lang,
            title: s.resetPageTitle,
            body: `
  <div class="halo" id="icon">${ICON.key}</div>
  <h1 id="title">${esc(s.resetHeading)}</h1>
  <p class="lead" id="lead">${esc(s.resetLead)}</p>
  <div class="mail-chip" id="chip">${esc(maskEmail(email))}</div>
  <form id="reset-form" class="stack">
    <div>
      <div class="field">
        <span class="lead-ico">${ICON.key}</span>
        <input type="password" name="p1" id="p1" placeholder="${esc(s.resetPlaceholder)}"
               autocomplete="new-password" required>
        <button type="button" class="eye" id="eye1" aria-label="${esc(s.showPassword)}">${ICON.eye}</button>
      </div>
      <div class="meter" id="meter"><i></i><i></i><i></i><i></i></div>
    </div>
    <div class="hint" id="hint"></div>
    <div class="field">
      <span class="lead-ico">${ICON.key}</span>
      <input type="password" name="p2" id="p2" placeholder="${esc(s.resetPlaceholder2)}"
             autocomplete="new-password" required>
      <button type="button" class="eye" id="eye2" aria-label="${esc(s.showPassword)}">${ICON.eye}</button>
    </div>
    <button class="btn" type="submit" id="submit-btn">${esc(s.resetSubmit)}</button>
  </form>
  <div id="msg"></div>`,
            script: `
var f=document.getElementById('reset-form'),msg=document.getElementById('msg');
var p1=document.getElementById('p1'),p2=document.getElementById('p2');
var meter=document.getElementById('meter').children,hint=document.getElementById('hint');
var sb=document.getElementById('submit-btn');
var L=${JSON.stringify({
                busy: s.resetSubmitBusy, label: s.resetSubmit, err: s.resetErr, net: s.netErr,
                mismatch: s.mismatch, strength: s.strength,
                rules: [s.ruleLength, s.ruleUpperDigit, s.ruleUpperDigit, s.ruleSpecial],
                okTitle: s.resetOkHeading, okText: s.resetOkText, ok: ICON.check,
                eye: ICON.eye, eyeOff: ICON.eyeOff
            })};
// Kural desenleri sunucudaki utils/password.util.js'ten gelir — gösterge ile
// sunucu doğrulaması asla ayrışmaz
var SPECS=${JSON.stringify(RULE_PATTERNS)};
var COLORS=['var(--brand)','var(--warn)','var(--mid)','var(--ok)'];

function passed(v){
  var n=0;
  for(var i=0;i<SPECS.length;i++){
    var ok=SPECS[i].minLength!==undefined
      ? v.length>=SPECS[i].minLength
      : new RegExp(SPECS[i].source,SPECS[i].flags||'').test(v);
    if(!ok) return {count:n,firstFail:i};
    n++;
  }
  return {count:n,firstFail:-1};
}
function draw(){
  var v=p1.value,r=passed(v);
  for(var i=0;i<4;i++) meter[i].style.background = i<r.count ? COLORS[r.count-1] : 'var(--line)';
  hint.className='hint'+(v?' s'+r.count:'');
  hint.textContent = !v ? '' : (r.firstFail>=0 ? L.rules[r.firstFail] : L.strength[3]);
  sb.disabled = !(r.count===4 && p2.value && p1.value===p2.value);
}
p1.addEventListener('input',draw); p2.addEventListener('input',draw); draw();

function toggle(inp,btn){btn.addEventListener('click',function(){
  var show=inp.type==='password'; inp.type=show?'text':'password';
  btn.innerHTML=show?L.eyeOff:L.eye; inp.focus();});}
toggle(p1,document.getElementById('eye1')); toggle(p2,document.getElementById('eye2'));

f.addEventListener('submit',function(e){
  e.preventDefault(); msg.className=''; msg.textContent='';
  if(p1.value!==p2.value){msg.className='msg err';msg.textContent=L.mismatch;return;}
  sb.disabled=true; sb.innerHTML='<span class="spinner"></span>'+L.busy;
  // deviceName bilerek gönderilmez: tarayıcı için oturum açılmaz,
  // kullanıcı uygulamadan yeni şifresiyle giriş yapar
  fetch('/api/auth/reset-password',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:'${token}',password:p1.value})})
   .then(function(r){return r.json().catch(function(){return{};}).then(function(j){
     if(r.ok){
       document.getElementById('icon').className='halo ok';
       document.getElementById('icon').innerHTML=L.ok;
       document.getElementById('title').textContent=L.okTitle;
       document.getElementById('lead').textContent=L.okText;
       document.getElementById('chip').classList.add('hidden');
       f.classList.add('hidden');
       var c=document.querySelector('.card');
       c.classList.remove('fade'); void c.offsetWidth; c.classList.add('fade');
     } else {
       sb.disabled=false; sb.innerHTML=''; sb.textContent=L.label;
       msg.className='msg err'; msg.textContent=j.message||L.err;
     }
   });})
   .catch(function(){sb.disabled=false;sb.innerHTML='';sb.textContent=L.label;
     msg.className='msg err';msg.textContent=L.net;});
});`
        });
    } catch (err) { next(err); }
});

module.exports = router;
