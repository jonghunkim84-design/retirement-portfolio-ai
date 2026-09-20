import os
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import assets, dashboard, risk, rebalance, price, summary, config, returns, cashflow, income, networth, ai_advisor, tax, export, withdrawals as withdrawals_router, pension_tax, expenses, withdrawal_strategy, real_assets, estate, simulation, holding_profiles, cashflow_items, withdrawal_baseline, sub_allocation_targets, withdrawal_check, ips_rules, decision_engine, decision_log, market, exposure
from notifier import run_daily_alert
from auth import require_user, require_cron

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Vercel 서버리스 환경 감지 (Vercel은 자동으로 VERCEL=1 환경변수를 설정함)
IS_VERCEL = bool(os.getenv("VERCEL"))

# ── APScheduler 인스턴스 (로컬 전용 — Vercel에서는 Cron Job으로 대체) ──────────
if not IS_VERCEL:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger

    scheduler = BackgroundScheduler(timezone="Asia/Seoul")
    scheduler.add_job(
        run_daily_alert,
        trigger=CronTrigger(hour=8, minute=0, timezone="Asia/Seoul"),
        id="daily_alert",
        replace_existing=True,
        misfire_grace_time=300,   # 5분 내 재실행 허용
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not IS_VERCEL:
        scheduler.start()
        logger.info("[스케줄러] 시작 — 매일 오전 8시 알림 활성")
    else:
        logger.info("[Vercel] 서버리스 환경 — 스케줄러 비활성화 (Vercel Cron 사용)")
    yield
    if not IS_VERCEL:
        scheduler.shutdown(wait=False)
        logger.info("[스케줄러] 종료")


# 모든 API 는 로그인 토큰 검증을 거친다. 예외: /health(공개), /alert/daily(크론 시크릿)
_AUTH = [Depends(require_user)]

# 운영(Vercel)에서는 API 문서·스키마를 공개하지 않는다 (로컬 개발에서는 /docs 유지)
_DOCS = {"docs_url": None, "redoc_url": None, "openapi_url": None} if IS_VERCEL else {}

app = FastAPI(title="은퇴포트폴리오 AI", version="2.0", lifespan=lifespan, **_DOCS)

# ── CORS 설정 ─────────────────────────────────────────────────────────────────
if IS_VERCEL:
    # Vercel: 프론트·백이 같은 도메인(same-origin) → 와일드카드 허용
    # allow_credentials=True 는 allow_origins=["*"] 와 함께 사용 불가
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # 로컬 개발: ALLOWED_ORIGINS 환경변수 또는 기본 localhost 허용
    _raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in _raw.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(assets.router,     prefix="/assets",     tags=["assets"], dependencies=_AUTH)
app.include_router(dashboard.router,  prefix="/dashboard",  tags=["dashboard"], dependencies=_AUTH)
app.include_router(risk.router,       prefix="/risk",       tags=["risk"], dependencies=_AUTH)
app.include_router(rebalance.router,  prefix="/rebalance",  tags=["rebalance"], dependencies=_AUTH)
app.include_router(price.router,      prefix="/price",      tags=["price"], dependencies=_AUTH)
app.include_router(summary.router,    prefix="/summary",    tags=["summary"], dependencies=_AUTH)
app.include_router(config.router,     prefix="/config",     tags=["config"], dependencies=_AUTH)
app.include_router(returns.router,    prefix="/returns",    tags=["returns"], dependencies=_AUTH)
app.include_router(cashflow.router,   prefix="/cashflow",   tags=["cashflow"], dependencies=_AUTH)
app.include_router(income.router,     prefix="/income",     tags=["income"], dependencies=_AUTH)
app.include_router(networth.router,    prefix="/networth",    tags=["networth"], dependencies=_AUTH)
app.include_router(ai_advisor.router, prefix="/ai",           tags=["ai"], dependencies=_AUTH)
app.include_router(tax.router,              prefix="/tax",          tags=["tax"], dependencies=_AUTH)
app.include_router(export.router,          prefix="/export",       tags=["export"], dependencies=_AUTH)
app.include_router(withdrawals_router.router, prefix="/withdrawals", tags=["withdrawals"], dependencies=_AUTH)
app.include_router(pension_tax.router,     prefix="/pension-tax",  tags=["pension-tax"], dependencies=_AUTH)
app.include_router(expenses.router,        prefix="/expenses",     tags=["expenses"], dependencies=_AUTH)
app.include_router(withdrawal_strategy.router, prefix="/withdrawal-strategy", tags=["withdrawal-strategy"], dependencies=_AUTH)
app.include_router(real_assets.router,     prefix="/real-assets",  tags=["real-assets"], dependencies=_AUTH)
app.include_router(estate.router,          prefix="/estate",       tags=["estate"], dependencies=_AUTH)
app.include_router(simulation.router,      prefix="/simulation",   tags=["simulation"], dependencies=_AUTH)
app.include_router(holding_profiles.router, prefix="/holding-profiles", tags=["withdrawal-data"], dependencies=_AUTH)
app.include_router(cashflow_items.router,   prefix="/cashflow-items",   tags=["withdrawal-data"], dependencies=_AUTH)
app.include_router(withdrawal_baseline.router, prefix="/withdrawal-baseline", tags=["withdrawal-data"], dependencies=_AUTH)
app.include_router(sub_allocation_targets.router, prefix="/sub-allocation-targets", tags=["withdrawal-data"], dependencies=_AUTH)
app.include_router(withdrawal_check.router, prefix="/withdrawal-check", tags=["withdrawal-check"], dependencies=_AUTH)
app.include_router(ips_rules.router, prefix="/ips-rules", tags=["decision-engine"], dependencies=_AUTH)
app.include_router(decision_engine.router, prefix="/decision-engine", tags=["decision-engine"], dependencies=_AUTH)
app.include_router(decision_log.router, prefix="/decision-log", tags=["decision-engine"], dependencies=_AUTH)
app.include_router(market.router, prefix="/market", tags=["market"], dependencies=_AUTH)
app.include_router(market.cron_router, prefix="/market", tags=["market"], dependencies=[Depends(require_cron)])   # 크론: GET /market/refresh
app.include_router(exposure.router, prefix="/exposure", tags=["market"], dependencies=_AUTH)


@app.get("/health")
def health():
    return {"status": "ok", "service": "은퇴포트폴리오 AI v2"}


@app.post("/alert/test", dependencies=_AUTH)
def test_alert():
    """알림 즉시 발송 테스트용 엔드포인트 (개발/검증용)"""
    from notifier import collect_alerts, send_alert_email
    alerts = collect_alerts()
    sent   = send_alert_email(alerts)
    return {
        "sent": sent,
        "maturing_count": len(alerts["maturing"]),
        "losing_count":   len(alerts["losing"]),
        "maturing": [{"name": a["asset_name"], "days_left": a["days_left"]} for a in alerts["maturing"]],
        "losing":   [{"name": a["asset_name"],
                      "return": a.get("total_return" if a.get("under_one_year") else "annual_return")}
                     for a in alerts["losing"]],
    }


@app.post("/assets/deactivate-expired", dependencies=_AUTH)
def deactivate_expired():
    """만기 도래 자산 수동 비활성화 — 앱에서 직접 호출 가능"""
    from notifier import auto_deactivate_expired
    deactivated = auto_deactivate_expired()
    return {
        "deactivated_count": len(deactivated),
        "deactivated": [
            {"id": a["id"], "asset_name": a["asset_name"],
             "account_name": a["account_name"], "maturity_date": a["maturity_date"]}
            for a in deactivated
        ],
    }


@app.api_route("/alert/daily", methods=["GET", "POST"], dependencies=[Depends(require_cron)])
def daily_alert_cron():
    """Vercel Cron Job 전용 엔드포인트 — 매일 오전 8시 KST (23:00 UTC) 자동 호출
    vercel.json의 crons 설정에 의해 호출됨 (Vercel은 GET 요청 사용).
    로컬 APScheduler와 동일한 run_daily_alert() 사용:
    ① 시세 갱신 → ② 만기 자산 자동 비활성화 → ③ 이메일 알림
    """
    result = run_daily_alert()
    logger.info(f"[Cron] 일일 점검 완료 — {result}")
    return result
