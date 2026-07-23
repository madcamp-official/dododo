import assert from "node:assert/strict";
import test from "node:test";

import {
  createSchoolSiteHttpLoader,
  parseSchoolNoticeHtml,
  resolveBuiltInSchoolSiteRecipe,
  SchoolSiteCollector,
  collectSources,
  validateSourceInputConfig,
  type SchoolSiteRecipe,
} from "../packages/collectors/src/index.ts";

test("한양대 게시판 URL은 URL만으로 내장 Recipe를 선택한다", () => {
  const cs = resolveBuiltInSchoolSiteRecipe("https://cs.hanyang.ac.kr/board/job_board.php");
  assert.equal(cs?.encoding, "euc-kr");
  assert.equal(cs?.list.externalId?.strategy, "url-query");

  const notice = resolveBuiltInSchoolSiteRecipe("https://www.hanyang.ac.kr/notice_all?category=1");
  assert.equal(notice?.list.item, ".hyu-list-body-item-col");
  assert.equal(resolveBuiltInSchoolSiteRecipe("https://school.example/notices"), undefined);
});

test("Recipe로 테이블 게시판의 링크 쿼리에서 ID를 추출한다", () => {
  const recipe: SchoolSiteRecipe = {
    list: {
      item: "table.bbs_con tbody tr",
      title: { selector: "td.title a" },
      link: { selector: "td.title a", attribute: "href" },
      externalId: { strategy: "url-query", parameter: "idx" },
      publishedAt: { selector: "td.date" },
      category: { selector: "td.category" },
    },
  };
  const notices = parseSchoolNoticeHtml(`
    <table class="bbs_con"><tbody>
      <tr><td class="category">취업</td><td class="title"><a href="job_view.php?idx=421"> 인턴 모집 </a></td><td class="date">2026-07-22</td></tr>
    </tbody></table>
  `, { baseUrl: "https://cs.hanyang.ac.kr/board/job_board.php", recipe });

  assert.deepEqual(notices, [{
    externalId: "421",
    title: "인턴 모집",
    uri: "https://cs.hanyang.ac.kr/board/job_view.php?idx=421",
    content: "",
    publishedAt: "2026-07-22",
    attachmentUrls: [],
    category: "취업",
  }]);
});

test("Recipe 상세 페이지에서 본문과 첨부파일을 보강하고 중복 ID를 하나로 합친다", async () => {
  const recipe: SchoolSiteRecipe = {
    list: {
      item: ".hyu-list-body-item-col",
      title: { selector: "h4 a" },
      link: { selector: "h4 a", attribute: "href" },
      externalId: { strategy: "url-query", parameter: "entryId" },
      publishedAt: { selector: ".date" },
    },
    detail: {
      content: { selector: ".notice-view-content" },
      attachments: { selector: ".attachments a", attribute: "href" },
    },
  };
  const row = `<div class="hyu-list-body-item-col"><h4><a href="/notice?entryId=113103">장학 안내</a></h4><span class="date">2026.07.22</span></div>`;
  const collector = new SchoolSiteCollector({
    baseUrl: "https://www.hanyang.ac.kr/notice_all",
    recipe,
    loadHtml: async (requestedUrl) => requestedUrl === undefined
      ? row.repeat(2)
      : `<div class="notice-view-content">신청 마감은 7월 31일입니다.</div><div class="attachments"><a href="/files/guide.pdf">안내</a></div>`,
    now: () => new Date("2026-07-22T12:00:00+09:00"),
  });

  const items = await collector.sync();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.content, "신청 마감은 7월 31일입니다.");
  assert.deepEqual(items[0]?.metadata.attachmentUrls, ["https://www.hanyang.ac.kr/files/guide.pdf"]);
});

test("Recipe가 페이지 변경으로 0건을 반환하면 조용히 성공하지 않는다", async () => {
  const collector = new SchoolSiteCollector({
    baseUrl: "https://school.example/notices",
    loadHtml: async () => "<html></html>",
    recipe: {
      list: {
        item: ".rows",
        title: { selector: "a" },
        link: { selector: "a", attribute: "href" },
      },
    },
  });
  await assert.rejects(() => collector.sync(), /Recipe가 공지 항목을 찾지 못했습니다/);
});

test("상세 페이지 하나가 실패해도 목록 항목은 보존하고 진단을 남긴다", async () => {
  const collector = new SchoolSiteCollector({
    baseUrl: "https://school.example/notices",
    recipe: {
      list: {
        item: ".notice",
        title: { selector: "a" },
        link: { selector: "a", attribute: "href" },
        externalId: { strategy: "url-query", parameter: "id" },
      },
      detail: { content: { selector: ".content" } },
    },
    loadHtml: async (requestedUrl) => {
      if (requestedUrl !== undefined) throw new Error("detail timeout");
      return `<div class="notice"><a href="/view?id=1">공지</a></div>`;
    },
  });
  const [result] = await collectSources([collector]);

  assert.equal(result?.collected, 1);
  assert.equal(result?.items[0]?.title, "공지");
  assert.equal(result?.errors.length, 1);
  assert.equal(result?.errors[0]?.sourceUri, "https://school.example/view?id=1");
});

test("상세 페이지는 학교 서버를 보호하는 범위에서 병렬로 수집한다", async () => {
  let active = 0;
  let maximumActive = 0;
  const collector = new SchoolSiteCollector({
    baseUrl: "https://school.example/notices",
    recipe: {
      list: {
        item: ".notice",
        title: { selector: "a" },
        link: { selector: "a", attribute: "href" },
        externalId: { strategy: "url-query", parameter: "id" },
      },
      detail: { content: { selector: ".content" } },
    },
    loadHtml: async (requestedUrl) => {
      if (requestedUrl === undefined) {
        return Array.from({ length: 8 }, (_, index) =>
          `<div class="notice"><a href="/view?id=${index}">공지 ${index}</a></div>`).join("");
      }
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return `<div class="content">상세</div>`;
    },
  });

  const items = await collector.sync();
  assert.equal(items.length, 8);
  assert.equal(maximumActive, 4);
});

test("HTTP Loader는 EUC-KR 응답 charset과 Recipe 재정의를 적용한다", async () => {
  const bytes = Uint8Array.from([0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9]);
  for (const loader of [
    createSchoolSiteHttpLoader({
      url: "https://school.example/notices",
      fetchImplementation: async () => new Response(bytes, {
        headers: { "Content-Type": "text/html; charset=euc-kr" },
      }),
    }),
    createSchoolSiteHttpLoader({
      url: "https://school.example/notices",
      encoding: "euc-kr",
      fetchImplementation: async () => new Response(bytes, {
        headers: { "Content-Type": "text/html" },
      }),
    }),
  ]) assert.equal(await loader(), "가나다");
});

test("잘못된 Recipe 선택자와 ID 정규식을 설정 단계에서 거절한다", () => {
  assert.throws(() => validateSourceInputConfig({ schoolSite: [{
    url: "https://school.example/notices",
    recipe: { list: {
      item: "",
      title: { selector: "a" },
      link: { selector: "a", attribute: "href" },
    } },
  }] }), /recipe\.list\.item/);
  assert.throws(() => validateSourceInputConfig({ schoolSite: [{
    url: "https://school.example/notices",
    recipe: { list: {
      item: ".notice",
      title: { selector: "a" },
      link: { selector: "a", attribute: "href" },
      externalId: { strategy: "url-path", pattern: "[" },
    } },
  }] }), /유효한 정규식/);
});
