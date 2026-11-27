        // ============================================================
        // v0.3.8 控制台
        //
        // 设计稿：docs/mock/v038-main.html / v038-detail.html
        // 约定：
        //   · 主视图 = 概览（状态 / 目标 / 运行 / 记忆）
        //   · 详情页 = 独立视图，左列表固定 + 右详情独立滚动
        //   · 所有颜色走宿主设计令牌；正文 13px，最小 11px
        // ============================================================

        const CONSOLE_TABS = [
          ['bots', 'Bot'],
          ['runs', '运行记录'],
          ['settings', '设置'],
          ['doctor', '诊断'],
        ];

        const cpost = async (path, body) => {
          try {
            const r = await fetch('/_dsh-bot' + path, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body ?? {}),
            });
            return await r.json();
          } catch (e) {
            return { ok: false, message: String(e?.message || e) };
          }
        };

        const cget = async (path) => {
          const r = await fetch('/_dsh-bot' + path, {
            headers: { accept: 'application/json' },
          });
          return r.json();
        };

        /** 人话版 cron（复用 0.3.7 的纯函数） */
        const cCadenceText = (cron) => {
          if (!cron) return '不自动执行';
          const p = parseCadence(cron);
          return describeCadence(p.mode, p.hours, p.time, p.days, p.custom);
        };

        /** 金额：<1 元保留 4 位（¥0.0136），否则 2 位 */
        const cMoney = (n) =>
          Number.isFinite(n) ? (n < 1 ? '¥' + n.toFixed(4) : '¥' + n.toFixed(2)) : '¥0';

        /** 紧凑时间：今天 00:00 / 11-13 00:00 */
        const cWhen = (iso) => {
          if (!iso) return '—';
          const d = new Date(iso);
          if (!Number.isFinite(d.getTime())) return '—';
          const now = new Date();
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          const sameDay =
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate();
          if (sameDay) return '今天 ' + hh + ':' + mm;
          return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + hh + ':' + mm;
        };

        const cTriggerText = (t) =>
          t === 'goal' ? '目标轮' : t === 'schedule' ? '定时' : t === 'manual' ? '手动' : t || '—';

        /** Bot 列表行的状态点 / 徽标 */
        const cBotBadge = (b) => {
          if (b?.blocked) return { dot: 'err', tone: 'err', text: '卡住了' };
          if (b?.pendingConfirmCount > 0) return { dot: 'warn', tone: 'warn', text: '待确认' };
          if (b?.lastRunStatus === 'failed' || b?.lastRunStatus === 'budget_exceeded')
            return { dot: 'err', tone: 'err', text: statusText(b.lastRunStatus) };
          if (b?.lastRunStatus === 'success') return { dot: 'ok', tone: 'ok', text: '正常' };
          if (b?.lastRunStatus === 'partial') return { dot: 'warn', tone: 'warn', text: '部分完成' };
          return { dot: 'idle', tone: 'muted', text: '空闲' };
        };

        /**
         * 统一的 Bot 动作层（HTTP）。
         *
         * 和旧 dock 里的 act() 分开：这里只负责「动作 → 结果」，
         * 不持有 UI 状态，便于两个入口共用同一套语义。
         */
        async function runBotAction(kind, bot, extra) {
          let j;
          if (kind === 'dry') {
            j = await cpost('/dry-run', { botId: bot.id });
            if (j?.ok) {
              const st = j.value?.status;
              const blocked = (j.value?.steps || []).filter((s) => s.blocked).length;
              if (st === 'failed') {
                return { error: '演习失败：' + (j.value?.error?.message ?? '未知原因') };
              }
              return { notice: '先看看完成：' + blocked + ' 步会被拦截，未产生真实影响' };
            }
          } else if (kind === 'run') {
            j = await cpost('/run', { botId: bot.id, confirm: true });
            if (j?.ok) {
              const st = j.value?.status;
              const errMsg = j.value?.error?.message;
              if (st === 'failed' || st === 'budget_exceeded') {
                return { error: '执行失败（' + st + '）' + (errMsg ? '：' + errMsg : '') };
              }
              if (st === 'partial') {
                const blocked = (j.value?.steps || []).filter((s) => s.blocked).length;
                return { notice: '执行部分完成' + (blocked ? '，' + blocked + ' 步被跳过' : '') };
              }
              return { notice: '执行完成', value: j.value };
            }
            if (j?.code === 'PRECHECK_FAILED') return { error: j.message };
          } else if (kind === 'snapshot') {
            j = await cpost('/snapshot', { botId: bot.id });
            if (j?.ok) return { notice: '已创建快照（' + j.value.fileCount + ' 个文件）' };
          } else if (kind === 'rollback') {
            j = await cpost('/rollback', { botId: bot.id, confirm: true, snapshotId: extra?.snapshotId });
            if (j?.ok) {
              return {
                notice: '已回滚：恢复 ' + j.value.restored.length + ' 个，删除 ' + j.value.removed.length + ' 个',
              };
            }
          } else if (kind === 'goalConfirm') {
            j = await cpost('/goal/confirm', { botId: bot.id, confirm: true, note: extra?.note });
            if (j?.ok) return { notice: '已确认达成并归档，下面看看建议的下一步' };
          } else if (kind === 'goalReject') {
            j = await cpost('/goal/reject', { botId: bot.id, note: extra?.note ?? '还没做完' });
            if (j?.ok) return { notice: '已驳回，目标回到进行中' };
          } else if (kind === 'goalUnblock') {
            j = await cpost('/goal/unblock', { botId: bot.id, note: extra?.note });
            if (j?.ok) return { notice: '已解除阻塞，目标回到进行中' };
          } else if (kind === 'goalGiveup') {
            j = await cpost('/goal/giveup', { botId: bot.id, note: extra?.note });
            if (j?.ok) return { notice: '已放弃并归档' };
          } else if (kind === 'goalAccept') {
            j = await cpost('/goal/accept', { botId: bot.id, goalId: extra?.goalId ?? bot.goalId });
            if (j?.ok) return { notice: '已接受，Bot 开始守护新目标' };
          } else if (kind === 'goalDismiss') {
            j = await cpost('/goal/dismiss', { botId: bot.id });
            if (j?.ok) return { notice: '已忽略建议' };
          } else if (kind === 'goalSet') {
            j = await cpost('/goal/set', {
              botId: bot.id,
              description: extra?.description,
              goalType: extra?.goalType,
              cadence: extra?.cadence,
            });
            if (j?.ok) return { notice: '目标已设定' };
          } else if (kind === 'botCreate') {
            j = await cpost('/bot/create', {
              name: extra?.name,
              role: extra?.role,
              goal: extra?.goal,
              goalType: extra?.goalType,
              cadence: extra?.cadence,
            });
            if (j?.ok) return { notice: '已创建「' + extra?.name + '」', value: j.value };
          } else if (kind === 'botModel') {
            j = await cpost('/bot/model', {
              botId: bot.id,
              provider: extra?.provider,
              model: extra?.model,
              reasoningEffort: extra?.reasoningEffort,
            });
            if (j?.ok) return { notice: '模型已更新' };
          } else if (kind === 'clearRuns') {
            j = await cpost('/runs/clear', { botId: bot.id, confirm: true });
            if (j?.ok) return { notice: '已清空 ' + j.value.removed + ' 条运行记录' };
          } else if (kind === 'botDelete') {
            j = await cpost('/bot/delete', { botId: bot.id, confirm: true });
            if (j?.ok) return { notice: '已删除「' + bot.name + '」', deleted: true };
          } else if (kind === 'botUpdate') {
            j = await cpost('/bot/update', { botId: bot.id, ...extra });
            if (j?.ok) return { notice: '已保存', value: j.value };
          }
          if (j && !j.ok) return { error: j.message || '操作失败' };
          return {};
        }

        // ---------- 基础组件 ----------
        function CBtn({ children, kind, size, icon, onClick, disabled, title, style }) {
          const cls = [NS + '-c-btn', kind || '', size || ''].filter(Boolean).join(' ');
          return h(
            'button',
            { type: 'button', className: cls, onClick, disabled, title, style },
            icon || null,
            children || null,
          );
        }

        function CCard({ children, className, style }) {
          return h(
            'div',
            { className: NS + '-c-card' + (className ? ' ' + className : ''), style },
            children,
          );
        }

        function CCardHead({ title, count, right, children }) {
          return h(
            'div',
            { className: NS + '-c-card-head' },
            h('span', { className: NS + '-c-card-title' }, title),
            count != null ? h('span', { className: NS + '-c-card-count num' }, count) : null,
            children || null,
            right ? h('span', { className: NS + '-c-card-right' }, right) : null,
          );
        }

        function CPill({ tone, children }) {
          return h('span', { className: NS + '-c-pill ' + (tone || '') }, children);
        }

        function CLink({ children, onClick, style }) {
          return h('button', { type: 'button', className: NS + '-c-link', onClick, style }, children);
        }

        function CTabs({ tab, onTab, meta }) {
          return h(
            'div',
            { className: NS + '-c-tabs' },
            ...CONSOLE_TABS.map(([id, label]) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  className: NS + '-c-tab' + (tab === id ? ' on' : ''),
                  onClick: () => onTab(id),
                },
                label,
              ),
            ),
            h('span', { className: 'grow' }),
            meta ? h('span', { className: 'meta num' }, meta) : null,
          );
        }

        function CStat({ k, v, unit, hint }) {
          return h(
            'div',
            { className: NS + '-c-stat' },
            h('div', { className: 'k' }, k),
            h('div', { className: 'v num' }, v, unit ? h('small', null, unit) : null),
            hint ? h('div', { className: 'h' }, hint) : null,
          );
        }

        // ---------- 列表 ----------
        function BotRow({ bot, selected, onClick }) {
          const bg = cBotBadge(bot);
          return h(
            'button',
            {
              type: 'button',
              className: NS + '-c-row' + (selected ? ' on' : ''),
              onClick,
            },
            h(
              'div',
              { className: 'l1' },
              h('span', { className: NS + '-c-dot ' + bg.dot }),
              h('span', { className: 'nm' }, bot.name),
              h('span', { className: 'bdg' }, h(CPill, { tone: bg.tone }, bg.text)),
            ),
            h('div', { className: 'rl' }, bot.role),
            bot.goalDescription
              ? h('div', { className: 'gl' }, '守：', h('b', null, bot.goalDescription))
              : h('div', { className: 'gl' }, '还没有目标 — 点「设目标」让他知道该守什么'),
            h(
              'div',
              { className: 'mt num' },
              bot.runCount + ' 次运行 · 上次 ' + fmtAgo(bot.lastRunAt) +
                (bot.todayCostCny ? ' · ' + cMoney(bot.todayCostCny) : ''),
            ),
          );
        }

        function BotRail({ bots, selectedId, onSelect, onCreate, fill }) {
          return h(
            'aside',
            { className: NS + '-c-card ' + NS + '-c-rail' + (fill ? ' fill' : '') },
            h(
              'div',
              { className: NS + '-c-rail-head' },
              h('span', { className: 't' }, 'Bot'),
              h('span', { className: 'n num' }, String(bots.length)),
              h(
                'span',
                { className: 'r' },
                h(CBtn, {
                  kind: 'ghost',
                  size: 'icon',
                  icon: h(
                    'svg',
                    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
                    h('path', {
                      d: 'M12 5v14M5 12h14',
                      stroke: 'currentColor',
                      strokeWidth: 1.7,
                      strokeLinecap: 'round',
                    }),
                  ),
                  onClick: onCreate,
                  title: '新建 Bot',
                }),
              ),
            ),
            h(
              'div',
              { className: NS + '-c-rail-rows' + (fill ? ' fill' : '') },
              bots.length === 0
                ? h(
                    'div',
                    { className: NS + '-c-empty', style: { margin: '4px 4px 8px' } },
                    h('p', null, '还没有 Bot。创建一个，他会带着目标、记忆和工作区常驻。'),
                    h(CBtn, { size: 'sm', onClick: onCreate }, '新建 Bot'),
                  )
                : bots.map((b) =>
                    h(BotRow, {
                      key: b.id,
                      bot: b,
                      selected: b.id === selectedId,
                      onClick: () => onSelect(b.id),
                    }),
                  ),
            ),
            h(
              'div',
              { className: NS + '-c-rail-foot' },
              h(CLink, { onClick: onCreate }, '＋ 新建 Bot'),
              h(
                'span',
                { className: NS + '-c-card-count' },
                bots.reduce((n, b) => n + (b.pendingConfirmCount || 0) + (b.blocked ? 1 : 0), 0) + ' 个待处理',
              ),
            ),
          );
        }

        // ---------- 状态摘要 ----------
        function BotSituation({ bot, detail, act, busy, onForm }) {
          if (!detail) {
            return h(
              'div',
              { className: NS + '-c-sit', style: { marginBottom: 12 } },
              h('span', { className: NS + '-c-dot idle', style: { width: 8, height: 8 } }),
              h('div', { className: 'tx' }, h('b', null, '正在读取这个 Bot…')),
            );
          }
          const goal = detail?.goal;
          const runs = detail?.runs ?? [];
          const last = runs[0];
          const proposals = detail?.proposals ?? [];

          const box = (tone, title, sub, actions) =>
            h(
              'div',
              { className: NS + '-c-sit ' + (tone || ''), style: { marginBottom: 12 } },
              h('span', {
                className:
                  NS + '-c-dot ' +
                  (tone === 'err' ? 'err' : tone === 'warn' || tone === 'brand' ? 'warn' : 'ok'),
                style: { width: 8, height: 8 },
              }),
              h(
                'div',
                { className: 'tx' },
                h('b', null, title),
                sub ? h('span', null, sub) : null,
              ),
              actions
                ? h('div', { style: { display: 'flex', gap: 6, flexShrink: 0 } }, ...actions)
                : null,
            );

          if (proposals.length > 0) {
            return box(
              'brand',
              '他建议了 ' + proposals.length + ' 个下一步',
              proposals[0]?.description ?? '接受后他会开始守护新目标',
              [
                h(CBtn, {
                  key: 'a',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => act('goalAccept', bot, { goalId: proposals[0]?.id }),
                }, '接受'),
                h(CBtn, {
                  key: 'd',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => act('goalDismiss', bot),
                }, '忽略'),
              ],
            );
          }
          if (goal?.status === 'pending_confirmation') {
            return box(
              'warn',
              '上一轮认为目标达成了，等你确认',
              goal.progress || goal.description,
              [
                h(CBtn, {
                  key: 'c',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => act('goalConfirm', bot),
                }, '确认达成'),
                h(CBtn, {
                  key: 'r',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => act('goalReject', bot),
                }, '驳回'),
              ],
            );
          }
          if (goal?.status === 'blocked') {
            return box(
              'err',
              '他卡住了',
              goal.progress || '处理完外部条件后，点「已处理好」继续',
              [
                h(CBtn, {
                  key: 'u',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => act('goalUnblock', bot),
                }, '已处理好'),
                h(CBtn, {
                  key: 'g',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => onForm({ kind: 'giveup', botId: bot.id, botName: bot.name }),
                }, '放弃'),
              ],
            );
          }
          if (last?.status === 'failed' || last?.status === 'budget_exceeded') {
            return box(
              'err',
              last.status === 'budget_exceeded' ? '预算用完了' : '上次执行失败了',
              last.error?.message ?? '没有记录到原因',
              [
                h(CBtn, {
                  key: 'd',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => act('dry', bot),
                }, '先看看'),
                h(CBtn, {
                  key: 'r',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => act('run', bot),
                }, '重跑'),
              ],
            );
          }
          if (!goal) {
            return box(
              'warn',
              '他还没有目标，不知道该守什么',
              '可以手动执行，但不会被自动推进',
              [
                h(CBtn, {
                  key: 's',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => onForm({ kind: 'goal', botId: bot.id, botName: bot.name }),
                }, '设目标'),
              ],
            );
          }
          if (goal.status === 'achieved' || goal.status === 'abandoned') {
            return box(
              'ok',
              goal.status === 'achieved' ? '目标已达成' : '目标已放弃',
              goal.progress || '可以在下面「目标」里设一个新的',
              null,
            );
          }
          return box(
            'ok',
            last ? '一切都好：上一轮' + statusText(last.status) + '，用了 ' + fmtCost(last.usage) : '还没有运行过',
            last
              ? '上次 ' + cWhen(last.startedAt) + ' · 周期 ' + cCadenceText(goal.cadence)
              : '点「执行」跑一次，或者等自动周期',
            null,
          );
        }

        // ---------- 目标卡 ----------
        function BotGoalCard({ detail, busy, onForm, bot }) {
          if (!detail) {
            return h(
              CCard,
              null,
              h(CCardHead, { title: '目标' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取…')),
              ),
            );
          }
          const goal = detail?.goal;
          if (!goal) {
            return h(
              CCard,
              null,
              h(CCardHead, { title: '目标' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(
                  'div',
                  { className: NS + '-c-empty' },
                  h('p', null, '还没有目标。目标是 Bot 的「守则」：写清要盯什么、多久看一次。'),
                  h(CBtn, {
                    size: 'sm',
                    kind: 'primary',
                    disabled: busy,
                    onClick: () => onForm({ kind: 'goal', botId: bot.id, botName: bot.name }),
                  }, '设目标'),
                ),
              ),
            );
          }
          const tone =
            goal.status === 'pending_confirmation' ? 'warn' :
            goal.status === 'blocked' ? 'err' :
            goal.status === 'achieved' ? 'ok' :
            goal.status === 'abandoned' ? 'muted' : 'brand';
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '目标',
              right: h(CLink, {
                onClick: () => onForm({ kind: 'goal', botId: bot.id, botName: bot.name }),
              }, '调整'),
            }),
            h(
              'div',
              { className: NS + '-c-card-body' },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
                h(CPill, { tone }, goalStatusText(goal.status)),
                goal.type === 'standing' ? h(CPill, { tone: 'muted' }, '常驻') : null,
              ),
              h('div', { className: NS + '-c-goal' }, goal.description),
              goal.progress
                ? h('div', { style: { marginTop: 8, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' } }, goal.progress)
                : null,
              h(
                'div',
                { className: NS + '-c-chips' },
                h('span', { className: NS + '-c-chip' }, '执行周期 ', h('b', null, cCadenceText(goal.cadence))),
                goal.lastFiredAt ? h('span', { className: NS + '-c-chip' }, '上次自动 ', h('b', null, fmtAgo(goal.lastFiredAt))) : null,
              ),
            ),
          );
        }

        // ---------- 运行卡 ----------
        function BotRunsCard({ runs, preview, onAll, onOpen, botName }) {
          const [page, setPage] = React.useState(0);
          const pageSize = 5;
          const total = runs.length;
          const pages = Math.max(1, Math.ceil(total / pageSize));
          const safePage = Math.min(page, pages - 1);
          const view = preview
            ? runs.slice(0, 4)
            : runs.slice(safePage * pageSize, safePage * pageSize + pageSize);
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '最近运行',
              count: '共 ' + total + ' 条',
              right: preview
                ? h(CLink, { onClick: onAll }, '全部 →')
                : h(CBtn, { size: 'sm', onClick: onAll }, '全部'),
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              total === 0
                ? h(
                    'div',
                    { className: NS + '-c-empty' },
                    h('p', null, '还没有运行记录。点右上角「执行」跑一次。'),
                  )
                : [
                    ...view.map((r) =>
                      h(
                        'div',
                        {
                          key: r.id,
                          className: NS + '-c-run',
                          style: { cursor: onOpen ? 'pointer' : 'default' },
                          onClick: onOpen ? () => onOpen(botName ? { ...r, botName } : r) : undefined,
                        },
                        h('span', {
                          className:
                            NS + '-c-dot ' +
                            (r.status === 'success' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'),
                        }),
                        h('span', { className: 'st' + (r.status === 'success' ? '' : ' err') }, statusText(r.status)),
                        h('span', { className: 'wh num' }, cWhen(r.startedAt) + ' · ' + cTriggerText(r.trigger)),
                        h('span', { className: 'cs num' }, fmtCost(r.usage)),
                        h('span', { className: 'id' }, '#' + String(r.id).slice(0, 12)),
                        h('span', { className: 'cv' }, h(IconChevron, { size: 12 })),
                      ),
                    ),
                    !preview && total > pageSize
                      ? h(
                          'div',
                          {
                            key: 'pager',
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginTop: 8,
                              paddingTop: 10,
                              borderTop: '1px solid var(--dsw-alias-border-l1)',
                            },
                          },
                          h('span', { className: NS + '-c-card-count num' }, '第 ' + (safePage + 1) + ' / ' + pages + ' 页'),
                          h(
                            'div',
                            { style: { display: 'flex', gap: 6 } },
                            h(CBtn, { size: 'sm', disabled: safePage === 0, onClick: () => setPage(safePage - 1) }, '上一页'),
                            h(CBtn, { size: 'sm', disabled: safePage >= pages - 1, onClick: () => setPage(safePage + 1) }, '下一页'),
                          ),
                        )
                      : null,
                  ],
            ),
          );
        }

        // ---------- 记忆卡 ----------
        // ---------- 记忆（v0.3.11：限高滚动 + 时间栏 + 全量弹窗） ----------
        //
        // 旧实现是「无上限平铺」：21 条就把卡片撑到 1100px，把下面的配置/快照卡挤走。
        // 现在的结构：
        //   · 卡片高度恒定（约 5 条），内部滚动，底部渐隐提示「还有」
        //   · 每行左侧固定时间栏（等宽数字），日期与时刻分两段着色 → 纵向严格对齐
        //   · 「查看全部」打开弹窗：搜索实时高亮 + 事实/偏好筛选
        //
        // 时间从正文前缀解析：semantic.facts 是 string[]，时间戳由模型写在开头
        //（形如 "[11-26 16:00] …"），当前数据 100% 命中，零迁移成本。

        /** 把 "[MM-DD HH:mm] 正文" 拆成 { day, time, body, kind } */
        function parseMemoryEntry(text, kind) {
          const raw = String(text ?? '').trim();
          const m = raw.match(/^\[(\d{2}-\d{2}) (\d{2}:\d{2})\]\s*/);
          if (m) return { day: m[1], time: m[2], body: raw.slice(m[0].length), kind };
          return { day: null, time: null, body: raw, kind };
        }

        /** 语义记忆 → 行数组（事实在前、偏好在后，各自保持写入顺序） */
        function memoryRows(semantic) {
          const facts = (semantic?.facts ?? []).map((t) => parseMemoryEntry(t, 'fact'));
          const prefs = (semantic?.preferences ?? []).map((t) => parseMemoryEntry(t, 'preference'));
          return [...facts, ...prefs];
        }

        /** 排序：有时间的按 day+time 排，无时间的（偏好）沉到最后 */
        function sortMemoryRows(rows, order) {
          const key = (e) => (e.day ? e.day + e.time : '');
          const sorted = [...rows].sort((a, b) => {
            const ka = key(a);
            const kb = key(b);
            if (!ka && !kb) return 0;
            if (!ka) return 1;
            if (!kb) return -1;
            return kb.localeCompare(ka);
          });
          return order === 'newest' ? sorted : sorted.reverse();
        }

        /**
         * 记忆正文渲染：把模型的 **强调** 变成 <b>，并按搜索词加 <mark>。
         * 先按 ** 分段（交替加粗）再逐段 escape + 高亮，避免把标记当字面量、也避免注入。
         */
        function renderMemoryBody(text, query) {
          const segs = String(text ?? '').split('**');
          const esc = (s) =>
            s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
          return segs
            .map((seg, i) => {
              if (!seg) return '';
              let html;
              if (query) {
                const lower = seg.toLowerCase();
                const needle = query.toLowerCase();
                let out = '';
                let from = 0;
                let at;
                while ((at = lower.indexOf(needle, from)) >= 0) {
                  out += esc(seg.slice(from, at));
                  out += '<mark>' + esc(seg.slice(at, at + needle.length)) + '</mark>';
                  from = at + needle.length;
                }
                out += esc(seg.slice(from));
                html = out;
              } else {
                html = esc(seg);
              }
              return i % 2 === 1 ? '<b>' + html + '</b>' : html;
            })
            .join('');
        }

        /** 一行：时间 | 圆点 | 正文（两行截断，点击展开） */
        function MemRow({ entry, query }) {
          const [open, setOpen] = React.useState(false);
          const [clipped, setClipped] = React.useState(false);
          const textRef = React.useRef(null);

          React.useEffect(() => {
            const el = textRef.current;
            if (el) setClipped(el.scrollHeight > el.clientHeight + 2);
          }, [query, entry.body, open]);

          const isPref = entry.kind === 'preference';
          return h(
            'div',
            { className: NS + '-c-mem' },
            h(
              'div',
              { className: NS + '-c-mem-time' },
              entry.day
                ? [
                    h('span', { key: 'd', className: 'd' }, entry.day),
                    ' ',
                    h('span', { key: 't', className: 't' }, entry.time),
                  ]
                : h('span', { className: 'none' }, '—'),
            ),
            h('div', { className: NS + '-c-mem-dot' + (isPref ? ' pref' : '') }),
            h(
              'div',
              { className: NS + '-c-mem-main' },
              h('p', {
                ref: textRef,
                className: NS + '-c-mem-text' + (open ? ' open' : ''),
                onClick: () => setOpen((v) => !v),
                dangerouslySetInnerHTML: {
                  __html:
                    (isPref ? '<span class="' + NS + '-c-kd pref">偏好</span>' : '') +
                    renderMemoryBody(entry.body, query),
                },
              }),
              clipped || open
                ? h(
                    'span',
                    { className: NS + '-c-mem-more', onClick: () => setOpen((v) => !v) },
                    open ? '收起' : '展开',
                  )
                : null,
            ),
          );
        }

        /** 全量记忆弹窗：搜索 + 事实/偏好筛选（v0.3.11 方案 B） */
        function MemoryModal({ rows, order, onClose }) {
          const [q, setQ] = React.useState('');
          const [kind, setKind] = React.useState('all');

          React.useEffect(() => {
            const onKey = (e) => {
              if (e.key === 'Escape') onClose();
            };
            document.addEventListener('keydown', onKey);
            return () => document.removeEventListener('keydown', onKey);
          }, [onClose]);

          const counts = {
            all: rows.length,
            fact: rows.filter((r) => r.kind === 'fact').length,
            preference: rows.filter((r) => r.kind === 'preference').length,
          };
          const needle = q.trim().toLowerCase();
          const list = sortMemoryRows(rows, order).filter((r) => {
            if (kind !== 'all' && r.kind !== kind) return false;
            if (!needle) return true;
            return r.body.toLowerCase().includes(needle) || String(r.day ?? '').includes(needle);
          });

          return portal(
            h(
              'div',
              {
                className: NS + '-c-mm-back',
                onClick: (e) => {
                  if (e.target === e.currentTarget) onClose();
                },
              },
              h(
                'div',
                { className: NS + '-c-mm' },
                h(
                  'div',
                  { className: NS + '-c-mm-head' },
                  h('span', { className: 't' }, '记忆 · 全部'),
                  h('span', { className: 'c num' }, '共 ' + rows.length + ' 条'),
                  h('button', { className: NS + '-c-mm-x', onClick: onClose, title: '关闭（Esc）' }, '✕'),
                ),
                h(
                  'div',
                  { className: NS + '-c-mm-tools' },
                  h('input', {
                    className: NS + '-c-mm-search',
                    value: q,
                    placeholder: '搜索记忆内容（如 npm、403、stars）…',
                    onChange: (e) => setQ(e.target.value),
                  }),
                  ...[
                    ['all', '全部'],
                    ['fact', '事实'],
                    ['preference', '偏好'],
                  ].map(([k, label]) =>
                    h(
                      'button',
                      {
                        key: k,
                        className: NS + '-c-mm-chip' + (kind === k ? ' on' : ''),
                        onClick: () => setKind(k),
                      },
                      label,
                      h('span', { className: 'n num' }, counts[k]),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: NS + '-c-mm-list' },
                  list.length === 0
                    ? h('div', { className: NS + '-c-mm-empty' }, '没有匹配的记忆')
                    : list.map((r, i) => h(MemRow, { key: i, entry: r, query: q.trim() })),
                ),
                h(
                  'div',
                  { className: NS + '-c-mm-foot' },
                  h('span', null, 'Esc 关闭 · 点击任意一条展开全文'),
                  h('span', { className: 'grow' }),
                  h(
                    'span',
                    { className: 'num' },
                    list.length === rows.length
                      ? '全部 ' + list.length + ' 条'
                      : '筛选出 ' + list.length + ' / ' + rows.length + ' 条',
                  ),
                ),
              ),
            ),
          );
        }

        function BotMemoryCard({ semantic, limit }) {
          const rows = memoryRows(semantic);
          const [order, setOrder] = React.useState('newest');
          const [openAll, setOpenAll] = React.useState(false);
          const [atBottom, setAtBottom] = React.useState(false);
          const scrollRef = React.useRef(null);

          const sorted = sortMemoryRows(rows, order);
          const preview = limit ? sorted.slice(0, limit) : sorted;

          const onScroll = () => {
            const el = scrollRef.current;
            if (!el) return;
            setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
          };

          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '记忆',
              count: rows.length ? '共 ' + rows.length + ' 条' : '空',
              right: rows.length
                ? h(
                    CLink,
                    { onClick: () => setOrder(order === 'newest' ? 'oldest' : 'newest') },
                    order === 'newest' ? '最新在前' : '最早在前',
                  )
                : null,
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              rows.length === 0
                ? h(
                    'div',
                    { className: NS + '-c-empty' },
                    h('p', null, '还没有沉淀下来的事实。跑几轮后，他会记住稳定的结论。'),
                  )
                : h(
                    'div',
                    { className: NS + '-c-memwrap' + (atBottom ? ' at-bottom' : '') },
                    h(
                      'div',
                      { className: NS + '-c-memscroll', ref: scrollRef, onScroll },
                      preview.map((r, i) => h(MemRow, { key: i, entry: r })),
                    ),
                  ),
            ),
            rows.length > 0
              ? h(
                  'div',
                  { className: NS + '-c-memfoot' },
                  h(
                    'span',
                    { className: 'num' },
                    limit && preview.length < rows.length
                      ? '显示前 ' + preview.length + ' 条 · 共 ' + rows.length + ' 条'
                      : '共 ' + rows.length + ' 条 · 可滚动查看',
                  ),
                  h('span', { className: 'grow' }),
                  h(CLink, { onClick: () => setOpenAll(true) }, '查看全部 ' + rows.length + ' 条 →'),
                )
              : null,
            openAll ? h(MemoryModal, { rows, order, onClose: () => setOpenAll(false) }) : null,
          );
        }

        // ---------- 概览 ----------
        function BotOverview({ bot, detail, act, busy, onDetail, onForm, onOpenRun }) {
          const badge = cBotBadge(bot);
          return h(
            'div',
            null,
            h(
              'div',
              { className: NS + '-c-dhead' },
              h(
                'div',
                null,
                h(
                  'div',
                  { className: NS + '-c-dname' },
                  bot.name,
                  h(CPill, { tone: badge.tone }, badge.text),
                ),
                h('div', { className: NS + '-c-drole' }, bot.role),
              ),
              h(
                'div',
                { className: NS + '-c-dactions' },
                h(
                  CBtn,
                  {
                    kind: 'primary',
                    icon: h(IconRun, { size: 13 }),
                    disabled: busy,
                    onClick: () => act('run', bot),
                  },
                  '执行',
                ),
                h(CBtn, { onClick: onDetail }, '查看详情'),
              ),
            ),
            h(BotSituation, { bot, detail, act, busy, onForm }),
            h(BotGoalCard, { bot, detail, busy, onForm }),
            h(BotRunsCard, { runs: detail?.runs ?? [], preview: true, onAll: onDetail, onOpen: onOpenRun, botName: bot.name }),
            h(BotMemoryCard, { semantic: detail?.semantic, limit: 3 }),
          );
        }

        // ---------- 通知卡（v0.3.9 刀 2：单 Bot 覆盖，清空即恢复跟随全局） ----------
        function BotNotifyCard({ bot, busy, onChanged }) {
          const [state, setState] = React.useState(null); // { effective, global, overrides }
          const [err, setErr] = React.useState('');
          const [saving, setSaving] = React.useState(false);
          const botId = bot.id;

          const load = React.useCallback(async () => {
            try {
              const j = await cget('/settings?botId=' + encodeURIComponent(botId));
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              setState(j.value ?? null);
              setErr('');
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, [botId]);

          React.useEffect(() => { void load(); }, [load]);

          /** 保存覆盖项；clear 里的键会从单 Bot 文件删除 → 恢复跟随全局 */
          const save = async (patch, clear) => {
            setSaving(true);
            try {
              const j = await cpost('/settings', { botId, settings: patch ?? {}, clear: clear ?? [] });
              if (!j?.ok) throw new Error(j?.message || '保存失败');
              await load();
              onChanged?.();
            } catch (e) {
              setErr(String(e?.message ?? e));
            } finally {
              setSaving(false);
            }
          };

          if (err && !state) {
            return h(CCard, null,
              h(CCardHead, { title: '通知' }),
              h('div', { className: NS + '-c-card-body' }, h('div', { className: NS + '-c-err' }, err)));
          }
          if (!state) {
            return h(CCard, null,
              h(CCardHead, { title: '通知' }),
              h('div', { className: NS + '-c-card-body' }, h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取通知设置…'))));
          }

          const eff = state.effective ?? {};
          const glob = state.global ?? {};
          const overrides = state.overrides ?? [];
          const has = (k) => overrides.indexOf(k) >= 0;
          const disabled = busy || saving;

          /** 一行：左侧标签 + 「跟随全局 / 已覆盖」，右侧开关或时段 + 恢复按钮 */
          const row = (key, label, hint, globalText, control) =>
            h(CRow, {
              label,
              hint: has(key) ? '已覆盖全局 · ' + hint : '跟随全局：' + globalText,
            }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              control,
              has(key)
                ? h(CLink, { onClick: () => void save({}, [key]) }, '恢复跟随')
                : null,
            ));

          const quiet = eff.quietHours;

          return h(CCard, null,
            h(CCardHead, {
              title: '通知',
              right: h('span', { className: NS + '-c-card-count' }, '仅对这个 Bot 生效'),
            }),
            h('div', { className: NS + '-c-card-body' },
              row('notifySystem', '运行完成后系统通知', '关掉后这个 Bot 不再弹桌面通知',
                glob.notifySystem === false ? '关' : '开',
                h(CSwitch, {
                  value: eff.notifySystem !== false,
                  disabled,
                  onChange: (v) => void save({ notifySystem: v }, []),
                })),

              row('notifyOnlyOnDecision', '仅异常时打扰', '自动轮次只在失败/部分成功时提醒',
                glob.notifyOnlyOnDecision !== false ? '开' : '关',
                h(CSwitch, {
                  value: eff.notifyOnlyOnDecision !== false,
                  disabled,
                  onChange: (v) => void save({ notifyOnlyOnDecision: v }, []),
                })),

              h(CRow, {
                label: '免打扰时段',
                hint: has('quietHours')
                  ? '已覆盖全局 · ' + (quiet ? quiet.start + ' – ' + quiet.end : '不启用')
                  : '跟随全局：' + (glob.quietHours ? glob.quietHours.start + ' – ' + glob.quietHours.end : '不启用'),
              }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                quiet
                  ? h('div', { style: { display: 'flex', gap: 6 } },
                      h('input', {
                        type: 'time', className: NS + '-c-input', style: { width: 136 },
                        value: quiet.start, disabled,
                        onChange: (e) => void save({ quietHours: { start: e.target.value || '22:00', end: quiet.end } }, []),
                      }),
                      h('input', {
                        type: 'time', className: NS + '-c-input', style: { width: 136 },
                        value: quiet.end, disabled,
                        onChange: (e) => void save({ quietHours: { start: quiet.start, end: e.target.value || '08:00' } }, []),
                      }),
                    )
                  : null,
                h(CSwitch, {
                  value: !!quiet,
                  disabled,
                  onChange: (v) => void save({ quietHours: v ? { start: '22:00', end: '08:00' } : null }, []),
                }),
                has('quietHours') ? h(CLink, { onClick: () => void save({}, ['quietHours']) }, '恢复跟随') : null,
              )),

              err ? h('div', { className: NS + '-c-err', style: { marginTop: 8 } }, err) : null,
              h('div', { className: NS + '-c-hint-block' },
                '只有通知相关项可按 Bot 覆盖；其余设置（预算 / 模型 / 快照）始终针对单个 Bot。'),
            ),
          );
        }


        // ---------- 配置卡（可编辑） ----------
        function BotConfigCard({ bot, detail, busy, onSave }) {
          const [editing, setEditing] = React.useState(false);
          const [name, setName] = React.useState('');
          const [role, setRole] = React.useState('');
          const [note, setNote] = React.useState('');
          const [mode, setMode] = React.useState('none');
          const [hours, setHours] = React.useState(12);
          const [time, setTime] = React.useState('09:00');
          const [days, setDays] = React.useState([1]);
          const [custom, setCustom] = React.useState('');
          const [provider, setProvider] = React.useState('');
          const [modelName, setModelName] = React.useState('');
          const [daily, setDaily] = React.useState('5');
          const [monthly, setMonthly] = React.useState('100');
          const [onExceed, setOnExceed] = React.useState('stop');
          const [providers, setProviders] = React.useState([]);
          const [err, setErr] = React.useState('');

          const openEdit = () => {
            setName(bot.name ?? '');
            setRole(bot.role ?? '');
            setNote(bot.systemPromptExtra ?? '');
            const p = parseCadence(detail?.goal?.cadence);
            setMode(p.mode);
            setHours(p.hours);
            setTime(p.time);
            setDays(p.days);
            setCustom(p.custom);
            setProvider(bot.model?.provider ?? '');
            setModelName(bot.model?.model ?? '');
            setDaily(String(bot.budget?.dailyCny ?? 5));
            setMonthly(String(bot.budget?.monthlyCny ?? 100));
            setOnExceed(bot.budget?.onExceed ?? 'stop');
            setErr('');
            setEditing(true);
            void (async () => {
              try {
                const j = await cget('/models');
                if (j?.ok) setProviders(j.value?.available ?? []);
              } catch {
                /* 拿不到就手填 */
              }
            })();
          };

          const save = async () => {
            if (!name.trim() || !role.trim()) {
              setErr('名称和职责不能为空');
              return;
            }
            const d = Number(daily);
            const m = Number(monthly);
            if (!Number.isFinite(d) || d <= 0 || d > 1000) {
              setErr('每日预算需要是 0–1000 之间的数字');
              return;
            }
            if (!Number.isFinite(m) || m < d) {
              setErr('每月预算不能小于每日预算');
              return;
            }
            const cadence = buildCadence(mode, hours, time, days, custom);
            const res = await onSave({
              name: name.trim(),
              role: role.trim(),
              systemPromptExtra: note,
              cadence,
              budget: { dailyCny: d, monthlyCny: m, onExceed },
              // v0.3.9 刀 3：模型并入同一 POST，避免「名字改了模型没改」的半失败
              model: { provider, model: modelName },
            });
            if (res?.error) {
              setErr(res.error);
              return;
            }
            setEditing(false);
          };

          if (!editing) {
            const b = detail?.budget;
            const pct = b?.dailyLimit ? Math.min(100, (b.today / b.dailyLimit) * 100) : 0;
            return h(
              CCard,
              null,
              h(CCardHead, {
                title: '配置',
                right: h(CBtn, { size: 'sm', onClick: openEdit, disabled: busy }, '编辑'),
              }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '名称'),
                  h('span', { className: 'v' }, bot.name),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '模型'),
                  h('span', { className: 'v' }, (bot.model?.provider ?? '—') + ' / ' + (bot.model?.model ?? '—')),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '执行周期'),
                  h('span', { className: 'v' }, cCadenceText(detail?.goal?.cadence)),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '预算'),
                  h(
                    'span',
                    { className: 'v' },
                    '每日 ' + fmtCny(bot.budget?.dailyCny) + ' · 每月 ' + fmtCny(bot.budget?.monthlyCny) +
                      ' · ' + (bot.budget?.onExceed === 'stop' ? '超限停止' : '超限降级'),
                  ),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '今日已用'),
                  h(
                    'span',
                    { className: 'v num' },
                    cMoney(b?.today ?? 0) + ' / ' + cMoney(b?.dailyLimit ?? 0) + '（' + pct.toFixed(1) + '%）',
                  ),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '工作区'),
                  h('span', { className: 'v mono', title: bot.workspace }, bot.workspace),
                ),
              ),
            );
          }

          const modelsFor = providers.find((x) => x?.provider === provider)?.models ?? [];
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '配置',
              right: h(CPill, { tone: 'brand' }, '编辑中'),
            }),
            h(
              'div',
              { className: NS + '-c-card-body' },
              h(
                'div',
                { className: NS + '-c-form' },
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '名称'),
                  h('input', {
                    className: NS + '-c-input',
                    value: name,
                    onChange: (e) => setName(e.target.value),
                    placeholder: 'Bot 名称',
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '模型'),
                  h(
                    'div',
                    { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
                    h(
                      'select',
                      {
                        className: NS + '-c-input',
                        value: provider,
                        onChange: (e) => {
                          setProvider(e.target.value);
                          const first = providers.find((x) => x?.provider === e.target.value)?.models?.[0];
                          if (first) setModelName(first);
                        },
                      },
                      h('option', { value: provider }, provider || '选择 provider'),
                      ...providers.filter((x) => x?.provider !== provider).map((x) =>
                        h('option', { key: x.provider, value: x.provider }, x.provider),
                      ),
                    ),
                    h(
                      'select',
                      {
                        className: NS + '-c-input',
                        value: modelName,
                        onChange: (e) => setModelName(e.target.value),
                      },
                      h('option', { value: modelName }, modelName || '选择模型'),
                      ...modelsFor.filter((m) => m !== modelName).map((m) =>
                        h('option', { key: m, value: m }, m),
                      ),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: NS + '-c-field wide' },
                  h('label', null, '职责'),
                  h('textarea', {
                    className: NS + '-c-input',
                    rows: 2,
                    value: role,
                    onChange: (e) => setRole(e.target.value),
                    placeholder: '一句话，决定他该怎么干活',
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field wide' },
                  h('label', null, '附加说明（会写进系统提示）'),
                  h('textarea', {
                    className: NS + '-c-input',
                    rows: 3,
                    value: note,
                    onChange: (e) => setNote(e.target.value),
                    placeholder: '可选。稳定的事实、数据源、禁做事项。',
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field wide' },
                  h('label', null, '执行周期'),
                  h(
                    'div',
                    { className: NS + '-c-seg' },
                    ...[
                      ['hours', '每 N 小时'],
                      ['daily', '每天'],
                      ['weekly', '每周'],
                      ['none', '不自动跑'],
                    ].map(([m, label]) =>
                      h(
                        'button',
                        {
                          key: m,
                          type: 'button',
                          className: mode === m ? 'on' : '',
                          onClick: () => setMode(m),
                        },
                        label,
                      ),
                    ),
                  ),
                  mode === 'hours'
                    ? h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } },
                        h(CBtn, { size: 'sm', onClick: () => setHours(Math.max(1, hours - 1)) }, '−'),
                        h('span', { className: NS + '-c-card-count num', style: { minWidth: 64, textAlign: 'center' } }, '每 ' + hours + ' 小时'),
                        h(CBtn, { size: 'sm', onClick: () => setHours(Math.min(24, hours + 1)) }, '＋'),
                        h('span', { className: NS + '-c-card-count' }, '整点触发'),
                      )
                    : null,
                  mode === 'daily' || mode === 'weekly'
                    ? h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' } },
                        h('input', {
                          type: 'time',
                          className: NS + '-c-input',
                          style: { width: 110 },
                          value: time,
                          onChange: (e) => setTime(e.target.value || '09:00'),
                        }),
                        mode === 'weekly'
                          ? h(
                              'div',
                              { style: { display: 'flex', gap: 4 } },
                              ...[
                                [1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [0, '日'],
                              ].map(([d, label]) =>
                                h(
                                  'button',
                                  {
                                    key: d,
                                    type: 'button',
                                    className: NS + '-c-btn sm' + (days.includes(d) ? ' primary' : ' ghost'),
                                    onClick: () =>
                                      setDays((prev) =>
                                        prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
                                      ),
                                  },
                                  '周' + label,
                                ),
                              ),
                            )
                          : null,
                      )
                    : null,
                  h('span', { className: NS + '-c-card-count', style: { marginTop: 6 } }, '按宿主机时区触发'),
                ),
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '每日预算上限（¥）'),
                  h('input', {
                    className: NS + '-c-input',
                    type: 'number',
                    min: 0.01,
                    max: 1000,
                    step: 0.5,
                    value: daily,
                    onChange: (e) => setDaily(e.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '每月预算上限（¥）'),
                  h('input', {
                    className: NS + '-c-input',
                    type: 'number',
                    min: 0.01,
                    step: 1,
                    value: monthly,
                    onChange: (e) => setMonthly(e.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '超限行为'),
                  h(
                    'select',
                    {
                      className: NS + '-c-input',
                      value: onExceed,
                      onChange: (e) => setOnExceed(e.target.value),
                    },
                    h('option', { value: 'stop' }, '停止运行'),
                    h('option', { value: 'downgrade' }, '降级到更便宜的模型'),
                  ),
                ),
              ),
              err ? h('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, err) : null,
              h(
                'div',
                { className: NS + '-c-form-foot' },
                h(CBtn, { kind: 'ghost', onClick: () => setEditing(false), disabled: busy }, '取消'),
                h(CBtn, { kind: 'primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
              ),
            ),
          );
        }

        // ---------- 例行流程（只读，0.3.8 降级） ----------
        // YAML 是开发者词汇；创建走对话（routine_save 工具），面板只读 + 删除。
        function BotRoutinesCard({ bot, routines, busy, onChanged }) {
          const [confirmId, setConfirmId] = React.useState('');
          const [err, setErr] = React.useState('');
          const list = routines ?? [];
          if (list.length === 0) return null;

          const remove = async (r) => {
            if (confirmId !== r.id) {
              setConfirmId(r.id);
              return;
            }
            setConfirmId('');
            try {
              const j = await cpost('/routines/remove', { botId: bot.id, routineId: r.id });
              if (!j?.ok) throw new Error(j?.message || '删除失败');
              onChanged?.();
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          };

          const triggerText = (t) => {
            const tr = t?.triggers?.[0];
            if (!tr) return '手动触发';
            if (tr.type === 'cron') return '定时 · ' + cCadenceText(tr.expression);
            return '手动触发';
          };

          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '例行流程',
              count: String(list.length),
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              h(
                'div',
                { className: NS + '-c-empty', style: { marginBottom: 8 } },
                h('p', null, '例行流程是「每次都一模一样的固定步骤」（区别于目标的随机应变）。想加一个：直接在对话里对他说，例如「每周一早上整理下载目录，建成流程」。'),
              ),
              list.map((r) =>
                h(
                  'div',
                  { key: r.id, className: NS + '-c-mem', style: { alignItems: 'center' } },
                  h(
                    'div',
                    { style: { flex: 1, minWidth: 0 } },
                    h('p', null, r.name),
                    h('time', null, (r.description ? r.description + ' · ' : '') + triggerText(r) + ' · ' + r.stepCount + ' 步'),
                  ),
                  h(CBtn, {
                    size: 'sm',
                    kind: 'danger',
                    onClick: () => remove(r),
                    disabled: busy,
                  }, confirmId === r.id ? '确认删除？' : '删除'),
                ),
              ),
              err ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, err) : null,
            ),
          );
        }

        // ---------- 快照与危险区 ----------
        // ⭐ 0.3.8：按「文件证据」显示。抓取类 Bot 的快照全是 0 个文件，
        //   整卡展示只会让人困惑（截图反馈）；只要出现过非空快照（含
        //   用户后来改了任务、开始写文件），卡片自动恢复完整形态。
        function BotSnapshotsCard({ bot, detail, busy, act }) {
          const [confirmRollback, setConfirmRollback] = React.useState('');
          const [confirmDelete, setConfirmDelete] = React.useState(false);
          const snaps = detail?.snapshots ?? [];
          const usage = detail?.snapshotUsage;
          const fileSnapCount = snaps.filter((s) => (s.fileCount ?? 0) > 0).length;
          const everTouchedFiles = fileSnapCount > 0;
          if (!everTouchedFiles) {
            return h(
              CCard,
              null,
              h(CCardHead, { title: '快照与回滚', right: h(CPill, { tone: 'muted' }, '未启用') }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h('div', { className: NS + '-c-empty' }, h('p', null, '这个 Bot 到目前没有写过任何文件，快照与回滚用不上。等它开始产出或修改文件后，这里会自动出现回滚能力。')),
                h(
                  'div',
                  { className: NS + '-c-danger' },
                  h('span', { className: 'lb' }, '危险操作 · 不可恢复'),
                  h(
                    CBtn,
                    {
                      size: 'sm',
                      kind: 'danger',
                      disabled: busy,
                      onClick: () => {
                        if (!confirmDelete) {
                          setConfirmDelete(true);
                          return;
                        }
                        setConfirmDelete(false);
                        act('botDelete', bot);
                      },
                    },
                    confirmDelete ? '确认删除？不可恢复' : '删除这个 Bot',
                  ),
                ),
              ),
            );
          }
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '快照与回滚',
              count: usage ? usage.count + ' 个快照 · ' + Math.round((usage.bytes || 0) / 1024) + ' KB' : String(snaps.length) + ' 个快照',
              right: h(CBtn, { size: 'sm', disabled: busy, onClick: () => act('snapshot', bot) }, '打快照'),
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              snaps.length === 0
                ? h('div', { className: NS + '-c-empty' }, h('p', null, '还没有快照。真实执行前会自动打一个；也可以现在手动打一个。'))
                : snaps.filter((s) => (s.fileCount ?? 0) > 0).slice(0, 8).map((s) =>
                    h(
                      'div',
                      { key: s.id, className: NS + '-c-run', style: { gridTemplateColumns: '6px minmax(0,1fr) auto auto' } },
                      h('span', { className: NS + '-c-dot ok' }),
                      h(
                        'span',
                        { style: { color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        (s.note || (s.runId ? '运行前自动快照' : '手动快照')) + ' · ' + cWhen(s.createdAt),
                      ),
                      h('span', { className: 'id' }, s.fileCount + ' 个文件 · ' + Math.round((s.totalBytes || 0) / 1024) + ' KB'),
                      h(
                        CBtn,
                        {
                          size: 'sm',
                          kind: confirmRollback === s.id ? 'danger' : undefined,
                          disabled: busy,
                          onClick: () => {
                            if (confirmRollback !== s.id) {
                              setConfirmRollback(s.id);
                              return;
                            }
                            setConfirmRollback('');
                            act('rollback', bot, { snapshotId: s.id });
                          },
                        },
                        confirmRollback === s.id ? '确认回滚？' : '回滚',
                      ),
                    ),
                  ),
              h(
                'div',
                { className: NS + '-c-danger' },
                h('span', { className: 'lb' }, '危险操作 · 不可恢复'),
                h(
                  CBtn,
                  {
                    size: 'sm',
                    kind: 'danger',
                    disabled: busy,
                    onClick: () => {
                      if (!confirmDelete) {
                        setConfirmDelete(true);
                        return;
                      }
                      setConfirmDelete(false);
                      act('botDelete', bot);
                    },
                  },
                  confirmDelete ? '确认删除？不可恢复' : '删除这个 Bot',
                ),
              ),
            ),
          );
        }

        // ---------- 详情页 ----------
        function BotDetailPane({ bot, detail, act, busy, onBack, onForm, onSaveConfig, onChanged, onAllRuns, onOpenRun }) {
          const badge = cBotBadge(bot);
          // 列表摘要不含模型 / 预算 / 工作区；配置卡必须吃完整 identity
          const full = detail?.bot ?? bot;
          return h(
            'section',
            { className: NS + '-c-pane' },
            h(
              'header',
              { className: NS + '-c-pane-head' },
              h(
                'div',
                { className: 'row' },
                h('button', { type: 'button', className: NS + '-c-back', onClick: onBack }, '← 概览'),
                h('span', { className: NS + '-c-dname' }, bot.name),
                h(CPill, { tone: badge.tone }, badge.text),
                h(
                  'div',
                  { className: NS + '-c-dactions', style: { marginLeft: 'auto' } },
                  h(
                    CBtn,
                    {
                      kind: 'primary',
                      disabled: busy,
                      icon: h(IconRun, { size: 13 }),
                      onClick: () => act('run', bot),
                    },
                    '执行',
                  ),
                ),
              ),
              h('div', { className: NS + '-c-drole' }, bot.role),
            ),
            h(BotSituation, { bot, detail, act, busy, onForm }),
            h(BotGoalCard, { bot, detail, busy, onForm }),
            h(BotRunsCard, { runs: detail?.runs ?? [], preview: false, onAll: onAllRuns, onOpen: onOpenRun, botName: bot.name }),
            h(BotMemoryCard, { semantic: detail?.semantic }),
            h(BotRoutinesCard, { bot, routines: detail?.routines ?? [], busy, onChanged }),
            h(BotConfigCard, { bot: full, detail, busy, onSave: onSaveConfig }),
            h(BotNotifyCard, { bot: full, busy, onChanged }),
            h(BotSnapshotsCard, { bot: full, detail, busy, act }),
          );
        }

        // ---------- 运行记录 tab ----------
        function ConsoleRuns({ bots, busy, onOpenRun }) {
          const [runs, setRuns] = React.useState(null);
          const [health, setHealth] = React.useState(null);
          const [filter, setFilter] = React.useState('all');
          const [page, setPage] = React.useState(0);
          const [err, setErr] = React.useState('');
          const pageSize = 10;

          const load = React.useCallback(async () => {
            try {
              // v0.3.9 刀 3：一次聚合请求取代「每 Bot 一个 /runs/list」的 N+1
              const j = await cget('/runs/aggregate?limit=20');
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              const list = (j.value?.runs ?? []).slice();
              list.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
              setRuns(list);
              setHealth(j.value?.health ?? null);
              setErr('');
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, [bots]);

          React.useEffect(() => {
            void load();
          }, [load]);

          const list = (runs ?? []).filter((r) => filter === 'all' || r.botId === filter);
          const pages = Math.max(1, Math.ceil(list.length / pageSize));
          const safe = Math.min(page, pages - 1);
          const view = list.slice(safe * pageSize, safe * pageSize + pageSize);

          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '运行记录',
              count: runs ? '共 ' + list.length + ' 条' : '读取中…',
              right: h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                health
                  ? h('span', { className: NS + '-c-card-count num', title: '近 N 轮成功率' },
                      '成功率 ' + Math.round((health.successRate ?? 0) * 100) + '% · ' + (health.sample ?? 0) + ' 轮')
                  : null,
                h(
                  'select',
                  {
                    className: NS + '-c-input',
                    style: { width: 180 },
                    value: filter,
                    onChange: (e) => {
                      setFilter(e.target.value);
                      setPage(0);
                    },
                  },
                  h('option', { value: 'all' }, '全部 Bot'),
                  ...bots.map((b) => h('option', { key: b.id, value: b.id }, b.name)),
                ),
                h(CBtn, { size: 'sm', onClick: () => void load(), disabled: busy }, '刷新'),
              ),
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              err ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, err) : null,
              !runs
                ? h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取运行记录…'))
                : list.length === 0
                  ? h('div', { className: NS + '-c-empty' }, h('p', null, '还没有运行记录。'))
                  : view.map((r) =>
                      h(
                        'div',
                        {
                          key: r.id,
                          className: NS + '-c-run',
                          style: { cursor: 'pointer', gridTemplateColumns: '6px 40px minmax(0,1fr) auto auto auto 12px' },
                          onClick: () => onOpenRun(r),
                        },
                        h('span', {
                          className:
                            NS + '-c-dot ' +
                            (r.status === 'success' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'),
                        }),
                        h('span', { className: 'st' + (r.status === 'success' ? '' : ' err') }, statusText(r.status)),
                        h('span', { className: 'wh num' }, cWhen(r.startedAt) + ' · ' + cTriggerText(r.trigger)),
                        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, r.botName),
                        h('span', { className: 'cs num' }, fmtCost(r.usage)),
                        h('span', { className: 'id' }, '#' + String(r.id).slice(0, 8)),
                        h('span', { className: 'cv' }, h(IconChevron, { size: 12 })),
                      ),
                    ),
              runs && list.length > pageSize
                ? h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' } },
                    h('span', { className: NS + '-c-card-count num' }, '第 ' + (safe + 1) + ' / ' + pages + ' 页'),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6 } },
                      h(CBtn, { size: 'sm', disabled: safe === 0, onClick: () => setPage(safe - 1) }, '上一页'),
                      h(CBtn, { size: 'sm', disabled: safe >= pages - 1, onClick: () => setPage(safe + 1) }, '下一页'),
                    ),
                  )
                : null,
            ),
          );
        }

        // ---------- 开关 / 设置 ----------
        function CSwitch({ value, onChange, disabled }) {
          return h(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': value ? 'true' : 'false',
              className: NS + '-c-switch' + (value ? ' on' : ''),
              onClick: () => onChange(!value),
              disabled,
            },
            h('span', { className: 'knob' }),
          );
        }

        function CRow({ label, hint, children }) {
          return h(
            'div',
            { className: NS + '-c-setting' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { className: NS + '-c-setting-label' }, label),
              hint ? h('div', { className: NS + '-c-setting-hint' }, hint) : null,
            ),
            children,
          );
        }

        function ConsoleSettings({ bots, busy }) {
          const [s, setS] = React.useState(null);
          const [err, setErr] = React.useState('');
          const [notice, setNotice] = React.useState('');
          const [confirmClear, setConfirmClear] = React.useState(false);

          React.useEffect(() => {
            void (async () => {
              try {
                const j = await cget('/settings');
                if (!j?.ok) throw new Error(j?.message || '读取失败');
                setS(j.value?.effective ?? null);
              } catch (e) {
                setErr(String(e?.message ?? e));
              }
            })();
          }, []);

          const patch = async (key, value) => {
            const next = { ...(s ?? {}), [key]: value };
            setS(next);
            const j = await cpost('/settings', { settings: { [key]: value } });
            if (!j?.ok) setErr(j?.message || '保存失败');
          };

          const clearAll = async () => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            setConfirmClear(false);
            let removed = 0;
            for (const b of bots) {
              const j = await cpost('/runs/clear', { botId: b.id, confirm: true });
              if (j?.ok) removed += j.value?.removed ?? 0;
            }
            setNotice('已清空 ' + removed + ' 条运行记录');
          };

          if (err) {
            return h(CCard, null, h(CCardHead, { title: '设置' }), h('div', { className: NS + '-c-card-body' }, h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, err)));
          }
          if (!s) {
            return h(CCard, null, h(CCardHead, { title: '设置' }), h('div', { className: NS + '-c-card-body' }, h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取设置…'))));
          }

          return h(
            'div',
            null,
            h(
              CCard,
              null,
              h(CCardHead, { title: '通知' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(CRow, {
                  label: '运行完成后系统通知',
                  hint: '轮询新完成的运行；首次需要在系统弹窗里授权通知权限',
                }, h(CSwitch, {
                  value: s.notifySystem !== false,
                  onChange: (v) => patch('notifySystem', v),
                  disabled: busy,
                })),
                h(CRow, {
                  label: '仅异常时打扰',
                  hint: '自动轮次只在失败 / 部分成功时提醒；手动点「执行」始终通知',
                }, h(CSwitch, {
                  value: s.notifyOnlyOnDecision !== false,
                  onChange: (v) => patch('notifyOnlyOnDecision', v),
                  disabled: busy,
                })),
                h(
                  CRow,
                  {
                    label: '免打扰时段',
                    hint: s.quietHours ? s.quietHours.start + ' – ' + s.quietHours.end + '（支持跨午夜）' : '未启用',
                  },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    s.quietHours
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: 6 } },
                          h('input', {
                            type: 'time',
                            className: NS + '-c-input',
                            style: { width: 150 },
                            value: s.quietHours.start,
                            onChange: (e) => patch('quietHours', { ...s.quietHours, start: e.target.value || '22:00' }),
                          }),
                          h('input', {
                            type: 'time',
                            className: NS + '-c-input',
                            style: { width: 150 },
                            value: s.quietHours.end,
                            onChange: (e) => patch('quietHours', { ...s.quietHours, end: e.target.value || '08:00' }),
                          }),
                        )
                      : null,
                    h(CSwitch, {
                      value: !!s.quietHours,
                      onChange: (v) => patch('quietHours', v ? { start: '22:00', end: '08:00' } : null),
                      disabled: busy,
                    }),
                  ),
                ),
              ),
            ),
            h(
              CCard,
              null,
              h(CCardHead, { title: '界面' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(CRow, {
                  label: '侧边栏图标入口',
                  hint: '在左侧边栏显示 Bot 图标；关闭后仍可从「设置 → 插件 → Bot」进入',
                }, h(CSwitch, {
                  value: s.sidebarEntry !== false,
                  onChange: (v) => {
                    patch('sidebarEntry', v);
                    try {
                      sidebarController.apply(v);
                    } catch {
                      /* 注册失败不影响保存 */
                    }
                  },
                  disabled: busy,
                })),
              ),
            ),
            h(
              CCard,
              null,
              h(CCardHead, { title: '数据' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(CRow, {
                  label: '运行记录',
                  hint: '清空所有 Bot 的运行记录；目标与记忆保留',
                }, h(CBtn, {
                  size: 'sm',
                  kind: 'danger',
                  onClick: clearAll,
                  disabled: busy || !bots.length,
                }, confirmClear ? '确认清空？不可恢复' : '清空记录')),
                notice ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, notice) : null,
              ),
            ),
          );
        }

        // ---------- 诊断 tab ----------
        function ConsoleDoctor() {
          const [report, setReport] = React.useState(null);
          const [err, setErr] = React.useState('');
          const [busy, setBusy] = React.useState(false);
          const [copied, setCopied] = React.useState('');

          const load = React.useCallback(async () => {
            setBusy(true);
            try {
              const j = await cget('/doctor');
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              setReport(j.value);
              setErr('');
            } catch (e) {
              setErr(String(e?.message ?? e));
            } finally {
              setBusy(false);
            }
          }, []);

          React.useEffect(() => {
            void load();
          }, [load]);

          const tone = (level) =>
            level === 'error'
              ? 'var(--dsw-alias-state-error-primary)'
              : level === 'warn'
                ? 'var(--dsw-alias-state-warn-primary)'
                : 'var(--dsw-alias-state-success-primary)';

          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '诊断',
              count: report ? 'v' + report.version : null,
              right: h(
                'div',
                { style: { display: 'flex', gap: 8 } },
                h(CBtn, { size: 'sm', onClick: () => void load(), disabled: busy }, busy ? '读取中…' : '刷新'),
                h(CBtn, {
                  size: 'sm',
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(report?.text ?? '');
                      setCopied('已复制');
                      setTimeout(() => setCopied(''), 1500);
                    } catch {
                      setCopied('复制失败');
                    }
                  },
                }, copied || '复制诊断'),
              ),
            }),
            h(
              'div',
              { className: NS + '-c-card-body' },
              err
                ? h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } }, '诊断不可用：' + err)
                : !report
                  ? h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取诊断…'))
                  : (report.checks ?? []).map((c) =>
                      h(
                        'div',
                        { key: c.id, className: NS + '-c-kv', style: { alignItems: 'flex-start', gridTemplateColumns: '10px minmax(0,1fr)' } },
                        h('span', {
                          style: {
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: tone(c.level),
                            marginTop: 6,
                          },
                        }),
                        h(
                          'div',
                          { style: { minWidth: 0 } },
                          h('div', { style: { fontSize: 14, lineHeight: '22px', fontWeight: 500 } }, c.title),
                          h('div', { style: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' } }, c.detail),
                          c.hint ? h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-brand-text)', marginTop: 2 } }, '下一步：' + c.hint) : null,
                        ),
                      ),
                    ),
            ),
          );
        }

        // ---------- 控制台外壳 ----------
        function BotConsole() {
          const [tab, setTab] = React.useState('bots');
          const [detailView, setDetailView] = React.useState(false);
          const [data, setData] = React.useState(null);
          const [sel, setSel] = React.useState(null);
          const [detail, setDetail] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [notice, setNotice] = React.useState('');
          const [err, setErr] = React.useState('');
          const [form, setForm] = React.useState(null);
          const [openRun, setOpenRun] = React.useState(null);

          const bots = data?.bots ?? [];
          const selected = bots.find((b) => b.id === sel) || bots[0] || null;

          const refresh = React.useCallback(async () => {
            try {
              const j = await cget('/overview');
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              setData(j.value);
              const list = j.value?.bots ?? [];
              setSel((prev) =>
                prev && list.some((b) => b.id === prev) ? prev : list[0]?.id ?? null,
              );
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, []);

          const loadDetail = React.useCallback(async (botId) => {
            if (!botId) {
              setDetail(null);
              return;
            }
            try {
              const j = await cget('/bot?botId=' + encodeURIComponent(botId));
              if (!j?.ok) throw new Error(j?.message || '读取详情失败');
              setDetail(j.value);
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, []);

          React.useEffect(() => {
            void refresh();
          }, [refresh]);

          React.useEffect(() => {
            void loadDetail(selected?.id);
          }, [selected?.id, loadDetail]);

          React.useEffect(() => {
            if (!busy || !selected?.id) return;
            const t = setInterval(() => {
              void loadDetail(selected.id);
            }, 3000);
            return () => clearInterval(t);
          }, [busy, selected?.id, loadDetail]);

          const act = React.useCallback(
            async (kind, bot, extra) => {
              if (!bot?.id && kind !== 'botCreate') return;
              setBusy(true);
              setErr('');
              setNotice('');
              try {
                const res = await runBotAction(kind, bot, extra);
                if (res.error) setErr(res.error);
                if (res.notice) setNotice(res.notice);
                if (res.deleted) {
                  setSel(null);
                  setDetail(null);
                  setDetailView(false);
                }
                await refresh();
                if (kind === 'botCreate' && res.value?.id) setSel(res.value.id);
                if (!res.deleted && sel) await loadDetail(sel);
              } catch (e) {
                setErr(String(e?.message ?? e));
              } finally {
                setBusy(false);
              }
            },
            [refresh, loadDetail, sel],
          );

          const saveConfig = React.useCallback(
            async (payload) => {
              if (!selected?.id) return { error: '没有选中的 Bot' };
              setBusy(true);
              setErr('');
              try {
                // v0.3.9 刀 3：资料 / 模型 / 预算 / 节奏 一次提交（服务端按段校验）
                const j = await cpost('/bot/update', { botId: selected.id, ...payload });
                if (!j?.ok) return { error: j?.message || '保存失败' };
                setNotice('已保存');
                await refresh();
                await loadDetail(selected.id);
                return {};
              } catch (e) {
                return { error: String(e?.message ?? e) };
              } finally {
                setBusy(false);
              }
            },
            [selected, refresh, loadDetail],
          );

          const today = data?.stats?.todayCostCny ?? 0;
          const pending = bots.reduce(
            (n, b) => n + (b.pendingConfirmCount || 0) + (b.blocked ? 1 : 0),
            0,
          );
          const hb = data?.heartbeat;
          const hbMin = hb?.lastBeatAt ? Math.max(0, Math.floor((hb.staleMs || 0) / 60_000)) : null;

          const alert =
            err || notice
              ? h(
                  'div',
                  { className: NS + '-c-alert ' + (err ? 'err' : 'ok') },
                  h('span', { style: { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' } }, err || notice),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: NS + '-c-alert-x',
                      onClick: () => (err ? setErr('') : setNotice('')),
                      title: '关闭',
                    },
                    '×',
                  ),
                )
              : null;

          const stats = h(
            'section',
            { className: NS + '-c-stats' },
            h(CStat, { k: '今日花费', v: cMoney(today), hint: bots.length + ' 个 Bot 合计' }),
            h(CStat, { k: 'Bot 总数', v: String(bots.length), unit: '个', hint: pending ? pending + ' 个在等你' : '暂无待处理' }),
            h(CStat, { k: '待你处理', v: String(pending), unit: '项', hint: pending ? '确认 / 阻塞 / 接续' : '一切都在自动推进' }),
            h(CStat, {
              k: '调度心跳',
              v: hbMin == null ? '—' : String(hbMin),
              unit: hbMin == null ? '' : '分钟前',
              hint: hb?.isStale ? '可能已休眠' : '后台每 30 秒检查一次',
            }),
          );

          const botsView = selected
            ? h(
                'div',
                { className: NS + '-c-ws' },
                h(BotRail, {
                  bots,
                  selectedId: selected.id,
                  onSelect: (id) => {
                    setSel(id);
                    setDetailView(false);
                  },
                  onCreate: () => setForm({ kind: 'createBot' }),
                }),
                h('section', null, h(BotOverview, {
                  bot: selected,
                  detail: detail && detail.bot?.id === selected.id ? detail : null,
                  act,
                  busy,
                  onDetail: () => setDetailView(true),
                  onForm: setForm,
                  onOpenRun: setOpenRun,
                })),
              )
            : h(
                CCard,
                null,
                h(CCardHead, { title: '开始' }),
                h(
                  'div',
                  { className: NS + '-c-card-body' },
                  h(
                    'div',
                    { className: NS + '-c-empty' },
                    h('p', null, '还没有 Bot。Bot 是一个常驻的 AI 同事：有自己的目标、记忆和工作区；执行前会打快照，随时能回滚。'),
                    h(CBtn, { kind: 'primary', onClick: () => setForm({ kind: 'createBot' }) }, '新建 Bot'),
                  ),
                ),
              );

          const detailPane = selected
            ? h(
                'div',
                { className: NS + '-c-split' },
                h(BotRail, {
                  bots,
                  selectedId: selected.id,
                  onSelect: (id) => {
                    setSel(id);
                    setDetail(null);
                  },
                  onCreate: () => setForm({ kind: 'createBot' }),
                  fill: true,
                }),
                h(BotDetailPane, {
                  bot: selected,
                  detail: detail && detail.bot?.id === selected.id ? detail : null,
                  act,
                  busy,
                  onBack: () => setDetailView(false),
                  onForm: setForm,
                  onSaveConfig: saveConfig,
                  onChanged: () => void loadDetail(selected.id),
                  onAllRuns: () => {
                    setDetailView(false);
                    setTab('runs');
                  },
                  onOpenRun: setOpenRun,
                }),
              )
            : null;

          const other =
            tab === 'runs'
              ? h(ConsoleRuns, { bots, busy, onOpenRun: setOpenRun })
              : tab === 'settings'
                ? h(ConsoleSettings, { bots, busy })
                : tab === 'doctor'
                  ? h(ConsoleDoctor)
                  : null;

          return h(
            'div',
            { className: NS + '-c' },
            h(
              'div',
              { className: NS + '-c-page' + (detailView ? ' split' : '') },
              h(
                'div',
                { className: NS + '-c-content' },
                h(
                  'header',
                  { className: NS + '-c-head' },
                  h(
                    'div',
                    { className: NS + '-c-head-left' },
                    h('div', { className: NS + '-c-mark' }, h(IconBot, { size: 18 })),
                    h(
                      'div',
                      null,
                      h('h1', { className: NS + '-c-title' }, 'dsh-bot'),
                      h('p', { className: NS + '-c-sub' }, '常驻 AI 队友 · 记得住、守得住、收得回'),
                    ),
                  ),
                  h(
                    'div',
                    { className: NS + '-c-head-actions' },
                    h(
                      CBtn,
                      {
                        kind: 'ghost',
                        icon: h(IconRefresh, { size: 14, spinning: busy }),
                        onClick: () => void refresh(),
                        disabled: busy,
                      },
                      '刷新',
                    ),
                    h(
                      CBtn,
                      {
                        kind: 'primary',
                        icon: h(
                          'svg',
                          { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
                          h('path', {
                            d: 'M12 5v14M5 12h14',
                            stroke: 'currentColor',
                            strokeWidth: 1.8,
                            strokeLinecap: 'round',
                          }),
                        ),
                        onClick: () => setForm({ kind: 'createBot' }),
                      },
                      '新建 Bot',
                    ),
                  ),
                ),
                h(CTabs, {
                  tab,
                  onTab: (id) => {
                    setTab(id);
                    setDetailView(false);
                  },
                  meta: '共 ' + bots.length + ' 个 Bot · 今日 ' + cMoney(today),
                }),
                !detailView && alert ? h('div', { style: { marginTop: 12 } }, alert) : null,
                !detailView && tab === 'bots' ? stats : null,
                tab === 'bots'
                  ? detailView
                    ? detailPane
                    : botsView
                  : h('div', { style: { marginTop: 16 } }, other),
              ),
            ),
            detailView && alert
              ? h('div', { className: NS + '-c-toast ' + (err ? 'err' : 'ok') }, alert)
              : null,
            form
              ? h(
                  'div',
                  {
                    className: NS + '-c-modal',
                    onMouseDown: (e) => {
                      if (e.target === e.currentTarget) setForm(null);
                    },
                  },
                  h(
                    'div',
                    { className: NS + '-c-modal-card' },
                    h(FormPanel, {
                      form,
                      busy,
                      onClose: () => setForm(null),
                      onSubmit: (kind, extra) => {
                        const target =
                          bots.find((x) => x.id === form.botId) ||
                          { id: form.botId, name: form.botName, model: {} };
                        setForm(null);
                        void act(kind, target, extra);
                      },
                    }),
                  ),
                )
              : null,
            openRun
              ? h(RunDetailModal, { run: openRun, onClose: () => setOpenRun(null) })
              : null,
          );
        }
        /** 主面板页：点侧边栏图标后，右侧显示的内容（设置 + 诊断） */
        function BotPanelPage() {
          try {
            return h(BotConsole, null);
          } catch (e) {
            report('main-panel-render-error', String(e?.message ?? e));
            return null;
          }
        }

        /** 首次运行询问：是否在侧边栏显示入口（只问一次） */
        function SidebarEntryPrompt() {
          const [show, setShow] = React.useState(() => {
            try {
              return !localStorage.getItem('dsh-bot:sidebarPrompted');
            } catch {
              return false;
            }
          });
          if (!show) return null;
          const choose = (enabled) => {
            try {
              localStorage.setItem('dsh-bot:sidebarPrompted', '1');
            } catch {
              /* 忽略 */
            }
            setShow(false);
            try {
              sidebarController.apply(enabled);
            } catch {
              /* 注册失败不影响保存 */
            }
            try {
              void fetch('/_dsh-bot/settings', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ settings: { sidebarEntry: enabled } }),
              }).catch(() => {});
            } catch {
              /* 忽略 */
            }
          };
          return h(
            'div',
            {
              style: {
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'rgba(0, 0, 0, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT,
              },
            },
            h(
              'div',
              {
                style: {
                  width: 380,
                  background: BG_L2,
                  border: `1px solid ${BORDER_L1}`,
                  borderRadius: R_LG,
                  padding: '16px 18px',
                  color: LABEL_1,
                  boxShadow: 'var(--dsw-shadow-lv3)',
                },
              },
              h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '在侧边栏显示 Bot 入口？'),
              h(
                'div',
                { style: { fontSize: 11, color: LABEL_3, lineHeight: 1.7, marginBottom: 12 } },
                '开启后左侧边栏会出现 dsh-bot 图标，点一下就在右侧打开 Bot 设置页。之后可在「设置 → Bot → 界面」里随时关闭。',
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
                h(Btn, { onClick: () => choose(false) }, '先不显示'),
                h(Btn, { kind: 'primary', onClick: () => choose(true) }, '显示（推荐）'),
              ),
            ),
          );
        }

        function BotSettingsSection() {
          try {


            // 0.3.8：官方设置页的 Bot 分区与主页面共用同一套组件，
            //   消除两套 UI 的行为漂移（旧版「清空记录」只清第一个 Bot，新版清全部）。
            return h(
              'div',
              { className: NS + '-c-vars', style: { padding: '4px 0 16px', fontFamily: FONT, color: LABEL_1, maxWidth: 900 } },
              h(ConsoleSettings, { bots: [], busy: false }),
              h('div', { style: { height: 12 } }),
              h(ConsoleDoctor, null),
            );
          } catch (e) {
            report('settings-section-render-error', String(e?.message ?? e));
            return null;
          }
        }

        // v0.3.9 刀1：快捷条取代旧完整面板；「管理中心」走 ctx.layout.selectPanel
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            { name: 'conversation.input.dock', id: 'dsh-bot', order: 20 },
            () => h(DockBar, { ctx, onOpenConsole: () => openConsole(ctx) }),
          ),
        );

        // ⭐ 注册到 DSH 官方设置页（settings.section）
        //
        // 之前我判断「DSH 没有通用 settings slot」，那是错的——
        // 官方确实有 `settings.section`，第三方插件（如壁纸引擎）就在用：
        //
        //   ctx.slots.inject("settings.section", () =>
        //     ctx.slots.register(
        //       { name: "settings.section", id: "wallpaper-engine",
        //         order: 500, label: () => "壁纸引擎" },
        //       () => React.createElement(Section),
        //     ))
        //
        // 契约：只收 id / order / label（图标由官方 shell 按 id 硬编码兜底齿轮）。
        //
        // ⚠️ 这一段必须**完全隔离**：
        //   · 老版本宿主没有这个座位 → inject 回调不执行，正常
        //   · 新宿主有但契约不同 → 抛错也不能影响下面的 report
        //   · 组件本身渲染失败 → 已在 BotSettingsSection 内部 try/catch
        // 所以用独立的 try/catch 包住，且不改变任何后续控制流。
        try {
          if (ctx?.slots?.inject) {
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'dsh-bot',
                  order: 600,
                  label: () => 'Bot',
                },
                BotSettingsSection,
              ),
            );
            report('ok', 'settings.section registered');
          } else {
            report('settings-section-skip', 'ctx.slots.inject 不可用');
          }
        } catch (e) {
          // 注册失败只影响"设置页里没有 Bot 分区"，
          // 但绝不能让它把 client 的激活状态搞坏
          report('settings-section-error', String(e?.message ?? e));
        }

