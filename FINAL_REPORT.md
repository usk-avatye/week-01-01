# Campaign Budget Guard 최종 검증 보고서

발표: 2026년 10월 14일 10:00 KST. 코드 기준: `2c6dd9c`. 최종 설정: **단일 Node.js API, 단일 PostgreSQL, Pool max 10, SEQUENCE 번호 발급, 집행 FOR UPDATE**.

## 1. Executive Summary

최종 설계는 **비용 없는 번호 준비, SEQUENCE 발급, 캠페인 예산 잠금, 비용과 결과의 원자적 커밋, 같은 번호의 고정 결과 반환**이다. `spent_amount`를 유지하고 기본 Pool max를 10으로 적용했다.

같은 풀 10에서 기존 순번 방식과 SEQUENCE를 비교했다. 번호 준비 처리량은 **2,421.4 → 4,426.9 RPS (+82.8%)**, p99는 **42.91 → 17.03ms (-60.3%)**였다. 세 반복 모두 개선됐다.

혼합 부하에서 풀 10은 **2,479.6 HTTP RPS, 1,239.8 집행 쌍/초**, 집행 p99 **33.39ms**였다. 풀 30 대비 집행 p99는 35.8%, DB CPU는 17.2% 감소했다. 준비 p95가 30.8% 늘어난 비용을 함께 검토해 풀 10을 선택했다.

풀 10을 적용한 전체 테스트 75/75와 빌드, 번호 비교 도구 테스트 12/12, 이전 코드의 풀 10 회귀 테스트 9/9가 통과했다. 번호 비교 72,000요청과 풀 비교 324,000요청의 오류 및 비용 불일치는 0건이다. 원격 Push는 실행하지 않았다.

본문의 최종 성능은 풀 10에서 확인한 C와 D를 사용한다. 이전 풀 30의 A~D 실험과 후보 선택 과정은 부록에 보존했다.

## 2. 검증 결과

| 검증 | 설정과 결과 | 근거 |
| --- | --- | --- |
| 서비스 전체 테스트 | Pool10 적용 뒤 75/75 통과 | [final-tests.txt](performance/results/pool-size-experiment/verification/final-tests.txt) |
| 서비스 빌드 | Pool10 적용 뒤 종료 코드0 | [final-build.txt](performance/results/pool-size-experiment/verification/final-build.txt) |
| 측정 도구 | 선택 조건과 교차 순서를 포함해12/12 통과 | [measurement-tests.txt](performance/results/preparations-pool10/verification/measurement-tests.txt) |
| 이전 코드 회귀 | max10 적용 뒤 집행/잠금9/9, TypeScript 빌드 통과 | [counter-tests.txt](performance/results/preparations-pool10/verification/counter-tests.txt), [counter-build.txt](performance/results/preparations-pool10/verification/counter-build.txt) |
| 번호 발급 비교 | 6조건, 측정72,000건 오류0 | N 원본과 summary |
| 풀 크기 비교 | 18조건, 측정324,000건 오류0 | P 원본과 summary |
| 실제 데이터 | 각 실험의 전후 READ ONLY 감사에서 모든 테이블의 행 수와 내용 해시 일치 | [N 감사](performance/results/preparations-pool10/verification/real-data-comparison.json), [P 감사](performance/results/pool-size-experiment/verification/real-data-comparison.json) |
| 시연 API | GET / 200, 비로그인 GET /api/auth/me 401 | [api-available.json](performance/results/preparations-pool10/verification/api-available.json) |

회원가입, 로그인, 캠페인 생성, 예산 변경, 승인/거절, 재전송과 역할/소유권 검증은 서비스 전체 테스트에 포함한다. 초기 HTTP 시연은15단계, 초기 Chrome 시연은 가입부터 승인/거절과 재전송까지 확인했고 해당 기록은 부록의 원본에 있다.

전체 테스트와 빌드 뒤 번호 재비교에서 운영 API, 계약과 DB에 추가 변경이 없어 통과 결과를 재사용했다. 이번 문서 정리는 측정 수치와 설정 표기를 검증했다. 다른 작업의 화면 및 복구 시연 수정은 해당 작업에서 검증한다.

독립 리뷰에서 N과 P의 원본 SHA-256, 요청별 지연, 풀 획득/대기와 DB CPU를 재계산했고 보고서 수치와 일치했다. 기록: [N 리뷰](performance/results/preparations-pool10/verification/final-review.md), [P 리뷰](performance/results/pool-size-experiment/verification/final-review.md).

## 3. Baseline과 최종 설정 성능 (Pool10)

실험 출처:

- **N: 번호 발급 방식 비교.** 2026-10-13 23:34:06~23:34:39 KST. counter와 SEQUENCE를 둘 다 Pool10, 동시성60으로 비교했다. [summary.json](performance/results/preparations-pool10/summary.json).
- **P: Connection Pool Size Experiment.** 같은 날 21:55:05~21:57:39 KST. SEQUENCE에서 max10/30/60을 비교했다. [summary.json](performance/results/pool-size-experiment/summary.json).

두 실험의 비교율은 각각 같은 실행 안의 조건끼리 계산한다. RPS와 작업/초는3회 산술평균, p50/p95/p99는 반복별 백분위수의 중앙값이다. 요청 지연은 nearest-rank로 계산했다. 오류는 HTTP/통신/파싱 실패와 예상 상태 및 금액 불일치를 포함한다.

### Baseline: 기존 순번도 Pool10

기존 방식은 캠페인을 FOR UPDATE로 잠그고 `last_execution_no`를 증가시킨다. 이전 코드 d8664e2 사본의 변경은 max30→10 한 줄이며 [패치](performance/results/preparations-pool10/counter-pool10.patch)에 보존했다. 시작 정보에서 실제 풀10과 counter 구현을 확인했다.

| 번호 발급 방식 | Pool max | 동시성 | RPS (최소~최대) | CV | p95 ms | p99 ms | 오류율 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 기존 순번 | 10 | 60 | 2,421.4 (2,399.2~2,442.8) | 0.9% | 37.01 | 42.91 | 0% |
| SEQUENCE | 10 | 60 | 4,426.9 (4,392.1~4,445.2) | 0.7% | 15.02 | 17.03 | 0% |

### 최종 설정의 C와 D

C는 번호 준비만 호출한다. D는 준비와 집행 두 HTTP 요청을 한 작업으로 본다. D의 HTTP 지연은 두 API 요청을 합친 분포다.

| 시나리오 | Pool max | 동시성 | HTTP RPS | 작업/초 | p50 ms | p95 ms | p99 ms | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C: 번호 준비 | 10 | 60 | 4,426.9 | 4,426.9 준비 | 13.40 | 15.02 | 17.03 | N |
| D: 준비 후 집행 | 10 | 60 | 2,479.6 | 1,239.8 쌍 | 23.74 | 29.32 | 32.00 | P |

D의 집행 쌍/초는 HTTP RPS의 절반이다. 준비 API와 집행 API의 지연은5절에서 따로 비교한다.

## 4. 병목 분석

### 번호 준비: 캠페인 행의 직렬화

| 방식 | 풀 사용/대기 최대 | 획득 p95 ms | 획득 p99 ms | DB 락 관찰 비율 | API CPU % | DB CPU % | 준비 1건당 DB CPU ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 기존 순번 | 10/50 | 14.272 | 16.674 | 83.6% | 75.3 | 90.2 | 0.3778 |
| SEQUENCE | 10/50 | 6.324 | 7.730 | 0.0% | 108.8 | 102.1 | 0.2369 |

N에서 기존 순번의 DB 락 관찰 비율은83.6%, SEQUENCE는0%였다. 두 구현 모두 최대50작업이 풀에서 기다렸지만, SEQUENCE의 획득 p95는14.272 → 6.324ms로55.7% 줄었다. 기존 코드의 캠페인 행 잠금을 제거한 뒤 연결을 더 빨리 반환하는 결과와 맞는다.

SEQUENCE의 DB CPU 사용률은13.2% 높았고 처리량은82.8% 높았다. 관찰 구간의 DB CPU 시간을 측정 준비 수로 나눈 값은0.3778 → 0.2369ms로37.3% 감소했다. CPU 사용률과 요청당 CPU 비용을 구분했다.

CPU 100%는 한 코어다. SEQUENCE API는 한 코어 수준을 사용했으므로 API 처리 비용이 다음 병목 후보라는 추론을 했다. 함수별 CPU 프로파일은 수집하지 않았다.

### 혼합 부하: 예산 행 잠금과 대기 위치

P의 D/Pool10에서 DB 락 관찰 비율은77.8%였다. 집행은 같은 캠페인 예산을 FOR UPDATE로 잠그므로 예산 수정 순서가 유지된다. 준비 INSERT의 FK 확인도 집행 잠금을 기다릴 수 있다.

풀60에서는 연결 획득 p95가0.009ms로 짧았지만 집행 p99가236.68ms였다. 풀10에서는 획득 p95가12.463ms이고 집행 p99는33.39ms였다. 일부 대기를 API 풀에 두어 DB 안의 동시 잠금 경합을 줄였다는 해석과 맞는다. 집행 HTTP 지연에는 풀 획득 대기도 포함된다.

락 관찰 비율은 활동 중인 API DB 연결 관찰 중 Lock 대기인 비율의 반복 평균이다. 풀은20ms, DB는100ms 간격으로 관찰했다. 대기 쿼리 경과 시간과 순수 락 대기 시간을 구분한다.

## 5. 최적화 결과와 채택 판단

### SEQUENCE 채택: 같은 Pool10에서 재검증

| 반복 | 기존 RPS | SEQUENCE RPS | 기존 p99 ms | SEQUENCE p99 ms | RPS 변화 |
| --- | --- | --- | --- | --- | --- |
| 1 | 2,399.2 | 4,445.2 | 41.96 | 17.03 | +85.3% |
| 2 | 2,442.8 | 4,443.5 | 43.06 | 16.95 | +81.9% |
| 3 | 2,422.3 | 4,392.1 | 42.91 | 17.07 | +81.3% |

처리량 반복 범위가 겹치지 않았고 세 반복 모두 p95/p99가 감소했다. **번호 발급의 SEQUENCE와 준비 잠금 제거를 유지한다.** 집행 및 예산/상태 변경의 FOR UPDATE와 비용/결과 트랜잭션은 유지한다.

새 번호는 DB 전체의 BIGINT SEQUENCE로 발급하고 API에서 문자열로 전달한다. 기존 `(campaign_id, execution_no)` 주소와 결과 DTO를 보존했다. 마이그레이션은 기존 번호 및 카운터의 최댓값 뒤에서 시작한다. 번호의 공백은 허용하며 캠페인별 집행 건수나 커밋 순서로 사용하지 않는다. 준비의 생성 시각은 executions.created_at에 저장한다.

### Connection Pool Size Experiment

P는 최종 SEQUENCE 구현에서 Pool max만 바꿨다. 동시성은 모든 행에서60이다.

| 시나리오 | Pool max | 동시성 | RPS (최소~최대) | CV | HTTP p95 ms | HTTP p99 ms | 오류율 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C | 10 | 60 | 4,319.3 (4,291.9~4,343.3) | 0.6% | 15.52 | 17.67 | 0% |
| C | 30 | 60 | 4,299.0 (4,235.6~4,357.6) | 1.4% | 15.49 | 17.71 | 0% |
| C | 60 | 60 | 4,391.0 (4,349.1~4,413.9) | 0.8% | 16.23 | 18.28 | 0% |
| D | 10 | 60 | 2,479.6 (2,432.1~2,517.1) | 1.7% | 29.32 | 32.00 | 0% |
| D | 30 | 60 | 2,284.6 (1,999.5~2,482.8) | 11.1% | 46.67 | 50.57 | 0% |
| D | 60 | 60 | 2,245.0 (2,203.6~2,279.6) | 1.7% | 119.99 | 205.18 | 0% |

혼합 부하의 준비/집행 지연과 자원:

| Pool max | 준비 p95 ms | 준비 p99 ms | 집행 p95 ms | 집행 p99 ms | 집행 쌍/초 | 획득 p95 ms | DB 락 관찰 비율 | DB CPU % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 25.94 | 28.66 | 30.30 | 33.39 | 1,239.8 | 12.463 | 77.8% | 97.3 |
| 30 | 19.83 | 22.62 | 48.49 | 51.99 | 1,142.3 | 8.211 | 93.6% | 117.4 |
| 60 | 6.61 | 12.77 | 155.63 | 236.68 | 1,122.5 | 0.009 | 96.1% | 169.3 |

풀30 대비 변화율이다. 지연의 음수는 감소, 양수는 증가다.

| 시나리오 | Pool max | RPS | HTTP p95 | HTTP p99 | 집행 p95 | 집행 p99 | DB CPU |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C | 10 | +0.5% | +0.2% | -0.2% | — | — | -14.8% |
| C | 60 | +2.1% | +4.8% | +3.2% | — | — | +5.0% |
| D | 10 | +8.5% | -37.2% | -36.7% | -37.5% | -35.8% | -17.2% |
| D | 60 | -1.7% | +157.1% | +305.8% | +220.9% | +355.2% | +44.2% |

풀10을 선택한 사전 기준은 C/D 처리량 손실5% 이내에서 반복별 집행 p95/p99가15% 이상 개선되고 DB 자원 사용이 줄어드는 것이었다. 세 반복의 집행 p95는35.6~44.7%, p99는35.8~84.1% 감소했고 DB CPU는17.2% 줄었다. 오류와 비용 불일치는0건이었다.

D 평균 처리량 +8.5%는 반복 범위가 겹쳤다. 풀30의3회차는1,999.5 RPS, 집행 p99 236.10ms로 변동이 컸다. 모든 반복을 포함했고1~2회차에서도 집행 p99가35.8%,38.1% 감소했다. 채택 근거는 반복된 집행 지연 개선과 DB 자원 감소다.

풀10의 혼합 부하 준비 p95/p99는 풀30 대비30.8%/26.7% 증가했다. 번호 준비의 추가 대기와 집행 꼬리 지연 감소를 함께 검토했다. 풀60은 C 처리량 +2.1%에 비해 D 집행 p99 +355.2%, DB CPU +44.2%여서 기본값으로 선택하지 않았다.

### 자원 수치

| 시나리오 | Pool max | API CPU % | DB CPU % | API 종료 RSS MiB | DB 합산 RSS 피크 MiB |
| --- | --- | --- | --- | --- | --- |
| C | 10 | 108.4 | 105.2 | 123.7 | 253.0 |
| C | 30 | 108.6 | 123.4 | 135.6 | 641.3 |
| C | 60 | 108.9 | 129.5 | 127.3 | 1,181.7 |
| D | 10 | 79.1 | 97.3 | 132.8 | 294.9 |
| D | 30 | 76.0 | 117.4 | 124.2 | 718.2 |
| D | 60 | 78.4 | 169.3 | 137.1 | 1,342.8 |

API CPU는 process.cpuUsage, DB CPU는250ms 간격의 PID별 누적 CPU 시간 차이로 계산했다. DB에는 관찰 연결과 백그라운드 프로세스를 포함한다. CPU 시간 해상도는10ms이고 관찰 구간에는 시작/종료 샘플 구간도 포함한다. P의 DB 구간은 HTTP 구간보다0.9~5.0% 길었다.

API RSS는 측정 종료 값이다. DB RSS는 프로세스별 합계의 반복별 피크 평균이며 공유 페이지가 중복될 수 있다. 풀10의 RSS 지표 감소를 물리 메모리 절감률로 환산하지 않았다. P의 max60에서도 관찰된 클라이언트 연결 최대66개로 max_connections100 이내였다.

## 6. 정합성 재검증

| 상황 | 확인한 동작 |
| --- | --- |
| 예산10,000원에서20개가1,000원씩 동시 집행 | 승인10개, 거절10개, 사용액과 승인 합계10,000원 |
| 같은 번호20회 동시 전송 | 비용1,000원 한 번, 반환 결과 및 처리 시각 동일 |
| 같은 번호의 금액 변경 | 409, 원래 결과 유지 |
| 거절 후 예산 증가 또는 재개 | 같은 번호는 기존 거절, 새 번호로 새 판단 |
| 비용 반영 후 결과 저장 실패 | 두 쓰기 롤백, PREPARED 유지, 같은 번호 재시도 성공 |
| 준비 응답 유실 | 비용 없는 준비 행, 사용액0 |
| 승인 커밋 후 응답 유실 | 같은 번호 조회/재전송으로 복구, 추가 차감0 |
| GET, 늦은 POST와 재전송 경합 | 승인 비용 한 번 |
| 두 캠페인의60개 동시 준비 | 새 번호60개 구분, 사용액0 |
| 준비 INSERT 실패 | 행과 비용0, SEQUENCE 번호 공백 |
| 기존 스키마 업그레이드 | 기존 결과 및 복합키 보존, 기존 최댓값 뒤 발급 |
| JavaScript 안전 정수 초과 ID | 9007199254740993 문자열 유지 |
| 시드 반복 | 기존 예산, 상태, 비용과 집행 행 보존 |

서비스 예산 판단은 `spent_amount`를 사용한다. 승인 비용과 결과를 한 트랜잭션으로 기록하고 SUM은 검증에 사용했다.

N은 매 조건에서 PREPARED14,000행과 사용액0을 확인했다. P의 C도 동일하며 D는 승인14,000행과 사용액14,000원을 확인했다. 워밍업을 포함한 건수다. 모든 조건에서 기록 건수, 상태와 승인 합계가 예상값과 일치했다.

실제 DB 감사는 READ ONLY 트랜잭션으로 모든 행 내용의 해시를 비교했다. N은 members4, sessions3, campaigns13, executions39, schema_migrations2행이 전후 동일했다. P도 해당 실험의 시작/종료 스냅샷이 모두 일치했다.

## 7. 재현 방법과 측정 환경

| 항목 | 값 |
| --- | --- |
| OS/CPU/RAM | macOS27.0.1, Apple M1 Pro,10 logical CPUs,16GiB |
| API | Node20.20.2, TypeScript5.9.3, Express5.3.0, pg8.23.1 |
| 최종 서비스 풀 | max10, 연결 획득 제한3초, idle10초 |
| DB | PostgreSQL18.4, 별도 _test DB와 조건별 임시 스키마 |
| DB 설정 | max_connections100, shared_buffers128MB, fsync/on, synchronous_commit/on, full_page_writes/on, READ COMMITTED |
| 부하 | 동시성60, 워밍업2,000 뒤 측정12,000작업, 조건별3회 |
| 데이터 | 캠페인1개, ACTIVE, 예산10억 원, D 요청1원 |
| 연결/관찰 | HTTP/1.1 keep-alive, 풀20ms, DB100ms, 자원250ms |

조건마다 새 API 프로세스와 풀을 시작하고 새 스키마를 만들었다. 워밍업 뒤 ANALYZE를 실행했다. API/생성기/DB는 같은 컴퓨터에서 실행하고 관찰 비용을 포함했다. N에서 포트3000의 기존 시연 API는 유지됐고 부하는3101 측정 API에만 보냈다. N/P 모두 관찰된 외부 클라이언트의 active DB 상태는0건이었다.

### 최종 Pool10의 C/D 측정

저장소 루트에서 빌드와 PostgreSQL을 준비한 뒤 실행한다. 아래 명령은 최종 설정의 C/D, 동시성60을 측정한다.

```sh
node --env-file=.env performance/pool-runner.mjs --label final-pool10-repro --pool-max 10
node performance/pool-analyze.mjs final-pool10-repro
```

### 기존 순번과 SEQUENCE의 Pool10 비교

분리된 d8664e2 사본을 준비하고 Node 의존성을 연결한 뒤 실행한다. 전체 준비 명령은 [performance/README.md](performance/README.md)에 있다.

```sh
node --env-file=.env performance/compare-preparations.mjs /private/tmp/guard-counter-pool10-repro preparations-pool10-repro
node performance/analyze-preparations.mjs preparations-pool10-repro
```

### Pool10/30/60 선택 실험

```sh
node --env-file=.env performance/pool-runner.mjs --label pool-choice-repro
node performance/pool-analyze.mjs pool-choice-repro
```

결과 레이블과 비교 접두사는 실행마다 새 이름을 사용한다. 분석기는 원본 SHA-256, 요청 지연, 풀 획득/대기, PID별 CPU, 고정 조건과 승인 합계를 검증한다. 실제 측정 소스/컴파일/도구 해시는 각 manifest에 있다.

보존 파일:

- [N summary](performance/results/preparations-pool10/summary.json)와 counter-r1~r3/sequence-r1~r3 여섯 폴더: 번호 비교의 요청별 지연, 풀/DB/CPU 원본 gzip.
- [P summary](performance/results/pool-size-experiment/summary.json)와 같은 폴더의18개 gzip: 풀 크기별 원본 및 comparison.json.
- [측정 도구 사본](performance/results/preparations-pool10/measurement-harness.tar.gz): N의 실제 계측 파일과 해시.
- 각 실험 verification/: 테스트/빌드, 실제 DB 감사, 독립 리뷰와 API 응답 기록.

## 8. 남은 한계와 리스크

- 풀10의 성능 측정 범위는 C/D 동시성60이다. A/B와 다른 동시성의 기존 결과는 풀30 실험 이력에 있다.
- 조건별3회 단기 closed-loop 부하다. 장기 부하, 대규모 데이터, 별도 생성기 장비, 외부 네트워크/TLS와 고정 도착률 부하는 추가 측정 대상이다.
- 락 샘플링은 짧은 대기를 놓칠 수 있다. 계측 제거 대조군, 함수별 CPU 프로파일과 GC/스케줄러 원인 분석은 수집하지 않았다.
- 집행에는 캠페인 예산 잠금이 남는다. 서로 다른 캠페인 분산 부하에서 풀10의 최적값은 추가 비교가 필요하다.
- 단일 DB 중단, DB 재시작 중 요청, 커밋 여부가 불명확한 DB 연결 단절 및 재해 복구는 추가 검증 대상이다. HTTP 응답 유실과 트랜잭션 쓰기 실패는 확인했다.
- 이전 카운터 서버와 SEQUENCE 서버가 동시에 쓰는 배포는 별도 검증 대상이다. 실제 전환은 API 중지, 마이그레이션, 새 빌드 시작 순서로 수행했다.

## 9. 10분 발표용 핵심 메시지

| 시간 | 이야기 | 근거 |
| --- | --- | --- |
| 0:00~1:00 | 문제: 동시 집행과 재전송에서도 캠페인 예산을 지킨다. | 예산10,000원과20개 동시 집행 |
| 1:00~3:00 | 설계: 비용 없는 준비, DB 순번, 고정 결과, 비용/결과의 원자적 커밋. | 회원/세션/캠페인/집행 관계와 트랜잭션 |
| 3:00~5:00 | 검증: 승인/거절, 중복 차감, 롤백과 응답 유실 복구. | Pool10 회귀75개와 재전송/복구 사례 |
| 5:00~7:00 | 성능: 같은 Pool10에서도 번호 발급의 캠페인 잠금을 제거한 효과가 남았다. | C 처리량+82.8%, p99-60.3% |
| 7:00~9:00 | 판단: 연결을 늘리면 같은 예산의 경합도 늘었다. 준비 지연 비용을 포함해 풀10을 선택했다. | D 집행 p99 51.99→33.39ms, 준비 p95 19.83→25.94ms |
| 9:00~10:00 | 결론: SEQUENCE와 Pool10을 유지하고 예산 정합성을 지키는 집행 잠금은 유지한다. | 동작 규칙, 반복 결과와 미측정 범위 |

발표의 중심 문장: **“같은 예산을 지킬 규칙은 유지하고, 번호 발급의 직렬화와 DB에 들어가는 요청 수를 각각 측정해 조정했습니다.”**

## 부록: 풀30에서 진행한 설계 결정 이력

| 실험 | 당시 조건과 결과 | 기록 |
| --- | --- | --- |
| 초기 Baseline과 후보 | Pool30, A~D, 동시성1/10/30/60, 각3회 | baseline/, optimized/, sequence-only/ |
| SEQUENCE 및 FOR NO KEY UPDATE 후보 | Pool30에서 D/30 RPS-27.7%, D/60-25.9%로 잠금 강도 변경 폐기 | optimized/no-key-update.patch와 원본 |
| SEQUENCE 및 기존 FOR UPDATE | Pool30의 C/60 2,117.9→4,308.0 RPS (+103.4%) | sequence-only/comparison-baseline.json |
| 추가 교차 확인 | Pool30에서 A/1, B/10, A/30, D/30의 편차와 p99 검토 | confirm-base-*, confirm-sequence-* |
| 초기 기능 시연 | HTTP15단계와 Chrome 가입/캠페인/집행/재전송 | performance/results/verification/ |

전체 당시 표와 후보 판단은 [수정 전 보고서](performance/results/report-history/FINAL_REPORT-2c6dd9c.md)에 보존했다. 원본 측정 파일도 유지했다. 풀30의+103.4%와 풀10의+82.8%는 각각 같은 설정 안의 구현 비교다. 두 값의 차이를 풀 크기 자체의 기여율로 계산하지 않는다.
