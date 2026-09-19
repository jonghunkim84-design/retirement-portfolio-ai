"""pytest 공통 설정.

테스트는 절대 운영 Supabase 에 접속하지 않는다:
database.py 가 import 될 때 필요한 환경변수를 더미 값으로 강제한다
(python-dotenv 는 이미 설정된 환경변수를 덮어쓰지 않으므로 .env 의 실제 값은 무시된다).
"""
import os

os.environ["SUPABASE_URL"] = "https://test-project.supabase.co"
os.environ["SUPABASE_SERVICE_KEY"] = "test-service-key-not-real"
os.environ["ALLOWED_USER_EMAIL"] = "owner@example.com"
os.environ["CRON_SECRET"] = "test-cron-secret-0123456789"
