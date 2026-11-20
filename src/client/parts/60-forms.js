        // ---------- 通用按钮 ----------
        function Btn({ children, onClick, kind = 'ghost', disabled, title, icon }) {
          return h(
            'button',
            {
              className: `${NS}-btn ${NS}-btn-${kind}`,
              onClick,
              disabled,
              title,
              type: 'button',
            },
            icon || null,
            children,
          );
        }

        // ============================================================
        // 内嵌表单
        //
        // ⚠️ 为什么不用 window.prompt / window.confirm：
        //    DSH 跑在 Electron 的渲染进程里，prompt() 被直接禁用
        //    （报 "prompt() is not supported"），confirm() 恒返回 false。
        //    用它们的结果是按钮"点了没反应"或直接红框报错。
        //    所以所有输入都走真正的 DOM 表单。
        // ============================================================

        /** 下拉框样式（与 Input 一致，避免观感割裂） */
        const SELECT_STYLE = {
          flex: 1,
          boxSizing: 'border-box',
          fontFamily: FONT,
          fontSize: 12,
          color: LABEL_1,
          background: BG_L1,
          border: `1px solid ${BORDER_L2}`,
          borderRadius: R_SM,
          padding: '5px 8px',
          outline: 'none',
          cursor: 'pointer',
        };

        function Input({ value, onChange, placeholder, multiline, onEnter, autoFocus }) {
          const base = {
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: FONT,
            fontSize: 12,
            lineHeight: 1.6,
            color: LABEL_1,
            background: BG_L1,
            border: `1px solid ${BORDER_L2}`,
            borderRadius: R_SM,
            padding: '5px 8px',
            outline: 'none',
            resize: 'none',
          };          if (multiline) {
            return h('textarea', {
              style: { ...base, minHeight: 48 },
              value,
              placeholder,
              autoFocus,
              onChange: (e) => onChange(e.target.value),
            });
          }
          return h('input', {
            style: base,
            type: 'text',
            value,
            placeholder,
            autoFocus,
            onChange: (e) => onChange(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && onEnter) onEnter();
            },
          });
        }

        /**
         * 表单容器。
         *
         * 支持三种形态：
         *   · goal      —— 设目标（描述 + 类型）
         *   · reject    —— 驳回意见
         *   · createBot —— 建 Bot（名字 + 职责 + 可选目标）
         */
        function FormPanel({ form, onClose, onSubmit, busy }) {
          const [name, setName] = React.useState('');
          const [role, setRole] = React.useState('');
          const [goal, setGoal] = React.useState('');
          const [note, setNote] = React.useState('');
          const [desc, setDesc] = React.useState('');
          const [type, setType] = React.useState('one-shot');
          // ⭐ 执行节奏：这一栏决定「持续任务」会不会真的自动跑
          const [cadence, setCadence] = React.useState('');
          const [customTime, setCustomTime] = React.useState('09:00');
          // 模型编辑用
          const [provider, setProvider] = React.useState(form.provider ?? '');
          const [modelName, setModelName] = React.useState(form.model ?? '');
          // 真实可用的 provider / model 列表（来自 /_dsh-bot/models）
          const [providerList, setProviderList] = React.useState([]);
          const [modelsLoading, setModelsLoading] = React.useState(true);

          React.useEffect(() => {
            if (form.kind !== 'model') return;
            let alive = true;
            setModelsLoading(true);
            (async () => {
              try {
                const r = await fetch('/_dsh-bot/models', {
                  headers: { accept: 'application/json' },
                });
                const j = await r.json();
                if (alive && j?.ok) setProviderList(j.value?.available ?? []);
              } catch {
                /* 拿不到就退化成手填 */
              } finally {
                if (alive) setModelsLoading(false);
              }
            })();
            return () => {
              alive = false;
            };
          }, [form.kind]);

          const availableProviders = providerList.map((x) => x?.provider).filter(Boolean);
          const modelsForProvider =
            providerList.find((x) => x?.provider === provider)?.models ?? [];

          /** 把选择器状态收敛成最终的 cron */
          const resolvedCadence = () => {
            if (!cadence) return undefined;
            if (cadence === 'custom') return timeToCron(customTime);
            return cadence;
          };

          const submit = () => {
            if (form.kind === 'goal') {
              if (!desc.trim()) return;
              onSubmit('goalSet', {
                description: desc.trim(),
                goalType: type,
                cadence: resolvedCadence(),
              });
            } else if (form.kind === 'unblock') {
              onSubmit('goalUnblock', { note: note.trim() });
            } else if (form.kind === 'giveup') {
              onSubmit('goalGiveup', { note: note.trim() });
            } else if (form.kind === 'reject') {
              onSubmit('goalReject', { note: note.trim() || '还没做完' });
            } else if (form.kind === 'model') {
              if (!provider.trim() || !modelName.trim()) return;
              onSubmit('botModel', {
                provider: provider.trim(),
                model: modelName.trim(),
              });
            } else if (form.kind === 'createBot') {
              if (!name.trim() || !role.trim()) return;
              onSubmit('botCreate', {
                name: name.trim(),
                role: role.trim(),
                goal: goal.trim() || undefined,
                goalType: type,
                cadence: resolvedCadence(),
              });
            }
          };

          const title =
            form.kind === 'goal'
              ? `给「${form.botName}」设目标`
              : form.kind === 'unblock'
                ? '你是怎么解决的？（可选，会记进目标进展）'
                : form.kind === 'giveup'
                  ? '为什么放弃？（会记进目标史）'
                  : form.kind === 'reject'
                    ? '驳回这个目标的理由'
                    : form.kind === 'model'
                      ? `改「${form.botName}」用的模型`
                      : '新建一个 Bot';

          return h(
            'div',
            {
              style: {
                margin: '8px 12px',
                padding: '10px',
                borderRadius: R_SM,
                background: BG_L2,
                border: `1px solid ${BORDER_L2}`,
              },
            },
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  fontWeight: 600,
                  color: LABEL_1,
                  marginBottom: 8,
                },
              },
              title,
            ),

            form.kind === 'createBot'
              ? h(
                  'div',
                  { style: { display: 'flex', gap: 6, marginBottom: 6 } },
                  h('div', { style: { flex: 1 } },
                    h(Input, {
                      value: name,
                      onChange: setName,
                      placeholder: '名字，如「文件管家」',
                      autoFocus: true,
                    }),
                  ),
                  h('div', { style: { flex: 2 } },
                    h(Input, {
                      value: role,
                      onChange: setRole,
                      placeholder: '职责，如「整理下载文件夹」',
                    }),
                  ),
                )
              : null,

            form.kind === 'createBot' || form.kind === 'goal'
              ? h(Input, {
                  value: form.kind === 'goal' ? desc : goal,
                  onChange: form.kind === 'goal' ? setDesc : setGoal,
                  placeholder:
                    form.kind === 'goal'
                      ? '目标，如「整理下载文件夹」'
                      : '目标（可留空，稍后再设）',
                  onEnter: submit,
                  autoFocus: form.kind === 'goal',
                })
              : null,

            form.kind === 'reject' ||
            form.kind === 'unblock' ||
            form.kind === 'giveup'
              ? h(Input, {
                  value: note,
                  onChange: setNote,
                  placeholder:
                    form.kind === 'reject'
                      ? '哪里还没做好？（Bot 会看到这条）'
                      : form.kind === 'unblock'
                        ? '如：已重配 /admin 鉴权'
                        : '如：这个站点已经不维护了',
                  onEnter: submit,
                  autoFocus: true,
                })
              : null,

            // 模型编辑：provider + model
            //
            // 优先用下拉（从 /models 拿真实可用的 provider），
            // 拿不到才退化成手填。手输 provider 名极易打错，
            // 而打错的后果是执行时拿不到模型（EMPTY_OUTPUT）。
            form.kind === 'model'
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                    availableProviders && availableProviders.length > 0
                      ? h(
                          'select',
                          {
                            style: SELECT_STYLE,
                            value: provider,
                            onChange: (e) => setProvider(e.target.value),
                          },
                          h('option', { value: '' }, '选择 provider…'),
                          ...availableProviders.map((p) =>
                            h('option', { key: p, value: p }, p),
                          ),
                        )
                      : h(
                          'div',
                          { style: { flex: 1 } },
                          h(Input, {
                            value: provider,
                            onChange: setProvider,
                            placeholder: 'provider，如 trae',
                            autoFocus: true,
                          }),
                        ),

                    modelsForProvider && modelsForProvider.length > 0
                      ? h(
                          'select',
                          {
                            style: { ...SELECT_STYLE, flex: 1.3 },
                            value: modelName,
                            onChange: (e) => setModelName(e.target.value),
                          },
                          h('option', { value: '' }, '选择模型…'),
                          ...modelsForProvider.map((mo) =>
                            h('option', { key: mo, value: mo }, mo),
                          ),
                        )
                      : h(
                          'div',
                          { style: { flex: 1.3 } },
                          h(Input, {
                            value: modelName,
                            onChange: setModelName,
                            placeholder: 'model，如 deepseek-v4.1-flash',
                            onEnter: submit,
                          }),
                        ),
                  ),
                  h(
                    'div',
                    { style: { fontSize: 10, color: LABEL_3, marginTop: 5 } },
                    modelsLoading
                      ? '正在读取这个环境可用的模型…'
                      : availableProviders.length === 0
                        ? '读取不到模型列表，请手填。'
                        : modelsForProvider.length === 0
                          ? `provider「${provider || '未选'}」没有报告可用模型，请手填 model。`
                          : '下拉里是这个环境真实可用的选项。',
                  ),
                  // ⭐ 渠道适配提示（v0.3.1）：本插件的工具循环协议对 DeepSeek
                  //    系适配器打磨最充分；其他渠道可能存在空内容/流中断等
                  //    兼容性问题（详见 docs 渠道能力表，v0.5.0 起系统性支持）。
                  h(
                    'div',
                    {
                      style: {
                        fontSize: 10, color: WARN, marginTop: 5, lineHeight: 1.7,
                        padding: '5px 8px', borderRadius: R_SM, background: BG_L3,
                      },
                    },
                    '💡 建议：优先选 deepseek-official / deepseek-account 渠道——',
                    h('br'),
                    '本插件对 DeepSeek 系模型适配与验证最充分，其他渠道（如 our-free-model / zcode 等）可能出现空回复或流中断，正在逐步优化中（每版公告会注明）。',
                  ),
                )
              : null,

            // 类型选择 + 执行节奏
            form.kind === 'goal' || form.kind === 'createBot'
              ? h(
                  'div',
                  { style: { marginTop: 8 } },
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 11,
                        color: LABEL_2,
                      },
                    },
                    h('span', { style: { color: LABEL_3 } }, '类型'),
                    ...[
                      ['one-shot', '一次性（做完就归档）'],
                      ['standing', '常驻守护（一直守着）'],
                    ].map(([v, label]) =>
                      h(
                        'label',
                        {
                          key: v,
                          style: {
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            cursor: 'pointer',
                            color: type === v ? LABEL_1 : LABEL_2,
                          },
                        },
                        h('input', {
                          type: 'radio',
                          checked: type === v,
                          onChange: () => setType(v),
                          style: { margin: 0, cursor: 'pointer' },
                        }),
                        label,
                      ),
                    ),
                  ),

                  // ⭐ 执行节奏：改成选择器。
                  //
                  // 之前是自由文本「每 4 小时」，靠 parseCadence 猜。
                  // 猜不中就静默变成"没有节奏"——用户以为设好了，
                  // 面板却一直警告它会自己停。这种"猜"不该由用户承担。
                  // 现在直接给常用选项 + 精确时间，所见即所得。
                  h(
                    'div',
                    { style: { marginTop: 8 } },
                    h(
                      'div',
                      { style: { fontSize: 11, color: LABEL_3, marginBottom: 5 } },
                      '多久自动跑一次',
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                      ...CADENCE_PRESETS.map((p) =>
                        h(
                          'button',
                          {
                            key: p.value,
                            type: 'button',
                            onClick: () => setCadence(p.value),
                            style: {
                              fontFamily: FONT,
                              fontSize: 11,
                              lineHeight: '18px',
                              padding: '3px 9px',
                              borderRadius: R_SM,
                              cursor: 'pointer',
                              background:
                                cadence === p.value ? BRAND : BG_L1,
                              color:
                                cadence === p.value ? LABEL_FG : LABEL_2,
                              border: `1px solid ${
                                cadence === p.value ? BRAND : BORDER_L2
                              }`,
                              transition: 'all .12s ease',
                            },
                          },
                          p.label,
                        ),
                      ),
                    ),
                    // 自定义时间（时:分）
                    cadence === 'custom'
                      ? h(
                          'div',
                          {
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginTop: 6,
                              fontSize: 11,
                              color: LABEL_2,
                            },
                          },
                          h('span', { style: { color: LABEL_3 } }, '每天'),
                          h(Input, {
                            value: customTime,
                            onChange: setCustomTime,
                            placeholder: 'HH:MM',
                          }),
                          h('span', { style: { color: LABEL_3 } }, '执行'),
                        )
                      : null,
                    h(
                      'div',
                      {
                        style: {
                          fontSize: 10,
                          marginTop: 5,
                          color: cadence ? LABEL_3 : WARN,
                        },
                      },
                      cadence
                        ? 'Bot 会按这个节奏自己醒来干活，不用你守着'
                        : '⚠️ 不选的话它不会自己跑 —— 只有你点「执行」才动一次',
                    ),
                  ),
                )
              : null,

            h(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 6,
                  marginTop: 10,
                },
              },
              h(Btn, { onClick: onClose, disabled: busy }, '取消'),
              h(
                Btn,
                { kind: 'primary', onClick: submit, disabled: busy },
                form.kind === 'reject' ? '驳回' : '确定',
              ),
            ),
          );
        }

        /**
         * 需要二次确认的动作按钮。
         *
         * 取代 window.confirm：第一次点击进入 armed 态（按钮变红、文案变确认），
         * 3 秒内再点一次才真正执行。
         */
        function ConfirmBtn({ label, confirmLabel, icon, kind, onConfirm, disabled }) {
          const [armed, setArmed] = React.useState(false);

          React.useEffect(() => {
            if (!armed) return;
            const t = setTimeout(() => setArmed(false), 3000);
            return () => clearTimeout(t);
          }, [armed]);

          return h(
            Btn,
            {
              kind: armed ? 'danger' : kind,
              disabled,
              icon: armed ? null : icon,
              onClick: () => {
                if (armed) {
                  setArmed(false);
                  onConfirm();
                } else {
                  setArmed(true);
                }
              },
            },
            armed ? confirmLabel : label,
          );
        }

        // ---------- 预算条 ----------
        function Meter({ value, max }) {
          const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
          const color = pct > 80 ? ERR : pct > 50 ? WARN : OK;
          return h(
            'div',
            {
              style: {
                height: 4,
                width: '100%',
                borderRadius: 999,
                background: BG_L3,
                overflow: 'hidden',
                marginTop: 6,
              },
            },
            h('div', {
              style: {
                height: '100%',
                width: `${pct}%`,
                background: color,
                borderRadius: 999,
                transition: 'width .35s cubic-bezier(.4,0,.2,1)',
              },
            }),
          );
        }

        // ---------- 状态徽标 ----------
        function Badge({ children, tone = 'neutral' }) {
          const map = {
            ok: { bg: OK_TER, fg: OK },
            warn: { bg: WARN_TER, fg: WARN },
            err: { bg: 'transparent', fg: ERR },
            neutral: { bg: BG_L3, fg: LABEL_2 },
            brand: { bg: BG_L3, fg: BRAND },
          };
          const t = map[tone] || map.neutral;
          return h(
            'span',
            {
              style: {
                fontSize: 11,
                lineHeight: '16px',
                padding: '1px 7px',
                borderRadius: 999,
                background: t.bg,
                color: t.fg,
                fontFamily: FONT,
                whiteSpace: 'nowrap',
              },
            },
            children,
          );
        }

