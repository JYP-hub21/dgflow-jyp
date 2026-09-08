"""품명 변환 마스터 및 유틸리티"""

# 발주서 품명 → ERP 품명 변환 테이블
# key: 발주서 원본 표기 (정규화된), value: (ERP 품명, 두께, 구분)
PRODUCT_CONVERSION = {
    "5CL/0.76PVB/5CL+10ALC+6EMT178": ("10.76투명접합+10A+6로이", 26.76, "TP"),
    "5CL/0.76PVB/5CL+10A+6EMT178": ("10.76투명접합+10A+6로이", 26.76, "TP"),
    "6CL+12ALC+6CL": ("6CL+12A+6CL", 24, "TP"),
    "6CL+12A+6CL": ("6CL+12A+6CL", 24, "TP"),
    "6CL+12ALC+6EMT178": ("6CL+12A+6로이", 24, "TP"),
    "6CL+12A+6EMT178": ("6CL+12A+6로이", 24, "TP"),
    "6CL+12A+6로이": ("6CL+12A+6로이", 24, "TP"),
    "5CL+12Ar.+5로이": ("5CL+12A+5로이", 22, "TP"),
    "5CL+12A+5로이": ("5CL+12A+5로이", 22, "TP"),
    "5newGN+12Ar.+5DURA MAX": ("5newGN+12A+5DURA MAX", 22, "TP"),
    "5CL+12Ar.+5CL": ("5CL+12A+5CL", 22, "TP"),
    "5CL+12A+5CL": ("5CL+12A+5CL", 22, "TP"),
}


def normalize_product_name(raw_name: str) -> str:
    """발주서 품명을 정규화 (공백 제거, 대소문자 통일 등)"""
    if not raw_name:
        return ""
    name = raw_name.strip()
    # ALC → A 변환은 매핑 테이블에서 처리
    return name


def convert_product_name(raw_name: str) -> tuple[str, float, str]:
    """발주서 품명 → (ERP 품명, 두께, 구분) 변환.
    매핑이 없으면 원본 그대로 반환."""
    normalized = normalize_product_name(raw_name)
    if normalized in PRODUCT_CONVERSION:
        return PRODUCT_CONVERSION[normalized]
    # 자동 변환 시도: ALC→A, EMT178→로이
    auto = normalized.replace("ALC", "A").replace("EMT178", "로이").replace("Ar.", "A")
    if auto in PRODUCT_CONVERSION:
        return PRODUCT_CONVERSION[auto]
    # 두께 자동 계산 시도
    thickness = estimate_thickness(normalized)
    return (normalized, thickness, "TP")


def estimate_thickness(product_name: str) -> float:
    """품명에서 두께를 추정"""
    import re
    # 패턴: 숫자CL, 숫자PVB, 숫자A 등의 숫자를 모두 합산
    numbers = re.findall(r'(\d+(?:\.\d+)?)', product_name)
    if numbers:
        total = sum(float(n) for n in numbers)
        if total > 10:
            return total
    return 0


def calculate_m2(width_mm: int, height_mm: int, quantity: int) -> float:
    """면적(m2) 계산: 가로mm x 세로mm x 수량 / 1,000,000"""
    return round(width_mm * height_mm * quantity / 1_000_000, 2)


def calculate_area_for_erp(width_mm: int, height_mm: int, quantity: int) -> float:
    """ERP용 면적 계산 (원판 기준, 단가 계산용)
    실제 계산식은 확인 필요 - 현재는 m2 * 환산계수 추정"""
    m2 = width_mm * height_mm * quantity / 1_000_000
    # ERP 면적은 m2와 다른 값 (원판 기준) - 발주서 프로세스.xlsx 참조
    # 예: 1646x1748x17 → m2=48.96, ERP면적=532.76
    # 532.76 / 48.96 ≈ 10.88 (환산계수?)
    # 일단 m2 반환, 정확한 계산식은 확인 필요
    return round(m2, 2)
