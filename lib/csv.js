function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
  };

  const pushRow = () => {
    if (row.length > 0 || cell.length > 0) {
      pushCell();
      rows.push(row);
    }
    row = [];
    cell = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushCell();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      continue;
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows.filter((columns) => columns.some((value) => value !== ''));
}

function rowsToCsv(rows) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  return rows.map((row) => row.map(escape).join(',')).join('\n');
}

module.exports = {
  parseCsv,
  rowsToCsv
};
