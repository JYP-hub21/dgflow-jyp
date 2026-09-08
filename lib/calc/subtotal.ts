interface OrderItem {
  product_name: string;
  quantity: number;
  area_m2: number;
}

interface ProductGroup {
  product_name: string;
  items: OrderItem[];
  subtotal_quantity: number;
  subtotal_area: number;
}

export function groupByProduct(items: OrderItem[]): ProductGroup[] {
  const map = new Map<string, OrderItem[]>();
  for (const item of items) {
    const key = item.product_name;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  return Array.from(map.entries()).map(([product_name, groupItems]) => ({
    product_name,
    items: groupItems,
    subtotal_quantity: groupItems.reduce((s, i) => s + i.quantity, 0),
    subtotal_area: Math.round(groupItems.reduce((s, i) => s + Number(i.area_m2), 0) * 100) / 100,
  }));
}

export function calculateTotals(items: OrderItem[]) {
  return {
    total_quantity: items.reduce((s, i) => s + i.quantity, 0),
    total_area: Math.round(items.reduce((s, i) => s + Number(i.area_m2), 0) * 100) / 100,
  };
}
