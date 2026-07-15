# 🏦 은퇴포트폴리오 AI

한국 은퇴자를 위한 종합 자산관리 · 연금 계획 · 세금 최적화 웹 애플리케이션

**배포 URL:** https://retirement-portfolio-ai.vercel.app

---

## 📋 전체 기능 목록

### 🏠 홈

#### 대시보드 (`/`)
| 기능 | 설명 |
|------|------|
| KPI 6종 | 총자산 / 인출률 / 금융소득(YTD) / 세후 실질수익률 / 위험점수 / 국민연금 — 각 항목 클릭 시 해당 페이지로 이동 |
| 액션 알림 | 빨간색(즉시 조치) · 노란색(점검 필요) 알림 자동 생성 (만기 임박 / 인출률 초과 / 비상자금 부족 / 리밸런싱 편차 / 위험점수 / 세후수익률) |
| 자산배분 편차 | 현금성·채권·주식형·리츠 버킷별 목표 대비 현재 편차 |
| 이달 현금흐름 | 유입(연금·만기자산) / 지출(인출) / 순흐름 |
| 향후 60일 만기 자산 | D-30 이내 빨간색, D-31~60 노란색 표시 |
| 비상 유동성 비율 | 현금성 자산 ÷ 월 생활비 (개월 수) |
| AI 요약 (접이식) | 최근 생성된 AI 포트폴리오 요약 |
| 금융소득 모니터 | 연간 금융소득 누적 현황 및 종합과세 기준 대비 비율 |

---

### 📊 자산

#### 자산 관리 (`/assets`)
| 기능 | 설명 |
|------|------|
| 자산 CRUD | 계좌명 / 자산명 / 유형 / 세제분류 / 티커 / 수량 / 현재가 / 투자원금 / 매입일 / 만기일 입력 |
| 세제 분류 배지 | `tax_account_type` 별 색상 배지 (연금저축·퇴직연금IRP·ISA·일반) |
| 미분류 자산 배너 | 세제 분류 미설정 활성 자산 수 경고 |
| 세제분류 자동 제안 | 계좌명에 "IRP" · "연금저축" · "ISA" 포함 시 자동 제안 |
| 필터 | 자산 유형 / 활성 상태 / 계좌명 텍스트 검색 |
| 활성/비활성 토글 | 운용 중단 자산 구분 |
| 만기 임박 경고 | 만기 7일 이내 ⚠️ 애니메이션 표시 |
| 만기 자산 수동 정리 | 버튼 클릭으로 만기 지난 자산 일괄 비활성화 |
| 만기 자산 자동 정리 | 매일 오전 8시 KST Vercel Cron 자동 실행 |

#### 실물자산 (`/real-assets`)
| 기능 | 설명 |
|------|------|
| 실물자산 CRUD | 부동산·전세보증금 등 명칭 / 분류 / 시세 / 공시가격 / 담보대출 / 취득가·취득일 / 소재지 입력 |
| 분류 4종 | 주택 · 건물·상가·토지 · 전세보증금 · 기타 (배지 색상 구분) |
| 순가치 계산 | 시세 − 담보대출, 취득가 대비 증감 표시 |
| 총 순자산 합산 | 금융자산 + 실물 순자산 KPI (리밸런싱·4% 인출률·위험점수에는 미포함) |
| 건보료 과세표준 추정 | 공시가 환산율(주택 43~45% / 건물 100% / 전세 30%) − 대출 − 기본공제 1억 자동 계산 |
| 인출 전략 연동 | 인출 전략 페이지에서 재산 과세표준 미입력 시 실물자산 추정값 자동 사용 |

#### 수익률 분석 (`/returns`)
| 기능 | 설명 |
|------|------|
| 개별 자산 수익률 | 총수익률 + 연환산 수익률 (보유 1년 미만 → 총수익률, 이상 → 연환산) |
| 포트폴리오 수익률 | 전체 자산 가중평균 연환산 수익률 |
| 세후 실질수익률 | 세금 + 물가상승률 감안 실질 수익률 |

#### 리밸런싱·만기 (`/rebalance`)
| 기능 | 설명 |
|------|------|
| 목표 대비 현재 비중 | 버킷별 목표 비율 vs 현재 비율 비교 |
| 매수/매도 가이드 | 목표 달성을 위한 금액 계산 |
| 만기 예정 자산 재배분 | 향후 90일 만기 도래 자산 목록 + 우선 편입 버킷 추천·사유 (구 만기 재배분 가이드 병합) |
| 세금 효율 순서·체크리스트 | 연금계좌 우선 리밸런싱 가이드 |

---

### 💰 현금흐름

#### 수입 관리 (`/income`)
| 기능 | 설명 |
|------|------|
| 수입 기록 | 이자 / 배당 / 근로소득 / 기타 유형별 날짜·금액 입력 |
| 월별 수입 집계 차트 | 연도별·월별 수입 추이 시각화 |
| 생활비 자급률 | 금융소득 월평균 ÷ 월 생활비 비율 |
| 자산별 수입 분석 | 자산별 누적 수입 순위 |
| 금융소득 집계 | 이자·배당만 집계하여 종합과세 모니터에 반영 |

#### 지출 기록 (`/expenses`)
| 기능 | 설명 |
|------|------|
| 지출 입력 | 날짜·금액·카테고리(6종)·메모 입력 |
| 월별 지출 차트 | 월별 지출 추이 시각화 (최근 24개월) |
| 예산 대비 분석 | 12개월 평균 지출 vs 월 생활비 설정값 비교 (초과/절감 금액·비율) |
| 카테고리별 집계 | 최근 12개월 항목별 지출 비중 파이 차트 |

#### 인출 관리 (`/withdrawal`)
| 기능 | 설명 |
|------|------|
| 인출 기록 CRUD | 날짜·금액·계좌·세제분류·메모 건별 입력 (`withdrawals` 단일 테이블 — 연금세 한도·현금흐름·수익률 계산과 공용) |
| 월별 인출 차트 | 건별 기록의 월별 합계 추이 |
| 실적 인출률 | 최근 12개월 실제 인출 합계 ÷ 총자산 (4% 기준 색상 표시) |
| 비상자금 현황 | 현금성 자산 기준 비상자금 유지 기간 |

#### 현금흐름 (`/cashflow`)
| 기능 | 설명 |
|------|------|
| 월별 현금흐름 분석 | 유입(이자·배당·연금·만기자산) vs 지출(인출) |
| 순현금흐름 차트 | 월별 수지 시각화 |

#### 순자산 추이 (`/networth`)
| 기능 | 설명 |
|------|------|
| 순자산 시계열 차트 | 시간 흐름에 따른 총자산 변화 추적 |
| 버킷별 적층 차트 | 현금성·채권·주식형·리츠 구성 변화 |

---

### 🏛 연금·세금

#### 연금 계획 (`/pension-plan`)
| 기능 | 설명 |
|------|------|
| 장기 시뮬레이션 | 국민연금 + 개인연금 포함 자산 고갈 시뮬레이션 |
| 주택연금 시뮬레이션 | 한국주택금융공사(HF) 공식 요율 기반 |
| 주택연금 유형 선택 | 정액형 / 정기증가형 |
| 비교 시나리오 | 주택연금 있을 때 vs 없을 때 자산 곡선 비교 |
| 기대수익률 조정 | 슬라이더로 즉시 재계산 |
| 인플레이션 가정 | 물가상승률 설정 반영 |
| 상속·증여 연동 | 계획된 증여를 해당 연도 유출로 차감, 상속 목표 금액을 잔액 차트 목표선으로 표시 + 95세 잔액 기준 달성 여부 배너 |

#### 연금 최적화 (`/pension-optimize`)
| 기능 | 설명 |
|------|------|
| 연금 수령 시작 시기 최적화 | 나이별 월 수령액 vs 총 수령액 비교 |
| 인출 금액 최적화 | 자산 고갈 없이 유지 가능한 인출액 시뮬레이션 |

#### 연금 세금 (`/pension-tax`)
| 기능 | 설명 |
|------|------|
| 퇴직연금(IRP) 세금 계산 | 이연퇴직소득(비과세) vs 운용수익(과세) 분리 계산 |
| 연금저축 세금 계산 | 세액공제 받지 않은 원금(비과세) vs 세액공제 원금·운용수익(과세) |
| 연 1,500만원 한도 모니터 | 사적연금 분리과세 한도 대비 인출 현황 |
| 나이별 세율 적용 | 55~69세 5.5% / 70~79세 4.4% / 80세↑ 3.3% (지방소득세 포함) |
| 한도 초과 시 세율 | 16.5% 분리과세 또는 종합과세 선택 |
| 인출 기록 연동 | `withdrawals` 테이블 기반 실제 인출 이력 반영 |

#### 상속·증여 계획 (`/estate-plan`)
| 기능 | 설명 |
|------|------|
| 증여 계획 CRUD | 수증자·관계·유형(일회성/정기)·금액·연도 입력 |
| 증여세 자동 계산 | 관계별 10년 합산 공제(배우자 6억 / 성인 자녀 5,000만 / 미성년 2,000만 / 기타 친족 1,000만) + 누진세율 10~50% + 손자녀 세대생략 30% 할증 |
| 혼인·출산 공제 | 직계비속 증여 시 +1억원 추가 공제 (성인 자녀 합계 1.5억까지 비과세, 수증자별 평생 1회, 혼인신고 전후 2년 요건) |
| 상속세 개산 | 현재 총자산(금융+실물 순자산) 기준 — 일괄공제 5억 + 배우자 최소공제 5억 + 금융재산공제 min(금융×20%, 2억) |
| 사전증여 절세 비교 | 전액 상속 vs 계획 증여 실행 후 상속의 총 이전 비용 비교 (10년 이상 생존 가정) |
| 상속 목표 설정 | 남길 유산 목표 금액·배우자 유무 저장 (user_config `estate_plan`) |
| 연금 계획 연동 | 증여 유출·상속 목표가 연금 계획 시뮬레이션에 자동 반영 |

#### 인출 전략 (`/withdrawal-strategy`)
| 기능 | 설명 |
|------|------|
| 한계 비용 사다리 | 계좌 유형별 인출 세율 오름차순 정렬 (일반 0% → ISA 원금 0% → 연금 비과세 풀 0% → 한도 내 연금 3.3~5.5% → ISA 수익 9.9% → 한도 초과 16.5%) |
| 권장 인출 배분 | 연간 필요 인출액(기본값: 연 생활비 − 국민연금)을 사다리 순서로 배분, 계좌별 권장 인출액·세금 계산 |
| 시나리오 비교 | 권장 순서 / 연금 우선 / 연금 미사용 3가지의 연간 총 부담(인출세+금융소득세+건보료) 비교 차트 |
| 건보료 통합 | 백엔드 `health_insurance.py` 공용 모듈로 시나리오별 건강보험료 반영 (재산 과세표준·근로소득 입력 지원) |
| 금융소득 추정 | 최근 12개월 이자·배당 실적 기반, 일반계좌 인출에 따른 금융소득 감소 반영 |
| 듀얼 트랙 연동 | 기존 연금소득세 모델(비과세 풀·1,500만원 한도 YTD) 재사용 |

#### 건강보험료 시뮬레이터 (`/health-insurance`)
| 기능 | 설명 |
|------|------|
| 소득 입력 (슬라이더) | 국민연금(50% 반영) / 개인연금·IRP(미부과) / 이자·배당 / 근로·사업 — 배지로 반영 규칙 표시 |
| 재산 입력 (동적) | 6종 재산 유형별 과세표준 자동 환산, 최대 5개 추가·삭제, 기본공제 1억 자동 적용 |
| 주택담보대출 공제 | 대출 잔액 입력 시 재산 과세표준에서 차감 |
| 예상 보험료 KPI | 월 건강보험료 / 장기요양보험료 / 월·연간 총 납부액 / 실소득 대비 보험료율 / 부과점수 |
| 계산 근거 표시 | 소득·재산 점수 및 점수 × 단가 계산 과정 요약 |
| 피부양자 판정 | 사적연금 포함 전액 합산 기준, 가능 시 절감 금액 안내 |
| 절세 시나리오 비교 | ISA 전환 / 국민연금 감소 / 개인연금 증가 3가지 월 절감액 비교 |
| 시뮬레이션 저장 | 라벨·입력값·계산 결과를 Supabase에 저장 (최대 20개 이력) |
| 시뮬레이션 불러오기 | 저장 목록에서 선택 시 슬라이더·재산 항목 전체 복원 |
| 상황별 팁 자동 표시 | ISA 안내 / 개인연금 미부과 / 국민연금 50% / 대출공제 안내 조건부 표시 |

#### 위험 점수 (`/risk`)
| 기능 | 설명 |
|------|------|
| 포트폴리오 위험 점수 | 버킷 구성 기반 종합 위험도 (0~100점) |
| 순서 위험(Sequence Risk) | 은퇴 초기 수익률 순서가 자산 수명에 미치는 영향 분석 |
| 시나리오 차트 | 낙관·비관·평균 시나리오별 자산 변화 그래프 |

---

### ⚙️ 기타

#### AI 어드바이저 (`/ai-advisor`)
| 기능 | 설명 |
|------|------|
| 포트폴리오 기반 AI 채팅 | 현재 자산·수입·인출 현황을 컨텍스트로 포함한 OpenAI 대화 |
| 수입 현황 컨텍스트 | 이달 수입·YTD 금융소득·생활비 자급률 자동 포함 |
| 앱 기능 참고 매핑 | "이 데이터 어디에 쓰이나요" 같은 메타 질문에 실제 기능(지출·수입·인출 기록이 반영되는 화면/계산)을 근거로 답변, 목록에 없는 기능은 추측하지 않음 |
| 플로팅 버튼 | 모바일 우측 하단 고정 버튼 |

#### 설정 (`/settings`)
| 기능 | 설명 |
|------|------|
| 개인 정보 | 출생연도, 은퇴 나이, 월 생활비 |
| 포트폴리오 목표 비중 | 버킷별 목표 비율 (합계 100%) |
| 연금 계획 가정값 | 물가상승률 · 목표 연 수익률 설정 |
| 알림 수신 이메일 | 이메일 알림 발송 대상 주소 |

---

### 🔐 인증
| 기능 | 설명 |
|------|------|
| 이메일 로그인 | Supabase Auth 기반 이메일/비밀번호 로그인 |
| 자동 세션 유지 | 브라우저 재시작 후에도 로그인 상태 유지 |
| 보호된 라우트 | 비로그인 시 모든 페이지 → 로그인으로 리다이렉트 |

### 🔔 이메일 알림 & 자동화
| 기능 | 설명 |
|------|------|
| 만기 임박 알림 | 만기 7일 이내 자산 자동 이메일 발송 |
| 손실 전환 알림 | 수익률이 마이너스로 전환된 자산 알림 |
| 만기 자산 자동 정리 | 만기 도래 자산 자동 비활성화 |
| 자동 발송 시각 | 매일 오전 8시 KST (Vercel Cron: `0 23 * * *` UTC) |
| 알림 중복 방지 | `notification_log` 테이블로 연도별 중복 발송 차단 |
| Gmail SMTP | Gmail 앱 비밀번호 기반 발송 |

---

## 🗂️ 주요 데이터 구조

### 자산 유형 (`asset_type`)

| 코드 | 유형명 | 예시 | 기대수익률 |
|------|--------|------|-----------|
| `cash` | 현금성 | 예금, CMA, MMF, 파킹통장 | 2% |
| `bond` | 채권 | 국고채, 회사채, 단기채 ETF | 4% |
| `tdf` | TDF | 생애주기 펀드 (Target Date Fund) | 5% |
| `fund` | 펀드 | 혼합형 펀드 | 5% |
| `equity` | 주식형 | 주식형 ETF, 펀드, 개별주식 | 8% |
| `income` | 인컴 | 리츠(REITs), 배당 ETF, 배당주 | 5% |

### 자산 버킷 (`bucket`) — 위험 분류

| 버킷 | 포함 유형 | 설명 |
|------|----------|------|
| B1 | `cash` | 비상자금 (현금성) |
| B2 | `bond`, `tdf`, `fund` | 안정 자산 |
| B3 | `equity`, `income` | 성장·인컴 자산 |

### 세제 분류 (`tax_account_type`)

| 코드 | 명칭 | 배지 색상 | 과세 특성 |
|------|------|----------|----------|
| `pension_savings` | 연금저축 | 파란색 | 세액공제 원금·운용수익 → 연 1,500만원 한도 분리과세 |
| `retirement_pension` | 퇴직연금(IRP) | 초록색 | 이연퇴직소득(원금) 비과세 / 운용수익 → 한도 합산 |
| `isa` | ISA | 노란색 | ISA 분리과세 (별도 규칙) |
| `regular` | 일반 | 회색 | 금융소득 종합과세 (연 2,000만원 초과 시) |
| *(미분류)* | — | — | 대시보드·자산 관리에서 배너 경고 |

### 수입 유형 (`income_type`)

| 코드 | 명칭 | 금융소득 집계 포함 |
|------|------|-----------------|
| `interest` | 이자 | ✅ |
| `dividend` | 배당 | ✅ |
| `earned` | 근로소득 | ❌ |
| `other` | 기타 | ❌ |

### 지출 카테고리 (`category`)

| 코드 | 명칭 | 색상 |
|------|------|------|
| `living` | 생활비 | 파란색 |
| `housing` | 주거·관리비 | 초록색 |
| `medical` | 의료·보험 | 노란색 |
| `family` | 가족·경조사 | 보라색 |
| `leisure` | 여행·취미 | 주황색 |
| `other` | 기타 | 회색 |

### 주요 Supabase 테이블

| 테이블 | 주요 컬럼 | 용도 |
|--------|----------|------|
| `assets` | id, account_name, asset_name, asset_type, tax_account_type, quantity, unit_price, current_value, purchase_date, maturity_date, investment_amount, ticker, is_active, price_updated_at, price_update_failed | 자산 기본 정보 |
| `user_config` | key, value (JSON) | 사용자 설정 (개인정보·포트폴리오 목표·연금 가정값) |
| `withdrawals` | id, withdrawal_date, amount, account_name, tax_account_type, memo | 연금 인출 기록 (연금소득세 한도 계산용) |
| `income_log` | id, income_date, amount, income_type, asset_name, memo | 수입 기록 |
| `expenses` | id, expense_date, amount, category, memo | 지출 기록 |
| `risk_scores` | id, date, total_score, cash_score, seq_score, conc_score, level | 위험 점수 이력 |
| `recommendations` | id, rule_id, message, date | AI 요약 및 권장사항 |
| `notification_log` | id, notification_type, year, sent_at | 이메일 알림 중복 방지 |
| `health_insurance_simulations` | id, user_id, label, inputs (JSONB), health_premium, long_care_premium, total_monthly, total_annual, income_score, property_score, total_score, is_dependent_eligible | 건강보험료 시뮬레이션 저장 이력 (RLS 적용) |
| `real_assets` | id, name, category, market_value, official_price, loan_amount, acquisition_price, acquisition_date, address, memo, is_active | 실물자산 (부동산·전세보증금 등 비금융자산) |
| `gift_plans` | id, recipient_name, relationship, gift_type, amount, start_year, end_year, marriage_deduction, memo, is_active | 사전증여 계획 (연금 계획 시뮬레이션 유출 반영) |

---

## 🛠️ 기술 스택

### 프론트엔드
| 항목 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | React | 18.3 |
| 빌드 도구 | Vite | 5.4 |
| 라우팅 | React Router | v6 |
| 서버 상태 관리 | TanStack Query (React Query) | v5 |
| 스타일링 | Tailwind CSS | 3.4 |
| 차트 | Recharts | 2.12 |
| HTTP 클라이언트 | Axios | 1.7 |
| 인증 | Supabase Auth | 2.x |

### 백엔드
| 항목 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | FastAPI | 0.110+ |
| 런타임 | Python | 3.11 |
| 데이터 검증 | Pydantic | v2 |
| DB 클라이언트 | supabase-py | 2.3+ |
| AI | OpenAI SDK | 1.30+ |
| 주식 시세 | pykrx, finance-datareader | — |
| 데이터 분석 | pandas, numpy | — |
| Excel 내보내기 | openpyxl | 3.1+ |
| 로컬 스케줄러 | APScheduler | 3.10+ |

### 인프라
| 항목 | 기술 |
|------|------|
| 배포 | Vercel (experimentalServices 모노레포) |
| 데이터베이스 | Supabase (PostgreSQL) |
| CI/CD | GitHub → Vercel 자동 배포 (main 브랜치) |
| Cron Job | Vercel Cron (`0 23 * * *` UTC = 오전 8시 KST) |
| 이메일 | Gmail SMTP (smtplib) |

---

## 🔐 환경 변수

루트의 `.env` (로컬) / Vercel 대시보드 → Settings → Environment Variables (배포) 에 설정합니다.

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `SUPABASE_URL` | ✅ | Supabase 프로젝트 URL (`https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon public 키 |
| `VITE_SUPABASE_URL` | ✅ | 프론트엔드용 Supabase URL (`SUPABASE_URL`과 동일한 값) |
| `VITE_SUPABASE_ANON_KEY` | ✅ | 프론트엔드용 anon 키 (`SUPABASE_ANON_KEY`와 동일한 값) |
| `OPENAI_API_KEY` | ✅ | OpenAI API 키 (AI 어드바이저·요약 생성) |
| `GMAIL_ADDRESS` | ✅ | 알림 발신 Gmail 주소 |
| `GMAIL_APP_PASSWORD` | ✅ | Gmail 앱 비밀번호 (2단계 인증 → 앱 비밀번호 발급) |
| `OPENBANKING_CLIENT_ID` | ⬜ | 오픈뱅킹 API 클라이언트 ID (Phase 2 예정, 현재 미사용) |
| `OPENBANKING_CLIENT_SECRET` | ⬜ | 오픈뱅킹 API 시크릿 (현재 미사용) |

> `VITE_` 접두사 변수는 프론트엔드 빌드 시 번들에 포함됩니다. 나머지는 백엔드(서버)에서만 사용됩니다.

---

## 📁 프로젝트 폴더 구조

```
은퇴포트폴리오AI/
│
├── frontend/                          # React + Vite 프론트엔드
│   ├── src/
│   │   ├── pages/                     # 페이지 컴포넌트 (19개)
│   │   │   ├── Dashboard.jsx          # 대시보드 (KPI·알림·현금흐름·AI 요약)
│   │   │   ├── Assets.jsx             # 자산 관리 (CRUD·세제분류·필터)
│   │   │   ├── RealAssets.jsx         # 실물자산 (부동산 등 비금융자산 CRUD)
│   │   │   ├── ReturnAnalysis.jsx     # 수익률 분석
│   │   │   ├── Rebalance.jsx          # 리밸런싱·만기 재배분 (병합)
│   │   │   ├── Income.jsx             # 수입 관리 (이자·배당·근로·기타)
│   │   │   ├── Expenses.jsx           # 지출 기록
│   │   │   ├── Withdrawal.jsx         # 인출 관리 (건별 기록 CRUD·월별 집계)
│   │   │   ├── CashFlow.jsx           # 현금흐름 분석
│   │   │   ├── NetWorth.jsx           # 순자산 추이
│   │   │   ├── PensionPlan.jsx        # 연금 계획 (주택연금 포함)
│   │   │   ├── PensionOptimize.jsx    # 연금 최적화
│   │   │   ├── PensionTax.jsx         # 연금 세금 계산
│   │   │   ├── WithdrawalStrategy.jsx # 인출 전략 (세금+건보료 최적 인출 순서)
│   │   │   ├── EstatePlan.jsx         # 상속·증여 계획 (증여세·상속세 개산)
│   │   │   ├── HealthInsurance.jsx    # 건강보험료 시뮬레이터 (저장·불러오기 포함)
│   │   │   ├── RiskScore.jsx          # 위험 점수
│   │   │   ├── AIAdvisor.jsx          # AI 어드바이저
│   │   │   ├── Settings.jsx           # 설정
│   │   │   └── Login.jsx              # 로그인
│   │   ├── components/
│   │   │   └── Layout.jsx             # 사이드바(PC) + 모바일 탭바 레이아웃
│   │   ├── context/
│   │   │   └── AuthContext.jsx        # Supabase Auth 컨텍스트 + useAuth 훅
│   │   ├── hooks/
│   │   │   └── useHealthInsurance.js  # 최신 건강보험료 시뮬레이션 조회 함수
│   │   ├── lib/
│   │   │   └── supabase.js            # Supabase 클라이언트 초기화
│   │   ├── api/
│   │   │   └── client.js              # Axios 인스턴스 + fmt 포맷 유틸
│   │   ├── navigation.js              # NAV_GROUPS 메뉴 구조 정의
│   │   ├── App.jsx                    # 라우팅 + ProtectedRoute
│   │   ├── main.jsx                   # React Query Provider + React DOM
│   │   └── index.css                  # Tailwind 디렉티브 + 글로벌 스타일
│   ├── vite.config.js                 # Vite 설정 + /api → 백엔드 프록시
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/                           # FastAPI 백엔드
│   ├── main.py                        # 앱 진입점, CORS, 라우터 등록, Cron 엔드포인트
│   ├── database.py                    # Supabase 클라이언트 초기화
│   ├── utils.py                       # BUCKET_MAP, EXPECTED_RETURN, 공용 함수
│   ├── tax_constants.py               # 연금·ISA·금융소득·건보료 세율·한도 상수
│   ├── health_insurance.py            # 건강보험료 계산 공용 모듈 (프론트 점수표와 동일)
│   ├── advisor_context.py             # AI 어드바이저용 포트폴리오 컨텍스트 생성
│   ├── advisor_prompt.py              # AI 시스템 프롬프트 정의
│   ├── notifier.py                    # Gmail 이메일 알림 + 만기 자동 비활성화
│   ├── routers/
│   │   ├── assets.py                  # GET/POST/PUT/DELETE /assets
│   │   ├── real_assets.py             # 실물자산 CRUD + 순자산·건보료 과세표준 요약
│   │   ├── dashboard.py               # GET /dashboard (종합 집계)
│   │   ├── pension_tax.py             # 연금소득세 계산 (퇴직연금·연금저축·ISA)
│   │   ├── withdrawal_strategy.py     # 인출 순서 최적화 (세금+건보료 통합)
│   │   ├── estate.py                  # 상속·증여 계획 (증여세 10년 합산·상속세 개산)
│   │   ├── pension_plan.py            # 장기 연금 시뮬레이션
│   │   ├── returns.py                 # 수익률 분석
│   │   ├── rebalance.py               # 리밸런싱 계산
│   │   ├── risk.py                    # 위험 점수 계산
│   │   ├── withdrawals.py             # 인출 기록 CRUD + 월별 요약 (단일 인출 소스)
│   │   ├── cashflow.py                # 현금흐름 월별 집계
│   │   ├── income.py                  # 수입 기록 CRUD
│   │   ├── expenses.py                # 지출 기록 CRUD
│   │   ├── networth.py                # 순자산 추이
│   │   ├── tax.py                     # 금융소득 종합과세 현황
│   │   ├── price.py                   # 시세 갱신 (pykrx, finance-datareader)
│   │   ├── config.py                  # 사용자 설정 CRUD
│   │   ├── summary.py                 # AI 요약 생성
│   │   ├── ai_advisor.py              # AI 어드바이저 채팅 (OpenAI)
│   │   └── export.py                  # Excel 내보내기
│   ├── tests/
│   │   ├── test_pension_tax.py        # 연금소득세 유닛 테스트
│   │   ├── test_withdrawal_strategy.py     # 인출 전략 순수 함수 테스트
│   │   ├── test_withdrawal_strategy_api.py # 인출 전략 라우트 스모크 테스트 (DB 모킹)
│   │   ├── test_daily_cron.py         # Cron 로직 테스트
│   │   ├── test_real_assets.py        # 실물자산 과세표준·요약 테스트
│   │   ├── test_estate.py             # 상속·증여세 계산 테스트
│   │   └── test_assumptions.py        # 계획 가정값 테스트
│   └── requirements.txt
│
├── schema.sql                         # DB 완전 초기화용 스키마 (신규 설치 시 1회 실행)
├── migrations/                        # Supabase SQL 마이그레이션 (날짜순)
│   ├── 2026-06-10_tax_account_type_and_account_name.sql
│   ├── 2026-06-11_withdrawals_and_notification_log.sql
│   ├── 2026-06-12_price_update_status.sql
│   ├── 2026-06-13_target_annual_return.sql
│   ├── 2026-06-15_expenses.sql
│   ├── 2026-06-16_income_type_earned.sql
│   ├── 2026-06-25_health_insurance_simulations.sql
│   ├── 2026-07-14_real_assets.sql
│   ├── 2026-07-15_gift_plans.sql
│   └── 2026-07-15_drop_withdrawal_log.sql
│
├── vercel.json                        # Vercel 배포 (experimentalServices + Cron)
├── .env                               # 로컬 환경 변수 (Git 제외)
├── .env.template                      # 환경 변수 템플릿
└── README.md                          # 이 파일
```

---

## 🚀 로컬 개발 환경 설정

### 사전 준비
- Node.js 18+
- Python 3.11+
- Supabase 프로젝트 (https://supabase.com)

### 1. 환경 변수 설정

루트에 `.env` 파일 생성 (`.env.template` 복사):

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...

VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

OPENAI_API_KEY=sk-...

GMAIL_ADDRESS=your@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

### 2. DB 초기화 (최초 1회)

Supabase Dashboard → **SQL Editor** 에서 `schema.sql` 전체를 붙여넣고 실행합니다.

```
Supabase Dashboard
  └─ 프로젝트 선택
       └─ SQL Editor → New query
            └─ schema.sql 내용 붙여넣기 → Run
```

완료 시 생성되는 테이블:

| 테이블 | 설명 |
|--------|------|
| `assets` | 자산 목록 |
| `income_log` | 수입 기록 |
| `user_config` | 앱 설정 (기본값 자동 삽입) |
| `withdrawals` | 연금 인출 기록 |
| `notification_log` | 이메일 알림 이력 |
| `portfolio_snapshots` | 순자산 스냅샷 |
| `expenses` | 지출 기록 |
| `risk_scores` | 위험 점수 이력 |
| `bucket_snapshots` | 버킷별 자산 스냅샷 |
| `recommendations` | AI 포트폴리오 요약 |
| `health_insurance_simulations` | 건강보험료 시뮬레이션 저장 이력 |
| `real_assets` | 실물자산 (부동산·전세보증금 등) |
| `gift_plans` | 사전증여 계획 |

> 이미 운영 중인 DB에 새 마이그레이션만 적용하려면 `migrations/` 폴더의 해당 파일을 순서대로 실행합니다.

### 3. 백엔드 실행

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 4. 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 http://localhost:5173 접속 (`/api` 요청은 자동으로 포트 8000 백엔드로 프록시됩니다.)

---

## ☁️ Vercel 배포

GitHub `main` 브랜치에 push하면 자동으로 재배포됩니다.

**vercel.json 구성:**
```json
{
  "experimentalServices": {
    "backend": { "entrypoint": "backend/main.py", "routePrefix": "/api" },
    "frontend": { "entrypoint": "frontend", "routePrefix": "/" }
  },
  "crons": [{ "path": "/api/alert/daily", "schedule": "0 23 * * *" }]
}
```

Vercel 대시보드 → Settings → Environment Variables 에 위 환경 변수 표의 모든 항목을 입력합니다.
