import { parseOrderExcel } from '../lib/parser/excel-order.js';
import fs from 'fs';
import path from 'path';

const dir = 'data/1. 발주서 관련/1. 담당별 발주서 모음';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));

for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const r = parseOrderExcel(buf.buffer);
  console.log(`=== ${f} ===`);
  console.log(`  Meta: customer="${r.meta.customer_name}" site="${r.meta.site_name}" order="${r.meta.order_date}" delivery="${r.meta.delivery_date}"`);
  console.log(`  Items: ${r.items.length}건 ${r.warnings.length > 0 ? '⚠ ' + r.warnings[0] : '✓'}`);
  if (r.items[0]) console.log(`  First: name="${r.items[0].product_name}" w=${r.items[0].width_mm} h=${r.items[0].height_mm} q=${r.items[0].quantity}`);
  console.log('');
}
