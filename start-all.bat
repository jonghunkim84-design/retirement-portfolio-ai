@echo off
chcp 65001 >nul
title 은퇴포트폴리오 AI - 시작

echo ============================================
echo    은퇴포트폴리오 AI 시스템 시작
echo ============================================
echo.

:: ngrok 경로
set NGROK="C:\Users\kwak5\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"

:: 기존 프로세스 정리 (필요시)
echo [1/3] 기존 프로세스 확인 중...
taskkill /F /IM ngrok.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

timeout /t 2 >nul

:: 백엔드 시작
echo [2/3] 백엔드 시작 (FastAPI :8000)...
start "백엔드" cmd /k "cd /d C:\Users\kwak5\OneDrive\바탕 화면\은퇴포트폴리오AI\backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 3 >nul

:: 프론트엔드 시작
echo [3/3] 프론트엔드 시작 (Vite :5173)...
start "프론트엔드" cmd /k "cd /d C:\Users\kwak5\OneDrive\바탕 화면\은퇴포트폴리오AI\frontend && npm run dev"

timeout /t 5 >nul

:: ngrok 시작
echo [+] ngrok 터널 시작...
start "ngrok" cmd /k "%NGROK% http 5173"

timeout /t 5 >nul

:: URL 가져오기
echo.
echo ============================================
echo  접속 URL 확인 중...
echo ============================================

:: PowerShell로 ngrok API 조회
powershell -Command "try { $r = Invoke-RestMethod 'http://localhost:4040/api/tunnels'; $url = $r.tunnels[0].public_url; Write-Host ''; Write-Host '  📱 모바일 접속 URL:'; Write-Host '  '$url -ForegroundColor Cyan; Write-Host ''; Write-Host '  ⚠  첫 접속 시 ngrok 경고 화면에서 [Visit Site] 클릭' -ForegroundColor Yellow } catch { Write-Host '  URL 로딩 중... ngrok 창을 확인하세요.' -ForegroundColor Yellow }"

echo.
echo  💻 로컬 접속: http://localhost:5173
echo.
echo ============================================
pause
