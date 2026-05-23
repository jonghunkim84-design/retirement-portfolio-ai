@echo off
chcp 65001 > nul
title FastAPI 백엔드 (자동재시작)
:loop
echo.
echo ============================================
echo  [백엔드] FastAPI 서버 시작 중... (포트 8000)
echo ============================================
python -m uvicorn main:app --reload --port 8000
echo.
echo  *** 서버가 종료됐습니다. 3초 후 자동 재시작... ***
timeout /t 3 /nobreak > nul
goto loop
