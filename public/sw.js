// DG Flow 서비스 워커 — 홈 화면에 설치한 앱으로 뜨게 하는 최소한만 둔다.
// 화면을 저장해 두지 않는다(늘 서버의 최신 화면을 받는다) — 수량이 낡은 화면에 보이면 안 되기 때문이다.
// 나중에 폰 알림(push)을 붙일 때 이 파일에 push · notificationclick 을 더한다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
