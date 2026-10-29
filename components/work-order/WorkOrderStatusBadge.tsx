import { Badge } from '@/components/ui/badge';

const STATUS = {
  pending: { label: '대기', variant: 'secondary' },
  in_progress: { label: '진행중', variant: 'info' },
  completed: { label: '완료', variant: 'success' },
} as const;

/** 작업의뢰서 상태 — 대기 회색 · 진행중 파랑 · 완료 초록 */
export default function WorkOrderStatusBadge({ status }: { status: string }) {
  const s = STATUS[status as keyof typeof STATUS];
  if (!s) return <Badge variant="outline">{status}</Badge>;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
