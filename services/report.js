function escapePdfText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapLines(text, maxChars = 88) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    if (!current.length) {
      current = word;
      return;
    }
    if ((current + ' ' + word).length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current += ' ' + word;
    }
  });

  if (current.length) lines.push(current);
  return lines.length ? lines : [''];
}

function buildReportLines(property, matches = [], tasks = [], notes = []) {
  const lines = [
    `Report immobile: ${property.title}`,
    `Indirizzo: ${property.address}`,
    `Comune: ${property.city} (${property.province})`,
    `Tipologia: ${property.property_type}`,
    `Prezzo richiesto: €${Number(property.asking_price || 0).toLocaleString('it-IT')}`,
    `Superficie: ${Number(property.surface_mq || 0).toLocaleString('it-IT')} mq`,
    `Prezzo/mq: €${Number(property.price_per_mq || 0).toLocaleString('it-IT')}`,
    `Valutazione: ${property.property_score || 0}/100`,
    `Verdetto: ${property.verdict}`,
    `Azioni consigliate: ${property.recommended_action || 'da verificare'}`
  ];

  lines.push('');
  lines.push('Match collegati:');
  if (matches.length === 0) {
    lines.push('- Nessun match attivo');
  } else {
    matches.slice(0, 10).forEach((match) => {
      lines.push(`- ${match.buyer_name || 'Cliente'} | score ${Math.round(match.match_score)} | ${match.verdict}`);
    });
  }

  lines.push('');
  lines.push('Task CRM:');
  if (tasks.length === 0) {
    lines.push('- Nessun task aperto');
  } else {
    tasks.slice(0, 10).forEach((task) => {
      lines.push(`- ${task.status}/${task.approval_status} | ${task.channel} | ${task.next_action}`);
    });
  }

  lines.push('');
  lines.push('Note e fonti:');
  if (notes.length === 0) {
    lines.push('- Nessuna nota registrata');
  } else {
    notes.slice(0, 10).forEach((note) => {
      lines.push(`- ${note.note_text} [fonte: ${note.source_reference}]`);
    });
  }

  return lines;
}

function createSimplePdf(lines, title = 'Report immobile') {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 48;
  const lineHeight = 14;
  const maxLinesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);

  const wrapped = [];
  lines.forEach((line) => {
    wrapLines(line).forEach((part) => wrapped.push(part));
  });

  const pages = [];
  for (let i = 0; i < wrapped.length; i += maxLinesPerPage) {
    pages.push(wrapped.slice(i, i + maxLinesPerPage));
  }
  if (!pages.length) pages.push(['']);

  const objects = [];
  const pageKids = [];
  let objIndex = 1;

  const fontId = objIndex++;
  objects.push(`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);

  const contentIds = [];
  const pageIds = [];

  pages.forEach((pageLines) => {
    const contentId = objIndex++;
    const contentStream = [];
    contentStream.push('BT');
    contentStream.push('/F1 12 Tf');
    contentStream.push(`1 0 0 1 ${margin} ${pageHeight - margin} Tm`);
    contentStream.push('14 TL');
    contentStream.push(`(${escapePdfText(title)}) Tj`);
    contentStream.push('T*');
    contentStream.push('/F1 10 Tf');
    pageLines.forEach((line) => {
      contentStream.push(`(${escapePdfText(line)}) Tj`);
      contentStream.push('T*');
    });
    contentStream.push('ET');
    const contentBody = contentStream.join('\n');
    const content = `${contentId} 0 obj\n<< /Length ${contentBody.length} >>\nstream\n${contentBody}\nendstream\nendobj`;
    objects.push(content);
    contentIds.push(contentId);
  });

  pages.forEach((_, idx) => {
    const pageId = objIndex++;
    const contentId = contentIds[idx];
    const page = `${pageId} 0 obj\n<< /Type /Page /Parent ${objIndex} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj`;
    objects.push(page);
    pageIds.push(pageId);
  });

  const pagesId = objIndex++;
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  objects.push(`${pagesId} 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pageIds.length} >>\nendobj`);

  const catalogId = objIndex++;
  objects.push(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  const xref = [];
  xref.push(`xref`);
  xref.push(`0 ${objects.length + 1}`);
  xref.push(`0000000000 65535 f `);
  for (let i = 1; i < offsets.length; i += 1) {
    xref.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  pdf += `${xref.join('\n')}\n${trailer}`;
  return Buffer.from(pdf, 'utf8');
}

module.exports = {
  buildReportLines,
  createSimplePdf
};
