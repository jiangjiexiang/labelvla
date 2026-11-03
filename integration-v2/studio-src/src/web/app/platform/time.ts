/** 时间显示工具。
 *
 * 后端容器以 UTC 运行,数据库里存的是不带时区的 UTC 字符串
 * (例如 "2026-11-03T03:35:46",对应北京时间 11:35)。直接丢给
 * new Date() 会被当成浏览器本地时间解析,凭空差出一个时区,
 * 所以统一走这里:没有时区标记的按 UTC 解析,再转成本地时间显示。
 *
 * 例外:纯日期("2026-12-31")按本地自然日处理,不做时区换算,
 * 否则东八区会显示成前一天的 08:00。
 */

const HAS_TIMEZONE = /[zZ]$|[+-]\d{2}:?\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseServerTime(ts?: string | null): Date | null {
  if (!ts) return null;
  if (DATE_ONLY.test(ts)) {
    const [y, m, d] = ts.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(HAS_TIMEZONE.test(ts) ? ts : `${ts}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 2026-11-03 11:35 */
export function fmtTime(ts?: string | null): string {
  const d = parseServerTime(ts);
  if (!d) return ts ? String(ts) : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 2026-11-03 11:35:46 */
export function fmtDateTime(ts?: string | null): string {
  const d = parseServerTime(ts);
  if (!d) return ts ? String(ts) : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 判断是否已过期(带时区纠正)。 */
export function isExpired(ts?: string | null): boolean {
  const d = parseServerTime(ts);
  return !!d && d.getTime() < Date.now();
}