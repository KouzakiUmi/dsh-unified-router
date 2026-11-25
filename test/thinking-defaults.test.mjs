/**
 * 默认思考档策略（`lib/model-catalog.js` 的 `defaultModelEffort`）。
 *
 * ## 被测契约（用户要求）
 *
 * 1. **默认不得落在关闭/low/minimal**：上游把 `low` / `off` / `minimal` 声明成
 *    默认档时（Agnes 默认不思考、Raccoon 托管档位缺省、
 *    TRAE `light`），默认档要提到该模型**真实支持**的中档或更强档。
 * 2. **有效中/高默认优先保留**：声明值已经是 medium / high / xhigh / max 时原样
 *    返回（也覆盖「上游自己选了最高档」的情形）。
 * 3. **不编造档位**：返回值一定出现在传入的 `efforts` 里；模型只有低档时尊重能力
 *    （`['off', 'low']` → `low`，`['off']` → `off`）。
 * 4. 认不出强度的上游私有默认值（如 MiniMax 的 `default`）不替它改。
 *
 * 私有档位名（`light` / `extra_high` / `level_N` / `on` / `none`）按强度序识别 ——
 * TRAE / Raccoon 的远端目录直接下发这些名字。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultModelEffort } from '../lib/model-catalog.js'

const cases = [
  // [efforts, declared, 期望, 说明]
  [['off', 'low', 'medium', 'high'], 'medium', 'medium', '有效中档默认原样保留'],
  [['off', 'low', 'medium', 'high'], 'high', 'high', '有效高档默认原样保留'],
  [['low', 'high', 'max'], 'max', 'max', '上游自己选的最高档不降级'],
  [['off', 'low', 'medium', 'high'], 'off', 'medium', '关闭档默认 → 提到中档'],
  [['off', 'minimal', 'low', 'medium', 'high'], 'minimal', 'medium', 'minimal 默认 → 中档'],
  [['none', 'low', 'medium', 'high', 'xhigh'], 'low', 'medium', '远端 low 默认 → 中档'],
  [['low', 'high', 'xhigh', 'max'], 'low', 'high', '只有 low 与高档时取 high'],
  [['off', 'low'], 'off', 'low', '只剩低档 → 尊重能力取 low（不编造高档）'],
  [['off', 'low'], 'low', 'low', '本来就只能 low → low'],
  [['off'], 'off', 'off', '只能关闭思考 → off'],
  [['off', 'high'], 'off', 'high', '中档缺失但有 high → high'],
  // 私有别名（TRAE）
  [['light', 'high', 'extra_high'], 'light', 'high', 'TRAE light 默认 → high'],
  [['light', 'high', 'extra_high'], 'extra_high', 'extra_high', 'TRAE extra_high 默认原样保留'],
  [['light', 'high', 'extra_high'], undefined, 'high', '无声明默认 → 中/高档'],
  [['light'], 'light', 'light', '只有 light → 尊重能力'],
  [['light', 'extra_high'], undefined, 'extra_high', '无中/高档可选 → 取最强档'],
  // 私有档位（Raccoon level_N）
  [['off', 'level_1', 'level_3', 'level_5'], 'off', 'level_3', 'Raccoon 上游 off → level_3'],
  [['off', 'level_1', 'level_3', 'level_5'], 'level_1', 'level_3', 'Raccoon level_1 默认 → level_3'],
  [['level_1', 'level_2', 'level_4', 'level_5'], undefined, 'level_4', '没有 level_3 → 取 level_4（high）'],
  [['level_3'], 'level_3', 'level_3', '只有 level_3 → 保留'],
  // 未登记强度：不替上游改
  [['default', 'low', 'medium', 'high'], 'default', 'default', '未登记的上游默认值（default）不替它改'],
  // 空列表
  [[], 'high', undefined, '无档位列表 → 不采用目录声明值'],
  [[], '', undefined, '空字符串不作为档位'],
  [[' ', ''], '', undefined, '只有畸形档位 → 省略参数'],
  [[], undefined, undefined, '无档位列表且无声明值 → undefined'],
]

test('defaultModelEffort：默认档不落关闭/低档，也不编造档位', () => {
  for (const [efforts, declared, expected, why] of cases) {
    const actual = defaultModelEffort(efforts, declared)
    assert.equal(actual, expected, `${why}：efforts=${JSON.stringify(efforts)} declared=${String(declared)}`)
    if (expected !== undefined && efforts.length > 0) {
      assert.ok(efforts.includes(actual), `${why}：返回值必须是该模型真实支持的档位`)
    }
  }
})

test('defaultModelEffort：preferred 参数让渠道优先自己的默认档', () => {
  // 渠道声明 preferred=high 时，远端声明 low 也一律用 high（适配器侧强制）。
  assert.equal(defaultModelEffort(['none', 'low', 'medium', 'high', 'xhigh'], 'low', 'high'), 'high')
  // 但该模型不支持 high 时退回中档，而不是编一个 high。
  assert.equal(defaultModelEffort(['none', 'low', 'medium'], undefined, 'high'), 'medium')
  // 声明值本身是有效高档时，preferred 不覆盖它（上游自己选的更强档保留）。
  assert.equal(defaultModelEffort(['low', 'high', 'xhigh'], 'xhigh', 'high'), 'xhigh')
})
