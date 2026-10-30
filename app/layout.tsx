import type { Metadata } from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'DG Flow · 동일유리',
  description: '동일유리 발주 · 생산 관리 — 발주서 접수, ERP 업로드 엑셀, 작업의뢰서, 생산 실적과 복층생산일지',
};

export const viewport = {
  themeColor: '#22405C',
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
      </body>
    </html>
  );
}
