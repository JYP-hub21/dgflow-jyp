import Image from 'next/image';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: { w: 96, h: 37 },
  md: { w: 132, h: 51 },
  lg: { w: 180, h: 70 },
} as const;

interface LogoProps {
  size?: keyof typeof SIZES;
  /** 워드마크 아래 시스템명을 함께 표시 */
  withTitle?: boolean;
  className?: string;
  priority?: boolean;
}

/**
 * 동일유리 워드마크.
 *
 * 배경이 투명한 PNG를 쓴다 — 원본 JPEG은 순백 배경이라
 * 오프화이트인 페이지 배경 위에서 흰 사각형이 드러났다.
 * 변환은 scripts/make-logo-transparent.mjs 로 재생성한다.
 */
export default function Logo({ size = 'md', withTitle = false, className, priority }: LogoProps) {
  const { w, h } = SIZES[size];

  return (
    <div className={cn('flex flex-col', className)}>
      <Image
        src="/dongil-logo.png"
        alt="동일유리"
        width={w}
        height={h}
        priority={priority}
        className="h-auto w-auto select-none"
        style={{ width: w, height: 'auto' }}
      />
      {withTitle && (
        <span className="mt-1.5 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Order Flow
        </span>
      )}
    </div>
  );
}
