# Campaign Guard: 캠페인 예산 가드

광고주가 캠페인 예산을 정하고 모의 집행을 요청하는 웹 서비스입니다. 예산을 넘는 집행을 거절하고, 같은 요청을 재전송해도 비용은 한 번만 반영합니다.

Node.js **20.20.2**, TypeScript, Express 5, `pg`, PostgreSQL을 사용합니다. Express 서버가 웹 화면과 API를 함께 제공합니다.

## 실행

프로젝트 루트에서 실행합니다. PostgreSQL 18.4는 개발 의존성에 포함되어 있습니다. 기본 포트는 DB `55432`, 웹 `3000`입니다.

```sh
npm ci
cp .env.example .env
npm run db:start
```

위 터미널을 유지한 채 두 번째 터미널에서 실행합니다.

```sh
npm run db:migrate
npm run db:seed
npm run build
npm start
```

[http://localhost:3000](http://localhost:3000)에서 확인합니다. 코드 변경 후에는 빌드하고 서버를 재시작합니다.

기존 `.env`를 사용 중이면 복사 단계를 건너뜁니다. 외부 PostgreSQL을 사용하려면 `DATABASE_URL`과 `TEST_DATABASE_URL`을 설정합니다. 테스트 DB 이름은 `_test`로 끝나야 합니다. 웹 주소를 바꾸면 `APP_ORIGIN`도 같은 주소로 설정합니다.

## 시연 계정

기본 `DEMO_PASSWORD`는 `Demo-Campaign-2026!`입니다. 가상 광고주와 캠페인으로 시연합니다.

| 진입 화면 | 이메일 | 역할 |
| --- | --- | --- |
| 광고주 로그인 | advertiser-a@example.test | 모노픽셀 |
| 광고주 로그인 | advertiser-b@example.test | 누크리빙 |
| 관리자 로그인 | admin@example.test | 관리자 (조회 전용) |

회원가입으로 광고주 계정을 만들 수 있으며 비밀번호는 15~128자입니다. 관리자 계정은 시드로 준비합니다. `db:seed`는 기존 계정과 캠페인을 유지하면서 시연 데이터를 추가하고 이름을 갱신합니다.

## 핵심 동작

- 캠페인은 일시정지 상태로 생성합니다. 일시정지 중에 누적 집행액 이상의 예산 한도로 수정할 수 있습니다.
- ‘요청 번호 준비’는 캠페인별 DB 순번을 발급합니다. 비용은 승인 시 반영합니다.
- 총예산과 집행 금액은 1~1,000,000,000원 정수입니다. 운영 중이고 예산이 충분하면 전액 승인합니다. 일시정지 또는 예산 부족이면 비용 없이 거절합니다.
- 같은 캠페인, 번호와 금액의 재전송은 원래 결과와 처리 시각을 돌려줍니다. 같은 번호에서 금액만 바꾸면 409입니다.
- 승인과 거절 결과는 고정됩니다. 조건 변경 후 새 판단은 새 번호로 요청합니다.
- 브라우저는 집행 전 번호와 금액을 보관합니다. 응답을 확인할 때까지 같은 번호와 금액으로 조회하거나 재전송합니다. 조회 결과가 ‘준비’여도 늦은 집행 요청이 도착할 수 있어 번호와 금액을 유지합니다.
- 관리자는 모든 광고주의 캠페인과 이력을 조회합니다. API에서 역할과 소유권을 검사합니다.

## 구조

`app.ts`에서 의존성을 조립하고 기능별 모듈이 HTTP, 업무 판단, SQL, 화면을 맡습니다.

| 경계 | 책임 |
| --- | --- |
| `src/server/auth` | 회원가입, 비밀번호, DB 세션, 역할, CSRF 검사 |
| `src/server/campaigns` | 소유자 캠페인 조회, 예산, 상태 변경 |
| `src/server/executions/decision.ts` | 상태, 예산에 대한 순수 업무 판단 |
| `src/server/executions/service.ts` | 준비, 집행의 트랜잭션 순서 |
| 기능별 `repository.ts` | 매개변수화 SQL과 DB 행 변환 |
| 기능별 `routes.ts` | HTTP 입력과 응답 연결 |
| `src/server/admin` | 관리자 전용 읽기 쿼리와 라우트 |
| `src/contracts` | 서버와 브라우저 사이 DTO, 식별자는 문자열 |
| `src/client/main.ts` | 경로 선택과 화면 조립 |
| `execution-controller`, `execution-flow`, `pending-store` | 통신 조율, 결과 판별, 요청 정보 보관 |
| 나머지 `src/client` 화면 모듈 | 기능별 DOM 렌더링 |

모든 캠페인 변경은 **캠페인 행 → 집행 행** 순서로 잠급니다. 확정된 요청은 기존 결과를 반환하고 준비 상태인 요청만 현재 조건으로 판단합니다. 예산 반영과 결과 저장을 같은 트랜잭션으로 커밋한 뒤 응답합니다.

## 검증과 발표

DB 실행 상태에서 다음 명령을 사용합니다.

```sh
npm test
npm run build
```

테스트마다 전용 DB에 임시 스키마를 만듭니다. PostgreSQL과 HTTP로 예산, 중복 처리, 잠금 순서를 확인하고, 테스트 프록시와 DB 트리거로 응답 유실, 지연, 롤백을 재현합니다.

설계, ERD, API, 구현 계획, 검증 기록과 발표 자료는 로컬 `docs/` 폴더에서 관리합니다. 이 폴더는 Git에서 제외합니다. 업무 용어는 [GLOSSARY.md](GLOSSARY.md)에 정리했습니다.
