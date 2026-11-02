'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Factory, Pencil, Phone, Plus, Truck } from 'lucide-react';
import Segmented from '@/components/ui/segmented';
import NativeSelect from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { telHref, type OutsourcePartner, type ProductionSite } from '@/lib/work-order/site';
import { usePartners } from './usePartners';

export interface SiteValue { site: ProductionSite; partnerId: string }

/**
 * 생산 공장 고르기 — 오창공장 / 외주(업체). 외주면 업체를 고르고, 없으면 그 자리에서 더한다.
 * 업체 담당자 · 전화가 바뀌면 연필을 눌러 고친다 — 공사개발부가 그 번호로 진행을 묻는다.
 * 작업의뢰서 등록 · 작업의뢰서 화면이 같이 쓴다 (lib/work-order/site.ts).
 */
export default function ProductionSitePicker({ value, onChange }: { value: SiteValue; onChange: (v: SiteValue) => void }) {
  const { partners, error, reload } = usePartners();
  const [form, setForm] = useState<null | { id?: string; name: string; contact_name: string; phone: string }>(null);
  const [busy, setBusy] = useState(false);
  const selected = partners.find(p => p.id === value.partnerId) ?? null;

  async function savePartner() {
    if (!form) return;
    if (!form.name.trim()) { toast.error('업체명을 입력하세요.'); return; }
    setBusy(true);
    try {
      const res = await fetch(form.id ? `/api/outsource-partners/${form.id}` : '/api/outsource-partners', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, contact_name: form.contact_name, phone: form.phone }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error ?? '저장하지 못했습니다.'); return; }
      await reload();
      const saved = json.partner as OutsourcePartner;
      onChange({ site: 'outsource', partnerId: saved.id });
      toast.success(form.id ? `외주 업체 정보를 수정했습니다: ${saved.name}` : `외주 업체를 추가했습니다: ${saved.name}`);
      setForm(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Segmented value={value.site} onChange={site => onChange({ ...value, site })}
        options={[{ value: 'ochang', label: '오창공장', icon: Factory }, { value: 'outsource', label: '외주', icon: Truck }]} />

      {value.site === 'outsource' && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-50/60 p-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!form && (
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect className="w-56" value={value.partnerId} aria-label="외주 업체"
                onChange={e => onChange({ site: 'outsource', partnerId: e.target.value })}>
                <option value="">외주 업체 선택</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
              <Button type="button" variant="outline" size="sm" onClick={() => setForm({ name: '', contact_name: '', phone: '' })}>
                <Plus />업체 추가
              </Button>
              {selected && (
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">담당자</span>
                  <b>{selected.contact_name || '-'}</b>
                  {selected.phone && (
                    <a href={telHref(selected.phone)} className="inline-flex items-center gap-1 font-semibold text-brand-800 hover:underline">
                      <Phone className="h-3.5 w-3.5" />{selected.phone}
                    </a>
                  )}
                  <button type="button" title="업체 담당자 · 연락처 수정"
                    onClick={() => setForm({ id: selected.id, name: selected.name, contact_name: selected.contact_name, phone: selected.phone })}
                    className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </div>
          )}
          {form && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">업체명
                <Input value={form.name} maxLength={40} onChange={e => setForm({ ...form, name: e.target.value })} className="w-44" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">담당자
                <Input value={form.contact_name} maxLength={20} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="w-32" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">연락처
                <Input value={form.phone} maxLength={20} inputMode="tel" placeholder="010-0000-0000"
                  onChange={e => setForm({ ...form, phone: e.target.value })} className="w-40" />
              </label>
              <Button type="button" size="sm" onClick={savePartner} disabled={busy}>{form.id ? '수정' : '추가'}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)} disabled={busy}>취소</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">외주로 지정한 작업의뢰서는 오창공장 생산 현황에서 제외되며, 발주서 등록자(공사 담당)에게 외주 업체와 담당자 연락처가 표시됩니다.</p>
        </div>
      )}
    </div>
  );
}
