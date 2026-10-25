/**
 * 通用只读 HTTP GET 工具
 *
 *   http_get   抓取一个 URL，返回文本正文（自动截断）
 *
 * 设计要点：
 *  - 只读（GET / HEAD），副作用等级登记为 'none'，Bot 策略门默认放行；
 *  - 默认拒绝私网/环回地址（SSRF 防护），可用 allowPrivate 显式放开；
 *  - 响应大小上限 + 超时，避免把 Bot 的上下文撑爆；
 *  - 二进制/非文本类型只返回元信息，不灌正文。
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_BODY_CHARS = 20_000;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 dsh-bot-http_get';

/** 判断主机名是否属于私网/环回/链路本地（SSRF 防护） */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '[::1]' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // 组播/保留
  }
  return false;
}

export function registerHttpTools(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'http_get',
      description:
        '发起只读 HTTP GET 请求并返回响应正文。适合抓取公开 API 的 JSON、网页、状态页数据。' +
        '默认禁止访问私网/环回地址（可用 allowPrivate 放开）；响应超过 20000 字符会截断。',
      parameters: {
        url: {
          type: 'string',
          required: true,
          description: '要抓取的 URL（必须是 http/https）',
        },
        headers: {
          type: 'object',
          description: '可选的额外请求头（键值对）',
          additionalProperties: true,
        },
        timeoutMs: {
          type: 'number',
          description: `超时毫秒数，默认 ${DEFAULT_TIMEOUT_MS}，上限 ${MAX_TIMEOUT_MS}`,
        },
        allowPrivate: {
          type: 'boolean',
          description: '是否允许访问私网/环回地址（如本机服务），默认 false',
        },
        pick: {
          type: 'string',
          description:
            '可选：对 JSON 响应做路径提取，只返回所需片段（大响应强烈建议用）。' +
            '多条路径用 "|" 分隔。单条：<顶层字段>[*]<剩余路径> 遍历容器；[-1] 取数组末元素；.field 取字段。' +
            '例："heartbeatList[*][-1]|uptimeList" 取每监控最新心跳+全部可用率。使用 pick 时不截断。',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args: {
        url: string;
        headers?: Record<string, string>;
        timeoutMs?: number;
        allowPrivate?: boolean;
        pick?: string;
      }) {
        const url = String(args?.url ?? '').trim();
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return `错误：URL 无法解析：${url}`;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return `错误：只支持 http/https 协议，收到 ${parsed.protocol}`;
        }
        if (!args?.allowPrivate && isPrivateHost(parsed.hostname)) {
          return `错误：${parsed.hostname} 是私网/环回地址，默认禁止访问（防 SSRF）。如确需访问本机服务，请传 allowPrivate: true。`;
        }

        const timeoutMs = Math.min(Math.max(Number(args?.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);
        const headers: Record<string, string> = {
          'User-Agent': UA,
          Accept: '*/*',
          ...(args?.headers && typeof args.headers === 'object' ? args.headers : {}),
        };

        try {
          const res = await fetch(parsed, {
            method: 'GET',
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
          });

          const meta = [
            `HTTP ${res.status} ${res.statusText || ''}`.trim(),
            `content-type: ${res.headers.get('content-type') ?? '未知'}`,
            `最终 URL: ${res.url}`,
          ].join('\n');

          const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
          const isText =
            /text\/|json|xml|javascript|csv|x-www-form-urlencoded/.test(ctype) || ctype === '';

          if (!isText) {
            const sizeHeader = res.headers.get('content-length');
            return `${meta}\n\n（二进制内容，不返回正文${sizeHeader ? `，大小约 ${sizeHeader} 字节` : ''}）`;
          }

          const text = await res.text();

          // pick：对 JSON 响应做路径提取，只回传所需片段。
          // 语法：多条路径用 "|" 分隔；单条路径内：
          //   key[*]...    遍历顶层 key 的值（对象键或数组）每个元素
          //   [-1]/[0]     数组索引（-1 为末元素）
          //   .key / key   对象字段
          // 示例：
          //   heartbeatList[*][-1]           每监控最新心跳
          //   heartbeatList[*][-1]|uptimeList 每监控最新心跳 + 全部可用率
          if (args?.pick) {
            let data: any;
            try {
              data = JSON.parse(text);
            } catch {
              return `${meta}\n\n错误：pick 需要 JSON 响应，但正文无法解析为 JSON（前 120 字符：${text.slice(0, 120)}）`;
            }
            const paths = String(args.pick).split('|').map((s) => s.trim()).filter(Boolean);
            const out: Record<string, unknown> = {};
            for (const pickPath of paths) {
              // 容器遍历形如 <顶层字段>[*]<rest>
              const m = pickPath.match(/^(\w+)\[\*\](.*)$/);
              if (m) {
                const container = data[m[1]];
                const rest = m[2];
                const mapped: Record<string, unknown> = {};
                for (const [key, entry] of Object.entries(container ?? {})) {
                  mapped[key] = resolvePickPath(entry, rest);
                }
                out[m[1]] = mapped;
              } else {
                out[pickPath] = resolvePickPath(data, pickPath);
              }
            }
            return `${meta}\n\n${JSON.stringify(out, null, 2)}`;
          }

          const truncated = text.length > MAX_BODY_CHARS;
          const body = truncated ? `${text.slice(0, MAX_BODY_CHARS)}\n…[已截断，全文 ${text.length} 字符]` : text;
          return `${meta}\n\n${body}`;
        } catch (e: any) {
          const reason = e?.cause?.code ?? e?.name ?? '';
          return `请求失败：${e?.message ?? e}${reason ? `（${reason}）` : ''}`;
        }
      },
    }),
  );
}

/** 解析 pick 路径的剩余段（[-1] / [*] / .key），对单个值求值 */
function resolvePickPath(value: any, rest: string): unknown {
  let cur = value;
  let remaining = rest;
  while (remaining.length > 0) {
    if (cur === null || cur === undefined) return null;
    if (remaining.startsWith('[*]')) {
      const source = Array.isArray(cur) ? cur : Object.values(cur ?? {});
      const next = remaining.slice(3);
      return source.map((item: any) => resolvePickPath(item, next));
    }
    const bracket = remaining.match(/^\[(-?\d+)\]/);
    if (bracket) {
      const i = Number(bracket[1]);
      cur = Array.isArray(cur) ? cur.at(i) : null;
      remaining = remaining.slice(bracket[0].length);
      continue;
    }
    const key = remaining.match(/^\.?(\w+)/);
    if (key) {
      cur = cur?.[key[1]];
      remaining = remaining.slice(key[0].length);
      continue;
    }
    return null; // 无法解析的段
  }
  return cur;
}
