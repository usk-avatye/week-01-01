# 성능 검증 재현

Node.js 20.20.2와 PostgreSQL 18.4를 사용한다. 서비스 API의 기본 풀 크기는 10이다. 기존 A~D 측정 도구는 이전 비교를 재현하도록 최대 연결 30개를 사용한다. `.env`의 `TEST_DATABASE_URL`은 이름이 `_test`로 끝나는 DB를 가리킨다. 각 실행은 이 DB에 새 임시 스키마를 만들고 종료 시 정리한다.

## 최종 설정 측정 (Pool10)

현재 API 빌드와 PostgreSQL을 준비한 뒤 저장소 루트에서 실행한다. C 번호 준비와 D 준비 후 집행을 동시성60으로 측정한다.

```sh
node --env-file=.env performance/pool-runner.mjs --label final-pool10-repro --pool-max 10
node performance/pool-analyze.mjs final-pool10-repro
```

워밍업2,000작업 뒤12,000작업을3회 실행하며 실제 풀10을 확인한다. A/B와 다른 동시성의 기존 전체 측정은 아래 풀30 이력 재현 명령을 사용한다.

## 실행

```sh
npm ci
cp .env.example .env
npm run db:start
```

다른 터미널에서 실행한다. 기존 `.env`를 사용하면 복사 단계를 건너뛴다.

```sh
npm run build
npm test
npm run perf:test
npm run perf:smoke -- reproduction-http-smoke
npm run perf:run -- --label reproduction
node performance/analyze.mjs reproduction
```

측정 중에는 부하 대상 API 하나를 실행한다. 도구가 포트 3101에서 API를 시작하고 종료한다. 포트 변경은 `PERF_PORT` 환경변수를 사용한다. 결과 레이블마다 새 출력 폴더를 만든다.

## 이전 Baseline과 후보 비교 (Pool30)

Baseline 코드는 `d8664e2b89873ed979acbb32b486c3d00571ef7c`다. 도구는 이전 캠페인 카운터와 SEQUENCE 구현을 모두 지원한다. 기존 PostgreSQL에 접속할 설정을 준비한 뒤 저장소 루트에서 아래 명령으로 Baseline을 재현한다.

```sh
baseline_source_checkout="$PWD"
git worktree add --detach /private/tmp/guard-baseline d8664e2b89873ed979acbb32b486c3d00571ef7c
cp -R performance /private/tmp/guard-baseline/performance
cp .env.example /private/tmp/guard-baseline/.env
cd /private/tmp/guard-baseline
npm ci
npm run build
node --env-file=.env performance/runner.mjs --label baseline-repro
```

현재 checkout을 빌드해 후보를 측정하고, Baseline 결과를 가져와 비교한다.

```sh
cd "$baseline_source_checkout"
npm run build
npm run perf:run -- --label optimized-repro
cp -R /private/tmp/guard-baseline/performance/results/baseline-repro performance/results/baseline-repro
node performance/analyze.mjs baseline-repro optimized-repro
```

분석기는 원본 gzip의 SHA-256과 조합별 반복 수를 검증한다. 두 결과의 부하 조건, 실행 순서, 측정 도구 해시가 같아야 비교 파일을 생성한다.

## 이전 A~D 측정 조건 (Pool30)

| 구분 | 조건 |
| --- | --- |
| A | 한 캠페인의 준비된 번호로 집행 |
| B | 열 캠페인에 번호를 균등 분배해 집행 |
| C | 한 캠페인의 준비 번호 발급 |
| D | 한 캠페인에 준비 후 집행, 작업마다 HTTP 두 건 |
| 동시성 | 1, 10, 30, 60 |
| 반복 | 조합마다 3회 |
| 워밍업 | 반복마다 2,000개 작업 |
| 측정 | 반복마다 12,000개 작업 |
| 집행 | 1원, 총예산 10억 원, 모든 집행 승인 예상 |
| 요청 | HTTP/1.1 keep-alive, closed-loop, 재시도 없음 |
| 관찰 | 풀 20ms, PostgreSQL 100ms, 별도 관찰 연결 |

A/B는 14,000개 PREPARED 행을 SQL로 미리 생성하고 생성 시간을 원본에 남긴다. C는 실제 준비 API를 측정한다. D의 HTTP RPS와 작업 쌍 처리량을 구분한다. 매 반복은 새 데이터로 시작하고 워밍업 뒤 ANALYZE를 실행한다.

## 결과 파일

- `results/baseline/`: 초기 구현의 전체 측정.
- `results/optimized/`: 폐기한 SEQUENCE와 NO KEY UPDATE 후보의 전체 측정.
- `results/sequence-only/`: 기존 FOR UPDATE를 유지한 SEQUENCE 후보의 전체 측정.
- `results/confirm-base-*`, `results/confirm-sequence-*`: 편차가 컸던 네 구간의 추가 교차 비교.
- `manifest.json`: 환경, 실행 순서, 소스와 도구 해시.
- `index.json`: 반복별 RPS, 백분위수, 풀, 락, 정합성 결과.
- `A-c1-r1.json.gz` 등: 요청별 지연, 풀 획득 시간, 풀과 DB 관찰 원본.
- `summary.json`, `summary.csv`: 3회 평균 RPS와 반복별 백분위수의 중앙값, 처리량 범위와 변동계수.
- `comparison-<기준 레이블>.json`: 후보의 처리량, p95, p99 변화율.
- `results/verification/`: 기능 검증, 빌드와 테스트 로그, 실제 DB 읽기 감사, 브라우저 캡처.
- `results/harness-smoke/`: 도구 점검용 소규모 실행.

락 비율은 활동 중인 DB 연결을 관찰했을 때 `wait_event_type='Lock'`인 비율이다. 대기 쿼리의 경과 시간과 순수 락 대기 시간은 구분한다. 풀 획득 시간에는 연결 획득 처리 비용도 포함한다. API CPU의 100%는 CPU 한 코어 사용량이다.

추가 비교는 동일 도구가 준비된 Baseline checkout 경로를 넘겨 실행한다. A/1, B/10, A/30, D/30을 각각 Baseline 3회 후 SEQUENCE 후보 3회 순서로 실행한다. 각 API는 순차적으로 종료하며 작업량과 워밍업은 전체 측정과 같다.

```sh
node performance/confirm.mjs /private/tmp/guard-baseline reproduction-confirm
node performance/analyze.mjs reproduction-confirm-base-a1 reproduction-confirm-sequence-a1
node performance/analyze.mjs reproduction-confirm-base-b10 reproduction-confirm-sequence-b10
node performance/analyze.mjs reproduction-confirm-base-a30 reproduction-confirm-sequence-a30
node performance/analyze.mjs reproduction-confirm-base-d30 reproduction-confirm-sequence-d30
```

세 번째 인자는 새 결과 접두사다. 다시 측정할 때는 새 접두사를 사용한다.

## Connection Pool Size Experiment

시연 API를 Ctrl+C로 중지한 뒤 저장소 루트에서 실행한다. PostgreSQL은 계속 실행한다.

```sh
npm run build
mkdir -p performance/results/pool-repro/verification
node --env-file=.env performance/audit-real-data.mjs before performance/results/pool-repro/verification
node --env-file=.env performance/pool-runner.mjs --label pool-repro
node performance/pool-analyze.mjs pool-repro
node --env-file=.env performance/audit-real-data.mjs after performance/results/pool-repro/verification
npm start
```

풀 전용 실행기는 max 10, 30, 60을 명시해 C와 D의 동시성 60을 비교한다. 조건마다 새 API와 임시 스키마를 사용하며 2,000작업 워밍업 뒤 12,000작업을 3회 측정한다. D는 작업당 준비와 집행 두 HTTP 요청이다. 교차 순서는 `pool-protocol.mjs`에 고정돼 있다. 실행 중 API, DB, 빌드와 측정 도구 파일의 해시를 확인한다. 출력 레이블은 실행마다 새 이름을 사용한다.

`results/pool-size-experiment/`에 실제 측정 18개 원본 gzip, 환경과 순서 manifest, index, summary JSON/CSV, max30 대비 comparison과 검증 로그를 보존했다. 분석기는 원본 SHA-256과 요청별 지연, 연결 획득 시간, 풀 샘플, PID별 CPU 및 정합성 결과를 다시 계산한다. `results/pool-harness-smoke/`는 작은 작업량으로 실행기를 점검한 결과다.

DB 자원 관찰은 같은 호스트의 PostgreSQL에 접속해 250ms마다 `/bin/ps`를 실행한다. CPU는 프로세스 누적 CPU 시간 차이이며 100%는 한 코어다. DB에는 관찰 연결과 백그라운드 프로세스를 포함한다. RSS 합계에는 프로세스 간 공유 페이지가 중복될 수 있다. API RSS는 측정 종료 시점 값이다. DB CPU 관찰 구간과 HTTP 측정 구간의 길이는 각각 원본에 저장한다.

## 풀 10의 번호 발급 비교

저장소 루트에서 이전 코드의 분리된 사본을 준비한다. 기존 d8664e2 사본이 있으면 그 경로를 사용한다.

```sh
git worktree add --detach /private/tmp/guard-counter-pool10-repro d8664e2b89873ed979acbb32b486c3d00571ef7c
ln -s "$PWD/node_modules" /private/tmp/guard-counter-pool10-repro/node_modules
node --env-file=.env performance/compare-preparations.mjs /private/tmp/guard-counter-pool10-repro preparations-pool10-repro
node performance/analyze-preparations.mjs preparations-pool10-repro
```

현재 코드의 API 빌드를 준비한 상태에서 실행한다. 드라이버가 이전 사본의 풀 max만30에서10으로 바꾸고 빌드 및 동시 집행 관련 테스트를 실행한다. 그 외 서버/계약/DB 변경이 있으면 중단한다. 두 사본에 같은 측정 파일을 사용하고 `.env`는 현재 저장소의 파일을 읽는다.

C, Pool10, 동시성60, 워밍업2,000, 측정12,000을3회씩 실행한다. 순서는 기존/SEQUENCE, SEQUENCE/기존, 기존/SEQUENCE다. 매 조건은 새 API/테스트 스키마로 실행하며 실제 풀 크기와 번호 발급 방식을 확인한다. 측정 대상 포트는3101이고 모든 부하를 이 API에 보낸다.

`results/preparations-pool10/`의 manifest에 교차 순서와 조건별 폴더 경로가 있다. 여섯 `preparations-pool10-counter-r*`, `preparations-pool10-sequence-r*` 폴더에 요청, 풀, 잠금 및 자원의 원본을 보존했다. 분석기는 기존 pool-analyze를 실행해 원본을 검증하고 두 구현의 평균 RPS, 반복 범위, 지연 중앙값과 변화율을 비교한다. 실제 측정 도구 사본은 measurement-harness.tar.gz에 있다.

## B 분산 집행 Pool 추가 비교

10캠페인에 균등 배분한 집행을 Pool10/30, 동시성30/60으로3회씩 교차 측정한다. 요청 번호는 fixture SQL로 준비하고 HTTP 집행 시간만 측정한다. 각 조건은 워밍업2,000작업과 측정12,000작업이며 새 API와 테스트 스키마를 사용한다.

```sh
node --env-file=.env performance/pool-runner.mjs --label distributed-pool-repro --scenarios B --pool-max 10,30 --concurrency 30,60 --operations 12000 --warmup 2000 --repeats 3
node performance/pool-analyze.mjs distributed-pool-repro
```

실측 결과는 `results/distributed-pool-experiment/`에 보존한다. `manifest.json`의 protocol.schedule은12조건의 순서다. `summary.json`은 시나리오, Pool, 동시성별로 집계하며 `comparison.json`은 같은 동시성의 Pool30 대비 변화율이다. B의 HTTP RPS와 집행/초는 같다.
