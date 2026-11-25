// 退役渠道的磁盘清扫（独立模式启动时跑一次，幂等）。
//
// 为什么要有它：渠道「从代码里删掉」不等于「数据从磁盘上消失」。用户机器上仍留着
// 旧渠道的账号条目、模型黑名单、目录缓存、路由检测状态与账本目录。这些孤儿数据
// 有两类后果：
//   1. 永久占用状态文件，且埋在 `state.json` 里没人知道还能清；
//   2. 一旦该渠道以任何形式复活（重新接入），旧账号会带着过期凭据"半复活"。
//
// 做法上刻意**只走 AccountPool 的公开 API**（`listAccountsByProvider` /
// `removeAccount` / `clearDisabledModels`），不直接改 `state.json`：
// 池子内部对「整体写入必须携带账号与黑名单」有严格约定，绕过它手改文件会把这些
// 约定打破（本仓库历史上已有同类事故）。
//
// 边界：
// - **只在独立模式调用**：共用模式下 `channel-pack` 状态归原插件所有，删它的账号
//   等于破坏别人的数据。
// - **绝不抛错**：清扫是启动路径上的附加动作，失败只记一句 warn —— 数据清不掉是
//   遗留问题，不能让插件起不来。
// - 凭据本体（`.credentials.yaml` 里的 ref）**不碰**：那是用户级秘密存储，删条目
//   属于不可逆操作，留给 `scripts/cleanup-loomy.mjs` 明确提示。
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {object} options
 * @param {any} options.pool 已挂载的 `AccountPool`
 * @param {readonly string[]} options.retiredIds 退役渠道 id（来自 `channel-specs.js`）
 * @param {string} [options.stateDir] 插件状态目录（`<snapshots 文件所在目录>`）
 * @param {{warn?: Function}} [options.logger]
 * @returns {Promise<{accounts: number, providers: string[]}>} 清理结果（供日志与测试）
 */
export async function pruneRetiredChannels({ pool, retiredIds, stateDir, logger } = {}) {
  const result = { accounts: 0, providers: [] }
  if (!pool || !Array.isArray(retiredIds) || retiredIds.length === 0) return result
  for (const provider of retiredIds) {
    let accounts = []
    try {
      accounts = pool.listAccountsByProvider(provider) ?? []
    } catch (error) {
      logger?.warn?.(`[unified-router] 读取退役渠道 ${provider} 的账号失败：${String(error)}`)
      continue
    }
    for (const account of accounts) {
      try {
        await pool.removeAccount(account.id)
        result.accounts += 1
      } catch (error) {
        logger?.warn?.(`[unified-router] 移除退役渠道账号 ${account.id} 失败：${String(error)}`)
      }
    }
    try {
      await pool.clearDisabledModels(provider)
    } catch (error) {
      logger?.warn?.(`[unified-router] 清理退役渠道 ${provider} 的模型黑名单失败：${String(error)}`)
    }
    // 目录缓存 / 路由检测状态 / 账本目录：纯文件，池子不认识它们。
    if (typeof stateDir === 'string' && stateDir) {
      for (const relative of [join(stateDir, `${provider}-catalog.json`), join(stateDir, 'auto-tasks', provider), join(stateDir, 'daily-checkin', provider)]) {
        if (!existsSync(relative)) continue
        try {
          rmSync(relative, { recursive: true, force: true })
        } catch (error) {
          logger?.warn?.(`[unified-router] 删除退役渠道文件 ${relative} 失败：${String(error)}`)
        }
      }
    }
    if (accounts.length > 0) result.providers.push(provider)
  }
  return result
}