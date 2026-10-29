'use client';

/**
 * 검산 패널
 *
 * 발주서에는 이미 정답이 적혀 있다 — 블록 끝의 `계`, 포장 끝의 회색 `합계`, 맨 아래 `총계`.
 * 우리 출력을 거기에 대 보면, 파서가 완벽하지 않아도 **틀렸다는 사실은** 즉시 보인다.
 *
 * 숫자가 전부 맞으면 사원은 믿고 넘어갈 수 있고, 어긋나면 어느 블록인지 바로 짚인다.
 * 이게 "어떤 발주서가 올지 모른다" 는 문제에 대한 가장 값싼 안전장치다.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, TriangleAlert, Minus } from 'lucide-react';
import type { Reconciliation, ReconcileScope } from '@/lib/erp/reconcile';

const SCOPE_LABEL: Record<ReconcileScope, string> = {
  block: '품명 블록',
  package: '포장',
  total: '시트',
  output: '출력',
};

export default function ReconcilePanel({ result }: { result: Reconciliation }) {
  const bad = result.mismatched > 0;
  const good = !bad && result.checked > 0;

  // 결론을 먼저 크게 — 맞았는지 틀렸는지는 줄을 읽지 않아도 색과 문장으로 보여야 한다
  const banner = bad
    ? { cls: 'border-destructive/40 bg-destructive/5', icon: <TriangleAlert className="h-5 w-5" />, iconCls: 'bg-destructive text-white',
        title: `발주서 합계와 ${result.mismatched}곳이 다릅니다`, sub: '빨간 줄을 발주서 원본과 확인해 주세요.' }
    : good
      ? { cls: 'border-success/40 bg-success-50', icon: <Check className="h-5 w-5" />, iconCls: 'bg-success text-white',
          title: `발주서 합계와 전부 일치합니다 (${result.checked}곳)`, sub: '읽은 수량을 그대로 쓰셔도 됩니다.' }
      : { cls: 'border-border bg-muted/40', icon: <Minus className="h-5 w-5" />, iconCls: 'bg-muted-foreground/20 text-muted-foreground',
          title: '대조할 합계가 발주서에 없습니다', sub: '아래 표의 수량을 직접 확인해 주세요.' };

  return (
    <Card className={banner.cls}>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${banner.iconCls}`}>
            {banner.icon}
          </span>
          <span className="min-w-0">
            <span className="block text-base font-bold">{banner.title}</span>
            <span className="block text-sm font-normal text-muted-foreground">
              검산 — 발주서가 직접 적어 둔 계·합계·총계와 우리가 읽은 수량을 맞춰 봤습니다. {banner.sub}
            </span>
          </span>
          {result.checked > 0 && (
            <Badge variant={bad ? 'destructive' : 'success'} className="ml-auto hidden h-7 px-3 text-sm sm:inline-flex">
              {result.checked - result.mismatched} / {result.checked} 일치
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {result.lines.map((line, i) => (
            <div
              key={i}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                line.ok === false
                  ? 'border-destructive/40 bg-destructive/5 text-destructive'
                  : line.ok === true
                    ? 'border-success/25 bg-card text-foreground'
                    : 'bg-card text-muted-foreground'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {SCOPE_LABEL[line.scope]}
                </span>
                <span className="truncate font-medium" title={line.label}>{line.label}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {line.declared === null ? (
                  <span className="text-muted-foreground">기준 없음 · {line.actual}장</span>
                ) : line.ok ? (
                  <span className="flex items-center gap-1 font-semibold text-success">{line.actual}장 <Check className="h-4 w-4" /></span>
                ) : (
                  <span className="font-bold">
                    발주서 {line.declared} ≠ 우리 {line.actual}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {bad && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-card px-3 py-2.5 text-sm text-destructive">
            어긋난 블록의 발주서 원본을 확인해 주세요. 발주서의 합계 수식 자체가 깨져 있는 경우도 있습니다 —
            그때는 아래 표의 수량을 직접 고치시면 됩니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
