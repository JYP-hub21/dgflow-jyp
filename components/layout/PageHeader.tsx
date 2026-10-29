import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/**
 * 화면 머리글 — 제목 · 설명 · 오른쪽 행동 버튼.
 * 화면마다 크기와 여백이 제각각이라 어디가 제목인지부터 헷갈렸다. 한 곳에서 맞춘다.
 */
export default function PageHeader({ title, description, back, actions }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 상위 화면으로 돌아가는 링크 — 제목 위에 작게 */
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href}
            className="mb-1.5 inline-flex items-center gap-0.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />{back.label}
          </Link>
        )}
        <h1 className="text-xl font-bold tracking-tight text-foreground md:text-[26px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
