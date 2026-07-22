import type { SchoolSiteRecipe } from "./types.ts";

const HANYANG_CS_JOB_BOARD: SchoolSiteRecipe = {
  encoding: "euc-kr",
  list: {
    item: "table.bbs_con tbody tr:has(td.left a)",
    title: { selector: "td.left a" },
    link: { selector: "td.left a", attribute: "href" },
    externalId: { strategy: "url-query", parameter: "idx" },
    publishedAt: { selector: "td:nth-child(5)" },
  },
  detail: {
    content: { selector: ".bbs_view .view_content" },
  },
};

const HANYANG_NOTICE_BOARD: SchoolSiteRecipe = {
  list: {
    item: ".hyu-list-body-item-col",
    title: { selector: "h4 a" },
    link: { selector: "h4 a", attribute: "href" },
    externalId: {
      strategy: "url-query",
      parameter: "_kr_ac_hanyang_noticeBoard_web_portlet_NoticeBoardPortlet_entryId",
    },
    publishedAt: { selector: ".date" },
  },
};

/** URL만 등록하는 Desktop 흐름에서도 검증된 게시판은 바로 수집할 수 있게 한다. */
export function resolveBuiltInSchoolSiteRecipe(value: string): SchoolSiteRecipe | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "cs.hanyang.ac.kr" && url.pathname === "/board/job_board.php") {
    return HANYANG_CS_JOB_BOARD;
  }
  if ((hostname === "www.hanyang.ac.kr" || hostname === "hanyang.ac.kr")
    && url.pathname === "/notice_all") {
    return HANYANG_NOTICE_BOARD;
  }
  return undefined;
}
