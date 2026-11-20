        // ============================================================
        // 设置页
        //
        // DSH 没有通用的 settings slot（官方插件都挂在对话区），
        // 所以做成面板内的一个独立视图，从头部齿轮进入。
        //
        // 分组遵循「改这个是为了什么」而不是「技术上属于哪类」：
        //   通知（什么时候打扰我）/ 模型（用啥干活）/ 预算（能花多少）
        //   目标（怎么推进）/ 高级（省钱与安全）/ 数据（清记录）
        // ============================================================

        /** 一行开关 */
        function ToggleRow({ label, hint, value, onChange }) {
          return h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, color: LABEL_1 } }, label),
              hint
                ? h(
                    'div',
                    { style: { fontSize: 10, color: LABEL_3, marginTop: 2 } },
                    hint,
                  )
                : null,
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: () => onChange(!value),
                style: {
                  width: 36,
                  height: 20,
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  background: value ? BRAND : BORDER_L2,
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background .15s ease',
                },
                'aria-pressed': value,
              },
              h('span', {
                style: {
                  position: 'absolute',
                  top: 2,
                  left: value ? 18 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: LABEL_FG,
                  transition: 'left .15s ease',
                },
              }),
            ),
          );
        }

        /** 一行数字/文本输入 */
        function FieldRow({ label, hint, value, onChange, placeholder, width }) {
          return h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, color: LABEL_1 } }, label),
              hint
                ? h(
                    'div',
                    { style: { fontSize: 10, color: LABEL_3, marginTop: 2 } },
                    hint,
                  )
                : null,
            ),
            h(
              'div',
              { style: { width: width ?? 120, flexShrink: 0 } },
              h(Input, { value, onChange, placeholder }),
            ),
          );
        }

        /**
         * 最近运行列表（设置页「最近运行」组）。
         *
         * 花费透明是硬要求：每一轮必须能回答「谁在跑、花了多少、
         * 钱花在哪」。三态展示沿用 fmtCost 的契约：
         *   exact=付费（显示金额）/ free=免费 / unknown=无价目数据。
         *
         * 两种形态（用户可切换，偏好存 localStorage）：
         *   compact = 固定高度内部滚动（约 6 条记录的高度）
         *   paged   = 分页器（每页 5 条，页面干净）
         */
        const RUNS_MODE_KEY = 'dsh-bot:runsMode';
        const RUNS_PAGE_SIZE = 5;
        // compact 形态固定高度：行高约 44px，6 行 + 边距
        const RUNS_COMPACT_HEIGHT = 6 * 44 + 8;



        /** 单轮运行详情弹窗 */
        function RunDetailModal({ run, onClose }) {
          const u = run.usage ?? {};
          const tokenRows = [
            ['输入', u.inputTokens],
            ['输出', u.outputTokens],
            ['缓存命中', u.cacheHitTokens],
            ['缓存未命中', u.cacheMissTokens],
            ['思考', u.reasoningTokens],
          ];
          const totalTokens = tokenRows.reduce((s, [, v]) => s + (Number(v) || 0), 0);
          const costLabel = fmtCost(u);
          const costTone =
            u.costKind === 'free' ? OK : u.costKind === 'unknown' ? WARN : LABEL_1;
          const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—');
          // ⭐ 0.3.8 修正：不同入口的 run 数据形态不同
          //   · /runs/list 的 run 有 outputPreview / botName
          //   · /bot 的 run 是原始记录，两者都没有
          //   统一在这里派生，弹窗不再依赖调用方补字段。
          const stepList = Array.isArray(run.steps) ? run.steps : [];
          const stepCount = stepList.length;
          const llmOutput = (() => {
            if (run.outputPreview) return run.outputPreview;
            for (let i = stepList.length - 1; i >= 0; i--) {
              const s = stepList[i];
              if (s?.kind === 'llm' && s?.result?.output) return String(s.result.output);
            }
            return '';
          })();
          const assessment = run.goalAssessment;
          const title = '运行详情 · ' + (run.botName ?? '本轮');
          return h(
            'div',
            {
              onClick: onClose,
              style: {
                position: 'fixed', inset: 0, zIndex: 10000,
                background: 'rgba(0,0,0,.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: FONT,
              },
            },
            h(
              'div',
              {
                onClick: (e) => e.stopPropagation(),
                style: {
                  width: 520, maxHeight: '80vh', overflow: 'auto',
                  background: BG_L3, borderRadius: R_LG, boxShadow: SHADOW,
                  padding: 16,
                },
              },
              // ---- 头部 ----
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
                h('div', { style: { fontSize: 14, fontWeight: 600, color: LABEL_1, flex: 1 } }, title),
                h(Badge, { tone: run.dryRun ? 'brand' : 'neutral' }, run.dryRun ? '演习' : '真实执行'),
                h(
                  'button',
                  { onClick: onClose, type: 'button', style: { border: 'none', background: 'transparent', cursor: 'pointer', color: LABEL_2, fontSize: 14 } },
                  '✕',
                ),
              ),
              // ---- 概要 ----
              h(
                'div',
                { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 } },
                ...[
                  ['状态', run.status],
                  ['触发方式', run.trigger],
                  ['开始', fmtTime(run.startedAt)],
                  ['结束', fmtTime(run.endedAt)],
                  ['步骤数', String(stepCount)],
                  ['运行 ID', run.id],
                ].map(([k, v]) =>
                  h(
                    'div',
                    { key: k, style: { padding: '6px 8px', background: BG_L2 || BG_L3, borderRadius: R_SM } },
                    h('div', { style: { fontSize: 10, color: LABEL_3 } }, k),
                    h('div', { style: { fontSize: 12, color: LABEL_1, wordBreak: 'break-all' } }, v),
                  ),
                ),
              ),
              // ---- 费用（透明化核心块） ----
              h(
                'div',
                { style: { padding: 10, borderRadius: R_MD, border: `1px solid ${BORDER_L1}`, marginBottom: 12 } },
                h('div', { style: { fontSize: 11, fontWeight: 600, color: LABEL_2, marginBottom: 6 } }, '费用与渠道'),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
                  h('div', { style: { fontSize: 20, fontWeight: 600, color: costTone } }, costLabel),
                  h(
                    'span',
                    { style: { fontSize: 11, color: u.costKind === 'free' ? OK : u.costKind === 'unknown' ? WARN : LABEL_3 } },
                    u.costKind === 'free'
                      ? '免费渠道（订阅内/免费模型，未产生 API 计费）'
                      : u.costKind === 'unknown'
                        ? '渠道无价目数据，无法计费'
                        : '付费渠道（按 token 计价）',
                  ),
                ),
                u.costNote ? h('div', { style: { fontSize: 10, color: LABEL_3, marginBottom: 4 } }, u.costNote) : null,
                h(
                  'div',
                  { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 } },
                  ...tokenRows.map(([k, v]) =>
                    h(
                      'div',
                      { key: k, style: { textAlign: 'center', padding: '4px 2px', background: BG_L3, borderRadius: R_XS } },
                      h('div', { style: { fontSize: 10, color: LABEL_3 } }, k),
                      h('div', { style: { fontSize: 12, color: LABEL_1 } }, String(Number(v) || 0)),
                    ),
                  ),
                ),
                h('div', { style: { fontSize: 10, color: LABEL_3, marginTop: 6 } }, `合计 ${totalTokens} tokens（含缓存与思考）`),
              ),
              // ---- 模型兜底说明 ----
              run.modelFallback
                ? h(
                    'div',
                    { style: { fontSize: 11, color: WARN, padding: '6px 8px', borderRadius: R_SM, background: BG_L3, marginBottom: 12 } },
                    `⚠ ${run.modelFallback}`,
                  )
                : null,
              // ---- 错误 ----
              run.error
                ? h(
                    'div',
                    { style: { fontSize: 11, color: ERR, padding: '6px 8px', borderRadius: R_SM, background: BG_L3, marginBottom: 12 } },
                    `${run.error.code}: ${run.error.message}`,
                  )
                : null,
              // ---- 工具调用 ----
              run.toolSteps?.length
                ? h(
                    'div',
                    { style: { marginBottom: 12 } },
                    h('div', { style: { fontSize: 11, fontWeight: 600, color: LABEL_2, marginBottom: 4 } }, `工具调用（${run.toolSteps.length} 次）`),
                    ...run.toolSteps.map((t, i) =>
                      h(
                        'div',
                        { key: i, style: { display: 'flex', gap: 8, fontSize: 11, padding: '3px 0', color: LABEL_1 } },
                        h('span', { style: { color: LABEL_3, width: 60, flexShrink: 0 } }, `${t.durationMs ?? 0}ms`),
                        h('span', { style: { fontFamily: 'monospace' } }, t.name),
                        t.blocked ? h(Badge, { tone: 'warn' }, '拦截') : null,
                        t.error ? h('span', { style: { color: ERR, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.error.message ?? '') : null,
                      ),
                    ),
                  )
                : null,
              // ---- 运行输出（全文可滚动；markdown 以等宽渲染；文件产物给路径提示） ----
              (() => {
                const out = llmOutput;
                const chars = out.length;
                // 文件产物识别：输出中引用的本地文件路径（Windows 盘符 / ~/.dsh 常见落点）
                const FILE_EXT_RE = new RegExp("\\.(md|txt|json|ya?ml|log|csv|html?|tgz|zip|png|jpe?g)$", "i");
                const FILE_PATH_RE = new RegExp("([A-Za-z]:\\\\[^\\s\"]+\\.[a-z0-9]{2,4})|(~\\/\\.dsh\\/[^\\s\"]+\\.[a-z0-9]{2,4})", "gi");
                const pathMatches = [];
                for (const p of out.match(FILE_PATH_RE) || []) {
                  if (FILE_EXT_RE.test(p) && !pathMatches.includes(p)) pathMatches.push(p);
                }
                const truncated = out.includes('[已截断') || chars >= 50_000;
                return h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 } },
                    h('div', { style: { fontSize: 11, fontWeight: 600, color: LABEL_2 } }, '运行输出'),
                    h(
                      'div',
                      { style: { fontSize: 10, color: LABEL_3, flex: 1 } },
                      chars ? `${chars.toLocaleString()} 字${truncated ? '（超长已截断，完整全文见 runs 归档 JSON）' : ''}` : '',
                    ),
                    chars
                      ? h(
                          'button',
                          {
                            type: 'button',
                            onClick: () => {
                              try { navigator.clipboard.writeText(out); } catch {}
                            },
                            style: {
                              border: 'none', background: 'transparent', cursor: 'pointer',
                              fontSize: 10, color: BRAND, textDecoration: 'underline',
                            },
                          },
                          '复制全文',
                        )
                      : null,
                  ),
                  // 文件产物提示：报告落盘/导出的路径让用户找得到
                  pathMatches.length
                    ? h(
                        'div',
                        {
                          style: {
                            fontSize: 10, color: BRAND, padding: '5px 8px', marginBottom: 4,
                            borderRadius: R_SM, background: BG_L3, lineHeight: 1.7,
                          },
                        },
                        '📎 本轮提到的文件产物：',
                        ...pathMatches.slice(0, 5).map((p, i) =>
                          h(
                            'div',
                            { key: i, style: { fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' } },
                            p,
                          ),
                        ),
                      )
                    : null,
                  h(
                    'div',
                    {
                      style: {
                        fontSize: 11, color: LABEL_1, padding: 8, borderRadius: R_SM,
                        background: BG_L3, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        maxHeight: 260, overflow: 'auto', lineHeight: 1.6,
                      },
                    },
                    out || '（无文本输出——若本轮产出为文件，见上方路径提示或运行归档）',
                  ),
                );
              })(),
              // ---- 目标评估（0.3.8：这轮对目标产生了什么影响） ----
              assessment
                ? h(
                    'div',
                    { style: { padding: 10, borderRadius: R_MD, border: `1px solid ${BORDER_L1}`, marginTop: 12 } },
                    h('div', { style: { fontSize: 11, fontWeight: 600, color: LABEL_2, marginBottom: 6 } }, '目标评估'),
                    h(
                      'div',
                      { style: { fontSize: 12, lineHeight: 1.7, color: LABEL_1, whiteSpace: 'pre-wrap' } },
                      assessment.note || '（本轮没有留下评估说明）',
                    ),
                    assessment.nextStep
                      ? h(
                          'div',
                          { style: { fontSize: 11, lineHeight: 1.7, color: LABEL_3, marginTop: 6 } },
                          '下一步：' + assessment.nextStep,
                        )
                      : null,
                    assessment.needsHuman
                      ? h('div', { style: { fontSize: 11, color: WARN, marginTop: 6 } }, '⭐ 这轮认为需要你介入')
                      : null,
                  )
                : null,
            ),
          );
        }




        //
        // 核心洞察：用户说"挤成一坨，不可阅览"，本质不是排版问题，
        // 而是**该显示的和不该显示的都在显示**。
        //
        // 所以这里换个思路：不再"有什么数据画什么"，
        // 而是先判断 Bot 现在处于什么状态，只画那个状态需要的东西。
        //
        //   ┌─────────────┬──────────────────────────────┐
        //   │ Bot 状态     │ 需要显示                      │
        //   ├─────────────┼──────────────────────────────┤
        //   │ 没有目标     │ 一行提示 + [设目标]           │
        //   │ 待你确认     │ 目标 + 确认/驳回（大按钮）     │
        //   │ 卡住了       │ 目标 + 原因 + 怎么处理         │
        //   │ 上次失败     │ 目标 + 失败原因 + [看看]       │
        //   │ 正常         │ 目标 + 一行最近结果            │
        //   │ 空闲         │ 目标 + "一切都好"             │
        //   └─────────────┴──────────────────────────────┘
        //
        // 其余内容（记忆、例行、模型、预算、快照）收进「更多」。
        // ============================================================
