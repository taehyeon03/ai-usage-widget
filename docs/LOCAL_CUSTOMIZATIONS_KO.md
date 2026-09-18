# 로컬 커스텀 변경 기록

이 문서는 Ubuntu 노트북에 설치한 AI Usage Widget의 사용자 맞춤 변경과 운영 방법을 기록한다.

## 2026-09-18: 창 크기 조절 수정

### 증상

- 테두리가 없는 위젯 창이라 일반 창처럼 변을 잡아 크기를 바꾸기 어려웠다.
- 기존 구현은 오른쪽 아래의 작은 조절 핸들만 제공했다.
- 프런트엔드에 최대 폭/높이 제한이 있어 일정 크기 이상으로 늘릴 수 없었다.

### 원인

- Tauri 창이 `decorations: false`이므로 운영체제의 기본 테두리 조절 영역이 보이지 않는다.
- `startResizeDragging("SouthEast")`를 호출하는 단일 핸들만 있었다.
- `MAX_WINDOW_WIDTH`와 `MAX_WINDOW_HEIGHT`가 저장된 창 크기와 확대 동작을 제한했다.

### 해결

- `src/renderer.ts`에 North, NorthEast, East, SouthEast, South, SouthWest, West, NorthWest의 8개 조절 핸들을 생성했다.
- `src/styles.css`에서 네 변은 8px, 네 모서리는 20px의 투명 조절 영역으로 만들었다.
- `src/main.ts`의 고정 최대 크기 제한을 제거하고 최소 크기만 유지했다.
- Tauri 권한에 `core:window:allow-start-resize-dragging`을 유지했다.

## 2026-09-18: 상단 고정 핀

- 헤더에 핀 버튼을 추가했다.
- 활성화하면 `setAlwaysOnTop(true)`로 다른 창보다 위에 유지한다.
- 다시 누르면 항상 위 설정을 해제한다.
- `always_on_top` 값을 앱 설정 파일에 저장하여 재시작 뒤에도 상태를 복원한다.
- Tauri 권한에 `core:window:allow-set-always-on-top`을 추가했다.

## Codex 다중 계정과 사용량 표시

- `codex-account1`과 `codex-account2`를 서로 다른 `CODEX_HOME`으로 조회한다.
- 각 계정의 Codex CLI에서 `/status`를 실행한 결과만 표시한다.
- 어떤 계정의 `/status`가 주간 한도만 반환하면 앱도 5시간 값을 만들어 내지 않고 5시간 항목을 사용 불가로 표시한다.
- 2026-09-18 확인 당시 계정 2의 CLI는 Plus 계정으로 인식되었지만 주간 한도만 반환했다. 이는 위젯 파싱 오류가 아니라 계정별 서버 응답 차이였다.

## 검증

```bash
npm test
npm run build
npm run tauri:build -- --bundles deb
```

검증 결과:

- Node 테스트 41개 통과
- TypeScript 컴파일 통과
- Vite 프로덕션 빌드 통과
- Ubuntu amd64 `.deb` 생성 성공

## Ubuntu 설치

```bash
sudo dpkg -i "src-tauri/target/release/bundle/deb/AI Usage Widget_0.1.22_amd64.deb"
```

설치 리소스는 `/usr/lib/AI Usage Widget`, 실행 파일은 `/usr/bin/ai-usage-widget`에 배치된다.

## 롤백

수정 전 실행 파일 백업:

```text
/home/kth/Applications/ai-usage-widget.before-resize-fix
```

패키지 단위 롤백이 가장 안전하다. 실행 파일만 복구하면 `/usr/lib/AI Usage Widget`의 백엔드 리소스와 버전이 어긋날 수 있다.

## 라이선스

원 프로젝트는 MIT License다. 사용, 복사, 수정, 병합, 게시, 배포, 재라이선스 및 판매가 허용된다. 단, 원 저작권 고지와 MIT 허가문을 소프트웨어의 모든 복사본 또는 중요한 부분에 유지해야 한다.

포크나 수정본을 보유하고 배포할 수 있지만 원작 코드의 저작권이 자동으로 이전되는 것은 아니다. 원작자의 저작권 고지는 유지하고, 새로 작성한 변경분에는 변경 작성자의 저작권이 별도로 성립할 수 있다.
