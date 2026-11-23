// 设计系统原语（kit）：**唯一允许拼 JSX 的地方**。
//
// 为什么单独一层（见 docs/ARCHITECTURE-REVIEW.md §3）：之前每个渠道模块自己拼
// `<section class="eac-section">` + 标题 + 操作按钮 + 列表，于是每接一个渠道就多一套
// 交互（"想到什么堆什么"）。现在把「分区骨架」「列表行」「开关/徽标/空态」这些
// **不可变的形状**收在这里，provider 模块只提供数据与动作。
//
// 纪律：
// 1. 组件不接受任意 className 覆写（要改样式改 styles.js 的令牌/规则）；
// 2. 交互位置固定：主 CTA 在分区标题右侧，破坏性动作弱化为文字按钮；
// 3. 一切列表条目都走 Row，不允许 provider 自己造第二种行形状。

/** 分区骨架：标题 + 一行指标 + 右侧动作 + 内容。 */
export const Section = ({ title, summary, actions, children }) => h('section', { className: 'eac-section' },
  h('div', { className: 'eac-section-head' },
    h('div', { className: 'eac-section-copy' },
      h('h3', { className: 'eac-section-title' }, title),
      summary === undefined || summary === null ? null : h('p', { className: 'eac-summary' }, summary)),
    actions === undefined || actions === null ? null
      : h('div', { className: 'eac-section-actions' }, actions)),
  children)

/** 列表容器：条目之间只有分隔线，不叠卡片。 */
export const ListBox = ({ children }) => h('div', { className: 'eac-list-box' }, children)

/** 开关（role=switch，键盘可用）。 */
export const Switch = ({ checked, disabled, label, onChange }) => h('button', {
  type: 'button', className: 'eac-switch', role: 'switch', disabled,
  'aria-checked': checked, 'aria-label': label, onClick: onChange,
}, h('span', { className: 'eac-switch-knob', 'aria-hidden': 'true' }))

/**
 * 列表行：**所有渠道的账号/用量/条目都用它**。
 *
 * 形状固定为「主体（头像 + 名称 + 徽标 + 副行） | 指标 | 开关 | 展开」，
 * 展开区（`detail`）承载明细与维护动作，默认收起 —— 不再把所有信息平铺。
 */
export const Row = ({ key, avatar, name, tags, meta, metric, switchControl, controls, moreLabel, expanded, onToggle, detail, tone }) => {
  const detailId = `eac-row-detail-${encodeURIComponent(key ?? name)}`
  return h('div', { key, className: 'eac-row-item', 'data-off': tone === 'off' ? 'true' : undefined },
    h('div', { className: 'eac-row-main' },
      avatar === undefined ? null : h('span', { className: 'eac-avatar', 'aria-hidden': 'true' }, avatar),
      h('div', { className: 'eac-row-copy' },
        h('span', { className: 'eac-row-head' },
          h('span', { className: 'eac-row-name', title: name }, name),
          tags),
        meta === undefined ? null : h('span', { className: 'eac-row-meta' }, meta))),
    metric === undefined ? null : metric,
    switchControl === undefined ? null : switchControl,
    // 动作与展开按钮同处 more 列：并排放进一个容器，避免两个 grid 项叠在同一格。
    (controls?.length || moreLabel !== undefined) ? h('div', { className: 'eac-row-controls' },
      ...(controls?.length ? controls : []),
      moreLabel === undefined ? null
        : h('button', {
          type: 'button', className: 'eac-more', 'aria-expanded': expanded, 'aria-label': `${name} 的更多操作`, 'aria-controls': detailId,
          onClick: onToggle,
        }, expanded ? '收起' : moreLabel)) : null,
    expanded && detail ? h('div', { className: 'eac-row-more', id: detailId }, detail) : null)
}

/** 空态：三态区分（读取中 / 失败+重试 / 确实没有）。 */
export const EmptyState = ({ loading, failed, onRetry, disabled, emptyText, loadingText }) => {
  if (loading) return h('p', { className: 'eac-empty' }, loadingText ?? '正在读取…')
  if (failed) {
    return h('div', { className: 'eac-empty' },
      h('span', null, '读取失败。'),
      button('重试', onRetry, disabled))
  }
  return h('p', { className: 'eac-empty' }, emptyText)
}

/** 指标块（余额/用量数字）：数字比标签大，等宽数字。 */
export const remainingBar = (fraction, label) => typeof fraction === 'number'
  ? h('progress', { className: 'eac-remaining', 'data-low': fraction <= 0.1 || undefined, max: 1, value: fraction,
    'aria-label': `${label}的剩余额度` })
  : null

export const Metric = ({ value, unit, fraction, label }) =>
  h('div', { className: 'eac-row-metric' },
    h('span', { className: `eac-row-credit${typeof value === 'string' ? ' is-unknown' : ''}` },
      displayNumber(value), unit === undefined ? null : h('small', null, unit)),
    remainingBar(fraction, label))
