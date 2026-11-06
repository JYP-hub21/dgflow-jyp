'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Phone, UserRound, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import NativeSelect from '@/components/ui/native-select';
import { telHref } from '@/lib/work-order/site';
import type { SiteContact } from '@/lib/production/contacts';

interface Candidate { id: string; name: string; department: string | null; phone: string | null }

/**
 * 공사 담당자(공사관리부) — 생산 입력 · 작업의뢰서 화면 오른쪽 위에.
 * 2026-11-02 "누가 올린 발주서인지 사람이랑 연락처가 뜨면 그 사람과 소통하면 되는구나 하고 빨리 판단" ·
 * "현장별 공사관리부 담당자 정보 — 복층 입력할 때".
 *
 * 발주서와 이어진 의뢰서는 그 발주서를 올린 사람, 아니면 그 현장에 정해 둔 담당자(lib/production/contacts.ts).
 * 현장 담당자는 권한이 있으면 여기서 정한다 — 한 번 정하면 그 현장 의뢰서 전부에 뜬다.
 * 전화번호를 누르면 폰에서 바로 전화가 걸린다.
 */
export default function ContactCard({ contact, siteLabel, canAssign = false, onChanged, className }: {
  contact: SiteContact | null;
  /** 이 의뢰서의 현장명 — 있으면 현장 담당자를 정할 수 있다 */
  siteLabel?: string | null;
  canAssign?: boolean;
  /** 정한 뒤 다시 읽기 (없으면 화면을 새로 고친다) */
  onChanged?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const assignable = canAssign && !!siteLabel && contact?.source !== 'po';

  async function open() {
    setPicking(true);
    if (!candidates) {
      const res = await fetch('/api/site-contacts').catch(() => null);
      const json = res?.ok ? await res.json() : null;
      setCandidates(json?.candidates ?? []);
    }
  }
  async function save() {
    if (!chosen) { toast.error('담당자를 선택하세요.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/site-contacts', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_label: siteLabel, user_id: chosen }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? '지정하지 못했습니다.'); return; }
      toast.success(`${siteLabel} 현장의 공사 담당자를 지정했습니다. 해당 현장의 모든 작업의뢰서에 표시됩니다.`);
      setPicking(false);
      if (onChanged) onChanged(); else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <div className={cn('space-y-2 rounded-xl border bg-card px-4 py-3 shadow-xs', className)}>
        <p className="text-xs text-muted-foreground"><b className="text-foreground">{siteLabel}</b> 현장의 공사 담당자</p>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect className="w-56" value={chosen} onChange={e => setChosen(e.target.value)} aria-label="공사 담당자">
            <option value="">{candidates ? '담당자 선택' : '불러오는 중…'}</option>
            {(candidates ?? []).map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.department ? ` · ${c.department}` : ''}{c.phone ? ` · ${c.phone}` : ''}</option>
            ))}
          </NativeSelect>
          <Button size="sm" onClick={save} disabled={busy}>지정</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)} disabled={busy}>취소</Button>
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className={cn('flex items-center gap-3 rounded-xl border border-dashed bg-card px-4 py-2.5 text-xs text-muted-foreground', className)}>
        <span>지정된 공사 담당자가 없습니다</span>
        {assignable && (
          <Button size="sm" variant="outline" onClick={open} className="h-8"><UserPlus />담당자 지정</Button>
        )}
      </div>
    );
  }
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-xs', className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dept-construction-soft text-dept-construction">
        <UserRound className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="text-xs text-muted-foreground">
          {contact.source === 'po' ? '발주서 등록자' : '현장 공사 담당자'}{contact.department ? ` · ${contact.department}` : ''}
        </p>
        <p className="flex flex-wrap items-center gap-x-2">
          <b>{contact.name}</b>
          {contact.phone
            ? <a href={telHref(contact.phone)} className="inline-flex items-center gap-1 font-semibold text-brand-800 hover:underline">
                <Phone className="h-3.5 w-3.5" />{contact.phone}
              </a>
            : <span className="text-xs text-muted-foreground">연락처 없음</span>}
        </p>
      </div>
      {assignable && (
        <button type="button" onClick={open} title="현장 담당자 변경"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
