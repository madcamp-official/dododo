# 학교 사이트 Source Recipe

학교마다 다른 HTML 구조는 Collector 코드에 학교별 분기를 추가하지 않고
`dododo.sources.json`의 `schoolSite.recipe`로 표현한다. 기존 `selectors` 설정도 계속
지원하지만, 실제 학교 게시판에는 Recipe 사용을 권장한다.

```json
{
  "schoolSite": {
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
  }
}
```

필드는 CSS 선택자와 선택적인 HTML 속성으로 값을 읽는다. `externalId.strategy`는
`field`, `url-query`, `url-path`, `url-hash`를 지원한다. `url-path`의 `pattern`은 첫
번째 캡처 그룹을 ID로 사용한다. 상세 Recipe가 있으면 목록의 각 상세 페이지에서
본문과 첨부파일을 보강한다. 상세 페이지 하나가 실패해도 다른 항목은 보존되고 해당
URL의 진단만 남는다.

응답 헤더에 charset이 있으면 자동 적용하고, 잘못되거나 없는 서버는 `encoding`으로
재정의할 수 있다. Recipe 사용 시 목록이 0건이면 기본적으로 페이지 구조 변경 오류로
처리한다. 의도적으로 빈 목록을 허용해야 할 때만 `errorOnEmpty: false`를 지정한다.
