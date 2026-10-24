'use strict';
// 자동 업데이트: 이 파일이 바뀌면 PC 창은 즉시, 폰 앱은 GitHub Pages 배포 후 자동 새로고침
/* 포켓몬 카드 감정소 — 카드 DB: TCGdex (영문 2.3만+ / 일본 1.2만+ / 한글 일부, Cardmarket·TCGplayer 시세 포함)
   이미지 분석: Claude API (브라우저에서 직접 호출, 키는 이 기기 localStorage 에만 저장) */
const TCG = 'https://api.tcgdex.net/v2';
const $ = s => document.querySelector(s);
const main = $('#main'), dlg = $('#dlg');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => n == null || isNaN(n) ? '-' : (Math.round(n) || 0).toLocaleString('ko-KR') + '원';
const store = {
  get(k, d) { try { const v = localStorage.getItem('pk_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pk_' + k, JSON.stringify(v)); return true; } catch { toast('저장 공간이 가득 찼습니다 (스캔 기록을 지워주세요)'); return false; } },
};
const ENGINES = { free: '🆓 무료 글자인식 (키 없음, 상태는 직접 선택)', gemini: '🆓 Gemini 무료 키 (상태 자동 판정)', claude: '💳 Claude (유료, 가장 정확)' };
const cfg = () => Object.assign({ engine: 'free', gkey: '', key: '', model: 'claude-opus-5-5', fee: 13, gradeCost: 50000, eur: 1500, usd: 1380, lang: 'en' }, store.get('cfg', {}));
function toast(m, ms = 3000) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', ms); }
function openDlg(title, html) { $('#dlgT').textContent = title; $('#dlgB').innerHTML = html; if (!dlg.open) dlg.showModal(); }

/* ---------- 네트워크 ---------- */
const fetchT = (u, o = {}, ms = 20000) => fetch(u, { ...o, signal: AbortSignal.timeout(ms) }); // 응답 없으면 무한 대기하지 않도록
const rlog = m => { try { navigator.sendBeacon('/api/log', String(m).slice(0, 1500)); } catch {} }; // PC 서버 app.log 에 남김 (키는 절대 기록 안 함)
async function getJSON(url, tries = 2) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(navigator.onLine ? `카드 DB 서버 응답 오류 (${e.message})` : '인터넷 연결이 끊겼습니다');
      await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
}
const cardCache = new Map();
function getCard(id, lang = 'en') {
  const k = lang + '/' + id;
  if (!cardCache.has(k)) cardCache.set(k, getJSON(`${TCG}/${lang}/cards/${encodeURIComponent(id)}`).catch(e => { cardCache.delete(k); throw e; }));
  return cardCache.get(k);
}
let setsCache = {};
async function getSets(lang = 'en') { return setsCache[lang] ??= getJSON(`${TCG}/${lang}/sets`).then(a => a || []); }
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; try { out[j] = await fn(items[j]); } catch { out[j] = null; } } })); return out; }
const isPocket = id => /^(A\d|B\d|P-A)/.test(id); // TCG Pocket(디지털) 카드는 거래 불가 → 제외
const img = (c, q = 'low') => c?.image ? `${c.image}/${q}.webp` : 'icon-192.png';

/* ---------- 환율 ---------- */
async function loadFx() {
  const fx = store.get('fx', null);
  if (fx && Date.now() - fx.t < 12 * 3600e3) return fx;
  try {
    const d = await getJSON('https://open.er-api.com/v6/latest/KRW', 1);
    const v = { eur: 1 / d.rates.EUR, usd: 1 / d.rates.USD, jpy: 1 / d.rates.JPY, t: Date.now() };
    store.set('fx', v); return v;
  } catch { const c = cfg(); return { eur: c.eur, usd: c.usd, jpy: 9.2, t: 0, fallback: true }; }
}
let FX = { eur: 1500, usd: 1380, jpy: 9.2, fallback: true };
loadFx().then(v => FX = v);

/* ---------- 이름 변환 (한/일 → 영문) ---------- */
let NAMES = null;
async function names() { return NAMES ??= fetch('names.json').then(r => r.json()).catch(() => []); }
async function toEnglish(q) {
  if (!/[ㄱ-힝぀-ヿ一-鿿]/.test(q)) return [q];
  const list = await names(), out = [];
  for (const [en, ko, ja] of list) if ((ko && ko === q) || (ja && ja === q)) out.unshift(en); else if ((ko && ko.includes(q)) || (ja && ja.includes(q))) out.push(en);
  return [...new Set(out)].slice(0, 6);
}
async function koName(en) { const l = await names(); const base = String(en).split(' ')[0]; const r = l.find(x => x[0] === base); return r ? r[1] : ''; }

/* ---------- 레어도 · 점수 · 가격 ---------- */
const RARITY = [ // [키워드, 점수(0~35), 한글 설명, 약호]
  ['mega hyper', 35, '메가 하이퍼 레어 (골드)', 'MUR'], ['hyper', 34, '하이퍼 레어 (골드)', 'UR'], ['special illustration', 33, '스페셜 일러스트 레어', 'SAR'],
  ['shiny ultra', 30, '색이 다른 울트라 레어', 'SSR'], ['secret', 30, '시크릿 레어', 'SR+'], ['crown', 32, '크라운 레어', 'CR'], ['gold', 30, '골드 레어', 'UR'],
  ['illustration', 27, '일러스트 레어', 'AR'], ['ultra', 26, '울트라 레어 (풀아트)', 'SR'], ['full art', 25, '풀아트 트레이너', 'SR'], ['legend', 25, 'LEGEND', 'LEGEND'],
  ['lv.x', 25, 'LV.X', 'LV.X'], ['prime', 22, 'PRIME', 'PRIME'], ['amazing', 20, '어메이징 레어', 'A'], ['radiant', 20, '빛나는 레어', 'K'],
  ['shiny', 22, '색이 다른 레어', 'S'], ['ace spec', 18, 'ACE SPEC', 'ACE'], ['double', 16, '더블 레어', 'RR'], ['vstar', 16, 'V스타', 'RR'], ['vmax', 16, 'V맥스', 'RR'],
  ['holo rare v', 15, '레어 V', 'RR'], ['classic', 18, '클래식 컬렉션', 'CLC'], ['holo', 12, '레어 홀로', 'R'], ['promo', 10, '프로모', 'PR'], ['rare', 9, '레어', 'R'],
  ['uncommon', 4, '언커먼', 'U'], ['common', 2, '커먼', 'C'],
];
function rarityInfo(r) { const s = String(r || '').toLowerCase(); const m = RARITY.find(x => s.includes(x[0])); return m ? { pts: m[1], ko: m[2], code: m[3] } : { pts: 6, ko: r || '미상', code: '?' }; }
const VINTAGE = /^(base|gym|neo|lc|ecard|si|basep|bog|ex\d)/;

function priceOf(c) {
  if (!c) return null;
  const cm = c.pricing?.cardmarket, tp = c.pricing?.tcgplayer;
  const holoOnly = c.variants && !c.variants.normal;
  const pick = (a, b) => holoOnly ? Math.max(a || 0, b || 0) || null : (a || null);
  let eur = null, eurLow = null, eurHolo = null;
  if (cm) {
    eur = pick(cm.trend, cm['trend-holo']) || pick(cm.avg30, cm['avg30-holo']) || pick(cm.avg, cm['avg-holo']);
    eurLow = Math.min(...[cm.avg7, cm.avg30, cm.trend].filter(x => x > 0)) || null;
    if (!isFinite(eurLow)) eurLow = null;
    if (!holoOnly && cm['trend-holo'] > 0) eurHolo = cm['trend-holo'];
  }
  let usd = null;
  if (tp) for (const v of Object.values(tp)) if (v && typeof v === 'object' && (v.marketPrice || v.midPrice)) usd = Math.max(usd || 0, v.marketPrice || v.midPrice);
  const krws = [eur && eur * FX.eur, usd && usd * FX.usd].filter(Boolean);
  if (!krws.length) return { none: true, cm, tp };
  const market = krws.reduce((a, b) => a + b) / krws.length;
  const k = cfg();
  const vintage = VINTAGE.test(c.set?.id || c.id);
  const ri = rarityInfo(c.rarity);
  const modernHit = ri.pts >= 25;
  const m10 = vintage ? 8 : modernHit ? 2.2 : 4, m9 = vintage ? 2.5 : modernHit ? 1.2 : 1.6;
  return {
    market, eur, usd, eurHolo, cmUpdated: cm?.updated,
    buyRef: eurLow ? Math.min(market, eurLow * FX.eur) : market * 0.9, // 구매 기준가 (최근 평균 중 낮은 값)
    buyMax: market * 1.1,                                               // 이 이상이면 비쌈
    sellNet: market * (1 - k.fee / 100),                                // 직거래/마켓 판매 시 순수령 예상
    shopBuy: market * 0.6,                                              // 카드샵 즉시 매입 예상
    psa10: market * m10, psa9: market * m9, vintage,
  };
}
function scoreOf(c, p, grade) {
  const ri = rarityInfo(c?.rarity);
  const pr = p && !p.none ? Math.max(0, Math.min(1, (Math.log10(Math.max(p.market, 1)) - 3) / 4)) * 45 : 0;
  const cond = (grade ? grade / 10 : 0.7) * 20;
  const score = Math.round(ri.pts + pr + cond);
  const tier = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D';
  return { score, tier, parts: { rarity: ri.pts, price: Math.round(pr), cond: Math.round(cond) } };
}

/* ---------- 거래 링크 ---------- */
function links(en, setName, number, ko) {
  const q = encodeURIComponent([en, setName, number].filter(Boolean).join(' '));
  const qn = encodeURIComponent([en, number].filter(Boolean).join(' '));
  const kq = encodeURIComponent(((ko || en) + ' 포켓몬카드').trim());
  const L = [
    ['🇪🇺 Cardmarket', `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(en)}`],
    ['🇺🇸 TCGplayer', `https://www.tcgplayer.com/search/pokemon/product?q=${q}`],
    ['🛒 eBay 판매완료', `https://www.ebay.com/sch/i.html?_nkw=${qn}&LH_Sold=1&LH_Complete=1`],
    ['💎 eBay PSA10', `https://www.ebay.com/sch/i.html?_nkw=${qn}%20PSA%2010&LH_Sold=1&LH_Complete=1`],
    ['📈 PriceCharting', `https://www.pricecharting.com/search-products?q=${qn}&type=prices`],
    ['🇰🇷 번개장터', `https://m.bunjang.co.kr/search/products?q=${kq}`],
    ['🥕 당근', `https://www.daangn.com/kr/buy-sell/?search=${kq}`],
    ['🟢 네이버쇼핑', `https://search.shopping.naver.com/search/all?query=${kq}`],
    ['🇯🇵 메루카리', `https://jp.mercari.com/search?keyword=${encodeURIComponent(en + ' ' + (number || ''))}`],
    ['👟 SNKRDUNK', `https://snkrdunk.com/en/search/result?keyword=${qn}`],
  ];
  return `<div class="links">${L.map(([t, u]) => `<a class="btn" target="_blank" rel="noopener" href="${u}">${t}</a>`).join('')}</div>`;
}

/* ---------- 카드 상세 ---------- */
async function showCard(id, extra = {}) {
  openDlg('불러오는 중…', '<span class="spin"></span>');
  try {
    const c = await getCard(id);
    if (!c) throw new Error('카드 정보를 찾을 수 없습니다');
    $('#dlgT').textContent = `${c.name} · ${c.set?.name} #${c.localId}`;
    $('#dlgB').innerHTML = await cardHTML(c, extra);
  } catch (e) { $('#dlgB').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
async function cardHTML(c, extra = {}) {
  const p = priceOf(c), ri = rarityInfo(c.rarity), grade = extra.grade;
  const sc = scoreOf(c, p, grade), ko = await koName(c.name);
  const k = cfg(), numTxt = `${c.localId}/${c.set?.cardCount?.official ?? '?'}`;
  const gradeAdvice = p && !p.none && grade >= 8.5 && p.psa10 - p.market > k.gradeCost * 2
    ? `<b style="color:var(--ok)">✅ 그레이딩 추천</b> — 예상 PSA10 차익 ${won(p.psa10 - p.market - k.gradeCost)}`
    : p && !p.none && p.market < k.gradeCost ? '❌ 그레이딩 비용이 카드 가치보다 큼 (비추천)' : '△ 상태가 9 이상일 때만 그레이딩 고려';
  const priceRows = p && !p.none ? `
    <tr><th>현재 시세 (시장가)</th><td class="n"><b>${won(p.market)}</b></td><td class="mut">${p.eur ? `Cardmarket €${p.eur.toFixed(2)}` : ''} ${p.usd ? ` · TCGplayer $${p.usd.toFixed(2)}` : ''}</td></tr>
    ${p.eurHolo ? `<tr><th>리버스/홀로 버전</th><td class="n">${won(p.eurHolo * FX.eur)}</td><td class="mut">€${p.eurHolo.toFixed(2)}</td></tr>` : ''}
    <tr><th>🟦 구매 기준가</th><td class="n">${won(p.buyRef)}</td><td class="mut">이 가격 이하면 좋은 매수 · ${won(p.buyMax)} 이상이면 비쌈</td></tr>
    <tr><th>🟩 판매 가능가</th><td class="n">${won(p.sellNet)}</td><td class="mut">마켓 판매 시 수수료 ${k.fee}% 뺀 순수령 예상</td></tr>
    <tr><th>🏪 카드샵 매입가</th><td class="n">${won(p.shopBuy)}</td><td class="mut">즉시 현금화 시 (시세의 약 60%)</td></tr>
    <tr><th>💎 PSA 10 추정</th><td class="n">${won(p.psa10)}</td><td class="mut">${p.vintage ? '빈티지' : '모던'} 배수 추정치 — eBay PSA10 판매기록으로 확인</td></tr>
    <tr><th>PSA 9 추정</th><td class="n">${won(p.psa9)}</td><td></td></tr>
    <tr><td colspan="3" class="mut">시세 갱신: ${p.cmUpdated ? new Date(p.cmUpdated).toLocaleString('ko-KR') : '-'} · 환율 €1=${Math.round(FX.eur)}원 $1=${Math.round(FX.usd)}원</td></tr>`
    : `<tr><td colspan="3" class="err">이 카드는 DB 시세가 없습니다 → 아래 거래 사이트에서 직접 확인하세요.</td></tr>`;
  return `<div class="detail">
    <div><img class="big" src="${img(c, 'high')}" alt="" onerror="this.src='icon-192.png'"></div>
    <div>
      <div class="row"><span class="tier ${sc.tier}">${sc.tier}</span>
        <div><b style="font-size:18px">${esc(c.name)}</b> ${ko ? `<span class="mut">(${esc(ko)})</span>` : ''}<br>
        <span class="mut">${esc(c.set?.name)} · ${numTxt} · ${esc(c.illustrator || '')}</span></div></div>
      <p><span class="tag">레어도: ${esc(ri.ko)} (${ri.code})</span><span class="tag">감정 점수 ${sc.score}/100</span>
        <span class="tag">레어도 ${sc.parts.rarity}/35 · 시세 ${sc.parts.price}/45 · 상태 ${sc.parts.cond}/20</span>
        ${grade ? `<span class="tag">AI 예상 상태 PSA ${grade}</span>` : ''}${c.variants?.firstEdition ? '<span class="tag">1st Edition 있음</span>' : ''}</p>
      <table>${priceRows}</table>
      <p>${gradeAdvice}</p>
      <h3>거래 사이트</h3>${links(c.name, c.set?.name, c.localId, ko)}
      <p class="row" style="margin-top:12px"><button class="pri" onclick='addToCollection(${JSON.stringify(c.id)})'>➕ 내 컬렉션</button>
        <button onclick='addToCollection(${JSON.stringify(c.id)},true)'>⭐ 관심목록</button></p>
    </div></div>`;
}

/* ---------- 카드 그리드 ---------- */
function tiles(list, ownedIds = new Set()) {
  return `<div class="grid">${list.map(c => `<div class="tile" onclick='showCard(${JSON.stringify(c.id)})'>
    ${ownedIds.has(c.id) ? '<span class="own">보유</span>' : ''}
    <img loading="lazy" src="${img(c)}" alt="" onerror="this.src='icon-192.png'">
    <div class="nm">${esc(c.name)}</div><div class="mut">${esc(c.id)}</div>
    ${c._p ? `<div class="pr">${c._p.none ? '시세 없음' : won(c._p.market)}</div>` : ''}</div>`).join('')}</div>`;
}
async function sortByPrice(list, el, max = 120) {
  const target = list.slice(0, max);
  let done = 0;
  await pool(target, 8, async b => { const c = await getCard(b.id); b._p = priceOf(c); b.rarity = c?.rarity; if (++done % 10 === 0) el.innerHTML = `<span class="spin"></span> 시세 불러오는 중 ${done}/${target.length}`; });
  target.sort((a, b) => (b._p?.market || 0) - (a._p?.market || 0));
  return target.concat(list.slice(max));
}

/* ---------- 탭: 이미지 스캔 ---------- */
let scanImgs = [];
function tabScan() {
  const k = cfg();
  main.innerHTML = `
  <div class="box"><h2>📷 이미지로 한번에 감정</h2>
    <p class="mut">카드 앞면(필수) + 뒷면(선택, 상태 판정 정확도↑) 사진을 넣으면 카드 식별 → 레어도·상태 등급·감정 점수·시세·거래 링크를 한번에 보여줍니다. 붙여넣기(Ctrl+V)·드래그도 됩니다.</p>
    <p>분석 방식: <b>${ENGINES[k.engine]}</b> <a href="#" onclick="go('settings')">변경</a></p>
    <div class="row" style="margin-bottom:8px"><button class="pri" id="bGal" style="flex:1;padding:14px">🖼️ 앨범·갤러리에서 선택</button>
      <button class="pri" id="bCam" style="flex:1;padding:14px">📷 지금 촬영</button></div>
    <div id="drop">PC: 여기를 눌러 사진 선택 · 끌어다 놓기 · Ctrl+V (최대 4장, 앞면 먼저)</div>
    <input id="file" type="file" accept="image/*,.heic,.heif" multiple hidden><input id="cam" type="file" accept="image/*" capture="environment" hidden>
    <div class="thumbs" id="thumbs"></div>
    <div class="row"><button class="pri" id="go" disabled>🔍 감정 시작</button><button id="clr">지우기</button><span class="mut" id="st"></span></div>
  </div><div id="res"></div><div id="hist"></div>`;
  const drop = $('#drop'), file = $('#file');
  // capture 가 붙은 입력은 안드로이드에서 카메라만 열리므로, 앨범 선택용 입력을 따로 둠
  drop.onclick = $('#bGal').onclick = () => file.click();
  $('#bCam').onclick = () => $('#cam').click();
  file.onchange = () => { addImgs(file.files); file.value = ''; };
  $('#cam').onchange = e => { addImgs(e.target.files); e.target.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addImgs(e.dataTransfer.files); };
  $('#clr').onclick = () => { scanImgs = []; drawThumbs(); };
  $('#go').onclick = () => analyze();
  drawThumbs(); drawHistory();
}
document.addEventListener('paste', e => { if (cur === 'scan' && e.clipboardData?.files?.length) addImgs(e.clipboardData.files); });
async function addImgs(files) {
  for (const f of [...files].slice(0, 4 - scanImgs.length)) {
    const heic = /hei[cf]$/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
    if (!f.type.startsWith('image/') && !heic) { toast(`${f.name}: 이미지 파일이 아닙니다`); continue; }
    try { scanImgs.push(await shrink(f)); }
    catch {
      try { // 아이폰 HEIC 사진: 브라우저가 못 열면 무료 변환 라이브러리로 JPG 변환
        toast('아이폰 사진(HEIC) 변환 중…');
        if (!window.heic2any) await loadScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
        const jpg = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.9 });
        scanImgs.push(await shrink(Array.isArray(jpg) ? jpg[0] : jpg));
      } catch { toast(`${f.name}: 이 사진 형식은 열 수 없습니다. 사진을 JPG로 저장하거나 화면 캡처 후 다시 선택해 주세요`, 6000); }
    }
  }
  drawThumbs();
}
function shrink(file, max = 1568) { // API 권장 크기로 줄이고 JPEG 로 변환
  return new Promise((ok, bad) => {
    const im = new Image(), url = URL.createObjectURL(file);
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      ok(cv.toDataURL('image/jpeg', 0.9));
    };
    im.onerror = () => { URL.revokeObjectURL(url); bad(); };
    im.src = url;
  });
}
function drawThumbs() {
  $('#thumbs').innerHTML = scanImgs.map((d, i) => `<img src="${d}" title="${i ? '추가 사진' : '앞면'}">`).join('');
  $('#go').disabled = !scanImgs.length;
}
const PROMPT = `너는 포켓몬 카드 감정 전문가다. 사진 속 포켓몬 카드(TCG)를 식별하고 상태를 평가해라.
첫 사진은 앞면, 나머지는 뒷면/확대 사진일 수 있다. 여러 카드가 있으면 가장 크게 보이는 카드 하나만.
반드시 아래 JSON 하나만 출력 (설명 문장·코드블록 금지):
{"is_pokemon_card":true,"name_en":"영문 카드명(예: Charizard ex)","name_local":"카드에 인쇄된 이름","language":"en|ja|ko|zh|other",
"set_name_en":"영문 확장팩명(추정 가능)","set_code":"카드 하단 세트 기호/코드(예: SV3a, sv3pt5, MEW)","number":"카드 번호(예: 199/165)",
"rarity_mark":"인쇄된 레어도 표기(예: SAR, ★, RR)","variant":"normal|holo|reverse|1st_edition|promo|other",
"already_graded":{"is_slab":false,"company":"","grade":"","cert":""},
"condition":{"centering":"좌우/상하 비율(예: 55/45)","centering_score":0,"corners":0,"edges":0,"surface":0,"issues":["한국어로 결함 설명"]},
"estimated_psa_grade":0,"condition_label":"NM|LP|MP|HP|DMG","authenticity":{"suspicious":false,"reasons":["한국어"]},
"confidence":0.0,"notes":"한국어 한두 문장 요약"}
점수(centering_score, corners, edges, surface, estimated_psa_grade)는 1~10. 사진 해상도 한계로 확신이 없으면 보수적으로 낮게.
카드가 아니면 is_pokemon_card=false.`;
async function callClaude(images) {
  const k = cfg();
  const body = {
    model: k.model, max_tokens: 8000, output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: [...images.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } })), { type: 'text', text: PROMPT }] }],
  };
  const fb = /opus-5-5|sonnet-5-5/.test(k.model);
  if (fb) body.fallbacks = 'default'; // 안전필터 거절 시 서버가 다른 모델로 자동 재시도
  const send = ver => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': k.key, 'anthropic-version': ver, 'anthropic-dangerous-direct-browser-access': 'true', ...(fb ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}) },
    body: JSON.stringify(body),
  });
  let r;
  try { r = await send('2026-10-21'); if (r.status === 400) { const t = await r.clone().text(); if (/version/i.test(t)) r = await send('2023-06-01'); } }
  catch { throw new Error(navigator.onLine ? 'Claude API 에 연결할 수 없습니다 (방화벽/네트워크 확인)' : '인터넷 연결이 끊겼습니다'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = d.error?.message || r.statusText;
    throw new Error({ 401: 'API 키가 올바르지 않습니다 (설정에서 확인)', 403: 'API 키 권한이 없습니다', 429: '요청이 너무 많습니다. 잠시 후 다시 시도', 529: 'Claude 서버가 혼잡합니다. 잠시 후 다시 시도', 413: '이미지가 너무 큽니다' }[r.status] || `API 오류 ${r.status}: ${m}`);
  }
  if (d.stop_reason === 'refusal') throw new Error('AI 가 이 이미지 분석을 거절했습니다. 다른 사진으로 시도해 주세요.');
  const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  try { return JSON.parse(text.slice(a, b + 1)); } catch { throw new Error('AI 응답을 해석하지 못했습니다: ' + text.slice(0, 200)); }
}
/* ---- 무료 엔진 1: Gemini 무료 키 ---- */
async function geminiModel(key) {
  const c = store.get('gmodel', null);
  if (c && Date.now() - c.t < 7 * 864e5) return c.m;
  let m = 'gemini-2.5-flash';
  try {
    const r = await fetchT('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    const ok = ((await r.json()).models || []).map(x => x.name.replace('models/', ''))
      .filter(n => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]));
    if (ok[0]) m = ok[0]; // 가장 최신 정식 flash 모델 자동 선택
  } catch {}
  store.set('gmodel', { m, t: Date.now() });
  return m;
}
async function callGemini(images) {
  const key = cfg().gkey;
  const m = await geminiModel(key);
  let r;
  try {
    r = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [...images.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: d.split(',')[1] } })), { text: PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }, 60000);
  } catch (e) { throw new Error(e.name === 'TimeoutError' ? 'Gemini 응답이 없습니다 (60초). 잠시 후 다시 시도하세요' : navigator.onLine ? 'Gemini 에 연결할 수 없습니다 (보안 프로그램/방화벽 확인)' : '인터넷 연결이 끊겼습니다'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) store.set('gmodel', null);
    const msg = d.error?.message || '';
    throw new Error(r.status === 429 ? 'Gemini 무료 사용량을 넘었습니다 (분당/일일 한도). 잠시 후 다시 하거나 "무료 글자인식"을 쓰세요'
      : r.status === 400 && /key/i.test(msg) ? 'Gemini 키가 올바르지 않습니다 (설정에서 확인)' : `Gemini 오류 ${r.status}: ${msg}`);
  }
  if (d.promptFeedback?.blockReason) throw new Error('Gemini 가 이 이미지 분석을 거절했습니다');
  const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  try { return JSON.parse(text.slice(a, b + 1)); } catch { throw new Error('AI 응답을 해석하지 못했습니다: ' + text.slice(0, 200)); }
}

/* ---- 무료 엔진 2: 키 없이 글자인식(OCR) + 번호 매칭 + 그림 비교 ---- */
const loadScript = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('글자인식 모듈을 받지 못했습니다 (인터넷 확인)')); document.head.appendChild(s); });
let ocrWorkers = {};
async function ocr(src, langs, params) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  const key = langs + (params ? '#p' : '');
  ocrWorkers[key] ??= Tesseract.createWorker(langs.split('+')).then(async w => { if (params) await w.setParameters(params); return w; });
  const { data } = await (await ocrWorkers[key]).recognize(src);
  return data.text || '';
}
const NUM_OCR = { tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ', tessedit_pageseg_mode: '11' };
function gray(cv) { // 흑백 + 대비 강화 (작은 번호 글씨 인식률↑)
  const g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const v = p[i] * .3 + p[i + 1] * .59 + p[i + 2] * .11, c = Math.max(0, Math.min(255, (v - 128) * 1.6 + 128)); p[i] = p[i + 1] = p[i + 2] = c; }
  g.putImageData(d, 0, 0); return cv;
}
function crop(img, r, scale = 1) { const cv = document.createElement('canvas'); cv.width = r.w * scale; cv.height = r.h * scale; cv.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height); return cv; }
const loadImg = src => new Promise((ok, bad) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = bad; i.src = src; });
function cardBox(img) { // 배경과 다른 영역 = 카드 위치 (못 찾으면 전체)
  const W = 160, s = W / img.width, H = Math.round(img.height * s), cv = crop(img, { x: 0, y: 0, w: img.width, h: img.height }, s);
  const p = cv.getContext('2d').getImageData(0, 0, W, H).data, at = (x, y) => (y * W + x) * 4;
  let bg = [0, 0, 0], n = 0;
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = at(x, y); bg[0] += p[i]; bg[1] += p[i + 1]; bg[2] += p[i + 2]; n++; }
  bg = bg.map(v => v / n);
  const diff = (x, y) => { const i = at(x, y); return Math.abs(p[i] - bg[0]) + Math.abs(p[i + 1] - bg[1]) + Math.abs(p[i + 2] - bg[2]) > 70; };
  const rowOn = y => { let c = 0; for (let x = 0; x < W; x++) c += diff(x, y); return c > W * 0.25; };
  const colOn = x => { let c = 0; for (let y = 0; y < H; y++) c += diff(x, y); return c > H * 0.25; };
  let t = 0, b = H - 1, l = 0, r = W - 1;
  while (t < b && !rowOn(t)) t++; while (b > t && !rowOn(b)) b--; while (l < r && !colOn(l)) l++; while (r > l && !colOn(r)) r--;
  const box = { x: l / s, y: t / s, w: (r - l + 1) / s, h: (b - t + 1) / s };
  return box.w * box.h > img.width * img.height * 0.2 ? box : { x: 0, y: 0, w: img.width, h: img.height };
}
function signature(img, box) { // 4x6 색 배치 + 9x8 밝기 변화 해시
  const g = crop(img, box, 1), c = document.createElement('canvas'); c.width = 9; c.height = 12;
  c.getContext('2d').drawImage(g, 0, 0, 9, 12);
  const p = c.getContext('2d').getImageData(0, 0, 9, 12).data, gray = [], col = [];
  for (let i = 0; i < p.length; i += 4) { gray.push(p[i] * .3 + p[i + 1] * .59 + p[i + 2] * .11); col.push(p[i], p[i + 1], p[i + 2]); }
  const bits = []; for (let y = 0; y < 12; y++) for (let x = 0; x < 8; x++) bits.push(gray[y * 9 + x] > gray[y * 9 + x + 1]);
  return { bits, col };
}
function sigDist(a, b) {
  let h = 0; a.bits.forEach((v, i) => h += v !== b.bits[i]);
  let d = 0; a.col.forEach((v, i) => d += Math.abs(v - b.col[i]));
  return 0.5 * h / a.bits.length + 0.5 * d / (a.col.length * 255); // 0(같음) ~ 1(다름)
}
async function rerankByImage(photo, cands) {
  try {
    const im = await loadImg(photo), me = signature(im, cardBox(im));
    // 일부 카드 이미지는 원본 서버 CORS 헤더 오류 → PC 서버 중계, 서버 없으면(폰 웹버전) 공개 이미지 변환 서비스
    const candImg = u => loadImg(u).catch(() => loadImg(serverOK ? '/img?u=' + encodeURIComponent(u) : `https://images.weserv.nl/?url=${encodeURIComponent(u.replace('https://', ''))}&w=120&output=png`));
    let n = 0;
    await pool(cands, 12, async c => {
      if (++n % 20 === 0 && $('#st')) $('#st').innerHTML = `<span class="spin"></span> 그림 비교 중 ${n}/${cands.length}`;
      if (!c.image) return; const ci = await candImg(`${c.image}/low.webp`); c._sim = 1 - sigDist(me, signature(ci, { x: 0, y: 0, w: ci.width, h: ci.height })); });
    for (const c of cands) c._sc += (c._sim || 0) * 12; // 그림이 가장 중요한 근거
    cands.sort((a, b) => b._sc - a._sc);
  } catch {}
  return cands;
}
function fixNum(m) { // 번호 글자 오인식 보정 (Z→7, O→0 …), "GG70/GG70" 같은 접두어는 유지
  if (!m) return null;
  const d = t => t.replace(/O/g, '0').replace(/Z/g, '7').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  const pre = (m[2].match(/^[A-Z]+/) || [''])[0];
  const fix = t => pre && t.startsWith(pre) ? pre + d(t.slice(pre.length)) : d(t);
  const a = fix(m[1]), b = fix(m[2]);
  return /^[A-Z]*\d+$/.test(a) && /^[A-Z]*\d+$/.test(b) ? [null, a, b] : null;
}
async function freeIdentify(photo) {
  const im = await loadImg(photo), box = cardBox(im), st = $('#st');
  const part = (y0, y1, x0 = 0, x1 = 1, W = 1200) => crop(im, { x: box.x + box.w * x0, y: box.y + box.h * y0, w: box.w * (x1 - x0), h: box.h * (y1 - y0) }, Math.max(1, W / (box.w * (x1 - x0))));
  st.innerHTML = '<span class="spin"></span> 글자 읽는 중… (처음 한 번은 인식 데이터 다운로드로 30초 정도 걸림)';
  const [top, bl, br] = await Promise.all([ocr(part(0, 0.13), 'eng'), ocr(gray(part(0.88, 1, 0, 0.5, 1400)), 'eng', NUM_OCR), ocr(gray(part(0.88, 1, 0.5, 1, 1400)), 'eng', NUM_OCR)]);
  const all = [top, bl, br].join('\n');
  const nm = fixNum((bl + '\n' + br).match(/([A-Z0-9]{1,6})\s*\/\s*([A-Z0-9]{2,6})/));
  const list = await names();
  // 글자가 붙어 읽혀도(예: "prasdCharizard") 찾도록 띄어쓰기 무시. 여러 이름이 읽히면(예: "Evolves from Charmeleon") 전부 후보로 → 그림 비교로 결정
  const find = txt => { const flat = txt.toLowerCase().replace(/[^a-z]/g, ''), words = ' ' + txt.toLowerCase().replace(/[^a-z]+/g, ' ') + ' ';
    return list.map(x => x[0]).filter(en => { const e = en.toLowerCase().replace(/[^a-z]/g, ''); return e.length >= 4 ? flat.includes(e) : words.includes(` ${e} `); })
      .filter((en, _, arr) => !arr.some(o => o !== en && o.toLowerCase().includes(en.toLowerCase()))); };
  let found = find(top);
  if (!found.length) { st.innerHTML = '<span class="spin"></span> 카드 전체 글자 읽는 중…'; found = find(await ocr(part(0, 1), 'eng')).slice(0, 3); }
  let name = found[0] || '';
  let language = 'en';
  if (!name) { // 한글/일본어 카드일 수 있음
    st.innerHTML = '<span class="spin"></span> 한글·일본어 글자 읽는 중…';
    const t2 = (await ocr(part(0, 0.16), 'kor+jpn')).replace(/\s/g, '');
    const hit = list.filter(x => (x[1] && t2.includes(x[1])) || (x[2] && t2.includes(x[2]))).sort((a, b) => b[1].length - a[1].length)[0];
    if (hit) { name = hit[0]; language = t2.includes(hit[1]) ? 'ko' : 'ja'; }
    else if ((t2.match(/[぀-ヿ]/g) || []).length >= 3) language = 'ja';
    else if ((t2.match(/[가-힣]/g) || []).length >= 3) language = 'ko';
  }
  return { is_pokemon_card: true, _free: true, _evo: /evol/i.test(top), _ocr: all.trim().slice(0, 300), _names: name && !found.length ? [name] : found, name_en: name, name_local: '', language, number: nm ? `${nm[1]}/${nm[2]}` : '', set_name_en: '', confidence: name && nm ? 0.8 : name || nm ? 0.5 : 0.1 };
}

async function matchCard(ai) {
  const num = String(ai.number || '').split('/')[0].replace(/^0+/, '').replace(/[^0-9A-Za-z]/g, '');
  const rawTotal = String(ai.number || '').split('/')[1] || '';
  const total = /[A-Z]/i.test(rawTotal) ? '' : rawTotal.replace(/\D/g, '').replace(/^0+/, ''); // GG70 같은 서브세트 번호는 총장수 비교 안 함
  const bases = (ai._names?.length ? ai._names : [ai.name_en]).map(x => String(x || '').trim()).filter(Boolean), base = bases[0] || '';
  if (!base && !num) return [];
  const sets = await getSets(), setById = Object.fromEntries(sets.map(s => [s.id, s]));
  let hits = (await Promise.all(bases.map(async b => (await getJSON(`${TCG}/en/cards?name=${encodeURIComponent(b)}`)) || (await getJSON(`${TCG}/en/cards?name=${encodeURIComponent(b.split(' ')[0])}`)) || []))).flat();
  // "Evolves from 이브이"만 읽혔으면 진화체(블래키 등)도 후보에 넣고 그림 비교로 결정
  if (ai._evo) hits = hits.concat((await Promise.all(bases.map(b => getJSON(`${TCG}/en/cards?evolveFrom=${encodeURIComponent(b)}`).then(a => a || [])))).flat());
  if (num && (!base || !hits.some(c => String(c.localId).replace(/^0+/, '') === num))) { // 이름이 틀려도 번호/총장수로 찾기
    const byNum = ((await getJSON(`${TCG}/en/cards?localId=${encodeURIComponent(num)}`)) || []).filter(c => {
      const s = setById[c.id.slice(0, c.id.lastIndexOf('-'))]; return !total || String(s?.cardCount?.official) === total;
    });
    hits = hits.concat(byNum);
  }
  const sn = String(ai.set_name_en || '').toLowerCase(), code = String(ai.set_code || '').toLowerCase();
  const scored = [...new Map(hits.map(c => [c.id, c])).values()].filter(c => !isPocket(c.id)).map(c => {
    const sid = c.id.slice(0, c.id.lastIndexOf('-')), s = setById[sid] || {};
    let sc = 0;
    if (num && String(c.localId).replace(/^0+/, '').toLowerCase() === num.toLowerCase()) sc += 5;
    if (total && String(s.cardCount?.official) === total) sc += 3;
    if (sn && s.name && (s.name.toLowerCase().includes(sn) || sn.includes(s.name.toLowerCase()))) sc += 3;
    if (code && sid.toLowerCase().replace(/[^a-z0-9]/g, '') === code.replace(/[^a-z0-9]/g, '')) sc += 2;
    if (bases.some(b => c.name.toLowerCase().includes(b.toLowerCase()))) sc += 2;
    return { ...c, _sc: sc, _set: s.name };
  }).sort((a, b) => b._sc - a._sc);
  return scored.slice(0, 450); // 그림 비교 후 상위 10개만 표시
}

const GRADES = [[10, 'PSA 10 · 흠집 전혀 없음 (Gem Mint)'], [9, 'PSA 9 · 아주 미세한 흠 1개'], [8, 'PSA 8 · 모서리/테두리 미세 하얀점'], [7, 'PSA 7 · NM, 가까이 보면 흠 보임'], [6, 'PSA 6 · 하얀 모서리 여러 개'], [5, 'PSA 5 · LP, 눈에 띄는 마모'], [3, 'PSA 3 · MP, 긁힘/눌림'], [1, 'PSA 1~2 · HP/DMG, 접힘·찢어짐']];
async function analyze(manual) {
  const k = cfg(), st = $('#st'), res = $('#res');
  if (k.engine === 'gemini' && !k.gkey) { toast('설정에서 Gemini 무료 키를 넣거나 "무료 글자인식"을 선택하세요'); return go('settings'); }
  if (k.engine === 'claude' && !k.key) { toast('설정에서 Claude API 키를 넣거나 무료 방식을 선택하세요'); return go('settings'); }
  $('#go').disabled = true; res.innerHTML = ''; analyzing = true;
  try {
    let ai;
    if (manual) ai = { is_pokemon_card: true, _free: true, ...manual };
    else if (k.engine === 'free') ai = await freeIdentify(scanImgs[0]);
    else { st.innerHTML = '<span class="spin"></span> AI 가 카드를 보는 중… (10~40초)'; ai = await (k.engine === 'gemini' ? callGemini : callClaude)(scanImgs); }
    if (!ai.is_pokemon_card) throw new Error('포켓몬 카드로 인식되지 않았습니다. 카드가 화면을 꽉 채우도록 밝은 곳에서 다시 찍어주세요.');
    st.innerHTML = '<span class="spin"></span> 카드 DB 에서 찾고 그림 비교 중…';
    let cands = await matchCard(ai);
    if (scanImgs[0]) cands = await rerankByImage(scanImgs[0], cands);
    cands = cands.slice(0, 10);
    let grade = Number(ai.already_graded?.is_slab ? ai.already_graded.grade : ai.estimated_psa_grade) || null;
    const best = cands[0] ? await getCard(cands[0].id) : null;
    const cond = ai.condition || {};
    const manualBox = `<div class="row" style="margin-top:8px"><input id="mq" placeholder="틀렸으면 직접 입력: 이름 번호 (예: 리자몽 199/165)" style="flex:1;min-width:220px"><button id="mgo">다시 찾기</button></div>`;
    const aiBox = ai._free
      ? `<p>읽은 이름: <b>${esc(ai.name_en || '못 읽음')}</b> · 번호: <b>${esc(ai.number || '못 읽음')}</b> · 일치도 ${cands[0]?._sim != null ? Math.round((cands[0]._sim || 0) * 100) + '%' : '-'}</p>
         <p class="mut">무료 글자인식은 상태(등급)를 판단하지 못합니다 → 아래에서 직접 고르면 점수·예상가가 바뀝니다.</p>`
      : `<p><b>${esc(ai.name_en)}</b> ${ai.name_local && ai.name_local !== ai.name_en ? `(${esc(ai.name_local)})` : ''} · ${esc(ai.set_name_en || '')} ${esc(ai.set_code || '')} · #${esc(ai.number || '?')} · ${esc(ai.rarity_mark || '')} · 언어 ${esc(ai.language)} · 확신도 ${Math.round((ai.confidence || 0) * 100)}%</p>
      <table><tr><th>상태 등급(PSA 기준 추정)</th><td><b>${esc(ai.already_graded?.is_slab ? `${ai.already_graded.company} ${ai.already_graded.grade} (슬랩, 인증번호 ${ai.already_graded.cert || '?'})` : `${ai.estimated_psa_grade} / 10 · ${ai.condition_label}`)}</b></td></tr>
      <tr><th>센터링</th><td>${esc(cond.centering)} (${esc(cond.centering_score)}/10)</td></tr>
      <tr><th>모서리 · 엣지 · 표면</th><td>${esc(cond.corners)} · ${esc(cond.edges)} · ${esc(cond.surface)}</td></tr>
      <tr><th>결함</th><td>${esc((cond.issues || []).join(', ') || '없음')}</td></tr>
      ${ai.authenticity?.suspicious ? `<tr><th>⚠️ 진품 의심</th><td class="err">${esc((ai.authenticity.reasons || []).join(', '))}</td></tr>` : ''}
      <tr><th>메모</th><td>${esc(ai.notes)}</td></tr></table>`;
    res.innerHTML = `<div class="box"><h2>🧾 판정</h2>${aiBox}
      <p class="row">상태 등급: <select id="gsel"><option value="">모름 (PSA 7 가정)</option>${GRADES.map(([g, t]) => `<option value="${g}" ${Math.round(grade) === g ? 'selected' : ''}>${t}</option>`).join('')}</select></p>
      <details class="mut"><summary>상태 직접 확인하는 법</summary>① 앞면 테두리 좌우·상하 폭이 거의 같은가(센터링) ② 네 모서리가 뾰족하고 하얗게 안 닳았나 ③ 뒷면 테두리에 하얀 점(화이트닝) 없나 ④ 빛에 비춰 긁힘·눌림·인쇄선 없나 — 전부 OK면 9~10, 하나라도 눈에 띄면 7 이하</details>
      ${ai.language && ai.language !== 'en' ? `<p class="mut">ℹ️ ${ai.language === 'ja' ? '일본판' : ai.language === 'ko' ? '한글판' : '비영문판'} 카드입니다. 아래 시세는 <b>영문판 기준</b>이라 실제와 다를 수 있습니다 → ${ai.language === 'ja' ? '메루카리·SNKRDUNK' : '번개장터·당근'} 링크로 확인하세요.</p>` : ''}
      ${manualBox}</div>
      <div id="bestBox">${best ? `<div class="box">${await cardHTML(best, { grade })}</div>` : `<div class="box err">카드를 찾지 못했습니다. 위 칸에 이름(+번호)을 직접 입력하거나, 카드가 꽉 차게 다시 찍어주세요.${ai.name_en ? links(ai.name_en, '', ai.number, '') : ''}</div>`}</div>
      ${cands.length > 1 ? `<div class="box"><h3>혹시 이 카드인가요? (다른 후보)</h3>${tiles(cands.slice(1))}</div>` : ''}`;
    $('#gsel').onchange = async e => { grade = +e.target.value || null; if (best) $('#bestBox').innerHTML = `<div class="box">${await cardHTML(best, { grade })}</div>`; };
    const redo = async () => {
      const raw = $('#mq').value.trim(); if (!raw) return;
      const m = raw.match(/^(.*?)\s*#?([A-Z]{0,3}\d{1,3}(?:\/[A-Z]{0,3}\d{2,3})?)?$/i); const nm = (m?.[1] || raw).trim();
      analyze({ name_en: nm ? (await toEnglish(nm))[0] || nm : '', number: m?.[2] || '' });
    };
    $('#mgo').onclick = redo; $('#mq').onkeydown = e => e.key === 'Enter' && redo();
    if (scanImgs[0] && !manual) {
      const thumb = await shrinkData(scanImgs[0], 160);
      const h = store.get('hist', []); h.unshift({ t: Date.now(), thumb, name: best?.name || ai.name_en, id: best?.id, grade, ai });
      store.set('hist', h.slice(0, 30)); drawHistory();
    }
    st.textContent = '완료';
  } catch (e) { res.innerHTML = `<div class="box err">❌ ${esc(e.message)}</div>`; st.textContent = ''; rlog(`analyze ${cfg().engine}: ${e.message}`); }
  finally { $('#go').disabled = !scanImgs.length; analyzing = false; }
}
function shrinkData(d, max) { return new Promise(ok => { const im = new Image(); im.onload = () => { const s = max / Math.max(im.width, im.height), cv = document.createElement('canvas'); cv.width = im.width * s; cv.height = im.height * s; cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); ok(cv.toDataURL('image/jpeg', .7)); }; im.onerror = () => ok(''); im.src = d; }); }
function drawHistory() {
  const h = store.get('hist', []); const el = $('#hist'); if (!el) return;
  el.innerHTML = h.length ? `<div class="box"><div class="row"><h3 style="margin:0 auto 0 0">🕘 최근 감정 기록</h3><button onclick="store.set('hist',[]);drawHistory()">기록 삭제</button></div>
    <div class="grid">${h.map(x => `<div class="tile" ${x.id ? `onclick='showCard(${JSON.stringify(x.id)},{grade:${Number(x.grade) || 0}})'` : ''}><img src="${x.thumb}"><div class="nm">${esc(x.name)}</div><div class="mut">PSA ${esc(x.grade ?? '?')} · ${new Date(x.t).toLocaleDateString('ko-KR')}</div></div>`).join('')}</div></div>` : '';
}

/* ---------- 탭: 카드 검색 ---------- */
let lastSearch = [];
function tabSearch() {
  main.innerHTML = `<div class="box"><h2>🔍 전세계 카드 검색</h2>
    <p class="mut">한글·일본어·영문 포켓몬 이름 모두 가능 (예: 리자몽, ピカチュウ, Umbreon). 번호까지 넣으면 정확해집니다 (예: 리자몽 199).</p>
    <div class="row"><input id="q" placeholder="카드 이름 [번호]" style="flex:1;min-width:200px" value="${esc(store.get('lastQ', ''))}">
    <select id="ql"><option value="en">영문판 DB (시세 있음)</option><option value="ja">일본판 DB</option><option value="ko">한글판 DB</option></select>
    <button class="pri" id="qs">검색</button><button id="qp">💰 가격 높은 순</button></div></div><div id="qr"></div>`;
  const run = async () => {
    const raw = $('#q').value.trim(); if (!raw) return; store.set('lastQ', raw);
    const lang = $('#ql').value, out = $('#qr');
    const m = raw.match(/^(.*?)[\s#]+(\d+)(?:\/\d+)?$/); const name = (m ? m[1] : raw).trim(), num = m?.[2];
    out.innerHTML = '<span class="spin"></span> 검색 중…';
    try {
      const qs = lang === 'en' ? await toEnglish(name) : [name];
      if (!qs.length) { out.innerHTML = '<div class="box err">이름을 찾지 못했습니다. 영문 이름으로 시도해 보세요.</div>'; return; }
      const all = (await Promise.all(qs.map(n => getJSON(`${TCG}/${lang}/cards?name=${encodeURIComponent(n)}${num ? '&localId=' + num : ''}`).then(a => a || [])))).flat();
      lastSearch = [...new Map(all.filter(c => !isPocket(c.id)).map(c => [c.id, c])).values()];
      out.innerHTML = `<p class="mut">${lastSearch.length}장 ${qs[0] !== name ? `(영문명: ${esc(qs.join(', '))})` : ''}</p>` + (lastSearch.length ? tiles(lastSearch, ownedSet()) : '<div class="box err">결과 없음</div>');
    } catch (e) { out.innerHTML = `<div class="box err">${esc(e.message)}</div>`; }
  };
  $('#qs').onclick = run; $('#q').onkeydown = e => e.key === 'Enter' && run();
  $('#qp').onclick = async () => {
    if (!lastSearch.length) await run(); if (!lastSearch.length) return;
    const out = $('#qr'); const n = lastSearch.length;
    lastSearch = await sortByPrice(lastSearch, out);
    out.innerHTML = `<p class="mut">${n}장 · 가격 높은 순 (상위 120장 시세 기준)</p>` + tiles(lastSearch, ownedSet());
  };
}

/* ---------- 탭: 세트 목록 ---------- */
function tabSets() {
  main.innerHTML = `<div class="box"><h2>📚 전체 확장팩 목록</h2><div class="row">
    <select id="sl"><option value="en">영문판</option><option value="ja">일본판</option><option value="ko">한글판</option></select>
    <input id="sf" placeholder="확장팩 이름 필터" style="flex:1"></div></div><div id="sr"><span class="spin"></span></div>`;
  const draw = async () => {
    const lang = $('#sl').value, f = $('#sf').value.toLowerCase();
    try {
      const sets = (await getSets(lang)).filter(s => !isPocket(s.id) && !/^tcgp|^A\d/.test(s.id));
      const owned = ownedSet();
      $('#sr').innerHTML = `<p class="mut">${sets.length}개 확장팩 · 최신순</p><table><tr><th></th><th>확장팩</th><th>ID</th><th class="n">카드 수</th></tr>${[...sets].reverse().filter(s => !f || s.name.toLowerCase().includes(f) || s.id.includes(f)).map(s => `
        <tr style="cursor:pointer" onclick='openSet(${JSON.stringify(s.id)},${JSON.stringify(lang)})'><td>${s.logo ? `<img src="${s.logo}.webp" style="height:26px" loading="lazy" onerror="this.remove()">` : ''}</td>
        <td>${esc(s.name)}</td><td class="mut">${esc(s.id)}</td><td class="n">${s.cardCount?.total ?? '-'}</td></tr>`).join('')}</table>`;
    } catch (e) { $('#sr').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  $('#sl').onchange = draw; $('#sf').oninput = draw; draw();
}
async function openSet(id, lang) {
  openDlg('불러오는 중…', '<span class="spin"></span>');
  try {
    const s = await getJSON(`${TCG}/${lang}/sets/${encodeURIComponent(id)}`);
    const owned = ownedSet(), cards = s.cards || [], have = cards.filter(c => owned.has(c.id)).length;
    $('#dlgT').textContent = `${s.name} (${s.releaseDate || ''})`;
    $('#dlgB').innerHTML = `<div class="row"><div style="flex:1"><div class="bar"><i style="width:${cards.length ? have / cards.length * 100 : 0}%"></i></div>
      <span class="mut">컬렉션 완성도 ${have}/${cards.length}</span></div>${lang === 'en' ? `<button id="sp">💰 가격 높은 순</button>` : ''}</div><div id="sg">${tiles(cards, owned)}</div>`;
    if ($('#sp')) $('#sp').onclick = async () => { const sorted = await sortByPrice(cards, $('#sg'), 400); $('#sg').innerHTML = tiles(sorted, owned); };
  } catch (e) { $('#dlgB').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

/* ---------- 탭: 최고가 카드 ---------- */
const TOP = [ // 공개 경매·보도 기준 대략적 기록 (참고용, 최신 시세는 링크 확인)
  ['Pikachu Illustrator (1998 코로코로 프로모)', null, 'PSA 10 약 $5,275,000 (2022, 기네스 기록)', '전세계 39장 내외. 일러스트레이터 공모전 상품.'],
  ['Charizard 1st Edition (Base Set 4/102)', 'base1-4', 'PSA 10 약 $300,000~420,000 (2020~2022)', '빈티지 대표 카드. 1st Edition 도장 + 그림자 없음'],
  ['Blastoise "Galaxy Star" 프레젠테이션', null, '약 $360,000 (2021, 헤리티지)', '위저드 사 내부 시제품'],
  ['Trophy Pikachu (No.1~3 Trainer)', null, '수십만 달러대 (등급별 상이)', '공식 대회 우승 트로피 카드'],
  ['Shining Charizard 1st Ed (Neo Destiny 107)', 'neo4-107', 'PSA 10 수만 달러대', '샤이닝 시리즈 최고 인기'],
  ['Lugia 1st Edition (Neo Genesis 9)', 'neo1-9', 'PSA 10 $100,000+ (2021~)', '센터링 문제로 PSA10 매우 희귀'],
  ['Rayquaza Gold Star (EX Deoxys 107)', 'ex8-107', 'PSA 10 수천~1만 달러대', '골드스타 시리즈 대표'],
  ['Umbreon VMAX 대체아트 (Evolving Skies 215)', 'swsh7-215', 'PSA 10 수천 달러대', '"문브레온" — 모던 최고 인기'],
  ['Rayquaza VMAX 대체아트 (Evolving Skies 218)', 'swsh7-218', 'PSA 10 수천 달러대', '모던 인기 카드'],
  ['Umbreon ex SAR (Prismatic Evolutions 161)', 'sv08.5-161', 'PSA 10 수천 달러대', '최신 세대 최고가권'],
  ['Charizard ex SAR (151, 199/165)', 'sv03.5-199', 'PSA 10 $1,000 내외', '151 세트 대표 카드'],
];
async function tabTop() {
  main.innerHTML = `<div class="box"><h2>🏆 최고 등급 카드 & 구매 방법</h2>
    <p class="mut">역대 기록가는 공개 경매·보도 기준 <b>대략치</b>입니다. "현재 시세"는 Cardmarket 실시간 (미등급 카드 기준).</p>
    <table id="tt"><tr><th>카드</th><th>역대 기록 (등급 카드)</th><th class="n">현재 시세(미등급)</th><th>구매처</th></tr>
    ${TOP.map(([n, id, rec, note], i) => `<tr><td><b>${i + 1}. ${esc(n)}</b><br><span class="mut">${esc(note)}</span></td><td>${esc(rec)}</td>
      <td class="n" id="tp${i}">${id ? '<span class="spin"></span>' : '-'}</td>
      <td>${id ? `<button onclick='showCard(${JSON.stringify(id)})'>상세·링크</button>` : `<a class="btn" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(n.split('(')[0])}">eBay</a>`}</td></tr>`).join('')}</table></div>
  <div class="box"><h2>🛒 고가 카드 구매 방법 (등급 높은 순)</h2><table>
    <tr><th>등급대</th><th>추천 구매처</th><th>체크포인트</th></tr>
    <tr><td><b>S (수백만원~)</b></td><td><a target="_blank" rel="noopener" href="https://goldin.co/">Goldin</a> · <a target="_blank" rel="noopener" href="https://comics.ha.com/c/search.zx?N=4294942340">Heritage Auctions</a> · <a target="_blank" rel="noopener" href="https://www.fanaticscollect.com/">Fanatics Collect(구 PWCC)</a></td><td>경매 수수료(구매자 프리미엄 약 20%) 포함 가격 계산 · PSA 인증번호를 <a target="_blank" rel="noopener" href="https://www.psacard.com/cert">PSA Cert 조회</a>로 반드시 확인</td></tr>
    <tr><td><b>A (수십만~수백만원)</b></td><td>eBay(Authenticity Guarantee) · TCGplayer · Cardmarket · 국내 번개장터(번개케어)</td><td>등급 카드(슬랩) 구매 권장 · 판매자 평점/판매 이력 · 최근 판매완료가와 비교</td></tr>
    <tr><td><b>B (수만~수십만원)</b></td><td>TCGplayer · Cardmarket · 번개장터 · 오프라인 카드샵</td><td>NM 상태 사진 요청(앞/뒤/모서리) · 구매 기준가 이하인지 확인</td></tr>
    <tr><td><b>C~D (~수만원)</b></td><td>카드샵 싱글 · 당근 · 박스 개봉</td><td>배송비 포함 가격 비교 · 묶음 구매가 유리</td></tr></table>
    <p class="mut">해외 구매 시 관세: 미국 발송 $200 이하 / 그 외 $150 이하 목록통관 면세 (초과 시 관부가세). 고가품은 보험 배송 선택.</p></div>`;
  TOP.forEach(async ([, id], i) => { if (!id) return; try { const p = priceOf(await getCard(id)); $('#tp' + i).innerHTML = p && !p.none ? won(p.market) : '시세 없음'; } catch { const el = $('#tp' + i); if (el) el.textContent = '오류'; } });
}

/* ---------- 탭: 등급 가이드 ---------- */
function tabGuide() {
  main.innerHTML = `<div class="box"><h2>📖 카드 구분 기준</h2><table>
    <tr><th>구분</th><th>내용</th></tr>
    <tr><td>언어/지역</td><td>영문(전세계), 일본판, 한글판, 중국판 등 — 같은 카드라도 언어별 시세가 다름 (일본판 일러스트 카드 인기↑)</td></tr>
    <tr><td>시리즈(세대)</td><td>빈티지(1996~2003 오리지널·네오·e카드) → EX → DP → HGSS → BW → XY → SM → 소드실드 → 스칼렛바이올렛 → 메가 시리즈</td></tr>
    <tr><td>확장팩 + 번호</td><td>카드 하단 "199/165" — 분모보다 번호가 크면 시크릿(고레어)</td></tr>
    <tr><td>레어도</td><td>아래 표 (카드 하단 기호/약호)</td></tr>
    <tr><td>버전</td><td>1st Edition(초판 도장), Shadowless, 일반/리버스홀로/홀로, 프로모(스탬프)</td></tr>
    <tr><td>상태</td><td>미등급: NM(최상)·LP·MP·HP·DMG / 등급: PSA·BGS·CGC 1~10점</td></tr></table></div>
  <div class="box"><h2>💎 레어도 순위 (이 앱 점수, 최대 35)</h2><table><tr><th>약호</th><th>레어도</th><th class="n">점수</th></tr>
    ${RARITY.map(r => `<tr><td>${r[3]}</td><td>${r[2]} <span class="mut">${r[0]}</span></td><td class="n">${r[1]}</td></tr>`).join('')}</table></div>
  <div class="box"><h2>🏅 그레이딩(감정) 회사</h2><table><tr><th>회사</th><th>등급 체계</th><th>특징</th></tr>
    <tr><td><b>PSA</b></td><td>1~10 (10 = Gem Mint)</td><td>거래량·시세 프리미엄 최고. 재판매에 가장 유리</td></tr>
    <tr><td><b>BGS (Beckett)</b></td><td>1~10, 0.5 단위 + 4개 서브등급</td><td>"Black Label 10"(서브 전부 10)은 PSA10보다 비쌈</td></tr>
    <tr><td><b>CGC</b></td><td>1~10, Pristine 10 / Gem Mint 10</td><td>비용 저렴, 빠름</td></tr>
    <tr><td><b>TAG</b></td><td>1~10 + 1000점 정밀점수</td><td>디지털 분석 리포트</td></tr>
    <tr><td><b>SGC</b></td><td>1~10</td><td>빈티지 수집가 선호</td></tr></table>
    <h3>PSA 센터링 기준</h3><table><tr><th>등급</th><th>앞면</th><th>뒷면</th></tr>
    <tr><td>10 Gem Mint</td><td>55/45 이내</td><td>75/25 이내</td></tr><tr><td>9 Mint</td><td>60/40</td><td>90/10</td></tr><tr><td>8 NM-MT</td><td>65/35</td><td>90/10</td></tr></table>
    <p class="mut">미등급 상태 대략 환산: NM ≈ PSA 7~10 · LP ≈ 5~6 · MP ≈ 3~4 · HP/DMG ≈ 1~2</p></div>
  <div class="box"><h2>🧮 이 앱의 감정 점수 · 등급</h2>
    <p><b>감정 점수(100) = 레어도(35) + 시세(45) + 상태(20)</b></p>
    <p>시세 점수: 1천원=0점 ~ 1천만원=45점 (로그 스케일) · 상태 점수: 예상 PSA 등급 × 2 (모르면 7등급 가정)</p>
    <p><span class="tier S">S</span> 85+ <span class="tier A">A</span> 70+ <span class="tier B">B</span> 50+ <span class="tier C">C</span> 30+ <span class="tier D">D</span> 그 외</p>
    <h3>가격 기준</h3><table>
    <tr><td>현재 시세</td><td>Cardmarket 추세가(EUR) · TCGplayer 시장가(USD) 평균 → 원화 (실시간 환율)</td></tr>
    <tr><td>구매 기준가</td><td>최근 7일·30일 평균·추세가 중 가장 낮은 값 — 이 이하면 좋은 매수</td></tr>
    <tr><td>판매 가능가</td><td>시세 × (1 − 수수료%) — 설정에서 수수료 변경</td></tr>
    <tr><td>카드샵 매입가</td><td>시세 × 60%</td></tr>
    <tr><td>PSA10/9 추정</td><td>빈티지 ×8/×2.5 · 모던 고레어 ×2.2/×1.2 · 기타 ×4/×1.6 (추정, 판매기록으로 확인)</td></tr></table></div>`;
}

/* ---------- 탭: 내 컬렉션 ---------- */
const coll = () => store.get('coll', []);
const ownedSet = () => new Set(coll().filter(x => !x.wish).map(x => x.id));
async function addToCollection(id, wish = false) {
  const c = await getCard(id); if (!c) return;
  const p = priceOf(c), list = coll();
  const ex = list.find(x => x.id === id && !!x.wish === wish);
  if (ex) ex.qty = (ex.qty || 1) + (wish ? 0 : 1);
  else list.push({ id, name: c.name, set: c.set?.name, num: c.localId, image: c.image, qty: 1, wish, buy: wish ? 0 : Math.round(p?.market || 0), target: wish ? Math.round(p?.buyRef || 0) : 0, last: p?.market || 0, at: Date.now() });
  store.set('coll', list); toast(wish ? '⭐ 관심목록에 추가 (목표가 도달 시 표시)' : '➕ 컬렉션에 추가');
}
function tabColl() {
  const list = coll(), own = list.filter(x => !x.wish), wish = list.filter(x => x.wish);
  const total = own.reduce((s, x) => s + (x.last || 0) * (x.qty || 1), 0), cost = own.reduce((s, x) => s + (x.buy || 0) * (x.qty || 1), 0);
  const row = (x, i) => { const idx = list.indexOf(x); return `<tr><td><img src="${x.image ? x.image + '/low.webp' : 'icon-192.png'}" style="height:56px" onclick='showCard(${JSON.stringify(x.id)})'></td>
    <td><b>${esc(x.name)}</b><br><span class="mut">${esc(x.set)} #${esc(x.num)}</span></td>
    ${x.wish ? `<td class="n"><input type="number" value="${x.target}" style="width:110px" onchange="editColl(${idx},'target',this.value)"></td><td class="n">${won(x.last)} ${x.last && x.last <= x.target ? '<b style="color:var(--ok)">🎯 목표가 도달!</b>' : ''}</td>`
    : `<td class="n"><input type="number" value="${x.qty}" min="1" style="width:60px" onchange="editColl(${idx},'qty',this.value)"></td>
       <td class="n"><input type="number" value="${x.buy}" style="width:110px" onchange="editColl(${idx},'buy',this.value)"></td>
       <td class="n">${won(x.last)}</td><td class="n" style="color:${x.last >= x.buy ? 'var(--ok)' : 'var(--red)'}">${won((x.last - x.buy) * x.qty)}</td>`}
    <td><button onclick="editColl(${idx},'del')">삭제</button></td></tr>`; };
  main.innerHTML = `<div class="box"><h2>💼 내 컬렉션</h2>
    <div class="row"><div class="box" style="margin:0"><span class="mut">총 평가액</span><br><b style="font-size:20px">${won(total)}</b></div>
    <div class="box" style="margin:0"><span class="mut">매입 합계</span><br><b style="font-size:20px">${won(cost)}</b></div>
    <div class="box" style="margin:0"><span class="mut">손익</span><br><b style="font-size:20px;color:${total >= cost ? 'var(--ok)' : 'var(--red)'}">${won(total - cost)}</b></div></div>
    <div class="row" style="margin-top:8px"><button class="pri" id="cr">🔄 시세 갱신</button><button id="ce">⬇️ CSV 내보내기</button>
    <label class="btn">⬆️ CSV 가져오기<input type="file" id="ci" accept=".csv" hidden></label><span class="mut" id="cs"></span></div>
    <table><tr><th></th><th>카드</th><th class="n">수량</th><th class="n">매입가</th><th class="n">현재 시세</th><th class="n">손익</th><th></th></tr>${own.map(row).join('') || '<tr><td colspan="7" class="mut">카드 상세에서 "➕ 내 컬렉션"을 눌러 추가하세요</td></tr>'}</table></div>
  <div class="box"><h2>⭐ 관심목록 (목표가 알림)</h2><table><tr><th></th><th>카드</th><th class="n">목표 구매가</th><th class="n">현재 시세</th><th></th></tr>${wish.map(row).join('') || '<tr><td colspan="5" class="mut">없음</td></tr>'}</table></div>`;
  $('#cr').onclick = async () => { $('#cs').innerHTML = '<span class="spin"></span>'; const l = coll(); await pool(l, 6, async x => { cardCache.delete('en/' + x.id); const p = priceOf(await getCard(x.id)); if (p && !p.none) x.last = p.market; }); store.set('coll', l); tabColl(); toast('시세 갱신 완료'); };
  $('#ce').onclick = () => {
    const cols = ['id', 'name', 'set', 'num', 'qty', 'buy', 'last', 'wish', 'target'];
    const csv = '﻿' + [cols.join(','), ...coll().map(x => cols.map(k => `"${String(x[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `pokemon-collection-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  $('#ci').onchange = async e => {
    try {
      const [head, ...rows] = (await e.target.files[0].text()).replace(/^﻿/, '').trim().split(/\r?\n/);
      const cols = head.split(','), parse = l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map(v => v.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      const items = rows.map(r => { const v = parse(r), o = {}; cols.forEach((c, i) => o[c] = v[i]); return { ...o, qty: +o.qty || 1, buy: +o.buy || 0, last: +o.last || 0, target: +o.target || 0, wish: o.wish === 'true', image: '' }; }).filter(x => x.id);
      for (const x of items) { const c = await getCard(x.id).catch(() => null); x.image = c?.image || ''; }
      store.set('coll', coll().concat(items)); tabColl(); toast(`${items.length}장 가져옴`);
    } catch (err) { toast('CSV 형식 오류: ' + err.message); }
  };
}
function editColl(i, k, v) { const l = coll(); if (k === 'del') { if (!confirm(`${l[i].name} 삭제할까요?`)) return; l.splice(i, 1); } else l[i][k] = Math.max(0, Number(v) || 0); store.set('coll', l); tabColl(); }

/* ---------- 탭: 설정 ---------- */
function tabSettings() {
  const k = cfg();
  main.innerHTML = `<div class="box"><h2>⚙️ 설정</h2><table>
    <tr><th>분석 방식</th><td><select id="se">${Object.entries(ENGINES).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select><br>
      <span class="mut">무료 글자인식: 키·비용 없음, 카드 이름·번호를 읽고 그림을 비교해 찾음 (상태 등급은 직접 선택)<br>
      Gemini 무료 키: <a target="_blank" rel="noopener" href="https://aistudio.google.com/apikey">aistudio.google.com/apikey</a> 에서 구글 로그인 후 무료 발급 → 상태 등급까지 자동 판정 (하루 사용량 제한 있음, 무료 등급은 구글이 입력 데이터를 서비스 개선에 쓸 수 있음)</span></td></tr>
    <tr class="eng-gemini"><th>Gemini 무료 키</th><td><input id="sgk" type="password" value="${esc(k.gkey)}" placeholder="AIza..." style="width:100%"><br>
      <span class="mut">모델은 무료로 쓸 수 있는 최신 Gemini Flash 가 자동 선택됩니다.</span></td></tr>
    <tr class="eng-claude"><th>Claude API 키 (유료)</th><td><input id="sk" type="password" value="${esc(k.key)}" placeholder="sk-ant-..." style="width:100%"><br>
      <span class="mut"><a target="_blank" rel="noopener" href="https://console.anthropic.com/settings/keys">console.anthropic.com</a> 에서 발급 · 이 기기에만 저장</span></td></tr>
    <tr class="eng-claude"><th>Claude 모델</th><td><select id="sm">
      <option value="claude-opus-5-5">Claude Opus 5.5 (가장 정확, 1회 약 50~150원)</option>
      <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (빠름, 약 30~70원)</option>
      <option value="claude-haiku-5-5">Claude Haiku 5.5 (가장 저렴, 약 2~5원)</option></select></td></tr>
    <tr><th>판매 수수료 %</th><td><input id="sf" type="number" value="${k.fee}" style="width:90px"> <span class="mut">eBay 약 13%, 번개장터 약 3.5%, 직거래 0%</span></td></tr>
    <tr><th>그레이딩 비용</th><td><input id="sg" type="number" value="${k.gradeCost}" style="width:120px"> 원 <span class="mut">(배송·대행비 포함)</span></td></tr>
    <tr><th>환율</th><td>€1 = ${Math.round(FX.eur)}원 · $1 = ${Math.round(FX.usd)}원 ${FX.fallback ? '<span class="mut">(기본값 — 실시간 환율을 아직 못 불러옴)</span>' : '<span class="mut">(실시간)</span>'}</td></tr>
    </table><button class="pri" id="ss">저장</button> <button id="st">🔑 테스트</button> <span id="sr" class="mut"></span></div>
  <div class="box"><h2>📱 핸드폰에서 쓰기</h2><p id="lan" class="mut">PC 서버 연결 확인 중…</p>
    <p class="mut">자세한 안드로이드·아이폰 앱 설치 방법은 폴더의 README.md 참고.</p></div>
  <div class="box"><h2>🧹 데이터</h2><button onclick="if(confirm('스캔 기록·캐시를 지울까요? (컬렉션은 유지)')){store.set('hist',[]);localStorage.removeItem('pk_fx');toast('삭제됨')}">기록·캐시 삭제</button>
    <span class="mut">버전 ${esc(BOOT_VER || 'web')}</span></div>`;
  $('#sm').value = k.model; $('#se').value = k.engine;
  // 고른 분석 방식에 해당하는 칸만 보이게
  const showEng = () => document.querySelectorAll('.eng-gemini,.eng-claude').forEach(tr => tr.style.display = tr.classList.contains('eng-' + $('#se').value) ? '' : 'none');
  $('#se').onchange = showEng; showEng();
  // Gemini 키를 붙여넣으면 분석 방식도 자동으로 Gemini 로
  $('#sgk').oninput = () => { if ($('#sgk').value.trim().startsWith('AIza')) { $('#se').value = 'gemini'; showEng(); } };
  $('#ss').onclick = () => { store.set('cfg', { ...cfg(), engine: $('#se').value, gkey: $('#sgk').value.trim(), key: $('#sk').value.trim(), model: $('#sm').value, fee: +$('#sf').value || 0, gradeCost: +$('#sg').value || 0 }); toast('저장했습니다'); };
  $('#st').onclick = async () => {
    $('#ss').click();
    const c = cfg(), out = (ok, m) => { $('#sr').innerHTML = `<b style="color:${ok ? 'var(--ok)' : 'var(--red)'};font-size:15px">${esc(m)}</b>`; toast(m, 6000); rlog(`key-test ${c.engine}: ${m}`); };
    $('#sr').innerHTML = '<span class="spin"></span> 확인 중… (최대 20초)';
    if (c.engine === 'free') return out(true, '✅ 무료 글자인식은 키가 필요 없습니다');
    const key = c.engine === 'gemini' ? c.gkey : c.key;
    if (!key) return out(false, '❌ 키 칸이 비어 있습니다');
    if (c.engine === 'gemini' && !key.startsWith('AIza')) return out(false, '❌ Gemini 키는 보통 "AIza"로 시작합니다. 복사가 제대로 됐는지 확인하세요');
    try {
      const r = c.engine === 'gemini'
        ? await fetchT('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': key } })
        : await fetchT('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
      if (!r.ok) { const d = await r.json().catch(() => ({})); return out(false, `❌ ${[400, 401, 403].includes(r.status) ? '키가 올바르지 않음' : '오류 ' + r.status} ${d.error?.message ? '(' + d.error.message.slice(0, 80) + ')' : ''}`); }
      out(true, '✅ 키 정상' + (c.engine === 'gemini' ? ` · 모델 ${await geminiModel(key)} · 이제 이미지 감정 탭에서 사용하세요` : ''));
    } catch (e) { out(false, e.name === 'TimeoutError' || e.name === 'AbortError' ? '❌ 20초 동안 응답 없음 — 백신/보안 프로그램이나 방화벽이 연결을 막는지 확인하세요' : '❌ 연결 실패 (인터넷·보안 프로그램 확인)'); }
  };
  $('#lan').innerHTML = `<button class="pri" onclick="showPhone()">📱 폰 연결 QR코드 보기</button>
    <p class="mut">📲 폰 앱: <b>https://simjc77.github.io/</b> — 어디서나 사용 가능. 앱이 바뀌면 PC·폰 모두 자동으로 최신 버전이 됩니다 (버튼 누를 필요 없음).</p>`;
}

/* ---------- 폰 연결 (같은 Wi-Fi, 무료) ---------- */
async function showPhone() {
  openDlg('📱 핸드폰에서 쓰기', '<span class="spin"></span>');
  try {
    const d = await (await fetchT('/api/beat', {}, 5000)).json();
    if (d.web) throw new Error('web'); // 어디서나 되는 웹 주소가 있으면 그 QR을 보여줌
    if (!window.QRCode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
    $('#dlgB').innerHTML = `<div style="text-align:center"><div id="qr" style="display:inline-block;padding:12px;background:#fff"></div>
      <p style="font-size:20px"><b>${esc(d.lan)}</b></p>
      <p>① 폰을 이 PC와 <b>같은 Wi-Fi</b>에 연결 → ② 폰 카메라로 QR 찍기 → ③ 열린 페이지에서<br>
      안드로이드(크롬): ⋮ → <b>홈 화면에 추가</b> · 아이폰(사파리): 공유 버튼 → <b>홈 화면에 추가</b></p>
      <p class="mut">PC에서 앱이 켜져 있어야 합니다(창은 닫아도 됨). 폰에서 촬영 버튼으로 바로 카드 사진을 찍을 수 있습니다.<br>
      안 열리면: 폰이 모바일데이터가 아닌 같은 Wi-Fi인지 확인. 주소(IP)는 공유기가 바꿀 수 있어 이 창에서 늘 최신 QR이 보입니다.</p></div>`;
    new QRCode($('#qr'), { text: d.lan, width: 220, height: 220 });
  } catch {
    const url = isPC && window.WEB_URL ? window.WEB_URL : location.origin + location.pathname;
    try { if (!window.QRCode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'); } catch {}
    $('#dlgB').innerHTML = `<div style="text-align:center"><div id="qr" style="display:inline-block;padding:12px;background:#fff"></div><p style="font-size:18px"><b>${esc(url)}</b></p>
      <p>이 주소는 어디서나(LTE/5G 포함) 열립니다. 안드로이드: ⋮ → <b>홈 화면에 추가/앱 설치</b> · 아이폰(사파리): 공유 → <b>홈 화면에 추가</b></p></div>`;
    if (window.QRCode) new QRCode($('#qr'), { text: url, width: 220, height: 220 });
  }
}

/* ---------- 라우팅 ---------- */
const TABS = { scan: ['📷 이미지 감정', tabScan], search: ['🔍 카드 검색', tabSearch], sets: ['📚 확장팩', tabSets], top: ['🏆 최고가·구매', tabTop], guide: ['📖 등급 기준', tabGuide], coll: ['💼 컬렉션', tabColl], settings: ['⚙️ 설정', tabSettings] };
let cur = 'scan', BOOT_VER = null, LOADED = Date.now() / 1000, serverOK = false;
function go(t) { cur = TABS[t] ? t : 'scan'; store.set('tab', cur); $('#nav').innerHTML = Object.entries(TABS).map(([k, [n]]) => `<button class="${k === cur ? 'on' : ''}" onclick="go('${k}')">${n}</button>`).join(''); TABS[cur][1](); }
go(store.get('tab', 'scan'));

/* ---------- 자동 업데이트 (버튼 없음) · 단일 창 ---------- */
// 새 버전이 감지되면 사용 중이 아닐 때(분석 중·팝업·입력 중 아님) 자동 새로고침. PC는 서버 신호로, 폰 웹앱은 version.json 으로 감지
let analyzing = false, pendingUpdate = false;
const busy = () => analyzing || dlg.open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
async function applyUpdate() {
  try { sessionStorage.setItem('pk_updated', '1'); } catch {}
  try { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(regs.map(r => r.update())); } catch {}
  try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
  location.reload();
}
function gotVersion(v) {
  if (!v) return;
  if (!BOOT_VER) { BOOT_VER = v; $('#ver').textContent = 'v' + v; return; }
  if (v !== BOOT_VER) pendingUpdate = true;
  if (pendingUpdate && !busy()) applyUpdate();
}
let beatFails = 0;
async function beat() {
  try {
    const r = await fetch('/api/beat', { cache: 'no-store' }); if (!r.ok) throw new Error('no server');
    const d = await r.json();
    serverOK = true; beatFails = 0; window.WEB_URL = d.web;
    gotVersion(d.version);
    if (d.cmd === 'focus' && d.cmdAt > LOADED) { LOADED = d.cmdAt; window.focus(); toast('이미 실행 중인 창입니다 👋'); }
  } catch { if (serverOK && ++beatFails === 5) toast('PC 서버 연결이 끊겼습니다 — 바탕화면 아이콘으로 다시 실행해 주세요', 6000); } // 자동 재시작 중 잠깐 끊기는 건 무시
}
async function webVersion() { try { const d = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json(); gotVersion(d.v); } catch {} }
try { if (sessionStorage.getItem('pk_updated')) { sessionStorage.removeItem('pk_updated'); setTimeout(() => toast('✨ 새 버전으로 자동 업데이트됐습니다'), 500); } } catch {}
if (location.protocol.startsWith('http')) {
  beat().then(() => {
    if (serverOK) setInterval(beat, 3000);
    else { webVersion(); setInterval(webVersion, 60000); document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && webVersion()); }
  });
  setInterval(() => pendingUpdate && !busy() && applyUpdate(), 2000); // 사용 중이라 미뤘던 업데이트를 끝나면 적용
}

/* ---------- 폰 홈 화면 설치 버튼 ---------- */
let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isPC = ['127.0.0.1', 'localhost'].includes(location.hostname);
const bI = $('#bInstall');
if (!standalone() && !isPC) bI.hidden = false;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!isPC) bI.hidden = false; });
addEventListener('appinstalled', () => { bI.hidden = true; toast('📲 홈 화면에 설치됐습니다'); });
bI.onclick = async () => {
  if (installEvt) { installEvt.prompt(); const { outcome } = await installEvt.userChoice; installEvt = null; if (outcome === 'accepted') bI.hidden = true; return; }
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent), https = location.protocol === 'https:';
  openDlg('📲 홈 화면에 설치', `<div style="font-size:16px;line-height:1.8">
    ${!https ? `<p class="err">이 주소(http)는 설치용이 아닙니다. 어디서나 되는 <a href="https://simjc77.github.io/">https://simjc77.github.io/</a> 에서 설치하세요.</p>` : ''}
    ${ios ? `<p><b>아이폰 (사파리에서 열어야 함)</b><br>① 화면 아래 <b>공유 버튼 ⬆️</b> → ② <b>홈 화면에 추가</b> → ③ 오른쪽 위 <b>추가</b></p><p class="mut">카카오톡 등 앱 안에서 열었다면 먼저 "Safari로 열기"</p>`
      : `<p><b>안드로이드</b><br>① 오른쪽 위 <b>⋮</b> 메뉴 → ② <b>앱 설치</b> 또는 <b>홈 화면에 추가</b> → ③ <b>설치</b></p><p class="mut">삼성 인터넷: 아래 메뉴 ☰ → 페이지 추가 → 홈 화면 · 카카오톡 안이면 먼저 "다른 브라우저로 열기"</p>`}
    <p class="mut">설치 후에는 앱이 바뀔 때마다 자동으로 최신 버전으로 업데이트됩니다.</p></div>`);
};

// 같은 앱 창이 여러 개 열리면 예전 창은 스스로 닫힘
try {
  const bc = new BroadcastChannel('pokecard'), me = Date.now();
  bc.onmessage = e => { if (e.data?.hello && e.data.t > me) { window.close(); setTimeout(() => { document.body.innerHTML = '<p style="padding:40px">새 창에서 실행 중입니다. 이 창은 닫아도 됩니다.</p>'; }, 300); } };
  bc.postMessage({ hello: 1, t: me });
} catch {}
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
window.addEventListener('unhandledrejection', e => { toast('오류: ' + (e.reason?.message || e.reason)); rlog('unhandled: ' + (e.reason?.stack || e.reason)); });
window.addEventListener('error', e => rlog(`error: ${e.message} @${e.filename}:${e.lineno}`));
