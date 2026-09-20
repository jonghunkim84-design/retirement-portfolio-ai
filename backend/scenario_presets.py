"""단일 충격 시나리오 프리셋 (지시서 04 §7.4). 코드가 아니라 데이터로 관리하는 상수 모듈.

단위: rate/inflation 은 delta_pp(퍼센트포인트, 1.0 = 1%p), equity/fx 는 pct(비율, 0.2 = 20%).
프리셋을 바꾸려면 이 파일만 고치면 된다 (계산 모듈은 프리셋을 참조하지 않는다).
"""

SCENARIO_PRESETS = [
    {"id": "rate_up_1",     "kind": "rate",      "label": "금리 +1%p",            "params": {"delta_pp": 1.0}},
    {"id": "rate_down_1",   "kind": "rate",      "label": "금리 −1%p",            "params": {"delta_pp": -1.0}},
    {"id": "equity_down_20", "kind": "equity",   "label": "주가 −20%",            "params": {"mode": "uniform", "pct": 0.2}},
    {"id": "fx_down_10",    "kind": "fx",        "label": "원/달러 −10% (원화 강세)", "params": {"currency": "USD", "pct": -0.10}},
    {"id": "fx_up_10",      "kind": "fx",        "label": "원/달러 +10% (원화 약세)", "params": {"currency": "USD", "pct": 0.10}},
    {"id": "inflation_up_2", "kind": "inflation", "label": "물가 +2%p (1년)",      "params": {"delta_pp": 2.0}},
]
