# 🏦 은퇴포트폴리오 AI

한국 은퇴자를 위한 자산 관리 · 연금 계획 · 리밸런싱 웹 애플리케이션

**배포 URL:** https://retirement-portfolio-ai.vercel.app

---

## 📋 전체 기능 목록

### 🔐 인증
| 기능 | 설명 |
|------|------|
| 이메일 로그인 | Supabase Auth 기반 이메일/비밀번호 로그인 |
| 자동 세션 유지 | 브라우저를 닫아도 로그인 상태 유지 |
| 보호된 라우트 | 비로그인 시 모든 페이지 접근 차단 → 로그인 페이지로 리다이렉트 |
| 로그아웃 | 사이드바(PC) / 상단 헤더(모바일)에서 로그아웃 |

### 📊 대시보드
| 기능 | 설명 |
|------|------|
| 총자산 현황 | 활성 자산 합계 및 버킷별 현재 비중 |
| 목표 vs 현재 비중 | 도넛 차트로 목표 대비 현재 비중 시각화 |
| 자산 버킷 요약 | Cash / Bond / TDF / Equity / Income 유형별 분류 |

### 📋 자산 관리
| 기능 | 설명 |
|------|------|
| 자산 추가/수정/삭제 | 계좌명, 자산명, 유형, 수량, 현재가, 매입일, 만기일 등 입력 |
| 활성/비활성 토글 | 운용 중단 자산 구분 관리 |
| 만기일 임박 경고 | 7일 이내 ⚠️ 빨간 애니메이션 표시 |
| 만기 자산 수동 정리 | 버튼 클릭으로 만기 지난 자산 일괄 비활성화 |
| 만기 자산 자동 정리 | 매일 오전 8시 KST Vercel Cron Job 자동 실행 |

### 📈 수익률 분석
| 기능 | 설명 |
|------|------|
| 개별 자산 수익률 | 총수익률 및 연환산 수익률 계산 |
| 보유 기간 기반 계산 | 1년 미만 → 총수익률 / 1년 이상 → 연환산 수익률 |

### ⚖️ 리밸런싱
| 기능 | 설명 |
|------|------|
| 목표 비중 설정 | 각 자산 버킷별 목표 비율 입력 |
| 리밸런싱 가이드 | 매수/매도 필요 금액 자동 계산 |

### 🎯 만기 자산 재배분 가이드
| 기능 | 설명 |
|------|------|
| 포트폴리오 조정 테이블 | 자산유형 / 목표비율 / 목표금액 / 현재비율 / 현재금액 / 조정필요금액 |
| 컬러 코딩 | ▲ 파란색(매수 필요) / ▼ 빨간색(매도 필요) / ✓ 초록(목표 충족) |
| 현재 총자산 배너 | 전체 활성 자산 합계 상단 표시 |

### 🧮 위험 점수
| 기능 | 설명 |
|------|------|
| 포트폴리오 위험도 점수 | 버킷 구성 기반 위험 점수 계산 |
| 순서 위험(Sequence Risk) 분석 | 은퇴 초기 수익률 순서가 자산 수명에 미치는 영향 시뮬레이션 |
| 시나리오 차트 | 낙관/비관/평균 시나리오별 자산 변화 그래프 |

### 🏦 연금 계획
| 기능 | 설명 |
|------|------|
| 장기 연금 시뮬레이션 | 국민연금 + 개인연금 포함 자산 고갈 시뮬레이션 |
| 주택연금 시뮬레이션 | 한국주택금융공사(HF) 공식 요율 기반 |
| 주택연금 유형 선택 | 정액형 / 정기증가형 선택 가능 |
| 비교 시나리오 | 주택연금 있을 때 vs 없을 때 자산 곡선 비교 |
| 연 기대 수익률 조정 | 슬라이더로 기대 수익률 변경 후 즉시 재계산 |

### 💰 수입 관리
| 기능 | 설명 |
|------|------|
| 수입 기록 | 이자 / 배당 / 기타 유형별 날짜·금액 입력 |
| 월별 수입 집계 차트 | 연도별/월별 수입 추이 시각화 |
| 생활비 자급률 | 패시브인컴 월평균 ÷ 월생활비 비율 자동 계산 |
| 자산별 수입 분석 | 자산별 누적 수입 순위 |

### 📉 현금흐름 & 순자산
| 기능 | 설명 |
|------|------|
| 현금흐름 분석 | 수입/지출 흐름 시각화 |
| 순자산 추이 | 시간 흐름에 따른 자산 변화 추적 |

### 🔔 이메일 알림
| 기능 | 설명 |
|------|------|
| 만기 임박 알림 | 만기 7일 이내 자산 자동 이메일 알림 |
| 손실 전환 알림 | 수익률이 마이너스로 전환된 자산 알림 |
| 자동 발송 | 매일 오전 8시 KST (Vercel Cron: 23:00 UTC) |
| Gmail SMTP | Gmail 앱 비밀번호 기반 발송 |

### ⚙️ 설정
| 기능 | 설명 |
|------|------|
| 개인 정보 설정 | 현재 나이, 은퇴 나이, 월 생활비 |
| 버킷 목표 비중 | 각 자산 유형별 목표 비율 설정 |
| 알림 수신 이메일 | 알림 발송 이메일 주소 지정 |

### 📱 지원 환경
| 항목 | 내용 |
|------|------|
| PC (데스크톱) | 좌측 사이드바 네비게이션 |
| 모바일 | 하단 탭바 + 상단 헤더 (반응형 레이아웃) |
| 배포 | Vercel (GitHub push 시 자동 재배포) |

---

## 🗂️ 프로젝트 구조

```
은퇴포트폴리오AI/
├── frontend/                  # React + Vite 프론트엔드
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx       # 대시보드
│   │   │   ├── Assets.jsx          # 자산 관리
│   │   │   ├── MaturityGuide.jsx   # 만기 재배분 가이드
│   │   │   ├── RiskScore.jsx       # 위험 점수
│   │   │   ├── PensionPlan.jsx     # 연금 계획 (주택연금 포함)
│   │   │   ├── Income.jsx          # 수입 관리
│   │   │   ├── Cashflow.jsx        # 현금흐름
│   │   │   ├── NetWorth.jsx        # 순자산 추이
│   │   │   ├── Rebalance.jsx       # 리밸런싱
│   │   │   ├── Returns.jsx         # 수익률 분석
│   │   │   ├── Config.jsx          # 설정
│   │   │   └── Login.jsx           # 로그인
│   │   ├── context/
│   │   │   └── AuthContext.jsx     # Supabase Auth 컨텍스트
│   │   ├── lib/
│   │   │   └── supabase.js         # Supabase 클라이언트
│   │   ├── api/
│   │   │   └── client.js           # Axios API 클라이언트
│   │   ├── components/
│   │   │   └── Layout.jsx          # 사이드바/모바일 레이아웃
│   │   └── App.jsx                 # 라우팅 + 보호된 라우트
│   └── vite.config.js
│
├── backend/                   # FastAPI 백엔드
│   ├── main.py                    # 앱 진입점, 라우터 등록, Cron 엔드포인트
│   ├── database.py                # Supabase 클라이언트
│   ├── notifier.py                # 이메일 알림 + 만기 자동 비활성화
│   ├── utils.py                   # 공통 유틸 함수
│   └── routers/
│       ├── assets.py              # 자산 CRUD
│       ├── dashboard.py           # 대시보드 집계
│       ├── risk.py                # 위험 점수
│       ├── rebalance.py           # 리밸런싱
│       ├── returns.py             # 수익률
│       ├── income.py              # 수입 관리
│       ├── cashflow.py            # 현금흐름
│       ├── networth.py            # 순자산
│       ├── withdrawal.py          # 인출 계획
│       ├── summary.py             # 요약
│       ├── config.py              # 설정
│       └── price.py               # 시세 조회
│
├── vercel.json                # Vercel 배포 설정 (experimentalServices + Cron)
└── README.md                  # 이 파일
```

---

## 🚀 로컬 개발 환경 설정

### 사전 준비
- Node.js 18+
- Python 3.11+
- Supabase 프로젝트 (https://supabase.com)

### 1. 환경 변수 설정

**백엔드** — `backend/.env` 파일 생성:
```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
OPENAI_API_KEY=sk-...
GMAIL_ADDRESS=your@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
ALERT_EMAIL=your@gmail.com
```

**프론트엔드** — `frontend/.env.local` 파일 생성:
```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 2. 백엔드 실행
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. 프론트엔드 실행
```bash
cd frontend
npm install
npm run dev
```

브라우저에서 http://localhost:5173 접속

---

## ☁️ Vercel 배포

GitHub `main` 브랜치에 push하면 자동으로 재배포됩니다.

### Vercel 환경 변수 (필수)
| 변수명 | 설명 |
|--------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | Supabase anon 공개 키 |
| `VITE_SUPABASE_URL` | 프론트엔드용 Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | 프론트엔드용 Supabase anon 키 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `GMAIL_ADDRESS` | 알림 발신 Gmail 주소 |
| `GMAIL_APP_PASSWORD` | Gmail 앱 비밀번호 |
| `ALERT_EMAIL` | 알림 수신 이메일 주소 |

### Cron Job
`vercel.json`에 설정된 Cron Job이 매일 23:00 UTC (한국 오전 8시)에 자동 실행됩니다:
- 만기 도래 자산 자동 비활성화
- 이메일 알림 발송 (만기 임박 / 손실 전환)

---

## 🛠️ 기술 스택

### 프론트엔드
| 항목 | 기술 |
|------|------|
| 프레임워크 | React 18 + Vite |
| 라우팅 | React Router v6 |
| 상태 관리 | TanStack Query (React Query) |
| 스타일링 | Tailwind CSS |
| 차트 | Recharts |
| 인증 | Supabase Auth |
| HTTP 클라이언트 | Axios |

### 백엔드
| 항목 | 기술 |
|------|------|
| 프레임워크 | FastAPI + Python 3.11 |
| 데이터 검증 | Pydantic v2 |
| 데이터베이스 | Supabase (PostgreSQL) |
| 스케줄러 | Vercel Cron Jobs (배포) / APScheduler (로컬) |
| 이메일 | Gmail SMTP (smtplib) |

### 인프라
| 항목 | 기술 |
|------|------|
| 배포 | Vercel (experimentalServices 모노레포) |
| 데이터베이스 | Supabase PostgreSQL |
| CI/CD | GitHub → Vercel 자동 배포 |

---

## 📊 자산 유형(asset_type) 구분

| 코드 | 유형명 | 예시 |
|------|--------|------|
| `cash` | 현금성 | 예금, CMA, MMF, 파킹통장 |
| `bond` | 채권 | 국고채, 회사채, 단기채 ETF |
| `tdf` | TDF | 생애주기 펀드 (Target Date Fund) |
| `equity` | 주식형 | 주식형 ETF, 펀드, 개별주식 |
| `income` | 인컴 | 리츠(REITs), 배당 ETF, 배당주 |

---

## 📞 문의
막히는 부분이 있으면 Claude AI에게 물어보세요.
