# Marketplace 구조 변환 + Vercel 배포

## 요약
omniscitus 레포를 Claude Code marketplace 형태로 재구조화하고, docs/ 소개 사이트를 Vercel에 배포. GitHub Pages도 설정했으나 Vercel을 메인으로 사용.

## 배경
전세계 배포가 목표 → 유저가 `claude plugins:marketplace add` 한 줄로 소스 등록 후 설치 가능하게 해야 함. 이를 위해 repo 자체를 marketplace 구조(`plugins/omniscitus/`)로 변환.

## 배운점
- Vercel에 정적 사이트 배포 시 `vercel.json`의 `outputDirectory`로 특정 폴더만 서빙 가능
- GitHub 연결은 실패했지만 CLI 직접 배포는 문제 없음
- marketplace 구조 변환은 git mv로 한 번에 처리 가능 — 히스토리 보존됨

## 후속 작업
- [ ] Vercel Git Integration 연결 (push 시 자동 배포)
- [ ] 커스텀 도메인 검토 (omniscitus.dev 등)
- [ ] GitHub Actions로 CI 추가 (blueprint-tracker.cjs lint/test)

## 그외
없음
