@echo off
chcp 65001 > nul
title React 프론트엔드 (자동재시작)
:loop
echo.
echo ============================================
echo  [프론트엔드] React 앱 시작 중... (포트 5173)
echo ============================================
npm run dev
echo.
echo  *** 서버가 종료됐습니다. 3초 후 자동 재시작... ***
timeout /t 3 /nobreak > nul
goto loop
