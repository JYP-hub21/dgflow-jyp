'use client';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { sizeText } from '@/lib/production/item-view';
import type { RevisionPlan } from '@/lib/work-order/revise';

/**
 * 같은 의뢰번호를 다시 올리거나 화면에서 고칠 때 — 무엇이 바뀌는지 보여 주고 확인을 받는다.
 * 생산 기록이 있는 줄이 어떻게 되는지 여기서 먼저 알린다.
 */
export default function RevisionDialog({ number, plan, busy, onCancel, onApply }: {
  number: string;
  plan: RevisionPlan;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const nothing = plan.changed.length === 0 && plan.added.length === 0 && plan.removed.length === 0;
  return (
    <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
      <DialogContent className="gap-4 p-6 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">작업의뢰서 {number} 수정</DialogTitle>
          <DialogDescription>
            {nothing
              ? '품목 변경 사항이 없습니다. 의뢰 정보만 저장합니다.'
              : `이미 등록된 의뢰번호입니다. 아래 내용을 확인한 뒤 적용하세요. 변경 없는 품목 ${plan.same}건의 생산 기록은 그대로 유지됩니다.`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
          {plan.changed.length > 0 && (
            <Section title={`변경 ${plan.changed.length}건`}>
              {plan.changed.map(c => (
                <li key={c.id} className="py-1.5">
                  <span className="tabular font-semibold">No.{c.no}</span>{' '}
                  <span className="text-muted-foreground">{c.product_name}</span>
                  <p className="tabular">
                    {(c.before.width_mm !== c.after.width_mm || c.before.height_mm !== c.after.height_mm) && (
                      <span className="mr-3">{sizeText(c.before.width_mm, c.before.height_mm)} → <b>{sizeText(c.after.width_mm, c.after.height_mm)}</b></span>
                    )}
                    {c.before.quantity !== c.after.quantity && <span className="mr-3">수량 {c.before.quantity} → <b>{c.after.quantity}</b></span>}
                    {(c.before.remark ?? '') !== (c.after.remark ?? '') && <span>비고 변경</span>}
                  </p>
                  {c.limited && <p className="text-warning">이미 {c.produced}조를 생산하여 수량을 {c.produced}조까지만 줄입니다.</p>}
                </li>
              ))}
            </Section>
          )}
          {plan.added.length > 0 && (
            <Section title={`추가 ${plan.added.length}건`}>
              {plan.added.map((a, i) => (
                <li key={i} className="py-1.5">
                  <span className="tabular font-semibold">No.{a.item_no}</span>{' '}
                  <span className="text-muted-foreground">{a.product_name}</span>
                  <span className="tabular ml-2">{sizeText(a.width_mm, a.height_mm)} · {a.quantity}조</span>
                </li>
              ))}
            </Section>
          )}
          {plan.removed.length > 0 && (
            <Section title={`삭제 ${plan.removed.length}건`}>
              {plan.removed.map(r => (
                <li key={r.id} className="py-1.5">
                  <span className="tabular font-semibold">No.{r.no}</span>{' '}
                  <span className="text-muted-foreground">{r.product_name}</span>
                  <span className="tabular ml-2">{sizeText(r.width_mm, r.height_mm)} · {r.quantity}조</span>
                  {r.kept && <p className="text-warning">이미 {r.produced}조를 생산하여 삭제하지 않고 수량을 {r.produced}조로 줄입니다.</p>}
                </li>
              ))}
            </Section>
          )}
        </div>

        <DialogFooter className="-mx-6 -mb-6 px-6">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>취소</Button>
          <Button type="button" onClick={onApply} disabled={busy}>{busy ? '적용 중…' : '수정 적용'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-[13px] font-bold">{title}</h4>
      <ul className="divide-y rounded-lg border px-3">{children}</ul>
    </section>
  );
}
