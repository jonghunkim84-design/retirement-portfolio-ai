import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from routers import assets, dashboard, risk, rebalance, price, summary, withdrawal, config, returns, cashflow, income, networth
from notifier import run_daily_alert

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── APScheduler 인스턴스 ──────────────────────────────────────────────────────
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
    scheduler.start()
    logger.info("[스케줄러] 시작 — 매일 오전 8시 알림 활성")
    yield
    scheduler.shutdown(wait=False)
    logger.info("[스케줄러] 종료")


app = FastAPI(title="은퇴포트폴리오 AI", version="2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(assets.router,     prefix="/api/assets",     tags=["assets"])
app.include_router(dashboard.router,  prefix="/api/dashboard",  tags=["dashboard"])
app.include_router(risk.router,       prefix="/api/risk",       tags=["risk"])
app.include_router(rebalance.router,  prefix="/api/rebalance",  tags=["rebalance"])
app.include_router(price.router,      prefix="/api/price",      tags=["price"])
app.include_router(summary.router,    prefix="/api/summary",    tags=["summary"])
app.include_router(withdrawal.router, prefix="/api/withdrawal", tags=["withdrawal"])
app.include_router(config.router,     prefix="/api/config",     tags=["config"])
app.include_router(returns.router,    prefix="/api/returns",    tags=["returns"])
app.include_router(cashflow.router,   prefix="/api/cashflow",   tags=["cashflow"])
app.include_router(income.router,     prefix="/api/income",     tags=["income"])
app.include_router(networth.router,   prefix="/api/networth",   tags=["networth"])


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "은퇴포트폴리오 AI v2"}


@app.post("/api/alert/test")
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
