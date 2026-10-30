'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** 하루 한 점 — 호기별 생산 수량과 면적 */
export interface TrendPoint {
  date: string;
  /** 축 이름 "10/30" */
  label: string;
  weekday: string;
  total: number;
  area_m2: number;
  /** 호기별 수량 — 열쇠는 `line_${호기 번호}` */
  [line: `line_${number}`]: number;
}

/** 막대로 쌓을 호기 — 번호와 이름 (호기는 편집으로 이름을 바꾸거나 더할 수 있다) */
export interface TrendSeries { line: number; name: string }

// 생산관리부 색(주황) — 사이드바 생산관리부 구역과 같은 계열. 호기가 늘면 진하기를 바꿔 이어 쓴다
const COLORS = ['#BF4700', '#F2A267', '#7A2E00', '#F8CBA4', '#DE6A1F', '#4F1E00'];
const colorOf = (i: number) => COLORS[i % COLORS.length];
const valueOf = (p: TrendPoint, line: number) => p[`line_${line}`] ?? 0;

/** 대시보드 — 최근 2주 생산량, 호기별로 쌓은 막대 */
export default function ProductionTrend({ data, series }: { data: TrendPoint[]; series: TrendSeries[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          {/* 폭이 좁으면(폰) 겹치는 날짜는 건너뛴다 — 처음과 끝 날짜는 남긴다 */}
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            interval="preserveStartEnd" minTickGap={10} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} allowDecimals={false} width={44} />
          <Tooltip cursor={{ fill: 'var(--muted)' }} content={<TrendTooltip series={series} />} />
          {series.map((s, i) => (
            <Bar key={s.line} dataKey={`line_${s.line}`} name={s.name} stackId="q" fill={colorOf(i)}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendLegend({ series }: { series: TrendSeries[] }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {series.map((s, i) => (
        <span key={s.line} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(i) }} />{s.name}
        </span>
      ))}
    </div>
  );
}

function TrendTooltip({ active, payload, series }: { active?: boolean; payload?: { payload: TrendPoint }[]; series: TrendSeries[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-bold text-foreground">{p.date} ({p.weekday})</p>
      <p className="tabular text-muted-foreground">
        {series.map((s, i) => (
          <span key={s.line}>{i > 0 && ' · '}{s.name} <b className="text-foreground">{valueOf(p, s.line).toLocaleString()}</b></span>
        ))}
      </p>
      <p className="tabular text-muted-foreground">합계 <b className="text-foreground">{p.total.toLocaleString()}</b> · {p.area_m2.toFixed(1)}㎡</p>
    </div>
  );
}
