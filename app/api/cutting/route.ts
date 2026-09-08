import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { work_order_id, cutting_date, product_name, quantity, raw_glass_type, raw_width_mm, raw_height_mm, raw_quantity, shift, is_manual, remark } = await request.json();

  const supabase = await createServerSupabaseClient();

  const area_m2 = raw_width_mm && raw_height_mm && raw_quantity
    ? Math.round(raw_width_mm * raw_height_mm * raw_quantity / 1_000_000 * 10000) / 10000
    : null;

  const { data, error } = await supabase
    .from('dgflow_cutting_logs')
    .insert({
      work_order_id,
      cutting_date: cutting_date || new Date().toISOString().split('T')[0],
      product_name,
      quantity,
      area_m2: null,
      raw_glass_type: raw_glass_type || null,
      raw_width_mm: raw_width_mm || null,
      raw_height_mm: raw_height_mm || null,
      raw_quantity: raw_quantity || null,
      raw_area_m2: area_m2,
      shift: shift || 'day',
      is_manual: is_manual || false,
      remark: remark || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
