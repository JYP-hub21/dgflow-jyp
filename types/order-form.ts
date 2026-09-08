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
  items: OrderItemForm[];
}

export const SELECT_CLASS = 'h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm';
