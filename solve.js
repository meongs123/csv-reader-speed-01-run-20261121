// A fast drop-in for csv-reader 1.0.0 (make.fun's own reference CSV reader).
// Written from scratch for speed: bulk scans (indexOf / slice) instead of
// character-by-character concatenation, while returning exactly the same
// {columns, rows, errors} for every input. No dependencies, pure, no state
// kept between calls.
//
// The reading, as the reference defines it: the text is read once, left to
// right, with commas and double quotes. A U+FEFF at the very start is
// dropped. A record ends at LF or CRLF, and a line left with no characters
// is no record. Outside quotes a CR not followed by LF is dropped
// (stray_cr). A field that opens with a quote runs to the next quote that is
// not doubled, "" inside it one quote and each CRLF or lone CR inside it
// read as LF; what follows its closing quote, up to the next comma or line
// break, is appended as it stands (quote_junk, when the field ends); a quote
// that never closes is a literal character, and the text after it is read
// again as unquoted (unterminated_quote). A quote inside an unquoted field
// is a literal character. Fields stay strings, never trimmed or converted.
// columns is the first record when header is true, else null; rows holds the
// records after it (every record when header is false), each padded with
// empty strings (short_row, with fields: its field count) or cut (long_row,
// with extra: the cut fields) to the first record's width. Each error is
// {code, line, row}, in the order met: line the 1-based line its record
// starts on, counting every LF, CRLF and lone CR inside quotes, and row its
// record's index in rows, null for the header.

// How a field ended: at a comma, at a line break, or at the end of the text.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Errors of a record carry these two.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters starting at pos, appending them to `prefix`
  // (the opening quote for a field that never closed, a quoted field's
  // value for what follows its closing quote). Only the two rare paths use
  // it; the common unquoted field is scanned inline in the loop below.
  // Returns the field and how it ended; `added` counts the characters kept
  // in this scan, which decides quote_junk for the junk-after-quote case.
  // A CR not followed by LF is dropped and reported (stray_cr); a CR that
  // ends a line with the LF after it is the line break, not a stray CR.
  function scanUnquoted(prefix) {
    const comma = text.indexOf(',', pos);
    const lf = text.indexOf('\n', pos);
    let end;
    let ended;
    if (comma !== -1 && (lf === -1 || comma < lf)) {
      end = comma;
      ended = COMMA;
    } else if (lf !== -1) {
      end = lf;
      ended = LINE_BREAK;
    } else {
      end = n;
      ended = END;
    }
    let seg = text.slice(pos, end);
    if (ended === LINE_BREAK) {
      line += 1;
      // A CR right before the LF is the CRLF line break: drop it, it is no
      // stray CR and adds nothing.
      if (seg.charCodeAt(seg.length - 1) === 13) seg = seg.slice(0, -1);
    }
    if (seg.indexOf('\r') !== -1) {
      // Every CR left here is a lone one: one stray_cr each, all dropped.
      const parts = seg.split('\r');
      for (let k = 1; k < parts.length; k++) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      }
      seg = parts.join('');
    }
    pos = end + (ended === END ? 0 : 1);
    return { value: prefix + seg, ended, added: seg.length };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    // The next LF from the record's start: every unquoted field in it ends
    // at the next comma or here. A quoted field that spans lines consumes
    // past it, so it is recomputed when a field starts past it.
    let recEnd = text.indexOf('\n', pos);
    const fields = [];
    let ended;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      if (quoted) {
        // A field that opens with a quote: find its closing quote, the
        // first quote not doubled. "" pairs inside it are escaped quotes.
        const open = pos;
        const openLine = line;
        let close = text.indexOf('"', pos + 1);
        let escaped = false;
        while (close !== -1 && text.charCodeAt(close + 1) === 34) {
          escaped = true;
          close = text.indexOf('"', close + 2);
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const reread = scanUnquoted('"');
          value = reread.value;
          ended = reread.ended;
        } else {
          let content = text.slice(open + 1, close);
          const hasCR = content.indexOf('\r') !== -1;
          const hasLF = content.indexOf('\n') !== -1;
          if (escaped || hasCR || hasLF) {
            // Each CRLF or lone CR or LF inside the quotes is one line,
            // and each is read as LF in the value.
            if (hasCR || hasLF) {
              const breaks = content.match(/\r\n|\r|\n/g);
              if (breaks) line += breaks.length;
            }
            if (escaped) content = content.replaceAll('""', '"');
            if (hasCR) content = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
          }
          const after = close + 1;
          if (after >= n) {
            value = content;
            ended = END;
            pos = n;
          } else {
            const c = text.charCodeAt(after);
            if (c === 44) {
              value = content;
              ended = COMMA;
              pos = after + 1;
            } else if (c === 10) {
              value = content;
              ended = LINE_BREAK;
              pos = after + 1;
              line += 1;
            } else if (c === 13 && text.charCodeAt(after + 1) === 10) {
              value = content;
              ended = LINE_BREAK;
              pos = after + 2;
              line += 1;
            } else {
              // What follows the closing quote is appended as it stands,
              // up to the next comma or line break.
              pos = after;
              const junk = scanUnquoted(content);
              if (junk.added > 0) {
                errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
              value = junk.value;
              ended = junk.ended;
            }
          }
        }
      } else {
        // The common unquoted field, scanned inline: the next comma or
        // the record's LF ends it. A CR right before the LF is the CRLF
        // line break; any other CR in it is a lone one, dropped and
        // reported.
        if (recEnd !== -1 && pos > recEnd) recEnd = text.indexOf('\n', pos);
        const comma = text.indexOf(',', pos);
        let end;
        if (comma !== -1 && (recEnd === -1 || comma < recEnd)) {
          end = comma;
          ended = COMMA;
        } else if (recEnd !== -1) {
          end = recEnd;
          ended = LINE_BREAK;
        } else {
          end = n;
          ended = END;
        }
        let seg = text.slice(pos, end);
        if (ended === LINE_BREAK) {
          line += 1;
          if (seg.charCodeAt(seg.length - 1) === 13) seg = seg.slice(0, -1);
        }
        if (seg.indexOf('\r') !== -1) {
          const parts = seg.split('\r');
          for (let k = 1; k < parts.length; k++) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
          seg = parts.join('');
        }
        pos = end + (ended === END ? 0 : 1);
        value = seg;
      }
      fields.push(value);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
