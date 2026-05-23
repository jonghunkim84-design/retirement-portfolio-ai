$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " 은퇴포트폴리오 AI v2 시작 중..." -ForegroundColor Cyan
Write-Host "============================================"

# 기존 프로세스 종료
Write-Host "`n[사전 정리] 포트 8000, 5173 기존 프로세스 종료..."
@(8000, 5173) | ForEach-Object {
    $port = $_
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1
Write-Host "  완료!" -ForegroundColor Green

# 백엔드 시작 (자동재시작 루프)
Write-Host "`n[백엔드] FastAPI 서버 시작 (포트 8000, 자동재시작)..."
$backendCmd = "while(`$true) { Write-Host '[백엔드] 시작 중...' -ForegroundColor Green; Set-Location '$root\backend'; python -m uvicorn main:app --reload --port 8000; Write-Host '*** 백엔드 종료. 3초 후 재시작... ***' -ForegroundColor Yellow; Start-Sleep 3 }"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

Start-Sleep -Seconds 3

# 프론트엔드 시작 (자동재시작 루프)
Write-Host "[프론트엔드] React 앱 시작 (포트 5173, 자동재시작)..."
$frontendCmd = "while(`$true) { Write-Host '[프론트엔드] 시작 중...' -ForegroundColor Blue; Set-Location '$root\frontend'; npm run dev; Write-Host '*** 프론트엔드 종료. 3초 후 재시작... ***' -ForegroundColor Yellow; Start-Sleep 3 }"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

# 백엔드 준비될 때까지 대기 (최대 30초)
Write-Host "`n[대기] 백엔드 준비 확인 중..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Write-Host "  대기 중... ($([int](($i+1)*2))초)" -ForegroundColor Gray
}

if ($ready) {
    Write-Host "  백엔드 준비 완료!" -ForegroundColor Green
} else {
    Write-Host "  백엔드 시작 시간이 오래 걸립니다. 잠시 후 직접 접속하세요." -ForegroundColor Yellow
}

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host " http://127.0.0.1:5173" -ForegroundColor White
Write-Host "============================================"
Start-Process "http://127.0.0.1:5173"
