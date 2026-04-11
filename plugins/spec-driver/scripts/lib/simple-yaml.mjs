function stripYamlComment(rawLine) {
  let inSingle = false;
  let inDouble = false;
  let result = '';
  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      result += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      result += char;
      continue;
    }
    if (char === '#' && !inSingle && !inDouble) {
      break;
    }
    result += char;
  }
  return result;
}

function tokenizeYamlLines(content) {
  const lines = [];
  for (const rawLine of content.split('\n')) {
    const withoutComment = stripYamlComment(rawLine);
    if (withoutComment.trim() === '') {
      continue;
    }

    lines.push({
      indent: rawLine.match(/^\s*/)?.[0].length ?? 0,
      text: withoutComment.trim(),
    });
  }
  return lines;
}

function findYamlSeparator(text) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === ':' && !inSingle && !inDouble) {
      return index;
    }
  }
  return -1;
}

function parseYamlScalar(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function parseYamlSequence(lines, state, indent) {
  const result = [];

  while (state.index < lines.length) {
    const line = lines[state.index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent !== indent || !line.text.startsWith('- ')) {
      break;
    }

    state.index += 1;
    const itemText = line.text.slice(2).trim();
    if (itemText.length === 0) {
      const next = lines[state.index];
      if (!next || next.indent <= indent) {
        result.push(null);
        continue;
      }
      result.push(parseYamlBlock(lines, state, next.indent));
      continue;
    }

    const separatorIndex = findYamlSeparator(itemText);
    if (separatorIndex > 0) {
      const key = itemText.slice(0, separatorIndex).trim();
      const rawValue = itemText.slice(separatorIndex + 1).trim();
      const entry = {};
      if (rawValue.length > 0) {
        entry[key] = parseYamlScalar(rawValue);
      } else {
        entry[key] = {};
      }

      const next = lines[state.index];
      if (next && next.indent > indent) {
        const nested = parseYamlBlock(lines, state, next.indent);
        if (isObject(nested)) {
          Object.assign(entry, nested);
        } else if (Array.isArray(nested)) {
          entry[key] = nested;
        }
      }

      result.push(entry);
      continue;
    }

    result.push(parseYamlScalar(itemText));
  }

  return result;
}

function parseYamlMapping(lines, state, indent) {
  const result = {};

  while (state.index < lines.length) {
    const line = lines[state.index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      state.index += 1;
      continue;
    }

    if (line.text.startsWith('- ')) {
      break;
    }

    state.index += 1;
    const separatorIndex = findYamlSeparator(line.text);
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.text.slice(0, separatorIndex).trim();
    const rawValue = line.text.slice(separatorIndex + 1).trim();
    if (rawValue.length > 0) {
      result[key] = parseYamlScalar(rawValue);
      continue;
    }

    const next = lines[state.index];
    if (!next || next.indent <= indent) {
      result[key] = {};
      continue;
    }

    result[key] = parseYamlBlock(lines, state, next.indent);
  }

  return result;
}

function parseYamlBlock(lines, state, indent) {
  if (state.index >= lines.length) {
    return {};
  }

  const current = lines[state.index];
  if (current.text.startsWith('- ')) {
    return parseYamlSequence(lines, state, indent);
  }

  return parseYamlMapping(lines, state, indent);
}

export function parseYamlDocument(content) {
  const lines = tokenizeYamlLines(content);
  if (lines.length === 0) {
    return {};
  }

  const state = { index: 0 };
  const parsed = parseYamlBlock(lines, state, lines[0].indent);
  return isObject(parsed) ? parsed : {};
}

function formatYamlScalar(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(String(value));
}

export function stringifyYaml(value, indent = 0) {
  if (isScalar(value)) {
    return `${' '.repeat(indent)}${formatYamlScalar(value)}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${' '.repeat(indent)}[]`;
    }

    return value
      .map((entry) => {
        if (isScalar(entry)) {
          return `${' '.repeat(indent)}- ${stringifyYaml(entry).trimStart()}`;
        }

        const rendered = stringifyYaml(entry, indent + 2).split('\n');
        return [`${' '.repeat(indent)}- ${rendered[0].trimStart()}`, ...rendered.slice(1)].join('\n');
      })
      .join('\n');
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return `${' '.repeat(indent)}{}`;
  }

  return entries
    .map(([key, entryValue]) => {
      if (isScalar(entryValue)) {
        return `${' '.repeat(indent)}${key}: ${stringifyYaml(entryValue).trimStart()}`;
      }

      return `${' '.repeat(indent)}${key}:\n${stringifyYaml(entryValue, indent + 2)}`;
    })
    .join('\n');
}
