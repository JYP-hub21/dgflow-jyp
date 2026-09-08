-- DG-Flow 마스터 데이터 시딩
-- TASK 2A-4, 2B-4, 2C-2

-- ============================================
-- 품명 마스터 (PRD 5.3절 변환 규칙 기반)
-- ============================================
INSERT INTO dgflow_products (product_code, display_name, erp_name, thickness_mm, outer_glass, spacer, gas, inner_glass, lamination_type) VALUES
  ('26.76T-PVB-10A-6LE', '26.76T 10.76투명접합+10A+6로이', '26.76T 10.76투명접합+10A+6로이', 26.76, '5CL', '10A', NULL, '6EMT178', '0.76PVB'),
  ('24T-6CL-12A-6CL', '24T 6CL+12A+6CL', '24T 6CL+12A+6CL', 24.00, '6CL', '12A', NULL, '6CL', NULL),
  ('24T-6CL-12A-6LE', '24T 6CL+12A+6로이', '24T 6CL+12A+6로이', 24.00, '6CL', '12A', NULL, '6EMT178', NULL),
  ('22T-5GN-12Ar-5LE', '22T 5newGN+12Ar.+5로이', '22T 5newGN+12Ar.+5로이', 22.00, '5newGN', '12A', 'Ar', '5로이', NULL),
  ('22T-5CL-12Ar-5LE', '22T 5CL+12Ar.+5로이', '22T 5CL+12Ar.+5로이', 22.00, '5CL', '12A', 'Ar', '5로이', NULL),
  ('24T-6GN-12A-6LE', '24T 6newGN+12A+6로이', '24T 6newGN+12A+6로이', 24.00, '6newGN', '12A', NULL, '6로이', NULL),
  ('22T-5GN-12Ar-5DM', '22T 5newGN+12Ar.+5DURA MAX', '22T 5newGN+12Ar.+5DURA MAX', 22.00, '5newGN', '12A', 'Ar', '5DURA MAX', NULL),
  ('22T-5CL-12Ar-5DM', '22T 5CL+12Ar.+5DURA MAX', '22T 5CL+12Ar.+5DURA MAX', 22.00, '5CL', '12A', 'Ar', '5DURA MAX', NULL)
ON CONFLICT (product_code) DO NOTHING;

-- 품명 변환 매핑 (발주서에서 사용되는 다양한 표기)
INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '5CL/0.76PVB/5CL+10ALC+6EMT178',
  '5투명접합+10A+6로이'
]) v WHERE p.product_code = '26.76T-PVB-10A-6LE'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '6CL+12ALC+6CL',
  '6투명+12A+6투명'
]) v WHERE p.product_code = '24T-6CL-12A-6CL'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '6CL+12ALC+6EMT178',
  '6투명+12A+6로이'
]) v WHERE p.product_code = '24T-6CL-12A-6LE'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '5GN+12AR+5LE',
  '그린 로이복층유리'
]) v WHERE p.product_code = '22T-5GN-12Ar-5LE'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '5CL+12AR+5LE',
  '투명 로이복층유리'
]) v WHERE p.product_code = '22T-5CL-12Ar-5LE'
ON CONFLICT DO NOTHING;

INSERT INTO dgflow_product_name_mappings (product_id, variant_name)
SELECT id, v FROM dgflow_products p, unnest(ARRAY[
  '6GN+12A+6LE'
]) v WHERE p.product_code = '24T-6GN-12A-6LE'
ON CONFLICT DO NOTHING;

-- ============================================
-- 원판 마스터 (확인된 4종)
-- ============================================
INSERT INTO dgflow_raw_glasses (glass_type, width_mm, height_mm) VALUES
  ('표준1', 2438, 3353),
  ('표준2', 1981, 3353),
  ('표준3', 1829, 3353),
  ('표준4', 1829, 3048)
ON CONFLICT DO NOTHING;

-- ============================================
-- 거래처/현장 샘플 (주요 거래처)
-- ============================================
INSERT INTO dgflow_customers (name, short_name) VALUES
  ('(주)서해종합건설', '서해건설'),
  ('(주)대진글라스', '대진글라스'),
  ('정석개발(주)', '정석개발'),
  ('극동건설(주)', '극동건설'),
  ('에이치엘디앤아이한라(주)', 'HL한라'),
  ('에스케이에코플랜트(주)', 'SK에코'),
  ('(주)유광건설', '유광건설'),
  ('(주)대원', '대원'),
  ('엘엑스글라스(주)', 'LX글라스'),
  ('대우건설(주)', '대우건설')
ON CONFLICT DO NOTHING;

-- 현장 샘플
INSERT INTO dgflow_sites (customer_id, site_name, address, region_sido, region_sigungu)
SELECT c.id, s.site_name, s.address, s.region_sido, s.region_sigungu
FROM dgflow_customers c,
(VALUES
  ('서해건설', '울산태화강변A-2BL 아파트건설공사 2공구현장', '울산광역시', '울산', '남구'),
  ('대진글라스', '대우건설_산성역헤리스톤3BL현장', '경기도 성남시', '경기', '성남시'),
  ('정석개발', '청주 테크노폴리스 현장', '충청북도 청주시', '충북', '청주시'),
  ('극동건설', '성남금토 A-4BL 아파트', '경기도 성남시', '경기', '성남시'),
  ('HL한라', '파주선유리 후분양 공동주택', '경기도 파주시', '경기', '파주시'),
  ('SK에코', '용인 FAB 1기 지원시설', '경기도 용인시', '경기', '용인시'),
  ('유광건설', '오창 국민체육센터 현장', '충청북도 청주시', '충북', '청주시')
) AS s(short_name, site_name, address, region_sido, region_sigungu)
WHERE c.short_name = s.short_name;
