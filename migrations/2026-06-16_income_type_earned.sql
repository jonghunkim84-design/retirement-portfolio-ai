-- income_log 테이블 income_type 허용값에 'earned'(근로소득) 추가
-- DB에 CHECK 제약이 없으므로 코드 레벨(백엔드·프론트) 변경으로 적용
-- 기존 데이터 변경 없음

-- 적용 후 유효 income_type 값:
--   interest  : 이자
--   dividend  : 배당
--   other     : 기타 (금융소득 합산 포함)
--   earned    : 근로소득 (금융소득종합과세 합산 제외)

-- 금융소득종합과세 합산 대상: interest + dividend + other
-- 합산 제외 대상: earned

-- 근로소득을 기존에 'other'로 입력한 경우 아래 쿼리로 수정 가능 (선택적):
-- UPDATE income_log
--    SET income_type = 'earned'
--  WHERE income_type = 'other'
--    AND note LIKE '%근로%';   -- note 내용으로 구분 필요
