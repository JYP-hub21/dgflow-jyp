'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DeliveryDailyPoint } from '@/lib/production/delivery';

// 생산관리부 색(주황) — 대시보드 생산 막대 · 사이드바 생산관리부 구역과 같은 계열
const BAR = '#BF4700';

/** 납품 메뉴 — 한 달 동안 날마다 나간 수량. 계열이 하나라 범례 없이 제목이 이름을 대신한다 */
export default function DeliveryTrend({ data }: { data: DeliveryDailyPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            interval="preserveStartEnd" minTickGap={10} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} allowDecimals={false} width={40} />
          <Tooltip cursor={{ fill: 'var(--muted)' }} content={<DayTooltip />} />
          <Bar dataKey="quantity" name="납품" fill={BAR} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload: DeliveryDailyPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-bold text-foreground">{p.date} ({p.weekday})</p>
      <p className="tabular text-muted-foreground">
        납품 <b className="text-foreground">{p.quantity.toLocaleString()}조</b> · {p.area_m2.toFixed(2)}M²
      </p>
    </div>
  );
}
