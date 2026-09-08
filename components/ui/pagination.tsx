'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  totalCount: number;
  pageSize?: number;
}

export default function Pagination({ totalCount, pageSize = 20 }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPage = parseInt(searchParams.get('page') || '1');
  const totalPages = Math.ceil(totalCount / pageSize);

  if (totalPages <= 1) return null;

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    router.push(`${pathname}?${params.toString()}`);
  }

  // 표시할 페이지 번호 계산 (현재 페이지 중심으로 최대 5개)
  const pages: number[] = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex items-center justify-between pt-4">
      <p className="text-sm text-gray-500">
        총 {totalCount}건 (페이지 {currentPage}/{totalPages})
      </p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {pages.map(p => (
          <Button
            key={p}
            variant={p === currentPage ? 'default' : 'outline'}
            size="sm"
            className="w-9"
            onClick={() => goToPage(p)}
          >
            {p}
          </Button>
        ))}
        <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
