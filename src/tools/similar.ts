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

export type FuzzyHit = { start: number; end: number };

function normalizeLine(s: string): string {
  return s.replace(/\t/g, "  ").trim().replace(/ +/g, " ");
}

/**
 * 模糊定位（精确 indexOf 失败后的回退，思路来自 Aider fuzzy-match）：
 * - L1 行级归一化全等（tab/缩进/行尾空白/连续空格差异）
 * - L2 归一化后编辑距离 ≤1 且行 min 长度 ≥8（单字符拼写漂移）
 * 返回原文字符区间 [start, end)；多窗口候选由调用方判定歧义。
 */
export function fuzzyLocate(content: string, oldString: string): FuzzyHit[] {
  if (!oldString.trim()) return [];
  const oldLines = oldString.split("\n");
  const cLines = content.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const l of cLines) {
    starts.push(off);
    off += l.length + 1;
  }
  const n = oldLines.length;
  const hits: FuzzyHit[] = [];
  for (let i = 0; i + n <= cLines.length; i++) {
    let matched = true;
    for (let j = 0; j < n; j++) {
      const a = normalizeLine(cLines[i + j]);
      const b = normalizeLine(oldLines[j]);
      if (a === b) continue;
      const minLen = Math.min(a.length, b.length);
      if (minLen < 8 || levenshtein(a, b) > 1) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const start = starts[i];
      const end = starts[i + n - 1] + cLines[i + n - 1].length;
      hits.push({ start, end });
    }
  }
  return hits;
}
