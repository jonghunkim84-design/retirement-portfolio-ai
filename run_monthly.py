"""
월간 포트폴리오 자동 실행 스크립트
매월 1일 Windows 작업 스케줄러가 이 파일을 실행합니다.
"""
import subprocess
import sys
import os
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent
LOG_FILE     = PROJECT_ROOT / 'logs' / f'run_{datetime.now().strftime("%Y%m")}.log'

# 로그 폴더 생성
LOG_FILE.parent.mkdir(exist_ok=True)

NOTEBOOKS = [
    '08_price_update.ipynb',   # 실시간 시세 업데이트 (가장 먼저 실행)
    '01_data_input.ipynb',
    '02_bucket_engine.ipynb',
    '03_risk_score.ipynb',
    '04_rebalance.ipynb',
    '05_llm_summary.ipynb',
    '07_report.ipynb',   # 06 대시보드는 Voilà용이라 제외
]


def log(msg):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{timestamp}] {msg}'
    print(line)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def run_notebook(nb_name):
    nb_path = PROJECT_ROOT / nb_name
    if not nb_path.exists():
        log(f'❌ 파일 없음: {nb_name}')
        return False

    log(f'▶ 실행 중: {nb_name}')
    result = subprocess.run(
        [sys.executable, '-m', 'jupyter', 'nbconvert',
         '--to', 'notebook',
         '--execute',
         '--ExecutePreprocessor.timeout=300',
         '--inplace',
         str(nb_path)],
        capture_output=True,
        text=True,
        cwd=str(PROJECT_ROOT)
    )

    if result.returncode == 0:
        log(f'✅ 완료: {nb_name}')
        return True
    else:
        log(f'❌ 실패: {nb_name}')
        log(f'   오류: {result.stderr[-500:]}')
        return False


if __name__ == '__main__':
    log('=' * 50)
    log(f'월간 자동 실행 시작 — {datetime.now().strftime("%Y년 %m월 %d일")}')
    log('=' * 50)

    success_count = 0
    fail_count    = 0

    for nb in NOTEBOOKS:
        ok = run_notebook(nb)
        if ok:
            success_count += 1
        else:
            fail_count += 1

    log('=' * 50)
    log(f'완료: {success_count}개 성공 / {fail_count}개 실패')
    log('=' * 50)

    sys.exit(0 if fail_count == 0 else 1)
