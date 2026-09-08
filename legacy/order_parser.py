"""발주서 엑셀 파서 - 다양한 양식을 표준 스키마로 변환"""

import re
import pandas as pd
from io import BytesIO


def detect_format(df: pd.DataFrame, sheet_name: str) -> str:
    """발주서 양식을 자동 감지"""
    cols = [str(c).strip() for c in df.columns]
    col_text = " ".join(cols).lower()

    # 기타(품명) + 가로규격 + 세로규격 패턴 → 발주요청 표준
    if "기타" in cols and any("가로" in c for c in cols):
        return "standard_order"
    # 위치 + 규 + 격 + 수량 → ERP불러들이기 / 규격정리
    if "위치" in cols and ("규" in cols or "수량" in cols):
        return "erp_import"
    # NO + 외판/내판 + 두께 패턴 → 이충언 이사
    if any("외판" in c or "내판" in c for c in cols):
        return "lee_format"
    # 위치 + 제품명 + 규격 → 김길홍 과장
    if "위치" in cols and ("제품명" in cols or "제품" in cols):
        return "kim_format"
    # 품목 + 가로 + 세로 → 정석개발 (외주)
    if "품목" in cols and "가로" in cols and "세로" in cols:
        return "external_format"
    # 생산의뢰서 패턴
    if "생산" in col_text or "의뢰" in col_text:
        return "production_request"
    # 발주서 패턴 (공사명, 수신 등)
    if "공사명" in cols or "수신" in cols:
        return "oh_format"

    return "unknown"


def parse_standard_order(df: pd.DataFrame) -> list[dict]:
    """표준 발주요청 양식 파싱 (발주서 프로세스.xlsx STEP 1)"""
    lines = []
    for _, row in df.iterrows():
        product = row.get("기타", "")
        if not product or pd.isna(product):
            continue
        width = row.get("가로규격", 0)
        height = row.get("세로규격", 0)
        qty = row.get("수량", 0)
        if pd.isna(width) or pd.isna(height) or pd.isna(qty):
            continue

        dong = str(row.get("동", "")) if not pd.isna(row.get("동", "")) else ""
        line_info = str(row.get("호수", "")) if not pd.isna(row.get("호수", "")) else ""
        position = str(row.get("창", "")) if not pd.isna(row.get("창", "")) else ""
        type_info = str(row.get("타입", "")) if not pd.isna(row.get("타입", "")) else ""
        division = str(row.get("구분", "")) if not pd.isna(row.get("구분", "")) else ""
        sealant = str(row.get("코킹", "")) if not pd.isna(row.get("코킹", "")) else ""
        remarks = str(row.get("비고", "")) if not pd.isna(row.get("비고", "")) else ""

        location_raw = f"{dong}{line_info}{position}{type_info}{division}"

        lines.append({
            "product_name": str(product).strip(),
            "width_mm": int(float(width)),
            "height_mm": int(float(height)),
            "quantity": int(float(qty)),
            "dong": dong,
            "line": line_info,
            "position": position,
            "type": type_info,
            "window_type": division,
            "location_raw": location_raw,
            "sealant": sealant,
            "remarks": remarks,
        })
    return lines


def parse_erp_import(df: pd.DataFrame) -> list[dict]:
    """ERP불러들이기 양식 파싱 (위치, 규, 격, 수량)"""
    lines = []
    # 컬럼명이 '위치', '규', '격', '수량' 패턴
    col_map = {}
    for c in df.columns:
        cs = str(c).strip()
        if cs == "위치":
            col_map["location"] = c
        elif cs == "규":
            col_map["width"] = c
        elif cs == "격":
            col_map["height"] = c
        elif cs == "수량":
            col_map["quantity"] = c

    if not col_map.get("location"):
        return lines

    for _, row in df.iterrows():
        loc = row.get(col_map.get("location", ""), "")
        if not loc or pd.isna(loc):
            continue
        width = row.get(col_map.get("width", ""), 0)
        height = row.get(col_map.get("height", ""), 0)
        qty = row.get(col_map.get("quantity", ""), 0)
        if pd.isna(width) or pd.isna(height) or pd.isna(qty):
            continue

        lines.append({
            "product_name": "",
            "width_mm": int(float(width)),
            "height_mm": int(float(height)),
            "quantity": int(float(qty)),
            "dong": "",
            "line": "",
            "position": "",
            "type": "",
            "window_type": "",
            "location_raw": str(loc).strip(),
            "sealant": "",
            "remarks": "",
        })
    return lines


def parse_external_format(df: pd.DataFrame) -> list[dict]:
    """외주 발주서 파싱 (정석개발 등: 품목, 가로, 세로, 수량)"""
    lines = []
    for _, row in df.iterrows():
        product = row.get("품목", "")
        if not product or pd.isna(product):
            continue
        width = row.get("가로", 0)
        height = row.get("세로", 0)
        qty = row.get("수량", 0)
        if pd.isna(width) or pd.isna(height) or pd.isna(qty):
            continue
        location = str(row.get("위치/비고", row.get("위치", "")))
        if pd.isna(location):
            location = ""

        lines.append({
            "product_name": str(product).strip(),
            "width_mm": int(float(width)),
            "height_mm": int(float(height)),
            "quantity": int(float(qty)),
            "dong": "",
            "line": "",
            "position": "",
            "type": "",
            "window_type": "",
            "location_raw": location.strip(),
            "sealant": "",
            "remarks": str(row.get("비고", "")) if not pd.isna(row.get("비고", "")) else "",
        })
    return lines


def parse_generic(df: pd.DataFrame) -> list[dict]:
    """알 수 없는 양식 - 가로/세로/수량 컬럼 자동 탐색"""
    lines = []
    cols = list(df.columns)

    # 가로, 세로, 수량에 해당할 수 있는 컬럼 찾기
    width_col = height_col = qty_col = product_col = location_col = None
    for c in cols:
        cs = str(c).strip().lower()
        if "가로" in cs or cs == "규":
            width_col = c
        elif "세로" in cs or cs == "격":
            height_col = c
        elif "수량" in cs:
            qty_col = c
        elif "품" in cs or "제품" in cs or "기타" in cs:
            product_col = c
        elif "위치" in cs:
            location_col = c

    if not (width_col and height_col and qty_col):
        return lines

    for _, row in df.iterrows():
        width = row.get(width_col, 0)
        height = row.get(height_col, 0)
        qty = row.get(qty_col, 0)
        if pd.isna(width) or pd.isna(height) or pd.isna(qty):
            continue
        try:
            w, h, q = int(float(width)), int(float(height)), int(float(qty))
        except (ValueError, TypeError):
            continue
        if w <= 0 or h <= 0 or q <= 0:
            continue

        product = str(row.get(product_col, "")) if product_col and not pd.isna(row.get(product_col, "")) else ""
        location = str(row.get(location_col, "")) if location_col and not pd.isna(row.get(location_col, "")) else ""

        lines.append({
            "product_name": product.strip(),
            "width_mm": w,
            "height_mm": h,
            "quantity": q,
            "dong": "",
            "line": "",
            "position": "",
            "type": "",
            "window_type": "",
            "location_raw": location.strip(),
            "sealant": "",
            "remarks": "",
        })
    return lines


def parse_excel_file(file_bytes: bytes, filename: str) -> dict[str, list[dict]]:
    """엑셀 파일을 파싱하여 시트별 표준 라인 데이터 반환"""
    results = {}

    try:
        if filename.endswith(".xls"):
            xls = pd.ExcelFile(BytesIO(file_bytes), engine="xlrd")
        else:
            xls = pd.ExcelFile(BytesIO(file_bytes), engine="openpyxl")
    except Exception as e:
        return {"error": [{"error": str(e)}]}

    for sheet_name in xls.sheet_names:
        try:
            df = pd.read_excel(xls, sheet_name=sheet_name)
        except Exception:
            continue

        if df.empty or len(df) < 1:
            continue

        fmt = detect_format(df, sheet_name)
        if fmt == "standard_order":
            lines = parse_standard_order(df)
        elif fmt == "erp_import":
            lines = parse_erp_import(df)
        elif fmt == "external_format":
            lines = parse_external_format(df)
        elif fmt == "unknown":
            lines = parse_generic(df)
        else:
            lines = parse_generic(df)

        if lines:
            results[sheet_name] = lines

    return results
