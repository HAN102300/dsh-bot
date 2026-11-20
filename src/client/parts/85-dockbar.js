
        // ============================================================
        // v0.3.9 dock 快捷条（刀1）
        //
        // 旧 BotDock 完整面板已删除（能力归属 0.3.8 控制台，见 PLAN-v0.3.9.md）。
        // 现在对话输入框上方只有一条快捷条：
        //   [Bot 切换] [状态] [今日花费·当前Bot] —— [模型快切] [执行] [管理中心] [收起]
        // 决策（2026-11-20）：
        //   · 会话未关联 Bot → chip 显示「未关联」，点开菜单选择即关联（记 localStorage）
        //   · 花费只显示当前 Bot，全队合计在控制台
        //   · 收起 = 一行胶囊（Bot 名 + 状态点 + 模型 pill + 展开）
        //   · 模型快切 pill 两击换模型；完整编辑在详情页配置卡
        // ============================================================

        const DOCK_COLLAPSE_KEY = NS + ':dockCollapsed';
        const DOCK_BOT_KEY = NS + ':dockBotId';

        /** localStorage 安全读写 */
        const dockLs = {
          get(k) { try { return localStorage.getItem(k); } catch { return null; } },
          set(k, v) { try { localStorage.setItem(k, v); } catch {} },
        };

        /** 状态点样式（成功/失败/部分/运行中/从未） */
        function dockStatOf(bot, running, runningDry = true) {
          if (running) return { cls: NS + '-db-stat run', label: runningDry ? '演习中' : '真跑中' };
          if (!bot) return { cls: NS + '-db-stat idle', label: '未关联' };
          const s = bot.lastRunStatus;
          if (!s) return { cls: NS + '-db-stat idle', label: '从未运行' };
          if (s === 'success') return { cls: NS + '-db-stat ok', label: '成功 · ' + fmtAgo(bot.lastRunAt) };
          if (s === 'failed') return { cls: NS + '-db-stat err', label: '失败 · ' + fmtAgo(bot.lastRunAt) };
          if (s === 'partial') return { cls: NS + '-db-stat err', label: '部分 · ' + fmtAgo(bot.lastRunAt) };
          return { cls: NS + '-db-stat', label: statusText(s) + ' · ' + fmtAgo(bot.lastRunAt) };
        }

        /** 机器人形小图标（复用侧边栏字形） */
        /** SVG 雪佛龙（下拉 / 上收），不再用字符 ▾ ⌃（不同字体下渲染丑陋） */
        function ChevDown({ size = 10 }) {
          return h('svg', { width: size, height: size, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' },
            h('path', { d: 'M2.5 4.5L6 8l3.5-3.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
        }
        function ChevUp({ size = 10 }) {
          return h('svg', { width: size, height: size, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' },
            h('path', { d: 'M2.5 7.5L6 4l3.5 3.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
        }

        function DockBotMark() {
          return h('span', { className: 'mark' }, h(BotSidebarIcon, { size: 10 }));
        }

        /** toast：短暂提示后消失（旧宿主没有 selectPanel 时的降级引导） */
        function DockToast({ text }) {
          if (!text) return null; // 空 toast 不渲染（否则输入框上方会多出一个无意义的小方块）
          return portal(h('div', { className: NS + '-db-toast' }, text));
        }

        /**
         * 打开管理中心。优先 ctx.layout.selectPanel('dsh-bot')（rc.5）；
         * 失败（旧宿主 / 未注册）→ toast 引导走侧边栏图标。
         */
        function openConsole(ctx) {
          try {
            if (ctx?.layout && typeof ctx.layout.selectPanel === 'function') {
              ctx.layout.selectPanel('dsh-bot');
              return true;
            }
          } catch (e) {
            report('select-panel-error', String(e?.message ?? e));
          }
          return false;
        }

        /**
         * DockBar —— 快捷条本体。
         * 数据源：/overview（Bot 列表 + 状态 + 今日花费，10s 轮询 + 可见性感知）。
         */
        /**
         * 模型快切菜单：provider 列表 → 模型列表，两击完成切换。
         */
        /**
         * 模型快切菜单：provider 列表 → 模型列表，两击完成切换。
         * 布局：head（固定）/ list（滚动）/ foot（固定）—— provider 有 14 个时也不会顶出屏幕。
         */
        function ModelMenu({ shown, models, pickProvider, setPickProvider, setModel, openConsoleSafe }) {
          const modelsFor = (pickProvider
            ? ((models ?? []).find((x) => x && x.provider === pickProvider)?.models ?? [])
            : []);
          const providerList = (models ?? []).filter((x) => x && typeof x.provider === 'string');
          return h('div', { className: NS + '-db-pop right' },
            h('div', { className: 'head' },
              !pickProvider
                ? '切换到哪个 provider？（' + providerList.length + '）'
                : pickProvider + ' · ' + modelsFor.length + ' 个模型',
            ),
            h('div', { className: 'list' },
              !pickProvider
                ? providerList.map((x) =>
                    h('button',
                      {
                        key: x.provider,
                        className: 'item' + (x.provider === shown.model?.provider ? ' active' : ''),
                        onClick: () => setPickProvider(x.provider),
                      },
                      h('span', { className: 'nm' }, x.provider),
                      h('span', { className: 'meta' }, ((x.models ?? []).length) + ' 个'),
                      h('span', { className: 'chev' }, h(ChevDown, { size: 9 })),
                    ),
                  )
                : [
                    ...modelsFor.map((m) =>
                      h('button',
                        {
                          key: m,
                          className: 'item' + (m === shown.model?.model && pickProvider === shown.model?.provider ? ' active' : ''),
                          onClick: () => void setModel(pickProvider, m),
                        },
                        h('span', { className: 'nm' }, m),
                        m === shown.model?.model && pickProvider === shown.model?.provider
                          ? h('span', { className: 'meta' }, '当前')
                          : null,
                      ),
                    ),
                    modelsFor.length === 0
                      ? h('div', { className: 'desc' }, '这个 provider 没有返回模型列表，可在详情页手动填写。')
                      : null,
                    h('button', { className: 'item back', onClick: () => setPickProvider(null) },
                      h('span', { className: 'nm' }, '← 返回 provider'),
                    ),
                  ],
            ),
            h('div', { className: 'foot' },
              h('button', { className: 'mi', onClick: openConsoleSafe }, '完整编辑在详情页 →'),
            ),
          );
        }

        function DockBar({ ctx, onOpenConsole }) {
          const [bots, setBots] = React.useState(null); // null = 加载中
          const [menuOpen, setMenuOpen] = React.useState(false);
          const [runPop, setRunPop] = React.useState(false);
          const [modelPop, setModelPop] = React.useState(false);
          const [models, setModels] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [runningBot, setRunningBot] = React.useState(null); // 正在演习/真跑的 botId
          const [toast, setToast] = React.useState('');
          const [collapsed, setCollapsed] = React.useState(() => dockLs.get(DOCK_COLLAPSE_KEY) === '1');
          const [assocId, setAssocId] = React.useState(() => dockLs.get(DOCK_BOT_KEY) || '');
          const rootRef = React.useRef(null);

          // 点击空白处关闭弹层
          React.useEffect(() => {
            if (!menuOpen && !runPop && !modelPop) return undefined;
            const close = (e) => {
              if (rootRef.current && !rootRef.current.contains(e.target)) {
                setMenuOpen(false); setRunPop(false); setModelPop(false);
              }
            };
            document.addEventListener('mousedown', close);
            return () => document.removeEventListener('mousedown', close);
          }, [menuOpen, runPop, modelPop]);

          // 轮询 overview（10s）；页面隐藏时不拉
          React.useEffect(() => {
            let stop = false;
            let timer = null;
            const tick = async () => {
              if (stop || document.hidden) return;
              try {
                const r = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
                const j = await r.json();
                if (!stop && j?.ok) setBots(Array.isArray(j.value?.bots) ? j.value.bots : []);
              } catch { /* 下轮再试 */ }
            };
            void tick();
            timer = setInterval(tick, 10_000);
            return () => { stop = true; if (timer) clearInterval(timer); };
          }, []);

          // 执行后的运行状态跟踪：30s 内每 2s 查最近一轮
          React.useEffect(() => {
            if (!runningBot) return undefined;
            const t0 = Date.now();
            const timer = setInterval(async () => {
              try {
                const r = await fetch('/_dsh-bot/runs/list?botId=' + encodeURIComponent(runningBot) + '&limit=1', { headers: { accept: 'application/json' } });
                const j = await r.json();
                const run = j?.value?.runs?.[0];
                const started = run && Date.parse(run.startedAt || '') > t0 - 2000;
                const done = run && run.status && run.status !== 'running' && started && Date.parse(run.endedAt || '') > t0;
                if (done) {
                  setRunningBot(null);
                  setToast((run.status === 'success' ? '演习完成' : statusText(run.status)) + ' · 详情见运行记录');
                  setTimeout(() => setToast(''), 4000);
                } else if (Date.now() - t0 > 120_000) {
                  setRunningBot(null);
                  setToast('仍在运行，可去运行记录查看进度');
                  setTimeout(() => setToast(''), 4000);
                }
              } catch { /* 下轮再试 */ }
            }, 2000);
            return () => clearInterval(timer);
          }, [runningBot]);

          // ⚠️ 防御：overview 异常时 bots 里可能出现 null/非对象条目，任何一次 map 抛错都会让整条快捷条崩掉
          const list = (Array.isArray(bots) ? bots : []).filter((b) => b && typeof b === 'object');
          const assoc = list.find((b) => b.id === assocId) || null;
          const shown = assoc || list[0] || null;

          /** 关联 Bot（或切换） */
          const pickBot = (b) => {
            setAssocId(b.id);
            dockLs.set(DOCK_BOT_KEY, b.id);
            setMenuOpen(false);
          };

          /** 执行（dryRun 默认 true） */
          const doRun = async (dryRun) => {
            if (!shown || busy) return;
            setBusy(true);
            setRunPop(false);
            try {
              const r = await fetch('/_dsh-bot/run', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // confirm: true —— 用户已在上一步的确认浮层里显式点过（演习同样需要，
                // 这是 /run 路由的既有安全设计：任何执行都必须带显式确认）
                body: JSON.stringify({ botId: shown.id, dryRun, confirm: true }),
              });
              const j = await r.json();
              if (j?.ok) {
                setRunningDry(dryRun);
                setRunningBot(shown.id);
                setToast(dryRun ? '演习已启动' : '真实执行已启动');
              } else {
                setToast('启动失败：' + (j?.message || '未知错误'));
              }
            } catch (e) {
              setToast('启动失败：' + String(e?.message ?? e));
            } finally {
              setBusy(false);
              setTimeout(() => setToast(''), 4000);
            }
          };

          /** 拉模型列表（首次展开模型菜单） */
          const ensureModels = async () => {
            if (models) return;
            try {
              const r = await fetch('/_dsh-bot/models', { headers: { accept: 'application/json' } });
              const j = await r.json();
              if (j?.ok) setModels(j.value?.available ?? []);
            } catch { setModels([]); }
          };

          /** 两击换模型：选 provider → 选 model → POST /bot/model */
          const [pickProvider, setPickProvider] = React.useState(null);
          /** 当前这一轮是演习还是真跑（状态条文案要区分，否则用户以为演习在跑） */
          const [runningDry, setRunningDry] = React.useState(true);
          const setModel = async (provider, model) => {
            if (!shown) return;
            setModelPop(false); setPickProvider(null);
            try {
              const r = await fetch('/_dsh-bot/bot/model', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ botId: shown.id, provider, model }),
              });
              const j = await r.json();
              setToast(j?.ok ? '模型已切到 ' + provider + ' / ' + model : '切换失败：' + (j?.message || '?'));
              // 刷新列表（overview 里的 model 字段）
              try {
                const r2 = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
                const j2 = await r2.json();
                if (j2?.ok) setBots(Array.isArray(j2.value?.bots) ? j2.value.bots : []);
              } catch {}
            } catch (e) {
              setToast('切换失败：' + String(e?.message ?? e));
            }
            setTimeout(() => setToast(''), 4000);
          };

          const toggleCollapse = () => {
            setCollapsed((prev) => {
              dockLs.set(DOCK_COLLAPSE_KEY, prev ? '0' : '1');
              return !prev;
            });
          };

          const openConsoleSafe = () => {
            if (!onOpenConsole()) setToast('请在左侧边栏点 dsh-bot 图标打开管理中心');
            setTimeout(() => setToast(''), 4000);
          };

          // ============================================================
          const stat = dockStatOf(shown, !!runningBot, runningDry);
          const running = runningBot != null;

          // 渲染：收起态与展开态共用同一套弹层，只有行内容不同。
          // 每个控件各司其职（不再"全部跳管理中心"）：
          //   Bot chip  → Bot 切换菜单
          //   状态 chip → 管理中心（看最近运行）
          //   模型 pill → 模型快切菜单
          //   箭头      → 收起 / 展开
          // ============================================================
          const toastEl = toast ? portal(h('div', { className: NS + '-db-toast' }, toast)) : null;

          const botMenuEl = menuOpen
            ? h('div', { className: NS + '-db-pop', style: { left: 0 } },
                h('div', { className: 'head' }, '全部 Bot（' + list.length + '）'),
                h('div', { className: 'list' },
                  ...list.map((b) => {
                    const st = b.lastRunStatus === 'success' ? 'g' : b.lastRunStatus === 'failed' ? 'r' : '';
                    return h('button', {
                      key: b.id,
                      className: 'item' + (shown?.id === b.id ? ' active' : ''),
                      onClick: () => pickBot(b),
                    },
                      h('span', { className: 'nm' }, b.name),
                      h('span', { className: 'meta' },
                        h('span', null, fmtCny(b.todayCostCny)),
                        h('span', { className: 'dot ' + st }),
                      ),
                    );
                  }),
                  list.length === 0 ? h('div', { className: 'desc' }, '还没有 Bot') : null,
                ),
                h('div', { className: 'foot' },
                  h('button', { className: 'mi', onClick: openConsoleSafe }, '＋ 新建 Bot'),
                  h('button', { className: 'mi', onClick: openConsoleSafe }, '管理中心'),
                ),
              )
            : null;

          const modelMenuEl = modelPop && shown
            ? h(ModelMenu, { shown, models, pickProvider, setPickProvider, setModel, openConsoleSafe })
            : null;

          const runConfirmEl = runPop && shown && !collapsed
            ? h('div', { className: NS + '-db-pop right' },
                h('div', { className: 'head' }, '演习「' + shown.name + '」的当前目标？'),
                h('div', { className: 'desc' },
                  '演习完整走一遍流程，', h('b', null, '不写任何文件、不花钱'), '；输出满意后可在运行详情里放行。真跑会实际执行。',
                ),
                h('div', { className: 'acts' },
                  h('button', { className: NS + '-db-btn', disabled: busy, onClick: () => void doRun(false) }, '真跑一次'),
                  h('button', { className: NS + '-db-btn primary', disabled: busy, onClick: () => void doRun(true) }, '演习一次'),
                ),
              )
            : null;

          /** 花费（收起态展示；展开态腾出空间给模型与操作） */
          const costEl = shown
            ? h('span', { className: NS + '-db-cost' },
                h('span', { className: 'txt' },
                  h('b', null, fmtCny(shown.todayCostCny)),
                  running ? '' : h('span', { className: 'lim' }, ' / ' + fmtCny(shown.budget?.dailyCny)),
                ),
              )
            : null;

          /** 模型 pill（两态共用，点击开模型菜单） */
          const modelEl = shown
            ? h('button', {
                className: NS + '-db-model',
                onClick: () => { setModelPop(!modelPop); setMenuOpen(false); setRunPop(false); void ensureModels(); },
                title: '当前模型：' + (shown.model?.provider || '?') + ' / ' + (shown.model?.model || '?'),
              },
                h('span', { className: 'txt' }, shown.model?.provider || '?', h('span', { className: 'sep' }, ' / '), shown.model?.model || '?'),
                h(ChevDown, { size: 9 }),
              )
            : null;

          /** Bot chip（两态共用，点击开 Bot 菜单） */
          const botChipEl = h('button', {
            className: NS + '-db-chip',
            onClick: () => { setMenuOpen(!menuOpen); setRunPop(false); setModelPop(false); },
            title: shown ? '当前 Bot：' + shown.name + '（点击切换）' : '未关联 Bot（点击选择）',
          },
            shown ? h(DockBotMark, null) : null,
            h('span', { className: 'nm' }, shown ? shown.name : '未关联'),
            h('span', { className: 'chev' }, h(ChevDown, null)),
          );

          // ---------- 收起态：一行胶囊 ----------
          // 左：身份 + 状态点 / 右：今日花费 + 模型 + 展开
          if (collapsed) {
            return h('div', { className: NS + '-dockbar-wrap' },
              toastEl,
              h('div', {
                className: NS + '-dock ' + NS + '-dockbar ' + NS + '-dockbar-collapsed',
                ref: rootRef,
              },
                h('div', { className: NS + '-dockbar-row' },
                  h('div', { className: NS + '-dockbar-main' },
                    botChipEl,
                    h('button', { className: stat.cls + ' ' + NS + '-db-stat-dotonly', title: '最近一轮：' + stat.label + ' · 点击查看运行记录', onClick: openConsoleSafe },
                      h('span', { className: 'dot' }),
                    ),
                  ),
                  h('div', { className: NS + '-dockbar-actions' },
                    costEl,
                    modelEl,
                    h('button', { className: NS + '-db-chip ' + NS + '-db-iconbtn', onClick: toggleCollapse, title: '展开快捷条' },
                      h(ChevUp, null),
                    ),
                  ),
                ),
                botMenuEl,
                modelMenuEl,
              ),
            );
          }

          // ---------- 展开态 ----------
          return h('div', { className: NS + '-dockbar-wrap' },
            toastEl,
            h('div', { className: NS + '-dock ' + NS + '-dockbar', ref: rootRef },
              h('div', { className: NS + '-dockbar-row' },
                h('div', { className: NS + '-dockbar-main' },
                  botChipEl,
                  h('button', { className: stat.cls, onClick: openConsoleSafe, title: '最近一轮：' + stat.label + ' · 点击查看运行记录' },
                    h('span', { className: 'dot' }),
                    h('span', { className: 'stat-text' }, stat.label),
                  ),
                  h('span', { className: NS + '-db-space' }),
                  modelEl,
                ),
                h('div', { className: NS + '-dockbar-actions' },
                  h('button', { className: NS + '-db-btn primary', disabled: busy || running || !shown, onClick: () => { setRunPop(!runPop); setMenuOpen(false); setModelPop(false); } },
                    running ? (runningDry ? '◐ 演习中' : '◐ 真跑中') : '⚡ 执行',
                  ),
                  h('button', { className: NS + '-db-btn', onClick: openConsoleSafe, title: '打开管理中心' }, '管理中心 →'),
                  h('button', { className: NS + '-db-chip ' + NS + '-db-iconbtn', onClick: toggleCollapse, title: '收起为一行胶囊' }, h(ChevUp, null)),
                ),
              ),
              botMenuEl,
              runConfirmEl,
              modelMenuEl,
            ),
          );
        }

