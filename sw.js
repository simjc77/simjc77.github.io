// 네트워크 우선: 수정한 앱 파일이 바로 반영되고, 오프라인일 때만 캐시 사용
const C = 'pokecard-v2';
// PC 서버가 꺼졌을 때 보여줄 화면: 2초마다 재접속 시도, 서버가 켜지면 자동 새로고침
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>포켓몬 카드 감정소</title><body style="font-family:'Malgun Gothic',sans-serif;text-align:center;padding:60px 16px">
<h2>⏸️ 앱 서버가 꺼져 있습니다</h2><p>바탕화면의 <b>포켓몬 카드 감정소</b> 아이콘을 누르면 이 창이 자동으로 다시 열립니다.</p>
<p id="s" style="color:#888">재연결 대기 중…</p>
<script>setInterval(async()=>{try{if((await fetch('/api/beat',{cache:'no-store'})).ok)location.reload()}catch{}},2000)</script>`;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/img') return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; })
    .catch(async () => (await caches.match(e.request))
      || (e.request.mode === 'navigate' ? new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : Response.error())));
});
