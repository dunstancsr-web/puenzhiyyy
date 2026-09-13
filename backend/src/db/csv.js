// ─────────────────────────────────────────────────────────────────────────────
// CSV, hand rolled (TASK-60)
//
// No dependency, because the requirement is small and precise: RFC 4180 quoting,
// which is all Excel, Numbers and Google Sheets actually emit. The two rules
// that matter are that a field containing a comma, quote or newline must be
// quoted, and that a quote inside a quoted field is doubled. Everything else in
// the format is optional whitespace nobody writes.
//
// The reason NOT to split on "," and be done: a supplier called "Supplier ABC,
// Thailand" is one field, and a naive split turns every column after it into
// the wrong column, silently, for every row. A bulk import that quietly writes
// lead_time_days into unit_cost_sgd is worse than one that refuses to run.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const NEEDS_QUOTING = /[",\r\n]/;

function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows are plain objects; `columns` fixes the order and the header. */
function toCsv(columns, rows) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCell(row[c])).join(","));
  // Trailing newline: some editors append one on save and some do not, so
  // emitting it makes a round trip through a text editor a no-op diff.
  return lines.join("\r\n") + "\r\n";
}

/**
 * Parse into an array of objects keyed by the header row.
 *
 * A character-at-a-time scanner rather than a line split, because a quoted
 * field may legally contain newlines, so "lines" are not a thing until after
 * parsing. Throws on an unterminated quote instead of guessing.
 */
function parseCsv(text) {
  // Strip a UTF-8 BOM. Excel on Windows writes one, it is invisible, and it
  // would otherwise become part of the first header name, so a "sku_id" column
  // silently fails to match.
  let src = String(text).replace(/^﻿/, "");

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let started = false; // distinguishes an empty last line from a real empty cell

  const endCell = () => { row.push(cell); cell = ""; started = false; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }  // doubled quote is a literal
        else quoted = false;
      } else cell += ch;
      continue;
    }

    if (ch === '"' && cell === "") { quoted = true; started = true; continue; }
    if (ch === ",") { endCell(); continue; }
    if (ch === "\r") continue;                          // CRLF, handled by the \n
    if (ch === "\n") { endRow(); continue; }
    cell += ch;
    started = true;
  }
  if (quoted) throw new Error("Unterminated quote: a \" was opened and never closed");
  // A file ending in a newline leaves one empty pending row, which is not data.
  if (started || cell !== "" || row.length) endRow();

  if (!rows.length) return { columns: [], rows: [] };

  const columns = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    // A row of nothing but empty cells is blank spacing, not a record.
    if (cells.every((c) => c.trim() === "")) continue;
    const obj = {};
    columns.forEach((c, idx) => { obj[c] = (cells[idx] ?? "").trim(); });
    obj.__line = r + 1; // 1-based line in the file, for error messages
    out.push(obj);
  }
  return { columns, rows: out };
}

module.exports = { toCsv, parseCsv };
