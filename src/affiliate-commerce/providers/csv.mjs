export function parseCsv(text, { delimiter = "," } = {}) {
  if (typeof text !== "string" || text.length === 0) return [];
  if (typeof delimiter !== "string" || delimiter.length !== 1) throw new TypeError("delimiter must be one character");

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(trimCr(field));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV_UNTERMINATED_QUOTE");
  if (field.length > 0 || row.length > 0) {
    row.push(trimCr(field));
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((header, index) => normalizeHeader(header, index));
  return rows
    .slice(1)
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function normalizeHeader(value, index) {
  const clean = trimCr(String(value || "")).replace(/^\uFEFF/, "").trim();
  return clean || `column_${index + 1}`;
}

function trimCr(value) {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}
