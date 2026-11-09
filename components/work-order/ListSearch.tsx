import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';

/** 목록 검색 — 현장 · 업체 · 의뢰번호 (2026-11-06 회의 "많아지면 현장만 검색해서 그것만 뜨게") */
export default function ListSearch({ action, value }: { action: string; value: string }) {
  return (
    <form action={action} className="flex w-full max-w-md items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={value} placeholder="현장 · 업체 · 의뢰번호 검색" className="pl-9" aria-label="작업의뢰서 검색" />
      </div>
      {value && <Link href={action} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>초기화</Link>}
    </form>
  );
}

/** PostgREST or() 조건 — 값은 큰따옴표로 감싸고 구분 기호를 뺀다 */
export function searchCondition(q: string): string | null {
  const t = q.replace(/["\\,()%*]/g, ' ').trim();
  if (!t) return null;
  return ['work_order_number', 'site_label', 'customer_label'].map(c => `${c}.ilike."%${t}%"`).join(',');
}
