        // ---------- 主面板 + 侧边栏入口（v0.3.7） ----------
        // 侧边栏入口可开关：注册/注销都走 slots 的 disposer，切换立即生效。
        let sidebarDisposer = null;
        const applySidebarEntry = (enabled) => {
          try {
            if (enabled && !sidebarDisposer && ctx?.slots?.inject) {
              sidebarDisposer = ctx.slots.inject('sidebar.panellist', () =>
                ctx.slots.register(
                  {
                    name: 'sidebar.panellist',
                    id: 'dsh-bot',
                    order: 40,
                    label: () => 'dsh-bot',
                  },
                  BotSidebarIcon,
                ),
              );
              report('ok', 'sidebar.panellist registered');
            } else if (!enabled && sidebarDisposer) {
              sidebarDisposer();
              sidebarDisposer = null;
              report('ok', 'sidebar.panellist removed');
            }
          } catch (e) {
            report('sidebar-entry-error', String(e?.message ?? e));
          }
        };
        sidebarController.apply = applySidebarEntry;

        // 主面板：点侧边栏图标后右侧渲染的页面
        try {
          if (ctx?.slots?.inject) {
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: 'dsh-bot' }, BotPanelPage),
            );
            report('ok', 'main panel registered');
          }
        } catch (e) {
          report('main-panel-error', String(e?.message ?? e));
        }

        // 先按默认显示，再按已保存的设置纠正
        applySidebarEntry(true);
        (async () => {
          try {
            const r = await fetch('/_dsh-bot/settings', { headers: { accept: 'application/json' } });
            const j = await r.json();
            const v = j?.value?.effective;
            if (v && v.sidebarEntry === false) applySidebarEntry(false);
          } catch {
            /* 读不到就用默认 */
          }
        })();

        // ---------- 运行完成通知（全局轮询器） ----------
        //
        // 为什么是轮询而不是推送：宿主没有给插件暴露「向会话投递消息」
        // 或系统通知的 API（app.asar 里 Notification 只用于更新提醒，
        // ctx 上没有 notification 服务）。client bundle 活在 GUI 页面里、
        // 面板收起也照常运行，轮询是最稳的通道。
        //
        // 规则（与 settings 对齐）：
        //   · notifySystem=false → 完全静默
        //   · notifyOnlyOnDecision=true → 只在失败/部分成功/需要人拍板时响
        //   · quietHours 免打扰时段内不响
        //   · lastSeenRun 存 localStorage：只对「新完成的运行」响一次
        try {
          const NOTIFY_POLL_MS = 60_000;
          const lastSeenKey = 'dsh-bot:lastSeenRunAt';
          const readLastSeen = () => {
            try {
              return Number(localStorage.getItem(lastSeenKey)) || 0;
            } catch {
              return 0;
            }
          };
          const inQuietHours = (q, now = new Date()) => {
            if (!q || !q.start || !q.end) return false;
            const toMin = (s) => {
              const [h, m] = String(s).split(':').map(Number);
              return (h || 0) * 60 + (m || 0);
            };
            const cur = now.getHours() * 60 + now.getMinutes();
            const start = toMin(q.start);
            const end = toMin(q.end);
            if (start === end) return false;
            if (start < end) return cur >= start && cur < end;
            return cur >= start || cur < end; // 跨午夜
          };

          const fireNotification = (botName, run) => {
            const retried = Array.isArray(run.steps)
              ? run.steps.some((s) => s.name === 'retry')
              : false;
            const title =
              run.status === 'success'
                ? `✅ ${botName}：运行完成${retried ? '（已自动重试）' : ''}`
                : run.status === 'partial'
                  ? `🟡 ${botName}：部分成功`
                  : run.status === 'budget_exceeded'
                    ? `🛑 ${botName}：预算熔断`
                    : `❌ ${botName}：运行失败${retried ? '（重试后仍失败）' : '（下轮定时将自动重试）'}`;
            const cost = run.usage
              ? run.usage.costKind === 'free'
                ? '免费'
                : Number.isFinite(run.usage.costCny)
                  ? `¥${run.usage.costCny.toFixed(4)}`
                  : '费用未知'
              : '—';
            // runId 前 8 位：用户报问题时可对齐具体轮次（v0.3.1 R2）
            const body = `${new Date(run.startedAt).toLocaleTimeString('zh-CN')} · ${cost} · #${String(run.id).slice(0, 8)}` +
              (run.error?.message ? ` · ${String(run.error.message).slice(0, 80)}` : '') +
              (run.outputPreview ? `\n${run.outputPreview.slice(0, 100)}` : '');
            try {
              if (typeof Notification === 'undefined') return;
              if (Notification.permission === 'granted') {
                const n = new Notification(title, { body, tag: run.id, silent: false });
                n.onclick = () => {
                  try { window.focus(); } catch {}
                };
              }
            } catch {
              /* 通知失败不影响主流程 */
            }
          };

          let notifying = false;

          /** 取某个 Bot 的生效设置；失败时回退全局。 */
          const policyOf = async (botId) => {
            try {
              const r = await fetch(
                `/_dsh-bot/settings?botId=${encodeURIComponent(botId)}`,
                { headers: { accept: 'application/json' } },
              );
              const j = await r.json();
              if (j?.ok && j.value?.effective) return j.value.effective;
            } catch {
              /* 回退全局 */
            }
            return null;
          };

          const notifyTick = async () => {
            if (notifying) return;
            notifying = true;
            try {
              const sRes = await fetch('/_dsh-bot/settings', { headers: { accept: 'application/json' } });
              const sJson = await sRes.json();
              const globalSettings = sJson?.ok ? sJson.value?.effective : null;

              const oRes = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
              const oJson = await oRes.json();
              if (!oJson?.ok) return;
              const bots = oJson.value?.bots ?? [];
              if (!bots.length) return;

              const lastSeen = readLastSeen();
              let newest = lastSeen;
              // 每个新完成运行都要看；为控制请求量只拉每 Bot 最近 5 条
              for (const b of bots) {
                // ⭐ 单 Bot 设置要覆盖全局：0.3.5 及之前这里只看全局 settings，
                //    导致「某个 Bot 关闭仅异常打扰」永远不生效（0.3.6 修复）。
                const settings = (await policyOf(b.id)) ?? globalSettings;
                if (!settings?.notifySystem) continue;
                if (inQuietHours(settings.quietHours)) continue;
                const rRes = await fetch(`/_dsh-bot/runs/list?botId=${encodeURIComponent(b.id)}&limit=5`, {
                  headers: { accept: 'application/json' },
                });
                const rJson = await rRes.json();
                if (!rJson?.ok) continue;
                for (const run of rJson.value?.runs ?? []) {
                  const ended = Date.parse(run.endedAt || run.startedAt);
                  if (!Number.isFinite(ended) || ended <= lastSeen) continue;
                  if (ended > newest) newest = ended;
                  const attention =
                    run.status !== 'success' ||
                    (run.goalAssessment?.needsHuman === true);
                  // v0.3.1 体验修正：手动触发（用户点了「执行」在等结果）→ 成功也响；
                  // 只有自动轮（goal/schedule）才按「仅异常时打扰」静默成功。
                  const manualRun = run.trigger === 'manual';
                  if (settings.notifyOnlyOnDecision !== true || attention || manualRun) {
                    fireNotification(b.name, run);
                  }
                }
              }
              if (newest > lastSeen) {
                try { localStorage.setItem(lastSeenKey, String(newest)); } catch {}
              }
            } catch {
              /* 网络失败下轮再试 */
            } finally {
              notifying = false;
            }
          };
          // 首次运行先校准 lastSeen（避免升级后把历史全响一遍），再挂定时
          setTimeout(() => {
            if (readLastSeen() === 0) {
              // 第一次：只记水位不响
              void (async () => {
                try {
                  const oRes = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
                  const oJson = await oRes.json();
                  let newest = Date.now();
                  for (const b of oJson?.value?.bots ?? []) {
                    const rRes = await fetch(`/_dsh-bot/runs/list?botId=${encodeURIComponent(b.id)}&limit=1`, {
                      headers: { accept: 'application/json' },
                    });
                    const rJson = await rRes.json();
                    const ended = Date.parse(rJson?.value?.runs?.[0]?.endedAt || '');
                    if (Number.isFinite(ended) && ended > newest) newest = ended;
                  }
                  try { localStorage.setItem(lastSeenKey, String(newest)); } catch {}
                } catch {}
              })();
            }
            void notifyTick();
            setInterval(() => void notifyTick(), NOTIFY_POLL_MS);
          }, 15_000);
          report('ok', 'notify poller armed');
          // 通知能力自证：没有它，「收不到通知」只能靠猜
          try {
            if (typeof Notification === 'undefined') {
              report('notify-unavailable', 'Notification API 不存在');
            } else {
              report('notify-capability', `permission=${Notification.permission}`);
              if (Notification.permission === 'default') {
                try { void Notification.requestPermission?.(); } catch {}
              }
            }
          } catch {
            /* 能力探测失败不影响轮询 */
          }
        } catch (e) {
          report('notify-poller-error', String(e?.message ?? e));
        }

        report('ok', 'v2 activated, slot=conversation.input.dock');
      } catch (e) {
        report('error', (e?.stack ?? String(e)).slice(0, 900));
      }
    }

    return { name: 'dsh-bot-client', inject, apply };
  },
});

})();





