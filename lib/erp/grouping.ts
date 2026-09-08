interface OrderItem {
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  location_dong: string | null;
  location_line: string | null;
  location_floor: string | null;
  location_room: string | null;
  location_type: string | null;
  location_window_type: string | null;
}

interface GroupedItem {
  product_name: string;
  width_mm: number;
  height_mm: number;
  quantity: number;
  location_summary: string;
}

/**
 * 규격 그룹핑 (PRD 9절)
 * 규칙: 동일 품명 + 동일 규격(가로×세로) → 묶어서 수량 합산, 위치 통합
 */
export function groupBySpec(items: OrderItem[]): GroupedItem[] {
  const map = new Map<string, { items: OrderItem[]; quantity: number }>();

  for (const item of items) {
    const key = `${item.product_name}|${item.width_mm}|${item.height_mm}`;
    if (!map.has(key)) map.set(key, { items: [], quantity: 0 });
    const group = map.get(key)!;
    group.items.push(item);
    group.quantity += item.quantity;
  }

  return Array.from(map.entries()).map(([key, group]) => {
    const [product_name, w, h] = key.split('|');
    return {
      product_name,
      width_mm: parseInt(w),
      height_mm: parseInt(h),
      quantity: group.quantity,
      location_summary: summarizeLocations(group.items),
    };
  });
}

function summarizeLocations(items: OrderItem[]): string {
  const parts: string[] = [];
  const dongs = [...new Set(items.map(i => i.location_dong).filter(Boolean))] as string[];
  const lines = [...new Set(items.map(i => i.location_line).filter(Boolean))] as string[];
  const rooms = [...new Set(items.map(i => i.location_room).filter(Boolean))] as string[];
  const types = [...new Set(items.map(i => i.location_type).filter(Boolean))] as string[];
  const windows = [...new Set(items.map(i => i.location_window_type).filter(Boolean))] as string[];

  if (dongs.length > 0) parts.push(mergeNumbers(dongs) + '동');
  if (lines.length > 0) parts.push(mergeNumbers(lines) + '라인');
  if (rooms.length > 0) parts.push(rooms.join(','));
  if (types.length > 0) parts.push(types.join(','));
  if (windows.length > 0) parts.push(windows.join(','));

  return parts.join(' ') || '';
}

/** 연속 숫자 통합: [1,2,3] → "1~3", [1,3] → "1,3" */
function mergeNumbers(values: string[]): string {
  const nums = values.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (nums.length === 0) return values.join(',');
  if (nums.length === 1) return String(nums[0]);

  const isConsecutive = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return isConsecutive ? `${nums[0]}~${nums[nums.length - 1]}` : nums.join(',');
}
