export function dedupeStringValues(items) {
  return Array.from(new Set(
    items
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

export function appendWarningsSection(lines, warnings, heading = '## Warnings') {
  const normalizedWarnings = dedupeStringValues(warnings);
  if (normalizedWarnings.length === 0) {
    return lines;
  }

  if (lines.length > 0 && lines[lines.length - 1] !== '') {
    lines.push('');
  }
  lines.push(heading, '');
  for (const warning of normalizedWarnings) {
    lines.push(`- ${warning}`);
  }
  lines.push('');
  return lines;
}

export function escapeMarkdownTableCell(value) {
  return String(value).replace(/\|/g, '\\|');
}
