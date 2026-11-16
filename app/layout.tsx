import type { Metadata } from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { RegisterServiceWorker } from '@/components/layout/AppShell';

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'DG Flow · 동일유리(주)',
  description: '동일유리(주) 발주 · 생산 관리 — 발주서 접수, ERP 업로드 엑셀, 작업의뢰서, 생산 실적과 복층생산일지',
  // 홈 화면에 앱으로 설치 (app/manifest.ts) — 아이폰은 아래 값과 apple-touch-icon 을 쓴다
  applicationName: 'DG Flow',
  appleWebApp: { capable: true, title: 'DG Flow', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport = {
  themeColor: '#22405C',
  width: 'device-width',
  initialScale: 1,
  // 아이폰의 아래쪽 홈 막대 자리까지 화면을 쓰고, 탭 바가 그 자리를 비켜 가게 한다(env(safe-area-inset-bottom))
  viewportFit: 'cover' as const,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={cn("font-sans", geist.variable)}>
      <body className="min-h-screen bg-background antialiased">
        {children}
        {/* 저장 · 연결 결과를 띄우는 알림. 빠져 있어서 그동안 toast 가 하나도 안 보였다 */}
        <Toaster position="top-center" richColors closeButton />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
