@echo off
chcp 65001 > nul
echo ============================================
echo  은퇴포트폴리오 AI v2 — 초기 설정
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Python 백엔드 라이브러리 설치 중...
cd backend
python -m pip install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo   오류: pip install 실패. Python이 설치되어 있는지 확인하세요.
    pause & exit /b 1
)
echo   완료!
cd ..

echo.
echo [2/3] Node.js 패키지 설치 중 (npm install)...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo   오류: npm install 실패. Node.js가 설치되어 있는지 확인하세요.
    pause & exit /b 1
)
echo   완료!
cd ..

echo.
echo [3/3] 설정 완료!
echo.
echo ============================================
echo  start_web.bat 을 실행하면 앱이 시작됩니다.
echo ============================================
echo.
pause
