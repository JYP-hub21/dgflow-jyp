'use client';

import { useRouter } from 'next/navigation';
import OrderForm from '@/components/order/OrderForm';
import type { OrderFormData } from '@/types/order-form';

export default function NewOrderPage() {
  const router = useRouter();

  async function handleSave(data: OrderFormData) {
    const res = await fetch('/api/orders', {
      method: 'POST',
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

    const orderId = result.data?.id;
    // 첨부파일 업로드는 OrderForm 내부에서 orderId를 받아 처리
    // 업로드 완료 후 상세 페이지로 이동
    setTimeout(() => {
      router.push(orderId ? `/orders/${orderId}` : '/orders');
      router.refresh();
    }, 100);
    return { orderId };
  }

  return (
    <OrderForm
      mode="create"
      title="새 주문 생성"
      onSave={handleSave}
      onCancel={() => router.push('/orders')}
    />
  );
}
