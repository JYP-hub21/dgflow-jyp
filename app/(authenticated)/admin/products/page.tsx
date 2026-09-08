'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, Save, X, Search, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 15;

function useFilteredPagination<T>(items: T[], searchFn: (item: T, query: string) => boolean) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!search) return items;
    return items.filter(item => searchFn(item, search.toLowerCase()));
  }, [items, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 검색 변경 시 1페이지로
  useEffect(() => { setPage(1); }, [search]);

  return { search, setSearch, page, setPage, filtered, paged, totalPages };
}

function ClientPagination({ page, totalPages, totalCount, onPageChange }: {
  page: number; totalPages: number; totalCount: number; onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 px-1">
      <span className="text-xs text-gray-500">{totalCount}건 중 {(page-1)*PAGE_SIZE+1}~{Math.min(page*PAGE_SIZE, totalCount)}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-3 w-3" /></Button>
        <span className="text-xs px-2">{page}/{totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}

interface Product {
  id: string; product_code: string; display_name: string; erp_name: string;
  thickness_mm: number; outer_glass: string; spacer: string; gas: string;
  inner_glass: string; lamination_type: string; is_active: boolean;
}
interface Customer { id: string; name: string; short_name: string; contact_info: string; is_active: boolean; }
interface Site { id: string; customer_id: string; site_name: string; address: string; region_sido: string; region_sigungu: string; is_active: boolean; }
interface RawGlass { id: string; glass_type: string; width_mm: number; height_mm: number; area_m2: number; is_active: boolean; }

export default function MasterPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">마스터 관리</h1>
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">품명</TabsTrigger>
          <TabsTrigger value="customers">거래처</TabsTrigger>
          <TabsTrigger value="sites">현장</TabsTrigger>
          <TabsTrigger value="glass">원판</TabsTrigger>
        </TabsList>
        <TabsContent value="products"><ProductsTab /></TabsContent>
        <TabsContent value="customers"><CustomersTab /></TabsContent>
        <TabsContent value="sites"><SitesTab /></TabsContent>
        <TabsContent value="glass"><RawGlassTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============ 품명 마스터 ============
function ProductsTab() {
  const supabase = createClient();
  const [items, setItems] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const { search, setSearch, page, setPage, paged, filtered, totalPages } = useFilteredPagination(items,
    (p, q) => p.display_name.toLowerCase().includes(q) || p.product_code.toLowerCase().includes(q) || p.erp_name.toLowerCase().includes(q)
  );

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('dgflow_products').select('*').order('display_name');
    setItems(data || []);
  }

  async function handleSave() {
    if (!editing) return;
    if (editing.id) {
      await supabase.from('dgflow_products').update(editing).eq('id', editing.id);
    } else {
      await supabase.from('dgflow_products').insert(editing);
    }
    setEditing(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    await supabase.from('dgflow_products').delete().eq('id', id);
    load();
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">품명 마스터 ({items.length}건)</CardTitle>
          <Button size="sm" onClick={() => setEditing({ product_code: '', display_name: '', erp_name: '', thickness_mm: 0, outer_glass: '', spacer: '', gas: '', inner_glass: '', is_active: true })}>
            <Plus className="mr-1 h-4 w-4" />추가
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9 h-9" placeholder="품명, 제품코드, ERP명 검색..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent>
        {editing && (
          <div className="grid grid-cols-4 gap-3 mb-4 p-4 border rounded-lg bg-gray-50">
            <div><Label className="text-xs">제품코드</Label><Input className="h-8 text-sm" value={editing.product_code || ''} onChange={e => setEditing({ ...editing, product_code: e.target.value })} /></div>
            <div><Label className="text-xs">표시명</Label><Input className="h-8 text-sm" value={editing.display_name || ''} onChange={e => setEditing({ ...editing, display_name: e.target.value })} /></div>
            <div><Label className="text-xs">ERP명</Label><Input className="h-8 text-sm" value={editing.erp_name || ''} onChange={e => setEditing({ ...editing, erp_name: e.target.value })} /></div>
            <div><Label className="text-xs">두께(mm)</Label><Input className="h-8 text-sm" type="number" value={editing.thickness_mm || ''} onChange={e => setEditing({ ...editing, thickness_mm: Number(e.target.value) })} /></div>
            <div><Label className="text-xs">외판유리</Label><Input className="h-8 text-sm" value={editing.outer_glass || ''} onChange={e => setEditing({ ...editing, outer_glass: e.target.value })} /></div>
            <div><Label className="text-xs">간봉</Label><Input className="h-8 text-sm" value={editing.spacer || ''} onChange={e => setEditing({ ...editing, spacer: e.target.value })} /></div>
            <div><Label className="text-xs">가스</Label><Input className="h-8 text-sm" value={editing.gas || ''} onChange={e => setEditing({ ...editing, gas: e.target.value })} /></div>
            <div><Label className="text-xs">내판유리</Label><Input className="h-8 text-sm" value={editing.inner_glass || ''} onChange={e => setEditing({ ...editing, inner_glass: e.target.value })} /></div>
            <div className="col-span-4 flex gap-2">
              <Button size="sm" onClick={handleSave}><Save className="mr-1 h-3 w-3" />{editing.id ? '수정' : '저장'}</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}><X className="mr-1 h-3 w-3" />취소</Button>
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>제품코드</TableHead>
              <TableHead>표시명</TableHead>
              <TableHead>ERP명</TableHead>
              <TableHead className="text-right">두께</TableHead>
              <TableHead>외판</TableHead>
              <TableHead>간봉</TableHead>
              <TableHead>가스</TableHead>
              <TableHead>내판</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map(p => (
              <TableRow key={p.id}>
                <TableCell className="text-xs font-mono">{p.product_code}</TableCell>
                <TableCell className="font-medium">{p.display_name}</TableCell>
                <TableCell className="text-sm">{p.erp_name}</TableCell>
                <TableCell className="text-right">{p.thickness_mm}</TableCell>
                <TableCell className="text-xs">{p.outer_glass}</TableCell>
                <TableCell className="text-xs">{p.spacer}</TableCell>
                <TableCell className="text-xs">{p.gas || '-'}</TableCell>
                <TableCell className="text-xs">{p.inner_glass}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id)}><Trash2 className="h-3 w-3 text-red-500" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ClientPagination page={page} totalPages={totalPages} totalCount={filtered.length} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}

// ============ 거래처 마스터 ============
function CustomersTab() {
  const supabase = createClient();
  const [items, setItems] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const { search, setSearch, page, setPage, paged, filtered, totalPages } = useFilteredPagination(items,
    (c, q) => c.name.toLowerCase().includes(q) || (c.short_name || '').toLowerCase().includes(q)
  );

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('dgflow_customers').select('*').order('name');
    setItems(data || []);
  }

  async function handleSave() {
    if (!editing) return;
    if (editing.id) {
      await supabase.from('dgflow_customers').update(editing).eq('id', editing.id);
    } else {
      await supabase.from('dgflow_customers').insert(editing);
    }
    setEditing(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    await supabase.from('dgflow_customers').delete().eq('id', id);
    load();
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">거래처 ({items.length}건)</CardTitle>
          <Button size="sm" onClick={() => setEditing({ name: '', short_name: '', contact_info: '', is_active: true })}>
            <Plus className="mr-1 h-4 w-4" />추가
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9 h-9" placeholder="거래처명, 약칭 검색..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent>
        {editing && (
          <div className="grid grid-cols-3 gap-3 mb-4 p-4 border rounded-lg bg-gray-50">
            <div><Label className="text-xs">거래처명</Label><Input className="h-8 text-sm" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
            <div><Label className="text-xs">약칭</Label><Input className="h-8 text-sm" value={editing.short_name || ''} onChange={e => setEditing({ ...editing, short_name: e.target.value })} /></div>
            <div><Label className="text-xs">연락처</Label><Input className="h-8 text-sm" value={editing.contact_info || ''} onChange={e => setEditing({ ...editing, contact_info: e.target.value })} /></div>
            <div className="col-span-3 flex gap-2">
              <Button size="sm" onClick={handleSave}><Save className="mr-1 h-3 w-3" />{editing.id ? '수정' : '저장'}</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}><X className="mr-1 h-3 w-3" />취소</Button>
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>거래처명</TableHead>
              <TableHead>약칭</TableHead>
              <TableHead>연락처</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map(c => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.short_name}</TableCell>
                <TableCell className="text-sm">{c.contact_info || '-'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(c)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}><Trash2 className="h-3 w-3 text-red-500" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ClientPagination page={page} totalPages={totalPages} totalCount={filtered.length} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}

// ============ 현장 마스터 ============
function SitesTab() {
  const supabase = createClient();
  const [items, setItems] = useState<(Site & { customer?: { name: string } })[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<Partial<Site> | null>(null);
  const { search, setSearch, page, setPage, paged, filtered, totalPages } = useFilteredPagination(items,
    (s, q) => s.site_name.toLowerCase().includes(q) || (s.customer as { name: string })?.name?.toLowerCase()?.includes(q) || (s.region_sido || '').toLowerCase().includes(q)
  );

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('dgflow_sites').select('*, customer:dgflow_customers(name)').order('site_name');
    setItems(data || []);
    const { data: custs } = await supabase.from('dgflow_customers').select('id, name, short_name').order('name');
    setCustomers((custs || []) as Customer[]);
  }

  async function handleSave() {
    if (!editing) return;
    if (editing.id) {
      await supabase.from('dgflow_sites').update(editing).eq('id', editing.id);
    } else {
      await supabase.from('dgflow_sites').insert(editing);
    }
    setEditing(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    await supabase.from('dgflow_sites').delete().eq('id', id);
    load();
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">현장 ({items.length}건)</CardTitle>
          <Button size="sm" onClick={() => setEditing({ customer_id: '', site_name: '', address: '', region_sido: '', region_sigungu: '', is_active: true })}>
            <Plus className="mr-1 h-4 w-4" />추가
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9 h-9" placeholder="현장명, 거래처, 지역 검색..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent>
        {editing && (
          <div className="grid grid-cols-3 gap-3 mb-4 p-4 border rounded-lg bg-gray-50">
            <div>
              <Label className="text-xs">거래처</Label>
              <select className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm" value={editing.customer_id || ''} onChange={e => setEditing({ ...editing, customer_id: e.target.value })}>
                <option value="">선택</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}
              </select>
            </div>
            <div><Label className="text-xs">현장명</Label><Input className="h-8 text-sm" value={editing.site_name || ''} onChange={e => setEditing({ ...editing, site_name: e.target.value })} /></div>
            <div><Label className="text-xs">주소</Label><Input className="h-8 text-sm" value={editing.address || ''} onChange={e => setEditing({ ...editing, address: e.target.value })} /></div>
            <div><Label className="text-xs">시/도</Label><Input className="h-8 text-sm" value={editing.region_sido || ''} onChange={e => setEditing({ ...editing, region_sido: e.target.value })} /></div>
            <div><Label className="text-xs">시/군/구</Label><Input className="h-8 text-sm" value={editing.region_sigungu || ''} onChange={e => setEditing({ ...editing, region_sigungu: e.target.value })} /></div>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={handleSave}><Save className="mr-1 h-3 w-3" />{editing.id ? '수정' : '저장'}</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}><X className="mr-1 h-3 w-3" />취소</Button>
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>거래처</TableHead>
              <TableHead>현장명</TableHead>
              <TableHead>주소</TableHead>
              <TableHead>시/도</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map(s => (
              <TableRow key={s.id}>
                <TableCell className="text-sm">{(s.customer as { name: string })?.name}</TableCell>
                <TableCell className="font-medium">{s.site_name}</TableCell>
                <TableCell className="text-sm max-w-[200px] truncate">{s.address || '-'}</TableCell>
                <TableCell className="text-sm">{s.region_sido || '-'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)}><Trash2 className="h-3 w-3 text-red-500" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ClientPagination page={page} totalPages={totalPages} totalCount={filtered.length} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}

// ============ 원판 마스터 ============
function RawGlassTab() {
  const supabase = createClient();
  const [items, setItems] = useState<RawGlass[]>([]);
  const [editing, setEditing] = useState<Partial<RawGlass> | null>(null);
  const { search, setSearch, page, setPage, paged, filtered, totalPages } = useFilteredPagination(items,
    (g, q) => g.glass_type.toLowerCase().includes(q)
  );

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('dgflow_raw_glasses').select('*').order('glass_type');
    setItems(data || []);
  }

  async function handleSave() {
    if (!editing) return;
    const { area_m2, ...rest } = editing as RawGlass;
    if (editing.id) {
      await supabase.from('dgflow_raw_glasses').update(rest).eq('id', editing.id);
    } else {
      await supabase.from('dgflow_raw_glasses').insert(rest);
    }
    setEditing(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    await supabase.from('dgflow_raw_glasses').delete().eq('id', id);
    load();
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">원판 ({items.length}건)</CardTitle>
          <Button size="sm" onClick={() => setEditing({ glass_type: '', width_mm: 0, height_mm: 0, is_active: true })}>
            <Plus className="mr-1 h-4 w-4" />추가
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9 h-9" placeholder="원판 유형 검색..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent>
        {editing && (
          <div className="grid grid-cols-4 gap-3 mb-4 p-4 border rounded-lg bg-gray-50">
            <div><Label className="text-xs">원판 유형</Label><Input className="h-8 text-sm" value={editing.glass_type || ''} onChange={e => setEditing({ ...editing, glass_type: e.target.value })} /></div>
            <div><Label className="text-xs">가로(mm)</Label><Input className="h-8 text-sm" type="number" value={editing.width_mm || ''} onChange={e => setEditing({ ...editing, width_mm: Number(e.target.value) })} /></div>
            <div><Label className="text-xs">세로(mm)</Label><Input className="h-8 text-sm" type="number" value={editing.height_mm || ''} onChange={e => setEditing({ ...editing, height_mm: Number(e.target.value) })} /></div>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={handleSave}><Save className="mr-1 h-3 w-3" />{editing.id ? '수정' : '저장'}</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}><X className="mr-1 h-3 w-3" />취소</Button>
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>유형</TableHead>
              <TableHead className="text-right">가로(mm)</TableHead>
              <TableHead className="text-right">세로(mm)</TableHead>
              <TableHead className="text-right">면적(m²)</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map(g => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">{g.glass_type}</TableCell>
                <TableCell className="text-right">{g.width_mm}</TableCell>
                <TableCell className="text-right">{g.height_mm}</TableCell>
                <TableCell className="text-right">{Number(g.area_m2).toFixed(4)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(g)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(g.id)}><Trash2 className="h-3 w-3 text-red-500" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ClientPagination page={page} totalPages={totalPages} totalCount={filtered.length} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}
