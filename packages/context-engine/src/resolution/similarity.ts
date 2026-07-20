// 새 의존성이나 형태소 분석 없이 짧은 한국어 제목을 비교하기 위한 문자 3-gram
// Jaccard 유사도. 토큰화가 필요 없어 한국어·영어 섞인 제목에도 그대로 적용된다.
export function trigramSimilarity(a: string, b: string): number {
  const gramsA = trigrams(a);
  const gramsB = trigrams(b);

  if (gramsA.size === 0 && gramsB.size === 0) return normalize(a) === normalize(b) ? 1 : 0;

  let intersectionSize = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersectionSize += 1;
  }

  const unionSize = gramsA.size + gramsB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function trigrams(text: string): Set<string> {
  const normalized = normalize(text);
  if (normalized.length < 3) return new Set(normalized.length > 0 ? [normalized] : []);

  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i += 1) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase("ko-KR").replaceAll(/\s+/g, "").trim();
}
