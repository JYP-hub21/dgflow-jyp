import { CardTitle } from '@/components/ui/card';

/** 단계 제목 — 번호 동그라미로 화면의 순서를 보여 준다 */
export default function StepTitle({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2.5 text-lg">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-800 text-sm font-bold text-white">
        {step}
      </span>
      <span>{children}</span>
    </CardTitle>
  );
}
