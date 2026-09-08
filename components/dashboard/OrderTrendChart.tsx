'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface TrendData {
  date: string;
  count: number;
  quantity: number;
  area: number;
}

export default function OrderTrendChart({ data }: { data: TrendData[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-500 text-center py-8">데이터가 없습니다</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar yAxisId="left" dataKey="count" name="주문 건수" fill="#6366f1" radius={[4, 4, 0, 0]} />
        <Bar yAxisId="right" dataKey="area" name="면적(m²)" fill="#10b981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
