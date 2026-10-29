export interface OrderItemForm {
  product_name: string;
  product_id: string;
  width_mm: string;
  height_mm: string;
  quantity: string;
  location_dong: string;
  location_line: string;
  location_floor: string;
  location_room: string;
  location_type: string;
  location_window_type: string;
  remark: string;
}

export const EMPTY_ORDER_ITEM: OrderItemForm = {
  product_name: '', product_id: '', width_mm: '', height_mm: '', quantity: '1',
  location_dong: '', location_line: '', location_floor: '',
  location_room: '', location_type: '', location_window_type: '', remark: '',
};

export interface OrderFormData {
  customerId: string;
  siteId: string;
  orderDate: string;
  deliveryDate: string;
  remark: string;
  /** 발주서 상단 포장 지시문 — 작업의뢰서를 포장 단위로 나누는 근거 */
  packagingNote?: string;
  items: OrderItemForm[];
}

export const SELECT_CLASS = 'h-10 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-xs outline-none transition-colors hover:border-brand-600/50 focus-visible:border-brand-600 focus-visible:ring-3 focus-visible:ring-ring/25';
