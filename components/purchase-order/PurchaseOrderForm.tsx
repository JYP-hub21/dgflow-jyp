'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Loader2, Send, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { chipClass } from '@/components/ui/chip';
import { createClient } from '@/lib/supabase/client';
import { formatBytes, uploadChunked } from '@/lib/purchase-order/chunks';

interface Assignee { id: string; name: string; department: string | null; position: string | null }

/**
 * 발주서 접수 폼.
 *
 * 파일은 브라우저가 저장소에 직접 45MB 조각으로 올린다 (서버를 거치면 4.5MB 에서 막힌다).
 * 다 올라가면 서버에 "이 파일들로 건을 만들어 달라" 고 알린다.
 */
export default function PurchaseOrderForm({ meId, assignees, customers, sites }: {
  meId: string;
  assignees: Assignee[];
  customers: string[];
  sites: string[];
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [customer, setCustomer] = useState('');
  const [site, setSite] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [memo, setMemo] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');

  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles(prev => [...prev, ...Array.from(list).filter(f => !prev.some(p => p.name === f.name && p.size === f.size))]);
  }

  async function submit() {
    setError('');
    if (files.length === 0) { setError('발주서 파일을 올리세요.'); return; }
    if (!assigneeId) { setError('담당자를 고르세요.'); return; }

    const supabase = createClient();
    const id = crypto.randomUUID();
    setProgress({ done: 0, total: totalBytes });
    try {
      let base = 0;
      const metas = [];
      for (const file of files) {
        const fileId = crypto.randomUUID();
        const chunkCount = await uploadChunked(supabase, `${id}/${fileId}`, file,
          sent => setProgress({ done: base + sent, total: totalBytes }));
        base += file.size;
        metas.push({ id: fileId, file_name: file.name, mime_type: file.type, size_bytes: file.size, chunk_count: chunkCount });
      }

      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, customer_name: customer, site_name: site, due_date: dueDate, memo, assignee_id: assigneeId, files: metas }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '접수하지 못했습니다.');
      toast.success(`접수했습니다 — ${json.data.intake_number}`);
      router.push(`/purchase-orders/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '접수하지 못했습니다.');
      setProgress(null);
    }
  }

  const busy = progress !== null;
  const pct = progress ? Math.round(progress.done / Math.max(progress.total, 1) * 100) : 0;

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        {/* 파일 */}
        <div>
          <Label className="mb-1.5 text-[13px] font-semibold">발주서 파일 *</Label>
          <label className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input bg-muted/30 px-6 py-8 text-center transition-colors hover:border-brand-600 hover:bg-brand-50">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-800 group-hover:bg-brand-800 group-hover:text-white">
              <Upload className="h-5 w-5" />
            </span>
            <span className="text-[15px] font-semibold">발주서 엑셀을 고르세요</span>
            <span className="text-sm text-muted-foreground">여러 개를 같이 올려도 됩니다. 그림이 많은 큰 파일도 됩니다.</span>
            <input type="file" multiple className="hidden" disabled={busy}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          {files.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {files.map(f => (
                <li key={f.name + f.size} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-700" />
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                  <button type="button" disabled={busy} aria-label="빼기"
                    onClick={() => setFiles(files.filter(x => x !== f))}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 담당자 */}
        <div>
          <Label className="mb-1.5 text-[13px] font-semibold">담당자 *</Label>
          {assignees.length === 0 ? (
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning">
              발주서 처리 권한이 있는 사람이 없습니다. 관리자에게 권한 지정을 요청하세요.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {assignees.map(a => (
                <button key={a.id} type="button" disabled={busy} onClick={() => setAssigneeId(a.id)}
                  className={chipClass(assigneeId === a.id)}>
                  {a.name}{a.id === meId && ' (나)'}
                  {(a.department || a.position) && (
                    <span className={assigneeId === a.id ? 'text-white/70 text-xs' : 'text-muted-foreground text-xs'}>
                      {[a.department, a.position].filter(Boolean).join(' ')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 text-[13px] font-semibold">거래처</Label>
            <Input list="po-customers" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="우미건설" disabled={busy} />
            <datalist id="po-customers">{customers.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <Label className="mb-1.5 text-[13px] font-semibold">현장</Label>
            <Input list="po-sites" value={site} onChange={e => setSite(e.target.value)} placeholder="남원주 역세권 7차" disabled={busy} />
            <datalist id="po-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <Label className="mb-1.5 text-[13px] font-semibold">납기</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={busy} />
          </div>
        </div>

        <div>
          <Label className="mb-1.5 text-[13px] font-semibold">전달 사항</Label>
          <Textarea rows={3} value={memo} onChange={e => setMemo(e.target.value)} disabled={busy}
            placeholder="메일 본문에 쓰던 내용 — 예) 5차 시트만 먼저 진행해 주세요" />
        </div>

        {error && <p className="rounded-lg bg-destructive/5 px-3.5 py-2.5 text-sm font-medium text-destructive">{error}</p>}

        {busy && (
          <div className="space-y-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              올리는 중 {formatBytes(progress!.done)} / {formatBytes(progress!.total)} — 창을 닫지 마세요
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button size="lg" onClick={submit} disabled={busy || assignees.length === 0}>
            <Send />{busy ? '올리는 중…' : '접수하기'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
