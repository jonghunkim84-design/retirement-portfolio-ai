import os
from pathlib import Path
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv()  # fallback: backend/.env 도 허용

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
# 서버 전용 키 (secret 또는 service_role — RLS 를 우회한다). 프론트엔드·VITE_ 변수에 절대 넣지 않는다.
# 없으면 anon 키로 조용히 대체하지 않고 시작 단계에서 실패한다.
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "SUPABASE_URL 과 SUPABASE_SERVICE_KEY 환경변수가 필요합니다. "
        "(서버 전용 키: Supabase 대시보드 › Project Settings › API Keys)"
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
