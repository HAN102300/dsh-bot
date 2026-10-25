/**
 * 最小 YAML 支持
 *
 * 目标：能解析 Routine 这种结构化的、无锚点/无别名的 YAML 子集。
 * 刻意不支持：锚点、别名、多文档、复杂标签、折叠块。
 *
 * 为什么不用 js-yaml：插件应当零运行时依赖，避免给用户增加安装负担。
 * 如果将来需要完整 YAML，可改为可选依赖并在缺失时降级。
 */

/** 解析 YAML 文本为 JS 值 */
export function parseYaml(text: string): unknown {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const ctx: ParseContext = { lines, pos: 0 };
  skipBlank(ctx);
  if (ctx.pos >= lines.length) return undefined;
  const value = parseNode(ctx, 0);
  return value;
}

interface ParseContext {
  lines: string[];
  pos: number;
}

/** 计算一行开头空格数；tab 视为错误 */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  if (line[n] === '\t') {
    throw new Error('YAML 缩进不能包含 Tab，请用空格');
  }
  return n;
}

function isBlank(line: string): boolean {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

function skipBlank(ctx: ParseContext): void {
  while (ctx.pos < ctx.lines.length && isBlank(ctx.lines[ctx.pos])) {
    ctx.pos++;
  }
}

/** 解析一个节点（对象 / 数组 / 标量） */
function parseNode(ctx: ParseContext, parentIndent: number): unknown {
  skipBlank(ctx);
  if (ctx.pos >= ctx.lines.length) return null;

  const line = ctx.lines[ctx.pos];
  const indent = indentOf(line);
  if (indent < parentIndent) return null;

  const trimmed = line.trim();

  // 数组
  if (trimmed === '-' || trimmed.startsWith('- ')) {
    return parseSequence(ctx, indent);
  }

  // 对象
  if (findKeyColon(trimmed) > 0) {
    return parseMapping(ctx, indent);
  }

  // 标量（多行或单行）
  return parseScalar(trimmed);
}

/** 找到 key 后的冒号位置（跳过引号与 URL 中的冒号） */
function findKeyColon(s: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ':' && !inSingle && !inDouble) {
      // 冒号后必须是空格或行尾，才算 key 分隔
      if (i + 1 >= s.length || s[i + 1] === ' ') return i;
    }
  }
  return -1;
}

function parseMapping(ctx: ParseContext, indent: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  while (ctx.pos < ctx.lines.length) {
    skipBlank(ctx);
    if (ctx.pos >= ctx.lines.length) break;

    const line = ctx.lines[ctx.pos];
    const lineIndent = indentOf(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      throw new Error(`YAML 缩进错误（第 ${ctx.pos + 1} 行）`);
    }

    const trimmed = line.trim();
    const colon = findKeyColon(trimmed);
    if (colon <= 0) break;

    const key = unquote(trimmed.slice(0, colon).trim());
    const rest = trimmed.slice(colon + 1).trim();
    ctx.pos++;

    if (rest === '') {
      // 值在下一层（对象或数组）
      skipBlank(ctx);
      if (ctx.pos >= ctx.lines.length) {
        obj[key] = null;
        continue;
      }
      const nextIndent = indentOf(ctx.lines[ctx.pos]);
      const nextTrimmed = ctx.lines[ctx.pos].trim();
      if (nextIndent > indent) {
        obj[key] = parseNode(ctx, nextIndent);
      } else if (nextIndent === indent && (nextTrimmed === '-' || nextTrimmed.startsWith('- '))) {
        // 同缩进的数组（YAML 允许）
        obj[key] = parseSequence(ctx, indent);
      } else {
        obj[key] = null;
      }
    } else if (rest === '|' || rest === '>' || rest.startsWith('|') || rest.startsWith('>')) {
      obj[key] = parseBlockScalar(ctx, indent, rest);
    } else {
      obj[key] = parseScalar(rest);
    }
  }

  return obj;
}

/** 块标量：| 保留换行，> 折叠换行 */
function parseBlockScalar(ctx: ParseContext, parentIndent: number, header: string): string {
  const fold = header.startsWith('>');
  const collected: string[] = [];
  let blockIndent = -1;

  while (ctx.pos < ctx.lines.length) {
    const line = ctx.lines[ctx.pos];
    if (line.trim() === '') {
      collected.push('');
      ctx.pos++;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (blockIndent < 0) blockIndent = ind;
    collected.push(line.slice(Math.min(blockIndent, ind)));
    ctx.pos++;
  }

  // 去掉尾部空行
  while (collected.length && collected[collected.length - 1] === '') collected.pop();

  if (fold) {
    return collected.join(' ').replace(/\s+/g, ' ').trim();
  }
  return collected.join('\n');
}

function parseSequence(ctx: ParseContext, indent: number): unknown[] {
  const arr: unknown[] = [];

  while (ctx.pos < ctx.lines.length) {
    skipBlank(ctx);
    if (ctx.pos >= ctx.lines.length) break;

    const line = ctx.lines[ctx.pos];
    const lineIndent = indentOf(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) break;

    const trimmed = line.trim();
    if (trimmed !== '-' && !trimmed.startsWith('- ')) break;

    const after = trimmed === '-' ? '' : trimmed.slice(2).trim();

    if (after === '') {
      // 子节点在下一行
      ctx.pos++;
      skipBlank(ctx);
      if (ctx.pos < ctx.lines.length && indentOf(ctx.lines[ctx.pos]) > indent) {
        arr.push(parseNode(ctx, indentOf(ctx.lines[ctx.pos])));
      } else {
        arr.push(null);
      }
      continue;
    }

    if (findKeyColon(after) > 0) {
      // 行内映射："- id: x"，后面的键在 deeper indent
      const itemIndent = indent + 2;
      // 临时把当前行改写为缩进后的形式来复用 parseMapping
      const saved = ctx.lines[ctx.pos];
      ctx.lines[ctx.pos] = ' '.repeat(itemIndent) + after;
      const obj = parseMapping(ctx, itemIndent);
      // 若被消费则恢复（parseMapping 已 pos++ 前进，saved 不再需要）
      if (ctx.pos === 0 || ctx.lines[ctx.pos - 1] !== saved) {
        // no-op：保持现状
      }
      arr.push(obj);
      continue;
    }

    arr.push(parseScalar(after));
    ctx.pos++;
  }

  return arr;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();

  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;

  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);

  // 行内数组 [a, b]
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((p) => parseScalar(p));
  }

  // 行内对象 {a: 1}
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    const obj: Record<string, unknown> = {};
    if (!inner) return obj;
    for (const part of splitTopLevel(inner)) {
      const colon = findKeyColon(part);
      if (colon <= 0) continue;
      obj[unquote(part.slice(0, colon).trim())] = parseScalar(part.slice(colon + 1));
    }
    return obj;
  }

  return unquote(s);
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    if (t[0] === '"' && t[t.length - 1] === '"') {
      try {
        return JSON.parse(t);
      } catch {
        return t.slice(1, -1);
      }
    }
    if (t[0] === "'" && t[t.length - 1] === "'") {
      return t.slice(1, -1).replace(/''/g, "'");
    }
  }
  return t;
}

// ============================================================
// 序列化
// ============================================================

/** 把 JS 值序列化为 YAML */
export function stringifyYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (value === null || value === undefined) return 'null';

  if (typeof value === 'string') {
    if (value === '') return "''";
    if (/[\n]/.test(value)) {
      const lines = value.split('\n');
      return '|\n' + lines.map((l) => ' '.repeat(indent + 2) + l).join('\n');
    }
    if (/^[\s\-?:,\[\]{}#&*!|>'"%@`]|:\s|\s#/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((v) => {
        const rendered = stringifyYaml(v, indent + 2);
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          const lines = rendered.split('\n');
          // 首行紧跟 "- "，其余行加缩进
          return `${pad}- ${lines[0].trimStart()}\n${lines
            .slice(1)
            .join('\n')}`.replace(/\n$/, '');
        }
        return `${pad}- ${rendered}`;
      })
      .join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, v]) => {
        const key = /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k);

        // 标量直接跟值
        if (v === null || typeof v !== 'object') {
          return `${pad}${key}: ${stringifyYaml(v, indent + 2)}`;
        }

        // 空容器：用行内形式，避免产生错乱的嵌套缩进
        if (Array.isArray(v) && v.length === 0) {
          return `${pad}${key}: []`;
        }
        if (!Array.isArray(v) && Object.keys(v as object).length === 0) {
          return `${pad}${key}: {}`;
        }

        const nested = stringifyYaml(v, indent + 2);
        return `${pad}${key}:\n${nested}`;
      })
      .join('\n');
  }

  return String(value);
}
