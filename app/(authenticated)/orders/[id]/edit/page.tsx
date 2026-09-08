'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import OrderForm from '@/components/order/OrderForm';
import type { OrderFormData, OrderItemForm } from '@/types/order-form';

export default function EditOrderPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;
  const supabase = createClient();

  const [initialData, setInitialData] = useState<OrderFormData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadOrder() {
      const { data: order } = await supabase
        .from('dgflow_orders').select('*').eq('id', orderId).single();

      if (!order) { setLoading(false); return; }

      const { data: orderItems } = await supabase
        .from('dgflow_order_items').select('*').eq('order_id', orderId).order('sort_order');

      const items: OrderItemForm[] = (orderItems || []).map(i => ({
        product_name: i.product_name || '',
        product_id: i.product_id || '',
        width_mm: String(i.width_mm),
        height_mm: String(i.height_mm),
        quantity: String(i.quantity),
        location_dong: i.location_dong || '',
        location_line: i.location_line || '',
        location_floor: i.location_floor || '',
        location_room: i.location_room || '',
        location_type: i.location_type || '',
        location_window_type: i.location_window_type || '',
        remark: i.remark || '',
      }));

      setInitialData({
        customerId: order.customer_id,
        siteId: order.site_id,
        orderDate: order.order_date,
        deliveryDate: order.delivery_date || '',
        remark: order.remark || '',
        items,
      });
      setLoading(false);
    }
    loadOrder();
  }, [orderId]);

  async function handleSave(data: OrderFormData) {
    const res = await fetch(`/api/orders/${orderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: data.customerId,
        site_id: data.siteId,
        order_date: data.orderDate,
        delivery_date: data.deliveryDate || null,
        remark: data.remark || null,
        items: data.items.map(i => ({
          product_id: i.product_id || null,
          product_name: i.product_name,
          width_mm: parseInt(i.width_mm),
          height_mm: parseInt(i.height_mm),
          quantity: parseInt(i.quantity),
          location_dong: i.location_dong || null,
          location_line: i.location_line || null,
          location_floor: i.location_floor || null,
          location_room: i.location_room || null,
          location_type: i.location_type || null,
          location_window_type: i.location_window_type || null,
          remark: i.remark || null,
        })),
      }),
    });

    const result = await res.json();
    if (!res.ok) return { error: result.error || '저장에 실패했습니다.' };

    // 첨부파일 업로드는 OrderForm 내부에서 처리 후 이동
    setTimeout(() => {
      window.location.href = `/orders/${orderId}`;
    }, 100);
    return { orderId };
  }

  if (loading) return <div className="p-8 text-center text-gray-500">로딩 중...</div>;
  if (!initialData) return <div className="p-8 text-center text-gray-500">주문을 찾을 수 없습니다.</div>;

  return (
    <OrderForm
      mode="edit"
      title="주문 수정"
      initialData={initialData}
      orderId={orderId}
      onSave={handleSave}
      onCancel={() => router.push(`/orders/${orderId}`)}
    />
  );
}
