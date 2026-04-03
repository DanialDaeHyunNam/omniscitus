# omniscitus v0.1.0 — 설계부터 배포까지

## 요약
Sequoia 글("From Hierarchy to Intelligence")을 레퍼런스 삼아 코드베이스 세계 모형 플러그인 omniscitus를 0에서 설계·구현·배포까지 완료. 8개 skill, birdview 대시보드, GitHub Pages 소개 사이트를 하루 세션에 만들었다.

## 배경
Dan이 실제 서비스 운영 중 느낀 문제 — 파일 목적 추적, 세션 기록 중복, 테스트 관리 분산 — 를 시스템으로 해결하려는 구상. 잭 도르시 글은 유사한 철학이라 설계 다듬는 데 참고했을 뿐, 핵심 아이디어는 Dan의 오리지널.

## 배운점
- Claude Code plugin 시스템은 marketplace 기반 → repo를 `plugins/{name}/` 구조로 감싸면 바로 배포 가능
- PostToolUse hook은 zero-dep CJS 스크립트로 3초 내 실행 필수 → 간단한 YAML은 line-based 파싱으로 충분
- PreCompact hook으로 wrap-up 유도하면 context 유실 방지 가능
- 프롬프트 테스트는 코드 테스트와 근본적으로 다름 → LLM judge + multi-dimensional scoring이 필수

## 후속 작업
- [ ] 실제 프로젝트에 설치하여 E2E 테스트 (hook 동작, skill 실행)
- [ ] SessionStart hook 스크립트 구현 (유저 파일 자동 감지)
- [ ] birdview 실사용 테스트 — 더미 데이터로 전체 UI 검증
- [ ] docs 사이트 Vercel 커스텀 도메인 연결 검토
- [ ] Reddit/X 홍보 게시물 준비

## 그외
- 전체 구조: 9 commits, 21 files, ~7,200 lines
- GitHub: https://github.com/DanialDaeHyunNam/omniscitus
- 소개 사이트: https://omniscitus.vercel.app
