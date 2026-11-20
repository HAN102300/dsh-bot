// ============================================================
// 状态上报
// ============================================================

function report(status, detail) {
  try {
    fetch('/_dsh-bot/client-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, detail: detail ?? null, version: BOT_BUILD, at: new Date().toISOString() }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

  /** 把用户可读的节奏转成 cron（只支持本面板提供的三种模式） */
  function buildCadence(mode, hours, time, days, custom) {
    if (mode === 'none') return '';
    if (mode === 'custom') return custom || '';
    const [hhRaw, mmRaw] = String(time || '09:00').split(':');
    const hh = Math.min(23, Math.max(0, Number(hhRaw) || 0));
    const mm = Math.min(59, Math.max(0, Number(mmRaw) || 0));
    if (mode === 'hours') {
      const n = Math.min(24, Math.max(1, Number(hours) || 12));
      if (n >= 24) return `0 0 * * *`;
      return `0 */${n} * * *`;
    }
    if (mode === 'daily') return `${mm} ${hh} * * *`;
    if (mode === 'weekly') {
      const list = (days && days.length ? days : [1]).join(',');
      return `${mm} ${hh} * * ${list}`;
    }
    return '';
  }

  /** 反向解析：把已有 cron 还原成可编辑的 UI 状态 */
  function parseCadence(cron) {
    const raw = String(cron || '').trim();
    if (!raw) return { mode: 'none', hours: 12, time: '09:00', days: [1], custom: '' };
    const parts = raw.split(/\s+/);
    if (parts.length !== 5) return { mode: 'custom', hours: 12, time: '09:00', days: [1], custom: raw };
    const [mi, ho, dom, mon, dow] = parts;
    const num = (s) => /^\d+$/.test(s);
    if (mi === '0' && /^\*\/\d+$/.test(ho) && dom === '*' && mon === '*' && dow === '*') {
      return { mode: 'hours', hours: Number(ho.slice(2)), time: '09:00', days: [1], custom: '' };
    }
    if (num(mi) && num(ho) && dom === '*' && mon === '*' && dow === '*') {
      return { mode: 'daily', hours: 12, time: `${ho.padStart(2, '0')}:${mi.padStart(2, '0')}`, days: [1], custom: '' };
    }
    if (num(mi) && num(ho) && dom === '*' && mon === '*' && /^[0-6](,[0-6])*$/.test(dow)) {
      return { mode: 'weekly', hours: 12, time: `${ho.padStart(2, '0')}:${mi.padStart(2, '0')}`, days: dow.split(',').map(Number), custom: '' };
    }
    return { mode: 'custom', hours: 12, time: '09:00', days: [1], custom: raw };
  }

  /** 人话描述当前节奏 */
  function describeCadence(mode, hours, time, days, custom) {
    if (mode === 'none') return '不自动执行（只手动触发）';
    if (mode === 'custom') return `自定义 cron：${custom || '（空）'}`;
    if (mode === 'hours') {
      const n = Math.min(24, Math.max(1, Number(hours) || 12));
      return n >= 24
        ? '每天 00:00 执行一次'
        : `每 ${n} 小时执行一次（每天 ${Math.floor(24 / n)} 次，整点）`;
    }
    if (mode === 'daily') return `每天 ${time || '09:00'} 执行一次`;
    if (mode === 'weekly') {
      const names = ['日', '一', '二', '三', '四', '五', '六'];
      const list = (days && days.length ? days : [1]).map((d) => `周${names[d]}`).join('、');
      return `每 ${list} 的 ${time || '09:00'} 执行`;
    }
    return '';
  }

report('bundle-executing', 'v2 design-system');

