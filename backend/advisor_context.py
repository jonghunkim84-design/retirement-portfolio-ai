"""포트폴리오 컨텍스트 빌더 — AI 어드바이저 시스템 프롬프트 주입용."""
from datetime import date, datetime, timedelta

from database import supabase
from tax_constants import PRIVATE_PENSION_ANNUAL_LIMIT
from utils import EXPECTED_RETURN, calculate_buckets, get_active_assets, get_config


def _fmt_won(v: float) -> str:
    return f"{int(v):,}원"


def _fmt_man(v: float) -> str:
    return f"{int(v / 10_000):,}만원"


def build_portfolio_context(question: str = "") -> str:
    """
    사용자의 실제 포트폴리오 데이터를 한국어 요약 텍스트로 반환.
    question에 자산명·티커가 포함되면 해당 자산 상세를 조건부 추가.
    데이터 없는 섹션은 생략한다.
    """
    today   = date.today()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    config = get_config()
    assets = get_active_assets()

    if not assets:
        return f"[기준 시각] {now_str}\n\n포트폴리오 데이터가 없습니다."

    sections: list[str] = [f"[기준 시각] {now_str}"]

    # ── 자산 현황 ────────────────────────────────────────────────
    buckets = calculate_buckets(assets, config)
    targets = config.get("portfolio", {})
    total   = buckets["total"]

    def _pct(v: float) -> float:
        return round(v / total * 100, 1) if total else 0.0

    t_cash   = round(targets.get("target_cash",   0.25) * 100, 1)
    t_bond   = round(targets.get("target_bond",   0.25) * 100, 1)
    t_equity = round(targets.get("target_equity", 0.35) * 100, 1)
    t_income = round(targets.get("target_income", 0.15) * 100, 1)

    bucket_line = (
        f"현금성 {_pct(buckets['cash_total'])}%/{t_cash}% | "
        f"채권/TDF/펀드 {_pct(buckets['bond_total'])}%/{t_bond}% | "
        f"주식형 {_pct(buckets['equity_total'])}%/{t_equity}% | "
        f"인컴 {_pct(buckets['income_total'])}%/{t_income}%"
    )

    asset_lines = [
        "[자산 현황]",
        f"총자산(활성): {_fmt_won(total)}",
        f"버킷별 현재/목표: {bucket_line}",
    ]

    cutoff_7  = (today + timedelta(days=7)).isoformat()
    cutoff_90 = (today + timedelta(days=90)).isoformat()

    maturing_7 = sorted(
        [a for a in assets if a.get("maturity_date") and a["maturity_date"][:10] <= cutoff_7],
        key=lambda a: a["maturity_date"],
    )
    if maturing_7:
        strs = [
            f"{a['asset_name']} {_fmt_man(a['current_value'])} ({a['maturity_date'][5:10]} 만기)"
            for a in maturing_7
        ]
        asset_lines.append(f"만기 임박(7일 이내): {' / '.join(strs)}")

    maturing_90 = sorted(
        [a for a in assets
         if a.get("maturity_date")
         and cutoff_7 < a["maturity_date"][:10] <= cutoff_90],
        key=lambda a: a["maturity_date"],
    )
    if maturing_90:
        strs = []
        for a in maturing_90[:3]:
            days_left = (date.fromisoformat(a["maturity_date"][:10]) - today).days
            strs.append(f"{a['asset_name']} {_fmt_man(a['current_value'])} ({days_left}일 후)")
        asset_lines.append(f"만기 예정(90일 이내): {' / '.join(strs)}")

    sections.append("\n".join(asset_lines))

    # ── 수익률 ──────────────────────────────────────────────────
    weighted_sum  = 0.0
    weight_total  = 0.0
    has_actual    = False
    loss_assets: list[dict] = []

    for a in assets:
        cur    = float(a.get("current_value", 0))
        inv    = a.get("investment_amount")
        pd_str = a.get("purchase_date")

        total_ret: float | None = None
        if inv and float(inv) > 0 and cur > 0:
            total_ret = (cur / float(inv) - 1) * 100

        annual: float | None = None
        if inv and float(inv) > 0 and cur > 0 and pd_str:
            try:
                holding = (today - date.fromisoformat(str(pd_str)[:10])).days
                if holding >= 365:
                    annual    = ((cur / float(inv)) ** (365 / holding) - 1) * 100
                    has_actual = True
            except Exception:
                pass

        if annual is None:
            annual = EXPECTED_RETURN.get(a.get("asset_type", ""), 0.05) * 100

        weighted_sum += annual * cur
        weight_total += cur

        if total_ret is not None and total_ret < 0:
            loss_assets.append({"name": a["asset_name"], "ret": round(total_ret, 1)})

    portfolio_ret = round(weighted_sum / weight_total, 1) if weight_total > 0 else 5.0
    src_label     = "실측+추정" if has_actual else "추정(장기 평균)"

    ret_lines = [
        "[수익률]",
        f"포트폴리오 연환산: {portfolio_ret}% ({src_label})",
    ]
    if loss_assets:
        loss_strs = [f"{a['name']} {a['ret']}%" for a in loss_assets[:3]]
        ret_lines.append(f"손실 자산: {' / '.join(loss_strs)}")

    sections.append("\n".join(ret_lines))

    # ── 연금 계획 가정 ─────────────────────────────────────────
    user_cfg         = config.get("user", {})
    birth_year       = user_cfg.get("birth_year")
    monthly_expenses = float(user_cfg.get("monthly_expense", 5_000_000))
    inflation_rate   = config.get("inflation", {}).get("assumed_rate", 0.025)
    plan_return      = config.get("plan", {}).get("target_annual_return")

    age = (today.year - int(birth_year)) if birth_year else None

    pension_parts: list[str] = []
    if age:
        pension_parts.append(f"현재 나이 {age}세")
    pension_parts.append(f"월 생활비 {_fmt_man(monthly_expenses)}")
    pension_parts.append(f"물가상승률 {round(inflation_rate * 100, 1)}%")
    if plan_return is not None:
        pension_parts.append(f"계획 수익률 {round(plan_return * 100, 1)}%")

    np_cfg   = config.get("income", {}).get("national_pension", {})
    np_start = np_cfg.get("start_date")
    np_base  = float(np_cfg.get("base_amount", 0))
    if np_start and np_base > 0 and birth_year:
        np_year, np_month = int(np_start.split("-")[0]), int(np_start.split("-")[1])
        if today >= date(np_year, np_month, 1):
            np_status = "수령 중"
        else:
            np_age    = np_year - int(birth_year)
            np_status = f"{np_age}세 개시 예정"
        pension_parts.append(f"국민연금: 월 {_fmt_man(np_base)} ({np_status})")

    if pension_parts:
        sections.append("[연금 계획 가정]\n" + " / ".join(pension_parts))

    # ── 연금 세금 한도 현황 ───────────────────────────────────
    try:
        from routers.pension_tax import calc_limit_breakdown  # 지연 임포트 (순환 방지)
        pension_plan = config.get("pension_plan") or {}
        wd_res = (
            supabase.table("withdrawals")
            .select("withdrawal_date,amount,tax_account_type")
            .gte("withdrawal_date", f"{today.year}-01-01")
            .lte("withdrawal_date", f"{today.year}-12-31")
            .execute()
        )
        all_wd = wd_res.data or []
        if all_wd or pension_plan:
            limit_info = calc_limit_breakdown(today.year, all_wd, pension_plan)
            ytd_total  = limit_info["ytd_total"]
            limit      = PRIVATE_PENSION_ANNUAL_LIMIT
            pct_used   = round(ytd_total / limit * 100, 1) if limit > 0 else 0
            sections.append(
                "[연금 세금]\n"
                f"올해 한도 대상 인출: {_fmt_man(ytd_total)} / {_fmt_man(limit)} ({pct_used}%)"
            )
    except Exception:
        pass  # 연금 세금 데이터 없으면 섹션 생략

    # ── 위험 점수 ─────────────────────────────────────────────
    try:
        risk_res = (
            supabase.table("risk_scores")
            .select("total_score,level")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if risk_res.data:
            rs           = risk_res.data[0]
            level_label  = {"green": "낮음", "yellow": "보통", "red": "높음"}.get(rs["level"], rs["level"])
            sections.append(f"[위험 점수]\n{rs['total_score']}점/100 ({level_label})")
    except Exception:
        pass

    # ── 조건부: 질문 관련 자산 상세 ───────────────────────────
    if question:
        mentioned = [
            a for a in assets
            if a["asset_name"] in question
            or (a.get("ticker") and a["ticker"] in question)
        ]
        if mentioned:
            detail_lines = ["[질문 관련 자산 상세]"]
            for a in mentioned:
                parts = [
                    f"자산명: {a['asset_name']}",
                    f"유형: {a.get('asset_type', '?')}",
                    f"현재가: {_fmt_won(a['current_value'])}",
                ]
                if a.get("quantity"):
                    parts.append(f"수량: {a['quantity']}")
                if a.get("investment_amount"):
                    inv = float(a["investment_amount"])
                    cur = float(a["current_value"])
                    ret = round((cur / inv - 1) * 100, 1) if inv > 0 else None
                    parts.append(f"투자금액: {_fmt_won(inv)}")
                    if ret is not None:
                        parts.append(f"총 수익률: {ret:+.1f}%")
                if a.get("maturity_date"):
                    parts.append(f"만기: {a['maturity_date'][:10]}")
                detail_lines.append("  " + " | ".join(parts))
            sections.append("\n".join(detail_lines))

    return "\n\n".join(sections)
