export type SchoolSiteFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface SchoolSiteHttpLoaderOptions {
  url: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  userAgent?: string;
  fetchImplementation?: SchoolSiteFetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = "dododo/0.1 school-site-collector";

export function createSchoolSiteHttpLoader(
  options: SchoolSiteHttpLoaderOptions,
): () => Promise<string> {
  const url = parseHttpUrl(options.url);
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  const maxResponseBytes = positiveInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    "maxResponseBytes",
  );
  const userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return async () => {
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        method: "GET",
        headers: {
          Accept: "text/html, application/xhtml+xml",
          "User-Agent": userAgent,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`학교 사이트 요청에 실패했습니다 (${url.toString()}): ${reason}`);
    }

    if (!response.ok) {
      throw new Error(`학교 사이트가 HTTP ${response.status}로 응답했습니다: ${url.toString()}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!isHtmlContentType(contentType)) {
      throw new Error(`학교 사이트가 HTML이 아닌 응답을 반환했습니다: ${contentType || "unknown"}`);
    }

    const contentLength = parseContentLength(response.headers.get("content-length"));
    if (contentLength !== undefined && contentLength > maxResponseBytes) {
      throw responseTooLarge(maxResponseBytes);
    }

    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > maxResponseBytes) {
      throw responseTooLarge(maxResponseBytes);
    }

    return html;
  };
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`유효하지 않은 학교 사이트 URL입니다: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`학교 사이트 URL은 HTTP 또는 HTTPS여야 합니다: ${value}`);
  }
  return url;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field}는 0보다 큰 정수여야 합니다`);
  }
  return value;
}

function isHtmlContentType(value: string): boolean {
  return value.includes("text/html") || value.includes("application/xhtml+xml");
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function responseTooLarge(maxResponseBytes: number): Error {
  return new Error(`학교 사이트 응답이 허용 크기(${maxResponseBytes} bytes)를 초과했습니다`);
}
