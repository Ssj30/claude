// Parses reviews pasted from a spreadsheet or CSV export (for example the old
// Stellar Reviews export). The first row must be a header row.

export interface ImportedReview {
  handle: string;
  rating: number;
  author: string;
  title: string;
  body: string;
  date: string | null;
}

export interface ImportResult {
  rows: ImportedReview[];
  errors: string[];
}

const ALIASES: Record<keyof ImportedReview, string[]> = {
  handle: ["product_handle", "handle", "product", "product handle"],
  rating: ["rating", "stars", "score"],
  author: ["author", "name", "reviewer", "customer"],
  title: ["title", "headline", "subject"],
  body: ["body", "review", "content", "text", "comment"],
  date: ["date", "created_at", "created"],
};

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseReviewRows(text: string): ImportResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) {
    return { rows: [], errors: ["Paste a header row and at least one review."] };
  }
  const first = lines[0];
  const sep = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const header = splitLine(first, sep).map((h) => h.toLowerCase());
  const col = {} as Record<keyof ImportedReview, number>;
  for (const key of Object.keys(ALIASES) as (keyof ImportedReview)[]) {
    col[key] = header.findIndex((h) => ALIASES[key].includes(h));
  }
  const missing = (["handle", "rating", "body"] as const).filter((k) => col[k] < 0);
  if (missing.length) {
    return {
      rows: [],
      errors: [`Missing column(s): ${missing.join(", ")}. Expected e.g. product_handle, rating, author, title, body, date.`],
    };
  }

  const rows: ImportedReview[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = splitLine(line, sep);
    const get = (k: keyof ImportedReview) => (col[k] >= 0 ? (cells[col[k]] ?? "") : "");
    const rating = Math.round(Number(get("rating").replace(",", ".")));
    const handle = get("handle")
      .replace(/^.*\/products\//, "")
      .replace(/[?#].*$/, "");
    if (!handle) return errors.push(`Row ${i + 2}: no product handle`);
    if (!(rating >= 1 && rating <= 5)) return errors.push(`Row ${i + 2}: rating must be 1 to 5`);
    if (!get("body")) return errors.push(`Row ${i + 2}: review text is empty`);
    const rawDate = get("date");
    const parsed = rawDate ? new Date(rawDate) : null;
    rows.push({
      handle,
      rating,
      author: get("author") || "Customer",
      title: get("title"),
      body: get("body"),
      date: parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    });
  });
  return { rows, errors };
}
