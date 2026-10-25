/**
 * Small fuzzy matcher: every query char must appear in order. Score rewards contiguous runs,
 * word-start hits and early matches. Returns -1 for no match; higher is better.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = target.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct * 2 + (direct === 0 || /\W/.test(t[direct - 1]) ? 200 : 0);
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const idx = t.indexOf(ch, ti);
    if (idx < 0) return -1;
    const wordStart = idx === 0 || /[\s\-_./]/.test(t[idx - 1]);
    run = idx === ti ? run + 1 : 0;
    score += 10 + run * 6 + (wordStart ? 12 : 0) - Math.min(idx - ti, 10);
    ti = idx + 1;
  }
  return score;
}
