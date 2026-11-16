'use client';

import { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';

/** 서비스 워커 등록 — 운영에서만 (개발 서버에서는 화면 갱신을 방해하지 않게 두지 않는다) */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 설치가 안 될 뿐 화면은 그대로 쓴다 */ });
  }, []);
  return null;
}

interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

/**
 * 홈 화면에 앱으로 설치 — 폰 메뉴 아래쪽에만 보인다. 이미 앱으로 열었으면 안 보인다.
 *  · 안드로이드(크롬 · 삼성 인터넷): 브라우저가 설치할 수 있다고 알려 오면 버튼을 띄운다.
 *  · 아이폰(사파리): 설치 창을 띄울 방법이 없어 누르는 순서를 글로 알린다.
 */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent); };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (prompt) {
    return (
      <button type="button" onClick={async () => { await prompt.prompt(); await prompt.userChoice.catch(() => null); setPrompt(null); }}
        className="mb-1 flex h-11 w-full items-center gap-2 rounded-lg bg-brand-50 px-3 text-sm font-semibold text-brand-800 ring-1 ring-brand-600/20 md:hidden">
        <Download className="h-4 w-4" />홈 화면에 앱으로 설치
      </button>
    );
  }
  if (ios) {
    return (
      <p className="mb-1 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-brand-900 ring-1 ring-brand-600/20 md:hidden">
        <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>앱처럼 쓰려면 아래 <b>공유</b> 버튼을 누르고 <b>홈 화면에 추가</b>를 고르세요.</span>
      </p>
    );
  }
  return null;
}
