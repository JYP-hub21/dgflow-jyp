import type { MetadataRoute } from 'next';

/**
 * 홈 화면에 앱으로 설치할 때 쓰는 정보 (2026-11-16 사용자 "폰 화면 편리하게 … 나중에 발주서 도착하면 폰으로도 알림 가게").
 * 폰 브라우저의 '홈 화면에 추가' 로 깔면 주소창 없이 앱처럼 뜬다. 폰 알림(push)은 이렇게 설치한 앱이어야 보낼 수 있다(아이폰).
 * 아이콘은 components/layout/Logo.tsx 의 마크를 그대로 PNG 로 만든 것(public/icons).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DG Flow · 동일유리(주)',
    short_name: 'DG Flow',
    description: '동일유리(주) 발주 · 생산 관리',
    lang: 'ko',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F6F8',
    theme_color: '#22405C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // 아이콘을 길게 눌렀을 때 바로 가는 곳
    shortcuts: [
      { name: '작업의뢰서', url: '/work-orders' },
      { name: '생산 현황', url: '/production' },
      { name: '납품', url: '/deliveries' },
    ],
  };
}
