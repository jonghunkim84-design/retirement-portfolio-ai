-- 선택 사항 — DB 에 남아 있는 "RLS 미적용" 테이블 코멘트 2개를 현재 상태에 맞게 고친다.
-- (동작에는 영향 없음. 실행하지 않아도 앱과 보안에는 문제가 없다.)
BEGIN;

COMMENT ON TABLE public.user_config IS
  '앱 설정. key=''config'' 단일 행 구조. RLS 활성화(정책 없음) — 서버 전용 키로만 접근.';

COMMENT ON TABLE public.holding_profiles IS
  '보유상품 속성(assets 1:1). 인출 판단 시스템의 노출도·버킷 계산 입력. RLS 활성화(정책 없음) — 서버 전용 키로만 접근.';

COMMIT;
