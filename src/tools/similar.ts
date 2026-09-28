/**
 * tools/similar.ts — 编辑失败回喂：Levenshtein 相近行定位（A1，来自 aider/Roo）
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export type SimilarLine = { line: number; text: string; dist: number };

export function findSimilarLines(content: string, oldString: string, topK = 3): SimilarLine[] {
  if (!content.trim()) return [];
  const needle = oldString.split("\n")[0].trim();
  if (!needle) return [];
  const scored: SimilarLine[] = content.split("\n").map((text, i) => ({
    line: i + 1,
    text: text.trim(),
    dist: levenshtein(text.trim(), needle),
  }));
  scored.sort((x, y) => x.dist - y.dist);
  return scored.slice(0, topK);
}

export function formatNoMatchFeedback(content: string, oldString: string, filePath: string): string {
  const hits = findSimilarLines(content, oldString, 3);
  const lines = [
    `错误：在 ${filePath} 中未找到 old_string。`,
  ];
  if (hits.length > 0) {
    lines.push("文件中与之最接近的行：");
    for (const h of hits) lines.push(`  第 ${h.line} 行（距离 ${h.dist}）：${h.text.slice(0, 120)}`);
    lines.push("请先重新读取该文件确认实际文本，再用精确内容重试 old_string。");
  } else {
    lines.push("请先重新读取该文件，确认目标文本是否存在。");
  }
  return lines.join("\n");
}
