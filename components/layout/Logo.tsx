import { cn } from '@/lib/utils';

/**
 * 동일유리 시스템 마크 — 남색 둥근 네모 안에 회사 로고(DONGIL GLASS)의 "D".
 *
 * 2026-10-30: 예전에는 회사 로고 그림을 작게 줄여 쓰고 아래에 "ORDER FLOW" 를 띄워 적었는데 "짜쳐 보인다" 는
 * 의견이 있었다. 후보 다섯 개를 견줘 본 뒤 사용자가 고른 모양이다 (네모 안에 회사 로고의 D).
 * D 는 public/dongil-logo.png 의 첫 글자를 8배로 키워 흐림으로 잡티를 지운 뒤 윤곽선을 따서 벡터로 만들었다 —
 * 원본 그림이 작아(246×95) 그대로 키우면 흐려서다. 왼쪽 위 사선 홈까지 회사 로고 그대로다.
 * 탭 아이콘(app/icon.svg)도 같은 마크다. 원래 그림 파일은 남겨 둔다.
 */
const NAVY = '#22405C';
const D_PATH = 'M7.21 6.4L13.81 6.4L18.53 6.6L19.54 6.87L19.94 7.14L20.55 7.21L21.63 7.75L23.85 9.43L25.13 11.25L25.33 12.13L25.74 12.73L26.14 15.56L26.14 16.84L25.87 17.92L25.8 19.14L25.06 20.95L24.19 22.23L22.43 23.85L21.02 24.66L19 25.4L17.65 25.6L10.98 25.6L9.9 25.13L9.43 24.66L6.13 22.43L5.86 21.96L5.86 9.23L6.07 8.96L6.47 9.03L7.88 10.17L10.24 11.65L10.65 12.19L10.71 23.04L11.05 23.78L15.02 23.85L16.84 23.45L18.19 22.84L19.74 21.49L20.35 20.62L20.48 20.08L20.95 19.33L21.43 16.98L21.43 15.23L20.89 12.53L20.55 12.13L20.28 11.39L18.8 9.63L17.72 8.96L15.9 8.36L8.63 8.22L7.95 7.88L6.8 6.94L6.8 6.6Z';

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="동일유리" className={cn('shrink-0', className)}>
      <rect width="32" height="32" rx="9" fill={NAVY} />
      <path d={D_PATH} fill="#FFFFFF" fillRule="evenodd" />
    </svg>
  );
}

const SIZES = {
  sm: { mark: 32, name: 'text-[17px]', sub: 'text-[11px]' },
  md: { mark: 40, name: 'text-[20px]', sub: 'text-xs' },
  lg: { mark: 56, name: 'text-[28px]', sub: 'text-[13px]' },
} as const;

interface LogoProps {
  size?: keyof typeof SIZES;
  /** 회사명 아래 시스템 이름(DG Flow · 발주 · 생산 관리)을 함께 표시 */
  withTitle?: boolean;
  className?: string;
  /** 예전 그림 로고용 옵션 — 지금은 쓰지 않지만 부르는 쪽을 깨지 않게 받아 둔다 */
  priority?: boolean;
}

/** 마크 + "동일유리". withTitle 이면 아래에 "DG Flow · 발주 · 생산 관리" */
export default function Logo({ size = 'md', withTitle = false, className }: LogoProps) {
  const s = SIZES[size];
  return (
    <div className={cn('flex items-center', size === 'lg' ? 'gap-3.5' : 'gap-2.5', className)}>
      <LogoMark size={s.mark} />
      <div className="min-w-0 leading-none">
        <p className={cn('font-extrabold tracking-[-0.04em] text-brand-900', s.name)}>동일유리</p>
        {withTitle && (
          <p className={cn('mt-1 whitespace-nowrap font-semibold tracking-[-0.01em] text-muted-foreground', s.sub)}>DG Flow · 발주 · 생산 관리</p>
        )}
      </div>
    </div>
  );
}
