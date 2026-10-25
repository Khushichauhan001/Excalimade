// Tabular text (CSV / TSV / semicolon / markdown table) → chart data. Pure and tiny: loaded eagerly
// by the paste handler in register.ts, so keep imports at zero.

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  /** Header of the label column (used as x-axis title), if any. */
  labelHeader?: string;
  labels: string[];
  series: ChartSeries[];
  /** Values were written as percentages. */
  percent: boolean;
  /** Currency symbol the values were written with, if any. */
  currency?: string;
}

const CURRENCY = /[$€£¥₹₩₽₺₫฿₪]|\b(?:USD|EUR|GBP|JPY|INR|CHF|CAD|AUD)\b/i;

/** Parse a numeric spreadsheet cell: thousands separators, %, currency, (negatives), unicode minus. */
export function parseNumber(raw: string): { value: number; percent: boolean; currency?: string } | null {
  let s = raw.trim();
  if (!s) return null;
  let currency: string | undefined;
  const cm = CURRENCY.exec(s);
  if (cm) {
    currency = cm[0];
    s = s.replace(CURRENCY, "").trim();
  }
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[−‒–]/g, "-");
  const percent = s.endsWith("%");
  if (percent) s = s.slice(0, -1).trim();
  s = s.replace(/[\s  ']/g, "");
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.234,5
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ""); // 1,234.5
  else if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(",", "."); // 12,5
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return { value: neg ? -v : v, percent, currency };
}

function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && !cur.trim()) {
      q = true;
      cur = "";
    } else if (ch === delim) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function tryDelimiter(lines: string[], delim: string): string[][] | null {
  let rows = lines.map((l) => {
    let t = l;
    if (delim === "|") t = t.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
    return splitRow(t, delim);
  });
  if (delim === "|") rows = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  // trailing empty cells (spreadsheet exports) don't count
  rows = rows.map((r) => {
    const c = [...r];
    while (c.length > 1 && c[c.length - 1] === "") c.pop();
    return c;
  });
  const n = Math.max(...rows.map((r) => r.length));
  if (n < 2) return null;
  if (rows.some((r) => r.length !== n && r.length !== 1)) return null;
  return rows.filter((r) => r.length === n);
}

/** Detect and parse tabular text. Returns null if the text doesn't look like a chartable table. */
export function parseTable(text: string): ChartData | null {
  if (!text || text.length > 200_000) return null;
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length < 2 || lines.length > 2000) return null;
  if (/^\s*[[{<]/.test(lines[0]) && !/^\s*\|/.test(lines[0])) return null; // JSON / markup

  let rows: string[][] | null = null;
  const delims = text.includes("\t") ? ["\t"] : /^\s*\|.*\|\s*$/.test(lines[0]) ? ["|"] : [",", ";", "|"];
  for (const d of delims) {
    rows = tryDelimiter(lines, d);
    if (rows && rows.length >= 2) break;
    rows = null;
  }
  if (!rows) return null;
  const cols = rows[0].length;

  const parsed = rows.map((r) => r.map(parseNumber));
  const isNumCol = (c: number, from: number) => parsed.slice(from).every((r) => r[c] != null || rows![parsed.indexOf(r)][c] === "");
  // header row: first row has a non-numeric cell in a column that is otherwise numeric
  let header = false;
  for (let c = 0; c < cols; c++) if (parsed[0][c] == null && rows[0][c] !== "" && isNumCol(c, 1) && parsed.slice(1).some((r) => r[c])) header = true;
  if (!header && parsed[0].every((p) => p == null) && rows.length > 2) header = true;
  const start = header ? 1 : 0;
  const data = rows.slice(start);
  const dataNum = parsed.slice(start);
  if (data.length < 2) return null;

  const numericCols: number[] = [];
  for (let c = 0; c < cols; c++) {
    if (dataNum.every((r, i) => r[c] != null || data[i][c] === "") && dataNum.some((r) => r[c] != null)) numericCols.push(c);
  }
  let labelCol = [...Array(cols).keys()].find((c) => !numericCols.includes(c));
  if (labelCol == null) {
    // everything numeric (e.g. years + values): use the first column as labels
    if (cols < 2) return null;
    labelCol = 0;
  }
  const valueCols = numericCols.filter((c) => c !== labelCol);
  if (!valueCols.length) return null;

  let percent = false;
  let currency: string | undefined;
  for (const r of dataNum)
    for (const c of valueCols) {
      if (r[c]?.percent) percent = true;
      if (r[c]?.currency) currency ??= r[c]!.currency;
    }

  return {
    labelHeader: header ? rows[0][labelCol] || undefined : undefined,
    labels: data.map((r) => r[labelCol!]),
    series: valueCols.map((c, i) => ({
      name: header ? rows![0][c] || `Series ${i + 1}` : `Series ${i + 1}`,
      values: dataNum.map((r) => r[c]?.value ?? 0),
    })),
    percent,
    currency,
  };
}
