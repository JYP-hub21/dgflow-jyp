import type { Metadata } from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'DG-Flow - 동일유리 주문관리 시스템',
  description: '주문의뢰서 입력, 승인, ERP 입력, 생산 모니터링 통합 시스템',
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
