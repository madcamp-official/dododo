# 학교 사이트 Source Recipe

학교마다 다른 HTML 구조는 Collector 코드에 학교별 분기를 추가하지 않고
`dododo.sources.json`의 `schoolSite.recipe`로 표현한다. 기존 `selectors` 설정도 계속
지원하지만, 실제 학교 게시판에는 Recipe 사용을 권장한다.

현재 한양대 컴퓨터소프트웨어학부 취업게시판과 한양대 전체공지는 검증된 내장 Recipe가
있어 Desktop 설정에서 URL만 등록해도 자동 적용된다. 설정 파일에 `recipe`를 직접
지정하면 내장 Recipe보다 우선한다.

`schoolSite`는 배열이라 여러 게시판을 동시에 등록할 수 있다. 항목이 하나뿐이면
`sourceId`를 생략해도 되지만(기본값 `school-site`), 둘 이상이면 각 항목의
`sourceId`가 서로 달라야 한다 — 동기화 상태와 수집한 RawItem이 `sourceId`로
구분되기 때문이다.

```json
{
  "schoolSite": [
    {
      "sourceId": "hanyang-job-board",
      "url": "https://cs.hanyang.ac.kr/board/job_board.php",
      "recipe": {
        "encoding": "euc-kr",
        "list": {
          "item": "table.bbs_con tbody tr:has(td.left a)",
          "title": { "selector": "td.left a" },
          "link": { "selector": "td.left a", "attribute": "href" },
          "externalId": { "strategy": "url-query", "parameter": "idx" },
          "publishedAt": { "selector": "td:nth-child(5)" }
        },
        "detail": {
          "content": { "selector": ".bbs_view .view_content" }
        }
      }
    },
    {
      "sourceId": "hanyang-notice-all",
      "url": "https://www.hanyang.ac.kr/notice_all"
    }
  ]
}
```

Desktop의 "가져오기"로 URL만 등록하면 두 번째 항목부터 `sourceId`를 URL에서 자동으로
만들어 붙인다(직접 JSON을 편집할 때만 위처럼 이름을 명시적으로 정하면 된다).

필드는 CSS 선택자와 선택적인 HTML 속성으로 값을 읽는다. `externalId.strategy`는
`field`, `url-query`, `url-path`, `url-hash`를 지원한다. `url-path`의 `pattern`은 첫
번째 캡처 그룹을 ID로 사용한다. 상세 Recipe가 있으면 목록의 각 상세 페이지에서
본문과 첨부파일을 보강한다. 상세 페이지 하나가 실패해도 다른 항목은 보존되고 해당
URL의 진단만 남는다.

응답 헤더에 charset이 있으면 자동 적용하고, 잘못되거나 없는 서버는 `encoding`으로
재정의할 수 있다. Recipe 사용 시 목록이 0건이면 기본적으로 페이지 구조 변경 오류로
처리한다. 의도적으로 빈 목록을 허용해야 할 때만 `errorOnEmpty: false`를 지정한다.
