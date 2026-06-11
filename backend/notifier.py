"""
일일 이메일 알림 모듈
- 매일 오전 8시 자동 실행 (APScheduler)
- 알림 조건:
  1. 만기일이 7일 이내인 자산
  2. 연환산 수익률 < 0% (손실 전환) — 보유 1년 미만은 총수익률 기준
  3. 연금소득세 한도 80% 도달 (연내 1회)
  4. 연금소득세 한도 100% 초과 (연내 1회)
"""

import os
import smtplib
import logging
from datetime import date, datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from utils import get_active_assets

logger = logging.getLogger(__name__)


# ── 수익률 계산 (returns.py 와 동일 로직) ────────────────────────────────────
def _calc_returns(a: dict, today: date) -> dict:
    inv = a.get("investment_amount")
    cur = float(a.get("current_value", 0))
    pd_str = a.get("purchase_date")

    holding_days = None
    if pd_str:
        try:
            holding_days = (today - date.fromisoformat(pd_str)).days
        except Exception:
            pass

    total_return = None
    annual_return = None
    if inv and inv > 0 and cur > 0:
        total_return = round((cur - inv) / inv * 100, 2)
        if holding_days and holding_days >= 365:
            annual_return = round(((cur / inv) ** (365 / holding_days) - 1) * 100, 2)

    return {**a, "holding_days": holding_days,
            "total_return": total_return, "annual_return": annual_return,
            "under_one_year": (holding_days is not None and holding_days < 365)}


# ── 알림 대상 추출 ────────────────────────────────────────────────────────────
def collect_alerts() -> dict:
    today = date.today()
    assets = get_active_assets()
    results = [_calc_returns(a, today) for a in assets]

    # 1) 만기 임박 (오늘~7일 이내)
    maturing = []
    for a in results:
        md = a.get("maturity_date")
        if md:
            try:
                diff = (date.fromisoformat(md) - today).days
                if 0 <= diff <= 7:
                    maturing.append({**a, "days_left": diff})
            except Exception:
                pass

    # 2) 수익률 손실 전환
    #    - 1년 이상 보유 → annual_return < 0
    #    - 1년 미만 보유 → total_return < 0
    losing = []
    for a in results:
        if a.get("investment_amount") is None:
            continue   # 입금액 없으면 계산 불가 → 제외
        if a.get("under_one_year"):
            if a.get("total_return") is not None and a["total_return"] < 0:
                losing.append(a)
        else:
            if a.get("annual_return") is not None and a["annual_return"] < 0:
                losing.append(a)

    return {"maturing": maturing, "losing": losing, "today": today}


# ── 연금소득세 한도 알림 ──────────────────────────────────────────

def _pension_alert_already_sent(notification_type: str, year: int) -> bool:
    """notification_log 테이블로 연내 중복 발송 여부 확인."""
    from database import supabase
    res = supabase.table("notification_log").select("id") \
        .eq("notification_type", notification_type) \
        .eq("year", year).execute()
    return bool(res.data)


def _record_pension_alert(notification_type: str, year: int):
    """발송 이력 기록 (UNIQUE 제약으로 중복 무시)."""
    from database import supabase
    try:
        supabase.table("notification_log").insert({
            "notification_type": notification_type,
            "year":              year,
        }).execute()
    except Exception:
        pass  # UNIQUE 충돌 시 무시


def collect_pension_alerts() -> list:
    """
    연금소득세 한도 알림 대상 수집.
    반환: [{"type": "pension_80pct"|"pension_100pct", "pct": float, "ytd": float}] 또는 []
    """
    from routers.pension_tax import calc_limit_breakdown
    from tax_constants import PRIVATE_PENSION_ANNUAL_LIMIT
    from utils import get_config
    from database import supabase

    today  = date.today()
    year   = today.year
    config = get_config()
    plan   = config.get("pension_plan") or {}

    all_withdrawals = (
        supabase.table("withdrawals").select("*").order("withdrawal_date").execute().data or []
    )

    ytd_total = calc_limit_breakdown(year, all_withdrawals, plan)["ytd_total"]
    pct = ytd_total / PRIVATE_PENSION_ANNUAL_LIMIT * 100

    alerts = []

    if pct >= 100 and not _pension_alert_already_sent("pension_100pct", year):
        alerts.append({"type": "pension_100pct", "pct": pct, "ytd": ytd_total})
    elif pct >= 80 and not _pension_alert_already_sent("pension_80pct", year):
        alerts.append({"type": "pension_80pct", "pct": pct, "ytd": ytd_total})

    return alerts


# ── HTML 이메일 본문 생성 ──────────────────────────────────────────────────────
def _build_pension_html(pension_alerts: list, today_str: str) -> str:
    """연금소득세 한도 알림 HTML 섹션 생성."""
    sections = []
    for a in pension_alerts:
        pct_str  = f"{a['pct']:.1f}%"
        ytd_str  = f"₩{int(a['ytd']):,}"
        if a["type"] == "pension_100pct":
            sections.append(f"""
            <h3 style="color:#dc2626;margin:24px 0 8px">🚨 사적연금 한도 초과</h3>
            <p style="font-size:14px;color:#374151;margin:0 0 8px">
              올해 사적연금 수령액(<strong>{ytd_str}</strong>, {pct_str})이 연 1,500만원 한도를 초과했습니다.
            </p>
            <p style="font-size:13px;color:#6b7280;margin:0">
              한도 초과분을 포함한 <strong>전액</strong>이 16.5% 분리과세 또는 종합과세 선택 대상이 됩니다.
              세무사 상담을 권장합니다.
            </p>""")
        else:
            sections.append(f"""
            <h3 style="color:#d97706;margin:24px 0 8px">⚠️ 사적연금 한도 80% 도달</h3>
            <p style="font-size:14px;color:#374151;margin:0 0 8px">
              올해 사적연금 수령액(<strong>{ytd_str}</strong>)이 연 1,500만원 한도의 {pct_str}에 도달했습니다.
            </p>
            <p style="font-size:13px;color:#6b7280;margin:0">
              잔여 한도: ₩{int(15_000_000 - a['ytd']):,} — 한도 이내로 수령을 유지하면 저율 분리과세가 적용됩니다.
            </p>""")
    return "\n".join(sections)


def _price_summary_line(price_summary) -> str:
    """시세 갱신 결과 한 줄 요약. 갱신 대상이 0건이면 빈 문자열."""
    if not price_summary:
        return ""
    updated = price_summary.get("updated", 0)
    failed  = price_summary.get("failed", 0)
    if updated + failed == 0:
        return ""
    line = f"시세 갱신: {updated}종목 성공"
    if failed:
        failed_names = [
            d.get("asset_name") or "?"
            for d in (price_summary.get("details") or [])
            if d.get("status") == "failed"
        ]
        line += f", {failed}종목 실패({', '.join(failed_names)})"
    return line


def _build_html(alerts: dict) -> str:
    today_str = alerts["today"].strftime("%Y년 %m월 %d일")
    maturing  = alerts["maturing"]
    losing    = alerts["losing"]

    def fmt_won(v):
        if v is None:
            return "-"
        return f"₩{int(v):,}"

    def return_cell(a):
        if a.get("under_one_year"):
            r = a.get("total_return")
            label = "총수익"
        else:
            r = a.get("annual_return")
            label = "연환산"
        if r is None:
            return "-"
        sign = "+" if r >= 0 else ""
        color = "#2563eb" if r >= 0 else "#dc2626"
        return f'<span style="color:{color};font-weight:600">{sign}{r:.2f}% ({label})</span>'

    # 알림이 하나도 없으면 발송 안 함 (호출부에서 처리)
    sections = []

    if maturing:
        rows = "".join(
            f"""<tr>
              <td style="padding:6px 10px">{a['asset_name']}</td>
              <td style="padding:6px 10px">{a['account_name']}</td>
              <td style="padding:6px 10px;text-align:center;color:#dc2626;font-weight:600">{a['days_left']}일 후</td>
              <td style="padding:6px 10px;text-align:right">{fmt_won(a['current_value'])}</td>
            </tr>"""
            for a in maturing
        )
        sections.append(f"""
        <h3 style="color:#dc2626;margin:24px 0 8px">⏰ 만기 임박 자산 ({len(maturing)}건)</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#fee2e2;color:#7f1d1d">
              <th style="padding:6px 10px;text-align:left">자산명</th>
              <th style="padding:6px 10px;text-align:left">계좌</th>
              <th style="padding:6px 10px">남은 기간</th>
              <th style="padding:6px 10px;text-align:right">평가액</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
        <p style="font-size:12px;color:#6b7280;margin:6px 0 0">
          → 만기 후 재투자 계획을 확인하고 자산 관리 탭에서 업데이트 해주세요.
        </p>""")

    if losing:
        rows = "".join(
            f"""<tr>
              <td style="padding:6px 10px">{a['asset_name']}</td>
              <td style="padding:6px 10px">{a['account_name']}</td>
              <td style="padding:6px 10px;text-align:right">{fmt_won(a.get('investment_amount'))}</td>
              <td style="padding:6px 10px;text-align:right">{fmt_won(a['current_value'])}</td>
              <td style="padding:6px 10px;text-align:right">{return_cell(a)}</td>
            </tr>"""
            for a in losing
        )
        sections.append(f"""
        <h3 style="color:#dc2626;margin:24px 0 8px">📉 수익률 손실 전환 자산 ({len(losing)}건)</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#fee2e2;color:#7f1d1d">
              <th style="padding:6px 10px;text-align:left">자산명</th>
              <th style="padding:6px 10px;text-align:left">계좌</th>
              <th style="padding:6px 10px;text-align:right">입금액</th>
              <th style="padding:6px 10px;text-align:right">현재 평가액</th>
              <th style="padding:6px 10px;text-align:right">수익률</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
        <p style="font-size:12px;color:#6b7280;margin:6px 0 0">
          * 1년 미만 보유 자산은 총수익률 기준 / 1년 이상은 연환산 수익률 기준
        </p>""")

    # 연금소득세 알림 섹션 (alerts dict에 pension_alerts 키가 있으면 추가)
    pension_section = ""
    if alerts.get("pension_alerts"):
        pension_section = _build_pension_html(alerts["pension_alerts"], today_str)

    body_content = "\n".join(sections) + pension_section

    # 시세 갱신 요약 한 줄 (갱신 대상 0건이면 생략)
    price_line = _price_summary_line(alerts.get("price_summary"))
    if price_line:
        body_content = (
            f'<p style="font-size:12px;color:#6b7280;margin:0 0 4px">📈 {price_line}</p>'
            + body_content
        )

    return f"""<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Apple SD Gothic Neo',Malgun Gothic,sans-serif">
  <div style="max-width:640px;margin:32px auto;background:#fff;border-radius:12px;
              box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden">

    <!-- 헤더 -->
    <div style="background:linear-gradient(135deg,#1e3a5f,#1a5c96);padding:24px 28px">
      <div style="color:#fff;font-size:18px;font-weight:700">🏦 은퇴포트폴리오 AI</div>
      <div style="color:#bfdbfe;font-size:13px;margin-top:4px">{today_str} · 오전 8시 자동 알림</div>
    </div>

    <!-- 본문 -->
    <div style="padding:24px 28px">
      <p style="margin:0 0 4px;font-size:14px;color:#374151">
        안녕하세요, 오늘의 포트폴리오 알림입니다.
      </p>
      {body_content}
    </div>

    <!-- 푸터 -->
    <div style="background:#f9fafb;padding:14px 28px;border-top:1px solid #e5e7eb">
      <p style="margin:0;font-size:11px;color:#9ca3af">
        이 메일은 은퇴포트폴리오 AI 시스템이 자동 발송합니다.
        설정 변경은 앱의 ⚙️ 설정 탭을 이용해주세요.
      </p>
    </div>
  </div>
</body>
</html>"""


# ── 이메일 발송 ───────────────────────────────────────────────────────────────
def send_alert_email(alerts: dict) -> bool:
    """알림 메일 발송. 알림 없으면 발송 생략 → False 반환."""
    if not alerts["maturing"] and not alerts["losing"] and not alerts.get("pension_alerts"):
        logger.info("[알림] 발송 대상 없음 — 오늘은 알림 생략")
        return False

    gmail_user = os.getenv("GMAIL_ADDRESS")
    gmail_pw   = os.getenv("GMAIL_APP_PASSWORD")
    to_addr    = os.getenv("ALERT_EMAIL", gmail_user)   # 수신 주소 (기본=발신자 동일)

    if not gmail_user or not gmail_pw:
        logger.error("[알림] GMAIL_ADDRESS / GMAIL_APP_PASSWORD 환경변수 미설정")
        return False

    today_str = alerts["today"].strftime("%Y.%m.%d")
    cnt = len(alerts["maturing"]) + len(alerts["losing"]) + len(alerts.get("pension_alerts") or [])
    subject = f"[은퇴포트폴리오] {today_str} 알림 — 주의 항목 {cnt}건"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = gmail_user
    msg["To"]      = to_addr

    # plain-text fallback
    plain_lines = [f"은퇴포트폴리오 AI 알림 — {today_str}"]
    price_line = _price_summary_line(alerts.get("price_summary"))
    if price_line:
        plain_lines.append(price_line)
    if alerts["maturing"]:
        plain_lines.append(f"\n[만기 임박 자산 {len(alerts['maturing'])}건]")
        for a in alerts["maturing"]:
            plain_lines.append(f"  · {a['asset_name']} ({a['account_name']}) — {a['days_left']}일 후 만기")
    if alerts["losing"]:
        plain_lines.append(f"\n[손실 전환 자산 {len(alerts['losing'])}건]")
        for a in alerts["losing"]:
            r = a.get("total_return" if a.get("under_one_year") else "annual_return")
            plain_lines.append(f"  · {a['asset_name']} ({a['account_name']}) — {r:.2f}%")

    msg.attach(MIMEText("\n".join(plain_lines), "plain", "utf-8"))
    msg.attach(MIMEText(_build_html(alerts), "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as server:
            server.login(gmail_user, gmail_pw)
            server.sendmail(gmail_user, to_addr, msg.as_string())
        logger.info(f"[알림] 메일 발송 완료 → {to_addr}  (만기:{len(alerts['maturing'])} 손실:{len(alerts['losing'])})")
        return True
    except Exception as e:
        logger.error(f"[알림] 메일 발송 실패: {e}")
        return False


# ── 만기 자산 자동 비활성화 ───────────────────────────────────────────────────
def auto_deactivate_expired() -> list:
    """만기일이 오늘 이전인 활성 자산을 자동으로 비활성 처리한다.
    Returns: 비활성 처리된 자산 목록
    """
    from database import supabase
    from datetime import datetime

    today_str = date.today().isoformat()   # "2025-05-29"

    # 만기일이 어제 이전이고 현재 활성인 자산 조회
    res = (
        supabase.table("assets")
        .select("id, asset_name, account_name, maturity_date")
        .eq("is_active", True)
        .not_.is_("maturity_date", "null")
        .lt("maturity_date", today_str)   # maturity_date < today
        .execute()
    )
    expired = res.data or []

    if not expired:
        logger.info("[자동비활성] 만기 도래 자산 없음")
        return []

    ids = [a["id"] for a in expired]
    supabase.table("assets").update({
        "is_active": False,
        "updated_at": datetime.now().isoformat(),
    }).in_("id", ids).execute()

    for a in expired:
        logger.info(f"[자동비활성] {a['asset_name']} ({a['account_name']}) 만기 {a['maturity_date']} → 비활성 처리")

    return expired


# ── 스케줄러·Cron 공용 진입점 ────────────────────────────────────────────────
def run_daily_alert() -> dict:
    """매일 오전 8시 일일 점검 — APScheduler(로컬)와 Vercel Cron(/alert/daily) 공용.

    실행 순서: ① 시세 갱신 → ② 만기 자산 자동 비활성화 → ③ 이메일 알림.
    시세를 먼저 갱신해야 손실 전환 알림이 당일 갱신가 기준으로 판정된다.
    각 단계는 실패해도 다음 단계가 반드시 실행되도록 격리한다.
    """
    logger.info("[알림] 일일 점검 시작")

    # ① 시세 갱신 — 수동 버튼과 동일한 함수 사용
    price_summary = None
    try:
        from routers.price import run_price_update
        price_summary = run_price_update()
        logger.info(f"[알림] 시세 갱신 완료 — 성공 {price_summary['updated']}건 / 실패 {price_summary['failed']}건")
    except Exception as e:
        logger.error(f"[알림] 시세 갱신 단계 실패 (이후 단계는 계속 진행): {e}")

    # ② 만기 도래 자산 자동 비활성화
    deactivated = []
    try:
        deactivated = auto_deactivate_expired()
        if deactivated:
            logger.info(f"[알림] 자동 비활성 처리 완료 — {len(deactivated)}건")
    except Exception as e:
        logger.error(f"[알림] 만기 비활성화 단계 실패 (알림은 계속 진행): {e}")

    # ③ 알림 수집 후 발송
    sent = False
    alerts = {"maturing": [], "losing": [], "pension_alerts": []}
    try:
        alerts = collect_alerts()
        pension_alerts = collect_pension_alerts()
        alerts["pension_alerts"] = pension_alerts
        alerts["price_summary"] = price_summary

        sent = send_alert_email(alerts)

        # 연금소득세 알림 발송 이력 기록 (연내 중복 방지)
        if sent and pension_alerts:
            for pa in pension_alerts:
                _record_pension_alert(pa["type"], date.today().year)
                logger.info(f"[알림] 연금소득세 알림 발송 완료 — type={pa['type']}, pct={pa['pct']:.1f}%")
    except Exception as e:
        logger.error(f"[알림] 알림 발송 단계 실패: {e}")

    return {
        "sent":              sent,
        "price_updated":     price_summary["updated"] if price_summary else None,
        "price_failed":      price_summary["failed"] if price_summary else None,
        "deactivated_count": len(deactivated),
        "maturing_count":    len(alerts.get("maturing") or []),
        "losing_count":      len(alerts.get("losing") or []),
        "pension_count":     len(alerts.get("pension_alerts") or []),
    }
