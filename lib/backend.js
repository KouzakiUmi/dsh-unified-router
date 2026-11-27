// Generated from src/backend.ts and vendored MIT channel sources.
import { createRequire as __unifiedRouterRequire } from 'node:module'; const require = __unifiedRouterRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// vendor/channel-pack/src/open-browser.ts
var open_browser_exports = {};
__export(open_browser_exports, {
  openBrowser: () => openBrowser
});
import { spawn as spawn3 } from "node:child_process";
function openBrowser(url) {
  const warn = (error) => {
    console.error("[channel-pack] failed to open browser; open manually:", url, error);
  };
  const win = process.platform === "win32";
  if (win) {
    const args = ["/c", "start", '""', `"${url}"`];
    try {
      const child = spawn3("cmd", args, { detached: true, stdio: "ignore", windowsVerbatimArguments: true });
      child.on("error", warn);
      child.unref();
      return;
    } catch (error) {
      warn(error);
      return;
    }
  }
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn3(cmd, [url], { detached: true, stdio: "ignore" });
    child.on("error", warn);
    child.unref();
  } catch (error) {
    warn(error);
  }
}
var init_open_browser = __esm({
  "vendor/channel-pack/src/open-browser.ts"() {
  }
});

// src/backend.ts
import { LlmError as LlmError10 } from "@deepseek-ai/dsh-llm";

// vendor/channel-pack/src/account-pool.ts
import { credentialRef } from "@deepseek-ai/dsh-credentials";

// vendor/channel-pack/src/channel-pack-store.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Schema from "@deepseek-ai/schemastery";

// vendor/channel-pack/src/settings-compat.ts
function readService(ctx, key) {
  const get = ctx?.get;
  if (typeof get !== "function") return void 0;
  return get.call(ctx, key);
}
function settingsOf(ctx) {
  return readService(ctx, "settings");
}
function hasLegacyNamespaceRegistration(settings) {
  return typeof settings?.register === "function";
}

// vendor/channel-pack/src/channel-pack-store.ts
var CHANNEL_PACK_NS = "channel-pack";
var channelPackSchema = Schema.object({
  accounts: Schema.array(Schema.any()).default([]),
  disabledModels: Schema.dict(Schema.any()).default({}),
  modelParams: Schema.dict(Schema.any()).default({}),
  gatewayEnabled: Schema.boolean().default(true),
  providerOrder: Schema.array(Schema.string()).default([])
});
function sanitizeGatewayEnabled(raw) {
  return raw !== false;
}
function sanitizeProviderOrder(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const id of raw) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
function sanitizeDisabledModels(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const result = {};
  for (const [provider, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const perProvider = {};
    for (const [modelId, flag] of Object.entries(value)) {
      if (typeof flag === "boolean") perProvider[modelId] = flag;
    }
    if (Object.keys(perProvider).length > 0) result[provider] = perProvider;
  }
  return result;
}
function sanitizeModelParams(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const result = {};
  for (const [provider, models] of Object.entries(raw)) {
    if (typeof models !== "object" || models === null || Array.isArray(models)) continue;
    const perProvider = {};
    for (const [id, value] of Object.entries(models)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const input = value;
      const clean = {};
      for (const key of ["contextWindow", "maxTokens"]) {
        const number = input[key];
        if (typeof number === "number" && Number.isFinite(number) && number > 0) clean[key] = Math.floor(number);
      }
      if (typeof input.reasoningEffort === "string" && input.reasoningEffort) clean.reasoningEffort = input.reasoningEffort;
      if (typeof input.supportsImage === "boolean") clean.supportsImage = input.supportsImage;
      if (Object.keys(clean).length) perProvider[id] = clean;
    }
    if (Object.keys(perProvider).length) result[provider] = perProvider;
  }
  return result;
}
function sanitizeAccounts(raw) {
  if (!Array.isArray(raw)) return [];
  const accounts = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const candidate = entry;
    if (typeof candidate.id !== "string" || candidate.id.length === 0) continue;
    if (typeof candidate.provider !== "string" || candidate.provider.length === 0) continue;
    if (typeof candidate.credentialRef !== "string" || candidate.credentialRef.length === 0) continue;
    accounts.push({
      ...candidate,
      enabled: candidate.enabled !== false,
      refreshable: candidate.refreshable !== false,
      nickname: typeof candidate.nickname === "string" ? candidate.nickname : candidate.id,
      createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now()
    });
  }
  return accounts;
}
var SettingsStore = class {
  constructor(scope) {
    this.scope = scope;
  }
  kind = "settings";
  load() {
    const value = this.scope.get();
    if (value === void 0 || value === null) return void 0;
    return {
      accounts: sanitizeAccounts(value.accounts),
      disabledModels: sanitizeDisabledModels(value.disabledModels),
      modelParams: sanitizeModelParams(value.modelParams),
      // 老文档没这个键 → 启用，与升级前行为一致。
      gatewayEnabled: sanitizeGatewayEnabled(value.gatewayEnabled),
      // 老文档没这个键 → 空数组（未自定义），展示侧按声明顺序渲染。
      providerOrder: sanitizeProviderOrder(value.providerOrder)
    };
  }
  async save(state) {
    await this.scope.replace({
      accounts: state.accounts,
      disabledModels: state.disabledModels,
      modelParams: state.modelParams ?? {},
      // 开关丢失只会让网关回到默认启用（可逆），故接受老版本重写时丢掉本键。
      gatewayEnabled: state.gatewayEnabled !== false,
      // 顺序丢失只会回到声明顺序（可逆，重拖一次即恢复），同理接受丢失。
      providerOrder: state.providerOrder ?? []
    });
  }
};
var MemoryStore = class {
  kind = "memory";
  state;
  load() {
    return this.state;
  }
  async save(state) {
    this.state = state;
  }
};
var REF_PREFIX_TO_PROVIDER = [
  // ⚠️ 本表与「已实现渠道」一一对应：本仓库只接 qoder 家族 / qodercn / trae /
  // raccoon 家族。国际渠道（lobsterai / cline / zcode / minimax / gemini /
  // opencode）已于 2026-11-25 随「全部重写」整体移除 —— 它们的账号数据由
  // `lib/retired-channels.js` 在独立模式启动时清扫。
  //
  // ⚠️ 顺序按前缀长度**降序**（`QODERCN` 必须排在 `QODER` 之前）：下面据此
  // 生成凭据 ref 正则，顺序错了会让归属取决于引擎尝试顺序而非规则。
  ["QODER", "qoder"],
  ["QODERCN", "qodercn"],
  ["TRAE", "trae"],
  ["RACCOON", "raccoon"],
  ["RACCOONPRO", "raccoon-pro"]
];
function isSupportedProvider(provider) {
  return typeof provider === "string" && REF_PREFIX_TO_PROVIDER.some(([, id]) => id === provider);
}
var ACCOUNT_REF_RE = new RegExp(
  // ⚠️ 按前缀长度**降序**排列：`QODERCN` 必须排在 `QODER` 之前。虽然正则的
  // 回溯最终仍能让 `QODERCN_*` 匹配成功（所以顺序错了也**暂时**看不出问题），
  // 但那时匹配结果就取决于引擎的尝试顺序而非规则 —— 一旦将来加入更多同前缀的
  // provider（如 `QODERX`），就会变成静默错归属：账号挂到 `qoder` 面板，而它的
  // 凭据是 CN 的，请求必然失败。故这里显式定序，而非依赖回溯。
  `^(${REF_PREFIX_TO_PROVIDER.map(([prefix]) => prefix).sort((a, b) => b.length - a.length).join("|")})_ACCOUNT_([0-9A-Fa-f]{6,})$`
);
function extractCredentialRefNames(text) {
  const names = [];
  let inRefs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true;
      continue;
    }
    if (!inRefs) continue;
    if (/^\S/.test(line)) break;
    const match = /^\s{2,}([A-Z][A-Z0-9_]*):/.exec(line);
    if (match?.[1] !== void 0) names.push(match[1]);
  }
  return names;
}
function accountFromCredentialRef(ref) {
  const match = ACCOUNT_REF_RE.exec(ref);
  if (match === null) return void 0;
  const prefix = match[1];
  const suffix = match[2];
  if (prefix === void 0 || suffix === void 0) return void 0;
  const provider = REF_PREFIX_TO_PROVIDER.find(([candidate]) => candidate === prefix)?.[1];
  if (provider === void 0) return void 0;
  const id = `${provider}-${suffix.toLowerCase()}`;
  return {
    id,
    provider,
    nickname: id,
    enabled: true,
    credentialRef: ref,
    createdAt: Date.now(),
    refreshable: true
  };
}
var FileStore = class {
  constructor(home, path, logger2) {
    this.home = home;
    this.path = path;
    this.logger = logger2;
  }
  kind = "file";
  load() {
    try {
      if (!existsSync(this.path)) return this.bootstrapFromCredentialRefs();
      const parsed = JSON.parse(readFileSync(this.path, "utf-8"));
      if (typeof parsed !== "object" || parsed === null) return void 0;
      const value = parsed;
      return {
        accounts: sanitizeAccounts(value.accounts),
        disabledModels: sanitizeDisabledModels(value.disabledModels),
        modelParams: sanitizeModelParams(value.modelParams),
        // 老文档没这个键 → 启用，与升级前行为一致。
        gatewayEnabled: sanitizeGatewayEnabled(value.gatewayEnabled),
        // 老文档没这个键 → 空数组（未自定义），展示侧按声明顺序渲染。
        providerOrder: sanitizeProviderOrder(value.providerOrder)
      };
    } catch (error) {
      this.logger?.warn(`[channel-pack] \u8BFB\u53D6 ${this.path} \u5931\u8D25\uFF0C\u672C\u6B21\u4EE5\u7A7A\u5217\u8868\u542F\u52A8: ${String(error)}`);
      return void 0;
    }
  }
  async save(state) {
    this.write(state);
  }
  write(state) {
    mkdirSync(join(this.home, "channel-pack"), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, this.path);
  }
  /**
   * 首次启动的数据恢复（**仅在状态文档不存在时**执行一次）。
   *
   * 背景：0.1.7 启动时 `SettingsForms.importLegacyDocument()` 把
   * `$DSH_HOME/settings.yaml` 改名为 `settings.yaml.imported`，并按「section id
   * = profile 条目 id」逐段导入 —— `channel-pack` 不对应任何条目，该段导入失败、
   * 只留在改名后的文件里。于是老用户的账号索引成了孤儿（凭据本体仍在
   * `.credentials.yaml` 中，完好无损）。
   *
   * 这里据凭据 ref 名重建索引：能恢复「有哪些账号、属于哪个 provider、用哪个
   * credentialRef」，**恢复不了**昵称/顺序/限流时间戳（那三项只在旧 settings
   * 文档里，而本项目没有 YAML 解析依赖）。重建结果立即落盘，故只做一次。
   */
  bootstrapFromCredentialRefs() {
    const credentialsPath = join(this.home, ".credentials.yaml");
    try {
      if (!existsSync(credentialsPath)) return void 0;
      const accounts = extractCredentialRefNames(readFileSync(credentialsPath, "utf-8")).flatMap((ref) => accountFromCredentialRef(ref) ?? []);
      if (accounts.length === 0) return void 0;
      const state = {
        accounts,
        disabledModels: {},
        // 恢复出的文档本来就不含任何开关信息 → 启用（与全新安装一致）。
        gatewayEnabled: true,
        // 凭据文件里也没有顺序信息 → 空数组（未自定义，与全新安装一致）。
        providerOrder: []
      };
      try {
        this.write(state);
      } catch (error) {
        this.logger?.warn(`[channel-pack] \u6062\u590D\u51FA\u7684\u8D26\u53F7\u672A\u80FD\u843D\u76D8\uFF08\u4EC5\u672C\u6B21\u6709\u6548\uFF09: ${String(error)}`);
      }
      this.logger?.info(
        `[channel-pack] \u5DF2\u4ECE .credentials.yaml \u6062\u590D ${accounts.length} \u4E2A\u8D26\u53F7\uFF08\u6635\u79F0/\u987A\u5E8F/\u9650\u6D41\u6807\u8BB0\u65E0\u6CD5\u6062\u590D\uFF1B\u65E7\u6570\u636E\u4ECD\u5728 settings.yaml.imported \u7684 channel-pack \u6BB5\uFF09`
      );
      return state;
    } catch (error) {
      this.logger?.warn(`[channel-pack] \u8D26\u53F7\u6062\u590D\u5931\u8D25\uFF08\u5FFD\u7565\uFF09: ${String(error)}`);
      return void 0;
    }
  }
};
function resolveChannelPackHome(ctx) {
  const override = process.env.DSH_CHANNEL_PACK_STATE_DIR;
  if (override !== void 0 && override.trim().length > 0) return override.trim();
  const profileHome = readService(ctx, "profileContext")?.home;
  if (typeof profileHome === "string" && profileHome.length > 0) return profileHome;
  const envHome = process.env.DSH_HOME;
  if (envHome !== void 0 && envHome.trim().length > 0) return envHome.trim();
  return join(homedir(), ".dsh");
}
function createChannelPackStore(ctx) {
  const settings = settingsOf(ctx);
  if (hasLegacyNamespaceRegistration(settings) && settings !== void 0) {
    try {
      const scope = settings.register(CHANNEL_PACK_NS, channelPackSchema);
      return new SettingsStore(scope);
    } catch (error) {
      ctx.logger?.warn?.(`[channel-pack] settings namespace \u6CE8\u518C\u5931\u8D25\uFF0C\u6539\u7528\u672C\u5730\u72B6\u6001\u6587\u6863: ${String(error)}`);
    }
  }
  const home = resolveChannelPackHome(ctx);
  if (home === void 0) {
    ctx.logger?.warn?.("[channel-pack] \u65E0\u6CD5\u5B9A\u4F4D DSH home\uFF0C\u8D26\u53F7\u5217\u8868\u4E0E\u6A21\u578B\u9ED1\u540D\u5355\u4EC5\u5B58\u5728\u4E8E\u5185\u5B58\u4E2D");
    return new MemoryStore();
  }
  return new FileStore(home, join(home, "channel-pack", "state.json"), ctx.logger);
}

// vendor/channel-pack/src/account-pool.ts
var EMPTY_MODEL_SET = /* @__PURE__ */ new Set();
function allAccountsRateLimitedForModel(accounts, modelId, now = Date.now()) {
  if (modelId.length === 0) return void 0;
  let earliest;
  for (const account of accounts) {
    const resetAt = account.modelRateLimits?.[modelId];
    if (resetAt === void 0 || resetAt === 0 || now >= resetAt) return void 0;
    earliest = earliest === void 0 ? resetAt : Math.min(earliest, resetAt);
  }
  return earliest === void 0 ? void 0 : { resetAtMs: earliest, accountCount: accounts.length };
}
var AccountPool = class {
  constructor(ctx, quotaAccountOrder, noteQuotaAccount) {
    this.ctx = ctx;
    this.quotaAccountOrder = quotaAccountOrder;
    this.noteQuotaAccount = noteQuotaAccount;
    this.store = createChannelPackStore(ctx);
    if (this.store.kind === "memory") {
      this.ctx.logger?.warn?.("[channel-pack] \u65E0\u53EF\u7528\u6301\u4E45\u5316\u540E\u7AEF\uFF0C\u8D26\u53F7\u5217\u8868\u4E0E\u6A21\u578B\u9ED1\u540D\u5355\u4EC5\u5B58\u5728\u4E8E\u5185\u5B58\u4E2D");
    }
  }
  /** 持久化后端；两个后端都不可用时是仅内存实现。 */
  store;
  /**
   * 账号列表的**权威进程内副本**。
   *
   * 不直接把后端的读取结果当读源：后端的落盘快照在写入后未必立即反映到
   * 下一次读取，而本类的每次写入都是「读 → 改 → 整体写回」。
   * 若以滞后快照为读源，并发/连续的 updateModelRateLimit 会互相覆盖
   * （典型表现：多个账号触发限流后，落盘文档里一条 modelRateLimits
   * 都没有）。因此首次载入后，这份副本即为唯一读源。
   */
  cache = [];
  /**
   * 模型启停覆盖的**权威进程内副本**（与 {@link cache} 同理）：
   * `true` 用户关闭，`false` 用户显式打开，缺键跟随模型 stale 默认值。
   */
  modelCache = {};
  /**
   * 模型生成参数表的进程内权威副本。
   *
   * ⚠️ 与黑名单**分开描述**：黑名单是「是否出现在选择器」，本表是「调用时用什么
   * 参数」，两者互不影响，清空其一不应影响另一。
   */
  paramCache = {};
  /**
   * 「本机 OpenAI 网关」开关的进程内副本。
   *
   * 缺键语义是**启用**（与 `channel-pack-store.ts` 的 `sanitizeGatewayEnabled`
   * 同一方向）：老用户升级后网关行为与升级前完全一致，不会被静默关掉。
   *
   * 丢失本键的唯一后果是回到默认启用，用户再关一次即可。
   */
  gatewayEnabledCache = true;
  /**
   * 供应商自定义显示顺序（「供应商开关」弹窗拖拽排序）的进程内副本。
   *
   * ⚠️ 与 {@link gatewayEnabledCache} 同级、**不需要**独立文档：丢失本键的
   * 唯一后果是顺序回到声明顺序，用户重新拖一次即可（纯展示偏好，可逆）。
   * 数组语义见 `channel-pack-store.ts` 的 `ChannelPackState.providerOrder`。
   */
  providerOrderCache = [];
  /** 是否已完成首次载入。 */
  loaded = false;
  /**
   * 状态文档落盘的**串行链**（见 {@link queueStoreSave}）。
   *
   * ⚠ 它必须存在：内层重新读一次快照只能保证「读→改」这半原子，而
   * `store.save()` 本身是异步的，两个写者的 `save` 可以乱序完成。
   */
  storeChain = Promise.resolve();
  /** 首次访问时从后端载入账号列表、黑名单与锁定表。 */
  ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    const state = this.store.load();
    if (state !== void 0) {
      this.cache = state.accounts;
      this.modelCache = state.disabledModels;
      this.paramCache = state.modelParams ?? {};
      this.gatewayEnabledCache = state.gatewayEnabled !== false;
      this.providerOrderCache = state.providerOrder ?? [];
    }
  }
  /** 读取账号列表（进程内权威副本）。 */
  readAccounts() {
    this.ensureLoaded();
    return this.cache;
  }
  /**
   * 串行化状态文档的落盘，并在**轮到本次时**重新取一次快照。
   *
   * ## 为什么 `removeAccount` 里的重读不够（真实缺陷，审查发现）
   *
   * `await this.writeAccounts(this.readAccounts().filter(...))` 只保证了
   * 「读 → 改」之间没有 `await`（内存那半确实原子），但
   * {@link writeAccounts} 内部的 `await this.store.save(...)` 是**异步**的
   * （`SettingsStore.save` → `await this.scope.replace(...)`）。两个写者各自的
   * `save` 可以**乱序完成**：后完成者带着它更早的快照覆盖磁盘 ⇒ 磁盘与
   * `this.cache` 分叉。实测形态（探针复现真实 IO 交错）：
   *
   * - 并发 `removeAccount('a')` / `removeAccount('b')`（先发起的后完成）：
   *   `cache=["keep"]` 而 `disk=["b","keep"]` ⇒ **已删除的账号在磁盘上复活**，
   *   下次进程启动它又回来；
   * - `removeAccount('victim')` 与 `addAccount(added)` 交错：
   *   `cache=["added","keep"]` 而 `disk=["keep"]` ⇒ **新增账号被静默丢失**。
   *
   * ⚠ 仅 `SettingsStore` 这类**异步** `replace` 后端中招；`FileStore.save` 是
   * 同步的 `writeFileSync` + `renameSync`（见 `src/channel-pack-store.ts`），整段
   * RMW 本来就原子、免疫此竞态。故不能靠「换个后端」绕过，只能在
   * `AccountPool` 这一层把写排队。
   *
   * ## 做法
   *
   * 把本次写挂到 {@link storeChain} 尾部，**在轮到它执行时**才从进程内权威副本
   * 取快照，于是「取快照」与「写磁盘」之间隔着前面所有已排队的写。磁盘上因此
   * 永远是「最后一次排队的写」的内容，与 `this.cache` / `this.modelCache` 收敛。
   *
   * ⚠ 账号、黑名单、参数与开关**必须取自同一时刻**的快照。
   *
   * ⚠ 失败**照常向调用方抛出**（与改造前的 `writeAccounts` 一致：登录成功后落盘
   * 失败必须让 `account.create` 报错，不能静默假装成功）。同时用一条
   * `.catch()` 派生量更新 {@link storeChain}，让**链本身不被一次失败打断**
   * ——否则后续所有写都会跟着拒绝，账号池进入永不落盘状态。
   */
  queueStoreSave() {
    if (this.store.kind === "memory") return Promise.resolve();
    const next = this.storeChain.then(async () => {
      await this.store.save({
        accounts: this.cache,
        disabledModels: this.modelCache,
        modelParams: this.paramCache,
        // ⚠️ 必须与账号、黑名单取自**同一时刻**的快照（见本方法的注释）：
        // 分两次快照会让同一份文档里的字段互相矛盾。
        gatewayEnabled: this.gatewayEnabledCache,
        providerOrder: this.providerOrderCache
      });
    });
    this.storeChain = next.catch(() => {
    });
    return next;
  }
  /**
   * 持久化账号列表（同时更新进程内权威副本）。
   *
   * **必须连同黑名单一起写回**：两种后端都是整体写入，
   * 只写 `{ accounts }` 会把同一文档里的 `disabledModels` 抹掉。
   */
  async writeAccounts(accounts) {
    this.cache = accounts;
    this.loaded = true;
    if (this.store.kind === "memory") {
      this.ctx.logger?.warn?.("[channel-pack] \u65E0\u6301\u4E45\u5316\u540E\u7AEF\uFF0C\u8D26\u53F7\u53D8\u66F4\u672A\u843D\u76D8");
      return;
    }
    await this.queueStoreSave();
  }
  /**
   * 读取某 provider 的模型黑名单（被关闭的模型 id 集合）。
   *
   * 适配器只调用这一个方法，因此进程内副本就是它们的读源：设置页改开关
   * 后，下一次 `listModels` 立即生效，无需重启或重新注册适配器。
   */
  disabledModelsFor(provider) {
    this.ensureLoaded();
    const perProvider = this.modelCache[provider];
    if (perProvider === void 0) return EMPTY_MODEL_SET;
    const disabled = Object.keys(perProvider).filter((id) => perProvider[id] === true);
    return disabled.length > 0 ? new Set(disabled) : EMPTY_MODEL_SET;
  }
  /**
   * 列出某 provider 的模型启停覆盖，供适配器筛选与设置页渲染。
   * `true` 用户关闭，`false` 用户显式打开，缺键跟随模型的 stale 默认值。
   */
  listDisabledModels(provider) {
    this.ensureLoaded();
    return { ...this.modelCache[provider] ?? {} };
  }
  /**
   * 读取某 provider 的模型参数表（供设置页渲染）。
   *
   * 返回空对象表示「全部模型都跟随默认」—— 与「用户逐项清空」同义，
   * 调用方不需要区分。
   */
  listModelParams(provider) {
    this.ensureLoaded();
    return { ...this.paramCache[provider] ?? {} };
  }
  /**
   * 取单个模型的参数覆盖；无覆盖时返回 `undefined`。
   *
   * 推理关键路径上的调用点：**绝不抛错**，任何异常都退化成「跟随默认」，
   * 不能让一次读取失败把整个模型调用带崩。
   */
  modelParamsFor(provider, modelId) {
    try {
      this.ensureLoaded();
      return this.paramCache[provider]?.[modelId];
    } catch {
      return void 0;
    }
  }
  /**
   * 写入单个模型的参数覆盖。
   *
   * 传 `undefined` 或全空的补丁即**删除该模型的条目**（回到跟随默认）——
   * 参数表缺省补丁会删键，但模型启停覆盖的显式 `false` 必须保留，
   * 两者的缺键语义不同。
   *
   * ⚠️ 只接受有限数值：`NaN`/`Infinity` 会被静默丢弃而不是落盘，
   * 否则一次输入框空值的写入会让该模型从此调不动。
   */
  async setModelParams(provider, modelId, patch) {
    this.ensureLoaded();
    const next = { ...this.paramCache };
    const perProvider = { ...next[provider] ?? {} };
    const clean = {};
    if (patch !== void 0) {
      if (Number.isFinite(patch.contextWindow) && patch.contextWindow > 0) clean.contextWindow = Math.floor(patch.contextWindow);
      if (Number.isFinite(patch.maxTokens) && patch.maxTokens > 0) clean.maxTokens = Math.floor(patch.maxTokens);
      if (typeof patch.reasoningEffort === "string" && patch.reasoningEffort !== "") clean.reasoningEffort = patch.reasoningEffort;
      if (typeof patch.supportsImage === "boolean") clean.supportsImage = patch.supportsImage;
    }
    if (Object.keys(clean).length === 0) delete perProvider[modelId];
    else perProvider[modelId] = clean;
    if (Object.keys(perProvider).length === 0) delete next[provider];
    else next[provider] = perProvider;
    this.paramCache = next;
    this.loaded = true;
    if (this.store.kind === "memory") {
      this.ctx.logger?.warn?.("[channel-pack] \u65E0\u6301\u4E45\u5316\u540E\u7AEF\uFF0C\u6A21\u578B\u53C2\u6570\u53D8\u66F4\u672A\u843D\u76D8");
      return;
    }
    await this.queueStoreSave();
  }
  /**
   * 「本机 OpenAI 网关」当前是否启用。
   *
   * 缺键语义为**启用**（老用户升级后行为不变），见
   * {@link gatewayEnabledCache}。
   */
  gatewayEnabled() {
    this.ensureLoaded();
    return this.gatewayEnabledCache;
  }
  /**
   * 打开/关闭本机 OpenAI 网关并落盘。
   *
   * ⚠️ 这里**只改状态**，不负责启停 HTTP server —— 真正的启停由
   * `src/openai-gateway/runtime.ts` 在调用方做完持久化后接手。两者分开是为了
   * 让「存开关」与「跑进程」各自可单测，且启停失败不会把已写入的开关回滚成
   * 看似没生效的样子。
   */
  async setGatewayEnabled(enabled) {
    this.ensureLoaded();
    if (this.gatewayEnabledCache === enabled) return;
    this.gatewayEnabledCache = enabled;
    this.loaded = true;
    if (this.store.kind === "memory") {
      this.ctx.logger?.warn?.("[channel-pack] \u65E0\u6301\u4E45\u5316\u540E\u7AEF\uFF0C\u7F51\u5173\u5F00\u5173\u4EC5\u672C\u6B21\u4F1A\u8BDD\u6709\u6548");
      return;
    }
    await this.queueStoreSave();
  }
  /**
   * 读取供应商自定义显示顺序（进程内权威副本）。
   *
   * 空数组 = 用户尚未自定义（或老文档没有该键），展示侧按声明顺序渲染。
   */
  providerOrder() {
    this.ensureLoaded();
    return this.providerOrderCache;
  }
  /**
   * 写入供应商自定义显示顺序并落盘。
   *
   * ⚠️ 入参**原样保存**、不在池里做 provider 合法性过滤：合法集合随插件版本
   * 变化，在此过滤会让「新版本加入 provider → 被旧版本代码重写文档」场景下
   * 的顺序无法保留。脏值防护由两层承担：RPC 层校验 `string[]`，
   * store 层 `sanitizeProviderOrder` 去重/剔除非字符串。
   */
  async setProviderOrder(order) {
    this.ensureLoaded();
    const next = Array.isArray(order) ? [...order] : [];
    if (this.providerOrderCache.length === next.length && this.providerOrderCache.every((id, index) => id === next[index])) return;
    this.providerOrderCache = next;
    this.loaded = true;
    if (this.store.kind === "memory") {
      this.ctx.logger?.warn?.("[channel-pack] \u65E0\u6301\u4E45\u5316\u540E\u7AEF\uFF0C\u4F9B\u5E94\u5546\u987A\u5E8F\u4EC5\u672C\u6B21\u4F1A\u8BDD\u6709\u6548");
      return;
    }
    await this.queueStoreSave();
  }
  /**
   * 设置单个模型的用户覆盖：`true` 关闭、`false` 显式打开。
   * 缺键才跟随模型的 stale 默认值，故打开时不能删除键。
   */
  async setModelDisabled(provider, modelId, disabled) {
    this.ensureLoaded();
    if (this.modelCache[provider]?.[modelId] === disabled) return;
    const next = { ...this.modelCache };
    next[provider] = { ...next[provider] ?? {}, [modelId]: disabled };
    await this.writeModels(next);
  }
  /** 批量关闭指定模型：逐项写入 `true`，保留其它模型的用户覆盖。 */
  async setModelsDisabled(provider, modelIds) {
    if (modelIds.length === 0) return;
    this.ensureLoaded();
    const next = { ...this.modelCache };
    const perProvider = { ...next[provider] ?? {} };
    for (const id of modelIds) perProvider[id] = true;
    next[provider] = perProvider;
    await this.writeModels(next);
  }
  /**
   * 按分组显式打开指定模型：包括原本没有覆盖键的 stale 模型。
   * 与 {@link clearDisabledModels} 的「恢复推荐」不同，这里只改传入的 id，
   * 并且必须写入 `false`，否则 stale 模型仍会因缺键而默认关闭。
   */
  async clearModelsDisabled(provider, modelIds) {
    if (modelIds.length === 0) return;
    this.ensureLoaded();
    const perProvider = { ...this.modelCache[provider] ?? {} };
    let changed = false;
    for (const id of modelIds) {
      if (perProvider[id] !== false) {
        perProvider[id] = false;
        changed = true;
      }
    }
    if (!changed) return;
    const next = { ...this.modelCache, [provider]: perProvider };
    await this.writeModels(next);
  }
  /**
   * 批量启用/停用某 provider 的**全部**账号（Channel Pack 左侧供应商一键开关）。
   *
   * ## 为什么需要批量方法
   *
   * 供应商级开关的语义是「关闭该供应商」= 关掉它的全部模型（黑名单）+
   * 停用它的全部账号。前者复用 {@link setModelsDisabled}，后者没有现成路径 ——
   * 逐账号调 {@link updateAccount} 会写 N 次完整文档（且每次都可能与其它
   * provider 的改动互相覆盖），故这里一次落盘。
   *
   * ## 与「账号级开关」的区别（勿混）
   *
   * 账号级开关（账号卡片上的「停用/启用」）只动**单个**账号，且带
   * 「是否连带关闭该 provider 模型」的询问（见前端 `toggleAccount`）。
   * 本方法只动 `enabled`，**不碰模型黑名单**、不做任何询问 ——
   * 模型那侧由调用方（`provider.setEnabled` 端点）按固定顺序显式处理。
   *
   * ## 语义要点
   *
   * - **只改本 provider 的账号**：账号存在一个全局数组里（各 provider 混排），
   *   与 {@link reorderAccounts} 的隔离约定一致，绝不波及其它 provider。
   * - **幂等且无变更不落盘**：全部已是目标状态时直接返回 0，不产生无意义的
   *   文档重写（与 {@link setModelsDisabled} 的「空列表不落盘」同精神）。
   * - ⚠️ **返回「实际变更数」而非「命中数」**：调用方用它给用户提示
   *   （如「已停用 2 个账号」）。若返回命中数，全部本就停用时也会报「已停用 2 个」，
   *   用户会以为发生了他没预料到的改动。
   *
   * @param provider - provider id（`this.product.id`，不要写死字面量）
   * @param enabled - 目标状态：true 启用 / false 停用
   * @returns 实际被改变的账号数
   */
  async setAccountsEnabled(provider, enabled) {
    this.ensureLoaded();
    const accounts = this.cache;
    let changed = 0;
    const next = accounts.map((entry) => {
      if (entry.provider !== provider) return entry;
      const current = entry.enabled !== false;
      if (current === enabled) return entry;
      changed++;
      return { ...entry, enabled };
    });
    if (changed === 0) return 0;
    await this.writeAccounts(next);
    this.ctx.logger?.info?.(
      `[channel-pack] \u5DF2${enabled ? "\u542F\u7528" : "\u505C\u7528"} ${provider} \u7684 ${changed} \u4E2A\u8D26\u53F7`
    );
    return changed;
  }
  /**
   * 清空该 provider 的所有用户覆盖，恢复本地推荐默认值。
   * 不按当前目录筛选键：已下线模型的历史覆盖也一并清理。
   * 清空后普通模型默认打开，stale 模型默认关闭；分组显式打开请用
   * {@link clearModelsDisabled} 写入 `false`，不能用本方法代替。
   */
  async clearDisabledModels(provider, olderIds = []) {
    this.ensureLoaded();
    const defaults = Object.fromEntries([...olderIds].map((id) => [id, true]));
    if (this.modelCache[provider] === void 0 && Object.keys(defaults).length === 0) return;
    const next = { ...this.modelCache };
    delete next[provider];
    if (Object.keys(defaults).length) next[provider] = defaults;
    await this.writeModels(next);
  }
  /**
   * 剔除**当前目录里不存在**的黑名单条目，返回被剔除的 id。
   *
   * 用途：`disabledModels` 是历史累积状态 —— 模型下架后它的开关记录仍留在
   * state.json 里，日积月累会变成一堆指向幽灵 id 的键（用户报障「Loomy 里还有
   * 不存在的 qwen3.8-max」就是这么来的）。
   *
   * ⚠️ **只在目录来源可信（远端真拉成功）时调用**：离线兜底目录只是一份精选表，
   * 用它当作「上游全量」会把用户对表外模型（真实存在但没进兜底表）的偏好删掉。
   *
   * @param keep 当前权威目录里的全部模型 id。
   */
  async pruneDisabledModels(provider, keep) {
    this.ensureLoaded();
    const perProvider = this.modelCache[provider];
    if (perProvider === void 0) return [];
    const stale = Object.keys(perProvider).filter((id) => !keep.has(id));
    if (stale.length === 0) return [];
    const next = { ...this.modelCache };
    const kept = {};
    for (const [id, disabled] of Object.entries(perProvider)) {
      if (keep.has(id)) kept[id] = disabled;
    }
    if (Object.keys(kept).length === 0) delete next[provider];
    else next[provider] = kept;
    await this.writeModels(next);
    return stale;
  }
  /** 持久化模型黑名单（同时更新进程内权威副本）。 */
  async writeModels(disabledModels) {
    this.modelCache = disabledModels;
    this.loaded = true;
    if (this.store.kind === "memory") {
      this.ctx.logger?.warn?.("[channel-pack] \u65E0\u6301\u4E45\u5316\u540E\u7AEF\uFF0C\u6A21\u578B\u9ED1\u540D\u5355\u53D8\u66F4\u672A\u843D\u76D8");
      return;
    }
    await this.queueStoreSave();
  }
  /** 列出某个 provider 的所有账号（含状态信息） */
  async listAccounts(provider) {
    const filtered = this.readAccounts().filter((a) => a.provider === provider);
    const results = [];
    for (const entry of filtered) {
      const status = { ...entry };
      try {
        const info = await this.ctx.credentials.describe(credentialRef(entry.credentialRef));
        status.source = info.source;
      } catch {
      }
      results.push(status);
    }
    return results;
  }
  /** 列出所有 provider 的账号 */
  async listAllAccounts() {
    return this.readAccounts();
  }
  /**
   * 添加新账号（登录成功后调用）。
   *
   * ⚠️ 条目**原样**入池，除 `addAccount` 之外的字段不做白名单化：`plan`
   * （Raccoon 套餐档位）这类「后加的展示/分流字段」由登录成功后的探测写入，
   * 若在这里筛字段就会在下一个版本被静默丢掉。
   */
  async addAccount(entry) {
    const accounts = [...this.readAccounts(), entry];
    await this.writeAccounts(accounts);
  }
  /**
   * 更新账号部分字段。
   *
   * `plan` 与 `nickname`/`enabled` 同级可写：它是**Raccoon 套餐探测**的回填
   * （见 `channel-pack-rpc.ts` 的 raccoon 登录后台任务与
   * `src/backend.ts` 的 `mountRaccoon`）。其余字段（`provider`/`credentialRef`/
   * `id`）刻意不可写 —— 改它们等于把账号搬到另一个池或换掉凭据，必须走
   * 删除 + 新增，否则会留下指向不存在凭据的幽灵条目。
   */
  async updateAccount(id, patch) {
    const accounts = this.readAccounts();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error(`Account ${id} not found`);
    const next = [...accounts];
    next[idx] = { ...next[idx], ...patch };
    await this.writeAccounts(next);
  }
  /** 删除账号（同时清理凭据） */
  async removeAccount(id) {
    const entry = this.readAccounts().find((a) => a.id === id);
    if (!entry) return;
    try {
      await this.ctx.credentials.unset(credentialRef(entry.credentialRef));
    } catch {
    }
    await this.writeAccounts(this.readAccounts().filter((a) => a.id !== id));
  }
  /**
   * 重排某 provider 下账号的顺序（Channel Pack 拖拽排序）。
   *
   * ## 为什么顺序有实际意义
   *
   * 账号列表的数组顺序就是 {@link getAvailableAccount} 的**候选优先级**：
   * 自动选号、限流后的换号重试都按这个顺序取「第一个可用账号」。
   * 因此拖拽不是 UI 装饰，它直接决定实际用哪个账号发请求。
   *
   * ## 只动本 provider 的槽位
   *
   * 账号存在**一个全局数组**里（各 provider 混排，靠 `provider` 字段区分），
   * 而设置页是按 provider 分组渲染的。因此这里取「该 provider 账号原本占用的
   * 那些下标」，把新顺序填回这些下标 —— 其他 provider 的账号**位置不变**。
   *
   * ## 校验：必须是同一集合的一个排列
   *
   * `orderedIds` 必须恰好包含该 provider 的**全部**账号 id（顺序可变、集合不可变）。
   * 不满足就抛错而不是「尽力而为」：
   * - 少了某个 id（前端列表过期，期间账号被别处新增）→ 若静默忽略，那个账号
   *   会莫名其妙掉到末尾，用户看到的是"顺序自己变了"；
   * - 多了未知 id → 说明前端状态与服务端不一致。
   * 两种情况都让用户刷新重试，比悄悄改数据安全。
   *
   * @param provider - provider id
   * @param orderedIds - 该 provider 全部账号 id 的目标顺序
   */
  async reorderAccounts(provider, orderedIds) {
    const accounts = this.readAccounts();
    const indices = [];
    const currentIds = [];
    accounts.forEach((entry, index) => {
      if (entry.provider === provider) {
        indices.push(index);
        currentIds.push(entry.id);
      }
    });
    const expected = new Set(currentIds);
    const got = new Set(orderedIds);
    const sameSet = orderedIds.length === currentIds.length && got.size === orderedIds.length && orderedIds.every((id) => expected.has(id));
    if (!sameSet) {
      throw new Error(
        `\u8D26\u53F7\u5217\u8868\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\uFF08\u671F\u671B ${currentIds.length} \u4E2A\u8D26\u53F7\uFF0C\u6536\u5230 ${orderedIds.length} \u4E2A\uFF09`
      );
    }
    const next = [...accounts];
    indices.forEach((accountIndex, position) => {
      const id = orderedIds[position];
      const source = accounts.find((a) => a.id === id);
      if (source !== void 0) next[accountIndex] = source;
    });
    await this.writeAccounts(next);
    this.ctx.logger?.info?.(`[channel-pack] \u5DF2\u91CD\u6392 ${provider} \u8D26\u53F7\u987A\u5E8F: ${orderedIds.join(", ")}`);
  }
  /**
   * 按凭据内容反查账号 id（供适配器记录"当前用的是哪个账号"）。
   */
  async findAccountIdByCredential(provider, identity) {
    if (identity.length === 0) return "";
    const identifierKey = "access_token";
    for (const entry of this.readAccounts()) {
      if (entry.provider !== provider || !entry.enabled) continue;
      const resolved = await this.resolveCredentialByRef(entry.credentialRef);
      if (resolved === void 0) continue;
      if (resolved[identifierKey] === identity) return entry.id;
    }
    return "";
  }
  /** 解析某个 credentialRef 下的凭据 JSON；不可用时返回 undefined。 */
  async resolveCredentialByRef(refName) {
    try {
      const resolved = await this.ctx.credentials.resolve(credentialRef(refName));
      if (!resolved) return void 0;
      const parsed = JSON.parse(resolved.value);
      return typeof parsed === "object" && parsed !== null ? parsed : void 0;
    } catch {
      return void 0;
    }
  }
  /**
   * 按凭据里的**任意身份字段**查找同 provider 的已有账号。
   *
   * ## 与 {@link findAccountIdByCredential} 的区别
   *
   * ## 为什么必须容忍「字段缺失」
   *
   * 早期登录的凭据里可能**没有**该字段（例如 zcode 的 `user_id` 是
   * 2026-10-02 才补上的）。此时**跳过该条目**（视为「无法判断」），
   * 而不是把它当成「不匹配」或直接报错 —— 前者会漏判，
   * 后者会让老用户根本添加不了账号。
   *
   * @param provider - provider id（如 `zcode`）。
   * @param field - 凭据里用作身份判据的字段名（如 `user_id`）。
   * @param identity - 要比对的值（空串直接返回 `''`，调用方据空串放弃去重）。
   * @returns 匹配到的账号 id；无匹配返回空串。
   */
  async findAccountIdByIdentityField(provider, field, identity) {
    if (identity.length === 0) return "";
    for (const entry of this.readAccounts()) {
      if (entry.provider !== provider) continue;
      const resolved = await this.resolveCredentialByRef(entry.credentialRef);
      if (resolved === void 0) continue;
      const value = resolved[field];
      if (typeof value !== "string" || value.length === 0) continue;
      if (value === identity) return entry.id;
    }
    return "";
  }
  /** 按 id 查找账号条目（含已停用账号）。 */
  findAccount(id) {
    return this.readAccounts().find((a) => a.id === id);
  }
  /** 列出某 provider 的全部账号（含已停用），供「重测所有 / 重置所有」使用。 */
  listAccountsByProvider(provider) {
    return this.readAccounts().filter((a) => a.provider === provider);
  }
  /**
   * 该 provider 是否**至少有一个已登录（凭据可用）的账号**。
   *
   * 供适配器的 `listModels` 做门控：没有已登录账号时返回空目录，让 DSH 的
   * `buildModelCatalog` 把整个 provider 分组隐藏（它显式
   * `.filter(group => group.models.length > 0)`），从而显著减少模型选择
   * 列表里用不上的条目（用户需求：「没有已登录账号就不显示该供应商的所有
   * 模型」）。
   *
   * ## 为什么判据是「凭据可解析」而不是「有条目」
   *
   * 1. **`logout()` 只清凭据、保留账号条目**（删除条目是另一条路径
   *    `removeAccount`）。若只看「有没有条目」，用户登出后模型仍会显示，
   *    门控形同虚设。
   * 2. **不看 `enabled`**：停用只应影响「自动选号」，与「是否已登录」无关。
   *    这与续期调度器「只按 `refreshable` 过滤、不看 `enabled`」是同一条
   *    既有约定（停用账号同样参与积分领取），故这里保持一致。
   *
   * ⚠️ **这是异步的**：需要逐个解析凭据。但只解析到**第一个可用账号**即返回
   * （短路），多账号场景下通常第一次就命中。
   *
   * ⚠️ **本方法只用于「目录展示」的门控**，绝不能用于路由判定 ——
   * DSH 约定 `listModels` 结果仅供参考，隐藏目录不等于拒绝请求
   * （被隐藏的模型仍可 `resolveModel` / 正常收发）。
   */
  async hasLoggedInAccount(provider) {
    for (const entry of this.listAccountsByProvider(provider)) {
      const credential = await this.resolveCredentialByRef(entry.credentialRef);
      if (credential !== void 0) return true;
    }
    return false;
  }
  /**
   * 按账号 id 解析凭据（**不检查 enabled**）。
   *
   * 限流重测必须能对已停用账号发请求（用户明确要求"停用的账号也能发送"），
   * 因此这里刻意与 {@link getAvailableAccount} 的过滤条件区分开：自动选择
   * 只认启用账号，而按 id 的显式探测认全部账号。
   * @returns 凭据对象；账号不存在或凭据不可用时返回 undefined。
   */
  async resolveCredentialForAccount(id) {
    const entry = this.findAccount(id);
    if (entry === void 0) return void 0;
    const parsed = await this.resolveCredentialByRef(entry.credentialRef);
    if (parsed === void 0) return void 0;
    return parsed;
  }
  /**
   * 清除限流标记。
   *
   * @param accountId - 目标账号。
   * @param modelIds - 要清除的模型；省略时清除该账号的**全部**标记。
   * @returns 实际清除的标记数。
   */
  async clearModelRateLimits(accountId, modelIds) {
    const accounts = this.readAccounts();
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx === -1) return 0;
    const entry = accounts[idx];
    const current = entry.modelRateLimits;
    if (!current || Object.keys(current).length === 0) return 0;
    const limits = { ...current };
    let removed = 0;
    const targets = modelIds ?? Object.keys(limits);
    for (const modelId of targets) {
      if (Object.prototype.hasOwnProperty.call(limits, modelId)) {
        delete limits[modelId];
        removed++;
      }
    }
    if (removed === 0) return 0;
    const next = [...accounts];
    const updated = { ...entry };
    if (Object.keys(limits).length === 0) delete updated.modelRateLimits;
    else updated.modelRateLimits = limits;
    next[idx] = updated;
    await this.writeAccounts(next);
    this.ctx.logger?.info?.(
      `[channel-pack] \u5DF2\u6E05\u9664\u9650\u6D41\u6807\u8BB0: \u8D26\u53F7 ${accountId} \u6A21\u578B ${targets.join(", ")}\uFF08\u5171 ${removed} \u6761\uFF09`
    );
    return removed;
  }
  /**
   * 获取指定 provider + 模型的下一个可用账号。
   *
   * `modelId` 为空串时**不做限流过滤**——调用方（provider 的
   * resolveCredential 入口）此时还不知道要发哪个模型，只能退化为
   * "任取一个启用账号"。但 `enabled` 过滤在任何情况下都生效：
   * 停用账号绝不参与自动选择，空 modelId 也不例外。
   *
   * @param provider - provider id（`this.product.id`，不要写死字面量）
   * @param modelId - 目标模型；空串表示不按模型过滤
   * @param excludeAccountIds - 需要跳过的账号 id。
   *
   * **为什么需要 `excludeAccountIds`**：调用方在「请求级轮换」时会逐个换号
   * 重试，必须能拿到**下一个**账号而不是每次都拿回同一个。
   * 本池使用手动顺序或宿主注入的额度顺序，当失败类别**不写限流标记**时
   * （如 5xx / 请求错误 —— 它们不是限流，不该留徽章），
   * 刚失败的账号仍是排序第一，调用方若不排除它就会原地打转、
   * 换号形同虚设。Go 侧对应的是 `PickExcluding(tried)`（`pool.go:131`）。
   *
   * 在池这一层排除（而非让调用方自己跳过）是必要的：调用方只能拿到
   * 「池认为最优的一个」，无法枚举候选自己去重。
   */
  async getAvailableAccount(provider, modelId, excludeAccountIds) {
    const candidates = this.readAccounts().filter((a) => a.provider === provider && a.enabled).filter((a) => excludeAccountIds === void 0 || !excludeAccountIds.has(a.id)).filter((a) => {
      if (modelId.length === 0) return true;
      if (!a.modelRateLimits) return true;
      const resetAt = a.modelRateLimits[modelId];
      return resetAt === void 0 || resetAt === 0 || Date.now() >= resetAt;
    });
    if (candidates.length === 0) return null;
    if (modelId && this.quotaAccountOrder && candidates.length > 1) {
      const order = this.quotaAccountOrder(provider, candidates.map((entry) => entry.id), { modelId });
      const positions = new Map(order.map((id, index) => [id, index]));
      candidates.sort((a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
    }
    const failures = [];
    for (const entry of candidates) {
      let resolved;
      try {
        resolved = await this.ctx.credentials.resolve(credentialRef(entry.credentialRef));
      } catch (error) {
        failures.push(`${entry.id}: \u8BFB\u53D6\u51ED\u636E\u5931\u8D25 (${String(error)})`);
        continue;
      }
      if (!resolved) {
        failures.push(`${entry.id}: \u51ED\u636E\u672A\u914D\u7F6E`);
        continue;
      }
      try {
        const credential = JSON.parse(resolved.value);
        if (failures.length > 0) {
          this.ctx.logger?.warn?.(
            `[channel-pack] ${failures.length} \u4E2A ${provider} \u8D26\u53F7\u4E0D\u53EF\u7528\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A${failures.join("; ")}`
          );
        }
        if (modelId) this.noteQuotaAccount?.(provider, entry.id, modelId);
        return { entry, credential };
      } catch (error) {
        failures.push(`${entry.id}: \u51ED\u636E JSON \u635F\u574F (${String(error)})`);
        continue;
      }
    }
    if (failures.length > 0) {
      this.ctx.logger?.warn?.(
        `[channel-pack] \u6CA1\u6709\u53EF\u7528\u7684 ${provider} \u8D26\u53F7\uFF1A${failures.join("; ")}`
      );
    }
    return null;
  }
  /**
   * 更新某账号某模型的重置时间。
   *
   * 关键：基于**读取到的最新账号列表**做局部合并，再把整个列表写回。
   * settings scope 的 get() 返回的是服务内部快照，可能滞后于磁盘；
   * 但 replace() 是整体替换，因此这里每次都在最新快照上合并，
   * 避免"写 A 的限流 → 读旧快照 → 写 B 的限流"把 A 的记录抹掉。
   *
   * ⚠️ **只接受比现值更大的解禁时刻**（与
   * {@link updateTraeCheckinDeviceGeneration} 同一约定）：
   *
   * 各 provider 的限流解析都有「解析不出时长 → 退回一个兜底值」的末端，而那个兜底
   * 通常是**短**的（cline 是 1 小时，而真实等待可能是 19 小时 39 分）。于是同一个
   * (账号, 模型) 上先写入的**真值**会被后写入的**兜底**覆盖 ——
   * cline「倒计时结束了还是失败，显示又 60 分钟」正是这样无限循环的。
   *
   * 并发场景最容易踩：同一 provider 的两个请求，一个拿到可解析的报文（写 19h39m），
   * 另一个拿到被 CDN 包成 HTML 的 429（写 1h），**后写的赢**。
   *
   * ⇒ 这里取「更长者」。真值被丢掉的风险不用担心：所有调用方写入的都是**未来**
   * 时刻，而过期的标记由 {@link sweepExpiredRateLimits} 清理。
   */
  async updateModelRateLimit(accountId, modelId, resetAtMs) {
    const accounts = this.readAccounts();
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx === -1) {
      this.ctx.logger?.warn?.(
        `[channel-pack] updateModelRateLimit: \u8D26\u53F7 ${accountId} \u4E0D\u5728\u8D26\u53F7\u5217\u8868\u4E2D\uFF08\u5DF2\u77E5: ${accounts.map((a) => a.id).join(", ") || "\u7A7A"}\uFF09`
      );
      return;
    }
    if (!Number.isFinite(resetAtMs)) {
      this.ctx.logger?.warn?.(
        `[channel-pack] updateModelRateLimit: \u8D26\u53F7 ${accountId} \u6A21\u578B ${modelId} \u6536\u5230\u975E\u6709\u9650\u7684\u89E3\u7981\u65F6\u523B ${String(resetAtMs)}\uFF0C\u5DF2\u5FFD\u7565\uFF08\u5426\u5219\u8BE5\u6A21\u578B\u4F1A\u88AB\u6C38\u4E45\u9650\u6D41\uFF09`
      );
      return;
    }
    const current = accounts[idx].modelRateLimits?.[modelId];
    if (Number.isFinite(current) && current >= resetAtMs) {
      this.ctx.logger?.info?.(
        `[channel-pack] updateModelRateLimit: \u8D26\u53F7 ${accountId} \u6A21\u578B ${modelId} \u5DF2\u6709\u66F4\u957F\u7684\u9650\u6D41\u6807\u8BB0 (${new Date(current).toISOString()} \u2265 ${new Date(resetAtMs).toISOString()})\uFF0C\u672C\u6B21\u4E0D\u8986\u76D6`
      );
      return;
    }
    const next = [...accounts];
    const entry = { ...next[idx] };
    entry.modelRateLimits = { ...entry.modelRateLimits, [modelId]: resetAtMs };
    next[idx] = entry;
    await this.writeAccounts(next);
    this.ctx.logger?.info?.(
      `[channel-pack] \u5DF2\u8BB0\u5F55\u9650\u6D41: \u8D26\u53F7 ${accountId} \u6A21\u578B ${modelId} \u91CD\u7F6E\u4E8E ${new Date(resetAtMs).toISOString()}`
    );
  }
  /** 清理已过期的重置时间记录 */
  async sweepExpiredRateLimits() {
    const accounts = this.readAccounts();
    let changed = false;
    const next = accounts.map((entry) => {
      if (!entry.modelRateLimits) return entry;
      const limits = { ...entry.modelRateLimits };
      for (const [modelId, resetAtMs] of Object.entries(limits)) {
        if (resetAtMs > 0 && Date.now() >= resetAtMs) {
          delete limits[modelId];
          changed = true;
        }
      }
      return { ...entry, modelRateLimits: limits };
    });
    if (changed) await this.writeAccounts(next);
  }
  /**
   * 记录 TRAE 签到设备轮换代次（命中 9074 后由积分领取流程调用）。
   *
   * 与 {@link updateModelRateLimit} 同款：在**最新快照**上做局部合并后整体
   * 写回，避免与并发的账号操作互相覆盖。
   *
   * 只接受比现值**更大**的代次，防止乱序/重复回调把代次写回小值而让同一个
   * 被限流的设备号复活。
   */
  async updateTraeCheckinDeviceGeneration(accountId, generation) {
    if (!Number.isFinite(generation) || generation <= 0) return;
    const accounts = this.readAccounts();
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx === -1) {
      this.ctx.logger?.warn?.(
        `[channel-pack] updateTraeCheckinDeviceGeneration: \u8D26\u53F7 ${accountId} \u4E0D\u5728\u8D26\u53F7\u5217\u8868\u4E2D`
      );
      return;
    }
    const current = accounts[idx].traeCheckinDeviceGeneration ?? 0;
    if (generation <= current) return;
    const next = [...accounts];
    next[idx] = { ...next[idx], traeCheckinDeviceGeneration: generation };
    await this.writeAccounts(next);
    this.ctx.logger?.info?.(`[channel-pack] \u8D26\u53F7 ${accountId} \u7B7E\u5230\u8BBE\u5907\u4EE3\u6B21 \u2192 ${generation}`);
  }
  /** 读取 TRAE 签到设备轮换代次（未设置时为 0）。 */
  traeCheckinDeviceGenerationFor(accountId) {
    const entry = this.readAccounts().find((a) => a.id === accountId);
    const value = entry?.traeCheckinDeviceGeneration;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  }
  /**
   * 读取当前完整状态快照（账号列表 + 模型黑名单）。
   *
   * 供备份导出使用：返回的副本与进程内权威副本解耦，调用方修改返回值
   * 不会污染池的运行时状态。`disabledModels` 是嵌套结构，必须深拷贝
   * （浅拷贝会让内层 provider 表仍共享引用）。
   */
  getStateSnapshot() {
    this.ensureLoaded();
    const disabledModels = {};
    for (const [provider, models] of Object.entries(this.modelCache)) {
      disabledModels[provider] = { ...models };
    }
    return {
      accounts: [...this.cache],
      disabledModels
    };
  }
  /**
   * 整体替换账号列表与模型黑名单（备份导入用）。
   *
   * 与 {@link writeAccounts} / {@link writeModels} 的约定一致：整体写入时
   * 必须同时携带账号与黑名单，否则会把另一份数据抹掉。这里一次落盘完成
   * 两件事，避免中间态。
   *
   * ⚠️ 导入数据来自用户提供的备份文件（可能被手工编辑），因此先经
   * `sanitizeAccounts` / `sanitizeDisabledModels` 归一化：只保留可用的
   * 账号条目及显式布尔的模型启停覆盖（`true` 关闭、`false` 打开），
   * 坏条目直接丢弃，而不是写进池里反复触发选号失败。
   */
  async replaceAll(accounts, disabledModels) {
    const next = sanitizeAccounts(accounts);
    this.cache = next;
    this.modelCache = sanitizeDisabledModels(disabledModels);
    this.loaded = true;
    await this.queueStoreSave();
  }
};
async function providerCatalogVisible(accountPool, provider) {
  if (!resolveHideWithoutAccountFlag(process.env.DSH_HIDE_MODELS_WITHOUT_ACCOUNT)) return true;
  if (accountPool === void 0) return true;
  if (typeof accountPool.hasLoggedInAccount !== "function") return true;
  try {
    return await accountPool.hasLoggedInAccount(provider);
  } catch {
    return true;
  }
}
function resolveHideWithoutAccountFlag(raw) {
  if (raw === void 0) return true;
  const value = raw.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "no" || value === "off");
}

// vendor/channel-pack/src/dead-model-store.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var DEAD_MODELS_FILE = "dead-models.json";
var SCHEMA = "channel-pack/dead-models/v1";
var DEFAULT_TTL_DAYS = 30;
var GONE_PATTERNS = [
  /model\s+not\s+found/i,
  /(?:unknown|no\s+such|nonexistent)\s+model/i,
  // ⚠️ OpenAI 标准的 `model_not_found` / `model-not-found` 形态。
  //
  // ⚠️⚠️ 必须要求它**独占一句话成分**（2026-10-06 复审实测）：只加 `\b` 词边界
  // 不够 —— `model_not_found` 在**遥测/日志文案**里常作为**字段名**出现，后面
  // 紧跟别的内容：
  //   error_class=model_not_found, retry allowed      → 初版误判下架
  //   the model_not_found metric was not exported     → 初版误判下架
  //   model_not_found_reason=upstream                 → 初版误判下架
  // 误判会把**可用模型藏 30 天**且用户需手动恢复。
  //
  // ⇒ 后面**只允许**：① 结束；② 句末标点（`.` `!` `?` `;`）；③ 收尾括号/引号；
  // **不含逗号**（`…not_found, retry allowed` 里逗号后仍是另一个字段 ⇒ 不算阳性）。
  /\bmodel[_\-]not[_\-]found\b(?=\s*(?:[.!;?)}\]'"]|$))/i
];
var GONE_TAIL = /(?:(?:does\s*not|doesn'?t)\s+(?:exist|found)|\bnot\s+(?:found|exist)|不存在|未找到|未上线|已下线|已下架)/;
var TOKEN = String.raw`[A-Za-z0-9][A-Za-z0-9._/-]{0,63}`;
function matchesGonePhrase(message) {
  for (const subject of message.matchAll(new RegExp(String.raw`(?:model|模型)["'\x60]?[\s,]*`, "gi"))) {
    const tail = message.slice((subject.index ?? 0) + subject[0].length);
    if (new RegExp(String.raw`^["'\x60]?[\s,]*${GONE_TAIL.source}`, "i").test(tail)) return true;
  }
  for (const subject of message.matchAll(new RegExp(String.raw`(?:model|模型)[\s"'\x60]*(${TOKEN})`, "gi"))) {
    const tail = message.slice((subject.index ?? 0) + subject[0].length);
    if (new RegExp(String.raw`^["'\x60]?[\s,]*${GONE_TAIL.source}`, "i").test(tail)) return true;
  }
  return false;
}
var NOT_GONE_PATTERNS = [
  /\brate\s*-?\s*limit\b/i,
  /\btoo\s+many\s+requests\b/i,
  /\bquota\b/i,
  /\binsufficient\b/i,
  /\bunauthor|\bforbidden\b|\binvalid\s+(?:token|api\s*key|credential)/i,
  // ⚠️ `expired` 必须**带主语**才算认证失败（`token expired` / `session expired`），
  // 否则会误杀正常的下架文案：`model expired-v3 does not exist`、
  // `the model lease expired`（模型租约到期也是下架的一种说法）。
  /\b(?:token|session|credential|key|auth|lease)\s+(?:has\s+|hasn'?t\s+|is\s+|was\s+)?expired\b/i,
  /\bexpired\s+(?:token|session|credential|key|auth)\b/i,
  /限流|限速|额度|余额|积分|排队|繁忙|未登录|认证|鉴权|凭据/
];
var IGNORED_CODES = /* @__PURE__ */ new Set([
  "AUTH",
  "QUOTA_EXCEEDED",
  "RATE_LIMIT",
  "MISSING_CREDENTIAL",
  "PERMISSION_DENIED"
]);
function isModelGoneError(error) {
  if (typeof error !== "object" || error === null) return false;
  const code = error.code;
  if (typeof code === "string" && IGNORED_CODES.has(code)) return false;
  const message = error.message;
  if (typeof message !== "string" || message.length === 0) return false;
  if (NOT_GONE_PATTERNS.some((pattern) => pattern.test(message))) return false;
  if (GONE_PATTERNS.some((pattern) => pattern.test(message))) return true;
  return matchesGonePhrase(message);
}
function ttlMs() {
  const raw = process.env.DSH_DEAD_MODEL_TTL_DAYS;
  if (raw !== void 0 && raw.trim().length > 0) {
    const days = Number(raw.trim());
    if (Number.isFinite(days) && days >= 0) return days * 24 * 60 * 60 * 1e3;
  }
  return DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1e3;
}
function sanitize(parsed) {
  const out = {};
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
  const providers = parsed.providers;
  if (typeof providers !== "object" || providers === null || Array.isArray(providers)) return out;
  for (const [provider, entries] of Object.entries(providers)) {
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) continue;
    const keep = {};
    for (const [modelId, meta] of Object.entries(entries)) {
      if (typeof meta !== "object" || meta === null) continue;
      const at = meta.at;
      if (typeof at !== "string") continue;
      const reason = meta.reason;
      keep[modelId] = {
        at,
        ...typeof reason === "string" ? { reason } : {}
      };
    }
    if (Object.keys(keep).length > 0) out[provider] = keep;
  }
  return out;
}
var MemoryDeadModelStore = class {
  kind = "memory";
  records = {};
  load() {
    return this.records;
  }
  save(records) {
    this.records = records;
  }
};
var FileDeadModelStore = class {
  constructor(path, logger2) {
    this.path = path;
    this.logger = logger2;
  }
  kind = "file";
  load() {
    try {
      if (!existsSync2(this.path)) return {};
      return sanitize(JSON.parse(readFileSync2(this.path, "utf-8")));
    } catch (error) {
      this.logger?.warn(`[channel-pack] \u8BFB\u53D6 ${this.path} \u5931\u8D25\uFF0C\u6309\u65E0\u5931\u6548\u8BB0\u5F55\u5904\u7406: ${String(error)}`);
      return {};
    }
  }
  save(records) {
    mkdirSync2(join2(this.path, ".."), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync2(tmp, JSON.stringify({ schema: SCHEMA, providers: records }, null, 2), "utf-8");
    renameSync2(tmp, this.path);
  }
};
var store;
var cache;
var logger;
var injectedCtx;
function ensureStore() {
  if (store !== void 0) return store;
  const home = resolveChannelPackHome(injectedCtx ?? {});
  if (home === void 0) {
    logger?.warn("[channel-pack] \u65E0\u6CD5\u5B9A\u4F4D DSH home\uFF0C\u5DF2\u5931\u6548\u6A21\u578B\u8BB0\u5F55\u4EC5\u5B58\u5728\u4E8E\u5185\u5B58\u4E2D");
    store = new MemoryDeadModelStore();
  } else {
    store = new FileDeadModelStore(join2(home, "channel-pack", DEAD_MODELS_FILE), logger);
  }
  return store;
}
function configureDeadModelStore(ctx) {
  logger = ctx.logger;
  injectedCtx = ctx;
  if (cache !== void 0 && Object.keys(cache).length > 0 && tryPersist()) {
    store = void 0;
    cache = void 0;
    return;
  }
  store = void 0;
}
function tryPersist(prunedCount = 0) {
  try {
    ensureStore().save(cache ?? {});
    if (prunedCount > 0) {
      logger?.warn(`[channel-pack] \u5DF2\u5931\u6548\u6A21\u578B\u8BB0\u5F55\u6E05\u7406 ${prunedCount} \u6761\uFF08\u8D85\u8FC7 TTL\uFF09`);
    }
    return true;
  } catch (error) {
    logger?.warn(`[channel-pack] \u5DF2\u5931\u6548\u6A21\u578B\u8BB0\u5F55\u5199\u5165\u5931\u8D25: ${String(error)}`);
    return false;
  }
}
function persist(prunedCount = 0) {
  tryPersist(prunedCount);
}
function loadRecords() {
  if (cache !== void 0) return cache;
  const raw = ensureStore().load();
  const ttl = ttlMs();
  const now = Date.now();
  const out = {};
  let pruned = 0;
  for (const [provider, entries] of Object.entries(raw)) {
    const keep = {};
    for (const [modelId, meta] of Object.entries(entries)) {
      if (ttl > 0) {
        const at = Date.parse(meta.at);
        if (!Number.isFinite(at) || now - at > ttl) {
          pruned++;
          continue;
        }
      }
      keep[modelId] = meta;
    }
    if (Object.keys(keep).length > 0) out[provider] = keep;
  }
  cache = out;
  if (pruned > 0) persist(pruned);
  return out;
}
function recordDeadModel(provider, modelId, reason) {
  if (provider.length === 0 || modelId.length === 0) return false;
  const records = loadRecords();
  const bucket = records[provider] ?? (records[provider] = {});
  if (bucket[modelId] !== void 0) return false;
  bucket[modelId] = {
    at: (/* @__PURE__ */ new Date()).toISOString(),
    ...reason === void 0 ? {} : { reason }
  };
  persist();
  logger?.warn(
    `[channel-pack] \u6A21\u578B ${provider}/${modelId} \u5DF2\u88AB\u5224\u4E3A\u5931\u6548\uFF08${reason ?? "model not found"}\uFF09\uFF0C\u6B64\u540E\u4E0D\u518D\u5217\u5165\u6A21\u578B\u5217\u8868`
  );
  return true;
}
function deadModelIdsFor(provider) {
  const bucket = loadRecords()[provider];
  return bucket === void 0 ? /* @__PURE__ */ new Set() : new Set(Object.keys(bucket));
}
function clearDeadModels(provider, modelId) {
  if (provider.length === 0) return 0;
  const records = loadRecords();
  const bucket = records[provider];
  if (bucket === void 0) return 0;
  let removed = 0;
  if (modelId === void 0) {
    removed = Object.keys(bucket).length;
    delete records[provider];
  } else if (modelId.length > 0 && bucket[modelId] !== void 0) {
    delete bucket[modelId];
    removed = 1;
    if (Object.keys(bucket).length === 0) delete records[provider];
  }
  if (removed > 0) {
    persist();
    logger?.warn(
      `[channel-pack] \u5DF2\u6062\u590D ${removed} \u4E2A\u5931\u6548\u6A21\u578B\uFF08${provider}${modelId === void 0 ? "" : `/${modelId}`}\uFF09\uFF0C\u5B83\u4EEC\u5C06\u91CD\u65B0\u51FA\u73B0\u5728\u6A21\u578B\u5217\u8868\u4E2D`
    );
  }
  return removed;
}
function filterList(providers, list) {
  if (!Array.isArray(list) || list.length === 0) return list;
  const dead = /* @__PURE__ */ new Set();
  for (const provider of providers) {
    for (const id of deadModelIdsFor(provider)) dead.add(id);
  }
  if (dead.size === 0) return list;
  const kept = list.filter((item) => {
    if (item === null || typeof item !== "object") return true;
    const id = item.id;
    return !(typeof id === "string" && dead.has(id));
  });
  return kept.length === list.length ? list : kept;
}
function ownerOf(ids, candidate) {
  return typeof candidate === "string" && ids.includes(candidate) ? candidate : ids[0];
}
function trackStream(provider, inner, modelId) {
  return (async function* tracked() {
    try {
      yield* inner;
    } catch (error) {
      if (typeof modelId === "string" && isModelGoneError(error)) {
        recordDeadModel(provider, modelId, error.message);
      }
      throw error;
    }
  })();
}
function withDeadModelPruning(providers, adapter) {
  const ids = providers.filter((id) => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return adapter;
  const target = adapter;
  const bound = /* @__PURE__ */ new Map();
  const wrapOnce = (key, make) => {
    if (!bound.has(key)) bound.set(key, make());
    return bound.get(key);
  };
  return new Proxy(adapter, {
    get(obj, prop, receiver) {
      if (prop === "listModels" && typeof target.listModels === "function") {
        return wrapOnce(prop, () => async (...args) => filterList(ids, await target.listModels.apply(obj, args)));
      }
      if (prop === "listAllModels" && typeof target.listAllModels === "function") {
        return wrapOnce(prop, () => (...args) => filterList(ids, target.listAllModels.apply(obj, args)));
      }
      if (prop === "stream" && typeof target.stream === "function") {
        return wrapOnce(prop, () => (options) => trackStream(
          ownerOf(ids, options?.provider),
          target.stream.apply(obj, [options]),
          options?.model
        ));
      }
      if (prop === "prepareCall" && typeof target.prepareCall === "function") {
        return wrapOnce(prop, () => async (...args) => {
          const call = await target.prepareCall.apply(obj, args);
          if (call === null || typeof call !== "object" || typeof call.stream !== "function") return call;
          return {
            ...call,
            stream: (options) => trackStream(
              // dispatch 时的 options.provider 更贴近真实路由（dsh-llm 会带上）；
              // 没有或不在 ids 内才回退到 prepareCall 的实参，最后才回退 ids[0]。
              ownerOf(ids, options?.provider ?? args[0]),
              call.stream(options),
              options?.model
            )
          };
        });
      }
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function") return value;
      return wrapOnce(prop, () => value.bind(obj));
    }
  });
}

// vendor/channel-pack/src/token-ledger.ts
var TOKEN_LEDGER_LIMIT = 500;
var ledger = [];
var reportedAccounts = /* @__PURE__ */ new Map();
function reportLedgerAccount(provider, accountId) {
  try {
    if (typeof provider !== "string" || provider.length === 0) return;
    if (typeof accountId !== "string" || accountId.length === 0) return;
    reportedAccounts.set(provider.slice(0, 64), accountId.slice(0, 64));
  } catch {
  }
}
function peekLedgerAccount(provider) {
  return reportedAccounts.get(provider) ?? "";
}
var backend;
var backendToken;
function attachTokenLedgerStore(next) {
  backend = next;
  const token = {};
  backendToken = token;
  return () => {
    if (backendToken === token) {
      backend = void 0;
      backendToken = void 0;
    }
  };
}
function readTokenLedgerDayMap() {
  return backend?.load() ?? /* @__PURE__ */ new Map();
}
function utc8DayKey(ts) {
  const shifted = new Date(ts + 8 * 60 * 60 * 1e3);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}
function clampCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}
function recordTokenUsage(entry) {
  try {
    const usageReported = entry.usageReported === true;
    const cacheRead = clampCount(entry.cacheReadTokens);
    const cacheWrite = clampCount(entry.cacheWriteTokens);
    const reasoning = clampCount(entry.reasoningTokens);
    const accountId = typeof entry.accountId === "string" ? entry.accountId.slice(0, 64) : "";
    const ttft = clampCount(entry.ttftMs);
    const duration = clampCount(entry.durationMs);
    const outputTokens = clampCount(entry.outputTokens);
    const decodeMs = duration - ttft;
    const tps = ttft > 0 && decodeMs > 0 && usageReported ? Math.round(outputTokens / (decodeMs / 1e3) * 10) / 10 : void 0;
    const record = Object.freeze({
      ts: Date.now(),
      // channel 只认两个合法值，垃圾值一律落回 `direct`（保守缺省）。
      channel: entry.channel === "gateway" ? "gateway" : "direct",
      provider: String(entry.provider ?? "").slice(0, 64),
      model: String(entry.model ?? "").slice(0, 160),
      ...accountId.length > 0 ? { accountId } : {},
      usageReported,
      inputTokens: clampCount(entry.inputTokens),
      outputTokens,
      // ⚠️ 0 / 缺失一律**省略字段**而不是写 0：与接口注释一致，
      // 「没有缓存命中」与「命中 0 个」无从区分时，缺省是更诚实的表示。
      ...cacheRead > 0 ? { cacheReadTokens: cacheRead } : {},
      ...cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {},
      ...reasoning > 0 ? { reasoningTokens: reasoning } : {},
      // 首字用时：0 = 无任何块（失败/秒回空）⇒ 省略（不可测 ≠ 0ms）。
      ...ttft > 0 ? { ttftMs: ttft } : {},
      ...tps !== void 0 ? { tps } : {},
      durationMs: duration,
      ...typeof entry.error === "string" && entry.error.length > 0 ? { error: entry.error.slice(0, 200) } : {}
    });
    ledger.unshift(record);
    if (ledger.length > TOKEN_LEDGER_LIMIT) ledger.length = TOKEN_LEDGER_LIMIT;
    try {
      backend?.append(record);
    } catch {
    }
  } catch {
  }
}
function emptyTotals() {
  return {
    requests: 0,
    reportedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    errors: 0,
    // 均值的**累加器**：先攒 Σ 与份数，读取收尾时才算除法（见 finalizeAverages）。
    ttftSumMs: 0,
    ttftCount: 0,
    tpsSum: 0,
    tpsCount: 0
  };
}
function finalizeAverages(t) {
  return {
    requests: t.requests,
    reportedRequests: t.reportedRequests,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    cacheReadTokens: t.cacheReadTokens,
    cacheWriteTokens: t.cacheWriteTokens,
    reasoningTokens: t.reasoningTokens,
    errors: t.errors,
    ...t.ttftCount > 0 ? { avgTtftMs: Math.round(t.ttftSumMs / t.ttftCount) } : {},
    ...t.tpsCount > 0 ? { avgTps: Math.round(t.tpsSum / t.tpsCount * 10) / 10 } : {}
  };
}
function accumulate(totals, entry) {
  totals.requests += 1;
  if (entry.usageReported) totals.reportedRequests += 1;
  if (entry.error !== void 0) totals.errors += 1;
  if (entry.ttftMs !== void 0 && entry.ttftMs > 0) {
    totals.ttftSumMs += entry.ttftMs;
    totals.ttftCount += 1;
  }
  if (entry.tps !== void 0 && entry.tps > 0) {
    totals.tpsSum += entry.tps;
    totals.tpsCount += 1;
  }
  if (!entry.usageReported) return;
  totals.inputTokens += entry.inputTokens;
  totals.outputTokens += entry.outputTokens;
  totals.cacheReadTokens += entry.cacheReadTokens ?? 0;
  totals.cacheWriteTokens += entry.cacheWriteTokens ?? 0;
  totals.reasoningTokens += entry.reasoningTokens ?? 0;
}
function sumTokens(t) {
  return t.inputTokens + t.outputTokens;
}
function readTokenLedger(options = {}) {
  const limit = Math.max(0, Math.min(options.limit ?? TOKEN_LEDGER_LIMIT, TOKEN_LEDGER_LIMIT));
  const totals = emptyTotals();
  const channelMap = /* @__PURE__ */ new Map();
  for (const entry of ledger) {
    accumulate(totals, entry);
    let providers = channelMap.get(entry.channel);
    if (providers === void 0) {
      providers = /* @__PURE__ */ new Map();
      channelMap.set(entry.channel, providers);
    }
    let accounts = providers.get(entry.provider);
    if (accounts === void 0) {
      accounts = /* @__PURE__ */ new Map();
      providers.set(entry.provider, accounts);
    }
    const accountKey = entry.accountId !== void 0 && entry.accountId.length > 0 ? entry.accountId : "-";
    let models = accounts.get(accountKey);
    if (models === void 0) {
      models = /* @__PURE__ */ new Map();
      accounts.set(accountKey, models);
    }
    let row = models.get(entry.model);
    if (row === void 0) {
      row = emptyTotals();
      models.set(entry.model, row);
    }
    accumulate(row, entry);
  }
  const channels = [...channelMap.entries()].sort(([a], [b]) => (a === "direct" ? -1 : 1) - (b === "direct" ? -1 : 1)).map(([channel, providers]) => {
    const channelTotals = emptyTotals();
    const providerRows = [...providers.entries()].map(([provider, accounts]) => {
      const providerTotals = emptyTotals();
      const accountRows = [...accounts.entries()].map(([accountId, models]) => {
        const accountTotals = emptyTotals();
        const modelRows = [...models.entries()].map(([model, row]) => {
          for (const key of Object.keys(row)) {
            accountTotals[key] += row[key] ?? 0;
          }
          return { model, ...finalizeAverages(row) };
        }).sort((a, b) => sumTokens(b) - sumTokens(a));
        for (const key of Object.keys(accountTotals)) {
          providerTotals[key] += accountTotals[key] ?? 0;
        }
        return { accountId, models: modelRows, totals: finalizeAverages(accountTotals) };
      }).sort((a, b) => sumTokens(b.totals) - sumTokens(a.totals));
      for (const key of Object.keys(providerTotals)) {
        channelTotals[key] += providerTotals[key] ?? 0;
      }
      return { provider, accounts: accountRows, totals: finalizeAverages(providerTotals) };
    }).sort((a, b) => sumTokens(b.totals) - sumTokens(a.totals));
    return { channel, providers: providerRows, totals: finalizeAverages(channelTotals) };
  });
  return {
    channels,
    totals: finalizeAverages(totals),
    entries: ledger.slice(0, limit)
  };
}
function dayBucketKeyOf(key) {
  const esc = (s) => s.replaceAll("|", "/");
  return `${key.channel}|${esc(key.provider)}|${esc(key.accountId)}|${esc(key.model)}`;
}
function mergeDayEntry(days, entry) {
  const day = utc8DayKey(entry.ts);
  let buckets = days.get(day);
  if (buckets === void 0) {
    buckets = /* @__PURE__ */ new Map();
    days.set(day, buckets);
  }
  const key = dayBucketKeyOf({
    channel: entry.channel,
    provider: entry.provider,
    accountId: entry.accountId ?? "",
    model: entry.model
  });
  let bucket = buckets.get(key);
  if (bucket === void 0) {
    bucket = {
      requests: 0,
      reportedRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      errors: 0,
      ttftSumMs: 0,
      ttftCount: 0,
      tpsSum: 0,
      tpsCount: 0
    };
    buckets.set(key, bucket);
  }
  bucket.requests += 1;
  if (entry.usageReported) bucket.reportedRequests += 1;
  if (entry.error !== void 0) bucket.errors += 1;
  if (entry.ttftMs !== void 0 && entry.ttftMs > 0) {
    bucket.ttftSumMs += entry.ttftMs;
    bucket.ttftCount += 1;
  }
  if (entry.tps !== void 0 && entry.tps > 0) {
    bucket.tpsSum += entry.tps;
    bucket.tpsCount += 1;
  }
  if (!entry.usageReported) return;
  bucket.inputTokens += entry.inputTokens;
  bucket.outputTokens += entry.outputTokens;
  bucket.cacheReadTokens += entry.cacheReadTokens ?? 0;
  bucket.cacheWriteTokens += entry.cacheWriteTokens ?? 0;
  bucket.reasoningTokens += entry.reasoningTokens ?? 0;
}
function parseDayBucketKey(key) {
  const parts = key.split("|");
  if (parts.length !== 4) return void 0;
  const [channel, provider, accountId, model] = parts;
  if (channel !== "direct" && channel !== "gateway") return void 0;
  return { channel, provider, accountId: accountId ?? "", model: model ?? "" };
}
function readTokenLedgerHistory(days, options = {}) {
  const sinceDaysRaw = options.sinceDays;
  const sinceDays = typeof sinceDaysRaw === "number" && Number.isFinite(sinceDaysRaw) && sinceDaysRaw > 0 ? Math.floor(sinceDaysRaw) : void 0;
  const todayKey = utc8DayKey(Date.now());
  const cutoffKey = sinceDays === void 0 ? void 0 : utc8DayKey(Date.now() - (sinceDays - 1) * 24 * 60 * 60 * 1e3);
  const grandTotals = emptyTotals();
  const historyDays = [];
  const dayKeys = [...days.keys()].sort((a, b) => b.localeCompare(a));
  for (const day of dayKeys) {
    if (day > todayKey) continue;
    if (cutoffKey !== void 0 && day < cutoffKey) continue;
    const buckets = days.get(day);
    if (buckets === void 0 || buckets.size === 0) continue;
    const dayTotals = emptyTotals();
    const channelMap = /* @__PURE__ */ new Map();
    for (const [key, bucket] of buckets) {
      const parsed = parseDayBucketKey(key);
      if (parsed === void 0) continue;
      let providers = channelMap.get(parsed.channel);
      if (providers === void 0) {
        providers = /* @__PURE__ */ new Map();
        channelMap.set(parsed.channel, providers);
      }
      const accountKey = parsed.accountId.length > 0 ? parsed.accountId : "-";
      let accounts = providers.get(parsed.provider);
      if (accounts === void 0) {
        accounts = /* @__PURE__ */ new Map();
        providers.set(parsed.provider, accounts);
      }
      let models = accounts.get(accountKey);
      if (models === void 0) {
        models = /* @__PURE__ */ new Map();
        accounts.set(accountKey, models);
      }
      models.set(parsed.model, bucket);
    }
    const channels = [...channelMap.entries()].sort(([a], [b]) => (a === "direct" ? -1 : 1) - (b === "direct" ? -1 : 1)).map(([channel, providers]) => {
      const channelTotals = emptyTotals();
      const providerRows = [...providers.entries()].map(([provider, accounts]) => {
        const providerTotals = emptyTotals();
        const accountRows = [...accounts.entries()].map(([accountId, models]) => {
          const accountTotals = emptyTotals();
          const modelRows = [...models.entries()].map(([model, bucket]) => {
            for (const k of Object.keys(bucket)) {
              accountTotals[k] += bucket[k] ?? 0;
            }
            return { model, ...finalizeAverages(bucket) };
          }).sort((a, b) => sumTokens(b) - sumTokens(a));
          for (const k of Object.keys(accountTotals)) {
            providerTotals[k] += accountTotals[k] ?? 0;
          }
          return { accountId, models: modelRows, totals: finalizeAverages(accountTotals) };
        }).sort((a, b) => sumTokens(b.totals) - sumTokens(a.totals));
        for (const k of Object.keys(providerTotals)) {
          channelTotals[k] += providerTotals[k] ?? 0;
        }
        return { provider, accounts: accountRows, totals: finalizeAverages(providerTotals) };
      }).sort((a, b) => sumTokens(b.totals) - sumTokens(a.totals));
      for (const k of Object.keys(channelTotals)) {
        dayTotals[k] += channelTotals[k] ?? 0;
      }
      return { channel, providers: providerRows, totals: finalizeAverages(channelTotals) };
    });
    accumulateBucket(grandTotals, dayTotals);
    historyDays.push({ day, channels, totals: finalizeAverages(dayTotals) });
  }
  return { days: historyDays, totals: finalizeAverages(grandTotals) };
}
function accumulateBucket(target, source) {
  for (const key of Object.keys(source)) {
    target[key] += source[key] ?? 0;
  }
}
var TOKEN_LEDGER_HISTORY_MAX_DAYS = 90;

// vendor/channel-pack/src/token-ledger-store.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, renameSync as renameSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
var TOKEN_LEDGER_FILE = "token-ledger.json";
var TOKEN_LEDGER_DAYS = 90;
var TOKEN_LEDGER_FLUSH_MS = 2e3;
var SCHEMA2 = "channel-pack/token-ledger/v1";
function pruneDays(days) {
  const cutoff = Date.now() + 8 * 60 * 60 * 1e3 - TOKEN_LEDGER_DAYS * 24 * 60 * 60 * 1e3;
  const pruned = /* @__PURE__ */ new Map();
  for (const [day, buckets] of days) {
    const dayStartUtc8 = Date.parse(`${day}T00:00:00Z`) - 8 * 60 * 60 * 1e3;
    if (Number.isFinite(dayStartUtc8) && dayStartUtc8 < cutoff) continue;
    pruned.set(day, buckets);
  }
  return pruned;
}
var MemoryLedgerStore = class {
  days = /* @__PURE__ */ new Map();
  load() {
    return this.days;
  }
  append(entry) {
    mergeDayEntry(this.days, entry);
  }
  flush() {
  }
};
var FileLedgerStore = class {
  constructor(path, logger2) {
    this.path = path;
    this.logger = logger2;
    this.days = this.readFile();
    this.written = cloneDays(this.days);
  }
  days = /* @__PURE__ */ new Map();
  /**
   * **已落盘基线**：上次成功写盘时各桶的快照。
   *
   * `flush()` 只把「相对本基线新增的增量」合并进**盘上当前内容**（见 flush 的
   * 注释）。基线在每次成功写盘后前移。
   */
  written = /* @__PURE__ */ new Map();
  /** 防抖计时器（Node 返回值带 unref，浏览器/测试环境可能没有）。 */
  timer;
  /** 节流窗口内又发生了写入时，flush 后需要再排一次。 */
  dirty = false;
  /** 从磁盘读日聚合（构造时用；返回**空表**表示无盘/损坏）。 */
  readFile() {
    const out = /* @__PURE__ */ new Map();
    try {
      if (!existsSync3(this.path)) return out;
      const parsed = JSON.parse(readFileSync3(this.path, "utf-8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
      const record = parsed;
      if (typeof record.days !== "object" || record.days === null || Array.isArray(record.days)) return out;
      for (const [day, rawBuckets] of Object.entries(record.days)) {
        if (typeof rawBuckets !== "object" || rawBuckets === null || Array.isArray(rawBuckets)) continue;
        const bucketList = rawBuckets;
        const target = /* @__PURE__ */ new Map();
        for (const [key, rawBucket] of Object.entries(bucketList)) {
          if (typeof rawBucket !== "object" || rawBucket === null) continue;
          const b = rawBucket;
          target.set(key, {
            requests: Number(b.requests) || 0,
            reportedRequests: Number(b.reportedRequests) || 0,
            inputTokens: Number(b.inputTokens) || 0,
            outputTokens: Number(b.outputTokens) || 0,
            cacheReadTokens: Number(b.cacheReadTokens) || 0,
            cacheWriteTokens: Number(b.cacheWriteTokens) || 0,
            reasoningTokens: Number(b.reasoningTokens) || 0,
            errors: Number(b.errors) || 0,
            // Σ/份数（第 3 期均值）：旧文档没这些键 → 0（等价于无样本）。
            ttftSumMs: Number(b.ttftSumMs) || 0,
            ttftCount: Number(b.ttftCount) || 0,
            tpsSum: Number(b.tpsSum) || 0,
            tpsCount: Number(b.tpsCount) || 0
          });
        }
        out.set(day, target);
      }
    } catch (error) {
      this.logger?.warn(`[channel-pack] \u8BFB\u53D6 ${this.path} \u5931\u8D25\uFF0C\u5386\u53F2\u7528\u91CF\u6309\u7A7A\u8868\u5904\u7406: ${String(error)}`);
      return /* @__PURE__ */ new Map();
    }
    return out;
  }
  /** 纯内存读（不碰磁盘）—— 见接口注释。 */
  load() {
    return this.days;
  }
  append(entry) {
    mergeDayEntry(this.days, entry);
    this.scheduleFlush();
  }
  /** 节流落盘：窗口内首笔启动计时器，到点刷盘；期间新写入标记 dirty 再刷一轮。 */
  scheduleFlush() {
    if (this.timer !== void 0) {
      this.dirty = true;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = void 0;
      try {
        this.flush();
      } finally {
        if (this.dirty) {
          this.dirty = false;
          this.scheduleFlush();
        }
      }
    }, TOKEN_LEDGER_FLUSH_MS);
    this.timer.unref?.();
  }
  /**
   * **增量合并写**（不是整体覆盖）。
   *
   * ## 为什么必须合并（真实缺陷，审计发现并已复现）
   *
   * 整体覆盖只在**单实例**下安全。两个实例并存时（fiber 重启交错期间新旧两个
   * store 都在；或同机多 profile 共享同一个 home —— `state.json` 的独立文档先例
   * 开篇与本文档模块头都明载这一点），各自的内存视图独立，**谁后写谁抹掉对方**：
   *
   * ```
   * O 记 100（未 flush）        : 盘 = 0
   * N（新实例）记 1 并 flush    : 盘 = 1
   * O.flush()（旧 fiber dispose）: 盘 = 100   ← N 的 1 被抹掉
   * N 再记 5 并 flush           : 盘 = 6     ← O 的 100 也丢了（双向丢失，期望 106）
   * ```
   *
   * ⚠️ 修「构造时读盘」只解决**顺序**场景（新实例读到旧数据），解决不了**并存**
   * 场景 —— 后者必须靠合并。
   *
   * ## 算法
   *
   * 1. 重读盘上**当前**内容（别的实例可能刚写过）；
   * 2. 只把「相对本实例上次写盘基线 {@link written} 的**增量**」逐桶累加上去；
   * 3. 原子写（tmp + rename），成功后基线前移。
   *
   * 增量 = 当前内存值 − 上次落盘时的值（逐字段相减，负数钳到 0 防手工编辑倒挂）。
   */
  flush() {
    try {
      mkdirSync3(join3(this.path, ".."), { recursive: true });
      const merged = this.readFile();
      let hasDelta = false;
      for (const [day, buckets] of this.days) {
        const base = this.written.get(day);
        let target = merged.get(day);
        for (const [key, bucket] of buckets) {
          const delta = subtractBucket(bucket, base?.get(key));
          if (delta === void 0) continue;
          hasDelta = true;
          if (target === void 0) {
            target = /* @__PURE__ */ new Map();
            merged.set(day, target);
          }
          const existing = target.get(key);
          if (existing === void 0) {
            target.set(key, delta);
          } else {
            target.set(key, addBucket(existing, delta));
          }
        }
      }
      if (!hasDelta) return;
      const days = {};
      for (const [day, buckets] of pruneDays(merged)) {
        days[day] = Object.fromEntries(buckets);
      }
      const tmp = `${this.path}.tmp`;
      writeFileSync3(tmp, JSON.stringify({ schema: SCHEMA2, days }, null, 2), "utf-8");
      renameSync3(tmp, this.path);
      this.written = cloneDays(this.days);
    } catch (error) {
      this.logger?.warn(`[channel-pack] \u5199\u5165 ${this.path} \u5931\u8D25\uFF08\u672C\u6B21\u7EDF\u8BA1\u4E0D\u5165\u76D8\uFF09: ${String(error)}`);
    }
  }
};
function cloneDays(days) {
  const out = /* @__PURE__ */ new Map();
  for (const [day, buckets] of days) {
    out.set(day, new Map([...buckets].map(([key, bucket]) => [key, { ...bucket }])));
  }
  return out;
}
function addBucket(a, b) {
  return {
    requests: a.requests + b.requests,
    reportedRequests: a.reportedRequests + b.reportedRequests,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    errors: a.errors + b.errors,
    ttftSumMs: a.ttftSumMs + b.ttftSumMs,
    ttftCount: a.ttftCount + b.ttftCount,
    tpsSum: a.tpsSum + b.tpsSum,
    tpsCount: a.tpsCount + b.tpsCount
  };
}
function subtractBucket(current, base) {
  if (base === void 0) {
    return isZeroBucket(current) ? void 0 : { ...current };
  }
  const diff = (a, b) => Math.max(0, a - b);
  const delta = {
    requests: diff(current.requests, base.requests),
    reportedRequests: diff(current.reportedRequests, base.reportedRequests),
    inputTokens: diff(current.inputTokens, base.inputTokens),
    outputTokens: diff(current.outputTokens, base.outputTokens),
    cacheReadTokens: diff(current.cacheReadTokens, base.cacheReadTokens),
    cacheWriteTokens: diff(current.cacheWriteTokens, base.cacheWriteTokens),
    reasoningTokens: diff(current.reasoningTokens, base.reasoningTokens),
    errors: diff(current.errors, base.errors),
    ttftSumMs: diff(current.ttftSumMs, base.ttftSumMs),
    ttftCount: diff(current.ttftCount, base.ttftCount),
    tpsSum: diff(current.tpsSum, base.tpsSum),
    tpsCount: diff(current.tpsCount, base.tpsCount)
  };
  return isZeroBucket(delta) ? void 0 : delta;
}
function isZeroBucket(bucket) {
  return bucket.requests === 0 && bucket.reportedRequests === 0 && bucket.inputTokens === 0 && bucket.outputTokens === 0 && bucket.cacheReadTokens === 0 && bucket.cacheWriteTokens === 0 && bucket.reasoningTokens === 0 && bucket.errors === 0 && bucket.ttftSumMs === 0 && bucket.ttftCount === 0 && bucket.tpsSum === 0 && bucket.tpsCount === 0;
}
function createTokenLedgerStore(ctx) {
  const home = resolveChannelPackHome(ctx);
  if (home === void 0) {
    ctx.logger?.warn?.("[channel-pack] \u65E0\u6CD5\u5B9A\u4F4D DSH home\uFF0CToken \u7528\u91CF\u5386\u53F2\u4EC5\u5B58\u5728\u4E8E\u5185\u5B58\u4E2D");
    return new MemoryLedgerStore();
  }
  return new FileLedgerStore(join3(home, "channel-pack", TOKEN_LEDGER_FILE), ctx.logger);
}

// vendor/channel-pack/src/channel-pack-rpc.ts
import { credentialRef as credentialRef4 } from "@deepseek-ai/dsh-credentials";

// vendor/channel-pack/src/model-selection.ts
function isModelDisabled(model, overrides, exclusions) {
  const override = overrides[model.id];
  return typeof override === "boolean" ? override : model.stale === true || exclusions?.has(model.id) === true;
}

// lib/model-catalog.js
var modelBrands = {
  claude: "Claude",
  deepseek: "DeepSeek",
  doubao: "Doubao",
  ernie: "ERNIE",
  gemini: "Gemini",
  glm: "GLM",
  gpt: "GPT",
  grok: "Grok",
  hy: "Hy",
  kimi: "Kimi",
  llama: "Llama",
  mimo: "MiMo",
  minimax: "MiniMax",
  qwen: "Qwen",
  sensenova: "SenseNova",
  spark: "Spark",
  codebuddy: "CodeBuddy",
  workbuddy: "WorkBuddy",
  api: "API",
  vl: "VL",
  vllm: "vLLM"
};
var modelAliases = /* @__PURE__ */ new Map([
  ["qmodel_38max", "Qwen 3.8 Max"],
  ["qmodel_latest", "Qwen 3.8 Max"],
  ["qfmodel", "Qwen 3.8 Flash"],
  ["dmodel", "DeepSeek V4 Pro"],
  ["dfmodel", "DeepSeek Flash"],
  ["gmodel", "GLM 5.3"],
  ["gfmodel", "GLM 5.3 Flash"],
  ["kmodel_latest", "Kimi K3.1 Pro"],
  ["kmodel", "Kimi K2.8 Preview"],
  ["mmodel", "MiniMax M3.1 Flash"],
  ["hy4std", "Hy4"],
  ["hy4flash", "Hy4 Flash"],
  ["hy4flash-free", "Hy4 Flash"],
  ["xopglm52", "GLM 5.2"],
  ["xopglm51", "GLM 5.1"],
  ["xopdsv4flash0731in", "DeepSeek V4 Flash"],
  ["xdeepseek-flash-in", "DeepSeek V4.1 Flash"],
  ["xopdeepseekv4pro0813", "DeepSeek V4 Pro"],
  ["xopdeepseekv4pro", "DeepSeek V4 Pro"]
]);
var gluedBrands = /^(qwen|glm|gpt|llama|grok|gemini)(?=\d)/i;
function readableModelName(id, name) {
  const source = typeof name === "string" && name.trim() || typeof id === "string" && id.trim() || "";
  const alias = modelAliases.get(source.toLowerCase());
  if (alias) return alias;
  const repeatedId = source.endsWith(")") ? source.lastIndexOf(" (") : -1;
  const label = repeatedId >= 0 && source.slice(repeatedId + 2, -1).toLowerCase() === id?.toLowerCase() ? source.slice(0, repeatedId) : source;
  return label.split(/\s+/).map((part) => {
    let slug = part;
    if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(slug)) slug = slug.slice(slug.indexOf("/") + 1);
    slug = slug.replace(/^sn-(sensenova|qwen|glm|kimi|deepseek)(.*?)(?:-p)?$/i, "$1$2");
    if (/^[a-z0-9.]+(?:[-_][a-z0-9.]+)+$/i.test(slug) || gluedBrands.test(slug)) {
      return slug.replace(/(?<=\d)[-_](?=\d{1,2}(?:[-_]|$))/g, ".").replace(gluedBrands, "$1 ").split(/[-_ ]+/).map((word) => Object.hasOwn(modelBrands, word.toLowerCase()) ? modelBrands[word.toLowerCase()] : word[0].toUpperCase() + word.slice(1)).join(" ");
    }
    return Object.hasOwn(modelBrands, slug.toLowerCase()) ? modelBrands[slug.toLowerCase()] : slug;
  }).join(" ");
}
function defaultModelOutputTokens(output, context) {
  if (Number.isSafeInteger(output) && output > 0) return output;
  return Number.isSafeInteger(context) && context > 0 ? Math.min(context, 32768) : 32768;
}
var THINKING_EFFORT_RANK = Object.freeze({
  off: 0,
  none: 0,
  minimal: 1,
  level_1: 1,
  light: 2,
  low: 3,
  level_2: 3,
  medium: 4,
  level_3: 4,
  high: 5,
  on: 5,
  level_4: 5,
  extra_high: 6,
  xhigh: 7,
  level_5: 7,
  max: 8,
  ultra: 9
});
var THINKING_EFFORT_CANONICAL = Object.freeze({
  light: "low",
  extra_high: "xhigh",
  none: "off",
  on: "high",
  level_1: "minimal",
  level_2: "low",
  level_3: "medium",
  level_4: "high",
  level_5: "xhigh"
});
var EFFECTIVE_THINKING_RANK = 4;
var STRONGER_THINKING_EFFORTS = Object.freeze(["medium", "high", "xhigh", "max"]);
function thinkingEffortRank(effort) {
  return Object.hasOwn(THINKING_EFFORT_RANK, effort) ? THINKING_EFFORT_RANK[effort] : void 0;
}
function thinkingEffortCanonical(effort) {
  return Object.hasOwn(THINKING_EFFORT_CANONICAL, effort) ? THINKING_EFFORT_CANONICAL[effort] : effort;
}
function defaultModelEffort(efforts, declared, preferred = "medium") {
  const list = Array.isArray(efforts) ? efforts.filter((e) => typeof e === "string" && e !== "" && e.trim() === e) : [];
  if (list.length === 0) return void 0;
  const declaredRank = thinkingEffortRank(declared);
  if (declared !== void 0 && list.includes(declared) && (declaredRank === void 0 || declaredRank >= EFFECTIVE_THINKING_RANK)) {
    return declared;
  }
  for (const candidate of [preferred, ...STRONGER_THINKING_EFFORTS]) {
    const hit = list.find((effort) => thinkingEffortCanonical(effort) === candidate);
    if (hit !== void 0) return hit;
  }
  let strongest;
  for (const effort of list) {
    const rank = thinkingEffortRank(effort);
    if (rank === void 0 || rank === 0) continue;
    if (strongest === void 0 || rank > strongest.rank) strongest = { effort, rank };
  }
  if (strongest !== void 0) return strongest.effort;
  if (declared !== void 0 && list.includes(declared)) return declared;
  return list[0];
}
function modelIdentity(value) {
  return value.toLowerCase().replace(/^sn-(.*?)(?:-p)?$/, "$1").replace(/^person-/, "").replace(/-selected$/, "").replace(/[._]+/g, "-").replace(/-ga-(?=\d{4,8}$)/, "-").replace(/^qwen(?=\d)/, "qwen-").replace(/^openpangu(?=\d)/, "openpangu-").replace(/^doubao-seed(?=-)/, "seed");
}
var catalogIdentities = {
  qodercn: {
    qmodel_38max: "qwen-3-8-max",
    qfmodel: "qwen-3-8-flash",
    dmodel: "deepseek-v4-pro",
    dfmodel: "deepseek-flash",
    gmodel: "glm-5-3",
    gfmodel: "glm-5-3-flash",
    kmodel_latest: "kimi-k3-1-pro",
    kmodel: "kimi-k2-8-preview",
    mmodel: "minimax-m3-1-flash"
  },
  trae: { "deepseek-v4-pro-official": "deepseek-v4-pro-0813" },
  workbuddy: { "deepseek-v4-pro": "deepseek-v4-pro-0813", "kimi-k3-1": "kimi-k3" },
  "sensenova-token-plan": { "deepseek-flash": "deepseek-v4-1-flash-1017" },
  astudio: {
    xopglm52: "glm-5-2",
    xopglm51: "glm-5-1",
    xopdsv4flash0731in: "deepseek-v4-flash-0731",
    xopdeepseekv4pro0813: "deepseek-v4-pro-0813",
    xopdeepseekv4pro: "deepseek-v4-pro-0813",
    "xdeepseek-flash-in": "deepseek-v4-1-flash-1017"
  }
};
function catalogIdentity(id, provider) {
  const aliases = Object.hasOwn(catalogIdentities, provider) ? catalogIdentities[provider] : {};
  return Object.hasOwn(aliases, id.toLowerCase()) ? aliases[id.toLowerCase()] : modelIdentity(id);
}
function stripReleaseSuffix(value) {
  return value.replace(/-(?:\d{4}|\d{6}|\d{8})$/, "");
}
function modelGeneration(value) {
  const match = /^(sensenova|deepseek|qwen|glm|kimi|minimax|mimo|claude|gemini|gpt|spark|seed|step|openpangu|agnes|llama|grok|gemma)[-_]?((?:opus|sonnet|haiku)[-_])?([kmvx]?)(\d+)(?:[.-](\d{1,2})(?!\d))?(?:[.-](\d{1,2})(?!\d))?(.*)$/i.exec(value);
  if (!match) return null;
  const [, brand, series = "", prefix, major, minor, patch, tail] = match;
  const release = /-(\d{4}|\d{6}|\d{8})$/.exec(tail)?.[1];
  const preview = /(?:^|-)preview(?:-|$)/.test(tail);
  const variant = tail.replace(/-(?:\d{4}|\d{6}|\d{8})$/, "").replace(/-preview$/, "");
  return {
    group: [brand.toLowerCase(), series.toLowerCase(), prefix.toLowerCase(), variant].join("/"),
    version: Number(major) * 1e4 + Number(minor ?? 0) * 100 + Number(patch ?? 0),
    preview,
    release
  };
}
var namedSuccessors = /* @__PURE__ */ new Map([
  ["kimi-k2-7-code", "kimi-k3-1-pro"],
  ["kimi-k2-8-preview", "kimi-k3-1-pro"],
  ["kimi-k3", "kimi-k3-1-pro"],
  ["minimax-m3", "minimax-m3-1-flash"],
  ["deepseek-v4-flash", "deepseek-v4-1-flash-1017"],
  ["deepseek-v4-1-flash", "deepseek-v4-1-flash-1017"],
  ["qwen-3-7-plus", "qwen-3-8-max"],
  ["agnes-2-5-pro-alpha", "agnes-3-0-pro"],
  ["agnes-2-5-pro-beta", "agnes-3-0-pro"],
  ["agnes-2-5-pro-theta", "agnes-3-0-pro"],
  ["glm-5-2-sft-harmony", "glm-5-3"]
]);
var providerNamedSuccessors = {
  trae: /* @__PURE__ */ new Map([
    ["deepseek-v3-1", "deepseek-v4-1-flash"],
    ["seed-code", "seed-2-1-turbo"],
    ["seed-2-0-code", "seed-2-1-turbo"],
    ["doubao-2-0-mini", "seed-2-1-turbo"],
    ["glm-5v-turbo", "glm-5-3-flash"],
    ["qwen-3-5", "qwen-4-max"],
    ["qwen-3-6-plus", "qwen-3-8-max"],
    ["minimax-m2-7", "minimax-m3-1-flash"],
    ["kimi-k2-6", "kimi-k3-1-pro"]
  ]),
  workbuddy: /* @__PURE__ */ new Map([
    // 同目录存在完全同型号的免费版 hy4flash-free，收费版 hy4flash 不再默认启用。
    ["hy4flash", "hy4flash-free"]
  ])
};
var obsoleteIdentities = /* @__PURE__ */ new Set([
  "deepseek-v3",
  "deepseek-v3-1",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-4-7",
  "glm-5",
  "glm-5-1",
  "glm-5-2",
  "glm-5-3",
  "glm-5v-turbo",
  "glm-5-2-sft-harmony",
  "kimi-k2-5",
  "kimi-k2-6",
  "kimi-k2-7-code",
  "kimi-k2-8-preview",
  "kimi-k3",
  "qwen-3-5",
  "qwen-3-6-plus",
  "qwen-3-7-plus",
  "qwen-3-8-flash",
  "minimax-m2-7",
  "minimax-m3",
  "doubao-2-0-mini",
  "seed-code",
  "seed-2-0-code",
  "agnes-2-5-flash",
  "agnes-2-5-pro",
  "agnes-2-5-pro-alpha",
  "agnes-2-5-pro-beta",
  "agnes-2-5-pro-theta"
]);
function modelSuccessors(models, provider) {
  const groups = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  for (const model of models) {
    if (model.dead) continue;
    const name = catalogIdentity(model.id, provider);
    const baseName = stripReleaseSuffix(name);
    const generation = modelGeneration(name);
    if (!model.stale) {
      byName.set(name, model.id);
      if (!byName.has(baseName)) byName.set(baseName, model.id);
    }
    if (!generation) continue;
    const group = groups.get(generation.group) ?? [];
    group.push({ ...generation, id: model.id, name, baseName, stale: model.stale === true });
    groups.set(generation.group, group);
  }
  const named = new Map(namedSuccessors);
  const scoped = Object.hasOwn(providerNamedSuccessors, provider) ? providerNamedSuccessors[provider] : void 0;
  if (scoped) for (const [from, to] of scoped) named.set(from, to);
  const result = /* @__PURE__ */ new Map();
  for (const group of groups.values()) {
    const sorted = group.sort((a, b) => b.version - a.version || Number(a.preview) - Number(b.preview) || (b.release ?? "").localeCompare(a.release ?? ""));
    for (const item of sorted) {
      const newer = sorted.find((candidate) => !candidate.stale && (item.preview || !candidate.preview) && (candidate.version > item.version || candidate.version === item.version && (item.preview && !candidate.preview || candidate.release?.length === item.release?.length && candidate.release > item.release)));
      const baseTarget = named.get(item.baseName);
      const replacement = newer?.id ?? byName.get(named.get(item.name)) ?? (baseTarget && baseTarget !== item.name ? byName.get(baseTarget) : void 0);
      if (replacement && replacement !== item.id) result.set(item.id, replacement);
    }
  }
  for (const model of models) {
    if (model.dead || result.has(model.id)) continue;
    const name = catalogIdentity(model.id, provider);
    const baseName = stripReleaseSuffix(name);
    const baseTarget = named.get(baseName);
    const replacement = byName.get(named.get(name)) ?? (baseTarget && baseTarget !== name ? byName.get(baseTarget) : void 0);
    if (replacement && replacement !== model.id) result.set(model.id, replacement);
  }
  return result;
}
var codingAlternatives = /* @__PURE__ */ new Map([
  ["deepseek-v4-pro-0813", ["deepseek-v4-1-flash-1017", "deepseek-v4-1-flash"]],
  ["deepseek-v4-pro", ["deepseek-v4-1-flash-1017", "deepseek-v4-1-flash", "deepseek-flash"]],
  ["glm-5-3", ["qwen-4-max", "deepseek-v4-1-flash-1017", "deepseek-v4-1-flash", "glm-5-3-flash", "mimo-v2-6-pro"]],
  ["glm-5-3-flashx", ["glm-5-3-flash"]],
  ["step-5-preview", ["deepseek-v4-1-flash-1017", "glm-5-3", "glm-5-3-flash", "mimo-v2-6-pro"]],
  ["kimi-k3-1-pro-highspeed", ["kimi-k3-1-pro"]],
  ["mimo-v2-5", ["deepseek-v4-1-flash-1017", "glm-5-3-flash"]]
]);
function modelMultiplier(model) {
  const label = model.rate?.label ?? model.rateBadge?.text?.zh;
  if (label === "\u514D\u8D39") return 0;
  const rate = typeof model.rate === "number" ? model.rate : model.rate?.multiplier;
  if (rate >= 0 && Number.isFinite(rate)) return rate;
  const multiplier = /^(?:参考 )?x(\d+(?:\.\d+)?)$/.exec(label ?? "");
  if (multiplier) return Number(multiplier[1]);
  if (model.free === true || model.isFree === true) return 0;
}
function modelRecommendationExclusions(models, provider) {
  const older = modelSuccessors(models, provider);
  const exclusions = /* @__PURE__ */ new Map();
  const candidates = [];
  const aliveModels = models.filter((model) => !model.dead);
  const hasModernSurvivor = aliveModels.some((model) => {
    if (older.has(model.id) || model.stale) return false;
    const identity = catalogIdentity(model.id, provider);
    const baseIdentity = stripReleaseSuffix(identity);
    return !obsoleteIdentities.has(identity) && !obsoleteIdentities.has(baseIdentity);
  });
  for (const model of aliveModels) {
    const identity = catalogIdentity(model.id, provider);
    const baseIdentity = stripReleaseSuffix(identity);
    if (older.has(model.id) || model.stale) {
      exclusions.set(model.id, { kind: "older", alternative: older.get(model.id) });
      continue;
    }
    if (hasModernSurvivor && (obsoleteIdentities.has(identity) || obsoleteIdentities.has(baseIdentity))) {
      exclusions.set(model.id, { kind: "older", alternative: void 0 });
      continue;
    }
    const rate = modelMultiplier(model);
    const declaredContext = Object.hasOwn(model, "context") ? model.context : model.defaultContextWindow ?? model.contextWindow;
    const context = declaredContext > 0 ? declaredContext : officialModelSpec(model.id, provider)?.context ?? 0;
    if (rate !== void 0) candidates.push({
      id: model.id,
      identity,
      baseIdentity,
      rate,
      context,
      image: Object.hasOwn(model, "attachment") ? model.attachment : model.defaultVision ?? model.supportsImage
    });
  }
  const contextTier = (value) => value >= 1e6 ? 1e6 : value;
  candidates.sort((a, b) => a.rate - b.rate);
  for (const item of candidates) {
    if (item.rate === 0) continue;
    const alternatives = codingAlternatives.get(item.identity) ?? codingAlternatives.get(item.baseIdentity);
    if (!alternatives) continue;
    const better = candidates.find((other) => (alternatives.includes(other.identity) || alternatives.includes(other.baseIdentity)) && !exclusions.has(other.id) && other.rate <= item.rate * 2 / 3 && contextTier(other.context) >= contextTier(item.context > 0 ? item.context : 1e6) && (item.image === false || other.image === true || item.image == null && other.image == null));
    if (better) exclusions.set(item.id, { kind: "value", alternative: better.id });
  }
  return exclusions;
}
var OFFICIAL_MODEL_SPECS = Object.freeze({
  "kimi-k3-1-pro": { context: 1048576, maxOutput: 1048576 },
  "kimi-k3-1-pro-highspeed": { context: 1048576, maxOutput: 1048576 },
  "kimi-k3": { context: 1048576, maxOutput: 1048576 },
  "kimi-k2-8-preview": { context: 1048576, maxOutput: 1048576 },
  "kimi-k2-7-code": { context: 262144, maxOutput: 262144 },
  "deepseek-v4-1-flash": { context: 1048576, maxOutput: 393216 },
  "deepseek-v4-1-flash-1017": { context: 1048576, maxOutput: 393216 },
  "deepseek-v4-1-flash-economy": { context: 1048576, maxOutput: 393216 },
  "deepseek-v4-pro": { context: 1048576, maxOutput: 393216 },
  "deepseek-v4-pro-0813": { context: 1048576, maxOutput: 393216 },
  "deepseek-v4-flash": { context: 1048576, maxOutput: 393216 },
  "glm-5-4": { context: 1e6, maxOutput: 131072 },
  "glm-5-3": { context: 1048576, maxOutput: 131072 },
  "glm-5-3-flash": { context: 1048576, maxOutput: 131072 },
  "glm-5-3-flashx": { context: 1048576, maxOutput: 131072 },
  "glm-5-2": { context: 1048576, maxOutput: 131072 },
  "glm-5-1": { context: 202745, maxOutput: 131072 },
  "qwen-4-max": { context: 1e6, maxOutput: 262144 },
  "qwen-4-max-preview": { context: 1e6, maxOutput: 262144 },
  "qwen-3-8-max": { context: 1e6, maxOutput: 131072 },
  "qwen-3-8-flash": { context: 1e6, maxOutput: 131072 },
  "qwen-3-7-plus": { context: 1e6, maxOutput: 131072 },
  "qwen-3-6-flash": { context: 1e6, maxOutput: 65536 },
  "ernie-5-5-flash-preview": { context: 1e6, maxOutput: 1e6 },
  "ernie-light-dt-1-0": { context: 1e6, maxOutput: 131072 },
  "seed-2-1-pro": { context: 1048576, maxOutput: 262144 },
  "seed-2-1-turbo": { context: 256e3, maxOutput: 262144 },
  "seed-2-1-lite": { context: 1048576, maxOutput: 262144 },
  "seed-evolving": { context: 1048576, maxOutput: 262144 },
  "seed-code": { context: 256e3, maxOutput: 131072 },
  "seed-2-0-code": { context: 262144, maxOutput: 131072 },
  "doubao-2-0-mini": { context: 262144, maxOutput: 131072 },
  "minimax-m3-1-flash": { context: 1e6, maxOutput: 524288 },
  "minimax-m3": { context: 1e6, maxOutput: 131072 },
  "mimo-v2-6-pro": { context: 1e6, maxOutput: 131072 },
  "mimo-v2-6-flash": { context: 1e6, maxOutput: 131072 },
  "spark-x2-6": { context: 1048576, maxOutput: 131072 },
  "spark-x2-6-4b": { context: 1048576, maxOutput: 131072 },
  "sensenova-6-8-flash": { context: 1048576, maxOutput: 131072 },
  "sensenova-6-8-flash-lite": { context: 1048576, maxOutput: 65536 },
  hy4std: { context: 1024e3, maxOutput: 65536 },
  hy4flash: { context: 1024e3, maxOutput: 65536 },
  "hy4flash-free": { context: 1024e3, maxOutput: 65536 },
  "step-5-preview": { context: 1048576, maxOutput: 65536 },
  "step-3-7-flash": { context: 262144 },
  "step-3-5-flash": { context: 262144 },
  "openpangu-2-0-pro": { context: 524288, maxOutput: 131072 },
  "openpangu-2-0-flash": { context: 524288, maxOutput: 131072 },
  "openpangu-2-1-pro": { context: 524288, maxOutput: 393216 },
  "agnes-2-5-flash": { context: 524288, maxOutput: 65536 },
  "agnes-3-0-flash": { context: 524288, maxOutput: 65536 },
  "agnes-3-0-pro": { context: 1048576, maxOutput: 65536 },
  "agnes-2-5-pro": { context: 1048576, maxOutput: 65536 },
  "agnes-2-5-pro-alpha": { context: 1048576, maxOutput: 65536 },
  "agnes-2-5-pro-beta": { context: 1048576, maxOutput: 65536 },
  "u2-flash": { context: 1048576, maxOutput: 262144 },
  // 云知声：以**上游目录真值**为准（2026-11-23 用真实 Key 拉
  // `/anthropic/v1/models` 核对，优先于第三方转述的 163K/65K）。
  // u2 = 160,000 / 64,000；u2-med = 262,144，上游 `max_output` 为 `null`
  //（不公开），故只登记 context，输出预算走通用推导，不编造官方值。
  u2: { context: 16e4, maxOutput: 64e3 },
  "u2-med": { context: 262144 }
});
var CHANNEL_OUTPUT_HARD_CAPS = Object.freeze({
  codearts: 65536
});
var SPEC_ALIAS_PREFIXES = Object.freeze([
  [/^xopglm52$/, "glm-5-2"],
  [/^glm-5-2-zx$/, "glm-5-2"],
  [/^xopdeepseekv4pro\d*$/, "deepseek-v4-pro"],
  [/^xopdsv4flash\d*in$/, "deepseek-v4-flash"],
  [/^xdeepseek-flash-in$/, "deepseek-v4-1-flash"],
  [/^seed-lite-7b$/, "seed-2-1-lite"],
  [/^deepseek-flash$/, "deepseek-v4-1-flash"],
  [/^deepseek-v4-pro-official$/, "deepseek-v4-pro"],
  [/^deepseek-v4-pro-ga-\d+$/, "deepseek-v4-pro"],
  [/^kimi-k3-1$/, "kimi-k3-1-pro"],
  [/^doubao-2-1-lite$/, "seed-2-1-lite"],
  [/^doubao-2-1-pro$/, "seed-2-1-pro"],
  [/^doubao-2-1-turbo$/, "seed-2-1-turbo"]
]);
function canonicalSpecKey(id, provider) {
  if (typeof id !== "string" || !id) return "";
  let key = catalogIdentity(id, provider).replace(/^person-/, "").replace(/^qwen(?=\d)/, "qwen-").replace(/-selected$/, "").replace(/-official$/, "").replace(/-ga-\d{4,8}$/, "").replace(/-\d{6,8}$/, "").replace(/-0731$/, "");
  for (const [pattern, target] of SPEC_ALIAS_PREFIXES) {
    if (pattern.test(key)) {
      key = target;
      break;
    }
  }
  if (Object.hasOwn(OFFICIAL_MODEL_SPECS, key)) return key;
  const strippedDate = key.replace(/-\d{4}$/, "");
  if (Object.hasOwn(OFFICIAL_MODEL_SPECS, strippedDate)) return strippedDate;
  return "";
}
function officialModelSpec(id, provider) {
  const key = canonicalSpecKey(id, provider);
  return key ? OFFICIAL_MODEL_SPECS[key] : null;
}

// vendor/channel-pack/src/openai-gateway/config.ts
function isGatewayEnabled(env = process.env) {
  const raw = env.DSH_OPENAI_GATEWAY_ENABLED?.trim().toLowerCase();
  if (raw === void 0 || raw === "") return true;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

// vendor/channel-pack/src/reasoning-ladder.ts
var REASONING_EFFORT_RANK = Object.freeze({
  off: 0,
  none: 0,
  minimal: 1,
  light: 2,
  low: 3,
  medium: 4,
  high: 5,
  // 「开启思考」没有强度语义 —— 与 high 同序，使它在规范名里反查成 `high`。
  on: 5,
  extra_high: 6,
  xhigh: 7,
  max: 8,
  ultra: 9
});
var CANONICAL_EFFORT_ALIAS = Object.freeze({
  light: "low",
  extra_high: "xhigh",
  none: "off",
  on: "high",
  level_1: "minimal",
  level_2: "low",
  level_3: "medium",
  level_4: "high",
  level_5: "xhigh"
});
function canonicalEffortId(id) {
  return Object.hasOwn(CANONICAL_EFFORT_ALIAS, id) ? CANONICAL_EFFORT_ALIAS[id] : id;
}
var DSH_EFFORT_IDS = /* @__PURE__ */ new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
function uniqueCanonicalEfforts(available) {
  const seen = /* @__PURE__ */ new Set();
  return available.flatMap((wire) => {
    const id = canonicalEffortId(wire);
    if (!DSH_EFFORT_IDS.has(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ id, wire }];
  });
}
function privateEffortFor(canonical, available) {
  if (canonical === void 0 || canonical.length === 0) return void 0;
  if (available === void 0) return canonical;
  if (available.includes(canonical)) return canonical;
  return available.find((option) => canonicalEffortId(option) === canonical);
}
var CANONICAL_REASONING_EFFORTS = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra"
]);
function reasoningRankOf(effort) {
  return Object.prototype.hasOwnProperty.call(REASONING_EFFORT_RANK, effort) ? REASONING_EFFORT_RANK[effort] : void 0;
}
function canonicalReasoningEffortFor(effort) {
  if (CANONICAL_REASONING_EFFORTS.includes(effort)) return effort;
  const rank = reasoningRankOf(effort);
  if (rank === void 0) return void 0;
  const wantOff = rank === 0;
  let best;
  for (const canonical of CANONICAL_REASONING_EFFORTS) {
    const canonicalRank = reasoningRankOf(canonical);
    if (canonicalRank === void 0) continue;
    if (canonicalRank === 0 !== wantOff) continue;
    const distance = Math.abs(canonicalRank - rank);
    if (best === void 0 || distance < best.distance || distance === best.distance && canonicalRank > best.rank) {
      best = { canonical, distance, rank: canonicalRank };
    }
  }
  return best?.canonical;
}

// vendor/channel-pack/src/openai-gateway/effort-view.ts
function effortIdOf(raw) {
  return typeof raw === "string" && raw.length > 0 ? raw : void 0;
}
function effortView(efforts, defaultEffort) {
  if (!Array.isArray(efforts)) return void 0;
  const rows = [];
  const canonicalSeen = /* @__PURE__ */ new Set();
  const openaiEfforts = [];
  for (const effort of efforts) {
    const id = effortIdOf(effort?.id);
    if (id === void 0) continue;
    const canonical = canonicalReasoningEffortFor(id);
    rows.push({
      id,
      name: effortIdOf(effort?.name) ?? id,
      ...canonical === void 0 ? {} : { canonical }
    });
    if (canonical !== void 0 && !canonicalSeen.has(canonical)) {
      canonicalSeen.add(canonical);
      openaiEfforts.push(canonical);
    }
  }
  if (rows.length === 0) return void 0;
  const fallback = effortIdOf(defaultEffort);
  return {
    efforts: rows,
    // ⚠️ 默认档必须是模型真声明过的 id，否则客户端照着它填就会 400。
    ...fallback === void 0 || !rows.some((row) => row.id === fallback) ? {} : { default: fallback },
    openai_efforts: openaiEfforts
  };
}

// vendor/channel-pack/src/openai-gateway/models.ts
function toOpenAiModelId(provider, model) {
  return `${provider}/${model}`;
}
async function collectGatewayModels(llm, onError) {
  let providers = [];
  try {
    const raw = llm?.listProviders?.();
    if (Array.isArray(raw)) providers = raw.filter((entry) => typeof entry?.id === "string");
  } catch (error) {
    onError?.("listProviders", error);
  }
  if (providers.length === 0) return [];
  const groups = await Promise.all(providers.map(async ({ id: provider }) => {
    try {
      const models = await llm.listModels(provider);
      if (!Array.isArray(models)) {
        onError?.(provider, new Error("listModels \u672A\u8FD4\u56DE\u6570\u7EC4"));
        return void 0;
      }
      return { provider, models };
    } catch (error) {
      onError?.(provider, error);
      return void 0;
    }
  }));
  return groups.filter((group) => group !== void 0);
}
function toGatewayModelIds(groups, effortViews) {
  return groups.flatMap(({ provider, models }) => models.map((model) => {
    const id = toOpenAiModelId(provider, model.id);
    const reasoning = effortViews?.get(id);
    return {
      id,
      // ⚠️ 这两个字段**必须由这里给出**（见 `GatewayModelIdEntry` 的注释）：
      // 前端没有别的地方能拿到权威拆分。
      provider,
      model: model.id,
      name: model.name,
      input: Array.isArray(model.inputModalities) && model.inputModalities.length > 0 ? [...model.inputModalities] : ["text"],
      ...reasoning === void 0 ? {} : { reasoning }
    };
  }));
}
async function collectGatewayEffortViews(llm, groups, onError) {
  const views = /* @__PURE__ */ new Map();
  const resolve2 = llm?.resolveModelInfo;
  if (typeof resolve2 !== "function") return views;
  await Promise.all(groups.flatMap(({ provider, models }) => models.map(async (model) => {
    try {
      const info = await resolve2.call(llm, provider, model.id);
      const view = effortView(info?.reasoning?.efforts, info?.reasoning?.defaultEffort);
      if (view !== void 0) views.set(toOpenAiModelId(provider, model.id), view);
    } catch (error) {
      onError?.(provider, new Error(
        `${model.id} \u7684\u6863\u4F4D\u89E3\u6790\u5931\u8D25\uFF08\u8BE5\u6A21\u578B\u4E0D\u5E26\u6863\u4F4D\u5B57\u6BB5\uFF0C\u76EE\u5F55\u672C\u8EAB\u7167\u5E38\u8FD4\u56DE\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
      ));
    }
  })));
  return views;
}

// vendor/channel-pack/src/openai-gateway/runtime.ts
var desiredEnabled = true;
var factory;
var running;
var lastApiKey = null;
function setGatewayDesiredEnabled(enabled) {
  desiredEnabled = enabled;
}
function isGatewayRunning() {
  return running !== void 0;
}
function gatewayAddress() {
  return running?.address();
}
function gatewayApiKey() {
  return running?.apiKey ?? lastApiKey;
}
async function applyGatewayDesiredState() {
  const shouldRun = isGatewayEnabled(process.env) && desiredEnabled;
  if (shouldRun) {
    if (running !== void 0 || factory === void 0) return;
    const gateway2 = factory();
    if (gateway2 === void 0) return;
    running = gateway2;
    try {
      await gateway2.start();
    } catch {
      running = void 0;
    }
    return;
  }
  if (running === void 0) return;
  const gateway = running;
  running = void 0;
  await gateway.close();
}

// vendor/channel-pack/src/credit-expiry-window.ts
var DEFAULT_CREDIT_EXPIRING_WINDOW_DAYS = 15;
function creditExpiringWindowDays(env = process.env) {
  const raw = env.DSH_CREDIT_EXPIRING_WINDOW_DAYS;
  if (typeof raw !== "string" || raw.trim().length === 0) return DEFAULT_CREDIT_EXPIRING_WINDOW_DAYS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CREDIT_EXPIRING_WINDOW_DAYS;
  return parsed;
}

// vendor/channel-pack/src/raccoon.ts
import { createCipheriv, randomBytes } from "node:crypto";
var RACCOON_API_BASE = "https://xiaohuanxiong.com";
var RACCOON_POINTS_PREFIX = "/api/web/points/v1";
var RACCOON_DESKTOP_PREFIX = "/api/web/desktop/v1";
var RACCOON_OFFICE_PREFIX = "/api/web/office/v3";
var RACCOON_PHONE_CIPHER_SECRET = "senseraccoon2023";
var RACCOON_REQUEST_TIMEOUT_MS = 6e4;
var RACCOON_LOGIN_TIMEOUT_MS = 5 * 60 * 1e3;
var RACCOON_QR_STATUS = {
  pending: "pending",
  logging: "logging",
  canceled: "canceled",
  success: "success"
};
function decodeJwtExpMs(token) {
  if (typeof token !== "string" || token.length === 0) return void 0;
  const parts = token.split(".");
  if (parts.length < 2) return void 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return void 0;
    const exp = payload.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return void 0;
    return exp * 1e3;
  } catch {
    return void 0;
  }
}
function raccoonCredentialExpiresAtMs(credential) {
  const raw = credential.expires_at;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return decodeJwtExpMs(credential.access_token);
}
function isRaccoonExpired(credential) {
  const expiresAt = raccoonCredentialExpiresAtMs(credential);
  return expiresAt !== void 0 && expiresAt <= Date.now();
}
function isRaccoonRefreshable(credential) {
  return typeof credential.refresh_token === "string" && credential.refresh_token.trim().length > 0;
}
function encryptRaccoonPhone(phone, iv) {
  const key = Buffer.from(RACCOON_PHONE_CIPHER_SECRET, "utf8");
  const nonce = iv ?? randomBytes(16);
  const cipher = createCipheriv("aes-128-cfb", key, nonce);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(phone, "utf8")), cipher.final()]);
  return Buffer.concat([nonce, ciphertext]).toString("base64");
}
function raccoonDisplayName(model) {
  return typeof model.description === "string" && model.description.length > 0 ? model.description : model.id;
}
function raccoonHeaders(credential, opts = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${credential.access_token}`,
    // 个人账号为空串；客户端总是发送该头
    "X-Org-Code": credential.office_identity ?? "",
    "X-Raccoon-Language": "zh"
  };
  if (opts.platform !== void 0 && opts.platform.length > 0) {
    headers["X-Client-Platform"] = opts.platform;
  }
  if (opts.version !== void 0 && opts.version.length > 0) {
    headers["X-Client-Version"] = opts.version;
  }
  if (credential.device_id !== void 0 && credential.device_id.length > 0) {
    headers["X-Client-Device-ID"] = credential.device_id;
  }
  return headers;
}

// vendor/channel-pack/src/image-budget.ts
var REQUEST_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
var RACCOON_REQUEST_IMAGE_MAX_BYTES = 512 * 1024;
var DEFAULT_BODY_LIMITED_IMAGE_MAX_BYTES = 1024 * 1024;
var DEFAULT_IMAGE_PIXEL_BUDGET = 64e4;
function fitImageToPixelBudget(width, height, maxPixels) {
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return void 0;
  if (!isPositiveFinite(maxPixels)) return void 0;
  if (width * height <= maxPixels) return { width: Math.floor(width), height: Math.floor(height) };
  const scale = Math.sqrt(maxPixels / (width * height));
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));
  return { width: targetWidth, height: targetHeight };
}
function requestImageTargetFor(width, height, maxPixels, maxBytes = REQUEST_IMAGE_MAX_BYTES) {
  const fitted = fitImageToPixelBudget(width, height, maxPixels ?? DEFAULT_IMAGE_PIXEL_BUDGET);
  if (fitted === void 0) return void 0;
  return { width: fitted.width, height: fitted.height, maxBytes: maxBytes ?? REQUEST_IMAGE_MAX_BYTES };
}
async function projectRequestImage(attachment, options) {
  const readImageRequest = options.readImageRequest;
  if (readImageRequest === void 0) return void 0;
  const { width, height } = attachment;
  if (typeof width !== "number" || typeof height !== "number") return void 0;
  const target = requestImageTargetFor(width, height, options.pixelBudget, options.maxBytes);
  if (target === void 0) return void 0;
  try {
    return await readImageRequest(attachment, target);
  } catch {
    return void 0;
  }
}
function isPositiveFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// vendor/channel-pack/src/raccoon-product.ts
var RACCOON_EFFORT_ON = "on";
var RACCOON_EFFORT_OFF = "off";
var RACCOON_EFFORT_NAMES = Object.freeze({
  [RACCOON_EFFORT_ON]: "\u5F00\u542F",
  [RACCOON_EFFORT_OFF]: "\u5173\u95ED"
});
var RACCOON_THINKING_LEVEL_NAMES = Object.freeze({
  [RACCOON_EFFORT_OFF]: "\u5173\u95ED",
  level_1: "\u6781\u5C11",
  level_2: "\u4F4E",
  level_3: "\u4E2D",
  level_4: "\u9AD8",
  level_5: "\u6700\u5927"
});
var RACCOON_THINKING_LEVELS = Object.freeze([
  "level_1",
  "level_2",
  "level_3",
  "level_4",
  "level_5"
]);
function parseRaccoonThinking(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const raw = value;
  if (raw.managed !== true) return void 0;
  if (raw.supported === false) return void 0;
  const levels = [];
  if (Array.isArray(raw.display_levels)) {
    for (const entry of raw.display_levels) {
      const level = typeof entry === "object" && entry !== null ? entry.value : entry;
      if (typeof level !== "string") continue;
      const normalized = level.trim();
      if (!RACCOON_THINKING_LEVELS.includes(normalized) || levels.includes(normalized)) continue;
      levels.push(normalized);
    }
    levels.sort((a, b) => RACCOON_THINKING_LEVELS.indexOf(a) - RACCOON_THINKING_LEVELS.indexOf(b));
  }
  const canDisable = raw.can_disable === true;
  if (levels.length === 0 && !canDisable) return void 0;
  const options = canDisable ? [RACCOON_EFFORT_OFF, ...levels] : [...levels];
  const upstreamDefault = typeof raw.default_level === "string" ? raw.default_level.trim() : "";
  const defaultLevel = defaultModelEffort(levels, upstreamDefault) ?? levels[0] ?? RACCOON_EFFORT_OFF;
  return { levels: options, defaultLevel: options.includes(defaultLevel) ? defaultLevel : options[0] };
}
function raccoonThinkingEfforts(info) {
  if (info === void 0) {
    return { efforts: RACCOON_REASONING_EFFORTS, defaultEffort: RACCOON_DEFAULT_EFFORT };
  }
  return { efforts: info.levels, defaultEffort: info.defaultLevel };
}
function raccoonThinkingEffortName(id) {
  return RACCOON_THINKING_LEVEL_NAMES[id] ?? RACCOON_EFFORT_NAMES[id] ?? id;
}
var RACCOON_REASONING_EFFORTS = Object.freeze([
  RACCOON_EFFORT_ON,
  RACCOON_EFFORT_OFF
]);
var RACCOON_DEFAULT_EFFORT = RACCOON_EFFORT_ON;
function fallbackModel(entry) {
  return {
    id: entry.id,
    name: raccoonDisplayName({
      id: entry.id,
      description: entry.displayName,
      effectiveMultiplier: entry.effectiveMultiplier,
      baseMultiplier: entry.baseMultiplier,
      status: entry.status,
      statusNote: entry.statusNote ?? ""
    }),
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    supportsImage: entry.supportsImage,
    effectiveMultiplier: entry.effectiveMultiplier,
    baseMultiplier: entry.baseMultiplier,
    status: entry.status,
    ...entry.statusNote === void 0 ? {} : { statusNote: entry.statusNote },
    thinking: entry.thinking,
    ...entry.stale === void 0 ? {} : { stale: entry.stale },
    ...entry.staleReason === void 0 ? {} : { staleReason: entry.staleReason }
  };
}
var THINKING_5_NO_OFF = { levels: ["level_1", "level_2", "level_3", "level_4", "level_5"], defaultLevel: "level_3" };
var THINKING_4_OFF = { levels: ["off", "level_1", "level_2", "level_4", "level_5"], defaultLevel: "level_4" };
var THINKING_3_OFF = { levels: ["off", "level_1", "level_3", "level_5"], defaultLevel: "level_3" };
var THINKING_3_NO_OFF = { levels: ["level_1", "level_3", "level_5"], defaultLevel: "level_3" };
var RACCOON_FREE_FALLBACK_MODELS = [
  fallbackModel({
    id: "sn-sensenova-6-8-flash",
    displayName: "SenseNova-6.8-Flash",
    contextWindow: 256e3,
    maxTokens: 63999,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.5,
    status: "limited_free",
    statusNote: "\u9650\u514D\u523011\u670830\u65E5",
    thinking: THINKING_5_NO_OFF
  }),
  fallbackModel({
    id: "sn-sensenova-6-8-flash-lite",
    displayName: "SenseNova-6.8-Flash-Lite",
    contextWindow: 256e3,
    maxTokens: 63999,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.5,
    status: "limited_free",
    statusNote: "\u9650\u514D\u523011\u670830\u65E5",
    thinking: THINKING_4_OFF
  }),
  fallbackModel({
    id: "sn-qwen4-max",
    displayName: "Qwen4-Max",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 0.5,
    baseMultiplier: 0.75,
    status: "discount",
    statusNote: "\u9650\u65F6\u6298\u6263\u81F311\u670822\u65E5",
    thinking: THINKING_3_OFF
  }),
  fallbackModel({
    id: "sn-glm-5-3",
    displayName: "GLM-5-3",
    contextWindow: 1e6,
    maxTokens: 1e5,
    // 远端 tags 无 `vision`，但实测能看图（1/3 成功，另两次是节点侧纯文本
    // fallback 组，属 provider 缺陷；见 RACCOON_IMAGE_CAPABILITY_OVERRIDES）。
    supportsImage: true,
    effectiveMultiplier: 0.75,
    baseMultiplier: 0.75,
    status: "normal",
    thinking: THINKING_3_NO_OFF
  }),
  fallbackModel({
    id: "sn-kimi-k3-1-pro",
    displayName: "Kimi-K3.1-Pro",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 1,
    baseMultiplier: 1,
    status: "normal",
    thinking: THINKING_3_NO_OFF
  }),
  fallbackModel({
    id: "sn-glm-5-3-flash",
    displayName: "GLM-5-3-Flash",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 0.2,
    baseMultiplier: 0.2,
    status: "normal",
    thinking: THINKING_3_NO_OFF
  }),
  fallbackModel({
    id: "sn-deepseek-v4-1-flash-1017",
    displayName: "DeepSeek-V4.1-Flash-1017",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 0.25,
    baseMultiplier: 0.25,
    status: "normal",
    thinking: THINKING_3_OFF
  })
];
var RACCOON_PRO_FALLBACK_MODELS = [
  fallbackModel({
    id: "sn-sensenova-6-8-flash-p",
    displayName: "SenseNova-6.8-Flash",
    contextWindow: 256e3,
    maxTokens: 63999,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.5,
    status: "limited_free",
    statusNote: "\u9650\u514D\u523011\u670830\u65E5",
    thinking: THINKING_5_NO_OFF
  }),
  fallbackModel({
    id: "sn-sensenova-6-8-flash-lite-p",
    displayName: "SenseNova-6.8-Flash-Lite",
    contextWindow: 256e3,
    maxTokens: 63999,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.5,
    status: "limited_free",
    statusNote: "\u9650\u514D\u523011\u670830\u65E5",
    thinking: THINKING_4_OFF
  }),
  fallbackModel({
    id: "sn-qwen4-max-p",
    displayName: "Qwen4-Max",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 0,
    baseMultiplier: 0.75,
    status: "limited_free",
    statusNote: "\u6D3B\u52A8\u9650\u514D\u81F311\u670822\u65E5",
    thinking: THINKING_3_OFF
  }),
  fallbackModel({
    id: "sn-glm-5-3-p",
    displayName: "GLM-5-3",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 0.75,
    baseMultiplier: 0.75,
    status: "normal",
    thinking: THINKING_3_NO_OFF
  }),
  fallbackModel({
    id: "sn-kimi-k3-1-pro-p",
    displayName: "Kimi-K3.1-Pro",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 1,
    baseMultiplier: 1,
    status: "normal",
    thinking: THINKING_3_NO_OFF
  }),
  fallbackModel({
    id: "sn-glm-5-3-flash-p",
    displayName: "GLM-5-3-Flash",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 0.2,
    baseMultiplier: 0.2,
    status: "normal",
    thinking: THINKING_3_NO_OFF
  }),
  fallbackModel({
    id: "sn-deepseek-v4-1-flash-1017-p",
    displayName: "DeepSeek-V4.1-Flash-1017",
    contextWindow: 1e6,
    maxTokens: 1e5,
    supportsImage: true,
    effectiveMultiplier: 0.25,
    baseMultiplier: 0.25,
    status: "normal",
    thinking: THINKING_3_OFF
  })
];
var RACCOON_IMAGE_CAPABILITY_OVERRIDES = /* @__PURE__ */ new Set([
  // 白名单 = **兜底表里声明支持图片的全部模型**。两者的关系是「兜底表是真值来源，
  // 白名单保证远端目录丢了标签也不退化」，由 `test/raccoon-thinking.test.mjs`
  // 「兜底表声明支持 ⇒ 空标签下也判支持」一条正向锁死。
  //
  // `sn-glm-5-3` 是 2026-11-23 审计发现的真实分叉：兜底表说支持、远端这一版目录的
  // tags 却没有 `vision`，导致远端路径判为不支持（它实测能看图，3 次里 1 次成功，
  // 另两次落在纯文本 fallback 节点，属 provider 侧缺陷）。
  "sn-sensenova-6-8-flash",
  "sn-sensenova-6-8-flash-lite",
  "sn-qwen4-max",
  "sn-glm-5-3",
  "sn-kimi-k3-1-pro",
  "sn-glm-5-3-flash",
  "sn-deepseek-v4-1-flash",
  "sn-deepseek-v4-1-flash-1017"
]);
function raccoonSupportsImage(modelId, tags) {
  const bare = modelId.replace(/-p$/u, "");
  if (RACCOON_IMAGE_CAPABILITY_OVERRIDES.has(bare)) return true;
  return tags.includes("vision") || tags.includes("image") || tags.includes("image-understanding");
}
var RACCOON = {
  id: "raccoon",
  // ⚠️ 展示名必须能一眼区分体验版 / 订阅版，且避免用「免费版」误导模型或用户以为零消耗。
  // 合并统一模式下由宿主挂载层覆写为不带后缀的 `Raccoon`。
  displayName: "Raccoon \u4F53\u9A8C\u7248",
  apiBase: RACCOON_API_BASE,
  authApiPrefix: "/api/web/auth/v1",
  llmApiPrefix: "/api/web/llm/v2",
  pointsApiPrefix: "/api/web/points/v1",
  desktopApiPrefix: "/api/web/desktop/v1",
  userAgent: "Raccoon Work/1.0.35 (Windows)",
  clientPlatform: "desktop-windows",
  clientVersion: "v1.0.35",
  defaultCredentialRef: "RACCOON_ACCESS_TOKEN",
  // 实测该网关按**请求体字节**卡（`HTTP_413: request body exceeds 10MB`），
  // 所以字节目标是主约束；像素预算保证图不至于大到压不进那个字节目标。
  imagePixelBudget: 64e4,
  imageMaxBytes: RACCOON_REQUEST_IMAGE_MAX_BYTES,
  phoneCipherSecret: RACCOON_PHONE_CIPHER_SECRET,
  aliyunCaptcha: { sceneId: "1pkmy0x3", prefix: "hk1r5l" },
  fallbackModels: RACCOON_FREE_FALLBACK_MODELS
};
var RACCOON_PRO = {
  ...RACCOON,
  id: "raccoon-pro",
  displayName: "Raccoon \u8BA2\u9605\u7248",
  defaultCredentialRef: "RACCOON_PRO_ACCESS_TOKEN",
  fallbackModels: RACCOON_PRO_FALLBACK_MODELS
};

// vendor/channel-pack/src/qoder-product.ts
var QODER_FALLBACK_MODELS = [];
var QODER = {
  id: "qoder",
  displayName: "Qoder",
  authBase: "https://qoder.com",
  openApiBase: "https://openapi.qoder.sh",
  inferBase: "https://api2-v2.qoder.sh",
  encryptedInferBase: "https://api2.qoder.sh",
  clientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
  testClientId: "e93fe488-5778-4c35-a6fc-0f54ed7b3139",
  clientMetadata: {
    client_type: "5",
    business_product: "cli",
    business_type: "agent",
    scene: "assistant"
  },
  // 官方桌面客户端身份（源码常量 `Mh.clientType`）。仅用于 `/sash/` 端点。
  sashClientType: "10",
  userAgentPrefix: "qoder",
  defaultCredentialRef: "QODER_ACCESS_TOKEN",
  fallbackModels: QODER_FALLBACK_MODELS
};
var QODER_CN_FALLBACK_MODELS = [
  // ⚠️ **本表按上游目录接口逐项对齐**（`GET /algo/api/v2/model/list` 的 `chat`
  // 分组，2026-11-26 实测）。`id` 是**真实调用 key**，不是显示名 —— 两者常常
  // 不同（Qwen4-Max=`qmodel_latest`、GLM-5.4=`gmodel_latest`、
  // Step-5-Preview=`jmodel`）；拿显示名当 `model` 发请求会回落默认模型且
  // 不产出 `reasoning_content`（用户报障「Qoder 思考设置无效」）。
  //
  // `--list-models` 只作接口不可用时的回退，它对这些条目只给显示名。
  // 倍率 `0` 是合法值（免费），不能当缺失。
  { id: "auto", name: "Auto", contextWindow: 2e5, priceFactor: 0.3, supportsImage: true, supportsThinking: true },
  {
    id: "qmodel_latest",
    name: "Qwen4-Max",
    contextWindow: 1e6,
    priceFactor: 0.4,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["xhigh", "high", "low"],
    defaultEffort: "high",
    supportsDisable: true
  },
  {
    id: "qmodel_38max",
    name: "Qwen3.8-Max",
    contextWindow: 2e5,
    priceFactor: 0.5,
    supportsImage: true,
    supportsThinking: true,
    isFree: true,
    efforts: ["xhigh", "low", "medium"],
    defaultEffort: "medium",
    supportsDisable: true,
    promotion: { active: true, discountFactor: 0.4, beforePromotionPriceFactor: 0.5, windowStart: "22:00", windowEnd: "08:00", badgeZh: "\u9519\u5CF0 4 \u6298" }
  },
  {
    id: "qfmodel",
    name: "Qwen3.8-Flash",
    contextWindow: 2e5,
    priceFactor: 0.1,
    supportsImage: true,
    supportsThinking: true,
    isFree: true,
    efforts: ["xhigh", "low", "medium"],
    defaultEffort: "medium",
    supportsDisable: true
  },
  {
    id: "dmodel",
    name: "DeepSeek-V4-Pro",
    contextWindow: 2e5,
    priceFactor: 0.5,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["high", "max"],
    defaultEffort: "max",
    supportsDisable: true
  },
  // 上游 `is_reasoning:false` 但目录给了三档，实测有思考帧 —— 以档位为准。
  {
    id: "dfmodel",
    name: "DeepSeek-Flash",
    contextWindow: 2e5,
    maxTokens: 393216,
    priceFactor: 0.1,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["high", "max", "low"],
    defaultEffort: "high",
    supportsDisable: true
  },
  // ⚠️ 实测：`high` / `low` 档**不产出** reasoning_content（各 0 帧），
  // 只有 `max` 档会（423/540 帧）。故默认档取 `max`，并把 `max` 排在最前，
  // 让宿主默认落在能真正思考的那一档。
  {
    id: "gmodel_latest",
    name: "GLM-5.4",
    contextWindow: 2e5,
    priceFactor: 0.8,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["max", "high", "low"],
    defaultEffort: "max"
  },
  {
    id: "gmodel",
    name: "GLM-5.3",
    contextWindow: 2e5,
    priceFactor: 0.8,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["high", "low", "max"],
    defaultEffort: "high"
  },
  {
    id: "gfmodel",
    name: "GLM-5.3-Flash",
    contextWindow: 1e6,
    priceFactor: 0.1,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["high", "max"],
    defaultEffort: "max"
  },
  {
    id: "kmodel_latest",
    name: "Kimi-K3.1-Pro",
    contextWindow: 2e5,
    priceFactor: 1,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["high", "low", "max"],
    defaultEffort: "high"
  },
  // 同目录已有 Kimi-K3.1-Pro（`kmodel_latest`），K2.8 预览款默认不选。
  {
    id: "kmodel",
    name: "Kimi-K2.8-Preview",
    contextWindow: 2e5,
    priceFactor: 0.8,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["high", "low", "max"],
    defaultEffort: "high",
    stale: true,
    staleReason: "\u540C\u76EE\u5F55\u5DF2\u6709 Kimi-K3.1-Pro\u3002"
  },
  {
    id: "jmodel",
    name: "Step-5-Preview",
    contextWindow: 1e6,
    priceFactor: 0.3,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["high", "low", "medium"],
    defaultEffort: "high",
    supportsDisable: true
  },
  {
    id: "mmodel",
    name: "MiniMax-M3.1-Flash",
    contextWindow: 2e5,
    priceFactor: 0.1,
    supportsImage: true,
    supportsThinking: true,
    efforts: ["xhigh", "high", "low", "max", "medium"],
    defaultEffort: "xhigh"
  }
];
var QODER_CN = {
  // ⚠️ id 不带连字符：它同时是 cordis 服务名（`qodercnAuth`）、LLM 路由名
  // （`llm-qodercn`）与凭据 ref 前缀（`QODERCN_ACCESS_TOKEN`）的组成部分，
  // 带连字符会让服务名不符合 camelCase 惯例。
  id: "qodercn",
  displayName: "Qoder (\u4E2D\u56FD\u7248)",
  // E4：CN endpoint-cache.json + asar `environments.prod`（website/auth/collaboration
  // 三个都指向 qoder.cn，openApi 指向 openapi.qoder.com.cn）。
  authBase: "https://qoder.cn",
  openApiBase: "https://openapi.qoder.com.cn",
  // ⚠️ CN **没有**可用的公开 OpenAI 兼容端点：实测
  // `gateway.qoder.com.cn/model/v1/chat/completions` 与
  // `openapi.qoder.com.cn/model/v1/chat/completions` 都回 503（alb 无上游路由）。
  // 而 `inferBase` 在本代码里**没有任何调用方**（公开端点方案早已被加密
  // 端点取代，见 `QODER_CHAT_PATH` 同样无人使用），故这里填成与
  // `encryptedInferBase` 同值仅表示「没有独立公开端点」，**不要**据此发请求。
  // 不删该字段：删除属于与本任务无关的重构，且会牵动国际版注释。
  inferBase: "https://gateway.qoder.com.cn",
  // E4 + E9：`algo` 网关在 CN 换域名，路径与协议同形
  // （零凭据 POST 的错误响应形态与国际版逐字节一致）。
  encryptedInferBase: "https://gateway.qoder.com.cn",
  // E2：取自 CN asar 的 `Vpe.authClientIds.prod`。
  // ⚠️ **与国际版完全不同** —— 国际版两个 id 在 CN asar 里命中 0 次。
  // 用错的症状是「授权页 302 正常、点击授权后报参数无效」，
  // 故**不能**靠探测入口验证，必须真实登录闭环（tests/e2e/qodercn-probe）。
  clientId: "732aef47-9cf2-46a2-95fe-4cebb5d0d1fa",
  // E2：CN 的 `authClientIds.test` 与 `prod` **同一个值**，因此不存在国际版
  // `J_a` / `G_a` 被读反的那类风险。字段仍保留以免改动 `QoderProduct` 形状。
  testClientId: "732aef47-9cf2-46a2-95fe-4cebb5d0d1fa",
  // 沿用国际版的 **CLI** 身份（源码 `Fp()` 默认值）。
  // ⚠️ CN 桌面端自己用的是 `Fh`（clientType 10 / businessProduct 'app' /
  // sessionType 'app' / scene 'app'）。插件走 CLI 身份在国际版实测可用；
  // CN 是否接受由 e2e 对话探针验证 —— 若被拒，改这一组值，
  // 但**不要**顺手把下面 `sashClientType` 一起改（那是两个不同身份，
  // 见 `QoderProduct.sashClientType` 的注释）。
  clientMetadata: {
    client_type: "5",
    business_product: "cli",
    business_type: "agent",
    scene: "assistant"
  },
  // E10：CN asar 里同样是 `Fh = Object.freeze({ clientType: 10, … })`。
  sashClientType: "10",
  // E11：CN asar 的 sash 请求头 UA 恒为 `"Qoder"`，与国际版一致。
  userAgentPrefix: "qoder",
  defaultCredentialRef: "QODERCN_ACCESS_TOKEN",
  fallbackModels: QODER_CN_FALLBACK_MODELS
};
var ALL_QODER_PRODUCTS = [QODER, QODER_CN];
function qoderProductById(id) {
  return ALL_QODER_PRODUCTS.find((product) => product.id === id);
}

// vendor/channel-pack/src/trae-product.ts
var TRAE_REFERENCE_RATES = {
  "Doubao-Seed-2.1-Turbo": 0.4,
  "Doubao-Seed-2.1-Pro": 0.8,
  "Doubao-Seed-Evolving": 0.8,
  "Doubao-Seed-Code": 0.12,
  "deepseek-v4.1-flash": 0.12,
  "DeepSeek-V4-Pro-Official": 0.72,
  "glm-5.3": 0.78,
  "glm-5.2": 0.78
};
var TRAE_AGENT_HOST = "https://trae-api-cn.mchost.guru";
var TRAE_UG_HOST = "https://api.trae.cn";
var TRAE_OAUTH_HOST = "https://api.trae.com.cn";
var TRAE_CONSOLE_HOST = "https://www.trae.cn";
var TRAE_SUBSCRIPTION_ONLY_MODELS = /* @__PURE__ */ new Set([
  "qwen4-max",
  "glm-5.4",
  "kimi-k3.1-pro",
  "kimi-k3.1-pro-highspeed"
]);
var TRAE_EFFORTS_2 = Object.freeze({ options: ["light", "high"], defaultLevel: "high", supportThinking: true });
var TRAE_EFFORTS_3_HIGH = Object.freeze({ options: ["light", "high", "extra_high"], defaultLevel: "high", supportThinking: true });
var TRAE_EFFORTS_3_XHIGH = Object.freeze({ options: ["light", "high", "extra_high"], defaultLevel: "extra_high", supportThinking: true });
var TRAE_FALLBACK_MODELS = [
  { id: "Doubao-Seed-2.1-Turbo", name: "Seed-2.1-Turbo", contextWindow: 256e3, multimodal: true, reasoningConfig: TRAE_EFFORTS_2 },
  { id: "Doubao-Seed-2.1-Pro", name: "Seed-2.1-Pro-0915", contextWindow: 256e3, multimodal: true, reasoningConfig: TRAE_EFFORTS_2 },
  // Seed-Evolving 曾为会员限定，2026-11-26 用户核实已不再限定（普通账号可调用）。
  { id: "Doubao-Seed-Evolving", name: "Seed-Evolving", contextWindow: 256e3, multimodal: true },
  // 远端目录已由同用途的 Seed-2.0-Code 接替（兜底表不收该 id，只能靠策展标记
  // 表达「旧版默认关」；远端真拉时由 model-catalog 的 TRAE 命名后继规则表达）。
  { id: "Doubao-Seed-Code", name: "Seed-Code", contextWindow: 256e3, multimodal: true, reasoningConfig: TRAE_EFFORTS_2, stale: true, staleReason: "\u4E0A\u6E38\u76EE\u5F55\u5DF2\u6709\u540C\u7528\u9014\u540E\u7EE7 Seed-2.0-Code\u3002" },
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_XHIGH },
  { id: "glm-5.3-flashx", name: "GLM-5.3-FlashX", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_XHIGH },
  { id: "glm-5.3", name: "GLM-5.3", contextWindow: 2e5, multimodal: false, reasoningConfig: TRAE_EFFORTS_3_XHIGH },
  { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_HIGH },
  { id: "DeepSeek-V4-Pro-Official", name: "DeepSeek-V4-Pro", contextWindow: 2e5, multimodal: false, reasoningConfig: TRAE_EFFORTS_3_HIGH },
  // 订阅限定：Qwen4 / GLM-5.4 / Kimi-K3.1 系列仅付费订阅账号可调用（见
  // TRAE_SUBSCRIPTION_ONLY_MODELS；远端目录不下发该标志）。
  { id: "kimi-k3.1-pro-highspeed", name: "Kimi-K3.1-Pro-Highspeed", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_XHIGH, subscriptionOnly: true },
  { id: "kimi-k3.1-pro", name: "Kimi-K3.1-Pro", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_XHIGH, subscriptionOnly: true },
  // 同族已有更新一代（kimi-k3.1-pro / -highspeed）在同一目录里，故默认不选。
  { id: "kimi-k3", name: "Kimi-K3", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_XHIGH, stale: true, staleReason: "\u540C\u76EE\u5F55\u5DF2\u6709 Kimi-K3.1-Pro\u3002" },
  { id: "mimo-v2.6-flash", name: "MiMo-V2.6-Flash", contextWindow: 2e5, multimodal: true },
  { id: "mimo-v2.6-pro", name: "MiMo-V2.6-Pro", contextWindow: 2e5, multimodal: true },
  { id: "minimax-m3.1-flash", name: "MiniMax-M3.1-Flash", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_XHIGH },
  // 同族已有 MiniMax-M3.1-Flash。
  { id: "minimax-m3", name: "MiniMax-M3", contextWindow: 2e5, multimodal: true, stale: true, staleReason: "\u540C\u76EE\u5F55\u5DF2\u6709 MiniMax-M3.1-Flash\u3002" },
  { id: "step-5-preview", name: "Step-5-Preview", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_2 },
  { id: "qwen4-max", name: "Qwen4-Max", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_HIGH, subscriptionOnly: true },
  { id: "qwen3.8-flash", name: "Qwen3.8-Flash", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_HIGH },
  { id: "qwen3.8-max", name: "Qwen3.8-Max", contextWindow: 2e5, multimodal: true, reasoningConfig: TRAE_EFFORTS_3_HIGH }
];
var TRAE_CHANNELS = resolveChannelList(
  process.env.DSH_TRAE_CHANNELS
);
function resolveChannelList(raw) {
  const fallback = [
    // ── 通用通道（顺序即优先级）──
    "solo_agent",
    "solo_work_lite",
    "solo_agent_remote",
    "solo_work_remote",
    "solo_agent_lite",
    // ── 专用通道（只有通用通道都不含某模型时才会命中）──
    "chat_v3",
    "builder_v3",
    "solo_coder",
    "solo_design_lite",
    "solo_design_remote",
    "git_ai",
    "code_reviewer",
    "code_review_summary",
    "multimodal",
    "system_diagnosis"
  ];
  if (raw === void 0) return fallback;
  const parsed = raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : fallback;
}
function isTruthyFlag(raw) {
  if (raw === void 0) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
function resolveMaxModeFlag(raw) {
  if (raw === void 0) return true;
  const value = raw.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "no" || value === "off");
}
function resolveMaxModeModels(raw) {
  if (raw === void 0) return void 0;
  const parsed = raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : void 0;
}
var TRAE = {
  id: "trae",
  displayName: "TRAE (\u5B57\u8282)",
  agentHost: TRAE_AGENT_HOST,
  ugHost: TRAE_UG_HOST,
  oauthHost: TRAE_OAUTH_HOST,
  consoleHost: TRAE_CONSOLE_HOST,
  clientId: "en1oxy7wnw8j9n",
  appId: "6eefa01c-1036-4c7e-9ca5-d891f63bfcd8",
  // 对齐 TRAE SOLO CN 0.1.69 (20260917)：老版本 0.1.52 会导致上游省略部分新模型与思考档位。
  ideVersion: "0.1.69",
  ideVersionCode: "20260917",
  deviceBrand: "Apple",
  osVersion: "macOS 15.7.4",
  function: "solo_work_lite",
  channels: TRAE_CHANNELS,
  fallbackMaxOutputTokens: 32e3,
  maxMode: resolveMaxModeFlag(process.env.DSH_TRAE_MAX_MODE),
  maxModeModels: resolveMaxModeModels(process.env.DSH_TRAE_MAX_MODELS),
  hideInternalModels: isTruthyFlag(process.env.DSH_TRAE_HIDE_INTERNAL),
  pluginVersion: "2.3.62834",
  defaultCredentialRef: "TRAE_ACCESS_TOKEN",
  userAgent: "Trae/0.1.69",
  fallbackModels: TRAE_FALLBACK_MODELS
};

// vendor/channel-pack/src/qoder.ts
import { createHash, randomUUID, randomBytes as randomBytes2 } from "node:crypto";
var QODER_REQUEST_TIMEOUT_MS = 3e4;
var QODER_LOGIN_TIMEOUT_MS = 3e5;
var QODER_POLL_INTERVAL_MS = 1e3;
var QODER_POLL_MAX_FAILURES = 5;
var QODER_DEVICE_SELECT_PATH = "/device/selectAccounts";
var QODER_POLL_PATH = "/api/v1/deviceToken/poll";
var QODER_REFRESH_PATH = "/api/v1/deviceToken/refresh";
var QODER_USERINFO_PATH = "/api/v1/userinfo";
var PKCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
function createQoderPkce() {
  const length = 43 + Math.floor(86 * Math.random());
  const bytes = randomBytes2(length);
  let verifier = "";
  for (let i = 0; i < length; i++) {
    verifier += PKCE_ALPHABET[bytes[i] % PKCE_ALPHABET.length];
  }
  const challenge = createHash("sha256").update(verifier).digest().toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}
function createQoderDeviceSession(machineId) {
  return {
    pkce: createQoderPkce(),
    nonce: randomUUID(),
    machineId: machineId ?? randomUUID()
  };
}
function buildQoderAuthUrl(session, product) {
  const query = new URLSearchParams({
    challenge: session.pkce.challenge,
    challenge_method: "S256",
    nonce: session.nonce,
    machine_id: session.machineId,
    client_id: product.clientId
  });
  return `${product.authBase}${QODER_DEVICE_SELECT_PATH}?${query.toString()}`;
}
function buildQoderPollUrl(session, product) {
  const query = new URLSearchParams({
    nonce: session.nonce,
    verifier: session.pkce.verifier,
    challenge_method: "S256"
  });
  return `${product.openApiBase}${QODER_POLL_PATH}?${query.toString()}`;
}
function readString(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return void 0;
}
function readTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? Math.round(value * 1e3) : Math.round(value);
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function parseQoderTokenPayload(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { accessToken: "" };
  }
  const source = value;
  const accessToken = readString(source, ["token", "device_token", "access_token"]) ?? "";
  const refreshToken = readString(source, ["refresh_token", "refreshToken"]);
  const expiresAt = readTimestamp(source.expires_at ?? source.expiresAt);
  const refreshTokenExpiresAt = readTimestamp(
    source.refresh_token_expires_at ?? source.refreshTokenExpiresAt
  );
  const uid = readString(source, ["user_id", "userId"]);
  const userName = readString(source, ["user_name", "userName"]);
  return {
    accessToken,
    ...refreshToken === void 0 ? {} : { refreshToken },
    ...expiresAt === void 0 ? {} : { expiresAt },
    ...refreshTokenExpiresAt === void 0 ? {} : { refreshTokenExpiresAt },
    ...uid === void 0 ? {} : { uid },
    ...userName === void 0 ? {} : { userName }
  };
}
function buildQoderCredential(payload, extra) {
  const nickname = extra.nickname !== void 0 && extra.nickname.length > 0 ? extra.nickname : payload.userName;
  return {
    security_oauth_token: payload.accessToken,
    access_token: payload.accessToken,
    ...payload.refreshToken === void 0 ? {} : { refresh_token: payload.refreshToken },
    ...payload.expiresAt === void 0 ? {} : { expire_time: payload.expiresAt },
    ...payload.refreshTokenExpiresAt === void 0 ? {} : { refresh_token_expire_time: payload.refreshTokenExpiresAt },
    machine_id: extra.machineId,
    ...payload.uid === void 0 ? {} : { uid: payload.uid },
    ...nickname === void 0 || nickname.length === 0 ? {} : { nickname }
  };
}
function qoderCredentialExpiresAtMs(credential) {
  return credential.expire_time;
}
function isQoderRefreshable(credential) {
  return typeof credential.refresh_token === "string" && credential.refresh_token.length > 0;
}
function isQoderExpired(credential, nowMs = Date.now()) {
  const expiresAt = qoderCredentialExpiresAtMs(credential);
  return expiresAt !== void 0 && expiresAt <= nowMs;
}
function qoderRefreshBody(credential) {
  return {
    refresh_token: credential.refresh_token ?? "",
    machine_id: credential.machine_id
  };
}
function qoderBearerToken(credential) {
  const token = credential.security_oauth_token;
  if (typeof token === "string" && token.length > 0) return token;
  return typeof credential.access_token === "string" ? credential.access_token : "";
}
function applyQoderRefresh(credential, payload) {
  const next = buildQoderCredential(payload, {
    machineId: credential.machine_id,
    ...credential.nickname === void 0 ? {} : { nickname: credential.nickname }
  });
  if (next.refresh_token === void 0 && credential.refresh_token !== void 0) {
    next.refresh_token = credential.refresh_token;
  }
  if (next.uid === void 0 && credential.uid !== void 0) {
    next.uid = credential.uid;
  }
  return next;
}
async function fetchQoderUserNickname(credential, product, fetcher = fetch) {
  try {
    const response = await fetcher(`${product.openApiBase}${QODER_USERINFO_PATH}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential.security_oauth_token || credential.access_token}`
      }
    });
    if (!response.ok) return void 0;
    const body = await response.json();
    if (typeof body !== "object" || body === null) return void 0;
    const name = body.name;
    if (typeof name !== "string") return void 0;
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : void 0;
  } catch {
    return void 0;
  }
}
function withQoderNickname(credential, nickname) {
  if (nickname === void 0 || nickname.length === 0) return credential;
  return { ...credential, nickname };
}

// vendor/channel-pack/src/credits.ts
function roundCredits(value) {
  return Math.round(value * 100) / 100;
}
function normalizeCreditUnit(unit) {
  return unit === "token" ? "token" : "credit";
}
function claimUnitOf(unit) {
  return normalizeCreditUnit(typeof unit === "string" ? unit : "");
}
function formatCreditAmount(value) {
  if (!Number.isFinite(value)) return "?";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
function formatTokenAmount(value) {
  if (!Number.isFinite(value)) return "?";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return String(Math.round(value));
}
function claimUnitLabel(unit) {
  return unit === "token" ? "Token" : "\u79EF\u5206";
}
function formatUnitAmount(value, unit) {
  const text = unit === "token" ? formatTokenAmount(value) : formatCreditAmount(value);
  return `${text}${claimUnitLabel(unit)}`;
}
function formatClaimGains(totals) {
  if (totals === void 0 || totals === null || typeof totals !== "object") return null;
  const parts = [];
  for (const unit of ["token", "credit"]) {
    const value = Number(totals[unit]);
    if (!Number.isFinite(value) || value <= 0) continue;
    parts.push(`+${formatUnitAmount(value, unit)}`);
  }
  return parts.length === 0 ? null : parts.join(", ");
}

// vendor/channel-pack/src/model-queue.ts
import { LlmError } from "@deepseek-ai/dsh-llm";

// vendor/channel-pack/src/retry-after.ts
function parseRetryAfterMs(raw, nowMs = Date.now()) {
  if (raw === void 0 || raw === null || raw === "") return void 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.ceil(seconds * 1e3) : void 0;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : void 0;
}
function retryAfterMsFromResponse(headers, nowMs = Date.now()) {
  if (headers === null || headers === void 0) return void 0;
  return parseRetryAfterMs(headers.get("retry-after"), nowMs);
}

// vendor/channel-pack/src/model-queue.ts
var QUEUE_BUSINESS_CODE = "10605";
var ModelQueuedError = class extends LlmError {
  queueInfo;
  retryAfterMs;
  constructor(message, options) {
    super(message, "QUEUE");
    this.name = "ModelQueuedError";
    this.queueInfo = options.queueInfo;
    this.retryAfterMs = options.retryAfterMs;
  }
};
var BILLING_BUSINESS_CODE = "110";
function isBillingBusinessCode(code) {
  return code === BILLING_BUSINESS_CODE || code === Number(BILLING_BUSINESS_CODE);
}
var QODER_BILLING_UTC_OFFSET_MS = 8 * 36e5;
function nextUtc8DayStartMs(nowMs = Date.now()) {
  const shifted = nowMs + QODER_BILLING_UTC_OFFSET_MS;
  const msIntoDay = (shifted % 864e5 + 864e5) % 864e5;
  return nowMs + (864e5 - msIntoDay);
}
function looksLikeBillingError(text) {
  return /billing\s+daily\s+count\s+exceeded|daily\s+count\s+exceeded|billing_error/i.test(text);
}
var QUEUE_MAX_DELAY_MS = 1e4;
var QUEUE_MAX_ATTEMPTS = 180;
function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function isQueueBusinessCode(code) {
  return code === QUEUE_BUSINESS_CODE || code === Number(QUEUE_BUSINESS_CODE);
}
function queueNodes(body) {
  let root = body;
  if (typeof body === "string") {
    try {
      root = JSON.parse(body);
    } catch {
      return [];
    }
  }
  if (root === null || typeof root !== "object") return [];
  const seen = /* @__PURE__ */ new Set();
  const nodes = [];
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const record = node;
    nodes.push(record);
    for (const key of ["data", "result", "message", "body", "error", "response"]) {
      const value = record[key];
      if (value !== null && typeof value === "object") queue.push(value);
      else if (key !== "response" && typeof value === "string" && value.length > 0) {
        try {
          queue.push(JSON.parse(value));
        } catch {
        }
      }
    }
  }
  return nodes;
}
function parseQueueError(body) {
  const nodes = queueNodes(body);
  const info = nodes.find((node) => node.isQueued !== void 0 || node.serviceAvailable !== void 0);
  if (info === void 0) return void 0;
  const codeHit = nodes.some((node) => isQueueBusinessCode(node.code));
  if (!codeHit && info.isQueued === void 0) return void 0;
  const out = {};
  if (typeof info.isQueued === "boolean") out.isQueued = info.isQueued;
  if (typeof info.modelKey === "string" && info.modelKey.length > 0) out.modelKey = info.modelKey;
  if (typeof info.queueType === "string" && info.queueType.length > 0) out.queueType = info.queueType;
  if (typeof info.serviceAvailable === "boolean") out.serviceAvailable = info.serviceAvailable;
  for (const key of ["queueCount", "retryAfterSeconds", "waitTime", "retry_after_ms", "retryAfterMs"]) {
    const value = readFiniteNumber(info[key]);
    if (value !== void 0) out[key] = Math.trunc(value);
  }
  return out;
}
function throwIfModelQueued(body, headers) {
  const declared = queueNodes(body).find((node) => node.isQueued === true || [node.code, node.type].some((value) => typeof value === "string" && ["queued", "model_queued"].includes(value.toLowerCase())));
  if (declared === void 0) return;
  const info = parseQueueError(body) ?? parseQueueError({ ...declared, isQueued: true }) ?? { isQueued: true };
  const delay = queueDelayMs(info) ?? retryAfterMsFromResponse(headers);
  throw new ModelQueuedError("\u6A21\u578B\u6392\u961F\u4E2D", {
    queueInfo: { ...info },
    ...delay === void 0 ? {} : { retryAfterMs: Math.min(delay, QUEUE_MAX_DELAY_MS) }
  });
}
async function checkQueuedResponse(response) {
  if (!response.ok) {
    const body = await response.clone().text().catch(() => void 0);
    if (body !== void 0) throwIfModelQueued(body, response.headers);
  } else if (response.body !== null && response.headers.get("content-type")?.includes("application/json")) {
    const decoder = new TextDecoder();
    let prefix = "";
    const reader = response.body.getReader();
    let cancelling;
    const cancel = (reason) => {
      cancelling ??= reader.cancel(reason).finally(() => reader.releaseLock());
      return cancelling;
    };
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value: chunk } = await reader.read();
          if (cancelling !== void 0) return;
          if (done) {
            reader.releaseLock();
            controller.close();
            return;
          }
          if (prefix !== void 0) {
            prefix += decoder.decode(chunk, { stream: true });
            if (prefix.length > 65536 || prefix.trimStart().length > 0 && !prefix.trimStart().startsWith("{")) {
              prefix = void 0;
            } else {
              let parsed;
              try {
                parsed = JSON.parse(prefix);
              } catch {
              }
              if (parsed !== void 0) {
                prefix = void 0;
                throwIfModelQueued(parsed, response.headers);
              }
            }
          }
          controller.enqueue(chunk);
        } catch (error) {
          await cancel(error).catch(() => {
          });
          controller.error(error);
        }
      },
      cancel
    });
    return new Response(body, response);
  }
  return response;
}
function queueDelayMs(info) {
  if (info === void 0) return void 0;
  const ms = readFiniteNumber(info.retry_after_ms) ?? readFiniteNumber(info.retryAfterMs);
  const fromSeconds = readFiniteNumber(info.retryAfterSeconds);
  const raw = ms ?? (fromSeconds === void 0 ? void 0 : fromSeconds * 1e3);
  if (raw === void 0 || raw < 0) return void 0;
  return Math.min(Math.trunc(raw), QUEUE_MAX_DELAY_MS);
}

// vendor/channel-pack/src/qoder-machine.ts
import { execFileSync, spawn } from "node:child_process";
import { existsSync as existsSync4, readFileSync as readFileSync4, readdirSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join4 } from "node:path";
var RUNTIME_INFO_TIMEOUT_MS = 2e4;
var cached;
function candidatePaths() {
  const override = process.env.QODER_MACHINE_TOKEN_PATH;
  if (override !== void 0 && override.length > 0) return [override];
  const paths = [];
  const appData = process.env.APPDATA;
  if (appData !== void 0 && appData.length > 0) {
    for (const dir of ["Qoder", "Qoder CN"]) {
      paths.push(join4(appData, dir, "SharedClientCache", "cache", "machine_token.json"));
    }
  }
  const home = homedir2();
  for (const dir of ["Qoder", "Qoder CN"]) {
    paths.push(join4(home, "Library", "Application Support", dir, "SharedClientCache", "cache", "machine_token.json"));
    paths.push(join4(home, ".config", dir, "SharedClientCache", "cache", "machine_token.json"));
  }
  return paths;
}
function parseFile(path) {
  let raw;
  try {
    raw = readFileSync4(path, "utf8");
  } catch {
    return void 0;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
  const record = parsed;
  const token = record.token;
  const type = record.type;
  if (typeof token !== "string" || token.length === 0) return void 0;
  if (typeof type !== "string" || type.length === 0) return void 0;
  return { token, type };
}
async function resolveQoderMachineIdentityAsync(forceExecutable) {
  if (cached !== void 0) return cached ?? void 0;
  const live = await readFromRuntimeInfoAsync(forceExecutable);
  if (live !== void 0) {
    cached = live;
    return live;
  }
  for (const path of candidatePaths()) {
    const identity = parseFile(path);
    if (identity !== void 0) {
      cached = identity;
      return identity;
    }
  }
  cached = null;
  return void 0;
}
var QODER_DATA_DIR_NAMES = [".qoder", ".qoder-cn"];
function findRuntimeInfoExecutable(home, dataDirNames = QODER_DATA_DIR_NAMES) {
  const exeName = process.platform === "win32" ? "runtime-info.exe" : "runtime-info";
  for (const dirName of dataDirNames) {
    const binDir = join4(home, dirName, ".bin");
    let entries;
    try {
      entries = readdirSync(binDir);
    } catch {
      continue;
    }
    const dir = entries.find((name) => name.startsWith("umid-"));
    if (dir === void 0) continue;
    const exe = join4(binDir, dir, exeName);
    if (existsSync4(exe)) return exe;
  }
  return void 0;
}
function locateRuntimeInfo(override) {
  const fromEnv = process.env.QODER_RUNTIME_INFO;
  const candidate = override ?? (fromEnv !== void 0 && fromEnv.length > 0 ? fromEnv : void 0);
  if (candidate !== void 0) {
    return existsSync4(candidate) ? candidate : void 0;
  }
  return findRuntimeInfoExecutable(homedir2());
}
var RUNTIME_INFO_ENVIRONMENT = "3";
function runtimeInfoArgs() {
  return [RUNTIME_INFO_ENVIRONMENT, "--account-stdin"];
}
function parseRuntimeInfoOutput(out) {
  const start = out.indexOf("{");
  if (start < 0) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(out.slice(start));
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  const record = parsed;
  const token = record.machineToken;
  const type = record.machineType;
  if (typeof token !== "string" || token.length === 0) return void 0;
  if (typeof type !== "string" || type.length === 0) return void 0;
  return { token, type };
}
async function readFromRuntimeInfoAsync(override) {
  const exe = locateRuntimeInfo(override);
  if (exe === void 0) return void 0;
  return await new Promise((resolve2) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve2(value);
    };
    let child;
    try {
      child = spawn(exe, [...runtimeInfoArgs()], { windowsHide: true });
    } catch {
      done(void 0);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
      done(void 0);
    }, RUNTIME_INFO_TIMEOUT_MS);
    timer.unref?.();
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", () => {
    });
    child.once("error", () => {
      clearTimeout(timer);
      done(void 0);
    });
    child.once("close", () => {
      clearTimeout(timer);
      done(parseRuntimeInfoOutput(stdout));
    });
    child.stdin?.on("error", () => {
    });
    child.stdin?.end(JSON.stringify({ account: "" }));
  });
}
async function withQoderMachineHeadersAsync(headers, forceExecutable) {
  const identity = await resolveQoderMachineIdentityAsync(forceExecutable);
  if (identity === void 0) return headers;
  return {
    ...headers,
    "Cosy-MachineToken": identity.token,
    "Cosy-MachineType": identity.type
  };
}

// vendor/channel-pack/src/qoder-credits.ts
var QODER_USAGE_PATH = "/sash/api/v2/me/usage";
var QODER_CAMPAIGNS_PATH = "/sash/api/v1/me/campaigns";
var QODER_CAMPAIGN_REFRESH_HOUR_UTC8 = 10;
function hasQoderCampaignRefreshedToday(nowMs = Date.now()) {
  const utc8 = new Date(nowMs + QODER_BILLING_UTC_OFFSET_MS);
  return utc8.getUTCHours() >= QODER_CAMPAIGN_REFRESH_HOUR_UTC8;
}
var QODER_CREDITS_TIMEOUT_MS = 15e3;
var NOT_ACTIVATED_HINT = "\u8BE5\u8D26\u53F7\u5C1A\u672A\u5728 Qoder \u4FA7\u5F00\u901A\u6BCF\u65E5\u9886\u53D6\uFF08\u6BCF\u65E5 100 Credits\uFF09\u3002\u8BF7\u5148\u7528 Qoder \u5B98\u65B9\u5BA2\u6237\u7AEF\u767B\u5F55\u4E00\u6B21\u8BE5\u8D26\u53F7\uFF0C\u5F00\u901A\u540E\u518D\u56DE\u6765\u9886\u53D6\u3002";
var NOT_REFRESHED_YET_HINT = `\u4ECA\u5929\u7684\u6BCF\u65E5\u6D3B\u52A8\u5C1A\u672A\u5237\u65B0\uFF08\u6BCF\u65E5 ${QODER_CAMPAIGN_REFRESH_HOUR_UTC8}:00\uFF08UTC+8\uFF09\u5237\u65B0\uFF09\uFF0C\u5F53\u524D\u770B\u5230\u7684\u662F\u6628\u5929\u90A3\u4E00\u8F6E\uFF0C\u8BF7\u7A0D\u540E\u518D\u6765\u9886\u53D6\u3002`;
function isQoderNotActivated(campaigns, usageBody) {
  if (campaigns === void 0) return false;
  const hasBenefit = campaigns.campaigns.some((c) => c.actionType === "CLAIM_BENEFIT");
  if (hasBenefit) return false;
  if (typeof usageBody !== "object" || usageBody === null) return false;
  const usage = usageBody.qoderUsage;
  if (typeof usage !== "object" || usage === null) return false;
  const record = usage;
  return record.addOnQuota === void 0;
}
async function fetchQoderUsageRaw(credential, product, fetcher = fetch) {
  try {
    const response = await fetcher(`${product.openApiBase}${QODER_USAGE_PATH}`, {
      method: "GET",
      headers: await creditsHeaders(credential, product),
      signal: AbortSignal.timeout(QODER_CREDITS_TIMEOUT_MS)
    });
    if (!response.ok) return void 0;
    return await response.json();
  } catch {
    return void 0;
  }
}
async function creditsHeaders(credential, product) {
  return await withQoderMachineHeadersAsync({
    Accept: "application/json",
    Authorization: `Bearer ${qoderBearerToken(credential)}`,
    // 桌面 app 身份（`'10'`）；服务端据此进入活动下发分支。
    "Cosy-ClientType": product.sashClientType,
    "User-Agent": "Qoder"
  });
}
function readNumber(source, key) {
  if (typeof source !== "object" || source === null) return void 0;
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function readString2(source, key) {
  if (typeof source !== "object" || source === null) return void 0;
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
var QODER_PLAN_PACKAGE = "\u5957\u9910\u989D\u5EA6";
function toPackage(name, quota, options = {}) {
  const total = readNumber(quota, "total");
  const used = readNumber(quota, "used");
  const remainingRaw = readNumber(quota, "remaining");
  if (total === void 0 && used === void 0 && remainingRaw === void 0) return void 0;
  const totalValue = Math.max(0, total ?? 0);
  const usedValue = Math.max(0, used ?? 0);
  const remaining = remainingRaw !== void 0 ? Math.max(0, remainingRaw) : Math.max(0, totalValue - usedValue);
  const expMs = options.expiredTime && options.expiredTime.length > 0 ? Date.parse(options.expiredTime.replace(" ", "T")) : Number.NaN;
  return {
    name,
    unit: readString2(quota, "unit") ?? "credits",
    remaining,
    total: totalValue,
    used: usedValue,
    active: options.active ?? true,
    cycleStartTime: "",
    cycleEndTime: "",
    expiredTime: options.expiredTime ?? "",
    ...Number.isFinite(expMs) ? { deductionEndTime: expMs } : {}
  };
}
async function fetchQoderCreditBalance(credential, product, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${product.openApiBase}${QODER_USAGE_PATH}`, {
      method: "GET",
      headers: await creditsHeaders(credential, product),
      signal: AbortSignal.timeout(QODER_CREDITS_TIMEOUT_MS)
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let body;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const root = body;
  if (root.displayMode === "enterprise") return null;
  const usage = root.qoderUsage;
  if (typeof usage !== "object" || usage === null) return null;
  const packages = [];
  const userQuota = toPackage(QODER_PLAN_PACKAGE, usage.userQuota);
  if (userQuota !== void 0) packages.push(userQuota);
  const addOnQuota = toPackage("\u8D44\u6E90\u5305", usage.addOnQuota);
  if (addOnQuota !== void 0) packages.push(addOnQuota);
  const dedicated = usage.dedicatedResourcePackages;
  if (Array.isArray(dedicated)) {
    for (const item of dedicated) {
      const pkg = toPackage(
        readString2(item, "name") ?? readString2(item, "id") ?? "\u4E13\u7528\u8D44\u6E90\u5305",
        item,
        { expiredTime: readString2(item, "expiresAt") ?? readString2(item, "expires_at") ?? "" }
      );
      if (pkg !== void 0) packages.push(pkg);
    }
  }
  if (packages.length === 0) return null;
  const total = roundCredits(packages.reduce((sum, pkg) => sum + pkg.remaining, 0));
  return { total, packages, expiredTotal: 0 };
}
function parseQoderCampaigns(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return void 0;
  const root = body;
  const raw = root.campaigns;
  const campaigns = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const id = readString2(item, "campaignId");
      if (id === void 0) continue;
      campaigns.push({
        campaignId: id,
        ...readString2(item, "campaignKey") !== void 0 ? { campaignKey: readString2(item, "campaignKey") } : {},
        ...readString2(item, "actionType") !== void 0 ? { actionType: readString2(item, "actionType") } : {},
        ...readString2(item, "claimStatus") !== void 0 ? { claimStatus: readString2(item, "claimStatus") } : {},
        ...benefitAmount(item) !== void 0 ? { amount: benefitAmount(item) } : {}
      });
    }
  }
  return {
    showCampaign: root.showCampaign === true,
    claimable: root.claimable === true,
    campaigns
  };
}
function benefitAmount(item) {
  if (typeof item !== "object" || item === null) return void 0;
  return readNumber(item.benefit, "amount");
}
async function loadCampaigns(credential, product, fetcher) {
  let response;
  try {
    response = await fetcher(`${product.openApiBase}${QODER_CAMPAIGNS_PATH}`, {
      method: "GET",
      headers: await creditsHeaders(credential, product),
      signal: AbortSignal.timeout(QODER_CREDITS_TIMEOUT_MS)
    });
  } catch {
    return void 0;
  }
  if (!response.ok) return void 0;
  let body;
  try {
    body = await response.json();
  } catch {
    return void 0;
  }
  return parseQoderCampaigns(body);
}
async function fetchQoderCheckinStatus(credential, product, fetcher = fetch, nowMs = Date.now()) {
  const parsed = await loadCampaigns(credential, product, fetcher);
  if (parsed === void 0) return null;
  const refreshed = hasQoderCampaignRefreshedToday(nowMs);
  const claimable = claimableCampaigns(parsed);
  const benefitCampaigns = parsed.campaigns.filter((c) => c.actionType === "CLAIM_BENEFIT");
  const claimedBenefit = benefitCampaigns.filter((c) => c.claimStatus === "CLAIMED");
  const todayCheckedIn = refreshed && claimedBenefit.length > 0 && claimable.length === 0;
  let actionRequired = false;
  if (!todayCheckedIn && claimable.length === 0) {
    const usage = await fetchQoderUsageRaw(credential, product, fetcher);
    actionRequired = isQoderNotActivated(parsed, usage);
  }
  return {
    active: true,
    // 真有「领过」的领分类活动、且当前无可领项 ⇒ 今天已领。
    // 列表为空 / 仅 VIEW_DETAILS / 请求头不完整导致的空态，一律判**未领**。
    todayCheckedIn,
    streakDays: 0,
    dailyCredit: claimable[0]?.amount ?? benefitCampaigns[0]?.amount ?? 0,
    todayCredit: 0,
    isStreakDay: false,
    totalCredits: 0,
    checkinDates: [],
    activityName: benefitCampaigns[0]?.campaignKey ?? "",
    themeName: "",
    endTime: "",
    // 只在为 true 时才带上该字段，保持既有响应形状最小变化
    ...actionRequired ? { actionRequired: true } : {}
  };
}
function claimableCampaigns(parsed) {
  return parsed.campaigns.filter(
    (c) => c.actionType === "CLAIM_BENEFIT" && c.claimStatus === "CLAIMABLE"
  );
}
function parseClaimResult(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return {};
  const root = body;
  return {
    ...readString2(root, "status") !== void 0 ? { status: readString2(root, "status") } : {},
    ...typeof root.replayed === "boolean" ? { replayed: root.replayed } : {},
    ...benefitAmount(root) !== void 0 ? { amount: benefitAmount(root) } : {}
  };
}
async function claimQoderCampaign(credential, product, campaignId, fetcher = fetch) {
  const url = `${product.openApiBase}${QODER_CAMPAIGNS_PATH}/${encodeURIComponent(campaignId)}/claim`;
  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { ...await creditsHeaders(credential, product), "Content-Type": "application/json" },
      body: "",
      signal: AbortSignal.timeout(QODER_CREDITS_TIMEOUT_MS)
    });
  } catch (error) {
    return { kind: "failed", code: -1, message: error instanceof Error ? error.message : String(error) };
  }
  const text = await response.text().catch(() => "");
  let body;
  try {
    body = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return { kind: "failed", code: response.status, message: describeNonJson(response.status, text) };
  }
  if (!response.ok) {
    return { kind: "failed", code: response.status, message: describeNonJson(response.status, text) };
  }
  const result = parseClaimResult(body);
  if (result.replayed === true) {
    return { kind: "already-claimed", message: "\u4ECA\u5929\u5DF2\u9886\u53D6" };
  }
  if (result.status !== void 0 && result.status !== "CLAIMED") {
    return { kind: "failed", code: -1, message: `\u9886\u53D6\u672A\u6210\u529F\uFF08status=${result.status}\uFF09` };
  }
  return { kind: "claimed", credit: result.amount ?? 0, streakDays: 0, isStreakDay: false };
}
function describeNonJson(status, text) {
  if (status === 401 || status === 403) return `\u51ED\u636E\u5DF2\u5931\u6548\uFF08HTTP ${status}\uFF09\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u8BE5\u8D26\u53F7`;
  const snippet = text.trim().slice(0, 80).replace(/\s+/g, " ");
  return `\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u975E JSON \u54CD\u5E94\uFF08HTTP ${status}\uFF09\uFF1A${snippet}`;
}
async function claimQoderDailyCheckin(credential, product, fetcher = fetch, nowMs = Date.now()) {
  const parsed = await loadCampaigns(credential, product, fetcher);
  if (parsed === void 0) {
    return { kind: "failed", code: -1, message: "\u6D3B\u52A8\u5217\u8868\u67E5\u8BE2\u5931\u8D25", unsubmitted: true };
  }
  const refreshed = hasQoderCampaignRefreshedToday(nowMs);
  const stale = refreshed ? void 0 : { coversToday: false };
  const targets = claimableCampaigns(parsed);
  if (targets.length === 0) {
    const claimedBefore = parsed.campaigns.some(
      (c) => c.actionType === "CLAIM_BENEFIT" && c.claimStatus === "CLAIMED"
    );
    if (claimedBefore) {
      if (!refreshed) return { kind: "inactive", message: NOT_REFRESHED_YET_HINT, unsubmitted: true };
      return { kind: "already-claimed", message: "\u4ECA\u5929\u5DF2\u9886\u53D6" };
    }
    const usage = await fetchQoderUsageRaw(credential, product, fetcher);
    if (isQoderNotActivated(parsed, usage)) {
      return { kind: "inactive", message: NOT_ACTIVATED_HINT, actionRequired: true, unsubmitted: true };
    }
    return { kind: "inactive", message: "\u5F53\u524D\u6CA1\u6709\u53EF\u9886\u53D6\u7684\u6D3B\u52A8", unsubmitted: true };
  }
  let total = 0;
  let firstError;
  for (const target of targets) {
    const outcome = await claimQoderCampaign(credential, product, target.campaignId, fetcher);
    if (outcome.kind === "claimed") total += outcome.credit;
    else if (outcome.kind === "failed" && firstError === void 0) firstError = outcome.message;
  }
  if (total > 0) return { kind: "claimed", credit: total, streakDays: 0, isStreakDay: false, ...stale };
  if (firstError !== void 0) return { kind: "failed", code: -1, message: firstError };
  return { kind: "already-claimed", message: "\u4ECA\u5929\u5DF2\u9886\u53D6", ...stale };
}

// vendor/channel-pack/src/trae.ts
import { createHash as createHash2 } from "node:crypto";

// vendor/channel-pack/src/credential-expiry.ts
function credentialExpiresAtMs(credential) {
  const raw = credential.expires_at;
  if (typeof raw === "string" && raw.length > 0) {
    if (/^\d+$/.test(raw)) {
      const value = Number(raw);
      return value > 1e12 ? value : value * 1e3;
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return jwtExpiresAtMs(credential.access_token);
}
function jwtExpiresAtMs(token) {
  if (typeof token !== "string" || token.length === 0) return void 0;
  const parts = token.split(".");
  if (parts.length < 2) return void 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1e3 : void 0;
  } catch {
    return void 0;
  }
}

// vendor/channel-pack/src/trae.ts
var TRAE_BATCH_MODELS_PATH = "/api/ide/v1/batch_get_detail_param";
var TRAE_EXCHANGE_PATH = "/cloudide/api/v3/trae/oauth/ExchangeToken";
var TRAE_USER_INFO_PATH = "/cloudide/api/v3/trae/GetUserInfo";
var TRAE_CHECKIN_STATUS_PATH = "/trae/api/v2/ug/checkin_credits/status";
var TRAE_CHECKIN_CLAIM_PATH = "/trae/api/v2/ug/checkin_credits/claim";
var TRAE_ENT_USAGE_PATH = "/trae/api/v2/pay/ide_user_ent_usage";
var TRAE_PAY_STATUS_PATH = "/trae/api/v2/pay/ide_user_pay_status";
var TRAE_REQUEST_TIMEOUT_MS = 3e4;
var TRAE_LOGIN_TIMEOUT_MS = 10 * 60 * 1e3;
function traeCredentialExpiresAtMs(credential) {
  const raw = credential.expires_at;
  if (typeof raw === "string" && raw.length > 0) {
    if (/^\d+$/.test(raw)) {
      const value = Number(raw);
      return value > 1e12 ? value : value * 1e3;
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return jwtExpiresAtMs(credential.access_token);
}
function isTraeExpired(credential) {
  const expiresAt = traeCredentialExpiresAtMs(credential);
  return expiresAt === void 0 ? false : Date.now() >= expiresAt;
}
function isTraeRefreshable(credential) {
  return typeof credential.refresh_token === "string" && credential.refresh_token.length > 0;
}
function traeSOLOHeaders(credential, product, stream, machineIdGeneration = 0) {
  const headers = {
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream" : "application/json",
    "User-Agent": product.userAgent,
    Authorization: `Cloud-IDE-JWT ${credential.access_token}`,
    "X-Cloudide-Token": credential.access_token,
    "X-Ide-Token": credential.access_token,
    "X-Uid": credential.uid,
    "X-App-Id": product.appId,
    "X-App-Version": "default",
    "X-Ide-Version": product.ideVersion,
    "X-Ide-Version-Code": product.ideVersionCode,
    "X-App-Version-Code": product.ideVersionCode,
    "X-Ide-Version-Type": "stable",
    "X-Device-Type": "macos",
    "X-OS-Version": product.osVersion,
    "X-Device-Brand": product.deviceBrand,
    "Request-Traffic-Type": "prod"
  };
  if (credential.machine_id.length > 0) {
    headers["X-Machine-Id"] = deriveRotatingMachineId(credential.machine_id, machineIdGeneration);
  }
  if (credential.device_id.length > 0) {
    headers["X-Device-Id"] = credential.device_id;
  }
  return headers;
}
function traeCheckinHeaders(credential, product, userId) {
  const deviceId = deriveDeviceId15(userId);
  const marketUserId = deriveMarketUserId(userId);
  const sessionId = deriveSessionId(userId);
  const traceId = `00-${randomHex(16)}-01`;
  const requestId = uuidV4();
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "zh-CN",
    "User-Agent": "VSCode 1.107.1 (TRAE SOLO CN)",
    Authorization: `Cloud-IDE-JWT ${credential.access_token}`,
    "X-Market-Client-Id": "VSCode 1.107.1",
    "X-Market-User-Id": marketUserId,
    "X-User-Region": "CN",
    "X-Device-Id": deviceId,
    "X-Lgw-Req-Sdk-Type": "3",
    "Package-Type": "stable_cn",
    "X-Lscbd-Aid": "787976",
    "X-Lscbd-Platform": "windows",
    "App-Version": product.ideVersion,
    "X-Tt-Trace-Id": traceId,
    "Vscode-Sessionid": sessionId,
    "X-Request-Id": requestId,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "none"
  };
}
function deriveDeviceId15(userId) {
  return seededDigits(15, userId, "devid");
}
function traePayStatusDeviceId(userId) {
  return deriveDeviceId15(userId);
}
function deriveMarketUserId(userId) {
  const bs = seededStream(userId, "market", 16);
  bs[6] = bs[6] & 15 | 64;
  bs[8] = bs[8] & 63 | 128;
  const hex = bs.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function deriveSessionId(userId) {
  const bytes = seededStream(userId, "sess", 32);
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}
function seededStream(seed, salt, nbytes) {
  const prefix = `${salt}:${seed}`;
  const result = [];
  let counter = 0;
  while (result.length < nbytes) {
    const counterBuf = new Uint8Array(4);
    counterBuf[0] = counter >> 24 & 255;
    counterBuf[1] = counter >> 16 & 255;
    counterBuf[2] = counter >> 8 & 255;
    counterBuf[3] = counter & 255;
    const h = createHash2("sha256");
    h.update(prefix, "utf8");
    h.update(counterBuf);
    for (const b of h.digest()) {
      result.push(b);
      if (result.length >= nbytes) break;
    }
    counter++;
  }
  return result.slice(0, nbytes);
}
function seededDigits(n, seed, salt) {
  const bs = seededStream(seed, salt, n);
  return bs.map((b) => (b % 10).toString()).join("");
}
function uuidV4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
function randomHex(n) {
  const buf = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}
function traeOAuthHeaders(product) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": product.userAgent
  };
}
function parseTraeExchangeResponse(data) {
  const result = data.Result ?? data.result;
  if (typeof result !== "object" || result === null) return void 0;
  const r = result;
  const accessToken = readStringField(r, "Token") || readStringField(r, "token") || readStringField(r, "accessToken");
  const refreshToken = readStringField(r, "RefreshToken") || readStringField(r, "refreshToken");
  if (accessToken.length === 0) return void 0;
  return {
    accessToken,
    refreshToken,
    tokenExpireAt: readNumberField(r, "TokenExpireAt") ?? readNumberField(r, "tokenExpireAt") ?? 0,
    tokenExpireDuration: readNumberField(r, "TokenExpireDuration") ?? readNumberField(r, "tokenExpireDuration") ?? 0,
    refreshExpireAt: readNumberField(r, "RefreshExpireAt") ?? readNumberField(r, "refreshExpireAt") ?? 0
  };
}
function parseTraeUserInfoResponse(data) {
  const result = data.Result ?? data.result;
  if (typeof result !== "object" || result === null) return void 0;
  const r = result;
  const uid = readStringField(r, "UserID") || readStringField(r, "userId") || readStringField(r, "uid");
  if (uid.length === 0) return void 0;
  return {
    uid,
    screenName: readStringField(r, "ScreenName") || readStringField(r, "screenName") || uid,
    enterpriseId: readStringField(r, "EnterpriseID") || readStringField(r, "enterpriseId") || "",
    // ⚠️ 字段名是 **NonPlainTextMobile / NonPlainTextEmail**（不是 Mobile /
    // Phone / Email）—— 实测 `GetUserInfo` 只下发这两个脱敏形态。
    phone: readStringField(r, "NonPlainTextMobile") || readStringField(r, "nonPlainTextMobile"),
    email: readStringField(r, "NonPlainTextEmail") || readStringField(r, "nonPlainTextEmail")
  };
}
function buildTraeCredential(exchange, userInfo, session, nowMs = Date.now()) {
  let expiresAt;
  if (exchange.tokenExpireAt > 1e12) {
    expiresAt = String(exchange.tokenExpireAt);
  } else if (exchange.tokenExpireAt > 0) {
    expiresAt = String(exchange.tokenExpireAt * 1e3);
  } else if (exchange.tokenExpireDuration > 0) {
    expiresAt = String(nowMs + exchange.tokenExpireDuration * 1e3);
  } else {
    const exp = jwtExpiresAtMs(exchange.accessToken);
    expiresAt = exp === void 0 ? "" : String(exp);
  }
  return {
    access_token: exchange.accessToken,
    refresh_token: exchange.refreshToken,
    expires_at: expiresAt,
    uid: userInfo.uid,
    nickname: userInfo.screenName,
    ...userInfo.phone.length > 0 ? { phone: userInfo.phone } : {},
    ...userInfo.email.length > 0 ? { email: userInfo.email } : {},
    machine_id: session.machineId,
    device_id: session.deviceId,
    enterprise_id: userInfo.enterpriseId
  };
}
function traeDisplayNickname(credential, fallbackId) {
  const phone = typeof credential?.phone === "string" ? credential.phone.trim() : "";
  if (phone.length > 0) return phone;
  const email = typeof credential?.email === "string" ? credential.email.trim() : "";
  if (email.length > 0) return email;
  const nickname = typeof credential?.nickname === "string" ? credential.nickname.trim() : "";
  if (nickname.length > 0) return nickname;
  const uid = typeof credential?.uid === "string" ? credential.uid.trim() : "";
  return uid.length > 0 ? uid : fallbackId;
}
function withTraePhone(credential, phone, email) {
  const hasPhone = phone !== void 0 && phone.length > 0;
  const hasEmail = email !== void 0 && email.length > 0;
  if (!hasPhone && !hasEmail) return credential;
  return {
    ...credential,
    ...hasPhone ? { phone } : {},
    ...hasEmail ? { email } : {}
  };
}
function applyTraeRefresh(previous, exchange, nowMs = Date.now()) {
  let expiresAt;
  if (exchange.tokenExpireAt > 1e12) {
    expiresAt = String(exchange.tokenExpireAt);
  } else if (exchange.tokenExpireAt > 0) {
    expiresAt = String(exchange.tokenExpireAt * 1e3);
  } else if (exchange.tokenExpireDuration > 0) {
    expiresAt = String(nowMs + exchange.tokenExpireDuration * 1e3);
  } else {
    const exp = jwtExpiresAtMs(exchange.accessToken);
    expiresAt = exp === void 0 ? "" : String(exp);
  }
  return {
    ...previous,
    access_token: exchange.accessToken,
    // refresh_token 也会被轮换，新值不为空时才更新。
    refresh_token: exchange.refreshToken.length > 0 ? exchange.refreshToken : previous.refresh_token,
    expires_at: expiresAt
  };
}
function isTraeModelCallable(model) {
  return model.isCustomModel !== true && model.isEnabled !== false;
}
function readContextWindowField(entry) {
  const raw = entry.context_window_tokens ?? entry.ContextWindowTokens;
  if (typeof raw !== "object" || raw === null) return void 0;
  const record = raw;
  const value = readNumberField(record, "dev") ?? readNumberField(record, "Dev") ?? readNumberField(record, "max") ?? readNumberField(record, "Max");
  return value !== void 0 && value > 0 ? Math.trunc(value) : void 0;
}
function readMaxContextWindowField(entry) {
  const raw = entry.context_window_tokens ?? entry.ContextWindowTokens;
  if (typeof raw !== "object" || raw === null) return void 0;
  const record = raw;
  const value = readNumberField(record, "max") ?? readNumberField(record, "Max");
  return value !== void 0 && value > 0 ? Math.trunc(value) : void 0;
}
function readDetailMaxTokens(entry, preferredSuffix = "__dev") {
  const raw = entry.model_detail_list ?? entry.ModelDetailList;
  if (!Array.isArray(raw) || raw.length === 0) return void 0;
  const details = raw.filter(
    (item) => typeof item === "object" && item !== null
  );
  const preferred = details.find((item) => readStringField(item, "model_name").endsWith(preferredSuffix));
  const chosen = preferred ?? details[0];
  if (chosen === void 0) return void 0;
  const value = readNumberField(chosen, "max_tokens") ?? readNumberField(chosen, "MaxTokens");
  return value !== void 0 && value > 0 ? Math.trunc(value) : void 0;
}
function readReasoningEffortConfig(entry) {
  const raw = entry.reasoning_effort_config ?? entry.ReasoningEffortConfig;
  if (typeof raw !== "object" || raw === null) return void 0;
  const record = raw;
  const options = [];
  const rawOptions = record.options ?? record.Options;
  if (Array.isArray(rawOptions)) {
    for (const item of rawOptions) {
      if (typeof item === "string" && item.trim().length > 0) {
        options.push(item.trim());
      } else if (typeof item === "object" && item !== null) {
        const obj = item;
        const wire = readStringField(obj, "openclawLevel") || readStringField(obj, "level") || readStringField(obj, "Level");
        if (wire.trim().length > 0) options.push(wire.trim());
      }
    }
  }
  const defaultLevel = readStringField(record, "default_level") || readStringField(record, "DefaultLevel");
  const supportThinking = readBooleanField(record, "support_thinking") ?? readBooleanField(record, "SupportThinking");
  if (options.length === 0 && defaultLevel.length === 0 && supportThinking === void 0) {
    return void 0;
  }
  return {
    options,
    ...defaultLevel.length > 0 ? { defaultLevel } : {},
    ...supportThinking === void 0 ? {} : { supportThinking }
  };
}
function readConsumptionRate(entry) {
  const config = readTraeDisplayContact(entry);
  if (config === void 0) return void 0;
  const rate = config.consumption_rate ?? config.ConsumptionRate;
  if (typeof rate !== "object" || rate === null) return void 0;
  const rateRecord = rate;
  if (readBooleanField(rateRecord, "enable") === false) return void 0;
  const data = rateRecord.data ?? rateRecord.Data;
  if (typeof data !== "object" || data === null) return void 0;
  const value = readNumberField(data, "rate") ?? readNumberField(data, "Rate");
  return value !== void 0 && value >= 0 ? value : void 0;
}
function readActivityDiscount(entry, nowSec = Math.floor(Date.now() / 1e3)) {
  const config = readTraeDisplayContact(entry);
  if (config === void 0) return void 0;
  const discount = config.activity_discount ?? config.ActivityDiscount;
  if (typeof discount !== "object" || discount === null) return void 0;
  const discountRecord = discount;
  if (readBooleanField(discountRecord, "enable") === false) return void 0;
  const data = discountRecord.data ?? discountRecord.Data;
  if (typeof data !== "object" || data === null) return void 0;
  const dataRecord = data;
  const current = dataRecord.current ?? dataRecord.Current;
  if (typeof current !== "object" || current === null) return void 0;
  const currentRecord = current;
  const type = (readStringField(currentRecord, "discount_type") || readStringField(currentRecord, "discountType")).trim().toLowerCase();
  if (type.length === 0 || type === "none") return void 0;
  const before = readNumberField(currentRecord, "before_consumption_rate") ?? readNumberField(currentRecord, "beforeConsumptionRate");
  const after = readNumberField(currentRecord, "consumption_rate") ?? readNumberField(currentRecord, "consumptionRate");
  if (before === void 0 || before <= 0) return void 0;
  if (after !== void 0 && (after < 0 || before <= after)) return void 0;
  let endsAtSec;
  for (const value of Object.values(dataRecord)) {
    if (typeof value !== "object" || value === null) continue;
    const end = readNumberField(value, "end_at") ?? readNumberField(value, "endAt");
    if (end !== void 0 && end > 0) {
      endsAtSec = end;
      break;
    }
  }
  if (endsAtSec !== void 0 && endsAtSec <= nowSec) return void 0;
  return {
    originalRate: before,
    ...after === void 0 ? {} : { effectiveRate: after },
    ...endsAtSec === void 0 ? {} : { endsAtSec }
  };
}
function readTraeDisplayContact(entry) {
  const display = entry.display_config ?? entry.DisplayConfig;
  const nested = typeof display === "object" && display !== null ? display : {};
  let value = entry.display_contact_config ?? entry.DisplayContactConfig ?? nested.display_contact_config ?? nested.DisplayContactConfig;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return void 0;
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function parseTraeConfigEntry(entry, channel) {
  const id = readStringField(entry, "config_name") || readStringField(entry, "ConfigName");
  if (id.length === 0) return void 0;
  const display = entry.display_config ?? entry.DisplayConfig;
  const displayRecord = typeof display === "object" && display !== null ? display : void 0;
  const name = displayRecord !== void 0 ? readStringField(displayRecord, "display_name") || id : id;
  const isCustomModel = displayRecord === void 0 ? void 0 : readBooleanField(displayRecord, "is_custom_model") ?? readBooleanField(displayRecord, "IsCustomModel");
  const isHidden = readBooleanField(entry, "is_invisible_to_user") ?? readBooleanField(entry, "IsInvisibleToUser");
  const isEnabled = readBooleanField(entry, "config_switch") ?? readBooleanField(entry, "ConfigSwitch");
  const usage = readStringField(entry, "usage") || readStringField(entry, "Usage");
  const contextWindow = readContextWindowField(entry);
  const maxOutputTokens = readDetailMaxTokens(entry);
  const maxMode = displayRecord === void 0 ? void 0 : readBooleanField(displayRecord, "max_mode") ?? readBooleanField(displayRecord, "MaxMode");
  const maxContextWindow = readMaxContextWindowField(entry);
  const maxModeOutputTokens = readDetailMaxTokens(entry, "__max");
  const multimodal = displayRecord === void 0 ? void 0 : readBooleanField(displayRecord, "multimodal") ?? readBooleanField(displayRecord, "Multimodal");
  const toolResponseMultimodal = displayRecord === void 0 ? void 0 : readBooleanField(displayRecord, "tool_response_multimodal") ?? readBooleanField(displayRecord, "ToolResponseMultimodal");
  const reasoningConfig = readReasoningEffortConfig(entry);
  const discount = readActivityDiscount(entry);
  const creditsRate = discount?.effectiveRate ?? readConsumptionRate(entry);
  return {
    id,
    name,
    ...channel === void 0 ? {} : { function: channel },
    ...isCustomModel === void 0 ? {} : { isCustomModel },
    ...isHidden === void 0 ? {} : { isHidden },
    ...isEnabled === void 0 ? {} : { isEnabled },
    ...usage.length > 0 ? { usage } : {},
    ...reasoningConfig === void 0 ? {} : { reasoningConfig },
    ...maxMode === void 0 ? {} : { maxMode },
    ...multimodal === void 0 ? {} : { multimodal },
    ...toolResponseMultimodal === void 0 ? {} : { toolResponseMultimodal },
    ...maxContextWindow === void 0 ? {} : { maxContextWindow },
    ...maxModeOutputTokens === void 0 ? {} : { maxModeOutputTokens },
    ...contextWindow === void 0 ? {} : { contextWindow },
    ...maxOutputTokens === void 0 ? {} : { maxOutputTokens },
    ...creditsRate === void 0 ? {} : { creditsRate },
    ...discount === void 0 ? {} : { originalCreditsRate: discount.originalRate },
    ...discount?.endsAtSec === void 0 ? {} : { discountEndsAtSec: discount.endsAtSec }
  };
}
var TRAE_INTERNAL_MODEL_IDS = /* @__PURE__ */ new Set([
  "code-review-judge",
  "multimodal_image_kimi-k2.5"
]);
function parseTraeBatchModelList(body, channelPriority = TRAE_CHANNELS) {
  if (typeof body !== "object" || body === null) return [];
  const record = body;
  const groups = record.function_configs ?? record.FunctionConfigs;
  if (!Array.isArray(groups)) return [];
  const rankOf = (channel) => channelPriority.indexOf(channel);
  const byId = /* @__PURE__ */ new Map();
  const chosenRank = /* @__PURE__ */ new Map();
  for (const group of groups) {
    if (typeof group !== "object" || group === null) continue;
    const g = group;
    const channel = readStringField(g, "function") || readStringField(g, "Function");
    if (channel.length === 0 || rankOf(channel) < 0) continue;
    const list = g.config_info_list ?? g.ConfigInfoList;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const model = parseTraeConfigEntry(item, channel);
      if (model === void 0) continue;
      if (model.usage !== void 0 && model.usage !== "chat_completion") continue;
      if (model.isEnabled === false) continue;
      if (model.isHidden === true) continue;
      if (TRAE_INTERNAL_MODEL_IDS.has(model.id)) continue;
      const incumbent = byId.get(model.id);
      if (incumbent === void 0) {
        byId.set(model.id, model);
        chosenRank.set(model.id, rankOf(channel));
        continue;
      }
      const incumbentHasEffort = declaresReasoningOptions(incumbent);
      const candidateHasEffort = declaresReasoningOptions(model);
      if (incumbentHasEffort && !candidateHasEffort) continue;
      if (incumbentHasEffort && candidateHasEffort) {
        if (rankOf(channel) >= (chosenRank.get(model.id) ?? 0)) continue;
      }
      byId.set(model.id, model);
      chosenRank.set(model.id, rankOf(channel));
    }
  }
  return [...byId.values()];
}
function declaresReasoningOptions(model) {
  const config = model.reasoningConfig;
  if (config === void 0) return false;
  if (config.supportThinking === false) return false;
  return config.options.length > 0;
}
function generateMachineId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
function generateDeviceId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
function deriveRotatingMachineId(baseMachineId, generation) {
  if (!Number.isFinite(generation) || generation <= 0) return baseMachineId;
  return createHash2("sha256").update(`${baseMachineId}#machine${Math.floor(generation)}`, "utf8").digest("hex").slice(0, 32);
}
var TRAE_DEFAULT_MAX_COMPLETION_TOKENS = 64e3;
function resolveTraeMaxCompletionTokens() {
  const raw = Number.parseInt(process.env.DSH_TRAE_MAX_COMPLETION_TOKENS ?? "", 10);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return TRAE_DEFAULT_MAX_COMPLETION_TOKENS;
}
function clampTraeMaxTokens(value, limit = resolveTraeMaxCompletionTokens()) {
  if (value === void 0 || !Number.isFinite(value) || value <= 0) return value;
  if (limit <= 0) return value;
  return Math.min(value, limit);
}
function readStringField(source, key) {
  const value = source[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
function readNumberField(source, key) {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return void 0;
}
function readBooleanField(source, key) {
  const value = source[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "true") return true;
  if (value === 0 || value === "false") return false;
  return void 0;
}
var TRAE_DEFAULT_MODEL = "glm-5.2";
var TRAE_FUNCTION = "solo_work_lite";
var TRAE_MAX_CONTEXT_TOKENS = 1e6;
var TRAE_MAX_PROMPT_TOKENS = 936e3;
var TRAE_MAX_OUTPUT_TOKENS = 64e3;
var TRAE_MAX_MODE_TYPE = 1;
function traeMaxModeFields(maxContext, outputMax) {
  const context = maxContext > 0 ? maxContext : TRAE_MAX_CONTEXT_TOKENS;
  return {
    model_auto_selection: {
      strategy: "max",
      fallback_to_advance_model: null,
      entitlement_id: null
    },
    model_selection_strategy: "max",
    mode_type: TRAE_MAX_MODE_TYPE,
    context_window_size: context,
    prompt_max_tokens: TRAE_MAX_PROMPT_TOKENS,
    max_tokens: outputMax !== void 0 && outputMax > 0 ? outputMax : TRAE_MAX_OUTPUT_TOKENS
  };
}
function transformToSOLOBody(openaiBody, modelMapping, channel) {
  const body = {
    ...openaiBody,
    stream: true,
    function: channel !== void 0 && channel.length > 0 ? channel : TRAE_FUNCTION
  };
  const msgs = body.messages;
  if (Array.isArray(msgs)) {
    body.messages = msgs.map((msg) => transformSOLOMessage(msg));
  }
  const model = typeof body.model === "string" ? body.model : "";
  const baseModel = model.includes("__") ? model.split("__")[0] : model;
  const configName = modelMapping && modelMapping.length > 0 ? modelMapping : baseModel || TRAE_DEFAULT_MODEL;
  body.config_name = configName;
  body.model = configName;
  normalizeToolChoice(body);
  normalizeTools(body);
  return body;
}
function transformSOLOMessage(msg) {
  const result = { ...msg };
  if (result.role === "assistant") {
    const tcs = result.tool_calls;
    if (Array.isArray(tcs)) {
      const kept = [];
      for (const tc of tcs) {
        if (typeof tc !== "object" || tc === null) continue;
        const t = tc;
        if (typeof t.function === "object" && t.function !== null) {
          t.function_call = t.function;
          delete t.function;
        }
        const fc = t.function_call;
        if (fc === void 0 || typeof fc.name !== "string" || fc.name.trim().length === 0) continue;
        kept.push(t);
      }
      if (kept.length > 0) {
        result.tool_calls = kept;
      } else {
        delete result.tool_calls;
      }
    }
  }
  const content = result.content;
  if (content === null || content === void 0) {
  } else if (typeof content === "string") {
    result.content = [{ type: "text", text: content }];
  }
  return result;
}
function normalizeToolChoice(body) {
  const tc = body.tool_choice;
  if (tc === void 0) return;
  const suppress = () => {
    delete body.tools;
    delete body.functions;
  };
  if (typeof tc === "string") {
    if (tc.toLowerCase().trim() === "none") {
      delete body.tool_choice;
      suppress();
    }
    return;
  }
  if (typeof tc === "object" && tc !== null) {
    const v = tc;
    const typ = typeof v.type === "string" ? v.type.toLowerCase().trim() : "";
    switch (typ) {
      case "none":
        delete body.tool_choice;
        suppress();
        break;
      case "auto":
      case "required":
        body.tool_choice = typ;
        break;
      case "function": {
        const fn = v.function;
        let name = typeof fn?.name === "string" ? fn.name : "";
        if (name.length === 0) name = typeof v.name === "string" ? v.name : "";
        if (name.trim().length > 0) {
          body.tool_choice = name.trim();
        } else {
          body.tool_choice = "auto";
        }
        break;
      }
      default:
        delete body.tool_choice;
    }
    return;
  }
  delete body.tool_choice;
}
function normalizeTools(body) {
  const raw = body.tools;
  if (!Array.isArray(raw) || raw.length === 0) return;
  const out = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const t = item;
    const fn = t.function;
    if (fn === void 0) continue;
    const params = fn.parameters;
    if (typeof params === "object" && params !== null) {
      fn.parameters = JSON.stringify(params);
    }
    out.push(t);
  }
  if (out.length > 0) {
    body.tools = out;
  } else {
    delete body.tools;
  }
}
function parseTraeSSELine(eventName, dataLine) {
  const event = eventName.trim();
  if (dataLine.length === 0) return { event };
  let raw;
  try {
    raw = JSON.parse(dataLine);
  } catch {
    return { event };
  }
  throwIfModelQueued(raw);
  const ev = { event };
  switch (event) {
    case "output":
      if (typeof raw.response === "string") ev.response = raw.response;
      if (typeof raw.reasoning_content === "string") ev.reasoningContent = raw.reasoning_content;
      if (raw.tool_calls !== null && raw.tool_calls !== void 0) {
        if (Array.isArray(raw.tool_calls)) {
          ev.toolCalls = normalizeTraeToolCalls(raw.tool_calls);
        }
      }
      break;
    case "token_usage":
      ev.usage = raw;
      break;
    case "metadata":
      ev.metadata = raw;
      break;
    case "done":
      if (typeof raw.finish_reason === "string") ev.finishReason = raw.finish_reason;
      break;
    case "error":
      if (typeof raw.code === "number") ev.errorCode = raw.code;
      if (typeof raw.message === "string") ev.errorMessage = raw.message;
      break;
  }
  return ev;
}
function normalizeTraeToolCalls(calls) {
  return calls.map((call) => {
    if (typeof call !== "object" || call === null) return call;
    const c = { ...call };
    if (typeof c.function_call === "object" && c.function_call !== null) {
      c.function = { ...c.function_call };
      delete c.function_call;
    }
    if (typeof c.function === "object" && c.function !== null) {
      const fn = c.function;
      delete fn.namespace;
      delete fn.partial_arguments;
    }
    return c;
  });
}

// vendor/channel-pack/src/trae-credits.ts
function classifyTraeCheckinError(httpStatus, code) {
  if (httpStatus === 200 && code === 1005) {
    return { type: "PlanLimit", cooldownSecs: 43200 };
  }
  if (httpStatus === 429) {
    return { type: "SoftRate", cooldownSecs: 60 };
  }
  if (httpStatus === 401) {
    return { type: "SessionDead", cooldownSecs: -1 };
  }
  if (httpStatus === 404) {
    return { type: "NotFound", cooldownSecs: 60 };
  }
  if (httpStatus >= 500 && httpStatus < 600) {
    return { type: "Server", cooldownSecs: 600 };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { type: "Client", cooldownSecs: 600 };
  }
  if (code !== void 0 && code !== 0) {
    return { type: "BusinessError", cooldownSecs: 300 };
  }
  return { type: "Unknown", cooldownSecs: 0 };
}
function readNumber2(source, key) {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function readString3(source, key) {
  const value = source[key];
  return typeof value === "string" ? value : "";
}
function readClaimCode(body) {
  const raw = body.code;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) return Number(raw.trim());
  return raw === void 0 ? 0 : -1;
}
async function postJson(path, credential, body, fetcher, userId) {
  const uid = userId ?? credential.uid;
  if (uid.length === 0) {
    return { ok: false, message: "\u7F3A\u5C11 user_id\uFF0C\u65E0\u6CD5\u6784\u9020\u8BBE\u5907\u8EAB\u4EFD", httpStatus: 0 };
  }
  try {
    const response = await fetcher(`https://api.trae.cn${path}`, {
      method: "POST",
      headers: traeCheckinHeaders(credential, {}, uid),
      body,
      signal: AbortSignal.timeout(TRAE_REQUEST_TIMEOUT_MS)
    });
    const httpStatus = response.status;
    const text = await response.text();
    if (!response.ok) {
      const snippet = text.trim().slice(0, 80).replace(/\s+/g, " ");
      return { ok: false, message: `HTTP ${response.status}: ${snippet}`, httpStatus };
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: `\u975E JSON \u54CD\u5E94: ${text.trim().slice(0, 80)}`, httpStatus };
    }
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, message: "\u54CD\u5E94\u4E0D\u662F\u5BF9\u8C61", httpStatus };
    }
    return { ok: true, body: parsed, httpStatus };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), httpStatus: 0 };
  }
}
async function fetchTraeCheckinStatus(credential, _product, fetcher = fetch) {
  const result = await postJson(TRAE_CHECKIN_STATUS_PATH, credential, "{}", fetcher, credential.uid);
  if (!result.ok) return null;
  const body = result.body;
  const code = readClaimCode(body);
  if (code !== 0) return null;
  return {
    active: body.enable === true,
    todayCheckedIn: body.checked_in === true,
    streakDays: readNumber2(body, "streak_days") || 0,
    dailyCredit: readNumber2(body, "credits") || 0,
    todayCredit: 0,
    isStreakDay: false,
    totalCredits: readNumber2(body, "total_credits") || 0,
    checkinDates: [],
    activityName: "",
    themeName: "",
    endTime: ""
  };
}
async function claimTraeDailyCheckin(credential, product, fetcher = fetch, generation = 0, onRotate, userId, retryCount = 3) {
  const uid = userId ?? credential.uid;
  const doClaim = async () => {
    let lastError = { ok: false, httpStatus: 0, message: "", code: 0 };
    for (let attempt = 0; attempt <= Math.max(0, retryCount); attempt++) {
      const result = await postJson(TRAE_CHECKIN_CLAIM_PATH, credential, "{}", fetcher, uid);
      if (result.ok) {
        const c = readClaimCode(result.body);
        return { ok: true, body: result.body, httpStatus: result.httpStatus, message: "", code: c };
      }
      lastError = { ok: false, httpStatus: result.httpStatus, message: result.message, code: 0 };
      if (result.httpStatus > 0) {
        return lastError;
      }
      if (attempt < retryCount) {
        await new Promise((r) => setTimeout(r, 1e3));
      }
    }
    return lastError;
  };
  const response = await doClaim();
  if (!response.ok) {
    return { kind: "failed", code: -1, message: response.message, errorType: "Unknown", cooldownSecs: 0 };
  }
  const body = response.body;
  const code = readClaimCode(body);
  if (code === 9074) {
    return {
      kind: "failed",
      code: 9074,
      message: readString3(body, "message") || readString3(body, "msg") || "\u7B7E\u5230\u4EBA\u6570\u8FC7\u591A\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5",
      errorType: "BusinessError",
      cooldownSecs: 300
    };
  }
  const msg = readString3(body, "message") || readString3(body, "msg") || "";
  if (code === 0) {
    const status = await fetchTraeCheckinStatus(credential, product, fetcher);
    return {
      kind: "claimed",
      credit: status?.dailyCredit ?? 0,
      streakDays: status?.streakDays ?? 0,
      isStreakDay: false
    };
  }
  const { type, cooldownSecs } = classifyTraeCheckinError(response.httpStatus, code);
  return {
    kind: "failed",
    code,
    message: msg.length > 0 ? msg : `\u7B7E\u5230\u5931\u8D25\uFF08code=${code}\uFF09`,
    errorType: type,
    cooldownSecs
  };
}
async function fetchTraeCreditBalance(credential, _product, fetcher = fetch) {
  const result = await postJson(
    TRAE_ENT_USAGE_PATH,
    credential,
    JSON.stringify({ require_usage: true, req_source: 2 }),
    fetcher,
    credential.uid
  );
  if (!result.ok) return null;
  const body = result.body;
  const packList = body.user_entitlement_pack_list;
  if (!Array.isArray(packList) || packList.length === 0) return null;
  const packages = [];
  let total = 0;
  let expiredTotal = 0;
  for (const item of packList) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item;
    const base = entry.entitlement_base_info;
    if (typeof base !== "object" || base === null) continue;
    const quota = base.quota;
    if (typeof quota !== "object" || quota === null) continue;
    const creditsLimit = readNumber2(quota, "credits_limit");
    if (creditsLimit <= 0) continue;
    const usage = entry.usage;
    const used = typeof usage === "object" && usage !== null ? readNumber2(usage, "credits_amount") : 0;
    const expireSec = readNumber2(entry, "expire_time");
    const deductionEndMs = expireSec > 0 ? expireSec * 1e3 : void 0;
    const pkg = {
      // ⚠️ 包名用 `display_desc`（实测"每月登录赠送"/"签到奖励"/"免费"），
      // 不是 `base.name` —— 后者实测为 undefined，旧代码全部回退成了"资源包"。
      name: readString3(base, "display_desc") || readString3(entry, "display_desc") || "\u8D44\u6E90\u5305",
      unit: "credits",
      remaining: creditsLimit - used,
      total: creditsLimit,
      used,
      active: true,
      cycleStartTime: "",
      cycleEndTime: "",
      expiredTime: "",
      ...deductionEndMs !== void 0 ? { deductionEndTime: deductionEndMs } : {}
    };
    packages.push(pkg);
    total += pkg.remaining;
  }
  return { total, packages, expiredTotal };
}
var PAY_STATUS_CACHE_TTL_MS = 6e4;
var payStatusCache = /* @__PURE__ */ new Map();
var payStatusInFlight = /* @__PURE__ */ new Map();
async function fetchTraePayStatus(credential, _product, fetcher = fetch) {
  const cached2 = payStatusCache.get(credential.uid);
  if (cached2 !== void 0 && Date.now() - cached2.at < PAY_STATUS_CACHE_TTL_MS) {
    return cached2.value;
  }
  const inFlight = payStatusInFlight.get(credential.uid);
  if (inFlight !== void 0) return inFlight;
  const request = (async () => {
    try {
      const result = await postJson(
        TRAE_PAY_STATUS_PATH,
        credential,
        JSON.stringify({ trae_client: "IDE", device_id: traePayStatusDeviceId(credential.uid) }),
        fetcher,
        credential.uid
      );
      if (!result.ok) return null;
      const identity = readString3(result.body, "user_pay_identity_str");
      if (identity.length === 0) return null;
      const expiresAt = readNumber2(result.body, "last_pro_entitlement_expire_time");
      const value2 = {
        identity,
        ...expiresAt !== void 0 && expiresAt > 0 ? { proEntitlementExpiresAt: expiresAt } : {}
      };
      return value2;
    } catch {
      return null;
    } finally {
      payStatusInFlight.delete(credential.uid);
    }
  })();
  payStatusInFlight.set(credential.uid, request);
  const value = await request;
  payStatusCache.set(credential.uid, { at: Date.now(), value });
  return value;
}

// vendor/channel-pack/src/account-probe.ts
import { credentialRef as credentialRef2 } from "@deepseek-ai/dsh-credentials";
import { createUserMessage, LlmError as LlmError8 } from "@deepseek-ai/dsh-llm";

// vendor/channel-pack/src/qoder-adapter.ts
import { LlmAdapter, LlmError as LlmError5, ReasoningEffortId } from "@deepseek-ai/dsh-llm";

// vendor/channel-pack/src/qoder-wasm.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
var WASM_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "qoder-auth-wasm.wasm");
var COSY_VERSION = "1.1.49";
var IMPORT_MODULE = "./qoder_auth_wasm_bg.js";
function reasoningBudgetFor(effort) {
  switch (effort) {
    case "minimal":
    case "low":
      return 1024;
    case "medium":
      return 8192;
    case "high":
      return 24576;
    case "xhigh":
      return 49152;
    case "max":
      return 65536;
    default:
      return void 0;
  }
}
function buildQoderInferPayload(ask, requestId = crypto.randomUUID()) {
  const isReasoning = ask.isReasoning ?? false;
  const text = ask.userText;
  const parameters = {};
  if (ask.maxTokens !== void 0) parameters.max_tokens = ask.maxTokens;
  if (ask.reasoningEffort !== void 0) {
    const effort = ask.reasoningEffort === "off" ? "none" : ask.reasoningEffort;
    parameters.reasoning_effort = effort;
    if (effort !== "none") parameters.reasoning_budget_tokens = reasoningBudgetFor(effort);
    parameters.enable_thinking = effort !== "none";
  }
  if (ask.contextWindow !== void 0) parameters.context_length = ask.contextWindow;
  const messages = [];
  for (const m of ask.history ?? []) {
    messages.push({
      role: m.role,
      content: m.content,
      ...m.tool_calls === void 0 ? {} : { tool_calls: m.tool_calls },
      ...m.tool_call_id === void 0 ? {} : { tool_call_id: m.tool_call_id }
    });
  }
  if (messages.length === 0) messages.push({ role: "user", content: text });
  return {
    request_id: requestId,
    request_set_id: requestId,
    chat_record_id: requestId,
    session_id: crypto.randomUUID(),
    stream: true,
    chat_task: "FREE_INPUT",
    chat_context: {
      text,
      features: [],
      extra: {
        context: [],
        modelConfig: { key: ask.modelKey, is_reasoning: isReasoning },
        originalContent: text
      },
      chatPrompt: "",
      imageUrls: null
    },
    is_reply: true,
    is_retry: false,
    source: 1,
    version: "3",
    agent_id: "agent_common",
    task_id: "common",
    session_type: ask.sessionType ?? "qodercli",
    aliyun_user_type: "",
    model_config: {
      key: ask.modelKey,
      // 官方 `Uyc()` 的 model_config 有 **10 个字段**，此处逐项对齐
      // （早期只传 6 个）。
      display_name: ask.displayName ?? "",
      model: "",
      format: ask.format ?? "openai",
      is_vl: ask.isVl ?? true,
      is_reasoning: isReasoning,
      api_key: "",
      url: "",
      source: ask.source ?? "system",
      max_input_tokens: ask.maxInputTokens ?? ask.contextWindow ?? 2e5
    },
    custom_model: null,
    system: ask.systemText ? [{ type: "text", text: ask.systemText }] : [],
    messages,
    // ⚠️ **必须把调用方的工具定义真的发出去**：它是**顶层** `tools`
    // （客户端源码 `tools: o?.tools ?? []`）。早期硬编码 `[]` 让模型拿不到
    // 任何函数 schema，只能用正文里的 XML 文本臆造工具调用 ——
    // 用户报障「qwen3.8-flash 执行任务出现任务调用 xml 泄露任务终止」。
    // 无工具时是**空数组**而非缺字段（与客户端一致）。
    tools: ask.tools ?? [],
    // ⚠️ **顶层 `reasoningEffort` 是官方客户端的第二个写入点**（用户报障
    // 「Qoder 思考设置无效」的真实原因）：反编译 Qoder 桌面端 agent SDK 可见
    // 请求体为
    // ```
    // {..., reasoningEffort:"none", parameters:{...A.parameters, reasoning_effort:"none"}}
    // ```
    // 即**顶层 `reasoningEffort` 与 `parameters.reasoning_effort` 双写**。
    // 只写 `parameters` 时上游照常回正文，但从不产出 `reasoning_content`
    // —— 实测：日志显示 parameters 正确（`reasoning_effort:"xhigh"` +
    // `enable_thinking:true` + 预算），而响应帧只有 `content`/`tool_calls`。
    // 证据：`@dmh2002/dsh-connect-qoder` CHANGELOG 的同一条反编译结论。
    ...ask.reasoningEffort === void 0 ? {} : {
      reasoningEffort: ask.reasoningEffort === "off" ? "none" : ask.reasoningEffort
    },
    parameters,
    // `business` 决定服务端路由（`sec_scan` → 安全池，其余 → 默认池）。
    ...ask.business === void 0 ? {} : { business: ask.business }
  };
}
var gluePromise = null;
async function getGlue() {
  gluePromise ??= createGlue();
  return gluePromise;
}
async function createGlue() {
  const bytes = readFileSync5(WASM_PATH);
  const module = await WebAssembly.compile(bytes);
  let exports = {};
  let cachedHeap = null;
  let cachedView = null;
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
  const encoder = new TextEncoder();
  const heap = () => {
    if (cachedHeap === null || cachedHeap.byteLength === 0) {
      cachedHeap = new Uint8Array(exports.memory.buffer);
    }
    return cachedHeap;
  };
  const view = () => {
    if (cachedView === null || cachedView.buffer !== exports.memory.buffer) {
      cachedView = new DataView(exports.memory.buffer);
    }
    return cachedView;
  };
  const readString4 = (ptr, len) => decoder.decode(heap().subarray(ptr >>> 0, (ptr >>> 0) + len));
  const objects = new Array(1024).fill(void 0);
  objects.push(void 0, null, true, false);
  let firstFree = objects.length;
  const heapObject = (index) => objects[index];
  const pushObject = (value) => {
    if (firstFree === objects.length) objects.push(objects.length + 1);
    const index = firstFree;
    firstFree = objects[index];
    objects[index] = value;
    return index;
  };
  const takeObject = (index) => {
    const value = heapObject(index);
    if (index >= 1028) {
      objects[index] = firstFree;
      firstFree = index;
    }
    return value;
  };
  let lastLength = 0;
  const writeString = (text) => {
    const encoded = encoder.encode(text);
    const ptr = exports.__wbindgen_export2(encoded.length, 1) >>> 0;
    heap().subarray(ptr, ptr + encoded.length).set(encoded);
    lastLength = encoded.length;
    return ptr;
  };
  const callString = (invoke) => {
    let ptr = 0;
    let len = 0;
    const stack = exports.__wbindgen_add_to_stack_pointer(-16);
    try {
      invoke(stack);
      const v = view();
      ptr = v.getInt32(stack + 0, true);
      len = v.getInt32(stack + 4, true);
      const isError = v.getInt32(stack + 12, true);
      if (isError) throw takeObject(v.getInt32(stack + 8, true));
      return readString4(ptr, len);
    } finally {
      exports.__wbindgen_add_to_stack_pointer(16);
      if (ptr) exports.__wbindgen_export4(ptr, len, 1);
    }
  };
  const callPointer = (invoke) => {
    const stack = exports.__wbindgen_add_to_stack_pointer(-16);
    try {
      invoke(stack);
      const v = view();
      const ptr = v.getInt32(stack + 0, true);
      const isError = v.getInt32(stack + 8, true);
      if (isError) throw takeObject(v.getInt32(stack + 4, true));
      return ptr;
    } finally {
      exports.__wbindgen_add_to_stack_pointer(16);
    }
  };
  const guard = (fn, args) => {
    try {
      fn(...args);
    } catch (error) {
      exports.__wbindgen_export(pushObject(error));
    }
  };
  const imports = {
    __wbindgen_object_drop_ref: (a) => takeObject(a),
    __wbindgen_object_clone_ref: (a) => pushObject(heapObject(a)),
    __wbindgen_cast_0000000000000001: (a, e) => pushObject(heap().subarray(a >>> 0, (a >>> 0) + e)),
    __wbindgen_cast_0000000000000002: (a, e) => pushObject(readString4(a, e)),
    __wbg_set_08463b1df38a7e29: (a, e, t) => pushObject(heapObject(a).set(heapObject(e), heapObject(t))),
    // ⚠️ 这两个签名**方向相反**：一个写 wasm 内存，一个调 JS 对象。
    // 写反会得到 Rust panic `unreachable`。
    __wbg_getRandomValues_d49329ff89a07af1: (...a) => guard((x, y) => {
      globalThis.crypto.getRandomValues(heap().subarray(x >>> 0, (x >>> 0) + y));
    }, a),
    __wbg_getRandomValues_c44a50d8cfdaebeb: (...a) => guard((x, y) => {
      ;
      heapObject(x).getRandomValues(heapObject(y));
    }, a),
    __wbg_crypto_38df2bab126b63dc: (a) => pushObject(heapObject(a).crypto),
    __wbg_process_44c7a14e11e9f69e: (a) => pushObject(heapObject(a).process),
    __wbg_versions_276b2795b1c6a219: (a) => pushObject(heapObject(a).versions),
    __wbg_node_84ea875411254db1: (a) => pushObject(heapObject(a).node),
    __wbg_require_b4edbdcf3e2a1ef0: (...a) => guard(() => pushObject(module), a),
    __wbg_msCrypto_bd5a034af96bcba6: (a) => pushObject(heapObject(a).msCrypto),
    __wbg_randomFillSync_6c25eac9869eb53c: (...a) => guard((x, y) => {
      ;
      heapObject(x).randomFillSync(takeObject(y));
    }, a),
    __wbg_call_d578befcc3145dee: (...a) => guard((fn, self, arg) => {
      const target = heapObject(fn);
      pushObject(target.call(heapObject(self), heapObject(arg)));
    }, a),
    __wbg_new_with_length_9cedd08484b73942: (a) => pushObject(new Uint8Array(a >>> 0)),
    __wbg_length_0c32cb8543c8e4c8: (a) => heapObject(a).length,
    __wbg_prototypesetcall_3e05eb9545565046: (a, e, t) => {
      Uint8Array.prototype.set.call(heap().subarray(a >>> 0, (a >>> 0) + e), heapObject(t));
    },
    __wbg_subarray_0f98d3fb634508ad: (a, e, t) => pushObject(heapObject(a).subarray(e >>> 0, t >>> 0)),
    __wbg_new_99cabae501c0a8a0: () => pushObject(/* @__PURE__ */ new Map()),
    __wbg_now_88621c9c9a4f3ffc: () => Date.now(),
    __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: () => pushObject(globalThis),
    __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: () => pushObject(globalThis),
    __wbg_static_accessor_SELF_24f78b6d23f286ea: () => globalThis.self === void 0 ? 0 : pushObject(globalThis.self),
    __wbg_static_accessor_WINDOW_59fd959c540fe405: () => globalThis.window === void 0 ? 0 : pushObject(globalThis.window),
    __wbg___wbindgen_throw_81fc77679af83bc6: (p, l) => {
      throw new Error(readString4(p, l));
    },
    __wbg_Error_2e59b1b37a9a34c3: (p, l) => pushObject(new Error(readString4(p, l))),
    __wbg___wbindgen_is_object_40c5a80572e8f9d3: (id) => {
      const v = heapObject(id);
      return typeof v === "object" && v !== null;
    },
    __wbg___wbindgen_is_string_b29b5c5a8065ba1a: (id) => typeof heapObject(id) === "string",
    __wbg___wbindgen_is_function_49868bde5eb1e745: (id) => typeof heapObject(id) === "function",
    __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: (id) => heapObject(id) === void 0
  };
  const instance = await WebAssembly.instantiate(module, { [IMPORT_MODULE]: imports });
  exports = instance.exports;
  return {
    exports,
    heap,
    view,
    readString: readString4,
    writeString,
    lastLength: () => lastLength,
    heapObject,
    pushObject,
    takeObject,
    callString,
    callPointer
  };
}
async function generateRuntimeAuthFields(user) {
  const g = await getGlue();
  const payload = JSON.stringify({
    uid: user.uid,
    security_oauth_token: user.securityOauthToken,
    organization_id: user.organizationId ?? "",
    organization_tags: user.organizationTags ?? [],
    data_policy_agreed: user.dataPolicyAgreed ?? false
  });
  const raw = g.callString((stack) => {
    const a = g.writeString(payload);
    g.exports.generate_runtime_auth_fields(stack, a, g.lastLength());
  });
  return JSON.parse(raw);
}
var QoderEncryptedInfer = class _QoderEncryptedInfer {
  // ⚠️ 用显式字段赋值而不是构造函数参数属性（`constructor(private g: Glue)`）：
  // 参数属性是 TypeScript 独有语法，Node 的 strip-only 类型剥离**不支持**
  // （`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），会让 `buildQoderInferPayload`
  // 这类纯函数无法被测试直接 import。行为等价。
  g;
  context;
  metadata;
  /** 加密端点所在 host（`agent_chat_generation`）。 */
  host;
  constructor(g, context, metadata, host) {
    this.g = g;
    this.context = context;
    this.metadata = metadata;
    this.host = host;
  }
  /** 创建客户端（会调 WASM 构造 `QoderContext`）。 */
  static async create(options) {
    const g = await getGlue();
    const fields = await generateRuntimeAuthFields(options.user);
    const version = options.clientVersion ?? COSY_VERSION;
    const userInfoJson = JSON.stringify({
      uid: options.user.uid,
      encrypt_user_info: fields.encrypt_user_info,
      key: fields.key,
      organization_id: options.user.organizationId ?? "",
      organization_tags: options.user.organizationTags ?? [],
      data_policy_agreed: options.user.dataPolicyAgreed ?? false
    });
    const context = g.callPointer((stack) => {
      const machine = g.writeString(options.machineId);
      const machineLen = g.lastLength();
      const ver = g.writeString(version);
      const verLen = g.lastLength();
      const info = g.writeString(userInfoJson);
      const infoLen = g.lastLength();
      const meta = g.writeString(JSON.stringify(options.metadata));
      const metaLen = g.lastLength();
      g.exports.qodercontext_new(stack, machine, machineLen, ver, verLen, info, infoLen, meta, metaLen);
    });
    return new _QoderEncryptedInfer(g, context, options.metadata, options.host);
  }
  /**
   * 构造加密推理请求（url / headers / body）。
   *
   * ⚠️ 返回的 `headers` **必须原样透传**：其中的 `Authorization` 是
   * WASM 生成的 `Bearer COSY.<载荷>.<签名>`。用普通 `Bearer <token>`
   * 覆盖会导致 `403 Signature invalid`。
   */
  prepareInfer(ask) {
    const g = this.g;
    const payload = buildQoderInferPayload(ask);
    const result = g.callPointer((stack) => {
      const host = g.writeString(this.host);
      const hostLen = g.lastLength();
      const body = g.writeString(JSON.stringify(payload));
      const bodyLen = g.lastLength();
      const key = g.writeString(ask.modelKey);
      const keyLen = g.lastLength();
      const source = g.writeString(ask.source ?? "system");
      const sourceLen = g.lastLength();
      g.exports.qodercontext_prepareInferRequest(
        stack,
        this.context,
        host,
        hostLen,
        body,
        bodyLen,
        key,
        keyLen,
        source,
        sourceLen
      );
    });
    const headerMap = g.takeObject(g.exports.requestresult_headers(result));
    const headers = {};
    if (headerMap instanceof Map) {
      for (const [k, v] of headerMap) headers[String(k)] = String(v);
    }
    const readResultString = (invoke) => {
      let out = "";
      const v = g.view();
      const stack = g.exports.__wbindgen_add_to_stack_pointer(-16);
      try {
        invoke(stack, result);
        const ptr = v.getInt32(stack + 0, true);
        const len = v.getInt32(stack + 4, true);
        out = ptr ? g.readString(ptr, len) : "";
      } finally {
        g.exports.__wbindgen_add_to_stack_pointer(16);
      }
      return out;
    };
    return {
      // ⚠️ 参数顺序：(栈指针, ptr) —— 与直觉相反
      url: readResultString((stack, ptr) => g.exports.requestresult_url(stack, ptr)),
      headers,
      body: readResultString((stack, ptr) => g.exports.requestresult_body(stack, ptr))
    };
  }
};

// vendor/channel-pack/src/qoder-envelope.ts
import { LlmError as LlmError2 } from "@deepseek-ai/dsh-llm";
function innerTextOf(payload) {
  let envelope;
  try {
    envelope = JSON.parse(payload);
  } catch {
    return null;
  }
  if (envelope.body === void 0) return null;
  return typeof envelope.body === "string" ? envelope.body : JSON.stringify(envelope.body);
}
function classifyInner(inner) {
  const trimmed = inner.trim();
  if (trimmed.length === 0) return "heartbeat";
  if (trimmed.includes("[DONE]")) return "chunk";
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return "error";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "heartbeat";
  }
  const obj = parsed;
  if (Array.isArray(obj.choices) || obj.usage !== void 0) return "chunk";
  if (obj.code !== void 0 || obj.message !== void 0 || obj.error !== void 0 || obj.statusCodeValue !== void 0 || obj.type !== void 0) {
    return "error";
  }
  return "heartbeat";
}
function unwrapQoderEnvelopeStream(response, label) {
  const upstream = response.body;
  if (upstream === null) {
    throw new LlmError2(`${label}: \u54CD\u5E94\u6CA1\u6709 body`, "SERVER");
  }
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  let buffer = "";
  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line === "") {
          controller.enqueue(encoder.encode("\n"));
          continue;
        }
        if (!line.startsWith("data:")) {
          controller.enqueue(encoder.encode(`${line}
`));
          continue;
        }
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          controller.enqueue(encoder.encode("data: [DONE]\n"));
          continue;
        }
        const inner = innerTextOf(payload);
        if (inner === null) {
          controller.enqueue(encoder.encode(`data: ${payload}
`));
          continue;
        }
        if (classifyInner(inner) === "heartbeat") continue;
        if (classifyInner(inner) === "error") {
          let code;
          let message = inner;
          try {
            const parsed = JSON.parse(inner);
            if (parsed.code !== void 0) code = parsed.code;
            if (typeof parsed.message === "string") message = parsed.message;
          } catch {
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              ...code === void 0 ? {} : { code },
              message,
              type: "model_error"
            })}
`)
          );
          continue;
        }
        controller.enqueue(encoder.encode(`data: ${inner}
`));
      }
    },
    flush(controller) {
      const rest = buffer.trim();
      if (rest.length > 0) {
        const inner = rest.startsWith("data:") ? innerTextOf(rest.slice(5).trim()) : null;
        if (inner !== null && classifyInner(inner) !== "heartbeat") {
          controller.enqueue(encoder.encode(`data: ${inner}
`));
        }
      }
    }
  });
  return new Response(upstream.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: { "Content-Type": "text/event-stream" }
  });
}

// vendor/channel-pack/src/qoder-cli.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync5, readFileSync as readFileSync6 } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
var QODER_CLI_RUNTIME = "C:\\Program Files\\Qoder CN\\resources\\app.asar.unpacked\\node_modules\\@qoder-ai\\qoder-cn-agent-sdk\\dist\\_worker\\qoder-worker-runtime.obf.mjs";
var QODER_CLI_TIMEOUT_MS = 25e3;
var QODER_ROUTE_KEYS = /* @__PURE__ */ new Set(["auto", "fast"]);
function parseQoderCliModels(stdout) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of String(stdout ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === "MODEL") continue;
    if (/^Warning: no models available/i.test(line) || /^Not logged in/i.test(line)) continue;
    const match = /^(.+?)(?: \(([^()]+)\))?$/.exec(line);
    if (!match) continue;
    const name = match[1].trim();
    const keyed = match[2] !== void 0;
    const id = (match[2] ?? name).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, keyed });
  }
  return out;
}
function mergeQoderCatalog(cli, fallback, requireKey = true) {
  const byId = new Map(fallback.map((model) => [model.id, model]));
  const byName = new Map(fallback.map((model) => [model.name.toLowerCase(), model]));
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const row of cli) {
    const known = byId.get(row.id) ?? (row.id === row.name ? byName.get(row.name.toLowerCase()) : void 0);
    const id = known?.id ?? row.id;
    if (!id || seen.has(id)) continue;
    if (requireKey && row.keyed === false && !QODER_ROUTE_KEYS.has(id)) continue;
    seen.add(id);
    out.push(known ? { ...known, name: row.name } : { id, name: row.name, contextWindow: 0 });
  }
  return out;
}
function readQoderCatalog(file, fallback) {
  try {
    const rows = JSON.parse(readFileSync6(file, "utf8"));
    if (!Array.isArray(rows)) return null;
    const catalog = mergeQoderCatalog(rows.filter((row) => typeof row?.id === "string" && row.id.length <= 256 && typeof row.name === "string" && row.name.length <= 160).slice(0, 512), fallback);
    return catalog.length ? catalog : null;
  } catch {
    return null;
  }
}
async function saveQoderCatalog(file, catalog) {
  const temporary = file + "." + randomUUID2() + ".tmp";
  try {
    await mkdir(dirname2(file), { recursive: true, mode: 448 });
    await writeFile(temporary, JSON.stringify(catalog.map(({ id, name }) => ({ id, name }))), { mode: 384 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {
    });
  }
}
async function refreshQoderCatalog(runCli, fallback) {
  const fail = (issue) => ({ catalog: null, count: fallback.length, source: "fallback", issue });
  try {
    const result = await runCli();
    const text = `${result.stdout}
${result.stderr}`;
    if (result.spawnError === "ENOENT") return fail("cli-missing");
    if (result.spawnError === "timeout") return fail("timeout");
    if (/Not logged in|No qodercli login found/i.test(text)) return fail("login-required");
    if (result.code !== 0) return fail("cli-failed");
    const cli = parseQoderCliModels(result.stdout);
    if (cli.length === 0) return fail("empty");
    const catalog = mergeQoderCatalog(cli, fallback);
    if (catalog.length === 0) return fail("no-model-key");
    return { catalog, count: catalog.length, source: "remote" };
  } catch {
    return fail("cli-failed");
  }
}
function spawnCli(file, args, env) {
  return new Promise((resolve2) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    try {
      child = spawn2(file, args, { windowsHide: true, env });
    } catch {
      resolve2({ stdout: "", stderr: "", code: 1, spawnError: "spawn-failed" });
      return;
    }
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve2({ stdout, stderr, code, spawnError });
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
      finish(1, "timeout");
    }, QODER_CLI_TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => finish(1, String(err?.code ?? "error")));
    child.on("close", (code) => finish(typeof code === "number" ? code : 1));
  });
}
async function defaultRunQoderCli() {
  const first = await spawnCli("qoderclicn", ["--list-models"]);
  if (first.spawnError === "ENOENT" && existsSync5(QODER_CLI_RUNTIME)) {
    const env = process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : void 0;
    return spawnCli(process.execPath, [QODER_CLI_RUNTIME, "--list-models"], env);
  }
  return first;
}

// vendor/channel-pack/src/qoder-model-list.ts
var QODER_MODEL_LIST_PATH = "/algo/api/v2/model/list?Encode=1";
var QODER_MODEL_GROUPS = ["assistant", "developer", "chat"];
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var nonEmptyString = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
function toQoderModelRow(entry) {
  if (!object(entry) || !nonEmptyString(entry.key)) return null;
  const row = entry;
  const efforts = object(row.thinking_config?.enabled?.efforts) ? Object.keys(row.thinking_config.enabled.efforts) : [];
  const defaultEffort = efforts.find((effort) => {
    const value = (row.thinking_config?.enabled?.efforts)[effort];
    return value?.is_default === true;
  });
  const defaults = object(row.context_config) ? Object.values(row.context_config) : [];
  const preferred = Number((defaults.find((cfg) => cfg?.is_default === true) ?? defaults[0])?.token_count);
  const contextWindow = Number.isFinite(preferred) && preferred > 0 ? preferred : Number(row.max_input_tokens);
  const priceFactor = Number(row.price_factor);
  return {
    id: row.key,
    name: nonEmptyString(row.display_name) ? row.display_name : row.key,
    // `0` 是「未知窗口」哨兵（宿主投影按 `> 0` 过滤），不编造。
    contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 0,
    supportsImage: row.is_vl === true,
    // ⚠️ 上游 `is_reasoning` 与「是否产出 reasoning_content」不完全一致：
    // `dfmodel` 报 `is_reasoning:false` 但实测 50/57 帧有思考，且目录给了
    // 三个档位。有档位即可思考 —— 不要用 `is_reasoning:false` 把档位选择器关掉。
    supportsThinking: row.is_reasoning === true || efforts.length > 0,
    ...efforts.length > 0 ? { efforts } : {},
    ...defaultEffort !== void 0 ? { defaultEffort } : {},
    ...row.thinking_config?.disabled !== void 0 ? { supportsDisable: true } : {},
    // ⚠️ `0` 是合法的「免费」倍率，不能当缺失处理（`Number.isFinite` 判据）。
    ...Number.isFinite(priceFactor) && priceFactor >= 0 ? { priceFactor } : {}
  };
}
function parseQoderModelList(json) {
  if (!object(json)) return null;
  let rows = null;
  for (const group of QODER_MODEL_GROUPS) {
    const candidate = json[group];
    if (Array.isArray(candidate) && candidate.length > 0) {
      rows = candidate;
      break;
    }
  }
  if (rows === null) return null;
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of rows) {
    const row = toQoderModelRow(entry);
    if (row === null || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out.length > 0 ? out : null;
}

// vendor/channel-pack/src/qoder-cosy.ts
import { createCipheriv as createCipheriv2, createHash as createHash3, constants, publicEncrypt, randomBytes as randomBytes3 } from "node:crypto";
var COSY_VERSION2 = "1.0.10";
var SERVER_PUB_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
var md5Hex = (s) => createHash3("md5").update(s).digest("hex");
var deriveID = (seed, salt, installSalt = "") => md5Hex(`${salt}:${installSalt ? `${seed}|salt:${installSalt}` : seed}`);
var deriveMachineId = (seed, installSalt = "") => deriveID(seed, "machine", installSalt);
var deriveMachineType = (seed, installSalt = "") => deriveID(seed, "machinetype", installSalt).slice(0, 18);
var deriveMachineToken = (seed, installSalt = "") => createHash3("sha512").update(`machinetoken:${installSalt ? `${seed}|salt:${installSalt}` : seed}`).digest().toString("base64url").slice(0, 43);
var aesCbcEncrypt = (plain, key) => {
  const pad = 16 - plain.length % 16;
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv2("aes-128-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
};
var newUUID = () => {
  const hex = randomBytes3(16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
function newCosySession(identity) {
  const tempKey = randomBytes3(8).toString("hex");
  const cosyKey = publicEncrypt(
    { key: SERVER_PUB_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(tempKey, "utf8")
  ).toString("base64");
  const payload = JSON.stringify({
    name: "",
    aid: "",
    uid: identity.uid,
    yx_uid: "",
    organization_id: "",
    organization_name: "",
    user_type: "",
    security_oauth_token: identity.securityOauthToken,
    refresh_token: identity.refreshToken ?? ""
  });
  const info = aesCbcEncrypt(Buffer.from(payload, "utf8"), Buffer.from(tempKey, "utf8")).toString("base64");
  const seed = identity.uid;
  return {
    uid: identity.uid,
    info,
    cosyKey,
    machineId: deriveMachineId(seed),
    machineType: deriveMachineType(seed),
    machineToken: deriveMachineToken(seed)
  };
}
var pathSigOf = (rawUrl) => {
  const url = new URL(rawUrl);
  return url.pathname.startsWith("/algo") ? url.pathname.slice(5) : url.pathname;
};
var signRequest = (payloadB64, cosyKey, cosyDate, body, pathSig) => md5Hex(`${payloadB64}
${cosyKey}
${cosyDate}
${body}
${pathSig}`);
function cosyHeaders(session, fullUrl, body, accept = "application/json") {
  const payloadB64 = Buffer.from(JSON.stringify({
    cosyVersion: COSY_VERSION2,
    ideVersion: "",
    info: session.info,
    requestId: newUUID(),
    version: "v1"
  }), "utf8").toString("base64");
  const date = String(Math.floor(Date.now() / 1e3));
  const sig = signRequest(payloadB64, session.cosyKey, date, body, pathSigOf(fullUrl));
  return {
    "cosy-data-policy": "agree",
    "content-type": "application/json",
    "cosy-machinetype": session.machineType,
    "cosy-clienttype": "5",
    "cosy-date": date,
    "cosy-user": session.uid,
    "cosy-key": session.cosyKey,
    "cache-control": "no-cache",
    accept,
    authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "cosy-version": COSY_VERSION2,
    "cosy-machineid": session.machineId,
    "cosy-machinetoken": session.machineToken,
    "login-version": "v2",
    "user-agent": "Go-http-client/2.0",
    "cosy-scene": "assistant",
    "cosy-business-product": "ide",
    "cosy-business-type": "agent"
  };
}

// src/image-pricing.js
var FALLBACK_IMAGE_PRICING = Object.freeze({
  /** @param {readonly { offloaded?: boolean }[]} images */
  priceImages(images) {
    return images.map((image) => image.offloaded === true ? { visualTokens: 0, text: "[image omitted]" } : { visualTokens: 1024, text: "[image]" });
  }
});

// vendor/channel-pack/src/openai-gateway/channel.ts
var GATEWAY_CHANNEL_MARK = Symbol("dsh.openai-gateway.channel");
function channelOfOptions(options) {
  return typeof options === "object" && options !== null && options[GATEWAY_CHANNEL_MARK] === true ? "gateway" : "direct";
}

// vendor/channel-pack/src/llm-register-compat.ts
var DUPLICATE_DIRECTORY = "DUPLICATE_DIRECTORY";
function isDuplicateRegistrationError(error) {
  if (typeof error !== "object" || error === null) return false;
  const code = error.code;
  if (code === DUPLICATE_DIRECTORY) return true;
  const message = error.message;
  if (typeof message !== "string") return false;
  return /already declared|already registered|is already (?:a|an) adapter/.test(message);
}
function wrapAdapterWithTokenLedger(providers, adapter) {
  const provider = providers[0] ?? "";
  const accountingStream = (options, open) => {
    const channel = channelOfOptions(options);
    const model = String(options?.model ?? "").slice(0, 160);
    return recordThroughStream(open, { channel, provider, model, startedAt: Date.now() });
  };
  return new Proxy(adapter, {
    get(target, prop) {
      if (prop === "imageRequestPricing") {
        return (provider2, model) => {
          const original = Reflect.get(target, prop, target);
          const pricing = typeof original === "function" ? original.call(target, provider2, model) : void 0;
          return pricing ?? FALLBACK_IMAGE_PRICING;
        };
      }
      if (prop === "stream") {
        return (options) => accountingStream(
          options,
          () => target.stream.call(target, options)
        );
      }
      if (prop === "prepareCall") {
        const original = Reflect.get(target, prop, target);
        if (typeof original !== "function") return original;
        return async (...args) => {
          const call = await original.apply(target, args);
          if (call === null || typeof call !== "object") return call;
          const inner = call.stream;
          if (typeof inner !== "function") return call;
          return {
            ...call,
            // ⚠️ 只包 `stream` 这一个字段，其余（modelInfo 等）原样透传。
            stream: (options) => accountingStream(
              options,
              () => inner.call(target, options)
            )
          };
        };
      }
      return Reflect.get(target, prop, target);
    }
  });
}
async function* recordThroughStream(openStream, meta) {
  let usageReported = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens;
  let cacheWriteTokens;
  let reasoningTokens;
  let ttftMs = 0;
  let accountId = "";
  let failure;
  try {
    for await (const chunk of openStream()) {
      if (ttftMs === 0) ttftMs = Date.now() - meta.startedAt;
      if (typeof chunk === "object" && chunk !== null && chunk.type === "usage") {
        const usage = chunk.usage;
        if (typeof usage === "object" && usage !== null) {
          usageReported = true;
          inputTokens = Number(usage.inputTokens);
          outputTokens = Number(usage.outputTokens);
          if (Number(usage.cacheReadTokens) > 0) cacheReadTokens = Number(usage.cacheReadTokens);
          if (Number(usage.cacheWriteTokens) > 0) cacheWriteTokens = Number(usage.cacheWriteTokens);
          if (Number(usage.reasoningTokens) > 0) reasoningTokens = Number(usage.reasoningTokens);
          if (accountId === "") accountId = peekLedgerAccount(meta.provider);
        }
      }
      yield chunk;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (accountId === "") accountId = peekLedgerAccount(meta.provider);
    recordTokenUsage({
      channel: meta.channel,
      provider: meta.provider,
      model: meta.model,
      ...accountId.length > 0 ? { accountId } : {},
      usageReported,
      inputTokens,
      outputTokens,
      ...cacheReadTokens !== void 0 ? { cacheReadTokens } : {},
      ...cacheWriteTokens !== void 0 ? { cacheWriteTokens } : {},
      ...reasoningTokens !== void 0 ? { reasoningTokens } : {},
      // 首字用时（0 = 无任何块 → recordTokenUsage 内省略该字段）
      ...ttftMs > 0 ? { ttftMs } : {},
      durationMs: Date.now() - meta.startedAt,
      ...failure !== void 0 ? { error: failure } : {}
    });
  }
}
function registerAdapterIdempotent(llm, providers, adapter, warn) {
  let target = wrapAdapterWithTokenLedger(providers, adapter);
  if (typeof adapter === "object" && adapter !== null) {
    try {
      target = withDeadModelPruning(providers, target);
    } catch (error) {
      warn?.(`[llm-register] \u5DF2\u5931\u6548\u6A21\u578B\u5254\u9664\u5305\u88C5\u5931\u8D25\uFF0C\u4F7F\u7528\u539F\u9002\u914D\u5668: ${String(error)}`);
    }
  }
  try {
    return llm.registerAdapter(providers, target);
  } catch (error) {
    if (!isDuplicateRegistrationError(error)) throw error;
    warn?.(
      `[llm-register] adapter for ${providers.map((p) => `"${p}"`).join(", ")} \u5DF2\u6CE8\u518C\uFF08\u63D2\u4EF6 fiber \u91CD\u542F\u7ADE\u6001\uFF09\uFF0C\u4FDD\u7559\u73B0\u6709\u8DEF\u7531\u5E76\u8DF3\u8FC7\u672C\u6B21\u6CE8\u518C`
    );
    return void 0;
  }
}

// vendor/channel-pack/src/openai-compat.ts
import { LlmError as LlmError4, ToolCallId } from "@deepseek-ai/dsh-llm";

// vendor/channel-pack/src/rate-limit.ts
var RATE_LIMIT_PATTERN = /频率限制|频率超出|使用量已超出|重置|rate.?limit|frequency limit|usage exceeds|too many requests/i;
function isRateLimited(body, status) {
  if (status === 429) return true;
  return RATE_LIMIT_PATTERN.test(body);
}
var RESET_TIME_PATTERN = /(?:将在|reset at)\s+([\d-]+\s+[\d:]+)\s+(UTC[+-]\d+(?::\d+)?)/i;
var RATE_LIMIT_FALLBACK_MS = 36e5;
function parseRateLimitError(body, currentModel, status) {
  const fallback = () => ({
    modelId: currentModel,
    resetTimeMs: Date.now() + RATE_LIMIT_FALLBACK_MS
  });
  try {
    const data = JSON.parse(body);
    const msg = typeof data.msg === "string" ? data.msg : "";
    const resetMatch = RESET_TIME_PATTERN.exec(msg);
    if (resetMatch) {
      const resetMs = Date.parse(`${resetMatch[1]} ${resetMatch[2]}`);
      if (!Number.isNaN(resetMs)) {
        return { modelId: currentModel, resetTimeMs: resetMs };
      }
    }
    if (isRateLimited(body, status)) {
      return fallback();
    }
    return null;
  } catch {
    return status === 429 ? fallback() : null;
  }
}

// vendor/channel-pack/src/sse.ts
import { EMPTY_RESPONSE_CODE, LlmError as LlmError3 } from "@deepseek-ai/dsh-llm";

// vendor/channel-pack/src/message-shape.ts
function isWrappedToolResult(block) {
  return typeof block === "object" && block !== null && block.type === "tool-result";
}
function isToolRoleMessage(message) {
  return message.role === "tool";
}
function detectMessageShape(messages) {
  let sawLegacy = false;
  for (const message of messages) {
    if (isToolRoleMessage(message)) return "tool-role";
    const content = message.content;
    if (Array.isArray(content) && content.some(isWrappedToolResult)) sawLegacy = true;
  }
  return sawLegacy ? "legacy" : "none";
}
function normalizeHarnessMessages(messages) {
  const shape = detectMessageShape(messages);
  const hasDeveloper = messages.some((message) => message.role === "developer");
  if (shape !== "tool-role" && !hasDeveloper) {
    return messages;
  }
  const normalized = [];
  for (const message of messages) {
    if (message.role === "developer") continue;
    if (!isToolRoleMessage(message)) {
      normalized.push(message);
      continue;
    }
    const source = message["source"];
    const sourceCallId = typeof source === "object" && source !== null ? source.callId : void 0;
    const toolCallId = message.toolCallId ?? sourceCallId;
    const block = {
      type: "tool-result",
      toolCallId,
      content: message.content
    };
    if (message.isError !== void 0) block.isError = message.isError;
    normalized.push({ role: "user", content: [block] });
  }
  return normalized;
}

// vendor/channel-pack/src/sse.ts
async function readWithIdleTimeout(reader, timeoutMs, label, signal, phase = "chunk") {
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  let timer;
  const onUserAbort = () => {
    if (timer) clearTimeout(timer);
  };
  signal?.addEventListener("abort", onUserAbort, { once: true });
  const readPromise = reader.read();
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new LlmError3(`${label}: sse ${phase} timeout after ${timeoutMs}ms`, "TIMEOUT"));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([readPromise, timeoutPromise]);
    return { done: result.done, value: result.value };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof LlmError3) {
      await reader.cancel().catch(() => {
      });
      throw error;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onUserAbort);
  }
}
function hasUsableToolName(name) {
  return typeof name === "string" && name.trim().length > 0;
}
function resolveEmptyResponseReason(reason, blockCount) {
  if (blockCount > 0 || reason.kind !== "stop") return reason;
  return {
    kind: "error",
    failure: {
      message: "model returned a completed response with no content",
      code: EMPTY_RESPONSE_CODE
    }
  };
}
function createBlankReasoningSuppressor() {
  let accumulated = "";
  let emitting = false;
  return {
    feed(text) {
      accumulated += text;
      if (emitting) return text;
      if (text.trim() === "") return void 0;
      emitting = true;
      return accumulated;
    },
    text() {
      return accumulated;
    }
  };
}
function resolveToolPairing(messages) {
  const normalized = normalizeHarnessMessages(messages);
  const allResultIds = /* @__PURE__ */ new Set();
  for (const message of normalized) {
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (typeof block === "object" && block !== null && block.type === "tool-result") {
        allResultIds.add(String(block.toolCallId));
      }
    }
  }
  const keepCallIds = /* @__PURE__ */ new Set();
  for (const message of normalized) {
    if (message.role !== "assistant") continue;
    const content = Array.isArray(message.content) ? message.content : [];
    const calls = content.filter((block) => typeof block === "object" && block !== null && block.type === "tool-call");
    if (calls.length === 0) continue;
    const usable = calls.filter((block) => hasUsableToolName(block.name));
    if (usable.length === 0) continue;
    if (usable.every((block) => allResultIds.has(String(block.id)))) {
      for (const block of usable) keepCallIds.add(String(block.id));
    }
  }
  const keepResultIds = /* @__PURE__ */ new Set();
  for (const id of keepCallIds) {
    if (allResultIds.has(id)) keepResultIds.add(id);
  }
  return { keepCallIds, keepResultIds };
}
function normalizeToolArguments(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "{}";
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return isTruncatedArguments(trimmed) ? "{}" : trimmed;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "{}";
  return trimmed;
}
function isTruncatedArguments(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  try {
    JSON.parse(trimmed);
    return false;
  } catch {
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of trimmed) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return inString || depth !== 0;
}
var REASONING_LOOP_CODE = "REASONING_LOOP";
function resolveSliceChars(raw) {
  const value = raw ?? 64;
  return Number.isFinite(value) ? Math.max(1, value) : 64;
}
function createReasoningLoopDetector(options = {}) {
  const windowChars = options.windowChars ?? 3e3;
  const maxDistinctLineRatio = options.maxDistinctLineRatio ?? 0.35;
  const minLines = options.minLines ?? 40;
  const minLoopChars = options.minLoopChars ?? 2e3;
  const sliceChars = resolveSliceChars(options.sliceChars);
  let text = "";
  let detected = false;
  let cutAt;
  let runStart = 0;
  let runChars = 0;
  let hitLines = 0;
  let hitDistinct = 0;
  function feedPiece(piece) {
    text += piece;
    const window = text.slice(Math.max(0, text.length - windowChars));
    const lines = window.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    const looping = lines.length >= minLines && new Set(lines).size / lines.length < maxDistinctLineRatio;
    if (!looping) {
      runStart = 0;
      runChars = 0;
      return false;
    }
    if (runChars === 0) runStart = text.length - piece.length;
    runChars += piece.length;
    if (runChars < minLoopChars) return false;
    detected = true;
    cutAt = runStart;
    hitLines = lines.length;
    hitDistinct = new Set(lines).size;
    return true;
  }
  return {
    get detected() {
      return detected;
    },
    get cutAt() {
      return cutAt;
    },
    get diagnostics() {
      if (!detected) return void 0;
      return {
        observedChars: text.length,
        runChars,
        lines: hitLines,
        distinctLines: hitDistinct,
        distinctLineRatio: hitLines === 0 ? 1 : hitDistinct / hitLines
      };
    },
    observe(delta) {
      if (detected) return false;
      if (delta.length === 0) return false;
      for (let offset = 0; offset < delta.length; offset += sliceChars) {
        if (feedPiece(delta.slice(offset, offset + sliceChars))) return true;
      }
      return false;
    }
  };
}
function reasoningLoopFailure(diagnostics, maxTokens, channel) {
  const label = channel === "reasoning" ? "\u601D\u8003" : "\u6B63\u6587";
  const parts = [
    `\u6A21\u578B${label}\u9677\u5165\u75C5\u6001\u91CD\u590D\uFF0C\u5DF2\u4E2D\u6B62\u672C\u8F6E\uFF08**\u4E0D\u662F**\u8F93\u51FA token \u4E0A\u9650\uFF09\u3002`
  ];
  if (diagnostics !== void 0) {
    parts.push(
      `\u5224\u636E\uFF1A\u5C3E\u90E8 ${diagnostics.lines} \u884C\u91CC\u53EA\u6709 ${diagnostics.distinctLines} \u884C\u4E0D\u91CD\u590D\uFF08\u53BB\u91CD\u7387 ${diagnostics.distinctLineRatio.toFixed(3)}\uFF0C\u9608\u503C <0.35\uFF09\uFF0C\u8FDE\u7EED\u5FAA\u73AF\u4F53\u91CF ${diagnostics.runChars} \u5B57\u7B26\u3002`
    );
  }
  if (diagnostics !== void 0 && maxTokens !== void 0 && maxTokens > 0) {
    const usedTokens = Math.ceil(diagnostics.observedChars / 3.5);
    const remaining = Math.max(0, maxTokens - usedTokens);
    parts.push(
      `\u672C\u6B21${label}\u4EC5\u4EA7\u51FA\u7EA6 ${diagnostics.observedChars} \u5B57\u7B26\uFF08\u7EA6 ${usedTokens} token\uFF09\uFF0C\u989D\u5EA6 ${maxTokens} token \u4E2D**\u8FD8\u5269\u7EA6 ${remaining}**\uFF08\u4F30\u7B97\u503C\uFF09\u2014\u2014\u989D\u5EA6\u6CA1\u6709\u5360\u6EE1\uFF0C\u53EF\u4EE5\u76F4\u63A5\u7EE7\u7EED\u4EFB\u52A1\u3002`
    );
  } else {
    parts.push(`\u989D\u5EA6\u6CA1\u6709\u5360\u6EE1\uFF0C\u53EF\u4EE5\u76F4\u63A5\u7EE7\u7EED\u4EFB\u52A1\u3002`);
  }
  parts.push("\u82E5\u7EE7\u7EED\u540E\u518D\u6B21\u9677\u5165\u540C\u4E00\u5FAA\u73AF\uFF0C\u5EFA\u8BAE\u964D\u4F4E\u601D\u8003\u6863\u4F4D\u6216\u66F4\u6362\u6A21\u578B\u3002");
  return { message: parts.join(""), code: REASONING_LOOP_CODE };
}
function isReasoningLoopGuardEnabled() {
  return false;
}
var THINK_CLOSE_TAG_RE = /<\/think(?::[0-9a-f]+)?>/g;
var THINK_ANY_TAG_RE = /<\/?think(?::[0-9a-f]+)?>/g;
function splitThinkTaggedContent(raw) {
  if (raw.length === 0) return void 0;
  const re = new RegExp(THINK_CLOSE_TAG_RE.source, "g");
  let last;
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) last = m;
  if (last === void 0) return void 0;
  if (isQuotedThinkTag(raw, last.index)) return void 0;
  const boundary = last.index;
  const textStart = boundary + last[0].length;
  const reasoning = raw.slice(0, boundary).replace(new RegExp(THINK_ANY_TAG_RE.source, "g"), "");
  return { reasoning, text: raw.slice(textStart), textStart };
}
function isQuotedThinkTag(raw, index) {
  const before = raw.slice(0, index).trimEnd();
  if (before.endsWith("`")) return true;
  const after = raw.slice(index).trimStart();
  const tagEnd = raw.indexOf(">", index);
  if (tagEnd !== -1 && raw.slice(tagEnd + 1).trimStart().startsWith("`")) return true;
  if ((before.match(/`/g) ?? []).length % 2 === 1) return true;
  const fences = raw.slice(0, index).match(/```/g);
  if (fences !== null && fences.length % 2 === 1) return true;
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineBefore = raw.slice(lineStart, index);
  if ((lineBefore.match(/'/g) ?? []).length % 2 === 1) return true;
  if ((lineBefore.match(/"/g) ?? []).length % 2 === 1) return true;
  return false;
}
var ASCII_LETTER_RE = /[A-Za-z]/;
function stripCourseLeak(text) {
  if (text.length === 0) return text;
  if (!text.includes("course") && !text.includes("\u8BFE")) return text;
  const lines = text.split("\n");
  let changed = false;
  const cleaned = lines.map((line) => {
    const match = /^([ \t]*)(course|课)(.*)$/.exec(line);
    if (match === null) return line;
    const [, indent, word, rest] = match;
    if (word === "course") {
      const first = rest[0];
      if (first !== void 0 && ASCII_LETTER_RE.test(first)) return line;
      const trimmed2 = rest.startsWith(" ") ? rest.slice(1) : rest;
      changed = true;
      return indent + trimmed2;
    }
    const trimmed = rest.startsWith(" ") ? rest.slice(1) : rest;
    changed = true;
    return indent + trimmed;
  });
  return changed ? cleaned.join("\n") : text;
}
function resolveCourseLeakStripFlag(raw) {
  if (raw === void 0) return true;
  const value = raw.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "no" || value === "off");
}
function isCourseLeakStripEnabled() {
  return resolveCourseLeakStripFlag(process.env.DSH_COURSE_LEAK_STRIP);
}
function stripCourseLeakIfEnabled(text) {
  return isCourseLeakStripEnabled() ? stripCourseLeak(text) : text;
}
function stripCourseLeakFromHistoryContent(role, content) {
  if (role !== "assistant") return content;
  if (!isCourseLeakStripEnabled()) return content;
  let changed = false;
  const cleaned = content.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const block = raw;
    if (block.type !== "text" && block.type !== "reasoning") return raw;
    if (typeof block.text !== "string" || block.text.length === 0) return raw;
    const stripped = stripCourseLeak(block.text);
    if (stripped === block.text) return raw;
    changed = true;
    return { ...block, text: stripped };
  });
  return changed ? cleaned : content;
}
function resolveThinkLeakStripFlag(raw) {
  if (raw === void 0) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
function isThinkLeakStripEnabled() {
  return resolveThinkLeakStripFlag(process.env.DSH_THINK_LEAK_STRIP);
}
function stripBareThinkCloseTagIfEnabled(text) {
  return isThinkLeakStripEnabled() ? stripBareThinkCloseTag(text) : text;
}
function stripBareThinkCloseTag(text) {
  const trimmed = text.trim();
  if (/^`.*<\/think>.*`$/.test(trimmed)) return text;
  let backtickCount = 0;
  for (const ch of text) if (ch === "`") backtickCount++;
  if (backtickCount % 2 === 1) return text;
  const stripped = trimmed.replace(/<\/think>/g, "").trim();
  if (stripped.length === 0) return "";
  return text;
}
function isProseTruncatedByStopString(text) {
  if (text.length === 0) return false;
  const tail = text.trimEnd();
  if (tail.length === 0) return false;
  let ticks = 0;
  for (const ch of tail) if (ch === "`") ticks += 1;
  if (ticks % 2 === 0) return false;
  return /`$/.test(tail) || /<$/.test(tail) || /<\/think$/.test(tail);
}

// vendor/channel-pack/src/openai-compat.ts
function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => typeof block === "object" && block !== null && block.type === "text").map((block) => String(block.text)).join("");
}
var TOOL_RESULT_IMAGE_TEXT = "Attached image(s) from tool result:";
function userContentParts(content, imageUrls) {
  const parts = [];
  let hasImage = false;
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue;
    const block = raw;
    if (block.type === "text") {
      const text = String(block.text ?? "");
      if (text.length > 0) parts.push({ type: "text", text });
      continue;
    }
    if (block.type === "image") {
      hasImage = true;
      const url = block.attachment?.attachmentId === void 0 ? void 0 : imageUrls.get(String(block.attachment.attachmentId));
      parts.push(url === void 0 ? { type: "text", text: "[image unavailable]" } : { type: "image_url", image_url: { url } });
      continue;
    }
    if (block.type === "tool-result" && Array.isArray(block.content)) {
      const inner = userContentParts(block.content, imageUrls);
      if (inner !== void 0) {
        hasImage = true;
        parts.push(...inner);
      } else {
        const text = contentToText(block.content);
        if (text.length > 0) parts.push({ type: "text", text });
      }
    }
  }
  return hasImage && parts.length > 0 ? parts : void 0;
}
function collectImages(content, refs) {
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue;
    const block = raw;
    if (block.type === "image" && typeof block.attachment?.attachmentId === "string") {
      refs.set(block.attachment.attachmentId, block.attachment);
      continue;
    }
    if (block.type === "tool-result" && Array.isArray(block.content)) collectImages(block.content, refs);
  }
}
function serializeMessages(messages, imageUrls) {
  const normalized = normalizeHarnessMessages(messages);
  const wire = [];
  const { keepCallIds, keepResultIds } = resolveToolPairing(normalized);
  let pendingToolImages = [];
  const flushToolImages = () => {
    if (pendingToolImages.length === 0) return;
    wire.push({
      role: "user",
      content: [{ type: "text", text: TOOL_RESULT_IMAGE_TEXT }, ...pendingToolImages]
    });
    pendingToolImages = [];
  };
  for (const message of normalized) {
    if (message.role === "assistant") {
      const content2 = stripCourseLeakFromHistoryContent(
        message.role,
        Array.isArray(message.content) ? message.content : []
      );
      const toolCalls = content2.filter((block) => typeof block === "object" && block !== null && block.type === "tool-call").filter((block) => keepCallIds.has(String(block.id))).map((block) => ({
        id: String(block.id),
        type: "function",
        function: { name: String(block.name), arguments: normalizeToolArguments(String(block.arguments)) }
      }));
      const reasoning = content2.filter((block) => typeof block === "object" && block !== null && block.type === "reasoning").map((block) => String(block.text)).join("");
      const text2 = contentToText(content2);
      if (text2.trim().length === 0 && toolCalls.length === 0) continue;
      flushToolImages();
      wire.push({
        role: "assistant",
        // 正文为空且有工具调用时 content 必须为 null（OpenAI 规范）。
        content: text2.length === 0 && toolCalls.length > 0 ? null : text2,
        ...reasoning.length > 0 ? { reasoning_content: reasoning } : {},
        ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
      });
      continue;
    }
    if (message.role === "system") {
      flushToolImages();
      wire.push({ role: "system", content: contentToText(message.content) });
      continue;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    const toolResults = content.filter((block) => typeof block === "object" && block !== null && block.type === "tool-result");
    const text = contentToText(message.content);
    const regular = content.filter((block) => !(typeof block === "object" && block !== null && block.type === "tool-result"));
    const parts = imageUrls === void 0 ? void 0 : userContentParts(regular, imageUrls);
    if (parts !== void 0) {
      flushToolImages();
      wire.push({ role: "user", content: parts });
    } else if (text.trim().length > 0) {
      flushToolImages();
      wire.push({ role: "user", content: text });
    }
    for (const result of toolResults) {
      if (!keepResultIds.has(String(result.toolCallId))) continue;
      let resultText = "(no output)";
      if (imageUrls !== void 0 && Array.isArray(result.content)) {
        const resultParts = userContentParts(result.content, imageUrls);
        if (resultParts !== void 0) {
          pendingToolImages.push(...resultParts.filter((part) => part.type !== "text"));
          const joined = resultParts.filter((part) => part.type === "text").map((part) => String(part.text)).join("");
          if (joined.length > 0) resultText = joined;
        } else {
          resultText = contentToText(result.content) || "(no output)";
        }
      } else {
        resultText = contentToText(result.content) || "(no output)";
      }
      wire.push({
        role: "tool",
        tool_call_id: String(result.toolCallId),
        content: resultText
      });
    }
  }
  flushToolImages();
  return wire;
}
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}
function errorDetail(body) {
  try {
    const data = JSON.parse(body);
    const nested = typeof data.error === "object" && data.error !== null ? data.error.message : data.error;
    const parts = [
      typeof data.code === "number" || typeof data.code === "string" ? `code=${String(data.code)}` : void 0,
      typeof data.message === "string" ? data.message : void 0,
      typeof data.msg === "string" ? data.msg : void 0,
      typeof nested === "string" ? nested : void 0
    ].filter((value) => value !== void 0);
    if (parts.length > 0) return parts.join(" ");
  } catch {
  }
  return body;
}
function httpErrorCode(status) {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) return "INVALID_REQUEST";
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}
function isTransportError(error) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (message.includes("terminated")) return true;
  if (error.name.startsWith("UND_ERR_")) return true;
  if (message.includes("fetch failed")) return true;
  if (message.includes("econnreset") || message.includes("epipe") || message.includes("socket hang up")) return true;
  return false;
}
var RAW_SNIPPET_LIMIT = 400;
async function* consumeOpenAiSse(response, options, config) {
  const { label } = config;
  const restoreToolName = config.restoreToolName ?? ((name) => name);
  if (!response.body) throw new LlmError4(`${label}: empty model response body`, "EMPTY_RESPONSE");
  const blocks = [];
  let nextIndex = 0;
  const loopGuard = isReasoningLoopGuardEnabled() ? createReasoningLoopDetector() : void 0;
  let loopDetected = false;
  const proseLoopGuard = isReasoningLoopGuardEnabled() ? createReasoningLoopDetector() : void 0;
  let proseLoopDetected = false;
  const suppressor = createBlankReasoningSuppressor();
  const proseSuppressor = createBlankReasoningSuppressor();
  const toolCalls = /* @__PURE__ */ new Map();
  const toolOrder = [];
  const toolIds = /* @__PURE__ */ new Map();
  let buffer = "";
  let streamEnded = false;
  let finishReason;
  let gotAnyContent = false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let firstTokenReceived = false;
  let sawDataFrame = false;
  let rawSnippet = "";
  let rawJson = "";
  try {
    for (; ; ) {
      if (streamEnded) break;
      let result;
      try {
        const timeoutMs = firstTokenReceived ? config.chunkTimeoutMs : config.firstTokenTimeoutMs;
        const phase = firstTokenReceived ? "chunk" : "first-token";
        result = await readWithIdleTimeout(reader, timeoutMs, label, options.signal, phase);
        if (!result.done) firstTokenReceived = true;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (error instanceof LlmError4) throw error;
        if (isTransportError(error)) {
          throw new LlmError4(`${label}: sse transport error: ${errorMessage(error)}`, "TRANSPORT", { cause: error });
        }
        throw error;
      }
      if (result.done) break;
      const decoded = decoder.decode(result.value, { stream: true });
      if (!sawDataFrame && config.isQuotaError !== void 0 && rawJson.length < 65536) {
        rawJson = (rawJson + decoded).slice(0, 65536);
      }
      if (rawSnippet.length < RAW_SNIPPET_LIMIT) {
        rawSnippet = (rawSnippet + decoded).slice(0, RAW_SNIPPET_LIMIT);
      }
      buffer += decoded;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        sawDataFrame = true;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          streamEnded = true;
          break;
        }
        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          config.validateBareModel?.(payload);
          continue;
        }
        throwIfModelQueued(data);
        if (config.onFrame !== void 0) {
          try {
            config.onFrame(data);
          } catch {
          }
        }
        if (data.choices === void 0 && config.isQuotaError?.(data)) {
          throw new LlmError4(`${label}: ${errorDetail(payload)}`, "QUOTA_EXCEEDED");
        }
        if (data.error !== void 0) {
          throw new LlmError4(`${label}: ${data.error.message ?? "unknown error"}`, "SERVER");
        }
        if (data.choices === void 0 && data.code !== void 0 && typeof data.message === "string") {
          const queueInfo = parseQueueError(data.message);
          if (queueInfo !== void 0) {
            const retryAfterMs = queueDelayMs(queueInfo);
            throw new ModelQueuedError(
              `${label}: ${data.message}`,
              {
                queueInfo: { ...queueInfo },
                ...retryAfterMs === void 0 ? {} : { retryAfterMs }
              }
            );
          }
          if (isBillingBusinessCode(data.code) || looksLikeBillingError(data.message)) {
            throw new LlmError4(
              `${label}: ${data.message}`,
              "QUOTA_EXCEEDED",
              { ...typeof data.code === "number" ? { status: data.code } : {} }
            );
          }
          if (isRateLimited(data.message, typeof data.code === "number" ? data.code : void 0)) {
            const failure = new LlmError4(`${label}: ${data.message}`, "RATE_LIMIT");
            const parsed = parseRateLimitError(data.message, "", typeof data.code === "number" ? data.code : void 0);
            failure.rateLimitResetAtMs = parsed?.resetTimeMs ?? Date.now() + RATE_LIMIT_FALLBACK_MS;
            throw failure;
          }
          const detail = [String(data.code), data.type].filter(Boolean).join("/");
          throw new LlmError4(
            `${label}: ${data.message}${detail.length > 0 ? ` (${detail})` : ""}`,
            "SERVER"
          );
        }
        if (data.choices === void 0 && typeof data.message === "string") {
          const status = typeof data.statusCodeValue === "number" ? data.statusCodeValue : void 0;
          const looksLikeError = status !== void 0 && status >= 400 || data.stackTrace !== void 0 || data.type === "model_error";
          if (looksLikeError) {
            const queueInfo = parseQueueError(data.message);
            if (queueInfo !== void 0) {
              const retryAfterMs = queueDelayMs(queueInfo);
              throw new ModelQueuedError(
                `${label}: ${data.message}`,
                {
                  queueInfo: { ...queueInfo },
                  ...retryAfterMs === void 0 ? {} : { retryAfterMs }
                }
              );
            }
            if (looksLikeBillingError(data.message)) {
              throw new LlmError4(`${label}: ${data.message}`, "QUOTA_EXCEEDED", {
                ...status === void 0 ? {} : { status }
              });
            }
            const suffix = status === void 0 ? "" : ` (status=${status})`;
            throw new LlmError4(`${label}: ${data.message}${suffix}`, "SERVER", {
              ...status === void 0 ? {} : { status }
            });
          }
        }
        config.validateFrame?.(data);
        const choice = data.choices?.[0];
        const delta = choice?.delta;
        if (typeof choice?.finish_reason === "string") {
          finishReason = choice.finish_reason;
        }
        const deltaContent = delta?.content;
        const rawTextDelta = typeof deltaContent === "string" && deltaContent.length > 0 ? deltaContent : !gotAnyContent && typeof choice?.message?.content === "string" ? choice.message.content : void 0;
        if (typeof deltaContent === "string" && deltaContent.length > 0) gotAnyContent = true;
        const textDelta = rawTextDelta === void 0 ? void 0 : proseSuppressor.feed(rawTextDelta);
        if (textDelta !== void 0 && textDelta.length > 0) {
          let block = blocks.find((candidate) => candidate.kind === "text");
          if (block === void 0) {
            block = { index: nextIndex++, kind: "text", text: "" };
            blocks.push(block);
            yield { type: "block-start", index: block.index, blockType: "text" };
          }
          if (proseLoopGuard !== void 0) {
            if (proseLoopGuard.observe(textDelta)) proseLoopDetected = true;
          }
          if (!proseLoopDetected) {
            block.text += textDelta;
            yield { type: "text-delta", index: block.index, text: textDelta };
          }
        }
        const reasoningDelta = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
          if (loopGuard !== void 0) {
            if (loopGuard.observe(reasoningDelta)) loopDetected = true;
          }
          if (!loopDetected) {
            const emit = suppressor.feed(reasoningDelta);
            if (emit !== void 0) {
              let block = blocks.find((candidate) => candidate.kind === "reasoning");
              if (block === void 0) {
                block = { index: nextIndex++, kind: "reasoning", text: "" };
                blocks.push(block);
                yield { type: "block-start", index: block.index, blockType: "reasoning" };
              }
              block.text = suppressor.text();
              yield { type: "reasoning-delta", index: block.index, text: emit };
            }
          }
        }
        for (const call of delta?.tool_calls ?? []) {
          const wireIndex = call.index ?? 0;
          if (typeof call.id === "string" && call.id.length > 0) toolIds.set(wireIndex, call.id);
          const callId = toolIds.get(wireIndex) ?? `call_${wireIndex}`;
          let block = toolCalls.get(wireIndex);
          if (block === void 0) {
            block = { index: nextIndex++, text: "", callId, announced: false };
            toolCalls.set(wireIndex, block);
          }
          block.callId = callId;
          if (typeof call.function?.name === "string" && call.function.name.length > 0) {
            block.name = call.function.name;
          }
          const fragment = call.function?.arguments ?? "";
          block.text += fragment;
          if (!block.announced) {
            if (!hasUsableToolName(block.name)) continue;
            block.announced = true;
            toolOrder.push(block.index);
            yield { type: "block-start", index: block.index, blockType: "tool-call" };
            yield {
              type: "tool-call-delta",
              index: block.index,
              id: ToolCallId(callId),
              name: restoreToolName(block.name),
              argumentsDelta: block.text
            };
            continue;
          }
          yield {
            type: "tool-call-delta",
            index: block.index,
            id: ToolCallId(callId),
            ...block.name !== void 0 ? { name: restoreToolName(block.name) } : {},
            argumentsDelta: fragment
          };
        }
        if (data.usage) {
          const promptTokens = data.usage.prompt_tokens ?? 0;
          const cachedTokens = data.usage.prompt_tokens_details?.cached_tokens ?? data.usage.prompt_cache_hit_tokens ?? 0;
          const reasoningTokens = data.usage.completion_tokens_details?.reasoning_tokens;
          yield {
            type: "usage",
            usage: {
              // inputTokens 只计**未命中缓存**的部分，命中部分单列
              // cacheReadTokens，否则缓存命中率显示会偏大。
              inputTokens: cachedTokens > 0 ? promptTokens - cachedTokens : promptTokens,
              outputTokens: data.usage.completion_tokens ?? 0,
              ...cachedTokens > 0 ? { cacheReadTokens: cachedTokens } : {},
              ...reasoningTokens !== void 0 && reasoningTokens > 0 ? { reasoningTokens } : {}
            }
          };
        }
      }
      if (loopDetected) {
        await reader.cancel().catch(() => {
        });
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
  let blockCount = 0;
  let emittedProse = "";
  const textBlock = blocks.find((block) => block.kind === "text");
  for (const index of toolOrder) {
    const block = [...toolCalls.values()].find((candidate) => candidate.index === index);
    if (!hasUsableToolName(block.name)) continue;
    blockCount += 1;
    yield {
      type: "block-end",
      index,
      block: {
        type: "tool-call",
        id: ToolCallId(block.callId ?? ""),
        name: restoreToolName(block.name),
        // 仅把「无参数工具下发的空分片」补成 {}；**残缺参数保持原样**，
        // 由 max-tokens 判定触发重试 —— 把残缺 JSON 补成 {} 会伪造出
        // 合法外观，让 harness 报 missing required property 而非重试。
        arguments: isTruncatedArguments(block.text) ? block.text : normalizeToolArguments(block.text)
      }
    };
  }
  if (textBlock !== void 0) {
    let textOut = textBlock.text;
    {
      const split = splitThinkTaggedContent(textBlock.text);
      if (split !== void 0) {
        if (split.reasoning !== "") {
          const existing = blocks.find((candidate) => candidate.kind === "reasoning");
          if (existing === void 0) {
            blocks.push({ index: nextIndex++, kind: "reasoning", text: split.reasoning });
          } else {
            existing.text += split.reasoning;
          }
          suppressor.feed(split.reasoning);
        }
        textOut = split.text;
      }
    }
    textOut = stripBareThinkCloseTagIfEnabled(textOut);
    const truncatedText = proseLoopDetected && proseLoopGuard?.cutAt !== void 0 ? textOut.slice(0, proseLoopGuard.cutAt) : textOut;
    const cleanedText = stripCourseLeakIfEnabled(truncatedText);
    if (cleanedText.trim() !== "") {
      blockCount += 1;
      emittedProse = cleanedText;
      yield { type: "block-end", index: textBlock.index, block: { type: "text", text: cleanedText } };
    } else {
      yield { type: "block-end", index: textBlock.index, block: { type: "text", text: "" } };
    }
  }
  const reasoningBlock = blocks.find((block) => block.kind === "reasoning");
  if (reasoningBlock !== void 0 && reasoningBlock.text.trim() !== "") {
    const suppressedReasoning = suppressor.text();
    const reasoningText = loopDetected && loopGuard?.cutAt !== void 0 ? suppressedReasoning.slice(0, loopGuard.cutAt) : suppressedReasoning;
    const cleanedReasoning = stripCourseLeakIfEnabled(reasoningText);
    if (cleanedReasoning !== "") {
      blockCount += 1;
      yield { type: "block-end", index: reasoningBlock.index, block: { type: "reasoning", text: cleanedReasoning } };
    }
  }
  const argsTruncated = [...toolCalls.values()].some((block) => isTruncatedArguments(block.text));
  const incompleteTools = finishReason === void 0 && toolOrder.length > 0;
  const droppedUnnamedCalls = [...toolCalls.values()].some((block) => !block.announced);
  if (!sawDataFrame) {
    let data;
    try {
      data = JSON.parse(rawJson);
    } catch {
    }
    throwIfModelQueued(data);
    if (typeof data === "object" && data !== null && !Array.isArray(data) && config.isQuotaError?.(data)) {
      throw new LlmError4(`${label}: ${errorDetail(rawJson)}`, "QUOTA_EXCEEDED");
    }
    const snippet = rawSnippet.trim();
    if (snippet.length > 0) {
      throw new LlmError4(
        `${label}: \u54CD\u5E94\u4E0D\u662F SSE\uFF08\u6CA1\u6709\u4EFB\u4F55 data: \u5E27\uFF09\uFF0C\u539F\u6587\u7247\u6BB5\uFF1A${snippet}`,
        "SERVER"
      );
    }
  }
  const truncatedStream = finishReason === void 0 && !streamEnded;
  const proseCutByStopString = finishReason === "stop" && toolOrder.length === 0 && isProseTruncatedByStopString(emittedProse);
  const reasoningLoopIsSoleOutput = loopDetected && emittedProse === "" && toolOrder.length === 0;
  const reason = reasoningLoopIsSoleOutput ? { kind: "error", failure: reasoningLoopFailure(
    loopGuard?.diagnostics,
    config.maxTokens,
    "reasoning"
  ) } : loopDetected ? { kind: "max-tokens" } : finishReason === "length" || incompleteTools || truncatedStream || argsTruncated || proseCutByStopString || droppedUnnamedCalls && toolOrder.length === 0 ? { kind: "max-tokens" } : finishReason === "tool_calls" || toolOrder.length > 0 ? { kind: "tool-calls" } : { kind: "stop" };
  yield { type: "finish", reason: resolveEmptyResponseReason(reason, blockCount) };
}

// vendor/channel-pack/src/model-rate-badge.ts
function formatRate(value) {
  return `x${value.toFixed(2)}`;
}
function modelRateBadge(multiplier, options = {}) {
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier < 0) return void 0;
  const status = options.status ?? "normal";
  if (multiplier === 0 || status === "limited_free") {
    return { text: { en: "Free", zh: "\u514D\u8D39" }, tone: "success" };
  }
  const base = options.baseMultiplier;
  const discounted = status === "discount" && typeof base === "number" && Number.isFinite(base) && base > multiplier;
  const text = formatRate(multiplier);
  return {
    text: options.reference ? { en: `Ref. ${text}`, zh: `\u53C2\u8003 ${text}` } : { en: text, zh: text },
    tone: discounted ? "info" : "neutral"
  };
}

// vendor/channel-pack/src/qoder-adapter.ts
var parseQoderQueueError = parseQueueError;
var qoderQueueDelayMs = queueDelayMs;
function rateLimitedFailure(body, modelId, status) {
  const failure = new LlmError5(
    `qoder: ${errorDetail(body)}`,
    "RATE_LIMIT",
    { status }
  );
  const parsed = parseRateLimitError(body, modelId, status);
  failure.rateLimitResetAtMs = parsed?.resetTimeMs ?? Date.now() + RATE_LIMIT_FALLBACK_MS;
  return failure;
}
function isQuotaExceededError(error) {
  if (error instanceof LlmError5) {
    if (error.code === "QUOTA_EXCEEDED" || error.code === "QUOTA") return true;
  }
  if (error instanceof Error) {
    if (!(error instanceof LlmError5)) return looksLikeBillingError(error.message);
  }
  return false;
}
function isUsableQoderCredential(value) {
  if (value === null || typeof value !== "object") return false;
  const credential = value;
  return typeof credential.access_token === "string" && credential.access_token.length > 0 && (credential.security_oauth_token === void 0 || typeof credential.security_oauth_token === "string") && typeof credential.machine_id === "string" && credential.machine_id.length > 0;
}
var QODER_EFFORT_NAMES = {
  off: "\u5173\u95ED\u601D\u8003",
  minimal: "\u6700\u5C0F",
  low: "\u4F4E",
  medium: "\u4E2D",
  high: "\u9AD8",
  xhigh: "\u6781\u9AD8",
  max: "\u6700\u5927"
};
var UNKNOWN_EFFORT_RANK = 100;
function sortEffortsByStrength(efforts) {
  return efforts.map((id, index) => ({ id, index, rank: reasoningRankOf(id) ?? UNKNOWN_EFFORT_RANK })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ id }) => id);
}
function qoderPrivateEfforts(model) {
  const efforts = [...model.efforts ?? []];
  if (model.supportsDisable === true && !efforts.includes("none")) efforts.push("none");
  return efforts;
}
function qoderEffortsFor(model) {
  return sortEffortsByStrength(uniqueCanonicalEfforts(qoderPrivateEfforts(model)).map((effort) => effort.id));
}
function qoderDefaultEffort(model, efforts = qoderEffortsFor(model)) {
  return defaultModelEffort(efforts, model.defaultEffort === void 0 ? void 0 : canonicalEffortId(model.defaultEffort));
}
function resolveQueueTimeoutMs() {
  const raw = process.env.DSH_QODER_QUEUE_TIMEOUT_MS;
  if (raw === void 0 || raw.length === 0) return 30 * 6e4;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30 * 6e4;
}
var QUEUE_ACCOUNT_MAX_ATTEMPTS = 3;
var QUEUE_ACCOUNT_MAX_WAIT_MS = 2e4;
function isAborted(signal) {
  return signal?.aborted === true;
}
function queueInfoOf(error) {
  return error.queueInfo;
}
function buildQoderTools(tools) {
  if (tools === void 0 || tools.length === 0) return [];
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...tool.description.length > 0 ? { description: tool.description } : {},
      ...tool.parameters === void 0 ? {} : { parameters: tool.parameters }
    }
  }));
}
function qoderContentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((block) => typeof block === "object" && block !== null && block.type === "text").map((block) => String(block.text)).join("");
  }
  return "";
}
function qoderContentParts(content) {
  if (!Array.isArray(content)) return void 0;
  const parts = [];
  let hasImage = false;
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue;
    const block = raw;
    if (block.type === "text") {
      const text = String(block.text ?? "");
      if (text.length > 0) parts.push({ type: "text", text });
      continue;
    }
    if (block.type === "image_url") {
      const url = block.image_url?.url;
      if (typeof url !== "string" || url.length === 0) continue;
      const detail = block.image_url.detail;
      parts.push({
        type: "image_url",
        image_url: {
          url,
          ...typeof detail === "string" && detail.length > 0 ? { detail } : {}
        }
      });
      hasImage = true;
      continue;
    }
  }
  return hasImage ? parts : void 0;
}
function buildQoderHistory(messages) {
  const history = [];
  for (const message of messages) {
    if (typeof message.role !== "string") continue;
    const parts = qoderContentParts(message.content);
    const content = parts === void 0 ? qoderContentText(message.content) : parts;
    const toolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0 ? message.tool_calls : void 0;
    const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : void 0;
    const isEmpty = parts === void 0 ? content.length === 0 : content.length === 0;
    if (isEmpty && toolCalls === void 0 && toolCallId === void 0) continue;
    history.push({
      // ⚠️ 上游不认 `developer` 角色（OpenAI 新角色）：原样发出去会被当成未知
      // role 忽略整条消息（社区插件的同一结论）。折叠为 `system`。
      role: message.role === "developer" ? "system" : message.role,
      content,
      ...toolCalls === void 0 ? {} : { tool_calls: toolCalls },
      ...toolCallId === void 0 ? {} : { tool_call_id: toolCallId }
    });
  }
  return history;
}
function resolveFirstTokenTimeoutMs() {
  return Number.parseInt(process.env.DSH_QODER_SSE_FIRST_TOKEN_TIMEOUT_MS ?? "", 10) || 12e4;
}
function resolveChunkTimeoutMs() {
  return Number.parseInt(process.env.DSH_QODER_SSE_CHUNK_TIMEOUT_MS ?? "", 10) || 12e4;
}
var QoderAdapter = class extends LlmAdapter {
  constructor(options) {
    super();
    this.options = options;
    this.product = options.product ?? QODER;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.fallbackIndex = new Map(
      (this.product.fallbackModels ?? []).map((model) => [model.id, model])
    );
    if (options.cliCatalogFile) {
      this.cliCatalog = readQoderCatalog(options.cliCatalogFile, this.product.fallbackModels);
      if (this.cliCatalog) this.catalogSource = "cached";
    }
  }
  product;
  fetchImpl;
  /** 产品级兜底模型索引（`product.fallbackModels` 的 id → 条目）。 */
  fallbackIndex;
  /** 官方 CLI 拉到的合并目录（null = 尚未成功拉取，listAllModels/listModels 用产品兜底表）。 */
  cliCatalog = null;
  catalogSource = "fallback";
  catalogIssue;
  /**
   * 可中止的休眠；信号中止时立即 resolve（不抛错，由调用方检查 signal）。
   *
   * ⚠️ **必须响应 `signal`**：排队等待最长可达 30 分钟，用户中途取消会话时
   * 不能让 generator 卡在 `setTimeout` 里 —— 那会表现为「点了停止但没反应」。
   */
  async sleep(ms, signal) {
    if (this.options.sleep !== void 0) {
      await this.options.sleep(ms, signal);
      return;
    }
    if (ms <= 0 || signal?.aborted === true) return;
    await new Promise((resolve2) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve2();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve2();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  now() {
    return this.options.now?.() ?? Date.now();
  }
  /**
   * 描述本适配器拥有的 provider 路由。
   *
   * 对入参做防御性归一化：DSH 会强制校验 `info.id === provider`，而模型设置页
   * 会用该 id 计算 `deriveKeyRef(provider)`（内部调 `provider.toUpperCase()`）。
   * 一旦 provider 不是字符串（上游传入 undefined），直接回退到本产品的 id，
   * 避免 `undefined.toUpperCase is not a function` 在客户端炸开。
   */
  providerInfo(provider) {
    const id = typeof provider === "string" && provider.length > 0 ? provider : this.product.id;
    return { id, name: this.product.displayName };
  }
  /**
   * 模型接受的输入模态。
   *
   * 按**模型**判定（兜底表的 `supportsImage`），不是按 provider 一刀切。
   * 未声明时**保守报 text**：宁可少报能力（用户改用文本描述），
   * 也不要报一个服务端不认的模态（请求会失败）。
   *
   * ⚠️ 兜底表是本地估计值，不是远端权威数据 —— 见 `qoder-product.ts` 的说明。
   */
  inputModalitiesFor(model) {
    const override = this.options.accountPool?.modelParamsFor?.(this.product.id, model)?.supportsImage;
    return (override ?? this.modelEntry(model)?.supportsImage) === true ? ["text", "image"] : ["text"];
  }
  modelEntry(id) {
    return this.cliCatalog?.find((model) => model.id === id) ?? this.fallbackIndex.get(id);
  }
  /**
   * 模型目录。
   *
   * **不发任何网络请求**：Qoder 的模型列表端点需要 WASM 签名
   * （`qoder_auth_wasm`），本插件不实现，故恒用产品兜底表。
   * 见设计文档 §2.6 与 `qoder-product.ts` 的 `fallbackModels` 说明。
   */
  /**
   * 完整模型目录（**不应用用户黑名单**），含最终展示名（倍率/免费标记）。
   *
   * 设置页必须渲染被关闭的模型（否则用户无法重新打开），而 `listModels` 会按
   * 黑名单过滤掉它们 —— RPC 层只能凭裸 id 补回，展示名与倍率随之丢失
   * （用户报障：「关闭的就没有显示倍率」）。详见 `model.list` 端点的注释。
   */
  /**
   * 完整模型列表（含能力元数据）。能力字段必须一并返回，理由见 Loomy 的同名方法。
   *
   * ⚠️ Qoder 的能力在兜底表里字段名是 `supportsImage` / `supportsThinking`，
   * `efforts` 只有部分模型有（如 Ultimate 有、Auto 没有）——没有就不写，
   * 界面据此不显示该组。
   */
  /**
   * 当前目录是否来自**真实上游**（官方 CLI 的 `--list-models` 输出），而非产品兜底表。
   *
   * 调用方：`model.list` 据此决定能否按目录剪掉历史遗留的黑名单条目。
   */
  isRemoteCatalog() {
    return this.catalogSource === "remote";
  }
  catalogStatus() {
    return { source: this.catalogSource, issue: this.catalogIssue };
  }
  listAllModels() {
    return (this.cliCatalog ?? this.product.fallbackModels).map((model) => {
      const fallback = this.fallbackIndex.get(model.id);
      return {
        id: model.id,
        name: readableModelName(model.id, qoderDisplayName(model)),
        defaultMaxTokens: defaultModelOutputTokens(model.maxTokens, model.contextWindow),
        rateBadge: qoderRateBadge(model),
        ...model.subscriptionOnly === true || fallback?.subscriptionOnly === true ? { subscriptionOnly: true } : {},
        ...typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {},
        ...typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {},
        efforts: qoderEffortsFor(model),
        defaultEffort: qoderDefaultEffort(model),
        ...typeof model.supportsImage === "boolean" ? { supportsImage: model.supportsImage } : {},
        ...typeof fallback?.stale === "boolean" ? { stale: fallback.stale } : {},
        ...typeof fallback?.staleReason === "string" ? { staleReason: fallback.staleReason } : {}
      };
    });
  }
  /**
   * 手动刷新模型目录 —— **借本机官方 Qoder CLI**（`--list-models`）真拉。
   *
   * Qoder 目录端点要求 WASM 签名（`qoder_auth_wasm`），本插件不重实现；改为
   * spawn 本机已装的官方 CLI（见 `qoder-cli.ts`），解析它的文本表，id 以 CLI
   * 为准、能力/倍率属性与产品策展表合并。CLI 未登录/不存在/超时/空表 → 回落
   * 产品兜底表 `source:'fallback'`（界面显示「离线兜底」+ 提示先登录官方 CLI）。
   *
   * ⚠️ opt-in：客户端 autoRefreshCatalog 对 qodercn 跳过 silent 补拉，故本方法
   * 只在用户**手动点「刷新目录」**时被调到 —— 第三方驱动官方组件的显式同意。
   */
  async refreshRemoteModels() {
    const direct = await this.fetchDirectCatalog();
    if (direct !== null) {
      this.catalogIssue = void 0;
      this.cliCatalog = direct;
      this.catalogSource = "remote";
      if (this.options.cliCatalogFile) await saveQoderCatalog(this.options.cliCatalogFile, direct).catch(() => {
      });
      return { source: this.catalogSource, count: direct.length, catalog: direct };
    }
    const { catalog, ...result } = await refreshQoderCatalog(
      this.options.runQoderCli ?? defaultRunQoderCli,
      this.product.fallbackModels ?? []
    );
    this.catalogIssue = result.issue;
    if (catalog) {
      this.cliCatalog = catalog;
      this.catalogSource = "remote";
      if (this.options.cliCatalogFile) await saveQoderCatalog(this.options.cliCatalogFile, catalog).catch(() => {
      });
    } else {
      this.catalogSource = this.cliCatalog ? "cached" : "fallback";
    }
    return { ...result, source: this.catalogSource, count: this.cliCatalog?.length ?? result.count };
  }
  /**
   * 直连上游目录接口取模型表；任一环节不可用返回 `null`（交给 CLI 回退）。
   *
   * 凭据取当前可用账号的 `uid` + `security_oauth_token`（签名身份）；
   * **凭据不进日志**。
   */
  async fetchDirectCatalog() {
    try {
      const credential = await this.options.resolveCredential(void 0);
      if (credential === void 0) return null;
      const uid = credential.uid ?? "";
      const securityOauthToken = credential.security_oauth_token ?? credential.access_token ?? "";
      if (!uid || !securityOauthToken) return null;
      const url = `${this.product.encryptedInferBase.replace(/\/+$/, "")}${QODER_MODEL_LIST_PATH}`;
      const session = newCosySession({ uid, securityOauthToken, refreshToken: credential.refresh_token });
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        headers: cosyHeaders(session, url, ""),
        signal: AbortSignal.timeout(2e4)
      });
      if (!response.ok) return null;
      return parseQoderModelList(await response.json().catch(() => null));
    } catch {
      return null;
    }
  }
  async listModels(_provider) {
    if (!await providerCatalogVisible(this.options.accountPool, this.product.id)) return [];
    const disabled = this.options.accountPool?.disabledModelsFor?.(this.product.id);
    const overrides = this.options.accountPool?.listDisabledModels?.(this.product.id) ?? {};
    const source = this.cliCatalog ?? this.product.fallbackModels;
    const exclusions = modelRecommendationExclusions(this.listAllModels(), this.product.id);
    const listed = source.filter((model) => disabled?.has(model.id) !== true && !isModelDisabled({ id: model.id, stale: this.fallbackIndex.get(model.id)?.stale }, overrides, exclusions));
    return listed.map((model) => {
      const badge = qoderRateBadge(model);
      return {
        provider: this.product.id,
        id: model.id,
        // 倍率拼进 `name`（**不是** `description`）：composer 的模型切换菜单
        // 只渲染 name，description 仅用于 /model 弹窗。见 qoderDisplayName。
        name: readableModelName(model.id, qoderDisplayName(model)),
        inputModalities: this.inputModalitiesFor(model.id),
        ...badge === void 0 ? {} : { badge }
      };
    });
  }
  /**
   * 解析模型元信息。
   *
   * ⚠️ **`reasoning` 是「思考强度」选择器出现在模型菜单里的唯一入口**
   * （composer 读 `resolveModel().reasoning`）。此前本适配器**只声明了
   * `context`，从不声明 `reasoning`** → 中国版/国际版全都看不到档位选择器，
   * 尽管目录早已下发 `thinking_config`（用户报障「qoder中国版可以设置思考档位，
   * 我们应该按照他的设置给出可设置的档位选择」）。
   */
  async resolveModel(provider, model, _signal) {
    const entry = this.modelEntry(model);
    const resolved = {
      provider,
      id: model,
      name: readableModelName(model, entry?.name),
      inputModalities: this.inputModalitiesFor(model),
      defaultMaxTokens: defaultModelOutputTokens(entry?.maxTokens, entry?.contextWindow)
    };
    if (entry && entry.contextWindow > 0) resolved.context = { contextWindow: entry.contextWindow };
    if (entry !== void 0) {
      const efforts = qoderEffortsFor(entry);
      if (efforts.length > 0) {
        const fallback = qoderDefaultEffort(entry, efforts);
        resolved.reasoning = {
          efforts: efforts.map((id) => ({
            id: ReasoningEffortId(id),
            name: QODER_EFFORT_NAMES[id] ?? id
          })),
          // ⚠️ `defaultEffort` 必须落在 `efforts` 内 —— DSH 会直接拿它发请求，
          // 给一个不存在的档位会抛 `UNSUPPORTED_REASONING_EFFORT`
          // （同 `trae-adapter.ts` 的教训）。
          ...fallback !== void 0 && efforts.includes(fallback) ? { defaultEffort: ReasoningEffortId(fallback) } : {}
        };
      }
    }
    return resolved;
  }
  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options)
    };
  }
  async *stream(options) {
    const imageRefs = /* @__PURE__ */ new Map();
    for (const message of options.messages) {
      if (Array.isArray(message.content)) collectImages(message.content, imageRefs);
    }
    let imageUrls;
    if (imageRefs.size > 0) {
      if (!this.inputModalitiesFor(options.model).includes("image")) {
        throw new LlmError5(
          `qoder: \u6A21\u578B "${options.model}" \u4E0D\u652F\u6301\u56FE\u7247\u8F93\u5165`,
          "UNSUPPORTED_CONTENT"
        );
      }
      if (this.options.readImage === void 0) {
        throw new LlmError5("qoder: \u56FE\u7247\u8F93\u5165\u9700\u8981\u9644\u4EF6\u670D\u52A1", "UNSUPPORTED_CONTENT");
      }
      imageUrls = /* @__PURE__ */ new Map();
      const readImage = this.options.readImage;
      for (const [id, ref] of imageRefs) {
        const projected = await projectRequestImage(ref, {
          readImageRequest: this.options.readImageRequest,
          pixelBudget: this.product.imagePixelBudget,
          maxBytes: this.product.imageMaxBytes
        });
        const image = projected ?? await readImage(ref);
        if (image === void 0) continue;
        imageUrls.set(id, `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}`);
      }
    }
    let initialCredential = await this.options.resolveCredential(options.model);
    let activeAccountId = initialCredential === void 0 ? void 0 : await this.accountIdForCredential(initialCredential);
    if (initialCredential === void 0 || isQoderExpired(initialCredential)) {
      initialCredential = await this.refreshCredential(options.model, activeAccountId);
      if (activeAccountId === void 0 && initialCredential !== void 0) activeAccountId = await this.accountIdForCredential(initialCredential);
    }
    if (initialCredential === void 0 || initialCredential.access_token.length === 0) {
      throw new LlmError5("qoder: no usable credential; log in first", "MISSING_CREDENTIAL");
    }
    let credential = await this.ensureUid(initialCredential);
    const messages = serializeMessages(options.messages, imageUrls);
    const systemText = options.system !== void 0 && options.system.length > 0 ? options.system : void 0;
    const userMessages = messages.filter((m) => m.role === "user");
    const lastUser = userMessages.at(-1);
    const userText = typeof lastUser?.content === "string" ? lastUser.content : Array.isArray(lastUser?.content) ? lastUser.content.filter((block) => block.type === "text").map((block) => String(block.text ?? "")).join("") : "";
    const history = buildQoderHistory(messages);
    const tools = buildQoderTools(options.tools);
    const fallback = this.modelEntry(options.model);
    const maxTokens = options.maxTokens ?? defaultModelOutputTokens(fallback?.maxTokens, fallback?.contextWindow);
    const reasoningEffort = options.reasoningEffort ?? (fallback && qoderDefaultEffort(fallback));
    const buildRequest = async (c) => {
      const client = await QoderEncryptedInfer.create({
        user: {
          uid: c.uid,
          securityOauthToken: c.security_oauth_token ?? c.access_token
        },
        machineId: c.machine_id,
        metadata: { ...this.product.clientMetadata },
        host: this.product.encryptedInferBase
      });
      return client.prepareInfer({
        modelKey: options.model,
        userText,
        ...systemText !== void 0 ? { systemText } : {},
        // ⚠️ 对齐官方 `dQ.isEnabled(model, config)`：`支持思考且未关闭`，
        // **不是**只看模型能力。用户把档位切到「关闭思考」时仍发
        // `is_reasoning: true` 会让上游按「要思考」解析、却又没有预算
        // （旧实现连 `reasoning_budget_tokens` 都不发），回包因此没有任何
        // 思考内容 —— 用户报障「思考设置无效」。
        isReasoning: reasoningEffort === void 0 ? fallback?.supportsThinking === true : reasoningEffort !== "off" && fallback?.supportsThinking !== false,
        history,
        // 工具定义：这是模型**唯一**能学到函数 schema 的通道，
        // 缺了它模型只能用正文 XML 臆造调用（真实缺陷）。
        tools,
        maxTokens,
        ...reasoningEffort !== void 0 ? { reasoningEffort: privateEffortFor(reasoningEffort, fallback ? qoderPrivateEfforts(fallback) : void 0) ?? reasoningEffort } : {},
        ...this.inputModalitiesFor(options.model).includes("image") ? { isVl: true } : fallback?.supportsImage === false ? { isVl: false } : {},
        // 官方 `model_config` 的 display_name / max_input_tokens 必须带上。
        ...fallback?.name !== void 0 ? { displayName: fallback.name } : {},
        ...fallback && fallback.contextWindow > 0 ? { maxInputTokens: fallback.contextWindow } : {},
        // ⚠️ **`business` 必填**，否则服务端把请求路由到错误的后端节点。
        //
        // 实测（2026-09-20）：不带 `business` 时 `qfmodel`（Qwen3.8-Flash）
        // 恒落到故障节点 `oa_qwen-plus-2025-04-28` 并返回
        // `[FAIL]node:... msg:Execution failed`；补上 `business` 后立即正常
        // （其余模型如 `qmodel_38max` 恰好不受影响，故早期排查易误判为
        // 「该模型服务端故障」）。`agent` / `sec_scan` 等取值都能通。
        //
        // 源码依据：`MPi(A) { return A === 'sec_scan' ? 'security' : 'default' }`
        // —— 服务端按 `business.type` 选路由池，缺字段会走异常分支。
        business: { type: "agent" }
      });
    };
    const queueStartedAt = this.now();
    const queueTimeoutMs = resolveQueueTimeoutMs();
    const queueDeadline = queueStartedAt + queueTimeoutMs;
    let queueAttempts = 0;
    let authRefreshed = false;
    let duplicateRetried = false;
    let response;
    const triedAccounts = /* @__PURE__ */ new Set();
    if (activeAccountId !== void 0 && activeAccountId.length > 0) {
      triedAccounts.add(activeAccountId);
    }
    const queueTriedAccounts = /* @__PURE__ */ new Set();
    let queueActiveAccountId;
    let accountQueueAttempts = 0;
    let accountQueueStartedAt;
    let accountQueueLastCheckAt;
    let queueRotationNoticeEmitted = false;
    let emittedAnyChunk = false;
    const retryQueuedRequest = async (queueInfo) => {
      const attempts = ++queueAttempts;
      this.assertQueueCanContinue(attempts, queueDeadline, options);
      accountQueueAttempts += 1;
      const now = this.now();
      accountQueueStartedAt ??= now;
      const queueWaitMs = now - accountQueueStartedAt;
      const queueElapsedMs = Math.max(0, now - queueStartedAt);
      const rotationDue = accountQueueAttempts >= QUEUE_ACCOUNT_MAX_ATTEMPTS || queueElapsedMs >= QUEUE_ACCOUNT_MAX_WAIT_MS && accountQueueLastCheckAt === void 0 || accountQueueLastCheckAt !== void 0 && now - accountQueueLastCheckAt >= QUEUE_ACCOUNT_MAX_WAIT_MS;
      if (rotationDue) {
        accountQueueAttempts = 0;
        accountQueueLastCheckAt = now;
        let switched;
        try {
          const resolvedQueueId = await this.queueAccountIdForCredential(credential);
          if (resolvedQueueId !== void 0 && resolvedQueueId.length > 0) {
            queueActiveAccountId = resolvedQueueId;
            queueTriedAccounts.add(resolvedQueueId);
          }
          switched = await this.switchAccountOnQueue(
            options,
            queueTriedAccounts,
            queueActiveAccountId,
            credential
          );
        } catch (error) {
          if (isAborted(options.signal)) throw new LlmError5("qoder: \u6392\u961F\u7B49\u5F85\u671F\u95F4\u8BF7\u6C42\u5DF2\u53D6\u6D88", "QUEUE");
          if (error instanceof LlmError5 && error.code === "QUEUE") throw error;
          if (!queueRotationNoticeEmitted) {
            queueRotationNoticeEmitted = true;
            try {
              this.options.onQueueRotationFailure?.(error);
            } catch {
            }
          }
        }
        this.assertQueueCanContinue(attempts, queueDeadline, options);
        if (switched !== void 0) {
          credential = switched.credential;
          queueActiveAccountId = switched.accountId;
          activeAccountId = switched.accountId;
          triedAccounts.add(switched.accountId);
          authRefreshed = false;
          accountQueueAttempts = 0;
          accountQueueStartedAt = void 0;
          accountQueueLastCheckAt = void 0;
          queueRotationNoticeEmitted = false;
          try {
            this.options.onQueueAccountSwitch?.();
          } catch {
          }
          return;
        }
        if (!queueRotationNoticeEmitted) {
          queueRotationNoticeEmitted = true;
          try {
            this.options.onQueueRotationFailure?.(void 0);
          } catch {
          }
        }
      }
      await this.waitForQueue(queueInfo, attempts, queueDeadline, options);
    };
    for (; ; ) {
      response = await this.sendEncrypted(await buildRequest(credential), options);
      if (!response.ok && (response.status === 401 || response.status === 403)) {
        const errorText = await response.text().catch(() => "");
        const queueInfo = parseQoderQueueError(errorText);
        if (queueInfo !== void 0) {
          await retryQueuedRequest(queueInfo);
          continue;
        }
        if (isBillingBusinessCode(response.status) || looksLikeBillingError(errorText)) {
          const switched = await this.switchAccountOnQuota(options, triedAccounts, activeAccountId);
          if (switched !== void 0) {
            credential = switched.credential;
            activeAccountId = switched.accountId;
            authRefreshed = false;
            accountQueueAttempts = 0;
            accountQueueStartedAt = void 0;
            accountQueueLastCheckAt = void 0;
            continue;
          }
          throw new LlmError5(`qoder: ${errorDetail(errorText)}`, "QUOTA_EXCEEDED", { status: response.status });
        }
        if (!authRefreshed) {
          authRefreshed = true;
          const refreshed = await this.refreshCredential(options.model, activeAccountId);
          if (refreshed === void 0 || refreshed.access_token.length === 0) {
            throw new LlmError5("qoder: credential expired and refresh failed", "AUTH", { status: response.status });
          }
          credential = await this.ensureUid(refreshed);
          continue;
        }
        throw new LlmError5(`qoder: ${errorDetail(errorText)}`, httpErrorCode(response.status), { status: response.status });
      }
      if (!response.ok && response.status === 409 && !duplicateRetried) {
        duplicateRetried = true;
        continue;
      }
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (isRateLimited(errorText, response.status)) {
          throw rateLimitedFailure(errorText, options.model, response.status);
        }
        throw new LlmError5(`qoder: ${errorDetail(errorText)}`, httpErrorCode(response.status), { status: response.status });
      }
      const inner = consumeOpenAiSse(
        unwrapQoderEnvelopeStream(response, "qoder"),
        { signal: options.signal },
        {
          label: "qoder",
          firstTokenTimeoutMs: resolveFirstTokenTimeoutMs(),
          chunkTimeoutMs: resolveChunkTimeoutMs(),
          maxTokens
        }
      );
      const iterator = inner[Symbol.asyncIterator]();
      let queued = false;
      for (; ; ) {
        let step;
        try {
          step = await iterator.next();
        } catch (error) {
          if (error instanceof ModelQueuedError) {
            if (emittedAnyChunk) throw error;
            await retryQueuedRequest(queueInfoOf(error));
            queued = true;
            break;
          }
          if (isQuotaExceededError(error)) {
            const switched = await this.switchAccountOnQuota(options, triedAccounts, activeAccountId);
            if (switched !== void 0) {
              credential = switched.credential;
              activeAccountId = switched.accountId;
              authRefreshed = false;
              accountQueueAttempts = 0;
              accountQueueStartedAt = void 0;
              accountQueueLastCheckAt = void 0;
              queued = true;
              break;
            }
            throw error;
          }
          if (error instanceof LlmError5 && error.code === "RATE_LIMIT") {
            const switched = await this.switchAccountOnRateLimit(options, triedAccounts, activeAccountId, error);
            if (switched !== void 0) {
              credential = switched.credential;
              activeAccountId = switched.accountId;
              authRefreshed = false;
              accountQueueAttempts = 0;
              accountQueueStartedAt = void 0;
              accountQueueLastCheckAt = void 0;
              queued = true;
              break;
            }
            throw error;
          }
          throw error;
        }
        if (step.done === true) break;
        emittedAnyChunk = true;
        yield step.value;
      }
      if (queued) continue;
      return;
    }
  }
  /**
   * 额度受限时：**标记当前账号该模型受限到 UTC+8 当日 24:00，然后切下一个账号**。
   *
   * ## 用户要求（2026-09-27）
   *
   * 它们的错误文案里**带重置时间**（`parseRateLimitError` 从中解析）；
   * Qoder **不带** —— 故这里用 {@link nextUtc8DayStartMs} **自己算**
   * 「UTC+8 当日 24:00」。**不能**复用 `parseRateLimitError`：它会因解析不到
   * 时间而退回「1 小时后」（`Date.now() + 3_600_000`），那对**按自然日**结算的
   * 额度是错的 —— 会让标记过早失效，用户 1 小时后再撞一次同样的墙。
   *
   * @param activeAccountId - **当前正在使用的**账号 id（见下）。
   * @returns 新凭据；无可用账号时 `undefined`（调用方如实抛出原错误）。
   */
  async switchAccountOnQuota(options, tried, activeAccountId) {
    const pool = this.options.accountPool;
    if (pool === void 0) return void 0;
    if (activeAccountId !== void 0 && activeAccountId.length > 0) {
      await pool.updateModelRateLimit(activeAccountId, options.model, nextUtc8DayStartMs());
      tried.add(activeAccountId);
    }
    const next = await pool.getAvailableAccount(this.product.id, options.model, tried);
    if (next === null || tried.has(next.entry.id)) return void 0;
    tried.add(next.entry.id);
    const credential = next.credential;
    return { credential: await this.ensureUid(credential), accountId: next.entry.id };
  }
  async accountIdForCredential(credential) {
    return this.options.queueAccountIdForCredential !== void 0 ? await this.options.queueAccountIdForCredential(credential) : this.options.currentAccountId?.();
  }
  async refreshCredential(model, accountId) {
    await this.options.refresh(accountId);
    return accountId !== void 0 && this.options.accountPool !== void 0 ? await this.options.accountPool.resolveCredentialForAccount(accountId) : await this.options.resolveCredential(model);
  }
  /** 排队时反查本次凭据所属账号；本地存储短暂失败不能中断请求。 */
  async queueAccountIdForCredential(credential) {
    try {
      return await this.options.queueAccountIdForCredential?.(credential);
    } catch {
      return void 0;
    }
  }
  /**
   * 频率限制时：**标记当前账号该模型受限到上游声明的解禁时刻，然后切下一个账号**。
   *
   * 与 {@link switchAccountOnQuota} 的区别只在解禁时刻的来源：额度按 UTC+8 自然日
   * 结算，频率限制由上游声明（解析不到用 1 小时兜底）。不复用前者 —— 把频率限制
   * 记成「今天 24:00」会让账号被过度冷藏，反而浪费可用额度。
   *
   * @param failure - 触发换号的那个错误（携带 `rateLimitResetAtMs`）。
   */
  async switchAccountOnRateLimit(options, tried, activeAccountId, failure) {
    const pool = this.options.accountPool;
    if (pool === void 0) return void 0;
    const resetAt = failure.rateLimitResetAtMs;
    if (activeAccountId !== void 0 && activeAccountId.length > 0) {
      await pool.updateModelRateLimit(
        activeAccountId,
        options.model,
        resetAt ?? Date.now() + RATE_LIMIT_FALLBACK_MS
      );
      tried.add(activeAccountId);
    }
    const next = await pool.getAvailableAccount(this.product.id, options.model, tried);
    if (next === null || tried.has(next.entry.id)) return void 0;
    tried.add(next.entry.id);
    const credential = next.credential;
    return { credential: await this.ensureUid(credential), accountId: next.entry.id };
  }
  /**
   * 排队持续没有进展时换到另一个账号。
   *
   * 只跳过当前请求已试过的账号，不写 `modelRateLimits`：排队是临时服务状态，
   * 不代表账号额度耗尽。无法补齐候选账号凭据时跳过该账号，继续找下一个。
   */
  async switchAccountOnQueue(options, tried, activeAccountId, activeCredential) {
    const pool = this.options.accountPool;
    if (pool === void 0) return void 0;
    if (activeAccountId !== void 0 && activeAccountId.length > 0) tried.add(activeAccountId);
    for (; ; ) {
      const next = await pool.getAvailableAccount(this.product.id, options.model, tried);
      if (next === null || tried.has(next.entry.id)) return void 0;
      tried.add(next.entry.id);
      try {
        const candidate = next.credential;
        if (!isUsableQoderCredential(candidate)) continue;
        if (candidate.access_token === activeCredential.access_token) continue;
        const credential = await this.ensureUid(candidate);
        return { credential, accountId: next.entry.id };
      } catch (error) {
        if (error instanceof LlmError5 && error.code === "MISSING_CREDENTIAL") continue;
        throw error;
      }
    }
  }
  /**
   * 排队等待（HTTP 层与 SSE 层**共用**）。
   *
   * 两处形态必须走同一套判据，否则会再次出现「只修了一条路径」的缺陷。
   */
  async waitForQueue(queueInfo, attempts, deadline, options) {
    this.assertQueueCanContinue(attempts, deadline, options);
    const waitMs = qoderQueueDelayMs(queueInfo);
    const requestedWaitMs = Math.max(100, waitMs ?? 1e3);
    const remainingMs = Math.max(0, deadline - this.now());
    await this.sleep(Math.min(requestedWaitMs, remainingMs), options.signal);
    if (isAborted(options.signal)) {
      throw new LlmError5("qoder: \u6392\u961F\u7B49\u5F85\u671F\u95F4\u8BF7\u6C42\u5DF2\u53D6\u6D88", "QUEUE");
    }
    if (this.now() >= deadline) {
      throw new LlmError5("qoder: \u6392\u961F\u7B49\u5F85\u8D85\u65F6", "QUEUE");
    }
  }
  /** 对总等待时长、总尝试次数和用户取消做统一检查。 */
  assertQueueCanContinue(attempts, deadline, options) {
    if (this.now() >= deadline) {
      throw new LlmError5("qoder: \u6392\u961F\u7B49\u5F85\u8D85\u65F6", "QUEUE");
    }
    if (attempts > QUEUE_MAX_ATTEMPTS) {
      throw new LlmError5(
        `qoder: \u6392\u961F\u91CD\u8BD5\u8D85\u8FC7\u4E0A\u9650\uFF08${QUEUE_MAX_ATTEMPTS} \u6B21\uFF09`,
        "QUEUE"
      );
    }
    if (isAborted(options.signal)) {
      throw new LlmError5("qoder: \u6392\u961F\u7B49\u5F85\u671F\u95F4\u8BF7\u6C42\u5DF2\u53D6\u6D88", "QUEUE");
    }
  }
  /**
   * 确保凭据带 **`uid`**（加密推理必需），必要时经注入钩子补齐。
   *
   * ⚠️ 缺 uid 时**不能静默用空串发请求** —— 那样 WASM 会产出签名无效的
   * 请求，服务端回 `Signature invalid (101)`，用户看到的是「签名错误」
   * 而非「凭据不完整」，极难定位（真实缺陷）。这里宁可明确报错。
   */
  async ensureUid(credential) {
    if (credential.uid !== void 0 && credential.uid.length > 0) return credential;
    const patched = await this.options.resolveUid?.(credential);
    if (patched?.uid !== void 0 && patched.uid.length > 0) return patched;
    throw new LlmError5(
      "qoder: \u51ED\u636E\u7F3A\u5C11 uid\uFF0C\u52A0\u5BC6\u63A8\u7406\u65E0\u6CD5\u7B7E\u540D\uFF08\u8BF7\u91CD\u65B0\u767B\u5F55\u8BE5\u8D26\u53F7\uFF09",
      "MISSING_CREDENTIAL"
    );
  }
  /** 发送一次**加密**推理请求（`agent_chat_generation`）。 */
  async sendEncrypted(request, options) {
    const headers = new Headers(request.headers);
    headers.set("Accept", "text/event-stream");
    try {
      return await this.fetchImpl(request.url, {
        method: "POST",
        headers,
        body: request.body,
        signal: options.signal
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (isTransportError(error)) {
        throw new LlmError5(
          `qoder: transport error: ${error instanceof Error ? error.message : String(error)}`,
          "TRANSPORT",
          { cause: error }
        );
      }
      throw error;
    }
  }
};
function promotionActiveNow(promotion, now) {
  const { windowStart, windowEnd } = promotion;
  if (windowStart === void 0 || windowEnd === void 0) return promotion.active;
  const toMinutes = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (m === null) return void 0;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h < 24 && min < 60 ? h * 60 + min : void 0;
  };
  const start = toMinutes(windowStart);
  const end = toMinutes(windowEnd);
  if (start === void 0 || end === void 0) return promotion.active;
  const utc8 = new Date(now.getTime() + 8 * 36e5);
  const minutes = utc8.getUTCHours() * 60 + utc8.getUTCMinutes();
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
function qoderDisplayName(model) {
  return model.name;
}
function qoderRate(model, now) {
  const promo = model.promotion;
  const before = promo?.beforePromotionPriceFactor;
  const discount = promo?.discountFactor;
  const hasPromo = promo !== void 0 && before !== void 0 && discount !== void 0;
  const active = hasPromo && promotionActiveNow(promo, now);
  if (model.priceFactor === 0) return { kind: "free" };
  if (hasPromo && active) {
    return { kind: "discount", before, effective: Number((before * discount).toFixed(4)) };
  }
  return { kind: "flat", multiplier: hasPromo ? before : model.priceFactor };
}
function qoderRateBadge(model, now = /* @__PURE__ */ new Date()) {
  const rate = qoderRate(model, now);
  if (rate.kind === "free") return modelRateBadge(0);
  if (rate.kind === "discount") {
    return modelRateBadge(rate.effective, { status: "discount", baseMultiplier: rate.before });
  }
  return modelRateBadge(rate.multiplier, { reference: true });
}
function registerQoderLlm(ctx, options) {
  const product = options.product ?? QODER;
  const adapter = new QoderAdapter(options);
  registerAdapterIdempotent(ctx.llm, [product.id], adapter);
  return adapter;
}

// vendor/channel-pack/src/queue-rotation.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { LlmError as LlmError6 } from "@deepseek-ai/dsh-llm";
var requests = new AsyncLocalStorage();
function wait(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve2, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve2();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function withQueueAccountRotation(provider, options, create, timing = {}) {
  const now = timing.now ?? Date.now;
  const sleep2 = timing.sleep ?? wait;
  const active = () => {
    const request = requests.getStore();
    return request?.owner === options ? request : void 0;
  };
  const remember = (request, account) => {
    request.account = account;
    request.tried.add(account.entry.id);
    reportLedgerAccount(provider, account.entry.id);
  };
  const scoped = { ...options };
  const pool = options.accountPool;
  if (pool !== void 0) {
    scoped.accountPool = new Proxy(pool, {
      get(target, prop) {
        if (prop === "getAvailableAccount") {
          return async (id, model, excluded) => {
            const request = active();
            const relevant = request !== void 0 && id === provider && model === request.model;
            const skipped = relevant ? /* @__PURE__ */ new Set([...request.tried, ...excluded ?? []]) : excluded;
            const account = await target.getAvailableAccount(id, model, skipped);
            if (account !== null && relevant) remember(request, account);
            return account;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    if (options.nextAccount !== void 0) {
      scoped.nextAccount = async (model, tried) => {
        const request = active();
        const relevant = request !== void 0 && model === request.model;
        const next = await options.nextAccount(model, relevant ? /* @__PURE__ */ new Set([...tried, ...request.tried]) : tried);
        if (next !== void 0 && relevant) {
          const entry = pool.listAccountsByProvider(provider).find((account) => account.id === next.accountId);
          if (entry !== void 0) remember(request, { entry, credential: next.credential });
        }
        return next;
      };
    }
    if (options.resolveCredential !== void 0) {
      scoped.resolveCredential = async (model) => {
        const request = active();
        if (request?.account !== void 0) {
          const others = new Set(pool.listAccountsByProvider(provider).filter((account) => account.id !== request.account.entry.id).map((account) => account.id));
          if (options.nextAccount !== void 0) {
            const next2 = await options.nextAccount(request.model, others) ?? await options.nextAccount(request.model, request.tried);
            if (next2 === void 0) {
              throw new LlmError6(`${provider}: \u5F53\u524D\u8D26\u53F7\u4E0D\u53EF\u7528\u6216\u65E0\u6CD5\u786E\u8BA4\u4F59\u989D\uFF0C\u4E14\u6CA1\u6709\u7B26\u5408\u6E20\u9053\u7B56\u7565\u7684\u5907\u7528\u8D26\u53F7`, "QUEUE");
            }
            const entry = pool.listAccountsByProvider(provider).find((account) => account.id === next2.accountId && account.enabled && !((account.modelRateLimits?.[request.model] ?? 0) > Date.now()));
            if (entry === void 0) throw new LlmError6(`${provider}: \u5F53\u524D\u8BF7\u6C42\u7684\u8D26\u53F7\u5DF2\u79FB\u9664\u3001\u505C\u7528\u6216\u53D7\u9650`, "QUEUE");
            remember(request, { entry, credential: next2.credential });
            return next2.credential;
          }
          const next = await pool.getAvailableAccount(provider, request.model, others) ?? await pool.getAvailableAccount(provider, request.model, request.tried);
          if (next === null) throw new LlmError6(`${provider}: \u5F53\u524D\u8D26\u53F7\u4E0D\u53EF\u7528\uFF0C\u4E14\u6CA1\u6709\u53EF\u7528\u7684\u5907\u7528\u8D26\u53F7`, "QUEUE");
          remember(request, next);
          return next.credential;
        }
        const credential = await options.resolveCredential(model);
        if (request !== void 0 && credential !== null && typeof credential === "object") {
          const field = "access_token";
          const token = credential[field];
          if (typeof token === "string" && token.length > 0) {
            const id = await pool.findAccountIdByIdentityField(provider, field, token).catch(() => "");
            const entry = pool.listAccountsByProvider(provider).find((account) => account.id === id && account.enabled);
            if (entry !== void 0) remember(request, { entry, credential });
          }
        }
        return credential;
      };
    }
    if (options.currentAccountId !== void 0) {
      scoped.currentAccountId = () => active()?.account?.entry.id ?? options.currentAccountId();
    }
  }
  if (options.refresh !== void 0) {
    scoped.refresh = async (accountId, reason) => {
      const request = active();
      const id = accountId ?? request?.account?.entry.id;
      if (request !== void 0) {
        const budget = reason === "auth" ? request.authRefreshes : request.credentialRefreshes;
        if (budget.has(id)) throw new LlmError6(`${provider}: \u5F53\u524D\u8D26\u53F7\u5DF2\u5C1D\u8BD5${reason === "auth" ? "\u8BA4\u8BC1\u7EED\u671F" : "\u51ED\u636E\u5237\u65B0"}\uFF0C\u505C\u6B62\u91CD\u590D\u5237\u65B0`, "AUTH");
        budget.add(id);
      }
      return options.refresh(id, reason);
    };
  }
  const adapter = create(scoped);
  const stream = async function* (input, open) {
    const { model, signal } = input;
    const request = { owner: options, provider, model, tried: /* @__PURE__ */ new Set(), credentialRefreshes: /* @__PURE__ */ new Set(), authRefreshes: /* @__PURE__ */ new Set() };
    const deadline = now() + 30 * 6e4;
    let attempts = 0, queued = 0, since;
    let delivered = false;
    for (; ; ) {
      signal?.throwIfAborted();
      if (now() >= deadline) throw new LlmError6(`${provider}: \u6392\u961F\u7B49\u5F85\u8D85\u65F6`, "QUEUE");
      const iterator = open()[Symbol.asyncIterator]();
      try {
        for (; ; ) {
          const step = await requests.run(request, () => iterator.next());
          if (step.done) return;
          delivered = true;
          yield step.value;
        }
      } catch (error) {
        if (!(error instanceof ModelQueuedError) || delivered) throw error;
        signal?.throwIfAborted();
        if (++attempts > QUEUE_MAX_ATTEMPTS || now() >= deadline) {
          throw new LlmError6(`${provider}: \u6392\u961F\u91CD\u8BD5\u6B21\u6570\u6216\u7B49\u5F85\u65F6\u95F4\u5DF2\u7528\u5C3D`, "QUEUE");
        }
        queued += 1;
        since ??= now();
        if (queued >= 3 || now() - since >= 2e4) {
          queued = 0;
          since = now();
          if (scoped.nextAccount !== void 0) {
            const next = await requests.run(request, () => scoped.nextAccount(model, request.tried));
            if (next !== void 0) continue;
          } else if (pool !== void 0) {
            const next = await pool.getAvailableAccount(provider, model, request.tried);
            if (next !== null) {
              remember(request, next);
              continue;
            }
          }
        }
        await sleep2(Math.min(Math.max(100, error.retryAfterMs ?? 1e3), QUEUE_MAX_DELAY_MS, deadline - now()), signal);
      } finally {
        await requests.run(request, () => iterator.return?.());
      }
    }
  };
  return new Proxy(adapter, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === "stream" && typeof value === "function") {
        return (input) => stream(input, () => value.call(target, input));
      }
      if (prop === "prepareCall" && typeof value === "function") {
        return async (...args) => {
          const call = await value.apply(target, args);
          return { ...call, stream: (input) => stream(input, () => call.stream(input)) };
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

// vendor/channel-pack/src/trae-adapter.ts
import { LlmAdapter as LlmAdapter2, LlmError as LlmError7, ReasoningEffortId as ReasoningEffortId2 } from "@deepseek-ai/dsh-llm";
import { ToolCallId as ToolCallId2 } from "@deepseek-ai/dsh-llm";

// lib/catalog-cache.js
import { randomUUID as randomUUID3 } from "node:crypto";
import { readFileSync as readFileSync7 } from "node:fs";
import { mkdir as mkdir2, rename as rename2, unlink as unlink2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname3 } from "node:path";
function readCatalogCache(file, scope = "") {
  if (!file) return void 0;
  try {
    const saved = JSON.parse(readFileSync7(file, "utf8"));
    if (saved.version !== 1 || saved.scope !== scope || !Array.isArray(saved.models) || !saved.models.length || saved.models.length > 512 || saved.models.some((model) => typeof model?.id !== "string" || !model.id || model.id.length > 256 || typeof model.name !== "string" || !model.name || model.name.length > 512)) return void 0;
    return saved.models;
  } catch {
    return void 0;
  }
}
async function saveCatalogCache(file, models, scope = "") {
  if (!file || !models.length || models.length > 512) return;
  const temp = file + "." + randomUUID3() + ".tmp";
  try {
    await mkdir2(dirname3(file), { recursive: true, mode: 448 });
    await writeFile2(temp, JSON.stringify({ version: 1, scope, models }), { mode: 384 });
    await rename2(temp, file);
  } finally {
    await unlink2(temp).catch(() => {
    });
  }
}

// vendor/channel-pack/src/remote-catalog-gate.ts
var REMOTE_CATALOG_COOLDOWN_MS = 3e4;
var RemoteCatalogGate = class {
  inFlight;
  retryAt;
  cooldownMs;
  now;
  constructor(options = {}) {
    this.cooldownMs = options.cooldownMs ?? REMOTE_CATALOG_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }
  /**
   * 是否处于「上次没拿到目录」的冷却窗口内。
   *
   * ⚠ `retryAt` 是用**墙钟**算的，系统时间被回拨时 `now() < retryAt` 会
   * 把冷却**拉长**（回拨一天就是事实上的永久卡死）。故这里只认「剩余量
   * 不超过一个冷却周期」的窗口 —— 回拨造成的超长窗口一律按已到期处理。
   */
  cooling() {
    if (this.retryAt === void 0) return false;
    const now = this.now();
    return now < this.retryAt && this.retryAt - now <= this.cooldownMs;
  }
  /**
   * 至多发起一次加载。
   *
   * - 冷却中：**不调用** `run`，直接返回。
   * - 已有在飞的加载：等它，不重复调用 `run`。
   * - 否则调用 `run`；返回 `false`（或抛错）即进入冷却。
   *
   * @param run 执行实际拉取，并在成功时自行落缓存；返回是否拿到了非空目录。
   * @param options.force 手动刷新：先清掉冷却窗口；即便有在飞的加载也**照样**
   *   自己再拉一次（用户刚点了刷新，不能拿一次可能失败的旧在飞结果交差）。
   *   代价是极小概率多一次上游请求，这是显式刷新的正确取舍。
   */
  async run(run, options = {}) {
    const force = options.force === true;
    if (force) this.retryAt = void 0;
    if (this.inFlight !== void 0) {
      await this.inFlight;
      if (!force) return;
    }
    if (!force && this.cooling()) return;
    const task = (async () => {
      try {
        return await run();
      } catch {
        return false;
      }
    })();
    this.inFlight = task;
    try {
      const got = await task;
      this.retryAt = got ? void 0 : this.now() + this.cooldownMs;
    } finally {
      if (this.inFlight === task) this.inFlight = void 0;
    }
  }
  /** 清掉冷却窗口（例如用户显式触发刷新）。 */
  reset() {
    this.retryAt = void 0;
  }
};

// vendor/channel-pack/src/trae-cache.ts
var TRAE_CACHE_READ_FIELDS = [
  "cache_read_input_tokens",
  "cacheReadInputTokens",
  "prompt_cache_hit_tokens",
  "cached_tokens",
  "prompt_tokens_details.cached_tokens",
  "input_tokens_details.cached_tokens"
];
var TRAE_CACHE_WRITE_FIELDS = [
  "cache_creation_input_tokens",
  "cacheCreationInputTokens",
  "cache_write_tokens",
  "prompt_tokens_details.cache_write_tokens"
];
function readPath(source, path) {
  let value = source;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return void 0;
    value = value[key];
  }
  return value;
}
function traeCacheCount(usage, fields) {
  let best;
  for (const field of fields) {
    const raw = readPath(usage, field);
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) continue;
    const value = Math.trunc(raw);
    if (best === void 0 || value > best) best = value;
  }
  return best;
}
function traeCacheUsage(usage, cachePoolAssigned) {
  const read = traeCacheCount(usage, TRAE_CACHE_READ_FIELDS);
  const write = traeCacheCount(usage, TRAE_CACHE_WRITE_FIELDS);
  const readKnown = read !== void 0 && (read > 0 || cachePoolAssigned);
  const writeKnown = write !== void 0 && (write > 0 || cachePoolAssigned);
  return {
    ...readKnown && read !== void 0 ? { read } : {},
    ...writeKnown && write !== void 0 ? { write } : {}
  };
}

// vendor/channel-pack/src/trae-errors.ts
var SESSION_DEAD_MARKERS = [
  "login",
  "token \u5931\u6548",
  "token invalid",
  "session",
  "unauthorized",
  "401"
];
var PLAN_LIMIT_MARKERS = ['"code":1005', "1005"];
var QUOTA_EXCEEDED_MARKERS = ["4008", '"code":4008', "quota", "exceeded the quota"];
function classifyTraeError(status, body) {
  const lower = body.toLowerCase();
  for (const marker of PLAN_LIMIT_MARKERS) {
    if (body.includes(marker) && (body.includes("plan") || lower.includes("plan"))) {
      return "hard-plan";
    }
  }
  for (const marker of QUOTA_EXCEEDED_MARKERS) {
    if (body.includes(marker)) return "quota-exceeded";
  }
  if (body.includes("4011") || body.includes('"code":4011')) {
    return "soft-rate";
  }
  if (status === 401) {
    for (const marker of SESSION_DEAD_MARKERS) {
      if (lower.includes(marker.toLowerCase())) return "session-dead";
    }
    return "session-dead";
  }
  if (status === 429) return "soft-rate";
  if (status === 404) return "not-found";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  return "none";
}
function shouldRotateTraeAccount(kind) {
  return kind !== "none";
}
function recordsTraeRateLimit(kind) {
  return kind === "hard-plan" || kind === "soft-rate" || kind === "not-found" || kind === "quota-exceeded";
}
function isTraeTerminalError(kind) {
  return kind === "session-dead";
}

// vendor/channel-pack/src/trae-adapter.ts
var TRAE_EFFORT_NAMES = {
  light: "\u8F7B",
  minimal: "\u6781\u5C11",
  low: "\u4F4E",
  medium: "\u4E2D",
  high: "\u9AD8",
  extra_high: "\u6781\u9AD8",
  xhigh: "\u6781\u9AD8",
  max: "\u6700\u5927"
};
function resolveTraeWireEffort(requested, options) {
  if (typeof requested !== "string" || requested.length === 0) return void 0;
  if (!options || options.length === 0) return requested;
  if (options.includes(requested)) return requested;
  const translated = privateEffortFor(requested, options);
  if (translated !== void 0) return translated;
  if (requested === "max" && !options.includes("max") && options.includes("extra_high")) return "extra_high";
  return void 0;
}
function strongestTraeEffort(options) {
  if (options.length === 0) return void 0;
  if (options.includes("max")) return "max";
  let best;
  let bestRank = -1;
  for (const option of options) {
    const rank = reasoningRankOf(option);
    if (rank !== void 0 && rank > bestRank) {
      best = option;
      bestRank = rank;
    }
  }
  return best ?? options[options.length - 1];
}
function defaultTraeEffort(config, fallback) {
  const declared = config.defaultLevel;
  if (declared !== void 0 && declared.length > 0 && config.options.includes(declared)) {
    return declared;
  }
  return fallback;
}
function resolveFirstTokenTimeoutMs2() {
  return Number.parseInt(process.env.DSH_TRAE_SSE_FIRST_TOKEN_TIMEOUT_MS ?? "", 10) || 12e4;
}
function resolveChunkTimeoutMs2() {
  return Number.parseInt(process.env.DSH_TRAE_SSE_CHUNK_TIMEOUT_MS ?? "", 10) || 12e4;
}
var TRAE_RATE_LIMIT_FALLBACK_MS = 36e5;
var TRAE_MAX_ROTATE = 3;
var TRAE_ROTATABLE_STREAM_ERROR = "TRAE_ROTATABLE_STREAM_ERROR";
function isRotatableStreamError(code) {
  return code === 1005 || code === 4008 || code === 4011;
}
var TRAE_MACHINE_ID_ROTATE_EVERY = 4;
function errorMessage2(error) {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}
function contentToText3(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => typeof block === "object" && block !== null && block.type === "text").map((block) => String(block.text)).join("");
}
var TOOL_RESULT_IMAGE_TEXT2 = "Attached image(s) from tool result:";
function userContentParts2(content, imageUrls) {
  const parts = [];
  let hasImage = false;
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue;
    const block = raw;
    if (block.type === "text") {
      const text = String(block.text ?? "");
      if (text.length > 0) parts.push({ type: "text", text });
      continue;
    }
    if (block.type === "image") {
      hasImage = true;
      const url = block.attachment?.attachmentId === void 0 ? void 0 : imageUrls.get(String(block.attachment.attachmentId));
      parts.push(url === void 0 ? { type: "text", text: "[image unavailable]" } : { type: "image_url", image_url: { url } });
      continue;
    }
    if (block.type === "tool-result" && Array.isArray(block.content)) {
      const inner = userContentParts2(block.content, imageUrls);
      if (inner !== void 0) {
        hasImage = true;
        parts.push(...inner);
      } else {
        const text = contentToText3(block.content);
        if (text.length > 0) parts.push({ type: "text", text });
      }
    }
  }
  return hasImage && parts.length > 0 ? parts : void 0;
}
function collectImages2(content, refs) {
  for (const raw of content) {
    if (typeof raw !== "object" || raw === null) continue;
    const block = raw;
    if (block.type === "image" && typeof block.attachment?.attachmentId === "string") {
      refs.set(block.attachment.attachmentId, block.attachment);
      continue;
    }
    if (block.type === "tool-result" && Array.isArray(block.content)) collectImages2(block.content, refs);
  }
}
function serializeTraeMessages(messages, imageUrls) {
  const wire = [];
  const normalized = normalizeHarnessMessages(messages);
  const { keepCallIds, keepResultIds } = resolveToolPairing(normalized);
  let pendingToolImages = [];
  const flushToolImages = () => {
    if (pendingToolImages.length === 0) return;
    wire.push({
      role: "user",
      content: [{ type: "text", text: TOOL_RESULT_IMAGE_TEXT2 }, ...pendingToolImages]
    });
    pendingToolImages = [];
  };
  for (const message of normalized) {
    if (message.role === "assistant") {
      const content2 = stripCourseLeakFromHistoryContent(
        message.role,
        Array.isArray(message.content) ? message.content : []
      );
      const toolCalls = content2.filter((block) => typeof block === "object" && block !== null && block.type === "tool-call").filter((block) => keepCallIds.has(String(block.id))).map((block) => ({
        id: String(block.id),
        type: "function",
        function: {
          name: String(block.name),
          arguments: normalizeToolArguments(String(block.arguments))
        }
      }));
      const text2 = contentToText3(content2);
      if (text2.trim().length === 0 && toolCalls.length === 0) continue;
      flushToolImages();
      wire.push({
        role: "assistant",
        content: text2.length === 0 && toolCalls.length > 0 ? null : text2,
        ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
      });
      continue;
    }
    if (message.role === "system") {
      flushToolImages();
      wire.push({ role: "system", content: contentToText3(message.content) });
      continue;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    const toolResults = content.filter(
      (block) => typeof block === "object" && block !== null && block.type === "tool-result"
    );
    const text = contentToText3(message.content);
    const outerContent = content.filter(
      (block) => !(typeof block === "object" && block !== null && block.type === "tool-result")
    );
    const parts = imageUrls === void 0 ? void 0 : userContentParts2(outerContent, imageUrls);
    const deferred = toolResults.length > 0;
    if (!deferred) {
      if (parts !== void 0) {
        flushToolImages();
        wire.push({ role: "user", content: parts });
      } else if (text.trim().length > 0) {
        flushToolImages();
        wire.push({ role: "user", content: text });
      }
    }
    for (const result of toolResults) {
      if (!keepResultIds.has(String(result.toolCallId))) continue;
      const innerParts = imageUrls === void 0 ? void 0 : Array.isArray(result.content) ? userContentParts2(result.content, imageUrls) : void 0;
      if (innerParts !== void 0) {
        pendingToolImages.push(...innerParts.filter((part) => part.type === "image_url"));
      }
      wire.push({
        role: "tool",
        tool_call_id: String(result.toolCallId),
        content: contentToText3(result.content) || (innerParts !== void 0 ? TOOL_RESULT_IMAGE_TEXT2 : "(no output)")
      });
    }
    if (deferred && (parts !== void 0 || text.length > 0)) {
      flushToolImages();
      wire.push({ role: "user", content: parts ?? text });
    }
  }
  flushToolImages();
  return wire;
}
function errorDetail2(body) {
  try {
    const data = JSON.parse(body);
    const parts = [
      typeof data.code === "number" || typeof data.code === "string" ? `code=${String(data.code)}` : void 0,
      typeof data.message === "string" ? data.message : void 0,
      typeof data.msg === "string" ? data.msg : void 0
    ].filter((value) => value !== void 0);
    if (parts.length > 0) return parts.join(" ");
  } catch {
  }
  return body;
}
function httpErrorCode2(status) {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) return "INVALID_REQUEST";
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}
function traeStreamErrorMessage(code, message, model) {
  const detail = message.trim();
  if (code === 1005) {
    return `trae: ${detail || "\u5957\u9910\u6743\u76CA\u4E0D\u8DB3\u6216\u989D\u5EA6\u53D7\u9650"} (code=1005)`;
  }
  const base = detail ? `trae: ${detail} (code=${code})` : `trae: (code=${code})`;
  if (code !== 4001) return base;
  return `${base} \u2014\u2014 \u6A21\u578B\u300C${model}\u300D\u4E0D\u88AB\u4E0A\u6E38\u63A5\u53D7\uFF1A\u5B83\u901A\u5E38\u662F\u300C\u4EC5\u53EF\u89C1\u4F46\u4E0D\u53EF\u8C03\u7528\u300D\u7684\u81EA\u5B9A\u4E49\u6A21\u578B\uFF08\u9700\u5148\u5728 TRAE IDE \u5185\u81EA\u884C\u914D\u7F6E\u4F9B\u5E94\u5546\uFF09\uFF0C\u8BF7\u6539\u7528\u6A21\u578B\u5217\u8868\u4E2D\u7684\u5176\u5B83\u6A21\u578B`;
}
function isTransportError2(error) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (message.includes("terminated")) return true;
  if (error.name.startsWith("UND_ERR_")) return true;
  if (message.includes("fetch failed")) return true;
  if (message.includes("econnreset") || message.includes("epipe") || message.includes("socket hang up")) return true;
  return false;
}
function traeDisplayName(model) {
  const raw = typeof model.name === "string" && model.name.trim() ? model.name.trim() : model.id;
  return raw.replace(/\s*·\s*(?:x[\d.]+(?:→x[\d.]+)?|免费).*$/u, "").trim() || model.id;
}
var TraeAdapter = class extends LlmAdapter2 {
  constructor(options) {
    super();
    this.options = options;
    this.product = options.product ?? TRAE;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const cached2 = readCatalogCache(options.catalogFile);
    if (cached2) {
      this.remoteModels = cached2;
      this.catalogSource = "cached";
      this.remoteMeta = new Map(cached2.map((model) => [model.id, model]));
    }
    this.fallbackIndex = new Map(
      (this.product.fallbackModels ?? []).map((model) => [model.id, model])
    );
  }
  product;
  fetchImpl;
  /** 动态模型缓存。 */
  remoteModels;
  /**
   * 目录加载闸门：并发去重 + 失败/空结果冷却。
   * 依据见 `src/remote-catalog-gate.ts`（首屏「加载模型巨长」的实测归因）。
   */
  catalogGate = new RemoteCatalogGate();
  catalogSource = "fallback";
  /** 远端模型元数据索引。 */
  remoteMeta = /* @__PURE__ */ new Map();
  /** 产品级兜底模型索引。 */
  fallbackIndex;
  /**
   * 已发起的 chat 请求计数（仅在启用机器指纹轮换时使用，见
   * {@link TraeAdapter.machineIdGeneration}）。
   */
  sendCount = 0;
  providerInfo(provider) {
    const id = typeof provider === "string" && provider.length > 0 ? provider : this.product.id;
    return { id, name: this.product.displayName };
  }
  /** 懒加载远端模型目录（仅拉取一次）。 */
  async ensureRemoteModels() {
    const fetchRemote = this.options.fetchRemoteModels;
    if (this.remoteModels !== void 0 || fetchRemote === void 0) return;
    await this.catalogGate.run(async () => {
      const models = await fetchRemote();
      if (models.length === 0) return false;
      this.remoteModels = models;
      this.remoteMeta = new Map(models.map((model) => [model.id, model]));
      this.catalogSource = "remote";
      await saveCatalogCache(this.options.catalogFile, models).catch(() => {
      });
      return true;
    });
  }
  /** Refresh without clearing the last successful catalog. */
  async refreshRemoteModels() {
    const fetchRemote = this.options.fetchRemoteModels;
    if (fetchRemote && await providerCatalogVisible(this.options.accountPool, this.product.id)) {
      let updated = false;
      await this.catalogGate.run(async () => {
        const models = await fetchRemote(true);
        if (!models.length) return false;
        this.remoteModels = models;
        this.remoteMeta = new Map(models.map((model) => [model.id, model]));
        this.catalogSource = "remote";
        updated = true;
        await saveCatalogCache(this.options.catalogFile, models).catch(() => {
        });
        return true;
      }, { force: true });
      if (!updated && this.remoteModels) this.catalogSource = "cached";
    }
    return { count: this.remoteModels?.length ?? this.product.fallbackModels.length, source: this.catalogSource };
  }
  /**
   * 模型接受的输入模态 —— **逐模型**判定，不是按 provider 一刀切。
   *
   * 判据是远端 `display_config.multimodal`（见
   * {@link TraeRemoteModel.multimodal} 的实测记录）：
   *
   * - `true` → `['text', 'image']`
   * - `false` / **未声明** → `['text']`（保守：兜底表没有该字段，
   *   且「远端没说」不等于「远端支持」）
   *
   * ⚠️ **这里返回的 `image` 是 DSH 的准入闸门**：不声明 `image` 时，图片会在
   * **附件入库阶段**就被拒（`session/attachment-invalid`），用户看到
   * 「当前模型不支持图片」——而图根本没发到上游。因此漏报 `image` 不只是
   * 「少个功能」，而是「连降级成文本占位符的机会都没有」。
   *
   * **历史缺陷**（Issue #IKHDKC）：早期这里恒返回 `['text']`（参数名甚至是
   * `_model`，即刻意忽略模型），理由是「SOLO 通道未见图片能力」—— 实测证伪：
   * 远端一直在目录里声明该能力，且直发图片后模型真的看得见。
   */
  inputModalitiesFor(model) {
    const override = this.options.accountPool?.modelParamsFor?.(this.product.id, model)?.supportsImage;
    const declared = this.remoteMeta.get(model)?.multimodal ?? this.fallbackIndex.get(model)?.multimodal;
    return (override ?? declared) === true ? ["text", "image"] : ["text"];
  }
  rateBadgeFor(model) {
    const remote = this.remoteMeta.get(model);
    const base = remote?.originalCreditsRate;
    const hasDiscount = base !== void 0;
    const canUseDiscount = this.catalogSource === "remote" && (remote?.discountEndsAtSec === void 0 || remote.discountEndsAtSec > Date.now() / 1e3);
    const rate = hasDiscount && !canUseDiscount ? base : remote?.creditsRate;
    if (rate === void 0) {
      return modelRateBadge(TRAE_REFERENCE_RATES[model], { reference: true });
    }
    return modelRateBadge(rate, {
      status: canUseDiscount && base !== void 0 && base > rate ? "discount" : "normal",
      baseMultiplier: base
    });
  }
  /**
   * 该模型所属的聊天通道（`function`）。
   *
   * ⚠️ **模型只在列出它的通道里可调用**：发错通道上游会回流内
   * `code=4001 param is invalid`（实测 `glm-5.1` 在 `solo_work_lite` 报错、
   * 在 `solo_agent_remote` 正常；`glm-5-turbo` 恰好相反）。
   * 远端目录里每条模型都带自己的 `function`；查不到时回退默认通道。
   *
   * ⚠️ **这里拿到的一定是白名单内的通道**（Issue IKJOZ7）：非白名单通道的条目
   * 已在 `parseTraeBatchModelList` 里被整组剔除，故 `remoteMeta` 里不可能存在
   * 「通道不可调用」的模型。兜底路径（远端目录不可用 → 兜底表）本就没有通道
   * 信息，只能回退 `product.function`（`solo_work_lite`，已在白名单内）。
   *
   * ⚠️ 若在此处**再加**一层白名单校验，会让「用户用 `DSH_TRAE_CHANNELS` 自定义
   * 白名单 + 模型来自兜底表」的组合出现两条判据不一致；故准入只在解析器一处
   * 执行（单一真相源）。
   */
  channelFor(model) {
    const channel = this.remoteMeta.get(model)?.function;
    return channel !== void 0 && channel.length > 0 ? channel : this.product.function;
  }
  /**
   * 模型的上下文窗口：远端优先，兜底表次之。
   *
   * ⚠️ 开启 Max 模式时改用 `context_window_tokens.max`（1M）。两者**不能混用**：
   * 未开 Max 却声明 1M 会让 DSH 把超长上下文直接发出去，而上游按 200K 校验后
   * 拒绝（输入被截断或 4xx）。
   */
  contextWindowFor(model) {
    const meta = this.remoteMeta.get(model);
    if (this.maxModeFor(model)) {
      return meta?.maxContextWindow ?? TRAE_MAX_CONTEXT_TOKENS;
    }
    return meta?.contextWindow ?? this.fallbackIndex.get(model)?.contextWindow;
  }
  /**
   * 该模型本次是否启用 **Max 模式**（1M 上下文）。
   *
   * 三个条件缺一不可（对齐 `Trae2api-cn/trae_remote_client.py:249-277`）：
   * 1. 产品级开关（`DSH_TRAE_MAX_MODE`）未关 —— **默认开启**，用户要求
   *    「上下文用最大的那一档」；显式设 `0` / `false` 才关回 200K；
   * 2. 远端 `display_config.max_mode === true` —— **绝不**给未标记的模型硬套
   *    Max 参数，上游会拒绝（`_max_mode_requested` 的注释明写
   *    "Never fabricate max limits for a model the account config does not mark"）；
   * 3. 若配置了白名单，模型须在其中。
   */
  maxModeFor(model) {
    if (this.product.maxMode !== true) return false;
    const meta = this.remoteMeta.get(model);
    if (meta === void 0 || meta.maxMode !== true) return false;
    const whitelist = this.product.maxModeModels;
    if (whitelist !== void 0 && whitelist.length > 0 && !whitelist.includes("*")) {
      return whitelist.includes(model);
    }
    return true;
  }
  /**
   * 模型可选的推理强度档位（`reasoning_effort_config`）。
   *
   * TRAE 的 `options` 是**单值字符串**（既是产品侧档位名、也是 wire 值），
   * 与 LobsterAI 的 `level` / `openclawLevel` 双字段形态不同，故不需要映射表
   * 之外的转换（命名仅用于展示）。
   *
   * 不声明 `reasoning` 的两种情形：
   * - 远端没有该配置 → UI 显示「当前模型未提供推理等级」（而不是给个发了没用的档位）
   * - `support_thinking === false` → 远端明确说不支持思考
   *
   * `defaultEffort` 必须落在 `efforts` 内（DSH 会拿它直接发请求），远端数据
   * 不一致时退化为不声明默认值。
   */
  reasoningFor(model) {
    const config = this.remoteMeta.get(model)?.reasoningConfig ?? this.fallbackIndex.get(model)?.reasoningConfig;
    if (config === void 0) return void 0;
    if (config.supportThinking === false) return void 0;
    const available = uniqueCanonicalEfforts(config.options);
    if (available.length === 0) return void 0;
    const efforts = available.map(({ id, wire }) => ({
      id: ReasoningEffortId2(id),
      name: TRAE_EFFORT_NAMES[wire] ?? id
    }));
    const fallback = strongestTraeEffort(config.options);
    const declared = defaultTraeEffort(config, fallback);
    const chosen = defaultModelEffort(available.map((effort) => effort.id), declared === void 0 ? void 0 : canonicalEffortId(declared));
    return {
      efforts,
      ...chosen !== void 0 ? { defaultEffort: ReasoningEffortId2(chosen) } : {}
    };
  }
  /**
   * 模型的输出上限：远端优先 → 兜底表 → 产品级兜底值。
   *
   * ⚠️ 实测远端主流模型声明的是 **32000**，而兜底表旧值写的 128000 会让
   * DSH 索要一个上游不接受的值。远端可用时一律以远端为准。
   */
  maxOutputTokensFor(model) {
    const meta = this.remoteMeta.get(model);
    if (this.maxModeFor(model) && meta?.maxModeOutputTokens !== void 0) {
      return meta.maxModeOutputTokens;
    }
    return meta?.maxOutputTokens ?? this.product.fallbackMaxOutputTokens;
  }
  /**
   * 静态兜底模型目录。
   *
   * 始终过滤 `isHidden === true` 的条目（这些是上游内部/隐藏模型，不应出现在
   * 对话模型目录中）。与远端路径的过滤逻辑一致（`parseTraeBatchModelList` 中也
   * 硬性过滤 `isHidden === true`）。
   */
  staticFallbackModels() {
    return this.product.fallbackModels.filter((model) => model.isHidden !== true).map((model) => ({ id: model.id, name: model.name }));
  }
  /**
   * 完整模型目录（**不应用用户黑名单**）。
   *
   * ## 为什么需要它
   *
   * `listModels` 会按用户黑名单过滤（Channel Pack「显示列表」开关），于是**被关闭的
   * 模型不在其返回值里**。而设置页必须把关闭的模型也渲染出来（否则用户无法重新
   * 打开），RPC 层只能凭黑名单的 key（裸 id）补回 —— 那条路径拿不到展示名，
   * 只能回退成裸 id，**倍率与模型显示名随之丢失**（用户报障：「关闭的就没有显示
   * 倍率，关闭的应该也显示倍率」）。
   *
   * 故这里提供「不过滤黑名单」的目录，由 `model.list` 端点使用：它据此拿到
   * 每个 id 的**真实展示名（含倍率）**，再自行回填 `disabled` 状态。
   * 对话框模型选择器读的仍是 `listModels`（已过滤），可见性行为不变。
   */
  /**
   * 当前目录是否来自**远端真拉**（而不是离线兜底表）。
   *
   * 调用方：`model.list` 用它决定能否按目录剪掉历史遗留的模型黑名单条目 ——
   * 只有远端目录才是「上游全量」的证据，兜底表只是精选子集。
   */
  catalogStatus() {
    return { source: this.catalogSource };
  }
  isRemoteCatalog() {
    return this.remoteModels !== void 0 && this.catalogSource === "remote";
  }
  listAllModels() {
    const source = this.remoteModels === void 0 ? this.staticFallbackModels() : this.remoteModels.filter((model) => isTraeModelCallable(model) && model.isHidden !== true && !TRAE_INTERNAL_MODEL_IDS.has(model.id));
    return source.map((model) => {
      const curated = this.fallbackIndex.get(model.id);
      const reasoning = this.reasoningFor(model.id);
      const maxOutput = this.maxOutputTokensFor(model.id);
      const supportsImage = this.remoteMeta.get(model.id)?.multimodal ?? curated?.multimodal;
      return {
        id: model.id,
        name: readableModelName(model.id, traeDisplayName(model)),
        contextWindow: this.contextWindowFor(model.id),
        ...maxOutput !== void 0 ? { maxTokens: maxOutput, defaultMaxTokens: maxOutput } : {},
        ...supportsImage !== void 0 ? { supportsImage } : {},
        rateBadge: this.rateBadgeFor(model.id),
        ...reasoning?.efforts?.length ? {
          efforts: reasoning.efforts.map((effort) => effort.id)
        } : {},
        ...reasoning?.defaultEffort !== void 0 ? { defaultEffort: reasoning.defaultEffort } : {},
        // 订阅限定来自策展表的官方会员门槛声明 + 付费专用 id 集合（远端目录不下发该标志；
        // glm-5.4 等不在兜底表里的远端条目只能靠集合标注）。
        ...curated?.subscriptionOnly === true || TRAE_SUBSCRIPTION_ONLY_MODELS.has(model.id) ? { subscriptionOnly: true } : {},
        ...curated?.stale === true ? { stale: true } : {},
        ...curated?.staleReason === void 0 ? {} : { staleReason: curated.staleReason }
      };
    });
  }
  async listModels(_provider) {
    if (!await providerCatalogVisible(this.options.accountPool, this.product.id)) return [];
    await this.ensureRemoteModels();
    const source = this.listAllModels();
    const overrides = this.options.accountPool?.listDisabledModels?.(this.product.id) ?? {};
    const exclusions = modelRecommendationExclusions(this.listAllModels(), this.product.id);
    const listed = source.filter((model) => !isModelDisabled({ id: model.id, stale: this.fallbackIndex.get(model.id)?.stale }, overrides, exclusions));
    return listed.map((model) => {
      const badge = this.rateBadgeFor(model.id);
      return {
        provider: this.product.id,
        id: model.id,
        name: readableModelName(model.id, model.name),
        // ⚠️ 逐模型判定（远端 `display_config.multimodal`）—— 早期这里硬编码
        // `['text']`，导致 DSH 在附件准入阶段就拒掉图片（Issue #IKHDKC）。
        inputModalities: this.inputModalitiesFor(model.id),
        ...badge === void 0 ? {} : { badge }
      };
    });
  }
  async resolveModel(provider, model, _signal) {
    await this.ensureRemoteModels();
    const remoteName = this.remoteMeta.get(model)?.name;
    const resolved = {
      provider,
      id: model,
      name: readableModelName(model, remoteName ?? this.fallbackIndex.get(model)?.name),
      // ⚠️ 与 listModels 同源：必须逐模型判定，否则准入闸门仍会拦下图。
      inputModalities: this.inputModalitiesFor(model)
    };
    const contextWindow = this.contextWindowFor(model);
    if (contextWindow !== void 0) resolved.context = { contextWindow };
    const maxTokens = this.maxOutputTokensFor(model);
    if (maxTokens !== void 0) resolved.defaultMaxTokens = maxTokens;
    const reasoning = this.reasoningFor(model);
    if (reasoning !== void 0) resolved.reasoning = reasoning;
    return resolved;
  }
  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options)
    };
  }
  async *stream(options) {
    await this.ensureRemoteModels();
    let credential = await this.options.resolveCredential(options.model);
    if (credential === void 0 || isTraeExpired(credential)) {
      await this.options.refresh();
      credential = await this.options.resolveCredential(options.model);
    }
    if (credential === void 0 || credential.access_token.length === 0) {
      throw new LlmError7("trae: no usable credential; log in first", "MISSING_CREDENTIAL");
    }
    let currentAccountId = "";
    if (this.options.accountPool) {
      try {
        currentAccountId = await this.options.accountPool.findAccountIdByCredential(
          this.product.id,
          credential.access_token
        );
        if (currentAccountId !== "") reportLedgerAccount(this.product.id, currentAccountId);
      } catch {
      }
    }
    const imageRefs = /* @__PURE__ */ new Map();
    for (const message of options.messages) {
      if (Array.isArray(message.content)) collectImages2(message.content, imageRefs);
    }
    let imageUrls;
    if (imageRefs.size > 0) {
      if (!this.inputModalitiesFor(options.model).includes("image")) {
        throw new LlmError7(
          `trae: model "${options.model}" does not accept image input.`,
          "UNSUPPORTED_CONTENT"
        );
      }
      if (this.options.readImage === void 0) {
        throw new LlmError7(
          "trae: image input requires the attachment service; confirm the profile loads @deepseek-ai/dsh-attachment-local.",
          "UNSUPPORTED_CONTENT"
        );
      }
      imageUrls = /* @__PURE__ */ new Map();
      for (const [id, ref] of imageRefs) {
        const image = await this.options.readImage(ref);
        if (image === void 0) continue;
        imageUrls.set(id, `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}`);
      }
    }
    const wireMessages = serializeTraeMessages(options.messages, imageUrls);
    const openaiBody = {
      model: options.model,
      messages: wireMessages,
      stream: true
    };
    if (options.tools !== void 0 && options.tools.length > 0) {
      openaiBody.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }));
    }
    if (options.temperature !== void 0) openaiBody.temperature = options.temperature;
    const maxTokens = clampTraeMaxTokens(options.maxTokens ?? defaultModelOutputTokens(this.maxOutputTokensFor(options.model)));
    if (maxTokens !== void 0) openaiBody.max_tokens = maxTokens;
    if (options.stop !== void 0 && options.stop.length > 0) openaiBody.stop = options.stop;
    const reasoningCfg = this.remoteMeta.get(options.model)?.reasoningConfig ?? this.fallbackIndex.get(options.model)?.reasoningConfig;
    const requestedEffort = options.reasoningEffort ?? this.reasoningFor(options.model)?.defaultEffort;
    const effort = resolveTraeWireEffort(requestedEffort, reasoningCfg?.options);
    if (effort !== void 0) {
      openaiBody.reasoning_effort = effort;
    }
    const buildSoloBody = (useMaxMode, channel) => {
      const payload = { ...openaiBody };
      if (useMaxMode) {
        const meta = this.remoteMeta.get(options.model);
        Object.assign(
          payload,
          traeMaxModeFields(
            meta?.maxContextWindow ?? TRAE_MAX_CONTEXT_TOKENS,
            meta?.maxModeOutputTokens
          )
        );
      }
      if (options.system !== void 0 && options.system.length > 0) {
        payload.messages = [
          { role: "system", content: options.system },
          ...wireMessages
        ];
      }
      const solo = transformToSOLOBody(payload, void 0, channel);
      if (!solo.request_id) solo.request_id = crypto.randomUUID();
      if (!solo.session_id) {
        const sid = options.sessionId;
        solo.session_id = typeof sid === "string" && sid ? sid : crypto.randomUUID();
      }
      return JSON.stringify(solo);
    };
    let usingMaxMode = this.maxModeFor(options.model);
    let activeChannel = this.channelFor(options.model);
    const fallbackChannels = ["solo_agent", "chat_v3", "solo_work_lite", "solo_coder"].filter((fn) => fn !== activeChannel);
    let fallbackChannelIndex = 0;
    let body = buildSoloBody(usingMaxMode, activeChannel);
    let response = await this.send(credential, body, options);
    if (!response.ok && (response.status === 401 || response.status === 403)) {
      await this.options.refresh(void 0, "auth");
      const refreshed = await this.options.resolveCredential(options.model);
      if (refreshed === void 0 || refreshed.access_token.length === 0) {
        throw new LlmError7("trae: credential expired and refresh failed", "AUTH", { status: response.status });
      }
      credential = refreshed;
      response = await this.send(credential, body, options);
    }
    if (!response.ok) {
      let errorText = await response.text().catch(() => "");
      let lastStatus = response.status;
      let lastKind = classifyTraeError(response.status, errorText);
      if (usingMaxMode && (lastKind === "hard-plan" || errorText.includes("1005"))) {
        usingMaxMode = false;
        body = buildSoloBody(false, activeChannel);
        const downgraded = await this.send(credential, body, options);
        response = downgraded;
        if (!downgraded.ok) {
          errorText = await downgraded.text().catch(() => "");
          lastStatus = downgraded.status;
          lastKind = classifyTraeError(downgraded.status, errorText);
        }
      }
      if (!response.ok && this.options.accountPool && shouldRotateTraeAccount(lastKind)) {
        const tried = /* @__PURE__ */ new Set();
        if (currentAccountId) tried.add(currentAccountId);
        const maxRotate = TRAE_MAX_ROTATE - 1;
        for (let round = 0; round < maxRotate; round++) {
          if (currentAccountId && recordsTraeRateLimit(lastKind)) {
            await this.options.accountPool.updateModelRateLimit(
              currentAccountId,
              options.model,
              Date.now() + TRAE_RATE_LIMIT_FALLBACK_MS
            );
          }
          const next = await this.options.accountPool.getAvailableAccount(
            this.product.id,
            options.model,
            tried
          );
          if (!next || tried.has(next.entry.id)) break;
          tried.add(next.entry.id);
          credential = next.credential;
          currentAccountId = next.entry.id;
          response = await this.send(credential, body, options);
          if (response.ok) {
            yield* this.consumeSse(response, options);
            return;
          }
          errorText = await response.text().catch(() => "");
          lastStatus = response.status;
          lastKind = classifyTraeError(response.status, errorText);
          if (!shouldRotateTraeAccount(lastKind)) break;
        }
        throw new LlmError7(
          `trae: \u6A21\u578B ${options.model} \u6240\u6709\u8D26\u53F7\u5747\u4E0D\u53EF\u7528\uFF08${errorDetail2(errorText)}\uFF09`,
          lastKind === "quota-exceeded" ? "QUOTA_EXCEEDED" : httpErrorCode2(lastStatus),
          { status: lastStatus }
        );
      }
      if (!response.ok) {
        if (lastKind === "quota-exceeded" || lastKind === "hard-plan") {
          throw new LlmError7(`trae: \u5957\u9910\u6743\u76CA\u6216\u79EF\u5206\u4E0D\u8DB3\uFF08${errorDetail2(errorText)}\uFF09`, "QUOTA_EXCEEDED", { status: lastStatus });
        }
        throw new LlmError7(`trae: ${errorDetail2(errorText)}`, httpErrorCode2(lastStatus), { status: lastStatus });
      }
    }
    const triedStreamAccounts = /* @__PURE__ */ new Set();
    if (currentAccountId.length > 0) triedStreamAccounts.add(currentAccountId);
    let rotateBudget = TRAE_MAX_ROTATE - 1;
    for (let attempt = 0; ; attempt++) {
      try {
        yield* this.consumeSse(response, options);
        return;
      } catch (error) {
        if (error instanceof LlmError7 && error.code === TRAE_ROTATABLE_STREAM_ERROR) {
          if (options.signal?.aborted) throw error;
          const isCode1005 = error.message.includes("code=1005");
          const trySameAccountFallback = async (nextBody) => {
            const candidate = await this.send(credential, nextBody, options);
            if (candidate.ok) {
              response = candidate;
              return true;
            }
            const errBody = await candidate.text().catch(() => "");
            const kind = classifyTraeError(candidate.status, errBody);
            if (!shouldRotateTraeAccount(kind) && !errBody.includes("1005")) {
              throw new LlmError7(`trae: ${errorDetail2(errBody)}`, httpErrorCode2(candidate.status), { status: candidate.status });
            }
            return false;
          };
          if (isCode1005 && usingMaxMode) {
            usingMaxMode = false;
            body = buildSoloBody(false, activeChannel);
            if (await trySameAccountFallback(body)) continue;
          }
          if (isCode1005 && fallbackChannelIndex < Math.min(2, fallbackChannels.length)) {
            activeChannel = fallbackChannels[fallbackChannelIndex++];
            body = buildSoloBody(usingMaxMode, activeChannel);
            if (await trySameAccountFallback(body)) continue;
          }
          if (this.options.accountPool === void 0 || rotateBudget <= 0) {
            throw new LlmError7(error.message, "QUOTA_EXCEEDED");
          }
          rotateBudget -= 1;
          if (currentAccountId.length > 0) {
            await this.options.accountPool.updateModelRateLimit(
              currentAccountId,
              options.model,
              Date.now() + TRAE_RATE_LIMIT_FALLBACK_MS
            );
          }
          const next = await this.options.accountPool.getAvailableAccount(
            this.product.id,
            options.model,
            triedStreamAccounts
          );
          if (next === null || next === void 0 || triedStreamAccounts.has(next.entry.id)) {
            throw new LlmError7(error.message, "QUOTA_EXCEEDED");
          }
          triedStreamAccounts.add(next.entry.id);
          credential = next.credential;
          currentAccountId = next.entry.id;
          response = await this.send(credential, body, options);
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            const kind = classifyTraeError(response.status, text);
            if (!shouldRotateTraeAccount(kind)) {
              throw new LlmError7(`trae: ${errorDetail2(text)}`, httpErrorCode2(response.status), { status: response.status });
            }
            continue;
          }
          continue;
        }
        const empty = error instanceof LlmError7 && error.message.includes("upstream returned no events");
        if (!empty || attempt >= 1) throw error;
        if (options.signal?.aborted) throw error;
        response = await this.send(credential, body, options);
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new LlmError7(`trae: ${errorDetail2(text)}`, httpErrorCode2(response.status), { status: response.status });
        }
      }
    }
  }
  /** 发起一次 chat 请求；网络失败映射为可重试的 TRANSPORT 错误。 */
  async send(credential, body, options) {
    this.sendCount += 1;
    const headers = new Headers(
      traeSOLOHeaders(credential, this.product, true, this.machineIdGeneration())
    );
    try {
      return await this.fetchImpl(`${this.product.agentHost}/api/agent/v3/llm_utils_chat`, {
        method: "POST",
        headers,
        body,
        signal: options.signal
      }).then(checkQueuedResponse);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (isTransportError2(error)) {
        throw new LlmError7(`trae: transport error: ${errorMessage2(error)}`, "TRANSPORT", { cause: error });
      }
      throw error;
    }
  }
  /**
   * 当前应使用的机器指纹代次。
   *
   * **默认恒为 0（不轮换）** —— 只有显式设置
   * `DSH_TRAE_ROTATE_MACHINE_ID=1` 时才按每 4 次请求递增一代。
   *
   * 默认关闭的原因见 {@link deriveRotatingMachineId}：轮换能降低端点风控，
   * 但会让设备身份漂移，与「machine_id 登录后绝不变」的既定约束冲突。
   * 该开关是出现集中 401/风控时的第一个可尝试手段。
   */
  machineIdGeneration() {
    if (process.env.DSH_TRAE_ROTATE_MACHINE_ID !== "1") return 0;
    return Math.floor(this.sendCount / TRAE_MACHINE_ID_ROTATE_EVERY);
  }
  /**
   * 消费 SOLO 自定义 SSE 流，转为 OpenAI StreamChunk。
   *
   * SOLO 事件格式（solosse.go）：
   * ```
   * event:output
   * data:{"response":"<增量>","reasoning_content":"<思考增量>","tool_calls":<null|数组>}
   *
   * event:token_usage
   * data:{"prompt_tokens":21,"completion_tokens":142,...}
   *
   * event:done
   * data:{"finish_reason":"stop"}
   *
   * event:error
   * data:{"code":4008,"message":"quota exceeded"}
   * ```
   */
  async *consumeSse(response, options) {
    if (!response.body) throw new LlmError7("trae: empty model response body", "EMPTY_RESPONSE");
    const blocks = [];
    let nextIndex = 0;
    const loopGuard = isReasoningLoopGuardEnabled() ? createReasoningLoopDetector() : void 0;
    let loopDetected = false;
    const proseLoopGuard = isReasoningLoopGuardEnabled() ? createReasoningLoopDetector() : void 0;
    let proseLoopDetected = false;
    const suppressor = createBlankReasoningSuppressor();
    const proseSuppressor = createBlankReasoningSuppressor();
    const toolCalls = /* @__PURE__ */ new Map();
    const toolOrder = [];
    const toolIds = /* @__PURE__ */ new Map();
    let buffer = "";
    let streamEnded = false;
    let finishReason;
    let currentEvent = "";
    let currentData = "";
    let gotAnyContent = false;
    let cachePoolAssigned = false;
    let sawAnyUpstreamEvent = false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let firstTokenReceived = false;
    try {
      for (; ; ) {
        if (streamEnded) break;
        let result;
        try {
          const timeoutMs = firstTokenReceived ? resolveChunkTimeoutMs2() : resolveFirstTokenTimeoutMs2();
          const phase = firstTokenReceived ? "chunk" : "first-token";
          result = await readWithIdleTimeout(reader, timeoutMs, "trae", options.signal, phase);
          if (!result.done) firstTokenReceived = true;
        } catch (error) {
          if (options.signal?.aborted) throw error;
          if (error instanceof LlmError7) throw error;
          if (isTransportError2(error)) {
            throw new LlmError7(`trae: sse transport error: ${errorMessage2(error)}`, "TRANSPORT", { cause: error });
          }
          throw error;
        }
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim().length === 0) {
            if (currentEvent.length > 0) {
              const ev = parseTraeSSELine(currentEvent, currentData);
              currentEvent = "";
              currentData = "";
              if (ev === void 0) continue;
              sawAnyUpstreamEvent = true;
              switch (ev.event) {
                case "metadata": {
                  const poolRecord = ev.metadata?.prompt_cache_pool_record;
                  cachePoolAssigned = ev.metadata !== void 0 && poolRecord !== null && poolRecord !== void 0;
                  break;
                }
                case "output": {
                  const delta = {};
                  if (ev.response !== void 0 && ev.response.length > 0) {
                    delta.content = ev.response;
                    gotAnyContent = true;
                  }
                  if (ev.reasoningContent !== void 0 && ev.reasoningContent.length > 0) {
                    delta.reasoning_content = ev.reasoningContent;
                  }
                  if (ev.toolCalls !== void 0 && ev.toolCalls.length > 0) {
                    delta.tool_calls = ev.toolCalls;
                  }
                  if (Object.keys(delta).length > 0) {
                    const textDelta = delta.content === void 0 ? void 0 : proseSuppressor.feed(delta.content);
                    if (textDelta !== void 0) {
                      let block = blocks.find((c) => c.kind === "text");
                      if (block === void 0) {
                        block = { index: nextIndex++, kind: "text", text: "" };
                        blocks.push(block);
                        yield { type: "block-start", index: block.index, blockType: "text" };
                      }
                      if (proseLoopGuard !== void 0) {
                        if (proseLoopGuard.observe(textDelta)) proseLoopDetected = true;
                      }
                      if (!proseLoopDetected) {
                        block.text += textDelta;
                        yield { type: "text-delta", index: block.index, text: textDelta };
                      }
                    }
                    if (delta.reasoning_content !== void 0) {
                      if (loopGuard !== void 0) {
                        if (loopGuard.observe(delta.reasoning_content)) loopDetected = true;
                      }
                      if (!loopDetected) {
                        const emit = suppressor.feed(delta.reasoning_content);
                        if (emit !== void 0) {
                          let block = blocks.find((c) => c.kind === "reasoning");
                          if (block === void 0) {
                            block = { index: nextIndex++, kind: "reasoning", text: "" };
                            blocks.push(block);
                            yield { type: "block-start", index: block.index, blockType: "reasoning" };
                          }
                          block.text = suppressor.text();
                          yield { type: "reasoning-delta", index: block.index, text: emit };
                        }
                      }
                    }
                    if (delta.tool_calls !== void 0) {
                      const calls = delta.tool_calls;
                      for (const call of calls) {
                        const wireIndex = typeof call.index === "number" ? call.index : 0;
                        if (typeof call.id === "string" && call.id.length > 0) toolIds.set(wireIndex, call.id);
                        const callId = toolIds.get(wireIndex) ?? `call_${wireIndex}`;
                        let block = toolCalls.get(wireIndex);
                        if (block === void 0) {
                          block = { index: nextIndex++, text: "", callId, announced: false };
                          toolCalls.set(wireIndex, block);
                        }
                        block.callId = callId;
                        const callFn = call.function;
                        const fn = typeof callFn === "object" && callFn !== null ? callFn : void 0;
                        if (fn !== void 0 && typeof fn.name === "string" && fn.name.length > 0) {
                          block.name = fn.name;
                        }
                        const fragment = fn !== void 0 && typeof fn.arguments === "string" ? fn.arguments : "";
                        block.text += fragment;
                        if (!block.announced) {
                          if (!hasUsableToolName(block.name)) continue;
                          block.announced = true;
                          toolOrder.push(block.index);
                          yield { type: "block-start", index: block.index, blockType: "tool-call" };
                          yield {
                            type: "tool-call-delta",
                            index: block.index,
                            id: ToolCallId2(callId),
                            name: block.name,
                            argumentsDelta: block.text
                          };
                          continue;
                        }
                        yield {
                          type: "tool-call-delta",
                          index: block.index,
                          id: ToolCallId2(callId),
                          ...block.name !== void 0 ? { name: block.name } : {},
                          argumentsDelta: fragment
                        };
                      }
                    }
                  }
                  break;
                }
                case "token_usage": {
                  if (ev.usage !== void 0) {
                    const promptTokens = typeof ev.usage.prompt_tokens === "number" ? ev.usage.prompt_tokens : 0;
                    const completionTokens = typeof ev.usage.completion_tokens === "number" ? ev.usage.completion_tokens : 0;
                    const reasoningTokens = typeof ev.usage.reasoning_tokens === "number" ? ev.usage.reasoning_tokens : void 0;
                    const cache2 = traeCacheUsage(ev.usage, cachePoolAssigned);
                    const cachedTokens = Math.min(cache2.read ?? 0, promptTokens);
                    yield {
                      type: "usage",
                      usage: {
                        inputTokens: promptTokens - cachedTokens,
                        outputTokens: completionTokens,
                        // 可信的 0 照常下发（0% 是测量值）；只有「未知」才省略字段。
                        ...cache2.read !== void 0 ? { cacheReadTokens: cachedTokens } : {},
                        ...cache2.write !== void 0 ? { cacheWriteTokens: cache2.write } : {},
                        ...reasoningTokens !== void 0 && reasoningTokens > 0 ? { reasoningTokens } : {}
                      }
                    };
                  }
                  break;
                }
                case "done":
                  if (ev.finishReason !== void 0) {
                    finishReason = ev.finishReason;
                  }
                  streamEnded = true;
                  break;
                case "error": {
                  if (ev.errorCode !== void 0 && ev.errorMessage !== void 0) {
                    const message = traeStreamErrorMessage(ev.errorCode, ev.errorMessage, options.model);
                    if (isRotatableStreamError(ev.errorCode) && !gotAnyContent) {
                      throw new LlmError7(message, TRAE_ROTATABLE_STREAM_ERROR);
                    }
                    throw new LlmError7(
                      message,
                      ev.errorCode === 1005 || ev.errorCode === 4008 ? "QUOTA_EXCEEDED" : "SERVER"
                    );
                  }
                  break;
                }
              }
            }
            continue;
          }
          const trimmed = line.trim();
          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("data:")) {
            currentData += trimmed.slice(5);
          }
        }
        if (loopDetected) {
          await reader.cancel().catch(() => {
          });
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
    if (!sawAnyUpstreamEvent) {
      throw new LlmError7(
        "trae: upstream returned no events (empty response before first model event)",
        "TRANSPORT"
      );
    }
    let blockCount = 0;
    let emittedProse = "";
    const textBlock = blocks.find((block) => block.kind === "text");
    for (const index of toolOrder) {
      const block = [...toolCalls.values()].find((candidate) => candidate.index === index);
      if (!hasUsableToolName(block.name)) continue;
      blockCount += 1;
      yield {
        type: "block-end",
        index,
        block: {
          type: "tool-call",
          id: ToolCallId2(block.callId ?? ""),
          name: block.name,
          arguments: isTruncatedArguments(block.text) ? block.text : normalizeToolArguments(block.text)
        }
      };
    }
    if (textBlock !== void 0) {
      let textOut = textBlock.text;
      {
        const split = splitThinkTaggedContent(textBlock.text);
        if (split !== void 0) {
          if (split.reasoning !== "") {
            const existing = blocks.find((candidate) => candidate.kind === "reasoning");
            if (existing === void 0) {
              blocks.push({ index: nextIndex++, kind: "reasoning", text: split.reasoning });
            } else {
              existing.text += split.reasoning;
            }
            suppressor.feed(split.reasoning);
          }
          textOut = split.text;
        }
      }
      textOut = stripBareThinkCloseTagIfEnabled(textOut);
      const truncated = proseLoopDetected && proseLoopGuard?.cutAt !== void 0 ? textOut.slice(0, proseLoopGuard.cutAt) : textOut;
      const cleaned = stripCourseLeakIfEnabled(truncated);
      if (cleaned.trim() !== "") {
        blockCount += 1;
        emittedProse = cleaned;
        yield { type: "block-end", index: textBlock.index, block: { type: "text", text: cleaned } };
      } else {
        yield { type: "block-end", index: textBlock.index, block: { type: "text", text: "" } };
      }
    }
    const reasoningBlock = blocks.find((block) => block.kind === "reasoning");
    if (reasoningBlock !== void 0 && reasoningBlock.text.trim() !== "") {
      const suppressedReasoning = suppressor.text();
      const reasoningText = loopDetected && loopGuard?.cutAt !== void 0 ? suppressedReasoning.slice(0, loopGuard.cutAt) : suppressedReasoning;
      const cleanedReasoning = stripCourseLeakIfEnabled(reasoningText);
      if (cleanedReasoning !== "") {
        blockCount += 1;
        yield { type: "block-end", index: reasoningBlock.index, block: { type: "reasoning", text: cleanedReasoning } };
      }
    }
    const argsTruncated = [...toolCalls.values()].some((block) => isTruncatedArguments(block.text));
    const droppedUnnamedCalls = [...toolCalls.values()].some((block) => !block.announced);
    const proseCutByStopString = finishReason === "stop" && toolOrder.length === 0 && isProseTruncatedByStopString(emittedProse);
    const reasoningLoopIsSoleOutput = loopDetected && emittedProse === "" && toolOrder.length === 0;
    const reason = reasoningLoopIsSoleOutput ? { kind: "error", failure: reasoningLoopFailure(
      loopGuard?.diagnostics,
      options.maxTokens,
      "reasoning"
    ) } : loopDetected ? { kind: "max-tokens" } : finishReason === "length" || finishReason === void 0 && toolOrder.length > 0 || argsTruncated || proseCutByStopString || droppedUnnamedCalls && toolOrder.length === 0 ? { kind: "max-tokens" } : finishReason === "tool_calls" || toolOrder.length > 0 ? { kind: "tool-calls" } : { kind: "stop" };
    yield { type: "finish", reason: resolveEmptyResponseReason(reason, blockCount) };
  }
};
function registerTraeLlm(ctx, options) {
  const product = options.product ?? TRAE;
  const adapter = withQueueAccountRotation(product.id, options, (scoped) => new TraeAdapter(scoped));
  registerAdapterIdempotent(ctx.llm, [product.id], adapter);
  return adapter;
}

// vendor/channel-pack/src/account-probe.ts
var TRAE_PROVIDER_ID = "trae";
var PROBE_PROMPT = "\u53EA\u56DE\u7B54\u4E24\u4E2A\u5B57\uFF1A\u6536\u5230";
var PROBE_SYSTEM = "You are a helpful assistant.";
var PROBE_TIMEOUT_MS = 12e4;
var PROBE_CANDIDATES_MAX = 4;
var PROBE_ATTEMPT_TIMEOUT_MS = 2e4;
var PROBE_TOTAL_BUDGET_MS = 8e4;
function isRateLimitFailure(error) {
  if (error instanceof LlmError8) {
    if (error.code === "RATE_LIMIT" || error.code === "QUOTA_EXCEEDED" || error.code === "QUOTA") return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return isRateLimited(message);
}
async function probeWithAdapter(entry, credential, modelId, timeoutMs) {
  if (!isSupportedProvider(entry.provider)) throw new Error("provider-unsupported: \u4E0D\u652F\u6301\u6B64\u6E20\u9053");
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const ref = credentialRef2(entry.credentialRef);
  const qoderProduct = qoderProductById(entry.provider);
  let adapter;
  if (qoderProduct !== void 0) {
    adapter = new QoderAdapter({
      credentialRef: ref,
      resolveCredential: async () => credential,
      refresh: async () => {
      },
      product: qoderProduct
    });
  } else if (entry.provider === TRAE_PROVIDER_ID) {
    adapter = new TraeAdapter({
      credentialRef: ref,
      resolveCredential: async () => credential,
      refresh: async () => {
      }
    });
  } else {
    throw new Error(`Unsupported probe adapter: ${entry.provider}`);
  }
  try {
    for await (const _chunk of adapter.stream({
      provider: entry.provider,
      model: modelId,
      messages: [createUserMessage({
        content: [{ type: "text", text: PROBE_PROMPT }],
        source: { kind: "user" }
      })],
      // 「first message is not system prompt」（伪装成安全策略拦截），
      // 使重测恒不可用。详见 PROBE_SYSTEM 的注释。
      system: PROBE_SYSTEM,
      signal
    })) {
    }
    return { modelId, ok: true, ms: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isRateLimitFailure(error)) {
      const parsed = parseRateLimitError(message, modelId);
      return {
        modelId,
        ok: false,
        message: `\u4ECD\u53D7\u9650\uFF1A${message}`,
        ...parsed !== null ? { resetTimeMs: parsed.resetTimeMs } : {},
        ms: Date.now() - startedAt
      };
    }
    return { modelId, ok: false, message: `\u65E0\u6CD5\u786E\u8BA4\uFF1A${message}`, ms: Date.now() - startedAt };
  }
}
function makeDefaultProbe(pool, timeoutMs) {
  return async (entry, modelId) => {
    const credential = await pool.resolveCredentialForAccount(entry.id);
    if (credential === void 0) {
      return { modelId, ok: false, message: "\u65E0\u6CD5\u786E\u8BA4\uFF1A\u51ED\u636E\u4E0D\u53EF\u7528" };
    }
    return probeWithAdapter(entry, credential, modelId, timeoutMs);
  };
}
async function retestAccount(pool, accountId, deps = {}) {
  const entry = pool.findAccount(accountId);
  if (entry === void 0) {
    return { accountId, tested: 0, cleared: [], stillLimited: [], error: `\u8D26\u53F7 ${accountId} \u4E0D\u5B58\u5728` };
  }
  const modelIds = Object.keys(entry.modelRateLimits ?? {});
  const result = {
    accountId,
    nickname: entry.nickname,
    tested: modelIds.length,
    cleared: [],
    stillLimited: []
  };
  if (modelIds.length === 0) return result;
  const probe = deps.probe ?? makeDefaultProbe(pool, deps.timeoutMs ?? PROBE_TIMEOUT_MS);
  for (const modelId of modelIds) {
    const outcome = await probe(entry, modelId);
    if (outcome.ok) result.cleared.push(modelId);
    else result.stillLimited.push(outcome);
  }
  if (result.cleared.length > 0) {
    await pool.clearModelRateLimits(accountId, result.cleared);
  }
  for (const outcome of result.stillLimited) {
    if (outcome.resetTimeMs === void 0) continue;
    await pool.updateModelRateLimit(accountId, outcome.modelId, outcome.resetTimeMs);
  }
  return result;
}
async function retestAllAccounts(pool, provider, deps = {}) {
  const entries = pool.listAccountsByProvider(provider);
  const accounts = [];
  for (const entry of entries) {
    accounts.push(await retestAccount(pool, entry.id, deps));
  }
  return {
    accounts,
    clearedCount: accounts.reduce((sum, a) => sum + a.cleared.length, 0)
  };
}
function pickTestModels(entry, catalogIds, requested, max = PROBE_CANDIDATES_MAX) {
  if (typeof requested === "string" && requested !== "") return [requested];
  const seen = /* @__PURE__ */ new Set();
  const picked = [];
  for (const id of [...Object.keys(entry.modelRateLimits ?? {}), ...catalogIds]) {
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    picked.push(id);
    if (picked.length >= max) break;
  }
  return picked;
}
async function testAccountCandidates(pool, accountId, modelIds, deps = {}) {
  const startedAt = Date.now();
  const tried = [];
  let value;
  for (const [index, modelId] of modelIds.entries()) {
    const remaining = PROBE_TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 0) break;
    const timeoutMs = index === modelIds.length - 1 ? remaining : Math.min(remaining, PROBE_ATTEMPT_TIMEOUT_MS);
    const outcome = await testAccount(pool, accountId, modelId, { ...deps, timeoutMs });
    tried.push({ modelId: outcome.modelId, ok: outcome.ok, ...outcome.message === void 0 ? {} : { message: outcome.message } });
    value ??= outcome;
    if (outcome.ok) {
      value = outcome;
      break;
    }
  }
  return {
    ...value ?? { accountId, modelId: modelIds[0] ?? "", ok: false, message: "\u6CA1\u6709\u53EF\u6D4B\u8BD5\u7684\u6A21\u578B" },
    ms: Date.now() - startedAt,
    tried
  };
}
async function testAccount(pool, accountId, modelId, deps = {}) {
  const entry = pool.findAccount(accountId);
  if (entry === void 0) {
    return { accountId, modelId, ok: false, message: `\u8D26\u53F7 ${accountId} \u4E0D\u5B58\u5728` };
  }
  const probe = deps.probe ?? makeDefaultProbe(pool, deps.timeoutMs ?? PROBE_TIMEOUT_MS);
  let outcome;
  try {
    outcome = await probe(entry, modelId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { accountId, modelId, ok: false, message: `\u65E0\u6CD5\u786E\u8BA4\uFF1A${reason}` };
  }
  return {
    accountId,
    ...entry.nickname === void 0 ? {} : { nickname: entry.nickname },
    modelId: outcome.modelId,
    ok: outcome.ok,
    ...outcome.message === void 0 ? {} : { message: outcome.message },
    ...outcome.resetTimeMs === void 0 ? {} : { resetTimeMs: outcome.resetTimeMs }
  };
}
async function resetAccount(pool, accountId) {
  const cleared = await pool.clearModelRateLimits(accountId);
  return { clearedCount: cleared, accountCount: cleared > 0 ? 1 : 0 };
}
async function resetAllAccounts(pool, provider) {
  const entries = pool.listAccountsByProvider(provider);
  let clearedCount = 0;
  let accountCount = 0;
  for (const entry of entries) {
    const cleared = await pool.clearModelRateLimits(entry.id);
    if (cleared > 0) {
      clearedCount += cleared;
      accountCount++;
    }
  }
  return { clearedCount, accountCount };
}

// vendor/channel-pack/src/backup.ts
import { credentialRef as credentialRef3 } from "@deepseek-ai/dsh-credentials";

// vendor/channel-pack/src/types.ts
var BACKUP_FORMAT = "channel-pack/backup";
var BACKUP_VERSION = 1;

// vendor/channel-pack/src/backup.ts
var BackupFormatError = class extends Error {
};
async function exportBackup(pool, credentials) {
  const state = pool.getStateSnapshot();
  const exported = {};
  const warnings = [];
  for (const entry of state.accounts) {
    try {
      const resolved = await credentials.resolve(credentialRef3(entry.credentialRef));
      if (resolved === void 0) {
        warnings.push(`${entry.id}: \u51ED\u636E\u672A\u914D\u7F6E`);
      } else {
        exported[entry.credentialRef] = resolved.value;
      }
    } catch (error) {
      warnings.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    payload: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      credentials: exported,
      accounts: state.accounts,
      disabledModels: state.disabledModels
    },
    warnings
  };
}
function assertBackupPayload(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackupFormatError("\u5907\u4EFD\u5185\u5BB9\u4E0D\u662F\u5BF9\u8C61");
  }
  const record = value;
  if (typeof record.format !== "string" || !/^[a-z][a-z0-9-]*\/backup$/i.test(record.format)) {
    throw new BackupFormatError(`\u4E0D\u662F ${BACKUP_FORMAT} \u5907\u4EFD\u6587\u4EF6\uFF08format=${String(record.format)}\uFF09`);
  }
  if (record.version !== BACKUP_VERSION) {
    throw new BackupFormatError(`\u4E0D\u652F\u6301\u7684\u5907\u4EFD\u7248\u672C\uFF1A${String(record.version)}\uFF08\u5F53\u524D\u652F\u6301 v${BACKUP_VERSION}\uFF09`);
  }
  if (typeof record.exportedAt !== "string") {
    throw new BackupFormatError("\u5907\u4EFD\u7F3A\u5C11 exportedAt \u5B57\u6BB5");
  }
  if (typeof record.credentials !== "object" || record.credentials === null || Array.isArray(record.credentials)) {
    throw new BackupFormatError("\u5907\u4EFD credentials \u5B57\u6BB5\u65E0\u6548");
  }
  if (!Array.isArray(record.accounts)) {
    throw new BackupFormatError("\u5907\u4EFD accounts \u5B57\u6BB5\u65E0\u6548");
  }
  if (typeof record.disabledModels !== "object" || record.disabledModels === null || Array.isArray(record.disabledModels)) {
    throw new BackupFormatError("\u5907\u4EFD disabledModels \u5B57\u6BB5\u65E0\u6548");
  }
}
async function importBackup(credentials, pool, raw) {
  assertBackupPayload(raw);
  const payload = raw;
  const skipped = [];
  let credentialsImported = 0;
  for (const [refName, value] of Object.entries(payload.credentials)) {
    if (typeof value !== "string") {
      skipped.push(refName);
      continue;
    }
    try {
      await credentials.set(credentialRef3(refName), value);
      credentialsImported++;
    } catch (error) {
      skipped.push(refName);
    }
  }
  await pool.replaceAll(payload.accounts, payload.disabledModels);
  const now = Date.now();
  const expiredAccounts = payload.accounts.filter(
    (entry) => typeof entry.expiresAt === "number" && Number.isFinite(entry.expiresAt) && entry.expiresAt <= now
  ).length;
  const skippedSet = new Set(skipped);
  const missingCredentials = payload.accounts.filter(
    (entry) => !Object.prototype.hasOwnProperty.call(payload.credentials, entry.credentialRef) || skippedSet.has(entry.credentialRef)
  ).length;
  return {
    credentialsImported,
    accountsImported: payload.accounts.length,
    skipped,
    expiredAccounts,
    missingCredentials
  };
}

// vendor/channel-pack/src/badge-preferences.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readFileSync as readFileSync8, renameSync as renameSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join5 } from "node:path";
var BADGE_PREFERENCES_FILE = "ui-preferences.json";
var BADGE_PREFERENCES = ["auto", "subscription", "credits"];
var DEFAULT_BADGE_PREFERENCE = "auto";
function sanitizeBadgePreference(raw) {
  return typeof raw === "string" && BADGE_PREFERENCES.includes(raw) ? raw : DEFAULT_BADGE_PREFERENCE;
}
var MemoryPreferenceStore = class {
  kind = "memory";
  preference = DEFAULT_BADGE_PREFERENCE;
  load() {
    return this.preference;
  }
  async save(preference) {
    this.preference = preference;
  }
};
var FilePreferenceStore = class {
  constructor(path, logger2) {
    this.path = path;
    this.logger = logger2;
  }
  kind = "file";
  load() {
    try {
      if (!existsSync6(this.path)) return DEFAULT_BADGE_PREFERENCE;
      const parsed = JSON.parse(readFileSync8(this.path, "utf-8"));
      return sanitizeBadgePreference(preferenceFieldOf(parsed));
    } catch (error) {
      this.logger?.warn(`[channel-pack] \u8BFB\u53D6 ${this.path} \u5931\u8D25\uFF0C\u7528\u91CF\u5FBD\u6807\u504F\u597D\u6309\u9ED8\u8BA4\u503C\u5904\u7406: ${String(error)}`);
      return DEFAULT_BADGE_PREFERENCE;
    }
  }
  async save(preference) {
    mkdirSync4(join5(this.path, ".."), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync4(tmp, JSON.stringify({ schema: SCHEMA3, badgePreference: preference }, null, 2), "utf-8");
    renameSync4(tmp, this.path);
  }
};
var SCHEMA3 = "channel-pack/ui-preferences/v1";
function preferenceFieldOf(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return parsed;
  const record = parsed;
  return record.badgePreference;
}
function createBadgePreferenceStore(ctx) {
  const home = resolveChannelPackHome(ctx);
  if (home === void 0) {
    ctx.logger?.warn?.("[channel-pack] \u65E0\u6CD5\u5B9A\u4F4D DSH home\uFF0C\u7528\u91CF\u5FBD\u6807\u504F\u597D\u4EC5\u5B58\u5728\u4E8E\u5185\u5B58\u4E2D");
    return new MemoryPreferenceStore();
  }
  return new FilePreferenceStore(join5(home, "channel-pack", BADGE_PREFERENCES_FILE), ctx.logger);
}

// vendor/channel-pack/src/ttl-cache.ts
var TtlCache = class {
  entry;
  inflight;
  ttlMs;
  ttlFor;
  load;
  now;
  constructor(options) {
    this.ttlMs = options.ttlMs;
    this.ttlFor = options.ttlFor;
    this.load = options.load;
    this.now = options.now ?? (() => Date.now());
  }
  /**
   * 取缓存值；过期则重新加载。
   *
   * @param options.force - 强制绕过缓存重新加载（用于「服务端拒绝后刷新配置」）。
   */
  async get(options = {}) {
    if (options.force !== true) {
      const hit = this.peek();
      if (hit !== void 0) return hit.value;
    }
    if (this.inflight !== void 0) return await this.inflight;
    const task = (async () => {
      const value = await this.load();
      this.write(value);
      return value;
    })();
    this.inflight = task;
    try {
      return await task;
    } finally {
      this.inflight = void 0;
    }
  }
  /**
   * 只看缓存（**不触发加载**）。过期返回 `undefined` 并顺手丢弃。
   *
   * 诊断与单测用；`get()` 内部也走它，避免两处 TTL 判据漂移。
   */
  peek() {
    const entry = this.entry;
    if (entry === void 0) return void 0;
    if (this.now() - entry.atMs >= entry.ttlMs) {
      this.entry = void 0;
      return void 0;
    }
    return entry;
  }
  /** 写入一个已知值（例如从别处拿到的新配置，避免下一次白加载）。 */
  set(value) {
    this.write(value);
  }
  /** 写入缓存项：有效期在**这一刻**定下（见 `TtlCacheOptions.ttlFor`）。 */
  write(value) {
    this.entry = { value, atMs: this.now(), ttlMs: this.effectiveTtl(value) };
  }
  /** 这一条该缓存多久；`ttlFor` 缺省或返回非法值时用构造参数。 */
  effectiveTtl(value) {
    if (this.ttlFor === void 0) return this.ttlMs;
    const ttl = this.ttlFor(value);
    return Number.isFinite(ttl) && ttl >= 0 ? ttl : this.ttlMs;
  }
  /** 清空（关停时调用）。 */
  clear() {
    this.entry = void 0;
    this.inflight = void 0;
  }
};

// vendor/channel-pack/src/badge-subscription.ts
var BALANCE_PLAN_LABEL = "\u5957\u9910";
var qoderPlanSelector = Object.freeze({
  kind: "package",
  matches: (name) => name === QODER_PLAN_PACKAGE
});
var BADGE_PLAN_SELECTORS = Object.freeze({
  qoder: qoderPlanSelector,
  qodercn: qoderPlanSelector
});
function badgePlanSelectorFor(provider) {
  return BADGE_PLAN_SELECTORS[provider];
}
function badgePlanFor(provider, balance) {
  if (balance === null) return null;
  const selector = badgePlanSelectorFor(provider);
  if (selector === void 0) return null;
  if (selector.kind === "balance") {
    const active = balance.packages.filter((pkg) => pkg.active === true);
    const capacity = active.reduce((sum, pkg) => sum + pkg.total, 0);
    return {
      name: BALANCE_PLAN_LABEL,
      remaining: balance.total,
      total: capacity > 0 ? capacity : balance.total,
      unit: unitOf(balance.packages)
    };
  }
  const matched = balance.packages.filter((pkg) => pkg.active === true && selector.matches(pkg.name)).sort((a, b) => b.remaining - a.remaining);
  const best = matched[0];
  if (best === void 0) return null;
  return {
    name: best.name,
    remaining: best.remaining,
    total: best.total,
    // ⚠️ 下发前归一：包上的 `unit` 是服务端原值（实测同账号内 `credit` 与
    // `credits` 并存），原样下发会让客户端把同一份套餐拆成两组。见 `unitOf`。
    unit: normalizeCreditUnit(best.unit),
    ...best.deductionEndTime === void 0 ? {} : { deductionEndTime: best.deductionEndTime }
  };
}
function unitOf(packages) {
  const raw = packages.find((pkg) => typeof pkg.unit === "string" && pkg.unit.length > 0)?.unit ?? "";
  return normalizeCreditUnit(raw);
}

// vendor/channel-pack/src/usage-badge.ts
var DSH_CHANNEL_PACK_BADGE_TTL_MS = "DSH_CHANNEL_PACK_BADGE_TTL_MS";
var BADGE_TTL_MS = 12e4;
var BADGE_FAILURE_TTL_MS = 15e3;
function badgeTtlMs(env = process.env) {
  return nonNegativeMs(env[DSH_CHANNEL_PACK_BADGE_TTL_MS], BADGE_TTL_MS);
}
function badgeFailureTtlMs(env = process.env) {
  return nonNegativeMs(env[DSH_CHANNEL_PACK_BADGE_TTL_MS], BADGE_FAILURE_TTL_MS);
}
function nonNegativeMs(raw, fallback) {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
var BadgeRpcFailure = class extends Error {
  constructor(detail) {
    super(detail.message);
    this.detail = detail;
    this.name = "BadgeRpcFailure";
  }
};
function createUsageBadge(deps) {
  const now = deps.now ?? (() => Date.now());
  const ttlMs2 = deps.ttlMs ?? badgeTtlMs();
  const failureTtlMs = deps.failureTtlMs ?? badgeFailureTtlMs();
  const caches = /* @__PURE__ */ new Map();
  function cacheFor(provider) {
    const existing = caches.get(provider);
    if (existing !== void 0) return existing;
    const created = new TtlCache({
      ttlMs: ttlMs2,
      ttlFor: (snapshot) => isAllFailed(snapshot) ? failureTtlMs : ttlMs2,
      now,
      load: () => loadSnapshot(provider)
    });
    caches.set(provider, created);
    return created;
  }
  async function loadSnapshot(provider) {
    const balances = await deps.collectBalances(provider);
    if (!balances.ok) throw new BadgeRpcFailure(balances.error);
    const pool = deps.listAccounts(provider);
    const enabledIds = new Set(pool.filter((entry) => entry.enabled !== false).map((entry) => entry.id));
    const accounts = balances.value.accounts.filter((row) => enabledIds.has(row.accountId));
    const snapshot = {
      at: now(),
      accounts,
      disabledCount: pool.length - enabledIds.size,
      ...balances.value.windowDays === void 0 ? {} : { windowDays: balances.value.windowDays }
    };
    const subscription = await subscriptionOf(provider, enabledIds, accounts);
    if (subscription !== void 0) snapshot.subscription = subscription;
    return snapshot;
  }
  async function subscriptionOf(provider, enabledIds, accounts) {
    if (deps.collectQuota !== void 0) {
      try {
        const quota = await deps.collectQuota(provider);
        if (quota !== void 0) {
          if (!quota.ok) {
            deps.warn?.(`[channel-pack] \u7528\u91CF\u5FBD\u6807\uFF1A${provider} \u7684\u8BA2\u9605\u7A97\u53E3\u8BFB\u53D6\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u4F59\u989D\uFF09\uFF1A${quota.error.message}`);
            return void 0;
          }
          return {
            kind: "windows",
            // 与余额同一口径：只列启用账号（订阅接口自己的账号列表含停用账号）。
            accounts: quota.value.accounts.filter((row) => enabledIds.has(row.accountId))
          };
        }
      } catch (error) {
        deps.warn?.(`[channel-pack] \u7528\u91CF\u5FBD\u6807\uFF1A${provider} \u7684\u8BA2\u9605\u7A97\u53E3\u8BFB\u53D6\u629B\u9519\uFF08\u4E0D\u5F71\u54CD\u4F59\u989D\uFF09\uFF1A${String(error)}`);
        return void 0;
      }
    }
    if (badgePlanSelectorFor(provider) === void 0) return void 0;
    const rows = accounts.map((row) => ({
      accountId: row.accountId,
      nickname: row.nickname,
      plan: badgePlanFor(provider, row.balance),
      ...row.error === void 0 ? {} : { error: row.error }
    }));
    return rows.some((row) => row.plan !== null) ? { kind: "plan", accounts: rows } : void 0;
  }
  return {
    async read(provider, options = {}) {
      const cache2 = cacheFor(provider);
      const force = options.force === true;
      const hit = force ? void 0 : cache2.peek();
      let snapshot;
      try {
        snapshot = await cache2.get(force ? { force: true } : {});
      } catch (error) {
        if (error instanceof BadgeRpcFailure) return { ok: false, error: error.detail };
        throw error;
      }
      return {
        ok: true,
        value: {
          provider,
          generatedAt: snapshot.at,
          cached: hit !== void 0,
          accounts: snapshot.accounts,
          disabledCount: snapshot.disabledCount,
          ...snapshot.windowDays === void 0 ? {} : { windowDays: snapshot.windowDays },
          ...snapshot.subscription === void 0 ? {} : { subscription: snapshot.subscription },
          // 偏好**不进缓存**：它是用户随时可改的展示设置，缓存住会让「刚改完
          // 没生效」看起来像 bug（快照本身可能还是两分钟前的）。
          preference: deps.readPreference(),
          // 同理不进缓存：后台任务的进度与「今天已跑」都要实时反映到状态灯上。
          autoCheckin: deps.readAutoCheckin()
        }
      };
    },
    clear() {
      for (const cache2 of caches.values()) cache2.clear();
      caches.clear();
    }
  };
}
function isAllFailed(snapshot) {
  return snapshot.accounts.length > 0 && snapshot.accounts.every((row) => row.error !== void 0);
}

// vendor/channel-pack/src/auto-checkin.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync5, readFileSync as readFileSync9, renameSync as renameSync5, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join6 } from "node:path";
var AUTO_CHECKIN_FILE = "auto-checkin.json";
var SCHEMA4 = "channel-pack/auto-checkin/v1";
var DEFAULT_AUTO_CHECKIN = {
  enabled: true,
  lastDate: "",
  lastResult: "",
  lastAt: 0,
  channels: [],
  dismissedRunAt: 0
};
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var MAX_CHANNEL_ENTRIES = 24;
function sanitizeChannels(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item;
    if (typeof record.provider !== "string" || record.provider.length === 0) continue;
    if (typeof record.text !== "string") continue;
    out.push({ provider: record.provider, text: record.text.slice(0, 120) });
    if (out.length >= MAX_CHANNEL_ENTRIES) break;
  }
  return out;
}
function sanitizeAutoCheckin(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_AUTO_CHECKIN };
  const record = raw;
  const ms = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  return {
    // ⚠️ **只有显式 `false` 才算关闭**（默认是打开的，见 `AutoCheckinDoc.enabled`）：
    // 写成 `=== true` 会让旧文档（没有该字段）与脏数据把开关静默关掉，与
    // 「默认保持打开状态」相反。`'false'` / `0` 这些非布尔值一律按打开处理 ——
    // 它们不是用户点出来的值。
    enabled: record.enabled !== false,
    lastDate: typeof record.lastDate === "string" && DATE_RE.test(record.lastDate) ? record.lastDate : "",
    lastResult: typeof record.lastResult === "string" ? record.lastResult : "",
    lastAt: ms(record.lastAt),
    channels: sanitizeChannels(record.channels),
    dismissedRunAt: ms(record.dismissedRunAt)
  };
}
function utc8DateString(nowMs = Date.now()) {
  return new Date(nowMs + QODER_BILLING_UTC_OFFSET_MS).toISOString().slice(0, 10);
}
var DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS = "DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS";
var AUTO_CHECKIN_DELAY_MS = 3e4;
function autoCheckinDelayMs(env = process.env) {
  const raw = env[DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS];
  if (typeof raw !== "string" || raw.trim().length === 0) return AUTO_CHECKIN_DELAY_MS;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : AUTO_CHECKIN_DELAY_MS;
}
var MemoryAutoCheckinStore = class {
  kind = "memory";
  doc = { ...DEFAULT_AUTO_CHECKIN };
  load() {
    return { ...this.doc };
  }
  async save(doc) {
    this.doc = { ...doc };
  }
};
var FileAutoCheckinStore = class {
  constructor(path, logger2) {
    this.path = path;
    this.logger = logger2;
  }
  kind = "file";
  load() {
    try {
      if (!existsSync7(this.path)) return { ...DEFAULT_AUTO_CHECKIN };
      return sanitizeAutoCheckin(JSON.parse(readFileSync9(this.path, "utf-8")));
    } catch (error) {
      this.logger?.warn(`[channel-pack] \u8BFB\u53D6 ${this.path} \u5931\u8D25\uFF0C\u81EA\u52A8\u7B7E\u5230\u6309\u9ED8\u8BA4\u8BBE\u7F6E\uFF08\u5F00\u542F\uFF09\u5904\u7406: ${String(error)}`);
      return { ...DEFAULT_AUTO_CHECKIN };
    }
  }
  async save(doc) {
    mkdirSync5(join6(this.path, ".."), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync5(tmp, JSON.stringify({
      schema: SCHEMA4,
      enabled: doc.enabled,
      lastDate: doc.lastDate,
      lastResult: doc.lastResult,
      lastAt: doc.lastAt,
      channels: doc.channels,
      dismissedRunAt: doc.dismissedRunAt
    }, null, 2), "utf-8");
    renameSync5(tmp, this.path);
  }
};
function createAutoCheckinStore(ctx) {
  const home = resolveChannelPackHome(ctx);
  if (home === void 0) {
    ctx.logger?.warn?.("[channel-pack] \u65E0\u6CD5\u5B9A\u4F4D DSH home\uFF0C\u81EA\u52A8\u7B7E\u5230\u5F00\u5173\u4EC5\u5B58\u5728\u4E8E\u5185\u5B58\u4E2D");
    return new MemoryAutoCheckinStore();
  }
  return new FileAutoCheckinStore(join6(home, "channel-pack", AUTO_CHECKIN_FILE), ctx.logger);
}
function emptyTotals2() {
  return { providers: 0, claimed: 0, totalCredit: 0, totalByUnit: { token: 0, credit: 0 }, alreadyClaimed: 0, inactive: 0, failed: 0, coversToday: 0, skipped: 0, errors: 0 };
}
function isUnsupportedCheckin(message) {
  return message.includes("\u4E0D\u652F\u6301\u6BCF\u65E5\u7B7E\u5230") || message.includes("unsupported provider");
}
function isAutoCheckinExcluded(_provider) {
  return false;
}
function describeRun(totals) {
  const parts = [];
  if (totals.claimed > 0) {
    const amounts = formatClaimGains(totals.totalByUnit ?? { credit: totals.totalCredit });
    parts.push(`${totals.claimed} \u4E2A\u8D26\u53F7\u9886\u53D6\u6210\u529F${amounts === null ? "" : `\uFF08${amounts}\uFF09`}`);
  }
  if (totals.alreadyClaimed > 0) parts.push(`${totals.alreadyClaimed} \u4E2A\u4ECA\u5929\u5DF2\u9886`);
  if (totals.failed > 0) parts.push(`${totals.failed} \u4E2A\u5931\u8D25`);
  if (totals.errors > 0) parts.push(`${totals.errors} \u4E2A\u6E20\u9053\u51FA\u9519`);
  if (totals.skipped > 0) parts.push(`${totals.skipped} \u4E2A\u6E20\u9053\u4E0D\u652F\u6301\u7B7E\u5230`);
  if (parts.length === 0) return `${totals.providers} \u4E2A\u6E20\u9053\uFF1A\u6CA1\u6709\u9700\u8981\u9886\u53D6\u7684\u8D26\u53F7`;
  return `${totals.providers} \u4E2A\u6E20\u9053\uFF1A${parts.join("\uFF0C")}`;
}
function shouldMarkToday(totals) {
  return totals.coversToday > 0;
}
function describeChannel(summary) {
  const parts = [];
  if (summary.claimed > 0) {
    const amounts = formatClaimGains(summary.totalByUnit ?? { credit: summary.totalCredit });
    parts.push(amounts === null ? `${summary.claimed} \u4E2A\u9886\u53D6\u6210\u529F` : `${summary.claimed} \u4E2A ${amounts}`);
  }
  if (summary.alreadyClaimed > 0) parts.push(`${summary.alreadyClaimed} \u4E2A\u4ECA\u5929\u5DF2\u9886`);
  if (summary.failed > 0) parts.push(`${summary.failed} \u4E2A\u5931\u8D25`);
  if (summary.inactive > 0) parts.push(`${summary.inactive} \u4E2A\u672A\u5F00\u542F`);
  if (parts.length === 0) return "\u65E0\u53EF\u9886";
  const coversToday = summary.coversToday ?? summary.claimed + summary.alreadyClaimed;
  if (coversToday === 0 && summary.claimed + summary.alreadyClaimed > 0) {
    parts.push("\u975E\u4ECA\u65E5\u8F6E\u6B21");
  }
  return parts.join("\uFF0C");
}
function createAutoCheckin(deps) {
  const now = deps.now ?? (() => Date.now());
  let doc = deps.store.load();
  let running2 = false;
  let inflight = null;
  let pending = null;
  const today = () => utc8DateString(now());
  function state() {
    return {
      enabled: doc.enabled,
      lastDate: doc.lastDate,
      ranToday: doc.lastDate !== "" && doc.lastDate === today(),
      running: running2,
      lastResult: doc.lastResult,
      lastAt: doc.lastAt,
      channels: doc.channels.map((entry) => ({ ...entry })),
      // 面板据它决定要不要渲染那行常驻状态文字
      dismissed: doc.lastAt > 0 && doc.dismissedRunAt === doc.lastAt
    };
  }
  async function performRun() {
    const totals = emptyTotals2();
    let providers = [];
    try {
      providers = [...new Set(await deps.listProviderIds())].sort();
    } catch (error) {
      deps.warn?.(`[channel-pack] \u81EA\u52A8\u7B7E\u5230\uFF1A\u8BFB\u53D6\u8D26\u53F7\u6C60\u5931\u8D25\uFF0C\u672C\u6B21\u8DF3\u8FC7: ${String(error)}`);
      return;
    }
    const channels = [];
    for (const provider of providers) {
      if (isAutoCheckinExcluded(provider)) {
        totals.skipped += 1;
        channels.push({ provider, text: "\u9700\u624B\u52A8\u7B7E\u5230" });
        continue;
      }
      let result;
      try {
        result = await deps.claim(provider);
      } catch (error) {
        totals.errors += 1;
        channels.push({ provider, text: "\u51FA\u9519" });
        deps.warn?.(`[channel-pack] \u81EA\u52A8\u7B7E\u5230\uFF1A${provider} \u8C03\u7528\u5F02\u5E38: ${String(error)}`);
        continue;
      }
      if (!result.ok) {
        const message = typeof result.error?.message === "string" ? result.error.message : "";
        if (isUnsupportedCheckin(message)) {
          totals.skipped += 1;
          channels.push({ provider, text: "\u65E0\u7B7E\u5230\u63A5\u53E3" });
          continue;
        }
        totals.errors += 1;
        channels.push({ provider, text: "\u51FA\u9519" });
        deps.warn?.(`[channel-pack] \u81EA\u52A8\u7B7E\u5230\uFF1A${provider} \u5931\u8D25: ${message || "\u672A\u77E5\u9519\u8BEF"}`);
        continue;
      }
      totals.providers += 1;
      const summary = result.value?.summary;
      if (summary === void 0) {
        channels.push({ provider, text: "\u65E0\u53EF\u9886" });
        continue;
      }
      totals.claimed += summary.claimed;
      totals.totalCredit += summary.totalCredit;
      const byUnit = summary.totalByUnit ?? { credit: summary.totalCredit, token: 0 };
      totals.totalByUnit.credit += Number(byUnit.credit) || 0;
      totals.totalByUnit.token += Number(byUnit.token) || 0;
      totals.alreadyClaimed += summary.alreadyClaimed;
      totals.inactive += summary.inactive;
      totals.failed += summary.failed;
      totals.coversToday += summary.coversToday ?? summary.claimed + summary.alreadyClaimed;
      channels.push({ provider, text: describeChannel(summary) });
    }
    if (!shouldMarkToday(totals)) {
      deps.warn?.(
        `[channel-pack] \u81EA\u52A8\u7B7E\u5230\u672A\u8BB0\u5165\u4ECA\u65E5\uFF08\u4E0B\u6B21\u542F\u52A8\u4F1A\u91CD\u8BD5\uFF09\uFF1A${describeRun(totals)}`
      );
      return;
    }
    doc = {
      ...doc,
      lastDate: today(),
      lastResult: describeRun(totals),
      lastAt: now(),
      channels,
      // ⚠️ 新一轮跑完要**清掉上一次的「已关闭」标记**：否则用户关过一次后，
      // 明天的新结果会被旧标记静默藏住（`dismissed` 的判据是 lastAt 相等）。
      dismissedRunAt: 0
    };
    try {
      await deps.store.save(doc);
    } catch (error) {
      deps.warn?.(`[channel-pack] \u81EA\u52A8\u7B7E\u5230\u7ED3\u679C\u5199\u5165\u5931\u8D25\uFF08\u4ECA\u5929\u53EF\u80FD\u91CD\u590D\u89E6\u53D1\u4E00\u6B21\uFF09: ${String(error)}`);
    }
    deps.warn?.(`[channel-pack] \u81EA\u52A8\u7B7E\u5230\u5B8C\u6210\uFF08${today()}\uFF09\uFF1A${doc.lastResult}`);
  }
  function runIfDue() {
    if (inflight !== null) return inflight;
    if (!doc.enabled) return Promise.resolve();
    if (doc.lastDate !== "" && doc.lastDate === today()) return Promise.resolve();
    running2 = true;
    const task = performRun().catch((error) => {
      deps.warn?.(`[channel-pack] \u81EA\u52A8\u7B7E\u5230\u5F02\u5E38: ${String(error)}`);
    }).finally(() => {
      running2 = false;
      inflight = null;
    });
    inflight = task;
    return task;
  }
  return {
    state,
    async setEnabled(enabled) {
      doc = { ...doc, enabled };
      await deps.store.save(doc);
      if (enabled) void runIfDue();
      return state();
    },
    start() {
      if (pending !== null) return;
      const ms = deps.delayMs ?? autoCheckinDelayMs();
      const fire = () => {
        pending = null;
        void runIfDue();
      };
      if (ms <= 0) {
        fire();
        return;
      }
      pending = (deps.schedule ?? defaultSchedule)(fire, ms);
    },
    runIfDue,
    async dismiss() {
      doc = { ...doc, dismissedRunAt: doc.lastAt };
      try {
        await deps.store.save(doc);
      } catch (error) {
        deps.warn?.(`[channel-pack] \u81EA\u52A8\u7B7E\u5230\u72B6\u6001\u6587\u5B57\u5173\u95ED\u6807\u8BB0\u5199\u5165\u5931\u8D25: ${String(error)}`);
      }
      return state();
    },
    stop() {
      pending?.cancel();
      pending = null;
    }
  };
}
function defaultSchedule(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

// vendor/channel-pack/src/channel-pack-rpc.ts
var CHANNEL_PACK_API_PATH = "/api/channel-pack";
var CHANNEL_PACK_ENDPOINT = "channel-pack";
function shortId() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
function parseQoderCredential(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && typeof parsed.access_token === "string" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function parseTraeCredential(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && typeof parsed.access_token === "string" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function buildRaccoonNickname(credential, fallbackId) {
  const nickname = typeof credential.nickname === "string" ? credential.nickname.trim() : "";
  const phone = typeof credential.phone === "string" ? credential.phone.trim() : "";
  const userId = typeof credential.user_id === "string" ? credential.user_id.trim() : "";
  const suffix = phone.length >= 4 ? phone.slice(-4) : userId.length > 0 ? userId : "";
  if (nickname.length > 0) {
    return suffix.length > 0 && !nickname.includes(suffix) ? `${nickname} (${suffix})` : nickname;
  }
  if (suffix.length > 0) return `Raccoon ${suffix}`;
  return fallbackId;
}
function computeClaimSummary(outcomes) {
  const summary = {
    claimed: 0,
    totalCredit: 0,
    alreadyClaimed: 0,
    inactive: 0,
    failed: 0,
    coversToday: 0,
    totalByUnit: { token: 0, credit: 0 }
  };
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case "claimed":
        summary.claimed += 1;
        summary.totalCredit += outcome.credit;
        summary.totalByUnit[claimUnitOf(outcome.unit)] += outcome.credit;
        if (outcome.coversToday !== false) summary.coversToday += 1;
        break;
      case "already-claimed":
        summary.alreadyClaimed += 1;
        if (outcome.coversToday !== false) summary.coversToday += 1;
        break;
      case "inactive":
        summary.inactive += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      default: {
        const exhaustive = outcome;
        void exhaustive;
        summary.failed += 1;
        break;
      }
    }
  }
  return summary;
}
async function collectCreditsStatus(accounts, product, deps) {
  const fetchStatus = deps.fetchStatus ?? (async () => {
    throw new Error("\u8BE5\u6E20\u9053\u672A\u63D0\u4F9B\u7B7E\u5230\u72B6\u6001\u67E5\u8BE2");
  });
  const results = [];
  for (const entry of accounts) {
    let status = null;
    try {
      const resolved = await deps.resolve(credentialRef4(entry.credentialRef));
      if (resolved !== void 0) {
        const credential = JSON.parse(resolved.value);
        status = await fetchStatus(credential, product);
      }
    } catch (error) {
      deps.warn?.(`[channel-pack] credits.status \u8D26\u53F7 ${entry.id} \u5931\u8D25: ${String(error)}`);
      status = null;
    }
    results.push({ accountId: entry.id, nickname: entry.nickname, status });
  }
  return results;
}
async function collectClaimResults(accounts, product, deps) {
  const fetchStatus = deps.fetchStatus ?? (async () => {
    throw new Error("\u8BE5\u6E20\u9053\u672A\u63D0\u4F9B\u7B7E\u5230\u72B6\u6001\u67E5\u8BE2");
  });
  const claim = deps.claim ?? (async () => {
    throw new Error("\u8BE5\u6E20\u9053\u672A\u63D0\u4F9B\u7B7E\u5230\u9886\u53D6");
  });
  const precheck = deps.precheckStatus !== false;
  const results = [];
  const outcomes = [];
  for (const entry of accounts) {
    deps.signal?.throwIfAborted();
    let outcome;
    try {
      const resolved = await deps.resolve(credentialRef4(entry.credentialRef));
      if (resolved === void 0) {
        outcome = { kind: "failed", code: -1, message: "\u51ED\u636E\u672A\u914D\u7F6E" };
      } else {
        const credential = JSON.parse(resolved.value);
        if (!precheck) {
          outcome = await claim(credential, product, entry);
        } else {
          const status = await fetchStatus(credential, product);
          if (status !== null && !status.active) {
            outcome = { kind: "inactive", message: "\u7B7E\u5230\u6D3B\u52A8\u672A\u5F00\u542F", unsubmitted: true };
          } else if (status !== null && status.todayCheckedIn) {
            outcome = { kind: "already-claimed", message: "\u4ECA\u5929\u5DF2\u7B7E\u5230" };
          } else if (status === null && deps.requireStatus) {
            outcome = { kind: "failed", code: -1, message: "\u7B7E\u5230\u72B6\u6001\u8BFB\u53D6\u5931\u8D25", unsubmitted: true };
          } else {
            outcome = await claim(credential, product, entry);
          }
        }
      }
    } catch (error) {
      deps.warn?.(`[channel-pack] credits.claimAll \u8D26\u53F7 ${entry.id} \u5931\u8D25: ${String(error)}`);
      outcome = {
        kind: "failed",
        code: -1,
        message: error instanceof Error ? error.message : String(error)
      };
    }
    outcomes.push(outcome);
    results.push({ accountId: entry.id, nickname: entry.nickname, outcome });
  }
  return { results, summary: computeClaimSummary(outcomes) };
}
async function collectCreditBalances(accounts, product, deps) {
  const fetchBalance = deps.fetchBalance ?? (async () => {
    throw new Error("\u8BE5\u6E20\u9053\u672A\u63D0\u4F9B\u4F59\u989D\u67E5\u8BE2");
  });
  const fetchDetailed = deps.fetchBalanceDetailed;
  const results = [];
  for (const entry of accounts) {
    let balance = null;
    let error;
    let extra;
    try {
      const resolved = await deps.resolve(credentialRef4(entry.credentialRef));
      if (resolved === void 0) {
        error = "\u51ED\u636E\u672A\u914D\u7F6E";
      } else {
        const credential = JSON.parse(resolved.value);
        if (fetchDetailed !== void 0) {
          const detailed = await fetchDetailed(credential, product);
          balance = detailed.balance;
          error = detailed.error;
          extra = detailed.extra;
          if (balance === null && error === void 0) error = "\u4F59\u989D\u67E5\u8BE2\u5931\u8D25";
        } else {
          balance = await fetchBalance(credential, product);
          if (balance === null) error = "\u4F59\u989D\u67E5\u8BE2\u5931\u8D25";
        }
      }
    } catch (caught) {
      deps.warn?.(`[channel-pack] credits.balances \u8D26\u53F7 ${entry.id} \u5931\u8D25: ${String(caught)}`);
      error = caught instanceof Error ? caught.message : String(caught);
      balance = null;
    }
    results.push({
      accountId: entry.id,
      nickname: entry.nickname,
      balance,
      ...error === void 0 ? {} : { error },
      ...extra === void 0 ? {} : { extra }
    });
  }
  return results;
}
function llmServiceOf(ctx) {
  const direct = ctx.llm;
  if (direct !== void 0 && direct !== null) return direct;
  return ctx.get("llm");
}
async function collectGatewayCatalog(llm, providers, onError) {
  const source = {
    listProviders: () => providers,
    listModels: (provider) => llm.listModels(provider)
  };
  const resolve2 = llm?.resolveModelInfo;
  if (typeof resolve2 === "function") {
    source.resolveModelInfo = (provider, model) => resolve2.call(llm, provider, model);
  }
  const groups = await collectGatewayModels(source, onError);
  const views = await collectGatewayEffortViews(source, groups, onError);
  return toGatewayModelIds(groups, views);
}
function providerIdsOf(llm, modelAdapters) {
  if (llm?.listProviders !== void 0) {
    try {
      const listed = llm.listProviders();
      if (Array.isArray(listed) && listed.length > 0) return listed;
    } catch {
    }
  }
  const keys = Object.keys(modelAdapters ?? {});
  return keys.length > 0 ? keys.map((id) => ({ id })) : void 0;
}
function registerChannelPackRpc(ctx, pool, qoder, qoderCn, trae, raccoon, modelAdapters, config = {}) {
  ctx.inject(["connection"], (connectionCtx) => {
    registerChannelPackEndpoints(
      connectionCtx,
      pool,
      qoder,
      qoderCn,
      trae,
      raccoon,
      modelAdapters,
      config
    );
  });
}
function llmEmitAdaptersUpdated(ctx) {
  const read = (target) => {
    if (target == null) return void 0;
    try {
      return llmServiceOf(target);
    } catch {
      return void 0;
    }
  };
  const root = ctx.root;
  const llm = read(ctx) ?? (root != null && root !== ctx ? read(root) : void 0);
  llm?.emitAdaptersUpdated?.();
}
function broadcastCatalogChanged(ctx) {
  try {
    llmEmitAdaptersUpdated(ctx);
  } catch (error) {
    ctx.logger.warn(`[channel-pack] \u901A\u77E5\u6A21\u578B\u76EE\u5F55\u5237\u65B0\u5931\u8D25\uFF1A${String(error)}`);
  }
  try {
    ctx.emit("llm/adapters-updated");
  } catch (error) {
    ctx.logger.warn(`[channel-pack] \u5E7F\u64AD\u6A21\u578B\u76EE\u5F55\u53D8\u66F4\u4E8B\u4EF6\u5931\u8D25\uFF1A${String(error)}`);
  }
}
async function fullCatalogIds(ctx, modelAdapters, provider) {
  const all = modelAdapters?.[provider]?.listAllModels();
  if (all !== void 0) return { ids: all.map((model) => model.id) };
  const llm = llmServiceOf(ctx);
  if (llm === void 0) return { error: "llm \u670D\u52A1\u4E0D\u53EF\u7528" };
  try {
    return { ids: (await llm.listModels(provider)).map((model) => model.id) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: `\u8BFB\u53D6\u6A21\u578B\u5217\u8868\u5931\u8D25\uFF1A${reason}` };
  }
}
function registerChannelPackEndpoints(ctx, pool, qoder, qoderCn, trae, raccoon, modelAdapters, config = {}) {
  const connection = config.nativeOnly ? { fetch: { register: (_route) => {
  } } } : ctx.connection ?? ctx.get("connection");
  if (!connection || typeof connection.fetch?.register !== "function") {
    ctx.logger.warn("[channel-pack] connection.fetch not available, RPC endpoints not registered");
    return;
  }
  const qoderFamily = [
    { product: QODER, auth: qoder },
    { product: QODER_CN, auth: qoderCn }
  ];
  const isQoderFamily = (provider) => qoderFamily.some((member) => member.product.id === provider);
  const requireQoderFamily = (provider) => {
    const member = qoderFamily.find((item) => item.product.id === provider);
    if (member === void 0) throw new Error(`Unknown Qoder family provider: ${provider}`);
    return member;
  };
  const raccoonFamily = [
    { product: RACCOON, auth: raccoon },
    ...config.raccoonPro === void 0 ? [] : [{ product: RACCOON_PRO, auth: config.raccoonPro }]
  ];
  const isRaccoonFamily = (provider) => raccoonFamily.some((member) => member.product.id === provider);
  const requireRaccoonFamily = (provider) => {
    const member = raccoonFamily.find((item) => item.product.id === provider);
    if (member === void 0) throw new Error(`Unknown Raccoon family provider: ${provider}`);
    return member;
  };
  const pendingLoginFailures = /* @__PURE__ */ new Map();
  const badgePreferences = createBadgePreferenceStore(ctx);
  const autoCheckin = createAutoCheckin({
    store: createAutoCheckinStore(ctx),
    listProviderIds: async () => {
      const accounts = await pool.listAllAccounts();
      return [...new Set(accounts.filter((entry) => isSupportedProvider(entry.provider) && (!config.allowedProviders || config.allowedProviders.includes(entry.provider))).map((entry) => entry.provider))].sort();
    },
    claim: (provider) => handleMethod("credits.claimAll", { provider }),
    warn: (message) => ctx.logger?.warn?.(message)
  });
  if (!config.nativeOnly) autoCheckin.start();
  ctx.effect?.(() => () => autoCheckin.stop(), "channel-pack: auto checkin");
  const usageBadge = createUsageBadge({
    collectBalances: (provider) => handleMethod("credits.balances", { provider }),
    collectQuota: () => void 0,
    listAccounts: (provider) => pool.listAccountsByProvider(provider),
    readPreference: () => badgePreferences.load(),
    readAutoCheckin: () => autoCheckin.state(),
    warn: (message) => ctx.logger?.warn?.(message)
  });
  config.onRpc?.(handleMethod);
  connection.fetch.register({
    path: CHANNEL_PACK_API_PATH,
    methods: ["POST"],
    requestBody: "buffered",
    async fetch(request) {
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
      }
      const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "application/json") {
        return new Response("content type must be application/json", { status: 415 });
      }
      let message;
      try {
        message = await request.json();
      } catch {
        return new Response("body is not JSON", { status: 400 });
      }
      const rpcId = typeof message.rpcId === "string" ? message.rpcId : "invalid-request";
      const call = message.payload;
      if (message.type !== "client-request" || typeof message.rpcId !== "string" || message.method !== CHANNEL_PACK_ENDPOINT || !call || typeof call.method !== "string" || !Object.prototype.hasOwnProperty.call(call, "payload")) {
        return reply(rpcId, { ok: false, error: { code: "gateway/bad-request", message: "Invalid Channel Pack management request." } });
      }
      try {
        const result = await handleMethod(call.method, call.payload, request.signal);
        return reply(rpcId, result);
      } catch (error) {
        const message2 = error instanceof Error ? error.message : String(error);
        ctx.logger.warn(`[channel-pack] ${String(call.method)} failed: ${message2}`);
        return reply(rpcId, {
          ok: false,
          error: { code: "channel-pack/handler-failed", message: message2 }
        });
      }
    }
  });
  async function handleMethod(method, payload, signal) {
    const request = payload !== null && typeof payload === "object" ? payload : void 0;
    const account = typeof request?.accountId === "string" ? pool.findAccount(request.accountId) : void 0;
    if (config.allowedProviders) {
      const allowed = config.allowedProviders;
      if (request?.provider !== void 0 && !allowed.includes(String(request.provider)) || account !== void 0 && !allowed.includes(account.provider) || Array.isArray(request?.providers) && request.providers.some((id) => !allowed.includes(String(id)))) {
        return { ok: false, error: { code: "provider-unsupported", message: "\u4EC5\u652F\u6301\u5DF2\u542F\u7528\u7684\u6E20\u9053\u3002" } };
      }
    }
    if (request?.provider !== void 0 && !isSupportedProvider(request.provider) || account !== void 0 && !isSupportedProvider(account.provider)) {
      return { ok: false, error: { code: "provider-unsupported", message: "\u4E0D\u652F\u6301\u6B64\u6E20\u9053\u3002" } };
    }
    switch (method) {
      case "account.list": {
        const req = payload;
        const accounts = await pool.listAccounts(req.provider);
        if (req.provider === TRAE.id) {
          for (const account2 of accounts) {
            if (account2.enabled === false) continue;
            try {
              const resolved = await pool.resolveCredentialForAccount(account2.id);
              const credential = resolved;
              if (credential === void 0 || typeof credential.access_token !== "string" || credential.access_token.length === 0) continue;
              const payStatus = await fetchTraePayStatus(credential, TRAE);
              if (payStatus !== null) account2.planLabel = payStatus.identity;
            } catch {
            }
          }
        }
        if (config.nativeOnly && payload.forCheckin === true) {
          const ready = await Promise.all(accounts.map(async (account2) => (account2.expiresAt == null || account2.expiresAt > Date.now()) && !!await pool.resolveCredentialForAccount(account2.id)));
          return { ok: true, value: { accounts: accounts.filter((_account, index) => ready[index]) } };
        }
        return { ok: true, value: { accounts } };
      }
      case "account.create": {
        const req = payload;
        const { provider } = req;
        const id = `${provider}-${shortId()}`;
        const suffix = shortId().toUpperCase();
        const refName = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "")}_ACCOUNT_${suffix}`;
        if (isQoderFamily(provider)) {
          const { product, auth } = requireQoderFamily(provider);
          const started = await auth.startLogin({ refName });
          await pool.addAccount({
            id,
            provider: product.id,
            nickname: id,
            enabled: true,
            credentialRef: refName,
            refreshable: false,
            createdAt: Date.now()
          });
          started.result.then(async (loginResult) => {
            const credential = parseQoderCredential(loginResult.access);
            let nickname = credential?.nickname;
            if ((nickname === void 0 || nickname.length === 0) && credential !== void 0) {
              nickname = await fetchQoderUserNickname(credential, product);
              if (nickname !== void 0 && loginResult.access.length > 0) {
                const updated = withQoderNickname(credential, nickname);
                await ctx.credentials.set(credentialRef4(refName), JSON.stringify(updated));
              }
            }
            await pool.updateAccount(id, {
              nickname: nickname !== void 0 && nickname.length > 0 ? nickname : id,
              expiresAt: credential !== void 0 ? qoderCredentialExpiresAtMs(credential) : void 0,
              refreshable: credential !== void 0 && isQoderRefreshable(credential)
            });
          }).catch((error) => {
            ctx.logger.warn(`[channel-pack] background ${product.id} login failed for ${id}: ${String(error)}`);
            void pool.removeAccount(id).catch(() => {
            });
          });
          return { ok: true, value: { accountId: id, loginUrl: started.loginUrl } };
        } else if (provider === TRAE.id) {
          const started = await trae.startLogin({ refName });
          await pool.addAccount({
            id,
            provider: TRAE.id,
            nickname: id,
            enabled: true,
            credentialRef: refName,
            refreshable: false,
            createdAt: Date.now()
          });
          started.result.then(async (loginResult) => {
            const credential = parseTraeCredential(loginResult.access);
            await pool.updateAccount(id, {
              // ⚠️ 用 `traeDisplayNickname`（手机号优先）而非直接取 `nickname`：
              // 服务端 ScreenName 是**按 uid 自动生成的默认名**，多账号无法区分
              // （用户报障 2026-09-27）。见该函数的说明。
              nickname: traeDisplayNickname(credential, id),
              expiresAt: credential !== void 0 ? traeCredentialExpiresAtMs(credential) : void 0,
              refreshable: credential !== void 0 && isTraeRefreshable(credential)
            });
          }).catch((error) => {
            ctx.logger.warn(`[channel-pack] background ${TRAE.id} login failed for ${id}: ${String(error)}`);
            void pool.removeAccount(id).catch(() => {
            });
          });
          return { ok: true, value: { accountId: id, loginUrl: started.loginUrl } };
        } else if (isRaccoonFamily(provider)) {
          const raccoonMember = requireRaccoonFamily(provider);
          const raccoonRefName = `${RACCOON.id.toUpperCase().replace(/[^A-Z0-9]+/g, "")}_ACCOUNT_${suffix}`;
          await pool.addAccount({
            id,
            provider: RACCOON.id,
            nickname: id,
            enabled: true,
            credentialRef: raccoonRefName,
            refreshable: false,
            createdAt: Date.now()
          });
          let raccoonStarted;
          try {
            raccoonStarted = await raccoonMember.auth.startLogin();
          } catch (error) {
            void pool.removeAccount(id).catch(() => {
            });
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`\u65E0\u6CD5\u542F\u52A8 Raccoon \u767B\u5F55\uFF08\u672C\u5730\u767B\u5F55\u9875\u542F\u52A8\u5931\u8D25\uFF09\uFF1A${reason}`);
          }
          raccoonStarted.result.then(async (credential) => {
            const result = await raccoonMember.auth.persistLogin(credential, { refName: raccoonRefName });
            const saved = JSON.parse(result.access);
            const plan = await raccoonMember.auth.fetchPlan(saved);
            await pool.updateAccount(id, {
              // ⚠️ 服务端的 `name` 是**自动生成的默认名**（本机账号是
              // `RaccoonAva`，即「Raccoon」+ 随机串），微信扫码**不回传微信昵称**
              //（`wechat_bindings` 只有绑定 id 与时间，无昵称/头像）。
              // 它是账号的**正式名字**（JWT payload 里也有 `name`，官方客户端
              // 就显示它），故**保留**；但若注册第二个账号，服务端很可能又给一个
              // 相近的默认名 → 多账号重名、无法区分。
              //
              // 故追加**手机号尾号**消歧：`RaccoonAva (1100)`。
              // 保留服务端原名，再挂手机号尾号消歧。
              nickname: buildRaccoonNickname(saved, id),
              expiresAt: result.expires > 0 ? result.expires : void 0,
              // ⚠️ raccoon **有** refresh 端点，这里是真续期。
              refreshable: result.refreshable,
              // 与昵称/有效期**同一次落盘**：分两次写会多一次整文档重写，
              // 且中途失败会留下「有昵称无套餐」的半态。
              plan
            });
            ctx.logger.info(`[channel-pack] raccoon \u8D26\u53F7 ${id} \u5957\u9910\u63A2\u6D4B\u7ED3\u679C\uFF1A${plan}`);
          }).catch((error) => {
            ctx.logger.warn(`[channel-pack] background ${provider} login failed for ${id}: ${String(error)}`);
            void pool.removeAccount(id).catch(() => {
            });
          });
          return { ok: true, value: { accountId: id, loginUrl: raccoonStarted.loginUrl } };
        } else {
          return { ok: false, error: { code: "bad-request", message: `unknown provider: ${provider}` } };
        }
      }
      case "account.update": {
        const req = payload;
        await pool.updateAccount(req.accountId, req.patch);
        return { ok: true, value: void 0 };
      }
      case "account.delete": {
        const req = payload;
        await pool.removeAccount(req.accountId);
        return { ok: true, value: void 0 };
      }
      // 拖拽排序：重写该 provider 账号在池中的顺序。
      // 该顺序是自动选号与限流换号的候选优先级，因此不是纯 UI 操作。
      case "account.reorder": {
        const req = payload;
        if (typeof req.provider !== "string" || req.provider.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "provider \u5FC5\u586B" } };
        }
        if (!Array.isArray(req.orderedIds) || req.orderedIds.some((id) => typeof id !== "string")) {
          return { ok: false, error: { code: "bad-request", message: "orderedIds \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4" } };
        }
        try {
          await pool.reorderAccounts(req.provider, req.orderedIds);
        } catch (error) {
          return {
            ok: false,
            error: {
              code: "bad-request",
              message: error instanceof Error ? error.message : String(error)
            }
          };
        }
        return { ok: true, value: void 0 };
      }
      case "account.refresh": {
        const req = payload;
        try {
          const accounts = await pool.listAllAccounts();
          const entry = accounts.find((a) => a.id === req.accountId);
          if (!entry) throw new Error(`Account ${req.accountId} not found`);
          switch (entry.provider) {
            case QODER.id:
            case QODER_CN.id:
              await requireQoderFamily(entry.provider).auth.refreshAccountCredential(entry.credentialRef, pool, entry.id);
              break;
            case TRAE.id:
              await trae.refreshAccountCredential(entry.credentialRef, pool, entry.id);
              break;
            case RACCOON.id:
            case RACCOON_PRO.id:
              await requireRaccoonFamily(entry.provider).auth.refreshAccountCredential(entry.credentialRef, pool, entry.id);
              break;
            default:
              throw new Error(`Unknown provider: ${entry.provider}`);
          }
          return { ok: true, value: { success: true } };
        } catch (error) {
          return {
            ok: false,
            error: {
              code: "bad-request",
              message: error instanceof Error ? error.message : String(error)
            }
          };
        }
      }
      case "login.poll": {
        const req = payload;
        const failure = pendingLoginFailures.get(req.accountId);
        if (failure !== void 0) {
          pendingLoginFailures.delete(req.accountId);
          return { ok: true, value: { done: true, success: false, error: failure } };
        }
        const accounts = await pool.listAllAccounts();
        const entry = accounts.find((a) => a.id === req.accountId);
        if (!entry) return { ok: true, value: { done: false } };
        const ref = credentialRef4(entry.credentialRef);
        const resolved = await ctx.credentials.resolve(ref);
        if (!resolved) return { ok: true, value: { done: false } };
        return { ok: true, value: { done: true, success: true } };
      }
      /**
       * 查询一次性奖励状态（Raccoon 族免费版 / 订阅版的登录奖励，只读）。
       *
       * ⚠️ 只读：**不得**在此触发任何 `complete`/`claim`（面板挂载时会调用它）。
       */
      case "onboarding.status": {
        const req = payload;
        if (!isRaccoonFamily(req.provider)) {
          return { ok: false, error: { code: "bad-request", message: `unsupported provider: ${req.provider}` } };
        }
        const account2 = pool.findAccount(req.accountId);
        if (account2 === void 0) {
          return { ok: false, error: { code: "bad-request", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" } };
        }
        const resolved = await ctx.credentials.resolve(credentialRef4(account2.credentialRef));
        if (!resolved) {
          return { ok: false, error: { code: "bad-request", message: "\u51ED\u636E\u672A\u914D\u7F6E" } };
        }
        if (isRaccoonFamily(req.provider)) {
          const credential = JSON.parse(resolved.value);
          const status = await requireRaccoonFamily(req.provider).auth.fetchOnboardingStatus(credential);
          return {
            ok: true,
            value: {
              // ⚠️ `tasks` 是 `Record<key, boolean>`（完成状态），不是数组。
              tasks: { desktop_login_reward: status.claimed },
              earned: status.claimed ? status.points : 0,
              total: status.points,
              titles: { desktop_login_reward: "\u684C\u9762\u7AEF\u767B\u5F55\u5956\u52B1\uFF08\u6BCF\u53F7\u4E00\u6B21\uFF09" },
              points: { desktop_login_reward: status.points }
            }
          };
        }
      }
      /**
       * 领取一次性奖励（Raccoon 族的登录奖励）。
       *
       * ⚠️ 这是**写**操作，且**每号只能领一次** —— 与 `credits.claimAll`
       *（每日签到）语义完全不同，故独立端点。
       */
      case "onboarding.claim": {
        const req = payload;
        if (!isRaccoonFamily(req.provider)) {
          return { ok: false, error: { code: "bad-request", message: `unsupported provider: ${req.provider}` } };
        }
        const account2 = pool.findAccount(req.accountId);
        if (account2 === void 0) {
          return { ok: false, error: { code: "bad-request", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" } };
        }
        const resolved = await ctx.credentials.resolve(credentialRef4(account2.credentialRef));
        if (!resolved) {
          return { ok: false, error: { code: "bad-request", message: "\u51ED\u636E\u672A\u914D\u7F6E" } };
        }
        if (isRaccoonFamily(req.provider)) {
          const raccoonAuth = requireRaccoonFamily(req.provider).auth;
          const credential = JSON.parse(resolved.value);
          const outcome = await raccoonAuth.claimLoginReward(credential);
          if (outcome.kind === "failed") {
            return { ok: false, error: { code: "bad-request", message: outcome.message } };
          }
          const claimed = outcome.kind === "claimed" ? [{ key: "desktop_login_reward", title: "\u684C\u9762\u7AEF\u767B\u5F55\u5956\u52B1", points: outcome.credit }] : [];
          const points = outcome.kind === "claimed" ? outcome.credit : (await raccoonAuth.fetchOnboardingStatus(credential)).points;
          return {
            ok: true,
            value: {
              claimed,
              skipped: outcome.kind === "already-claimed" ? ["desktop_login_reward"] : [],
              // 该项目累计已领 = 满分（无论本次是否新增）。
              earned: points,
              total: points
            }
          };
        }
      }
      // ── 每日签到（Raccoon 家族）：触发服务端当日积分发放 ──
      case "raccoon.checkin": {
        const req = payload;
        if (req.provider !== void 0 && !isRaccoonFamily(req.provider)) {
          return { ok: false, error: { code: "bad-request", message: `unsupported provider: ${req.provider}` } };
        }
        if (typeof req.accountId !== "string" || req.accountId.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "\u7F3A\u5C11\u8D26\u53F7" } };
        }
        const account2 = pool.findAccount(req.accountId);
        if (account2 === void 0) {
          return { ok: false, error: { code: "bad-request", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" } };
        }
        const resolved = await ctx.credentials.resolve(credentialRef4(account2.credentialRef));
        if (!resolved) {
          return { ok: false, error: { code: "bad-request", message: "\u51ED\u636E\u672A\u914D\u7F6E" } };
        }
        const raccoonAuth = requireRaccoonFamily(req.provider ?? account2.provider).auth;
        const credential = JSON.parse(resolved.value);
        const outcome = await raccoonAuth.checkIn(credential);
        if (outcome.kind === "failed") {
          return { ok: false, error: { code: "upstream-error", message: outcome.message } };
        }
        return {
          ok: true,
          value: outcome.kind === "claimed" ? { outcome: "claimed", credit: outcome.credit, message: outcome.delayedMessage ?? "" } : { outcome: outcome.kind === "already-claimed" ? "done" : outcome.kind, message: outcome.message }
        };
      }
      // ── 限流标记：重测（发真实请求验证）──
      // 标记只反映"上一次 429 时的快照"，服务端常在重置时间前提前放行。
      // 重测发一次最小对话请求：正常返回才清除标记，仍受限则保留并回报原因。
      case "account.retest": {
        const req = payload;
        const account2 = await retestAccount(pool, req.accountId);
        return {
          ok: true,
          value: { accounts: [account2], clearedCount: account2.cleared.length }
        };
      }
      // 重测该 provider 下的全部账号。**包含已停用账号**——用户明确要求
      // 停用账号也能重测（停用只影响自动选择，不影响手动排查）。
      case "account.retestAll": {
        const req = payload;
        const value = await retestAllAccounts(pool, req.provider);
        return { ok: true, value };
      }
      // ── 限流标记：测试（**无条件**发一次真实请求）──
      //
      // ⚠️ 与 `account.retest` 的区别是**触发条件**，不是措辞：
      // `retestAccount` 只测那些已经有 `modelRateLimits` 标记的模型，没有标记时
      // 在 `modelIds.length === 0` 处提前返回、一次请求都不发。于是「这个账号
      // 到底还能不能用」在**没有历史 429** 时没有手动探活入口 —— 用户点「重测」
      // 看到瞬间返回，会以为按钮失灵（真实报障：「重测按钮你确认过会发请求吗，
      // 为什么响应这么快？」）。`account.test` 补齐的就是这个缺口。
      //
      // ⚠️ 它**不写任何存储**：不清标记、不写回新的重置时刻。测出「仍受限」只
      // 如实回报给用户看，不落盘 —— 落盘会把「一次手动探活」变成「改变选号
      // 状态」，那是重测的语义。
      case "account.test": {
        const req = payload;
        const accountId = req.accountId;
        if (typeof accountId !== "string" || accountId === "") {
          return { ok: false, error: { code: "bad-request", message: "\u7F3A\u5C11 accountId" } };
        }
        const entry = pool.findAccount(accountId);
        if (entry === void 0) {
          return { ok: false, error: { code: "bad-request", message: `\u8D26\u53F7 ${accountId} \u4E0D\u5B58\u5728` } };
        }
        let candidates = pickTestModels(entry, [], req.modelId);
        if (candidates.length === 0) {
          const catalog = await fullCatalogIds(ctx, modelAdapters, entry.provider);
          if ("error" in catalog) {
            return {
              ok: false,
              error: { code: "bad-request", message: `\u65E0\u6CD5\u786E\u5B9A\u8981\u6D4B\u8BD5\u7684\u6A21\u578B\uFF1A${catalog.error}` }
            };
          }
          candidates = pickTestModels(entry, catalog.ids, req.modelId);
        }
        if (candidates.length === 0) {
          return {
            ok: false,
            error: { code: "bad-request", message: `${entry.provider} \u6CA1\u6709\u53EF\u6D4B\u8BD5\u7684\u6A21\u578B` }
          };
        }
        const value = await testAccountCandidates(pool, accountId, candidates);
        return { ok: true, value };
      }
      // ── 限流标记：重置（不发请求，直接清除）──
      case "account.reset": {
        const req = payload;
        const value = await resetAccount(pool, req.accountId);
        return { ok: true, value };
      }
      case "account.resetAll": {
        const req = payload;
        const value = await resetAllAccounts(pool, req.provider);
        return { ok: true, value };
      }
      // ── 每日签到（积分领取）──
      // 查询某 provider 下全部启用账号的签到状态。
      //
      // 各渠道显式分派协议，未知或退役渠道不调用任何默认端点。
      case "credits.status": {
        const req = payload;
        if (req.provider === TRAE.id || isQoderFamily(req.provider)) {
          const accounts = (await pool.listAccounts(req.provider)).filter((entry) => req.accountId === void 0 || entry.id === req.accountId);
          const value = await collectCreditsStatus(accounts, void 0, {
            resolve: (ref) => ctx.credentials.resolve(ref),
            fetchStatus: (credential) => req.provider === TRAE.id ? fetchTraeCheckinStatus(credential, TRAE) : fetchQoderCheckinStatus(credential, requireQoderFamily(req.provider).product)
          });
          return { ok: true, value: { accounts: value } };
        }
        return { ok: false, error: { code: "bad-request", message: `unsupported provider: ${req.provider}` } };
      }
      // 一键领取：逐账号顺序执行（并发易触发风控），单个账号失败不中断整体。
      case "credits.claimAll": {
        const req = payload;
        const targeted = config.nativeOnly && Array.isArray(req.accountIds);
        const all = await pool.listAccounts(req.provider);
        const accounts = targeted ? all.filter((account2) => req.accountIds?.includes(account2.id)) : all;
        if (isQoderFamily(req.provider)) {
          const { product } = requireQoderFamily(req.provider);
          const value = await collectClaimResults(accounts, void 0, {
            resolve: (ref) => ctx.credentials.resolve(ref),
            claim: (credential) => claimQoderDailyCheckin(credential, product),
            signal,
            precheckStatus: false,
            warn: (msg) => ctx.logger?.warn?.(msg)
          });
          return { ok: true, value };
        }
        if (req.provider === TRAE.id) {
          const value = await collectClaimResults(accounts, void 0, {
            resolve: (ref) => ctx.credentials.resolve(ref),
            signal,
            requireStatus: targeted,
            // ⚠️ **必须开启状态预检**（`precheckStatus` 默认为 true，不要传 false）。
            //
            // TRAE 的 claim 对「今天已签到」是**幂等**的：实测重复领取同样返回
            // `{code:0, message:"success"}`，与真正领取成功**无法区分**。
            // 早期照抄 LobsterAI 传了 `precheckStatus: false`（那是「领取流程内部
            // 已做 slot/context 预检」的理由，TRAE 没有这回事），于是已签到的账号
            // 被报成「领取成功」（用户报障：显示成功但 +0 积分）。
            // 判据只能是 status 端点的 `checked_in`。
            fetchStatus: (credential) => fetchTraeCheckinStatus(credential, TRAE, fetch),
            claim: (credential, _product, entry) => claimTraeDailyCheckin(
              credential,
              TRAE,
              fetch,
              pool.traeCheckinDeviceGenerationFor(entry.id),
              (next) => pool.updateTraeCheckinDeviceGeneration(entry.id, next),
              void 0,
              targeted ? 0 : void 0
            ),
            warn: (msg) => ctx.logger?.warn?.(msg)
          });
          return { ok: true, value };
        }
        if (isRaccoonFamily(req.provider)) {
          return {
            ok: false,
            error: {
              code: "bad-request",
              message: "Raccoon Work \u4E0D\u652F\u6301\u6BCF\u65E5\u7B7E\u5230\uFF08\u6BCF\u65E5\u79EF\u5206\u7531\u670D\u52A1\u7AEF\u81EA\u52A8\u53D1\u653E\uFF1B\u767B\u5F55\u5956\u52B1\u8BF7\u5728\u300C\u65B0\u624B\u4EFB\u52A1\u300D\u4E2D\u9886\u53D6\uFF09"
            }
          };
        }
        return { ok: false, error: { code: "bad-request", message: `unsupported provider: ${req.provider}` } };
      }
      // 积分余额（Credits Balance）：逐账号顺序查询。
      //
      // 独立于 account.list 的原因：余额要为每个账号发一次网络请求，而
      // account.list 是打开面板就会调的轻量操作。混在一起会让账号列表被
      // 网络耗时拖慢，且一次查询失败会让整份列表都取不到。
      case "credits.balances": {
        const req = payload;
        const accounts = await pool.listAccounts(req.provider);
        if (isQoderFamily(req.provider)) {
          const { product } = requireQoderFamily(req.provider);
          const values = [];
          for (const account2 of accounts) {
            signal?.throwIfAborted();
            const resolved = await ctx.credentials.resolve(credentialRef4(account2.credentialRef));
            if (!resolved) {
              values.push({
                accountId: account2.id,
                nickname: account2.nickname,
                balance: null,
                error: "\u51ED\u636E\u672A\u914D\u7F6E"
              });
              continue;
            }
            let credential;
            try {
              credential = JSON.parse(resolved.value);
            } catch {
              values.push({
                accountId: account2.id,
                nickname: account2.nickname,
                balance: null,
                error: "\u51ED\u636E\u89E3\u6790\u5931\u8D25"
              });
              continue;
            }
            const balance = await fetchQoderCreditBalance(credential, product);
            values.push({
              accountId: account2.id,
              nickname: account2.nickname,
              balance,
              // 查不到时带上原因，卡片显示原因而非 0（与其它 provider 同约定）。
              ...balance === null ? { error: "\u79EF\u5206\u67E5\u8BE2\u5931\u8D25\uFF08\u51ED\u636E\u5931\u6548\u6216\u54CD\u5E94\u5F02\u5E38\uFF09" } : {}
            });
          }
          return { ok: true, value: { accounts: values } };
        }
        if (req.provider === TRAE.id) {
          const values = await collectCreditBalances(accounts, TRAE, {
            resolve: (ref) => ctx.credentials.resolve(ref),
            fetchBalance: (credential, product) => fetchTraeCreditBalance(credential, product),
            warn: (msg) => ctx.logger?.warn?.(msg)
          });
          return {
            ok: true,
            value: {
              accounts: values,
              windowDays: creditExpiringWindowDays()
            }
          };
        }
        return { ok: false, error: { code: "bad-request", message: `unsupported provider: ${req.provider}` } };
      }
      // ── 模型列表可见性（黑名单开关）──
      //
      // 列表来自 `ctx.llm.listModels()`——**适配器播报的权威目录**，正是
      // 对话框模型选择器读的同一份数据（会话控制器的 buildModelCatalog）。
      // 这样设置页展示的模型集合与实际可选集合永远一致，不会出现
      // 「设置在某个模型上，选择器里却找不到它」。
      case "model.list": {
        const req = payload;
        const llm = llmServiceOf(ctx);
        if (llm === void 0) {
          return { ok: false, error: { code: "bad-request", message: "llm \u670D\u52A1\u4E0D\u53EF\u7528" } };
        }
        const catalogSource = modelAdapters?.[req.provider];
        const all = catalogSource?.listAllModels();
        let models = [];
        if (all === void 0) {
          try {
            models = await llm.listModels(req.provider);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return { ok: false, error: { code: "bad-request", message: `\u8BFB\u53D6\u6A21\u578B\u5217\u8868\u5931\u8D25\uFF1A${reason}` } };
          }
        }
        if (catalogSource?.isRemoteCatalog?.() === true) {
          if (all !== void 0 && all.length > 0) {
            const removed = await pool.pruneDisabledModels(req.provider, new Set(all.map((model) => model.id)));
            if (removed.length > 0) {
              ctx.logger.info(`[channel-pack] \u6E05\u7406 ${req.provider} \u7684\u8FC7\u671F\u6A21\u578B\u9ED1\u540D\u5355\uFF1A${removed.join(", ")}`);
            }
          }
        }
        const disabledMap = pool.listDisabledModels(req.provider);
        let catalog;
        if (all !== void 0) {
          catalog = [...all];
        } else {
          const listedIds = new Set(models.map((model) => model.id));
          const filteredOut = Object.keys(disabledMap).filter((id) => disabledMap[id] === true && !listedIds.has(id));
          catalog = [
            ...models.map((model) => ({ id: model.id, name: model.name })),
            // 这些模型已被适配器过滤掉，拿不到原始 name，回退为 id。
            ...filteredOut.map((id) => ({ id, name: id }))
          ];
        }
        const dead = deadModelIdsFor(req.provider);
        if (dead.size > 0) {
          const known = new Set(catalog.map((model) => model.id));
          for (const id of dead) {
            if (!known.has(id)) catalog.push({ id, name: id });
          }
        }
        const exclusions = modelRecommendationExclusions(catalog.filter((model) => !dead.has(model.id)), req.provider);
        const value = {
          ...modelAdapters?.[req.provider]?.catalogStatus?.(),
          models: catalog.map((model) => ({
            id: model.id,
            name: readableModelName(model.id, model.name),
            disabled: isModelDisabled(model, disabledMap, exclusions),
            // ⚠️ **照实透传**：缺失即 false，**不推导**（黑名单命中也算用户主动关的，
            // 不是失效）。客户端据它灰显并显示「重新显示」按钮。
            dead: dead.has(model.id),
            // ⚠️ 免费标记**照原样透传，缺失就不写**（不编造 `false`）：Channel Pack 的
            // 模型列表按「计费/来源」分组，把「适配器没报」当成「按量计费」是
            // 保守归组，但字段本身仍保持「未知」语义（与全仓约定一致）。
            ...model.isFree === void 0 ? {} : { isFree: model.isFree },
            ...model.subscriptionOnly === void 0 ? {} : { subscriptionOnly: model.subscriptionOnly },
            ...model.rateBadge === void 0 ? {} : { rateBadge: model.rateBadge },
            // 能力元数据：界面据此只渲染该模型真正支持的档位（不猜、不给做不到的选项）。
            ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
            ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
            ...model.defaultMaxTokens === void 0 ? {} : { defaultMaxTokens: model.defaultMaxTokens },
            ...model.stale === true ? { stale: true } : {},
            ...model.staleReason === void 0 ? {} : { staleReason: model.staleReason },
            ...model.efforts === void 0 ? {} : { efforts: [...model.efforts] },
            ...model.defaultEffort === void 0 ? {} : { defaultEffort: model.defaultEffort },
            // 默认能力优先取未应用用户覆盖的完整目录，避免把手动关图误标为不支持。
            ...model.supportsImage !== void 0 ? { supportsImage: model.supportsImage } : {}
          }))
        };
        return { ok: true, value };
      }
      // ── 手动刷新远端模型目录 ──
      //
      // 设置页模型目录读的是 `model.list`，而它是**同步读缓存**（`listAllModels()`
      // 只返回当前目录，不触发拉取）。缓存为空时它退到适配器的硬编码兜底表，
      // 于是「设置页只看到几条老模型、也没有刷新入口」成了常态。
      //
      // 本方法把「真去上游拉一次」这一步单独暴露出来：客户端点「刷新目录」
      // （或首次进入模型分区）时调用，成功后再重读 `model.list`。
      // 适配器侧解析见各自 `refreshRemoteModels()`（会清缓存并突破失败冷却）。
      //
      // ⚠️ 目录按**适配器**分派（`modelAdapters[provider]`），Raccoon 家族的两个
      // provider 各取自己的适配器：`raccoon` 用免费账号凭据拉、`raccoon-pro` 用
      // 订阅账号凭据拉，两侧目录天然独立，不做倍率过滤。
      case "model.refresh": {
        const req = payload;
        const provider = typeof req?.provider === "string" ? req.provider : "";
        if (provider === "") {
          return { ok: false, error: { code: "bad-request", message: "provider \u5FC5\u586B" } };
        }
        const adapter = modelAdapters?.[provider];
        if (adapter === void 0) {
          return { ok: false, error: { code: "bad-request", message: `\u8BE5\u6E20\u9053\u6CA1\u6709\u6A21\u578B\u9002\u914D\u5668\uFF1A${provider}` } };
        }
        const refresh = adapter.refreshRemoteModels;
        if (typeof refresh !== "function") {
          return { ok: false, error: { code: "bad-request", message: `\u8BE5\u6E20\u9053\u4E0D\u652F\u6301\u5237\u65B0\u6A21\u578B\u76EE\u5F55\uFF1A${provider}` } };
        }
        try {
          const result = await refresh.call(adapter);
          const count = typeof result?.count === "number" && Number.isFinite(result.count) ? result.count : 0;
          const source = adapter.catalogStatus?.().source ?? (result?.source === "remote" ? "remote" : "fallback");
          if (source === "remote" || req.broadcast === true) broadcastCatalogChanged(ctx);
          ctx.logger.info(`[channel-pack] \u5237\u65B0\u6A21\u578B\u76EE\u5F55 ${provider}\uFF1A${source}\uFF08${count}\uFF09`);
          return { ok: true, value: { count, source, ...result && "issue" in result ? { issue: result.issue } : {} } };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return { ok: false, error: { code: "bad-request", message: `\u5237\u65B0\u6A21\u578B\u76EE\u5F55\u5931\u8D25\uFF1A${reason}` } };
        }
      }
      // 打开/关闭某个模型。写入后**不重建适配器**：适配器的 listModels 每次
      // 都直接读账号池的黑名单，因此下一次调用即返回新目录。
      //
      // ⚠️ 但「适配器立刻返回新目录」**不等于**「界面立刻更新」—— 客户端把
      // `modelCatalog` 的响应缓存在带 `status === 'ready'` 短路的 store 里，
      // 只在转发事件上失效（详见下方 emit 的注释）。不广播就等于开关只写进了
      // 磁盘、界面一直显示旧目录。
      case "model.setDisabled": {
        const req = payload;
        if (typeof req.provider !== "string" || typeof req.modelId !== "string" || req.modelId.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "provider \u4E0E modelId \u5FC5\u586B" } };
        }
        await pool.setModelDisabled(req.provider, req.modelId, req.disabled === true);
        ctx.logger.info(
          `[channel-pack] ${req.disabled === true ? "\u5173\u95ED" : "\u6253\u5F00"}\u6A21\u578B ${req.provider}/${req.modelId}`
        );
        broadcastCatalogChanged(ctx);
        const value = {
          provider: req.provider,
          disabledModels: pool.listDisabledModels(req.provider)
        };
        return { ok: true, value };
      }
      /** 清空显示偏好，恢复当前推荐列表；不改账号、参数或失效记录。 */
      case "model.resetDefaults": {
        const req = payload;
        if (typeof req.provider !== "string" || req.provider.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "provider \u5FC5\u586B" } };
        }
        await pool.clearDisabledModels(req.provider);
        broadcastCatalogChanged(ctx);
        return { ok: true, value: { provider: req.provider, disabledModels: pool.listDisabledModels(req.provider) } };
      }
      /** 读取某 provider 的模型参数覆盖表。 */
      case "model.params": {
        const req = payload;
        if (typeof req.provider !== "string" || req.provider.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "provider \u5FC5\u586B" } };
        }
        const value = {
          provider: req.provider,
          params: pool.listModelParams(req.provider)
        };
        return { ok: true, value };
      }
      /**
       * 写入某个模型的参数覆盖（默认**整份替换**，与设置页保存一致）。
       *
       * 输入栏 `contextOnly: true` 与设置页 `field` 都在服务端合并一个字段；
       * 清除该字段时仍保留同模型的其它覆盖。
       *
       * ⚠️ **必须广播 adapters-updated**：contextWindow 覆盖经 `resolveModel`
       * 投影进 `info.context.contextWindow`，宿主压缩/预算直接读它；不广播
       * 的话已开会话直到下次目录刷新都沿用旧窗口（其余渠道的同名字段写后
       * 都走同一约定）。
       */
      case "model.setParams": {
        const req = payload;
        if (typeof req.provider !== "string" || req.provider.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "provider \u5FC5\u586B" } };
        }
        if (typeof req.modelId !== "string" || req.modelId.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "modelId \u5FC5\u586B" } };
        }
        const previous = pool.modelParamsFor(req.provider, req.modelId);
        const field = req.contextOnly === true ? "contextWindow" : req.field;
        if (field !== void 0 && !["contextWindow", "maxTokens", "reasoningEffort", "supportsImage"].includes(field)) {
          return { ok: false, error: { code: "bad-request", message: "\u6A21\u578B\u53C2\u6570\u65E0\u6548" } };
        }
        if (field === "contextWindow") {
          const value2 = req.contextOnly === true ? req.params?.contextWindow : req.params?.contextWindow ?? null;
          if (value2 !== null && (typeof value2 !== "number" || !Number.isSafeInteger(value2) || value2 <= 0 || value2 > 1e7)) {
            return { ok: false, error: { code: "bad-request", message: "contextWindow \u5FC5\u987B\u662F\u6B63\u6574\u6570\u6216 null" } };
          }
          const row = modelAdapters?.[req.provider]?.listAllModels().find((model) => model.id === req.modelId);
          const capacity = row?.contextWindow;
          const output = previous?.maxTokens ?? row?.defaultMaxTokens;
          const target = value2 ?? capacity;
          if (capacity === void 0 || capacity <= 0 || target === void 0 || target > capacity || output !== void 0 && target <= output) {
            return { ok: false, error: { code: "bad-request", message: "\u4E0A\u4E0B\u6587\u7A97\u53E3\u8D85\u51FA\u76EE\u5F55\u5BB9\u91CF\u8303\u56F4\u6216\u5C0F\u4E8E\u7B49\u4E8E\u8F93\u51FA\u9884\u7559" } };
          }
          const merged = { ...previous };
          if (value2 === null) delete merged.contextWindow;
          else merged.contextWindow = value2;
          await pool.setModelParams(req.provider, req.modelId, merged);
        } else {
          const params = req.contextOnly === true ? void 0 : req.params;
          const next2 = field === void 0 ? params : { ...previous, [field]: params?.[field] };
          const requestedEffort = field === void 0 || field === "reasoningEffort" ? next2?.reasoningEffort : void 0;
          if (typeof requestedEffort === "string" && requestedEffort.length > 0) {
            const row = modelAdapters?.[req.provider]?.listAllModels().find((model) => model.id === req.modelId);
            if (row !== void 0 && Array.isArray(row.efforts) && !row.efforts.includes(requestedEffort)) {
              return { ok: false, error: { code: "bad-request", message: "\u8BE5\u6A21\u578B\u4E0D\u652F\u6301\u6B64\u601D\u8003\u6863\u4F4D" } };
            }
          }
          await pool.setModelParams(req.provider, req.modelId, next2);
        }
        const next = pool.modelParamsFor(req.provider, req.modelId);
        if (previous?.contextWindow !== next?.contextWindow || previous?.maxTokens !== next?.maxTokens || previous?.reasoningEffort !== next?.reasoningEffort) {
          broadcastCatalogChanged(ctx);
        }
        ctx.logger.info(`[channel-pack] \u66F4\u65B0\u6A21\u578B\u53C2\u6570 ${req.provider}/${req.modelId}`);
        const value = {
          provider: req.provider,
          params: pool.listModelParams(req.provider)
        };
        return { ok: true, value };
      }
      /**
       * 把模型从「已失效」表里移除，让它重新出现在目录中。
       *
       * ## 为什么必须有这个端点（2026-10-06 复审 !66 确认）
       *
       * 失效记录的唯一自愈路径是 TTL 过期（默认 30 天）—— 因为模型被剔除后用户
       * **选不到**，不可能靠「再成功一次」触发清除。所以**误判一次 = 该模型被
       * 藏 30 天且用户毫无办法**，这与 Channel Pack 已有的模型开关完全不对等
       * （用户能一键关，却不能一键复活）。
       *
       * ⚠️ **不动黑名单**：`disabledModels` 是用户主动选择，失效表是系统推断，
       * 两者必须分开清除 —— 否则「重新显示」会顺带打开用户特意关着的模型。
       *
       * ⚠️ `modelId` **没有默认值**：传 `""`/非字符串一律拒绝（避免字段名写错
       * 导致「静默清空全表」）。省略该字段才是「清空该 provider 全部」。
       */
      case "model.clearDead": {
        const req = payload;
        if (typeof req.provider !== "string" || req.provider.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "provider \u5FC5\u586B" } };
        }
        if (req.modelId !== void 0 && (typeof req.modelId !== "string" || req.modelId.length === 0)) {
          return {
            ok: false,
            error: { code: "bad-request", message: "modelId \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\uFF0C\u6216\u7701\u7565\u4EE5\u6062\u590D\u5168\u90E8" }
          };
        }
        const removed = clearDeadModels(req.provider, req.modelId);
        broadcastCatalogChanged(ctx);
        ctx.logger.info(
          `[channel-pack] \u6062\u590D ${removed} \u4E2A\u5931\u6548\u6A21\u578B\uFF1A${req.provider}${req.modelId === void 0 ? "" : `/${req.modelId}`}`
        );
        const value = {
          provider: req.provider,
          deadModels: [...deadModelIdsFor(req.provider)]
        };
        return { ok: true, value };
      }
      /**
       * 批量打开/关闭**指定的一批**模型（Channel Pack 模型列表里「按分组」的
       * 本组全开 / 本组全关）。
       *
       * ⚠️ **不能复用 `model.setAllDisabled`**：那个的范围是「该 provider 的
       * 全部模型」，且打开方向会清空整张黑名单（含用户特意关着的其它组）。
       * 分组开关只动本组的 id，故服务端需要一个「按子集清除」的路径
       * （`AccountPool.clearModelsDisabled`）。
       *
       * 与另外两个开关端点同约定：`disabled` 不做默认值猜测、只落盘一次、
       * 只广播一次（逐条调用会写 N 次文档、广播 N 次）。
       */
      case "model.setDisabledMany": {
        const req = payload;
        if (typeof req.provider !== "string" || req.provider.length === 0 || !Array.isArray(req.modelIds) || typeof req.disabled !== "boolean") {
          return {
            ok: false,
            error: { code: "bad-request", message: "provider\u3001modelIds\uFF08\u6570\u7EC4\uFF09\u4E0E disabled\uFF08\u5E03\u5C14\uFF09\u5FC5\u586B" }
          };
        }
        const ids = [...new Set(req.modelIds.filter((id) => typeof id === "string" && id.length > 0))];
        if (ids.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "modelIds \u4E0D\u80FD\u4E3A\u7A7A" } };
        }
        if (req.disabled) await pool.setModelsDisabled(req.provider, ids);
        else await pool.clearModelsDisabled(req.provider, ids);
        ctx.logger.info(
          `[channel-pack] ${req.disabled ? "\u5173\u95ED" : "\u6253\u5F00"} ${req.provider} \u7684 ${ids.length} \u4E2A\u6A21\u578B\uFF08\u6309\u5206\u7EC4\uFF09`
        );
        broadcastCatalogChanged(ctx);
        const value = {
          provider: req.provider,
          disabledModels: pool.listDisabledModels(req.provider)
        };
        return { ok: true, value };
      }
      /**
       * 按当前全量目录批量打开/关闭，包含默认禁用的备选项，只广播一次。
       * 恢复推荐使用 model.resetDefaults；批量打开必须记录显式 false。
       */
      case "model.setAllDisabled": {
        const req = payload;
        if (typeof req.provider !== "string" || typeof req.disabled !== "boolean") {
          return {
            ok: false,
            error: { code: "bad-request", message: "provider \u4E0E disabled\uFF08\u5E03\u5C14\uFF09\u5FC5\u586B" }
          };
        }
        if (req.disabled) {
          const catalog = await fullCatalogIds(ctx, modelAdapters, req.provider);
          if ("error" in catalog) {
            return { ok: false, error: { code: "bad-request", message: catalog.error } };
          }
          await pool.setModelsDisabled(req.provider, catalog.ids);
          ctx.logger.info(`[channel-pack] \u5173\u95ED ${req.provider} \u7684\u5168\u90E8 ${catalog.ids.length} \u4E2A\u6A21\u578B`);
        } else {
          const catalog = await fullCatalogIds(ctx, modelAdapters, req.provider);
          if ("error" in catalog) return { ok: false, error: { code: "bad-request", message: catalog.error } };
          await pool.clearModelsDisabled(req.provider, catalog.ids);
          ctx.logger.info(`[channel-pack] \u6253\u5F00 ${req.provider} \u7684\u5168\u90E8\u6A21\u578B`);
        }
        broadcastCatalogChanged(ctx);
        const value = {
          provider: req.provider,
          disabledModels: pool.listDisabledModels(req.provider)
        };
        return { ok: true, value };
      }
      /**
       * 读取多个供应商的汇总状态（Channel Pack 左侧导航分组 + 一键开关据此渲染）。
       *
       * 为什么一次取全部：8 个供应商若逐个查，就是 16 次往返，且每次都要走
       * 异步凭据解析。这里**全程只用同步的内存副本**，不产生任何网络请求：
       * - 模型目录用 `modelAdapters[provider].listAllModels()`（同步；它内部
       *   在冷缓存时会**后台**补拉，但不阻塞本次返回）；
       * - 账号用 `pool.listAccountsByProvider()`（同步读内存）。
       *
       * ⚠️ **不得**改用 `pool.listAccounts()` —— 那个方法会对每个账号调
       * `credentials.describe()`（异步 IO），8 个供应商逐个解析凭据会明显
       * 拖慢设置页首屏，而我们**只需要计数**，不需要凭据状态。
       *
       * 适配器缺失（外部/旧适配器）时 `total = 0`、`closed = false`：
       * 保守判为「未关闭」，让用户可以尝试操作，而不是误报成已关闭。
       */
      case "provider.status": {
        const req = payload;
        if (!Array.isArray(req.providers) || req.providers.some((id) => typeof id !== "string")) {
          return { ok: false, error: { code: "bad-request", message: "providers \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4" } };
        }
        const statuses = {};
        for (const provider of req.providers) {
          if (provider.length === 0 || !isSupportedProvider(provider)) continue;
          const catalog = modelAdapters?.[provider]?.listAllModels();
          const total = catalog?.length ?? 0;
          const disabledMap = pool.listDisabledModels(provider);
          let disabled = 0;
          if (catalog !== void 0) {
            const exclusions = modelRecommendationExclusions(catalog, provider);
            for (const model of catalog) {
              if (isModelDisabled(model, disabledMap, exclusions)) disabled++;
            }
          }
          const entries = pool.listAccountsByProvider(provider);
          statuses[provider] = {
            models: { total, disabled },
            accounts: {
              total: entries.length,
              // 与适配器一致的判据：`enabled !== false` 视为启用
              //（老文档可能缺该字段，缺省语义等同启用）。
              enabled: entries.filter((entry) => entry.enabled !== false).length
            },
            closed: total > 0 && disabled === total
          };
        }
        const value = { statuses };
        return { ok: true, value };
      }
      /**
       * 供应商级一键开关（Channel Pack 左侧每个供应商行尾的开关）。
       *
       * ## 语义（用户已确认）
       *
       * - `enabled: false`（关闭）= **关闭它的全部模型** + **停用它的全部账号**；
       * - `enabled: true`（打开）= 恢复推荐模型 + 启用它的全部账号。
       *
       * ## ⚠️ 关闭方向的顺序不可颠倒：先关模型，再停账号
       *
       * 「是否已关闭」的判据是**模型是否全关**（见 `provider.status` 的 `closed`）。
       * 先关模型可保证：即使随后停账号失败，状态判定依然自洽（该供应商确实已关闭），
       * 用户重试一次即可补齐账号。反过来先停账号、再关模型，中途失败会留下
       * 「账号全停用但模型仍可见」的中间态 —— 用户在对话框里还能选到它的模型，
       * 却没有任何可用账号，这正是本次要消除的落差。
       *
       * ## ⚠️ 「不关闭模型就不关闭供应商」
       *
       * 关闭方向必须拿到模型目录：读失败、或目录**为空**时**整个操作失败**，
       * 既不落盘也不广播。绝不能「关不掉模型就只停账号」—— 那会让供应商
       * 显示成已关闭而模型其实还在，用户按关闭的预期却仍能选到它。
       *
       * ## 打开方向不读目录
       *
       * 打开渠道时恢复推荐列表：直接清空本渠道的显示偏好，这样
       * 「曾被关闭、后来从服务端目录下线」的历史遗留键才能被清掉；且目录故障时
       * 用户仍可恢复本渠道的默认推荐模型。
       */
      case "provider.setEnabled": {
        const req = payload;
        if (typeof req.provider !== "string" || req.provider.length === 0 || typeof req.enabled !== "boolean") {
          return {
            ok: false,
            error: { code: "bad-request", message: "provider \u4E0E\u975E\u7A7A\u5E03\u5C14 enabled \u5FC5\u586B" }
          };
        }
        let modelCount = 0;
        if (req.enabled) {
          const cleared = pool.listDisabledModels(req.provider);
          await pool.clearDisabledModels(req.provider);
          modelCount = Object.keys(cleared).length;
        } else {
          const catalog = await fullCatalogIds(ctx, modelAdapters, req.provider);
          if ("error" in catalog) {
            return { ok: false, error: { code: "bad-request", message: catalog.error } };
          }
          if (catalog.ids.length === 0) {
            return {
              ok: false,
              error: { code: "bad-request", message: "\u8BE5\u4F9B\u5E94\u5546\u6CA1\u6709\u53EF\u5173\u95ED\u7684\u6A21\u578B\uFF0C\u672A\u505A\u4EFB\u4F55\u53D8\u66F4" }
            };
          }
          await pool.setModelsDisabled(req.provider, catalog.ids);
          modelCount = catalog.ids.length;
        }
        const accountCount = await pool.setAccountsEnabled(req.provider, req.enabled);
        broadcastCatalogChanged(ctx);
        ctx.logger.info(
          `[channel-pack] ${req.enabled ? "\u6253\u5F00" : "\u5173\u95ED"}\u4F9B\u5E94\u5546 ${req.provider}\uFF1A${req.enabled ? "\u6E05\u7A7A" : "\u5199\u5165"} ${modelCount} \u4E2A\u6A21\u578B\u3001${req.enabled ? "\u542F\u7528" : "\u505C\u7528"} ${accountCount} \u4E2A\u8D26\u53F7`
        );
        const value = {
          provider: req.provider,
          enabled: req.enabled,
          models: modelCount,
          accounts: accountCount
        };
        return { ok: true, value };
      }
      // ── 供应商自定义显示顺序（「供应商开关」弹窗的拖拽排序）──
      case "provider.getOrder": {
        const value = { order: pool.providerOrder() };
        return { ok: true, value };
      }
      case "provider.setOrder": {
        const req = payload;
        if (!Array.isArray(req?.order) || req.order.some((id) => typeof id !== "string")) {
          return {
            ok: false,
            error: { code: "bad-request", message: "order \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4" }
          };
        }
        await pool.setProviderOrder(req.order);
        ctx.logger.info(`[channel-pack] \u5DF2\u66F4\u65B0\u4F9B\u5E94\u5546\u81EA\u5B9A\u4E49\u663E\u793A\u987A\u5E8F\uFF08${req.order.length} \u9879\uFF09`);
        return { ok: true, value: void 0 };
      }
      // ── 本机 OpenAI 网关（`src/openai-gateway/`）──
      case "gateway.getEnabled": {
        const degrade = async (step, run, fallback) => {
          try {
            return await run();
          } catch (error) {
            ctx.logger.warn(
              `[channel-pack] gateway.getEnabled \u7684\u300C${step}\u300D\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BE5\u5B57\u6BB5\u964D\u7EA7\u4E3A\u9ED8\u8BA4\u503C\uFF1A${String(error)}`
            );
            return fallback;
          }
        };
        const blockedByEnv = await degrade("env \u5F00\u5173", () => !isGatewayEnabled(process.env), true);
        const apiKey = await degrade("API Key", () => gatewayApiKey(), null);
        const address = await degrade("\u76D1\u542C\u5730\u5740", () => blockedByEnv ? null : gatewayAddress() ?? null, null);
        const llm = llmServiceOf(ctx);
        const listed = llm?.listProviders !== void 0 ? (() => {
          try {
            const value2 = llm.listProviders();
            return Array.isArray(value2) && value2.length > 0 ? value2 : void 0;
          } catch {
            return void 0;
          }
        })() : void 0;
        const adapters = Object.keys(modelAdapters ?? {}).map((id) => ({ id }));
        const providers = listed ?? (adapters.length > 0 ? adapters : void 0);
        const modelsSource = listed !== void 0 ? "catalog" : adapters.length > 0 ? "adapters" : "none";
        const value = {
          enabled: await degrade("\u5F00\u5173\u72B6\u6001", () => pool.gatewayEnabled(), true),
          running: await degrade("\u8FD0\u884C\u6001", () => isGatewayRunning(), false),
          blockedByEnv,
          // 被 env 停用时即使 `enabled` 为真也不会监听，此时**不**回显地址，
          // 否则设置页会显示一个根本连不上的 URL。
          address,
          // ⚠️ 明文凭据：只用于设置页展示与复制，**不进日志**。
          apiKey: apiKey === null ? null : { value: apiKey.value, fromEnv: apiKey.fromEnv, path: apiKey.path },
          // 有些 agent（如 ZCode）不会主动扫目录，要靠用户手工填 ID，
          // 故这里把目录一并回传，让设置页内嵌展示。
          models: await degrade("\u6A21\u578B\u76EE\u5F55", async () => {
            if (providers === void 0) {
              ctx.logger.warn("[channel-pack] gateway.getEnabled\uFF1A\u65E2\u53D6\u4E0D\u5230 llm.listProviders\uFF0C\u4E5F\u6CA1\u6709\u4EFB\u4F55\u5DF2\u6CE8\u518C\u9002\u914D\u5668\u53EF\u4F5C\u515C\u5E95\uFF0C\u6A21\u578B\u6E05\u5355\u4E3A\u7A7A");
              return [];
            }
            return collectGatewayCatalog(llm, providers, (provider, error) => {
              ctx.logger.warn(`[channel-pack] ${provider} \u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF0C\u5DF2\u4ECE\u7F51\u5173\u5217\u8868\u8DF3\u8FC7\uFF1A${String(error)}`);
            });
          }, []),
          modelsSource
        };
        return { ok: true, value };
      }
      case "gateway.setEnabled": {
        const req = payload;
        if (typeof req.enabled !== "boolean") {
          return { ok: false, error: { code: "bad-request", message: "\u975E\u7A7A\u5E03\u5C14 enabled \u5FC5\u586B" } };
        }
        await pool.setGatewayEnabled(req.enabled);
        setGatewayDesiredEnabled(req.enabled);
        await applyGatewayDesiredState();
        const blockedByEnv = !isGatewayEnabled(process.env);
        ctx.logger.info(
          `[channel-pack] ${req.enabled ? "\u6253\u5F00" : "\u5173\u95ED"}\u672C\u673A OpenAI \u7F51\u5173${blockedByEnv ? "\uFF08\u5DF2\u88AB DSH_OPENAI_GATEWAY_ENABLED \u963B\u6B62\uFF09" : isGatewayRunning() ? "" : "\uFF08\u672A\u5728\u76D1\u542C\uFF09"}`
        );
        const key = gatewayApiKey();
        const llm = llmServiceOf(ctx);
        const providers = req.enabled ? providerIdsOf(llm, modelAdapters) : void 0;
        const modelsSource = !req.enabled ? "none" : llm?.listProviders !== void 0 ? "catalog" : Object.keys(modelAdapters ?? {}).length > 0 ? "adapters" : "none";
        const models = providers === void 0 ? [] : await collectGatewayCatalog(llm, providers, (provider, error) => {
          ctx.logger.warn(`[channel-pack] ${provider} \u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF0C\u5DF2\u4ECE\u7F51\u5173\u5217\u8868\u8DF3\u8FC7\uFF1A${String(error)}`);
        }).catch((error) => {
          ctx.logger.warn(`[channel-pack] gateway.setEnabled \u7684\u6A21\u578B\u76EE\u5F55\u5237\u65B0\u5931\u8D25\uFF1A${String(error)}`);
          return [];
        });
        const value = {
          enabled: req.enabled,
          running: isGatewayRunning(),
          blockedByEnv,
          address: blockedByEnv ? null : gatewayAddress() ?? null,
          apiKey: key === null ? null : { value: key.value, fromEnv: key.fromEnv, path: key.path },
          models,
          modelsSource
        };
        return { ok: true, value };
      }
      // ── 账号备份（导出 / 导入）──
      //
      // 目的：更换 DSH 版本时迁移账号凭据。备份文件是**自包含**的 JSON
      // （账号索引 + 凭据原文 + 模型黑名单，见 src/backup.ts），与 DSH 版本
      // 无关 —— 导入时按**当前版本**的存储契约重建，天然跨版本。
      //
      // 安全约定：加密在浏览器侧完成（PBKDF2 + AES-GCM），RPC 只接收/返回
      // 明文载荷；明文 JSON 不经过本层持久化与日志。
      case "backup.export": {
        const result = await exportBackup(pool, ctx.credentials);
        const value = {
          payload: result.payload,
          warnings: result.warnings
        };
        return { ok: true, value };
      }
      // 导入 = 整体替换（还原快照，不是合并）。写入顺序刻意「先凭据、后账号池」：
      // 账号池整体替换成功后，门控（hasLoggedInAccount）与黑名单立即反映新状态；
      // 若凭据写入中途失败（非法 ref 等），只跳过该条、不中断整体。
      case "backup.import": {
        const req = payload;
        const result = await importBackup(ctx.credentials, pool, req.payload);
        broadcastCatalogChanged(ctx);
        const value = {
          credentialsImported: result.credentialsImported,
          accountsImported: result.accountsImported,
          skipped: result.skipped,
          expiredAccounts: result.expiredAccounts,
          missingCredentials: result.missingCredentials
        };
        return { ok: true, value };
      }
      // 账号池统计（导入前的覆盖提示用）：缺 expiresAt 的条目疑似 DSH 版本
      // 切换后自动恢复的产物（反推不读凭据值，故无有效期）。前端据此在
      // 确认导入前提示用户「有 N 个自动恢复的账号将被整体覆盖」。
      case "backup.status": {
        const state = pool.getStateSnapshot();
        const value = {
          accounts: state.accounts.length,
          withoutExpiry: state.accounts.filter((entry) => entry.expiresAt === void 0).length
        };
        return { ok: true, value };
      }
      /**
       * 用量徽标读数（会话输入区、模型选择器旁那枚）。
       *
       * ## 与 `credits.balances` 的关系
       *
       * 读数是**同一份**（本分支内部直接复用 `credits.balances` 的实现，见
       * `usageBadge` 的装配注释），差别只有三处：
       * 1. 只返回**启用**账号，并给出 `disabledCount`（停用账号不进合计）；
       * 2. 多带一份订阅读数（窗口 / 套餐），判定表在 `src/badge-subscription.ts`；
       * 3. 带**宿主侧 TTL 缓存**（`cached` 标出来）—— 徽标按分钟轮询，而余额是
       *    逐账号顺序打上游的（`collectCreditBalances` 的「顺序查询，避免并发
       *    触发风控」），不缓存会让上游请求数随轮询线性放大。
       *
       * ⚠️ 未知 provider 的 `bad-request` 由内层 `credits.balances` 给出（那里
       * 已有 12 条分派与 `unsupported provider` 的统一文案），本分支**原样透传**，
       * 不另立一份 provider 名单 —— 两份名单必然漂移。
       *
       * ⚠️ `force: true` = 绕过缓存（手动刷新、签到之后）。
       */
      case "usage.badge": {
        const req = payload;
        const provider = typeof req.provider === "string" ? req.provider.trim() : "";
        if (provider.length === 0) {
          return { ok: false, error: { code: "bad-request", message: "provider \u4E0D\u80FD\u4E3A\u7A7A" } };
        }
        const value = await usageBadge.read(provider, req.force === true ? { force: true } : {});
        return value;
      }
      /**
       * **Token 账本**快照（「Token 用量」面板）。
       *
       * 纯内存读（`readTokenLedger`），不打上游、不做任何 I/O —— 面板可以
       * 随意刷新。数据在重启后为空是**既定行为**（第 1 期不持久化），UI 负责
       * 把「进程内存账本」这一事实讲清楚。
       *
       * ⚠️ 这里**不**做渠道/provider 过滤：账本条数上限 500，全量下发即可，
       * 过滤维度（渠道、provider、模型）都由 UI 在聚合树上展开，避免为每个
       * 维度各造一个 RPC 端点。
       */
      case "usage.tokenLedger": {
        const req = payload;
        const snapshot = readTokenLedger(
          typeof req?.limit === "number" && Number.isFinite(req.limit) && req.limit > 0 ? { limit: Math.trunc(req.limit) } : {}
        );
        const value = { snapshot };
        return { ok: true, value };
      }
      /**
       * **历史日聚合**（第 4 期 · 「Token 用量」弹窗的历史视图）。
       *
       * 数据源是落盘的日聚合表（`token-ledger.json`，重启保留）—— 纯内存
       * 计算（Map 树 → 数组），不打上游、不做额外 I/O。
       *
       * ⚠️ `sinceDays` 钳制在 `[1, TOKEN_LEDGER_HISTORY_MAX_DAYS]`：0/负数
       * 按「仅今日」处理（省略 = 全部历史），超过上限裁到上限 —— 落盘本身
       * 只保留 90 天，更大的窗口只会白算。
       */
      case "usage.tokenLedgerHistory": {
        const req = payload;
        const raw = req?.sinceDays;
        const sinceDays = typeof raw === "number" && Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), TOKEN_LEDGER_HISTORY_MAX_DAYS) : void 0;
        const result = readTokenLedgerHistory(readTokenLedgerDayMap(), { sinceDays });
        const value = { history: result.days, totals: result.totals };
        return { ok: true, value };
      }
      /**
       * 用量徽标的显示偏好（读 / 写，**全局一个**，不分渠道）。
       *
       * ⚠️ `preference` 省略时**只读**（徽标首次渲染与设置面板初始化都用它）；
       * 给出时必须是 `auto` / `subscription` / `credits` 之一。
       *
       * ⚠️ 非法值**拒绝**而不是静默回落：回落会让「设置没生效」看起来像
       * 「保存成功」（用户改完刷新，界面仍按旧口径显示，且没有任何提示）。
       * 磁盘脏数据的容错在 `sanitizeBadgePreference`（那条路径面对的不是用户输入）。
       */
      case "usage.badgePreference": {
        const req = payload;
        if (req.preference === void 0) {
          const value2 = { preference: badgePreferences.load() };
          return { ok: true, value: value2 };
        }
        if (!BADGE_PREFERENCES.includes(req.preference)) {
          return {
            ok: false,
            error: {
              code: "bad-request",
              message: `preference \u5FC5\u987B\u662F ${BADGE_PREFERENCES.join(" / ")} \u4E4B\u4E00\uFF08\u6536\u5230\uFF1A${JSON.stringify(req.preference)}\uFF09`
            }
          };
        }
        await badgePreferences.save(req.preference);
        const value = { preference: badgePreferences.load() };
        return { ok: true, value };
      }
      /**
       * 「每日首次启动自动签到」开关（读 / 写，**全局一个**，不分渠道）。
       *
       * ⚠️ `enabled` 省略时**只读**；给出时必须是布尔值。非法值拒绝而不是静默
       * 回落 —— 理由与 `usage.badgePreference` 完全一致（回落会让「设置没生效」
       * 看起来像「保存成功」）。
       *
       * ⚠️ 写入 `true` 时宿主会**立刻尝试跑一轮**（今天已跑过则由执行体内部拦住）：
       * 否则用户今天打开开关要等到明天才有动作，看起来像没生效。返回值里的
       * `running` 会立刻为 `true`，界面据此显示「进行中」。
       */
      case "usage.autoCheckin": {
        const req = payload;
        if (req.dismiss !== void 0) {
          if (typeof req.dismiss !== "boolean") {
            return {
              ok: false,
              error: {
                code: "bad-request",
                message: `dismiss \u5FC5\u987B\u662F\u5E03\u5C14\u503C\uFF08\u6536\u5230\uFF1A${JSON.stringify(req.dismiss)}\uFF09`
              }
            };
          }
          if (req.dismiss) {
            const value2 = { autoCheckin: await autoCheckin.dismiss() };
            return { ok: true, value: value2 };
          }
        }
        if (req.enabled === void 0) {
          const value2 = { autoCheckin: autoCheckin.state() };
          return { ok: true, value: value2 };
        }
        if (typeof req.enabled !== "boolean") {
          return {
            ok: false,
            error: {
              code: "bad-request",
              message: `enabled \u5FC5\u987B\u662F\u5E03\u5C14\u503C\uFF08\u6536\u5230\uFF1A${JSON.stringify(req.enabled)}\uFF09`
            }
          };
        }
        const value = { autoCheckin: await autoCheckin.setEnabled(req.enabled) };
        return { ok: true, value };
      }
      default:
        return { ok: false, error: { code: "bad-request", message: `unknown method: ${method}` } };
    }
  }
}
function reply(rpcId, result) {
  const value = typeof result === "object" && result !== null && result.ok === false ? { ...result, error: { ...result.error, details: {} } } : result;
  return Response.json({ type: "server-response", rpcId, result: value });
}

// lib/pack-slots.js
var VENDOR_SLOT_ORDER = Object.freeze([
  "qoder",
  "qoderCn",
  "trae",
  "raccoon"
]);
var VENDOR_SLOTS = VENDOR_SLOT_ORDER;

// src/backend/pack-bridge.ts
function registerPackRpc(ctx, pool, slots, modelAdapters, config) {
  const unknown = Object.keys(slots).filter((slot) => !VENDOR_SLOT_ORDER.includes(slot));
  if (unknown.length > 0) throw new Error(`channel-pack \u63A5\u7EBF\u4F4D\u4E0D\u5B58\u5728\uFF1A${unknown.join("\u3001")}`);
  const args = VENDOR_SLOT_ORDER.map((slot) => slots[slot] ?? void 0);
  registerChannelPackRpc(ctx, pool, ...args, modelAdapters, config);
}

// src/backend/providers/raccoon.ts
import { credentialRef as credentialRef6 } from "@deepseek-ai/dsh-credentials";

// vendor/channel-pack/src/raccoon-auth.ts
import { Service } from "@deepseek-ai/cordis";
import { credentialRef as credentialRef5 } from "@deepseek-ai/dsh-credentials";

// vendor/channel-pack/src/raccoon-credits.ts
var RACCOON_LOGIN_REWARD_POINTS = 3e3;
var RACCOON_LOGIN_REWARD_EVENT_NAME = "\u684C\u9762\u7AEF\u767B\u5F55\u5956\u52B1";
function parseEnvelope(payload, status) {
  const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : {};
  const code = typeof record.code === "number" ? record.code : status >= 400 ? status : 0;
  const message = typeof record.message === "string" && record.message.length > 0 ? record.message : typeof record.details === "string" ? record.details : "";
  const data = typeof record.data === "object" && record.data !== null && !Array.isArray(record.data) ? record.data : void 0;
  return { ok: code === 0, code, message, data };
}
function readNumber3(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
async function requestJson(url, credential, product, init, fetcher) {
  try {
    const response = await fetcher(url, {
      method: init.method,
      headers: raccoonHeaders(credential, {
        platform: product.clientPlatform,
        version: product.clientVersion
      }),
      ...init.body === void 0 ? {} : { body: init.body },
      signal: AbortSignal.timeout(RACCOON_REQUEST_TIMEOUT_MS)
    });
    const parsed = await response.json();
    return parseEnvelope(parsed, response.status);
  } catch (error) {
    return {
      ok: false,
      code: -1,
      message: error instanceof Error ? error.message : String(error),
      data: void 0
    };
  }
}
function makePackage(name, remaining) {
  return {
    name,
    unit: "\u79EF\u5206",
    remaining,
    total: remaining,
    used: 0,
    active: true,
    cycleStartTime: "",
    cycleEndTime: "",
    expiredTime: ""
  };
}
async function fetchRaccoonCreditBalance(product, credential, fetcher = fetch) {
  const envelope = await requestJson(
    `${product.apiBase}${RACCOON_POINTS_PREFIX}/balance`,
    credential,
    product,
    { method: "GET" },
    fetcher
  );
  if (!envelope.ok || envelope.data === void 0) return null;
  const available = readNumber3(envelope.data.available_points);
  if (available === void 0) return null;
  const packages = [];
  const reward = readNumber3(envelope.data.reward_points);
  const daily = readNumber3(envelope.data.daily_points);
  const topup = readNumber3(envelope.data.topup_points);
  const monthly = readNumber3(envelope.data.monthly_points);
  if (reward !== void 0) packages.push(makePackage("\u5956\u52B1\u79EF\u5206", reward));
  if (daily !== void 0) packages.push(makePackage("\u6BCF\u65E5\u79EF\u5206", daily));
  if (monthly !== void 0 && monthly > 0) packages.push(makePackage("\u4F1A\u5458\u79EF\u5206", monthly));
  if (topup !== void 0) packages.push(makePackage("\u5145\u503C\u79EF\u5206", topup));
  return {
    total: available,
    // 极端情形（服务端只给 total 不给分项）也要有至少一个包，否则 UI 空列表
    packages: packages.length > 0 ? packages : [makePackage("\u53EF\u7528\u79EF\u5206", available)],
    expiredTotal: 0
  };
}
async function claimRaccoonLoginReward(product, credential, fetcher = fetch) {
  const envelope = await requestJson(
    `${product.apiBase}${RACCOON_DESKTOP_PREFIX}/login/points/grant`,
    credential,
    product,
    { method: "POST" },
    fetcher
  );
  if (!envelope.ok) {
    return {
      kind: "failed",
      code: envelope.code,
      message: envelope.message.length > 0 ? envelope.message : "\u9886\u53D6\u767B\u5F55\u5956\u52B1\u5931\u8D25"
    };
  }
  if (envelope.data?.granted !== true) {
    return {
      kind: "already-claimed",
      message: "\u8BE5\u8D26\u53F7\u5DF2\u9886\u53D6\u8FC7\u684C\u9762\u7AEF\u767B\u5F55\u5956\u52B1\uFF08\u6BCF\u53F7\u4E00\u6B21\uFF09"
    };
  }
  const popup = typeof envelope.data.popup === "object" && envelope.data.popup !== null ? envelope.data.popup : void 0;
  const points = readNumber3(popup?.points) ?? RACCOON_LOGIN_REWARD_POINTS;
  return { kind: "claimed", credit: points, streakDays: 0, isStreakDay: false };
}
function beijingDayKey(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1e3).toISOString().slice(0, 10);
}
function billKey(item) {
  const id = item.bill_id ?? item.biz_id;
  if (id !== void 0 && id !== null) return String(id);
  return `${String(item.created_at ?? "")}:${String(item.points ?? "")}:${String(item.event_name ?? "")}`;
}
function isDailyGrantBill(item, today) {
  const points = readNumber3(item.points);
  if (points === void 0 || points <= 0) return false;
  if (String(item.created_at ?? "").slice(0, 10) !== today) return false;
  const biz = String(item.biz_type ?? "");
  return biz.length === 0 || biz === "daily_grant" || biz === "reward_grant";
}
async function readBills(product, credential, fetcher) {
  const envelope = await requestJson(
    `${product.apiBase}${RACCOON_POINTS_PREFIX}/bills?paging.limit=20&paging.offset=0`,
    credential,
    product,
    { method: "GET" },
    fetcher
  );
  if (!envelope.ok || envelope.data === void 0) return null;
  const items = Array.isArray(envelope.data.items) ? envelope.data.items : [];
  return items.filter(
    (raw) => typeof raw === "object" && raw !== null && !Array.isArray(raw)
  );
}
async function checkInRaccoon(product, credential, fetcher = fetch) {
  const today = beijingDayKey();
  const before = await readBills(product, credential, fetcher);
  const beforeKeys = before === null ? null : new Set(before.filter((item) => isDailyGrantBill(item, today)).map(billKey));
  const trigger = await requestJson(
    `${product.apiBase}${RACCOON_OFFICE_PREFIX}/setting_info`,
    credential,
    product,
    { method: "GET" },
    fetcher
  );
  if (!trigger.ok) {
    return {
      kind: "failed",
      code: trigger.code,
      message: trigger.message.length > 0 ? trigger.message : "\u7B7E\u5230\u8BF7\u6C42\u5931\u8D25"
    };
  }
  const unsettled = { kind: "already-claimed", message: "\u5DF2\u89E6\u53D1\u4ECA\u65E5\u7B7E\u5230\uFF08\u8D26\u5355\u672A\u53D6\u5230\uFF0C\u91D1\u989D\u672A\u786E\u8BA4\uFF09" };
  if (beforeKeys === null) return unsettled;
  const after = await readBills(product, credential, fetcher);
  if (after === null) return unsettled;
  let credit = 0;
  const names = [];
  for (const item of after) {
    if (!isDailyGrantBill(item, today)) continue;
    if (beforeKeys.has(billKey(item))) continue;
    credit += Math.floor(readNumber3(item.points) ?? 0);
    const event = String(item.event_name ?? "");
    if (event.length > 0 && !names.includes(event)) names.push(event);
  }
  if (credit > 0) {
    return {
      kind: "claimed",
      credit,
      // 上游不回报连续天数：报 0 而不是猜。
      streakDays: 0,
      isStreakDay: false,
      ...names.length > 0 ? { delayedMessage: names.join(" + ") } : {}
    };
  }
  return { kind: "already-claimed", message: "\u4ECA\u65E5\u5DF2\u7B7E\u5230" };
}
async function fetchRaccoonOnboardingStatus(product, credential, fetcher = fetch) {
  const envelope = await requestJson(
    `${product.apiBase}${RACCOON_POINTS_PREFIX}/bills?paging.limit=50&paging.offset=0`,
    credential,
    product,
    { method: "GET" },
    fetcher
  );
  if (!envelope.ok || envelope.data === void 0) {
    return { claimed: false, points: RACCOON_LOGIN_REWARD_POINTS };
  }
  const items = Array.isArray(envelope.data.items) ? envelope.data.items : [];
  let claimed = false;
  let points = RACCOON_LOGIN_REWARD_POINTS;
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const item = raw;
    if (item.biz_type !== "reward_grant") continue;
    if (item.event_name !== RACCOON_LOGIN_REWARD_EVENT_NAME) continue;
    claimed = true;
    const billPoints = readNumber3(item.points);
    if (billPoints !== void 0 && billPoints > 0) points = billPoints;
    break;
  }
  return { claimed, points };
}

// vendor/channel-pack/src/raccoon-oauth.ts
import { randomBytes as randomBytes4 } from "node:crypto";
function parseEnvelope2(payload, status) {
  const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : {};
  const code = typeof record.code === "number" ? record.code : status >= 400 ? status : 0;
  const message = typeof record.message === "string" ? record.message : "";
  const details = typeof record.details === "string" ? record.details : "";
  const data = typeof record.data === "object" && record.data !== null && !Array.isArray(record.data) ? record.data : void 0;
  return { code, message, details, data };
}
function envelopeError(envelope, fallback) {
  const parts = [envelope.message, envelope.details].filter((s) => s.length > 0);
  const text = parts.length > 0 ? parts.join(": ") : fallback;
  return new Error(`raccoon: ${text}`);
}
async function postJson2(url, body, fetcher, headers = {}) {
  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RACCOON_REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new Error(
      `raccoon: \u8BF7\u6C42\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
    );
  }
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`raccoon: \u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${response.status}\uFF09`);
  }
  return { envelope: parseEnvelope2(parsed, response.status), status: response.status };
}
function generateQrCode() {
  return randomBytes4(16).toString("hex");
}
function buildQrImageUrl(product, code) {
  const params = new URLSearchParams({ code, appname: "\u5546\u6C64\u5C0F\u6D63\u718A\u5B98\u7F51" });
  return `${product.apiBase}/login/mp?${params.toString()}`;
}
async function pollRaccoonQrLogin(product, code, fetcher = fetch) {
  let envelope;
  try {
    const result = await postJson2(
      `${product.apiBase}${product.authApiPrefix}/login_with_qrcode_code`,
      { qrcode_code: code },
      fetcher
    );
    envelope = result.envelope;
  } catch {
    return { status: "pending" };
  }
  if (envelope.code !== 0 || envelope.data === void 0) return { status: "pending" };
  const raw = envelope.data.status;
  const status = typeof raw === "string" ? raw : "";
  const expiredAt = typeof envelope.data.expired_at === "string" ? envelope.data.expired_at : void 0;
  if (status === RACCOON_QR_STATUS.canceled) return { status: "canceled" };
  if (status === RACCOON_QR_STATUS.logging) {
    return { status: "logging", ...expiredAt !== void 0 ? { expiredAt } : {} };
  }
  if (status === RACCOON_QR_STATUS.success) {
    const accessToken = typeof envelope.data.access_token === "string" ? envelope.data.access_token : "";
    const refreshToken = typeof envelope.data.refresh_token === "string" ? envelope.data.refresh_token : "";
    if (accessToken.length === 0) return { status: "pending" };
    const expMs = decodeJwtExpMs(accessToken);
    return {
      status: "success",
      accessToken,
      refreshToken,
      ...expMs !== void 0 ? { expiresAt: String(expMs) } : {}
    };
  }
  return { status: "pending" };
}
async function sendRaccoonSmsCode(product, phone, captchaParam, fetcher = fetch) {
  const { envelope } = await postJson2(
    `${product.apiBase}${product.authApiPrefix}/send_sms`,
    {
      captcha_param: captchaParam,
      nation_code: "86",
      phone: encryptRaccoonPhone(phone)
    },
    fetcher
  );
  if (envelope.code !== 0) {
    if (envelope.code === 100006) {
      throw new Error("raccoon: \u56FE\u5F62\u9A8C\u8BC1\u7801\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5B8C\u6210\u6ED1\u5757\u9A8C\u8BC1");
    }
    throw envelopeError(envelope, "\u4E0B\u53D1\u77ED\u4FE1\u9A8C\u8BC1\u7801\u5931\u8D25");
  }
}
async function loginRaccoonWithSmsCode(product, phone, smsCode, fetcher = fetch) {
  const { envelope } = await postJson2(
    `${product.apiBase}${product.authApiPrefix}/login_with_sms`,
    {
      nation_code: "86",
      phone: encryptRaccoonPhone(phone),
      sms_code: smsCode
    },
    fetcher
  );
  if (envelope.code !== 0) throw envelopeError(envelope, "\u77ED\u4FE1\u767B\u5F55\u5931\u8D25");
  return credentialFromEnvelope(envelope);
}
function credentialFromEnvelope(envelope) {
  const data = envelope.data ?? {};
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : "";
  if (accessToken.length === 0) {
    throw new Error("raccoon: \u767B\u5F55\u54CD\u5E94\u7F3A\u5C11 access_token");
  }
  const expMs = decodeJwtExpMs(accessToken);
  const officeIdentity = typeof data.office_identity === "string" ? data.office_identity : "";
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    ...expMs !== void 0 ? { expires_at: String(expMs) } : {},
    ...officeIdentity.length > 0 ? { office_identity: officeIdentity } : {}
  };
}
async function refreshRaccoonCredential(product, credential, fetcher = fetch) {
  const { envelope, status } = await postJson2(
    `${product.apiBase}${product.authApiPrefix}/refresh`,
    { refresh_token: credential.refresh_token },
    fetcher
  );
  if (status === 401 || envelope.code === 200003) {
    throw new Error("raccoon: \u767B\u5F55\u6001\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
  }
  if (envelope.code !== 0) throw envelopeError(envelope, "\u7EED\u671F\u5931\u8D25");
  const data = envelope.data ?? {};
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  if (accessToken.length === 0) {
    throw new Error("raccoon: \u7EED\u671F\u54CD\u5E94\u7F3A\u5C11 access_token");
  }
  const nextRefresh = typeof data.refresh_token === "string" && data.refresh_token.length > 0 ? data.refresh_token : credential.refresh_token;
  const expMs = decodeJwtExpMs(accessToken);
  return {
    ...credential,
    access_token: accessToken,
    refresh_token: nextRefresh,
    ...expMs !== void 0 ? { expires_at: String(expMs) } : {}
  };
}
async function fetchRaccoonUserInfo(product, credential, fetcher = fetch) {
  try {
    const response = await fetcher(`${product.apiBase}${product.authApiPrefix}/user_info`, {
      method: "GET",
      headers: raccoonHeaders(credential),
      signal: AbortSignal.timeout(RACCOON_REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) return {};
    const envelope = parseEnvelope2(await response.json(), response.status);
    if (envelope.code !== 0 || envelope.data === void 0) return {};
    const userId = typeof envelope.data.id === "string" ? envelope.data.id : "";
    const nickname = typeof envelope.data.name === "string" ? envelope.data.name : "";
    const officeIdentity = typeof envelope.data.office_identity === "string" ? envelope.data.office_identity : "";
    const phone = typeof envelope.data.phone === "string" ? envelope.data.phone : "";
    return {
      ...userId.length > 0 ? { userId } : {},
      ...nickname.length > 0 ? { nickname } : {},
      ...officeIdentity.length > 0 ? { officeIdentity } : {},
      ...phone.length > 0 ? { phone } : {}
    };
  } catch {
    return {};
  }
}

// vendor/channel-pack/src/raccoon-login-page.ts
import { createServer } from "node:http";

// vendor/channel-pack/src/raccoon-qr.ts
var DATA_CODEWORDS = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
var EC_BLOCKS_M = [
  void 0,
  { ecPerBlock: 10, groups: [[1, 16]] },
  { ecPerBlock: 16, groups: [[1, 28]] },
  { ecPerBlock: 26, groups: [[1, 44]] },
  { ecPerBlock: 18, groups: [[2, 32]] },
  { ecPerBlock: 24, groups: [[2, 43]] },
  { ecPerBlock: 16, groups: [[4, 27]] },
  { ecPerBlock: 18, groups: [[4, 31]] },
  { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  { ecPerBlock: 26, groups: [[4, 43], [1, 44]] }
];
var GF_EXP = new Uint8Array(512);
var GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if ((x & 256) !== 0) x ^= 285;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255] ?? 0;
}
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)] ?? 0;
}
function polyMul(a, b) {
  const result = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] ^= gfMul(a[i] ?? 0, b[j] ?? 0);
    }
  }
  return result;
}
function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    poly = polyMul(poly, [1, GF_EXP[i] ?? 0]);
  }
  return poly;
}
function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const buf = [...data, ...new Array(ecCount).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i] ?? 0;
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      buf[i + j] ^= gfMul(gen[j] ?? 0, coef);
    }
  }
  return buf.slice(data.length);
}
function pickVersion(byteLength) {
  for (let version = 1; version <= 10; version++) {
    const capacityBits = (DATA_CODEWORDS[version] ?? 0) * 8;
    const overheadBits = 4 + (version <= 9 ? 8 : 16);
    if (overheadBits + byteLength * 8 <= capacityBits) return version;
  }
  return void 0;
}
function buildCodewords(bytes, version) {
  const blocks = EC_BLOCKS_M[version];
  if (blocks === void 0) throw new Error(`raccoon: \u4E0D\u652F\u6301\u7684\u4E8C\u7EF4\u7801\u7248\u672C ${version}`);
  const totalDataCodewords = DATA_CODEWORDS[version] ?? 0;
  const capacityBits = totalDataCodewords * 8;
  const bits = [];
  const pushBits = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push(value >> i & 1);
  };
  pushBits(4, 4);
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) pushBits(byte, 8);
  const terminator = Math.min(4, capacityBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);
  const PAD_BYTES = [236, 17];
  for (let i = 0; bits.length < capacityBits; i++) {
    pushBits(PAD_BYTES[i % 2] ?? 0, 8);
  }
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = byte << 1 | (bits[i + j] ?? 0);
    dataCodewords.push(byte);
  }
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, dataPerBlock] of blocks.groups) {
    for (let b = 0; b < count; b++) {
      const block = dataCodewords.slice(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, blocks.ecPerBlock));
    }
  }
  const result = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i] ?? 0);
    }
  }
  for (let i = 0; i < blocks.ecPerBlock; i++) {
    for (const block of ecBlocks) {
      result.push(block[i] ?? 0);
    }
  }
  return result;
}
function alignmentPositions(version, size) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}
function drawFinderPattern(modules, isFunction, size, x, y) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const dark = dist !== 2 && dist !== 4;
      modules[yy][xx] = dark;
      isFunction[yy][xx] = true;
    }
  }
}
function drawAlignmentPattern(modules, isFunction, x, y) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
      modules[y + dy][x + dx] = dark;
      isFunction[y + dy][x + dx] = true;
    }
  }
}
function drawFunctionPatterns(modules, isFunction, size, version) {
  for (let i = 0; i < size; i++) {
    const dark = i % 2 === 0;
    modules[6][i] = dark;
    isFunction[6][i] = true;
    modules[i][6] = dark;
    isFunction[i][6] = true;
  }
  drawFinderPattern(modules, isFunction, size, 3, 3);
  drawFinderPattern(modules, isFunction, size, size - 4, 3);
  drawFinderPattern(modules, isFunction, size, 3, size - 4);
  const positions = alignmentPositions(version, size);
  const n = positions.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const isCorner = i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0;
      if (isCorner) continue;
      drawAlignmentPattern(modules, isFunction, positions[i] ?? 0, positions[j] ?? 0);
    }
  }
  drawFormatBits(modules, isFunction, size, 0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
      rem = rem << 1 ^ (rem >>> 11) * 7973;
    }
    const bits = version << 12 | rem;
    for (let i = 0; i < 18; i++) {
      const dark = (bits >> i & 1) === 1;
      const a = size - 11 + i % 3;
      const b = Math.floor(i / 3);
      modules[b][a] = dark;
      isFunction[b][a] = true;
      modules[a][b] = dark;
      isFunction[a][b] = true;
    }
  }
}
function drawFormatBits(modules, isFunction, size, mask) {
  const data = 0 << 3 | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = rem << 1 ^ (rem >>> 9) * 1335;
  }
  const bits = (data << 10 | rem) ^ 21522;
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };
  const bit = (i) => (bits >> i & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 7 + (i - 8), bit(i));
  set(8, size - 8, true);
}
function drawCodewords(modules, isFunction, size, codewords) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = (right + 1 & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFunction[y][x] !== true && i < codewords.length * 8) {
          const byte = codewords[i >>> 3] ?? 0;
          modules[y][x] = (byte >> 7 - (i & 7) & 1) === 1;
          i++;
        }
      }
    }
  }
}
function applyMask(modules, isFunction, size, mask) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunction[y][x] === true) continue;
      let invert;
      switch (mask) {
        case 0:
          invert = (x + y) % 2 === 0;
          break;
        case 1:
          invert = y % 2 === 0;
          break;
        case 2:
          invert = x % 3 === 0;
          break;
        case 3:
          invert = (x + y) % 3 === 0;
          break;
        case 4:
          invert = (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
          break;
        case 5:
          invert = x * y % 2 + x * y % 3 === 0;
          break;
        case 6:
          invert = (x * y % 2 + x * y % 3) % 2 === 0;
          break;
        default:
          invert = ((x + y) % 2 + x * y % 3) % 2 === 0;
          break;
      }
      if (invert) modules[y][x] = !modules[y][x];
    }
  }
}
function computePenalty(modules, size) {
  const N1 = 3;
  const N2 = 3;
  const N3 = 40;
  const N4 = 10;
  let result = 0;
  for (let y = 0; y < size; y++) {
    const row = modules[y];
    result += penaltyForLine(row, size, N1, N3);
  }
  for (let x = 0; x < size; x++) {
    const col = [];
    for (let y = 0; y < size; y++) col.push(modules[y][x] === true);
    result += penaltyForLine(col, size, N1, N3);
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        result += N2;
      }
    }
  }
  let dark = 0;
  for (const row of modules) {
    for (const cell of row) if (cell) dark++;
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += Math.max(0, k) * N4;
  return result;
}
function penaltyForLine(line, size, N1, N3) {
  let result = 0;
  let runLength = 1;
  for (let i = 1; i < size; i++) {
    if (line[i] === line[i - 1]) {
      runLength++;
    } else {
      if (runLength >= 5) result += N1 + (runLength - 5);
      runLength = 1;
    }
  }
  if (runLength >= 5) result += N1 + (runLength - 5);
  const PATTERN_A = [true, false, true, true, true, false, true, false, false, false, false];
  const PATTERN_B = [false, false, false, false, true, false, true, true, true, false, true];
  for (let i = 0; i + 11 <= size; i++) {
    let matchA = true;
    let matchB = true;
    for (let j = 0; j < 11; j++) {
      if (line[i + j] !== PATTERN_A[j]) matchA = false;
      if (line[i + j] !== PATTERN_B[j]) matchB = false;
      if (!matchA && !matchB) break;
    }
    if (matchA) result += N3;
    if (matchB) result += N3;
  }
  return result;
}
function buildQrMatrix(text, options = {}) {
  const level = options.errorCorrection ?? "M";
  if (level !== "M") {
    throw new Error(`raccoon: \u4E8C\u7EF4\u7801\u76EE\u524D\u53EA\u652F\u6301\u7EA0\u9519\u7B49\u7EA7 M\uFF08\u6536\u5230 ${level}\uFF09`);
  }
  const forcedMask = options.mask;
  if (forcedMask !== void 0 && (!Number.isInteger(forcedMask) || forcedMask < 0 || forcedMask > 7)) {
    throw new Error(`raccoon: \u63A9\u7801\u5FC5\u987B\u662F 0..7 \u7684\u6574\u6570\uFF08\u6536\u5230 ${String(forcedMask)}\uFF09`);
  }
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  if (version === void 0) {
    throw new Error(
      `raccoon: \u4E8C\u7EF4\u7801\u5185\u5BB9\u8FC7\u957F\uFF08${bytes.length} \u5B57\u8282\uFF0C\u4E0A\u9650 213 \u5B57\u8282\uFF09\uFF0C\u8BF7\u7F29\u77ED\u5185\u5BB9`
    );
  }
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  drawFunctionPatterns(modules, isFunction, size, version);
  drawCodewords(modules, isFunction, size, buildCodewords(bytes, version));
  let bestMask = 0;
  if (forcedMask !== void 0) {
    bestMask = forcedMask;
  } else {
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(modules, isFunction, size, mask);
      drawFormatBits(modules, isFunction, size, mask);
      const penalty = computePenalty(modules, size);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
      }
      applyMask(modules, isFunction, size, mask);
    }
  }
  applyMask(modules, isFunction, size, bestMask);
  drawFormatBits(modules, isFunction, size, bestMask);
  return { size, modules };
}
function renderQrSvg(text, options = {}) {
  const px = options.size ?? 158;
  const margin = options.margin ?? 4;
  const dark = options.dark ?? "#000000";
  const light = options.light ?? "#ffffff";
  const { size, modules } = buildQrMatrix(text);
  const dim = size + margin * 2;
  const segments = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y]?.[x] === true) {
        segments.push(`M${x + margin},${y + margin}h1v1h-1z`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img"><rect width="${dim}" height="${dim}" fill="${light}"/><path d="${segments.join("")}" fill="${dark}"/></svg>`;
}

// vendor/channel-pack/src/raccoon-login-page.ts
var RACCOON_LOGIN_PAGE_PATHS = {
  login: "/raccoon/login",
  poll: "/raccoon/poll",
  smsSend: "/raccoon/sms/send",
  smsVerify: "/raccoon/sms/verify"
};
async function startRaccoonLoginFlow(options = {}) {
  const product = options.product ?? RACCOON;
  const fetcher = options.fetcher ?? fetch;
  const state = {
    qrCode: generateQrCode(),
    phone: "",
    lastExpiredAt: void 0
  };
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve2, reject) => {
    resolveResult = resolve2;
    rejectResult = reject;
  });
  result.catch(() => {
  });
  let settled = false;
  const settleOk = (value) => {
    if (settled) return;
    settled = true;
    resolveResult(value);
  };
  const settleErr = (error) => {
    if (settled) return;
    settled = true;
    rejectResult(error);
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response, { state, product, fetcher, settleOk }).catch(
      (error) => {
        try {
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(`\u5185\u90E8\u9519\u8BEF\uFF1A${error instanceof Error ? error.message : String(error)}`);
        } catch {
        }
      }
    );
  });
  const port = await listenOnRandomPort(server);
  const loginUrl = `http://127.0.0.1:${port}${RACCOON_LOGIN_PAGE_PATHS.login}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    settleErr(new Error("raccoon: \u767B\u5F55\u6D41\u7A0B\u5DF2\u5173\u95ED"));
    await new Promise((resolve2) => {
      server.close(() => resolve2());
    });
  };
  const timeoutMs = options.timeoutMs ?? RACCOON_LOGIN_TIMEOUT_MS;
  const timer = setTimeout(() => {
    settleErr(new Error(`raccoon: \u767B\u5F55\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)} \u79D2\u5185\u672A\u5B8C\u6210\uFF09`));
  }, timeoutMs);
  timer.unref?.();
  void result.catch(() => {
  }).finally(() => {
    clearTimeout(timer);
    if (!closed) {
      closed = true;
      void new Promise((resolve2) => {
        server.close(() => resolve2());
      });
    }
  });
  return { loginUrl, result, close };
}
async function handleRequest(request, response, deps) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${request.socket.localPort ?? 0}`);
  const { state, product } = deps;
  if (url.pathname === RACCOON_LOGIN_PAGE_PATHS.login) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(renderRaccoonLoginPage(product, state.qrCode));
    return;
  }
  if (url.pathname === RACCOON_LOGIN_PAGE_PATHS.poll) {
    const polled = await pollRaccoonQrLogin(product, state.qrCode, deps.fetcher);
    if (polled.status === "success" && polled.accessToken !== void 0) {
      const credential = {
        access_token: polled.accessToken,
        refresh_token: polled.refreshToken ?? "",
        ...polled.expiresAt !== void 0 ? { expires_at: polled.expiresAt } : {}
      };
      deps.settleOk(credential);
      writeJson(response, { status: "success" });
      return;
    }
    if (polled.expiredAt !== void 0) state.lastExpiredAt = polled.expiredAt;
    if (polled.status === "canceled") {
      state.qrCode = generateQrCode();
    }
    writeJson(response, {
      status: polled.status,
      ...polled.expiredAt !== void 0 ? { expiredAt: polled.expiredAt } : {},
      // code 变化时把新二维码给页面（页面据此换图）
      ...polled.status === "canceled" ? { qr: renderQrSvg(buildQrImageUrl(product, state.qrCode)) } : {}
    });
    return;
  }
  if (url.pathname === RACCOON_LOGIN_PAGE_PATHS.smsSend && request.method === "POST") {
    const body = await readJsonBody(request);
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const captchaParam = typeof body.captchaParam === "string" ? body.captchaParam : "";
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, message: "\u8BF7\u8F93\u5165\u6709\u6548\u7684 11 \u4F4D\u624B\u673A\u53F7" }));
      return;
    }
    try {
      await sendRaccoonSmsCode(product, phone, captchaParam, deps.fetcher);
      state.phone = phone;
      writeJson(response, { ok: true });
    } catch (error) {
      writeJson(response, {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }
  if (url.pathname === RACCOON_LOGIN_PAGE_PATHS.smsVerify && request.method === "POST") {
    const body = await readJsonBody(request);
    const smsCode = typeof body.smsCode === "string" ? body.smsCode.trim() : "";
    if (state.phone.length === 0) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, message: "\u8BF7\u5148\u83B7\u53D6\u624B\u673A\u9A8C\u8BC1\u7801" }));
      return;
    }
    if (smsCode.length === 0) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, message: "\u8BF7\u8F93\u5165\u9A8C\u8BC1\u7801" }));
      return;
    }
    try {
      const credential = await loginRaccoonWithSmsCode(product, state.phone, smsCode, deps.fetcher);
      deps.settleOk(credential);
      writeJson(response, { ok: true });
    } catch (error) {
      writeJson(response, {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
}
function writeJson(response, payload) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = chunk;
    total += buf.length;
    if (total > 64 * 1024) throw new Error("\u8BF7\u6C42\u4F53\u8FC7\u5927");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (text.length === 0) return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON");
  }
}
function listenOnRandomPort(server) {
  return new Promise((resolve2, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      if (port === 0) {
        reject(new Error("raccoon: \u672C\u5730\u767B\u5F55\u9875\u670D\u52A1\u5668\u672A\u80FD\u83B7\u5F97\u7AEF\u53E3"));
        return;
      }
      resolve2(port);
    });
  });
}
function renderRaccoonLoginPage(product, qrCode) {
  const code = qrCode ?? generateQrCode();
  const qrSvg = renderQrSvg(buildQrImageUrl(product, code), { size: 200 });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raccoon Work \u767B\u5F55</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #f5f6f8; color: #1f2329; }
  .card { background: #fff; border-radius: 12px; padding: 20px 24px 24px; box-shadow: 0 4px 24px rgba(0,0,0,.08);
          text-align: center; width: 320px; }
  h1 { font-size: 16px; margin: 0 0 14px; font-weight: 600; }
  .tabs { display: flex; gap: 4px; background: #f2f3f5; border-radius: 8px; padding: 4px; margin-bottom: 16px; }
  .tabs button { flex: 1; padding: 7px; font-size: 13px; border: 0; border-radius: 6px;
                 background: transparent; color: #4e5969; cursor: pointer; }
  .tabs button[data-active="1"] { background: #fff; color: #1f2329; font-weight: 600;
                                  box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .pane { display: none; }
  .pane[data-show="1"] { display: block; }
  /* \u4E8C\u7EF4\u7801\u5BB9\u5668\uFF1ASVG \u81EA\u9002\u5E94\u586B\u5145\uFF08SVG \u81EA\u5E26 width/height \u4E0E viewBox\uFF09 */
  .qr { width: 200px; height: 200px; display: block; margin: 0 auto; border: 1px solid #eceef1;
        border-radius: 8px; padding: 6px; box-sizing: content-box; background: #fff; }
  .qr svg { display: block; width: 100%; height: 100%; }
  .sub { font-size: 12px; color: #8a9099; margin: 10px 0 0; }
  .status { margin-top: 12px; font-size: 13px; color: #4e5969; min-height: 20px; }
  .status[data-tone="ok"] { color: #0f9d58; font-weight: 600; }
  .status[data-tone="err"] { color: #d93026; }
  label { display: block; font-size: 12px; color: #8a9099; margin-bottom: 4px; text-align: left; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 14px; margin-bottom: 10px;
          border: 1px solid #d9dde3; border-radius: 6px; }
  button.primary { width: 100%; padding: 9px; font-size: 14px; border: 0; border-radius: 6px;
                   background: #8E6BF2; color: #fff; cursor: pointer; }
  button.primary:disabled { background: #c9cdd4; cursor: not-allowed; }
  .row { display: flex; gap: 8px; align-items: flex-start; }
  .row input { margin-bottom: 10px; }
  #captcha-element { margin-bottom: 10px; }
</style>
</head>
<body>
  <div class="card">
    <h1>\u767B\u5F55 Raccoon Work</h1>

    <div class="tabs">
      <button id="tabQr" data-active="1" type="button">\u5FAE\u4FE1\u626B\u7801</button>
      <button id="tabSms" data-active="0" type="button">\u77ED\u4FE1\u767B\u5F55</button>
    </div>

    <div class="pane" id="paneQr" data-show="1">
      <div class="qr" id="qrBox">${qrSvg}</div>
      <p class="sub">\u6253\u5F00\u5FAE\u4FE1\u626B\u4E00\u626B\uFF0C\u626B\u63CF\u4E0A\u65B9\u4E8C\u7EF4\u7801</p>
      <div class="status" id="qrStatus">\u7B49\u5F85\u626B\u7801\u2026</div>
    </div>

    <div class="pane" id="paneSms" data-show="0">
      <label for="phone">\u624B\u673A\u53F7</label>
      <div class="row">
        <input id="phone" type="tel" inputmode="numeric" maxlength="11" placeholder="\u8BF7\u8F93\u5165 11 \u4F4D\u624B\u673A\u53F7">
        <button class="primary" id="sendCode" type="button" style="width:auto;white-space:nowrap;padding:9px 12px;">\u83B7\u53D6\u9A8C\u8BC1\u7801</button>
      </div>
      <div id="captcha-element"></div>
      <label for="smsCode">\u9A8C\u8BC1\u7801</label>
      <input id="smsCode" type="text" inputmode="numeric" maxlength="6" placeholder="\u8BF7\u8F93\u5165 6 \u4F4D\u9A8C\u8BC1\u7801">
      <button class="primary" id="doLogin" type="button">\u767B\u5F55</button>
      <div class="status" id="smsStatus"></div>
    </div>
  </div>

<script src="https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js"></script>
<script>
(function () {
  'use strict';
  var POLL_INTERVAL_MS = 2000;
  var paths = ${JSON.stringify(RACCOON_LOGIN_PAGE_PATHS)};

  // \u2500\u2500 Tab \u5207\u6362 \u2500\u2500
  var tabQr = document.getElementById('tabQr');
  var tabSms = document.getElementById('tabSms');
  var paneQr = document.getElementById('paneQr');
  var paneSms = document.getElementById('paneSms');
  function selectTab(sms) {
    tabQr.setAttribute('data-active', sms ? '0' : '1');
    tabSms.setAttribute('data-active', sms ? '1' : '0');
    paneQr.setAttribute('data-show', sms ? '0' : '1');
    paneSms.setAttribute('data-show', sms ? '1' : '0');
  }
  tabQr.addEventListener('click', function () { selectTab(false); });
  tabSms.addEventListener('click', function () { selectTab(true); });

  // \u2500\u2500 \u626B\u7801\u8F6E\u8BE2 \u2500\u2500
  var qrStatus = document.getElementById('qrStatus');
  var qrBox = document.getElementById('qrBox');
  var pollTimer = null;
  function setQrStatus(text, tone) {
    qrStatus.textContent = text;
    if (tone) { qrStatus.setAttribute('data-tone', tone); } else { qrStatus.removeAttribute('data-tone'); }
  }
  function pollOnce() {
    fetch(paths.poll).then(function (r) { return r.json(); }).then(function (data) {
      if (data.status === 'success') {
        setQrStatus('\u767B\u5F55\u6210\u529F\uFF0C\u53EF\u4EE5\u5173\u95ED\u6B64\u7A97\u53E3\u4E86', 'ok');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        setTimeout(function () { window.close(); }, 1200);
        return;
      }
      if (data.status === 'logging') { setQrStatus('\u5DF2\u626B\u7801\uFF0C\u8BF7\u5728\u5FAE\u4FE1\u4E2D\u786E\u8BA4\u2026'); return; }
      if (data.status === 'canceled') {
        if (data.qr) { qrBox.innerHTML = data.qr; }
        setQrStatus('\u4E8C\u7EF4\u7801\u5DF2\u5237\u65B0\uFF0C\u8BF7\u91CD\u65B0\u626B\u7801');
        return;
      }
      setQrStatus('\u7B49\u5F85\u626B\u7801\u2026');
    }).catch(function () {
      // \u8F6E\u8BE2\u5076\u53D1\u5931\u8D25\u4E0D\u6253\u65AD\uFF08\u4E0B\u4E00\u6B21\u7EE7\u7EED\uFF09
    });
  }
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  pollOnce();

  // \u2500\u2500 \u77ED\u4FE1\u767B\u5F55 \u2500\u2500
  var smsStatus = document.getElementById('smsStatus');
  var phoneInput = document.getElementById('phone');
  var smsCodeInput = document.getElementById('smsCode');
  var sendBtn = document.getElementById('sendCode');
  var loginBtn = document.getElementById('doLogin');
  var captchaInstance = null;
  var pendingCaptcha = null;

  function setSmsStatus(text, tone) {
    smsStatus.textContent = text || '';
    if (tone) { smsStatus.setAttribute('data-tone', tone); } else { smsStatus.removeAttribute('data-tone'); }
  }

  function submitSmsSend(captchaParam) {
    var phone = (phoneInput.value || '').trim();
    if (!/^1[3-9]\\d{9}$/.test(phone)) {
      setSmsStatus('\u8BF7\u8F93\u5165\u6709\u6548\u7684 11 \u4F4D\u624B\u673A\u53F7', 'err');
      return;
    }
    sendBtn.disabled = true;
    setSmsStatus('\u53D1\u9001\u4E2D\u2026');
    fetch(paths.smsSend, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone, captchaParam: captchaParam || '' })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.ok) { setSmsStatus('\u9A8C\u8BC1\u7801\u5DF2\u53D1\u9001\uFF0C\u8BF7\u67E5\u6536\u77ED\u4FE1', 'ok'); }
      else { setSmsStatus((data && data.message) || '\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5', 'err'); }
    }).catch(function () {
      setSmsStatus('\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5', 'err');
    }).finally(function () {
      sendBtn.disabled = false;
    });
  }

  // \u963F\u91CC\u4E91\u6ED1\u5757\uFF1A\u771F\u5B9E\u52A0\u8F7D\u5B98\u65B9\u811A\u672C\uFF08SceneId / prefix \u6765\u81EA\u5BA2\u6237\u7AEF\u914D\u7F6E\uFF09\u3002
  function initCaptcha() {
    if (typeof window.initAliyunCaptcha !== 'function') { return false; }
    window.initAliyunCaptcha({
      SceneId: '${product.aliyunCaptcha.sceneId}',
      prefix: '${product.aliyunCaptcha.prefix}',
      mode: 'popup',
      element: '#captcha-element',
      button: '#sendCode',
      captchaVerifyCallback: function (captchaParam) {
        pendingCaptcha = captchaParam;
        submitSmsSend(captchaParam);
        return { captchaResult: true, bizResult: true };
      },
      onBizResultCallback: function () { return null; },
      getInstance: function (instance) { captchaInstance = instance; return null; },
      slideStyle: { width: 320, height: 40 },
      language: 'cn'
    });
    return true;
  }
  var captchaReady = initCaptcha();
  sendBtn.addEventListener('click', function () {
    if (!captchaReady) { captchaReady = initCaptcha(); }
    if (!captchaReady) {
      // \u811A\u672C\u672A\u52A0\u8F7D\uFF08\u79BB\u7EBF/\u88AB\u62E6\u622A\uFF09\uFF1A\u9000\u5316\u4E3A\u76F4\u63A5\u63D0\u4EA4\uFF0C\u8BA9\u670D\u52A1\u7AEF\u62A5\u660E\u786E\u539F\u56E0
      // \uFF08\u5B9E\u6D4B\u4F1A\u56DE captcha_verify_error\uFF0C\u9875\u9762\u636E\u6B64\u63D0\u793A\u7528\u6237\uFF09\u3002
      setSmsStatus('\u9A8C\u8BC1\u7801\u7EC4\u4EF6\u672A\u52A0\u8F7D\uFF0C\u6B63\u5728\u5C1D\u8BD5\u76F4\u63A5\u53D1\u9001\u2026');
      submitSmsSend('');
    }
  });

  loginBtn.addEventListener('click', function () {
    var code = (smsCodeInput.value || '').trim();
    if (!code) { setSmsStatus('\u8BF7\u8F93\u5165\u9A8C\u8BC1\u7801', 'err'); return; }
    loginBtn.disabled = true;
    setSmsStatus('\u767B\u5F55\u4E2D\u2026');
    fetch(paths.smsVerify, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smsCode: code })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.ok) {
        setSmsStatus('\u767B\u5F55\u6210\u529F\uFF0C\u53EF\u4EE5\u5173\u95ED\u6B64\u7A97\u53E3\u4E86', 'ok');
        setTimeout(function () { window.close(); }, 1200);
      } else {
        setSmsStatus((data && data.message) || '\u9A8C\u8BC1\u7801\u4E0D\u6B63\u786E\uFF0C\u8BF7\u91CD\u8BD5', 'err');
      }
    }).catch(function () {
      setSmsStatus('\u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5', 'err');
    }).finally(function () {
      loginBtn.disabled = false;
    });
  });
})();
</script>
</body>
</html>`;
}

// vendor/channel-pack/src/refresh.ts
var REFRESH_LEAD_MS = 36e5;
var REFRESH_RETRY_MS = 6e5;
var REFRESH_ABNORMAL_NETWORK_RETRY_MS = 6e4;
function isAbnormalNetworkError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ENOTFOUND|ECONNREFUSED|proxy|unresolved host|getaddrinfo/i.test(message);
}
function isRefreshTokenExpired(error) {
  if (!(error instanceof Error)) return false;
  if (error.name === "RefreshTokenExpiredError") return true;
  return /refresh[_ ]?token/i.test(error.message);
}
function computeFirstRefreshDelayMs(expiresAtMs, nowMs = Date.now()) {
  if (!Number.isFinite(expiresAtMs)) return 0;
  const leadTrigger = nowMs + REFRESH_LEAD_MS;
  if (leadTrigger >= expiresAtMs) return 0;
  const trigger = new Date(leadTrigger);
  trigger.setSeconds(Math.floor(60 * Math.random()));
  const delay = trigger.getTime() - nowMs;
  return delay > 0 ? delay : 0;
}
var RefreshScheduler = class {
  constructor(refresh, onError = () => {
  }) {
    this.refresh = refresh;
    this.onError = onError;
  }
  timer;
  pending = false;
  /** 调度代号：stop()/arm() 都会推进它，用于让在途 run() 放弃失败后的重试武装。 */
  generation = 0;
  /** 为在 `expiresAtMs` 过期的凭据安排下次刷新；`nowMs` 仅供测试注入。 */
  arm(expiresAtMs, nowMs = Date.now()) {
    this.generation++;
    if (this.timer !== void 0) {
      clearTimeout(this.timer);
      this.timer = void 0;
    }
    const delay = computeFirstRefreshDelayMs(expiresAtMs, nowMs);
    this.timer = setTimeout(() => {
      void this.run();
    }, delay);
    this.timer.unref?.();
  }
  /** 取消任何待处理的刷新（并让在途 run() 失败后不再重试）。 */
  stop() {
    this.generation++;
    if (this.timer !== void 0) {
      clearTimeout(this.timer);
      this.timer = void 0;
    }
  }
  /** 立即执行一次刷新（供启动时已处于到期窗口内的凭据使用）。 */
  async refreshOnce() {
    this.stop();
    await this.run();
  }
  async run() {
    if (this.pending) return;
    this.pending = true;
    const generation = this.generation;
    try {
      await this.refresh();
    } catch (error) {
      this.onError(error);
      if (generation !== this.generation) {
        return;
      }
      if (isRefreshTokenExpired(error)) {
        return;
      }
      if (this.timer !== void 0) {
        clearTimeout(this.timer);
      }
      const retry = isAbnormalNetworkError(error) ? REFRESH_ABNORMAL_NETWORK_RETRY_MS : REFRESH_RETRY_MS;
      this.timer = setTimeout(() => {
        void this.run();
      }, retry);
      this.timer.unref?.();
    } finally {
      this.pending = false;
    }
  }
};

// vendor/channel-pack/src/expiry-sync.ts
var EXPIRY_TOLERANCE_MS = 1e3;
function shouldRefreshNow(expiresAtMs, nowMs = Date.now()) {
  if (expiresAtMs === void 0 || !Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - nowMs <= REFRESH_LEAD_MS;
}
async function syncAccountExpiry(params) {
  const { pool, provider, credential, accessors, accountId, current, tag } = params;
  if (pool === void 0) return;
  try {
    let id = accountId;
    if (id === void 0 || id.length === 0) {
      id = await pool.findAccountIdByCredential(provider, accessors.identityOf(credential));
    }
    if (id === void 0 || id.length === 0) return;
    const expiresAt = accessors.expiresAtOf(credential);
    const refreshable = accessors.refreshableOf?.(credential);
    if (expiresAt === void 0 && refreshable === void 0) return;
    const expiryChanged = expiresAt !== void 0 && (current?.expiresAt === void 0 || Math.abs(current.expiresAt - expiresAt) > EXPIRY_TOLERANCE_MS);
    const refreshableChanged = refreshable !== void 0 && (current === void 0 || current.refreshable !== refreshable);
    if (!expiryChanged && !refreshableChanged) return;
    await pool.updateAccount(id, {
      ...expiresAt === void 0 ? {} : { expiresAt },
      ...refreshable === void 0 ? {} : { refreshable }
    });
  } catch (error) {
    params.warn?.(
      `${tag} \u51ED\u636E\u5904\u7406\u6210\u529F\u4F46\u56DE\u5199\u8D26\u53F7\u6C60\u7684\u6709\u6548\u671F\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u4F7F\u7528\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
    );
  }
}
async function refreshAccountWithReconcile(params) {
  const { pool, provider, tag, accountId, credential, accessors, current, refresh, save } = params;
  const expiresAt = accessors.expiresAtOf(credential);
  if (!shouldRefreshNow(expiresAt)) {
    await syncAccountExpiry({
      pool,
      provider,
      credential,
      accessors,
      accountId,
      current,
      tag,
      warn: params.warn
    });
    return false;
  }
  const refreshed = await refresh(credential);
  if (refreshed === void 0) {
    throw new Error(`${tag} \u7EED\u671F\u54CD\u5E94\u7F3A\u5C11\u8BBF\u95EE\u4EE4\u724C\uFF0C\u51ED\u636E\u672A\u66F4\u65B0`);
  }
  await save(refreshed);
  await syncAccountExpiry({
    pool,
    provider,
    credential: refreshed,
    accessors,
    accountId,
    current,
    tag,
    warn: params.warn
  });
  params.info?.(`${tag} \u8D26\u53F7 ${accountId} \u5DF2\u7EED\u671F`);
  return true;
}

// vendor/channel-pack/src/raccoon-auth.ts
var RACCOON_EXPIRY_ACCESSORS = {
  expiresAtOf: raccoonCredentialExpiresAtMs,
  refreshableOf: isRaccoonRefreshable,
  identityOf: (credential) => credential.access_token ?? ""
};
var RefreshTokenExpiredError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "RefreshTokenExpiredError";
  }
};
function parseRaccoonCredential(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && typeof parsed.access_token === "string" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function normalizeRemoteModel(entry) {
  const id = typeof entry.name === "string" ? entry.name.trim() : "";
  if (id.length === 0) return void 0;
  if (entry.visible === false) return void 0;
  const params = typeof entry.params === "object" && entry.params !== null ? entry.params : {};
  const description = typeof entry.description === "string" && entry.description.length > 0 ? entry.description : id;
  const effective = typeof entry.billing_effective_multiplier === "number" ? entry.billing_effective_multiplier : Number.NaN;
  const base = typeof entry.billing_multiplier === "number" ? entry.billing_multiplier : Number.NaN;
  const rawStatus = typeof entry.billing_status === "string" ? entry.billing_status : "";
  const status = rawStatus === "discount" || rawStatus === "limited_free" ? rawStatus : "normal";
  const statusNote = typeof entry.billing_status_note === "string" ? entry.billing_status_note : "";
  const thinking = parseRaccoonThinking(params.raccoon_thinking);
  const meta = {
    id,
    description,
    effectiveMultiplier: effective,
    baseMultiplier: base,
    status,
    statusNote
  };
  const readPositiveInt = (value) => {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
  };
  const tags = Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === "string").map((t) => t.toLowerCase()) : [];
  return {
    id,
    name: raccoonDisplayName(meta),
    contextWindow: readPositiveInt(params.context_window ?? entry.context_window),
    maxTokens: readPositiveInt(params.max_tokens),
    // ⚠️ 只保留**有限**数值：NaN / Infinity 一律视为「未下发」，
    // 交给调用方按缺省规则（本插件：缺失 → 订阅版）分流。
    ...Number.isFinite(effective) ? { effectiveMultiplier: effective } : {},
    // 促销判定信息（模型选择器徽标用，见 `model-rate-badge.ts`）：
    // 与 `effectiveMultiplier` 同口径 —— 非有限数视为「未下发」，不折算成 0。
    status,
    ...Number.isFinite(base) ? { baseMultiplier: base } : {},
    ...statusNote.length > 0 ? { statusNote } : {},
    ...thinking === void 0 ? {} : { thinking },
    // ⚠️ **不能只看 tags**：`vision` 是客户端「Raccoon-Auto 选模」的偏好标签，
    // 不是服务端能力契约（远端根本没有模态字段，已穷举证实）。`tags` 不含
    // `vision` 的 `sn-deepseek-v4-1-flash` 实测能看图（5/5 读对随机数字），
    // 只认 tags 会让它被 DSH 投影成文本占位符 —— 图片根本发不出去。
    // 证据与取舍见 `raccoon-product.ts` 的 RACCOON_IMAGE_CAPABILITY_OVERRIDES。
    ...raccoonSupportsImage(id, tags) ? { supportsImage: true } : {}
  };
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function planTypeOf(value) {
  const plan = asRecord(value);
  if (plan === void 0) return void 0;
  for (const key of ["type", "plan_type", "planType"]) {
    const raw = plan[key];
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim().toLowerCase();
  }
  return void 0;
}
function isPaidPlanType(planType) {
  return planType !== "none" && planType !== "free";
}
function parseRaccoonPlan(payload) {
  const root = asRecord(payload);
  if (root === void 0) return "unknown";
  const blocks = [root.office, root.data, root.result, root.code, root].map(asRecord).filter((block) => block !== void 0);
  let explicitFree = false;
  for (const block of blocks) {
    if (block.pro_enable === true) return "pro";
    if (block.pro_enable === false) explicitFree = true;
    for (const key of ["active_plan", "activePlan", "plan", "subscription"]) {
      const planType = planTypeOf(block[key]);
      if (planType === void 0) continue;
      if (isPaidPlanType(planType)) return "pro";
      explicitFree = true;
    }
  }
  return explicitFree ? "free" : "unknown";
}
var RaccoonAuth = class extends Service {
  constructor(ctx, options = {}) {
    const product = options.product ?? RACCOON;
    super(ctx, options.serviceName ?? `${product.id}Auth`);
    this.options = options;
    this.product = product;
    this.credentialRefName = this.product.defaultCredentialRef;
  }
  /** 本实例所属的产品配置。 */
  product;
  /** 本实例默认读写的凭据 ref 名称。 */
  credentialRefName;
  /** 最近一次续期失败的原因（供 `status()` 暴露给 UI）。 */
  lastRefreshError;
  /** 注入的 fetch（测试用）；默认为全局 fetch。 */
  get fetchImpl() {
    return this.options.fetcher ?? fetch;
  }
  /**
   * 启动登录（微信扫码 + 短信双路径）。
   *
   * 起本地服务器承载弹窗页，**立即返回 `loginUrl`** —— 与其余 provider 的
   * 「两步式」契约一致（`window.open` 只在用户手势窗口内有效，
   * 不能等流程跑完再返回）。
   */
  async startLogin() {
    return startRaccoonLoginFlow({
      product: this.product,
      ...this.options.fetcher === void 0 ? {} : { fetcher: this.options.fetcher }
    });
  }
  /**
   * 把登录结果落盘成凭据。
   *
   * 与 `startLogin` 分开：流程编排（本地服务器 + 轮询 + 表单）在
   * `raccoon-login-page.ts` 里，本方法只负责「补全用户信息 + 写凭据 +
   * 静默领取一次性登录奖励」。
   */
  async persistLogin(credential, flowOptions = {}) {
    const refName = flowOptions.refName ?? this.credentialRefName;
    let enriched = credential;
    if (credential.nickname === void 0 || credential.user_id === void 0 || credential.phone === void 0) {
      const info = await fetchRaccoonUserInfo(this.product, credential, this.fetchImpl);
      enriched = {
        ...credential,
        ...info.userId !== void 0 && credential.user_id === void 0 ? { user_id: info.userId } : {},
        ...info.nickname !== void 0 && credential.nickname === void 0 ? { nickname: info.nickname } : {},
        ...info.officeIdentity !== void 0 && credential.office_identity === void 0 ? { office_identity: info.officeIdentity } : {},
        // ⚠️ 手机号专门为**多账号消歧**而存：远端的 `name` 是自动生成的默认名
        //（实测 `RaccoonAva`），微信扫码不回传微信昵称，故多个账号会重名。
        ...info.phone !== void 0 && credential.phone === void 0 ? { phone: info.phone } : {}
      };
    }
    const ref = credentialRef5(refName);
    await this.ctx.credentials.set(ref, JSON.stringify(enriched));
    this.lastRefreshError = void 0;
    try {
      await claimRaccoonLoginReward(this.product, enriched, this.fetchImpl);
    } catch (error) {
      this.ctx.logger?.warn?.(
        `[raccoon] \u767B\u5F55\u540E\u9886\u53D6\u767B\u5F55\u5956\u52B1\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u767B\u5F55\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
      );
    }
    return {
      access: JSON.stringify(enriched),
      expires: decodeJwtExpMs(enriched.access_token) ?? 0,
      ref,
      refreshable: isRaccoonRefreshable(enriched)
    };
  }
  /** 只读登录状态。 */
  async status() {
    const credential = await this.resolveDefaultCredential();
    if (credential === void 0) return { configured: false, refreshable: false };
    const expiresAt = decodeJwtExpMs(credential.access_token);
    return {
      configured: true,
      source: this.credentialRefName,
      ...expiresAt === void 0 ? {} : { expiresAt },
      refreshable: isRaccoonRefreshable(credential),
      ...this.lastRefreshError === void 0 ? {} : { refreshError: this.lastRefreshError }
    };
  }
  /** 解析默认 ref 的凭据。 */
  async resolveDefaultCredential() {
    try {
      const resolved = await this.ctx.credentials.resolve(credentialRef5(this.credentialRefName));
      return resolved === void 0 ? void 0 : parseRaccoonCredential(resolved.value);
    } catch {
      return void 0;
    }
  }
  /**
   * 续期默认单凭据。
   *
   * @throws {RefreshTokenExpiredError} refresh_token 失效（需重新登录）。
   */
  async refresh() {
    const credential = await this.resolveDefaultCredential();
    if (credential === void 0) throw new RefreshTokenExpiredError("\u51ED\u636E\u672A\u914D\u7F6E\uFF0C\u8BF7\u5148\u767B\u5F55");
    if (!isRaccoonRefreshable(credential)) {
      throw new RefreshTokenExpiredError("\u51ED\u636E\u7F3A\u5C11 refresh_token\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
    }
    try {
      const next = await refreshRaccoonCredential(this.product, credential, this.fetchImpl);
      await this.ctx.credentials.set(credentialRef5(this.credentialRefName), JSON.stringify(next));
      this.lastRefreshError = void 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastRefreshError = message;
      if (message.includes("\u91CD\u65B0\u767B\u5F55")) throw new RefreshTokenExpiredError(message);
      throw error;
    }
  }
  /**
   * 续期**指定 ref**（RPC `account.refresh` / 定时器）。
   *
   * ⚠️ 只读写传入的 ref，**不碰**默认单凭据 ref —— 账号池里的是
   * `RACCOON_ACCOUNT_XXX`，用 `refresh()` 会刷错凭据。
   * ⚠️ **不触碰** `lastRefreshError`：那属于单凭据路径，
   * 被多账号操作污染会让 UI 显示错误的失效提示。
   *
   * ⚠️ **必须把新过期时间写回账号池**（真实缺陷，用户报障）：
   * 只更新凭据、不更新账号池，会让 Channel Pack 一直显示「已过期」——
   * 因为 UI 读的是账号池的 `expiresAt`，而它停留在续期前的旧值。
   * 实测该账号的 JWT `exp` 已是 15:09（有效），账号池却是 12:02（已过期），
   * **相差 3.1 小时**，UI 显示「已过期」但发消息完全正常。
   *
   * @param pool 账号池；提供时会把新 `expiresAt` / `refreshable` 写回。
   * @param accountId 账号 id。**调用方已知时请显式传入** ——
   *   否则只能按凭据内容反查（`findAccountIdByCredential` 遍历账号、
   *   逐个解析凭据比对，代价高且需要账号池具备凭据访问能力）。
   */
  async refreshAccountCredential(refName, pool, accountId) {
    const ref = credentialRef5(refName);
    const resolved = await this.ctx.credentials.resolve(ref);
    if (!resolved) throw new Error("\u51ED\u636E\u672A\u914D\u7F6E");
    const credential = parseRaccoonCredential(resolved.value);
    if (!credential) throw new Error("\u51ED\u636E\u89E3\u6790\u5931\u8D25");
    if (!isRaccoonRefreshable(credential)) {
      throw new RefreshTokenExpiredError("\u51ED\u636E\u7F3A\u5C11 refresh_token\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
    }
    try {
      const next = await refreshRaccoonCredential(this.product, credential, this.fetchImpl);
      await this.ctx.credentials.set(ref, JSON.stringify(next));
      await syncAccountExpiry({
        pool,
        provider: this.product.id,
        credential: next,
        accessors: RACCOON_EXPIRY_ACCESSORS,
        accountId,
        tag: "[raccoon]",
        warn: (message) => this.ctx.logger?.warn?.(message)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("\u91CD\u65B0\u767B\u5F55")) throw new RefreshTokenExpiredError(message);
      throw error;
    }
  }
  /**
   * 说明：原先这里有一份私有的 `syncAccountExpiry`（把续期后的过期时间写回
   * 账号池，失败只记日志不上抛）。它已被抽到 `src/expiry-sync.ts` 成为九个
   * provider 共用的实现 —— 三条硬规矩（失败不反噬、优先用调用方的 accountId、
   * 反查要传**凭据内容**而非 ref 名）都随之外移并记在那份文件的注释里。
   */
  /**
   * 批量续期本产品的账号。
   *
   * ⚠️ **只按 `refreshable` 过滤，不看 `enabled`**：停用只影响账号池的
   * 自动选号，与「凭据是否需要保持新鲜」无关。早期按 `enabled` 过滤导致
   * 两个停用账号的 refresh_token 在停用期间被放到失效（真实缺陷，见 AGENTS.md）。
   *
   * 单账号失败不影响其他账号（且**必须留日志**：曾完全静默的实现
   * 让「续期永远失败但 UI 显示可续期」无法排查）。
   */
  async refreshAll(pool) {
    const accounts = await pool.listAccounts(this.product.id);
    for (const entry of accounts) {
      if (!entry.refreshable) continue;
      const resolved = await this.ctx.credentials.resolve(credentialRef5(entry.credentialRef));
      if (!resolved) continue;
      const credential = parseRaccoonCredential(resolved.value);
      if (credential === void 0) continue;
      if (!isRaccoonExpired(credential)) {
        const actual = raccoonCredentialExpiresAtMs(credential);
        if (actual !== void 0 && Math.abs((entry.expiresAt ?? 0) - actual) > 1e3) {
          try {
            await pool.updateAccount(entry.id, { expiresAt: actual });
            this.ctx.logger?.info?.(
              `[raccoon] \u5DF2\u6821\u6B63\u8D26\u53F7 ${entry.id} \u7684\u6709\u6548\u671F\u663E\u793A\uFF08\u8D26\u53F7\u6C60 ${entry.expiresAt === void 0 ? "\u65E0" : new Date(entry.expiresAt).toISOString()} \u2192 ${new Date(actual).toISOString()}\uFF09`
            );
          } catch (error) {
            this.ctx.logger?.warn?.(
              `[raccoon] \u6821\u6B63\u8D26\u53F7 ${entry.id} \u7684\u6709\u6548\u671F\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u4F7F\u7528\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        continue;
      }
      try {
        await this.refreshAccountCredential(entry.credentialRef, pool, entry.id);
      } catch (error) {
        if (error instanceof RefreshTokenExpiredError) {
          this.ctx.logger?.warn?.(`[raccoon] \u8D26\u53F7 ${entry.id} \u7684 refresh_token \u5DF2\u5931\u6548\uFF0C\u9700\u91CD\u65B0\u767B\u5F55`);
        } else {
          this.ctx.logger?.warn?.(
            `[raccoon] \u8D26\u53F7 ${entry.id} \u7EED\u671F\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }
  /** 登出：清除默认单凭据。 */
  async logout() {
    await this.ctx.credentials.unset(credentialRef5(this.credentialRefName));
    this.lastRefreshError = void 0;
  }
  /**
   * 拉取远端模型目录。
   *
   * ⚠️ 失败时返回**空数组**：适配器据此回退兜底表。
   * 让模型目录失败不抛错，是为了不让整个 provider 在模型选择器里报错。
   */
  async fetchModels(pool) {
    const credential = await this.resolveForFetchModels(pool);
    if (credential === void 0) return [];
    return this.fetchModelsWithCredential(credential);
  }
  /**
   * 用**指定凭据**拉远端模型目录。
   *
   * 为什么要把 fetch+parse 抽出来：`billing_effective_multiplier` 是**按账号
   * 套餐生效**的 —— 免费账号看到 0× 的那两条，订阅账号看到计费的那几条。
   * 而本插件只有一个账号池（`raccoon`），两个模型 provider 必须各自用
   * 「属于自己那一侧」的账号凭据去拉目录（见 `src/backend.ts` 的
   * `mountRaccoon`），不能像拆分账号池时那样「随便取一个可用账号」。
   *
   * ⚠️ 失败/无令牌时返回**空数组**（调用方回退兜底表），与本类其它目录方法
   * 同约定：目录失败不该让 provider 在模型选择器里报错。
   */
  async fetchModelsWithCredential(credential) {
    if (typeof credential?.access_token !== "string" || credential.access_token.length === 0) return [];
    try {
      const response = await this.fetchImpl(
        `${this.product.apiBase}${this.product.llmApiPrefix}/model_catalog`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${credential.access_token}`,
            "X-Org-Code": credential.office_identity ?? "",
            "X-Raccoon-Language": "zh"
          },
          signal: AbortSignal.timeout(2e4)
        }
      );
      if (!response.ok) return [];
      const payload = await response.json();
      return parseRaccoonModelCatalog(payload);
    } catch {
      return [];
    }
  }
  /**
   * 探测账号的**套餐档位**（免费 / 订阅 / 未知）。
   *
   * 端点：`GET {apiBase}/api/web/auth/v1/entitlement_info`（Bearer access_token，
   * 头与模型目录一致）。判据见 {@link parseRaccoonPlan}。
   *
   * ⚠️ **永不抛错**，失败一律 `'unknown'`：本方法是登录流程的**附加**步骤
   * （登录成功后才探测），探测失败不能让用户看到「登录失败」——那会让一个
   * 只是拿不到套餐信息的账号被反复重登。调用方把 `'unknown'` 归到免费侧。
   */
  async fetchPlan(credential) {
    if (typeof credential?.access_token !== "string" || credential.access_token.length === 0) return "unknown";
    try {
      const response = await this.fetchImpl(
        `${this.product.apiBase}${this.product.authApiPrefix}/entitlement_info`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${credential.access_token}`,
            "X-Org-Code": credential.office_identity ?? "",
            "X-Raccoon-Language": "zh"
          },
          signal: AbortSignal.timeout(2e4)
        }
      );
      if (!response.ok) return "unknown";
      return parseRaccoonPlan(await response.json());
    } catch {
      return "unknown";
    }
  }
  /** 取一个可用凭据（先账号池，再默认 ref）。 */
  async resolveForFetchModels(pool) {
    if (pool !== void 0) {
      try {
        const available = await pool.getAvailableAccount(this.product.id, "");
        if (available !== null && available !== void 0) {
          const credential = available.credential;
          if (typeof credential?.access_token === "string") return credential;
        }
      } catch {
      }
    }
    return this.resolveDefaultCredential();
  }
  /** 查询积分余额（供 Channel Pack 账号卡片）。 */
  async fetchCreditBalance(credential) {
    return fetchRaccoonCreditBalance(this.product, credential, this.fetchImpl);
  }
  /** 领取一次性登录奖励。 */
  async claimLoginReward(credential) {
    return claimRaccoonLoginReward(this.product, credential, this.fetchImpl);
  }
  /**
   * 每日签到（触发服务端当日积分发放）。
   *
   * 见 `raccoon-credits.ts` 的 `checkInRaccoon`：没有专门的签到端点，
   * 靠一次带桌面端头的只读 `GET setting_info` 触发，再由账单差值回报新增金额。
   */
  async checkIn(credential) {
    return checkInRaccoon(this.product, credential, this.fetchImpl);
  }
  /** 查询一次性登录奖励是否已领。 */
  async fetchOnboardingStatus(credential) {
    return fetchRaccoonOnboardingStatus(this.product, credential, this.fetchImpl);
  }
  /**
   * 一次性修复**老账号**的昵称与凭据字段（启动时调用）。
   *
   * ## 为什么需要它
   *
   * 早期实现有两处不足，导致**已登录的账号不会自动更正**：
   *
   * 1. 账号昵称直接用了服务端的 `name`（实测 `RaccoonAva` —— 它是服务端
   *    **自动生成的默认名**，注册第二个账号时会重名、无法区分）；
   * 2. 凭据里**没有存 `phone`**（后来才发现 `user_info.phone` 可用于消歧）。
   *
   * 光改代码只影响**新登录**的账号，老账号的昵称/凭据仍是旧值。
   * 故这里主动补一次：读凭据 → 缺 `phone` 就拉一次 `user_info` 补上 →
   * 用 `buildRaccoonNickname` 重算昵称并写回账号池。
   *
   * ## 语义约束
   *
   * - **幂等**：昵称已是目标形态时不写（避免每次启动都落盘）。
   * - **失败不阻塞启动**：单个账号失败只记日志，抛错由调用方 catch。
   * - **不发写请求**：只调只读的 `user_info`，不碰积分领取端点。
   * - `buildNickname` 由调用方注入（它依赖 `channel-pack-rpc` 里的纯函数，
   *   而那个模块依赖本模块 —— 注入避免循环依赖）。
   *
   * @returns 被修复的账号 id 列表（供日志）。
   */
  async repairAccountNicknames(pool, buildNickname) {
    const repaired = [];
    let entries;
    try {
      entries = await pool.listAccounts(this.product.id);
    } catch {
      return repaired;
    }
    for (const entry of entries) {
      try {
        const ref = credentialRef5(entry.credentialRef);
        const resolved = await this.ctx.credentials.resolve(ref);
        if (!resolved) continue;
        const credential = parseRaccoonCredential(resolved.value);
        if (credential === void 0) continue;
        let next = credential;
        if (credential.phone === void 0 || credential.user_id === void 0) {
          const info = await fetchRaccoonUserInfo(this.product, credential, this.fetchImpl);
          const patched = {
            ...credential,
            ...info.phone !== void 0 && credential.phone === void 0 ? { phone: info.phone } : {},
            ...info.userId !== void 0 && credential.user_id === void 0 ? { user_id: info.userId } : {},
            ...info.nickname !== void 0 && credential.nickname === void 0 ? { nickname: info.nickname } : {},
            ...info.officeIdentity !== void 0 && credential.office_identity === void 0 ? { office_identity: info.officeIdentity } : {}
          };
          const changed = JSON.stringify(patched) !== JSON.stringify(credential);
          if (changed) {
            await this.ctx.credentials.set(ref, JSON.stringify(patched));
            next = patched;
          }
        }
        const target = buildNickname(next, entry.id);
        if (target !== entry.nickname) {
          await pool.updateAccount(entry.id, { nickname: target });
          repaired.push(entry.id);
        }
      } catch (error) {
        this.ctx.logger?.warn?.(
          `[raccoon] \u4FEE\u590D\u8D26\u53F7 ${entry.id} \u7684\u6635\u79F0\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u4F7F\u7528\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return repaired;
  }
};
function parseRaccoonModelCatalog(payload) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];
  const root = payload;
  if (root.code !== 0) return [];
  const data = typeof root.data === "object" && root.data !== null && !Array.isArray(root.data) ? root.data : void 0;
  if (data === void 0) return [];
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const chat = categories.find((c) => {
    return typeof c === "object" && c !== null && !Array.isArray(c) && c.type === "chat";
  });
  if (chat === void 0) return [];
  const models = Array.isArray(chat.models) ? chat.models : [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const raw of models) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const model = normalizeRemoteModel(raw);
    if (model === void 0 || seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

// vendor/channel-pack/src/raccoon-adapter.ts
import { LlmAdapter as LlmAdapter3, LlmError as LlmError9, ReasoningEffortId as ReasoningEffortId3 } from "@deepseek-ai/dsh-llm";
function isQuotaError(data) {
  const error = typeof data.error === "object" && data.error !== null ? data.error : data;
  return String(error.code ?? data.code) === "402" || /积分不足|余额不足|insufficient[_\s]+(?:points|balance|credits)/i.test(
    String(error.message ?? error.msg ?? "")
  );
}
function raccoonThinkingExtraBody(effort) {
  if (effort === void 0 || effort.length === 0) return void 0;
  const type = canonicalEffortId(effort) === RACCOON_EFFORT_OFF ? "disabled" : "enabled";
  return { thinking: { type } };
}
function raccoonThinkingLevel(effort, thinking) {
  const wireEffort = privateEffortFor(effort, thinking.levels);
  const candidate = wireEffort !== void 0 ? wireEffort : thinking.defaultLevel;
  const level = thinking.levels.includes(candidate) ? candidate : thinking.levels[0] ?? candidate;
  if (level === RACCOON_EFFORT_OFF && !thinking.levels.includes(RACCOON_EFFORT_OFF)) {
    return thinking.defaultLevel;
  }
  return level;
}
function raccoonReasoningInfo(thinking) {
  const source = raccoonThinkingEfforts(thinking);
  const efforts = uniqueCanonicalEfforts(source.efforts).map(({ id, wire }) => ({
    id: ReasoningEffortId3(id),
    name: raccoonThinkingEffortName(wire)
  }));
  const wanted = canonicalEffortId(source.defaultEffort);
  const defaultEffort = efforts.find((effort) => effort.id === wanted)?.id ?? efforts[0]?.id ?? ReasoningEffortId3(RACCOON_EFFORT_OFF);
  return { efforts, defaultEffort };
}
function positiveMaxTokens(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : void 0;
}
function fallbackToRemote(model) {
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    // 兜底表**声明**图片能力（它有该字段）；与 loomy 不同（那边兜底表没有该信息）。
    supportsImage: model.supportsImage,
    // 倍率与思考档位同样来自兜底表（2026-11-18 实测快照）：离线时徽标与
    // 思考档位都照实呈现，而不是「未知」。
    ...model.effectiveMultiplier === void 0 ? {} : { effectiveMultiplier: model.effectiveMultiplier },
    ...model.baseMultiplier === void 0 ? {} : { baseMultiplier: model.baseMultiplier },
    ...model.status === void 0 ? {} : { status: model.status },
    ...model.statusNote === void 0 ? {} : { statusNote: model.statusNote },
    ...model.thinking === void 0 ? {} : { thinking: model.thinking }
  };
}
var RaccoonAdapter = class extends LlmAdapter3 {
  constructor(options) {
    super();
    this.options = options;
    this.product = options.product ?? RACCOON;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.syncCatalogScope();
    this.fallbackIndex = new Map(this.product.fallbackModels.map((model) => [model.id, model]));
  }
  product;
  fetchImpl;
  /** 兜底模型索引（id → 条目）。 */
  fallbackIndex;
  /** 远端模型缓存；未拉取时为 undefined。 */
  remoteModels;
  /** 目录加载闸门：并发去重 + 失败/空结果冷却（见 `remote-catalog-gate.ts`）。 */
  catalogGate = new RemoteCatalogGate();
  catalogSource = "fallback";
  catalogScope;
  syncCatalogScope() {
    const scope = this.options.catalogScope?.() ?? "";
    if (scope !== this.catalogScope) {
      this.catalogScope = scope;
      this.remoteModels = readCatalogCache(this.catalogFileFor(scope), scope);
      this.catalogSource = this.remoteModels ? "cached" : "fallback";
      this.catalogGate.reset();
    }
    return scope;
  }
  catalogFileFor(scope) {
    const file = this.options.catalogFile;
    return file && scope ? `${file}.${scope}` : file;
  }
  unifiedAvailability(modelId) {
    this.syncCatalogScope();
    return this.remoteModels?.find((model) => model.id === modelId)?.unifiedAvailability;
  }
  /**
   * 描述本适配器拥有的 provider 路由。
   *
   * 对入参做防御性归一化：DSH 会强制校验 `info.id === provider`，而模型设置页
   * 会用该 id 计算 `deriveKeyRef(provider)`（内部调 `provider.toUpperCase()`）。
   * 一旦 provider 不是字符串，直接回退到本产品的 id。
   */
  providerInfo(provider) {
    const id = typeof provider === "string" && provider.length > 0 ? provider : this.product.id;
    return { id, name: this.product.displayName };
  }
  /** 完整模型目录：能力与展示名取当前目录，本地精选标记按 id 叠加。 */
  /**
   * 当前目录是否来自**远端真拉**（而不是离线兜底表）。
   *
   * 调用方：`model.list` 用它决定能否按目录剪掉历史遗留的模型黑名单条目 ——
   * 只有远端目录才是「上游全量」的证据，兜底表只是精选子集。
   */
  catalogStatus() {
    this.syncCatalogScope();
    return { source: this.catalogSource };
  }
  isRemoteCatalog() {
    this.syncCatalogScope();
    return this.remoteModels !== void 0 && this.catalogSource === "remote";
  }
  listAllModels() {
    this.syncCatalogScope();
    const source = this.remoteModels ?? this.product.fallbackModels.map(fallbackToRemote);
    return source.map((model) => {
      const fallback = this.fallbackIndex.get(model.id);
      const defaultMaxTokens = defaultModelOutputTokens(positiveMaxTokens(model.maxTokens) ?? fallback?.maxTokens, model.contextWindow);
      const reasoning = raccoonReasoningInfo(model.thinking ?? fallback?.thinking);
      return {
        id: model.id,
        rateBadge: modelRateBadge(model.effectiveMultiplier, { status: model.status, baseMultiplier: model.baseMultiplier }),
        name: model.name,
        ...typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {},
        ...typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {},
        ...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
        // 目录行同样只暴露 DSH 规范档位名（宿主聚合会丢弃 level_N 这类私有 id）。
        efforts: reasoning.efforts.map((effort) => effort.id),
        defaultEffort: reasoning.defaultEffort,
        ...typeof model.supportsImage === "boolean" ? { supportsImage: model.supportsImage } : {},
        ...typeof fallback?.stale === "boolean" ? { stale: fallback.stale } : {},
        ...typeof fallback?.staleReason === "string" ? { staleReason: fallback.staleReason } : {}
      };
    });
  }
  /**
   * 取远端模型目录；**失败时不把兜底表写进缓存**。
   *
   * ⚠ 原实现是 `this.remoteModels = fallback; return fallback` —— 把兜底表当成
   * 「已加载」记下，于是一次瞬时失败会让该 provider **整个进程生命周期**都只剩
   * 兜底模型（用户看不到自己的模型，且无从触发重试，只能重启）。
   * 改为：只缓存**真实远端目录**，兜底表每次现算（纯本地、零成本），
   * 并用 {@link RemoteCatalogGate} 的冷却挡住「每模型重试一次」的放大。
   */
  async loadModels() {
    const scope = this.syncCatalogScope();
    if (this.remoteModels !== void 0) return this.remoteModels;
    const fetchRemote = this.options.fetchRemoteModels;
    if (fetchRemote !== void 0) {
      await this.catalogGate.run(async () => {
        const fetched = await fetchRemote();
        if (this.syncCatalogScope() !== scope || fetched.length === 0) return false;
        this.remoteModels = fetched;
        this.catalogSource = "remote";
        await saveCatalogCache(this.catalogFileFor(scope), fetched, scope).catch(() => {
        });
        return true;
      });
      if (this.remoteModels !== void 0) return this.remoteModels;
    }
    return this.product.fallbackModels.map(fallbackToRemote);
  }
  /** Refresh without clearing the last successful catalog. */
  async refreshRemoteModels() {
    const scope = this.syncCatalogScope();
    const fetchRemote = this.options.fetchRemoteModels;
    if (fetchRemote && await providerCatalogVisible(this.options.accountPool, this.product.id)) {
      let updated = false;
      await this.catalogGate.run(async () => {
        const models = await fetchRemote();
        if (this.syncCatalogScope() !== scope || !models.length) return false;
        this.remoteModels = models;
        this.catalogSource = "remote";
        updated = true;
        await saveCatalogCache(this.catalogFileFor(scope), models, scope).catch(() => {
        });
        return true;
      }, { force: true });
      if (!updated && this.syncCatalogScope() === scope && this.remoteModels) this.catalogSource = "cached";
    }
    return { count: this.remoteModels?.length ?? this.product.fallbackModels.length, source: this.catalogSource };
  }
  inputModalitiesFor(model) {
    const override = model && this.options.accountPool?.modelParamsFor?.(this.product.id, model.id)?.supportsImage;
    return (override ?? model?.supportsImage) === true ? ["text", "image"] : ["text"];
  }
  async listModels(_provider) {
    if (!await providerCatalogVisible(this.options.accountPool, this.product.id)) return [];
    const all = await this.loadModels();
    const disabled = this.options.accountPool?.disabledModelsFor?.(this.product.id);
    const overrides = this.options.accountPool?.listDisabledModels?.(this.product.id) ?? {};
    const exclusions = modelRecommendationExclusions(this.listAllModels(), this.product.id);
    const listed = all.filter((model) => disabled?.has(model.id) !== true && !isModelDisabled({ id: model.id, stale: this.fallbackIndex.get(model.id)?.stale }, overrides, exclusions));
    return listed.map((model) => {
      const badge = modelRateBadge(model.effectiveMultiplier, {
        status: model.status,
        baseMultiplier: model.baseMultiplier
      });
      return {
        provider: this.product.id,
        id: model.id,
        // 倍率拼进 name（不是 description）：composer 的模型切换菜单只渲染 name。
        name: readableModelName(model.id, model.name),
        inputModalities: this.inputModalitiesFor(model),
        ...badge === void 0 ? {} : { badge }
      };
    });
  }
  async resolveModel(provider, model, _signal) {
    const all = await this.loadModels();
    const entry = all.find((item) => item.id === model);
    const fallback = this.fallbackIndex.get(model);
    const bareName = fallback !== void 0 ? fallback.name.replace(/ · .*$/, "") : model;
    const resolved = {
      provider,
      id: model,
      name: readableModelName(model, entry !== void 0 ? entry.name.replace(/ · .*$/, "") : bareName),
      inputModalities: this.inputModalitiesFor(entry)
    };
    const contextWindow = entry?.contextWindow ?? fallback?.contextWindow;
    if (contextWindow !== void 0 && contextWindow > 0) {
      resolved.context = { contextWindow };
    }
    resolved.defaultMaxTokens = defaultModelOutputTokens(positiveMaxTokens(entry?.maxTokens) ?? fallback?.maxTokens, contextWindow);
    resolved.reasoning = raccoonReasoningInfo(entry?.thinking ?? fallback?.thinking);
    return resolved;
  }
  /**
   * 兼容 0.1.1-rc.2：新版 `LlmRuntime.prepareCall()` 会调用
   * `registration.adapter.prepareCall(...)`，而本仓库链接的 dsh-llm 副本
   * 基类尚未提供该方法。与其余适配器同款 shim。
   */
  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options)
    };
  }
  async *stream(options) {
    const imageRefs = /* @__PURE__ */ new Map();
    for (const message of options.messages) {
      if (Array.isArray(message.content)) collectImages(message.content, imageRefs);
    }
    const all = await this.loadModels();
    const entry = all.find((item) => item.id === options.model);
    let imageUrls;
    if (imageRefs.size > 0) {
      if (!this.inputModalitiesFor(entry).includes("image")) {
        throw new LlmError9(`raccoon: \u6A21\u578B "${options.model}" \u4E0D\u652F\u6301\u56FE\u7247\u8F93\u5165`, "UNSUPPORTED_CONTENT");
      }
      if (this.options.readImage === void 0) {
        throw new LlmError9("raccoon: \u56FE\u7247\u8F93\u5165\u9700\u8981\u9644\u4EF6\u670D\u52A1", "UNSUPPORTED_CONTENT");
      }
      imageUrls = /* @__PURE__ */ new Map();
      const readImage = this.options.readImage;
      for (const [id, ref] of imageRefs) {
        const projected = await projectRequestImage(ref, {
          readImageRequest: this.options.readImageRequest,
          pixelBudget: this.product.imagePixelBudget,
          maxBytes: this.product.imageMaxBytes
        });
        const image = projected ?? await readImage(ref);
        if (image === void 0) continue;
        imageUrls.set(id, `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}`);
      }
    }
    let credential = await this.options.resolveCredential(options.model);
    let accountId = credential === void 0 ? void 0 : await this.options.accountPool?.findAccountIdByCredential(this.product.id, credential.access_token);
    if (credential === void 0 && entry?.unifiedAvailability?.freeExcluded === true) {
      throw new LlmError9("raccoon: \u6B64\u6A21\u578B\u6CA1\u6709\u53EF\u7528\u8BA2\u9605\u8D26\u53F7", "MISSING_CREDENTIAL");
    }
    if (credential === void 0 || isRaccoonExpired(credential)) {
      credential = await this.options.refresh(accountId || void 0) ?? await this.options.resolveCredential(options.model);
    }
    if (credential === void 0 || credential.access_token.length === 0) {
      throw new LlmError9("raccoon: no usable credential; log in first", "MISSING_CREDENTIAL");
    }
    const messages = serializeMessages(options.messages, imageUrls);
    const wireModelOf = (accountId2) => this.options.outboundModelId?.(options.model, accountId2) ?? options.model;
    let wireModel = wireModelOf(accountId);
    const wireMessages = options.system !== void 0 && options.system.length > 0 ? [{ role: "system", content: options.system }, ...messages] : messages;
    const thinkingInfo = entry?.thinking ?? this.fallbackIndex.get(options.model)?.thinking;
    const thinkingLevel = thinkingInfo === void 0 ? void 0 : raccoonThinkingLevel(options.reasoningEffort, thinkingInfo);
    const thinking = thinkingInfo === void 0 ? raccoonThinkingExtraBody(options.reasoningEffort) : void 0;
    const maxTokens = options.maxTokens ?? defaultModelOutputTokens(positiveMaxTokens(entry?.maxTokens) ?? this.fallbackIndex.get(options.model)?.maxTokens, entry?.contextWindow);
    const buildBody = () => JSON.stringify({
      model: wireModel,
      messages: wireMessages,
      stream: true,
      max_tokens: maxTokens,
      ...options.temperature !== void 0 ? { temperature: options.temperature } : {},
      ...options.stop !== void 0 && options.stop.length > 0 ? { stop: options.stop } : {},
      // ⚠️ tools 必须真的下发到请求体**顶层**：Qoder/TRAE 都因漏发而让模型
      // 在正文里臆造 XML 工具调用，harness 认不出 → 任务终止。
      ...options.tools !== void 0 && options.tools.length > 0 ? {
        tools: options.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            ...tool.description.length > 0 ? { description: tool.description } : {},
            ...tool.parameters === void 0 ? {} : { parameters: tool.parameters }
          }
        }))
      } : {},
      // 思考档位（开 / 关）。⚠️ **必须在 `extra_body` 内** —— 实测放顶层会被忽略
      //（连非法值都不报错）。不传档位时不发该字段，保持服务端默认（= 开）。
      ...thinking !== void 0 ? { extra_body: thinking } : {},
      // 托管档位走**顶层**字段（实测：放进 `extra_body` 回 400 invalid）。
      ...thinkingLevel === void 0 ? {} : { raccoon_thinking_level: thinkingLevel }
    });
    const headers = () => ({
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential?.access_token ?? ""}`,
      "X-Org-Code": credential?.office_identity ?? "",
      "X-Raccoon-Language": "zh",
      "X-Client-Platform": this.product.clientPlatform
    });
    const send = async () => {
      try {
        return await this.fetchImpl(
          `${this.product.apiBase}${this.product.llmApiPrefix}/chat/completions`,
          {
            method: "POST",
            headers: headers(),
            body: buildBody(),
            signal: options.signal
          }
        ).then(checkQueuedResponse);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (isTransportError(error)) {
          throw new LlmError9(
            `raccoon: transport error: ${error instanceof Error ? error.message : String(error)}`,
            "TRANSPORT",
            { cause: error }
          );
        }
        throw error;
      }
    };
    const tried = /* @__PURE__ */ new Set();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (accountId) tried.add(accountId);
      let emitted = false;
      try {
        let response = await send();
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          const refreshed = await this.options.refresh(accountId || void 0, "auth") ?? await this.options.resolveCredential(options.model);
          if (refreshed === void 0 || refreshed.access_token.length === 0) {
            throw new LlmError9("raccoon: credential expired and refresh failed", "AUTH", { status: response.status });
          }
          credential = refreshed;
          accountId = await this.options.accountPool?.findAccountIdByCredential(this.product.id, credential.access_token);
          wireModel = wireModelOf(accountId);
          response = await send();
        }
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          let quota = response.status === 402;
          try {
            quota ||= isQuotaError(JSON.parse(errorText));
          } catch {
          }
          const limited = quota || isRateLimited(errorText, response.status);
          const code = quota ? "QUOTA_EXCEEDED" : limited ? "RATE_LIMIT" : httpErrorCode(response.status);
          const failure = new LlmError9(
            `raccoon: ${errorDetail(errorText)}`,
            code,
            { status: response.status }
          );
          if (code === "RATE_LIMIT") {
            const parsed = parseRateLimitError(errorText, options.model, response.status);
            failure.rateLimitResetAtMs = parsed?.resetTimeMs ?? Date.now() + RATE_LIMIT_FALLBACK_MS;
          }
          throw failure;
        }
        for await (const chunk of consumeOpenAiSse(response, { signal: options.signal }, {
          label: "raccoon",
          firstTokenTimeoutMs: resolveFirstTokenTimeoutMs3(),
          chunkTimeoutMs: resolveChunkTimeoutMs3(),
          isQuotaError,
          maxTokens
        })) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (error) {
        if (options.signal?.aborted || !(error instanceof LlmError9)) throw error;
        if (error.code === "RATE_LIMIT") {
          const resetAt = error.rateLimitResetAtMs;
          if (accountId) {
            await this.options.accountPool?.updateModelRateLimit(
              accountId,
              wireModel,
              resetAt ?? Date.now() + RATE_LIMIT_FALLBACK_MS
            );
          }
          if (emitted || attempt === 2 || this.options.nextAccount === void 0) throw error;
          const nextOnLimit = await this.options.nextAccount(options.model, tried);
          if (nextOnLimit === void 0 || tried.has(nextOnLimit.accountId)) throw error;
          accountId = nextOnLimit.accountId;
          credential = nextOnLimit.credential;
          wireModel = wireModelOf(accountId);
          if (isRaccoonExpired(credential)) {
            credential = await this.options.refresh(accountId) ?? credential;
          }
          continue;
        }
        if (error.code !== "QUOTA_EXCEEDED") throw error;
        if (accountId) {
          await this.options.accountPool?.updateModelRateLimit(accountId, wireModel, nextUtc8DayStartMs());
        }
        if (emitted || attempt === 2 || this.options.nextAccount === void 0) throw error;
        const next = await this.options.nextAccount(options.model, tried);
        if (next === void 0 || tried.has(next.accountId)) throw error;
        accountId = next.accountId;
        credential = next.credential;
        wireModel = wireModelOf(accountId);
        if (isRaccoonExpired(credential)) {
          credential = await this.options.refresh(accountId) ?? credential;
        }
      }
    }
  }
};
function resolveFirstTokenTimeoutMs3() {
  const raw = Number(process.env.DSH_RACCOON_FIRST_TOKEN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 12e4;
}
function resolveChunkTimeoutMs3() {
  const raw = Number(process.env.DSH_RACCOON_CHUNK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 12e4;
}
function registerRaccoonLlm(ctx, options) {
  const product = options.product ?? RACCOON;
  const adapter = withQueueAccountRotation(product.id, options, (scoped) => new RaccoonAdapter(scoped));
  registerAdapterIdempotent(ctx.llm, [product.id], adapter);
  return adapter;
}

// src/backend/providers/raccoon.ts
function mergeUnifiedRaccoonCatalogs(freeModels, proModels) {
  const proById = /* @__PURE__ */ new Map();
  for (const model of proModels) {
    const id = model.id.endsWith("-p") ? model.id.slice(0, -2) : model.id;
    if (!proById.has(id)) proById.set(id, model);
  }
  const free = freeModels.map((model) => {
    const pro = proById.get(model.id);
    proById.delete(model.id);
    return { ...model, unifiedAvailability: pro ? { proId: pro.id } : proModels.length ? { proId: null } : {} };
  });
  return [...free, ...[...proById].map(([id, model]) => ({
    ...model,
    id,
    unifiedAvailability: { ...freeModels.length ? { freeExcluded: true } : {}, proId: model.id }
  }))];
}
function mountRaccoon({ ctx, pool, throwIfAllAccountsRateLimited, readImage, readImageRequest, catalogFile, noteQuotaAccount }, isUnifiedModels) {
  const raccoonSideOf = (entry) => entry.plan === "pro" ? "pro" : "free";
  const unified = () => isUnifiedModels?.() === true;
  const raccoonAccountsOf = (side) => pool.listAccountsByProvider(RACCOON.id).filter((entry) => raccoonSideOf(entry) === side);
  const raccoonOtherSideIds = (side) => new Set(raccoonAccountsOf(side === "free" ? "pro" : "free").map((entry) => entry.id));
  const unionIds = (a, b) => {
    const out = new Set(a);
    for (const id of b) out.add(id);
    return out;
  };
  const raccoonSidePool = (side) => new Proxy(pool, {
    get(target, prop) {
      if (prop === "hasLoggedInAccount") {
        return async () => {
          if (unified() && side === "pro") return false;
          const entries = unified() && side === "free" ? pool.listAccountsByProvider(RACCOON.id) : raccoonAccountsOf(side);
          for (const entry of entries) {
            if (await target.resolveCredentialForAccount(entry.id) !== void 0) return true;
          }
          return false;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const unifiedRoute = (modelId) => {
    const available = raccoonAdapter.unifiedAvailability(modelId);
    return {
      free: available?.freeExcluded !== true,
      proId: available?.proId === null ? null : available?.proId ?? (modelId ? `${modelId}-p` : null)
    };
  };
  const raccoonUnifiedPick = async (modelId, exclude) => {
    const route = unifiedRoute(modelId);
    if (route.free) {
      const free = await pool.getAvailableAccount(RACCOON.id, modelId, unionIds(exclude, raccoonOtherSideIds("free")));
      if (free) return free;
    }
    return route.proId === null ? null : pool.getAvailableAccount(RACCOON.id, route.proId, unionIds(exclude, raccoonOtherSideIds("pro")));
  };
  const raccoonSideCredential = async (side) => {
    try {
      const available = await pool.getAvailableAccount(RACCOON.id, "", raccoonOtherSideIds(side));
      if (available === null || available === void 0) return void 0;
      return available.credential;
    } catch {
      return void 0;
    }
  };
  const mountRaccoon2 = (product, auth, side, proRemoteFetch2) => registerRaccoonLlm(ctx, {
    catalogFile: catalogFile(product.id),
    ...side === "free" ? { catalogScope: () => unified() ? "unified-routing-v1" : "" } : {},
    credentialRef: credentialRef6(product.defaultCredentialRef),
    resolveCredential: async (modelId) => {
      let available = null;
      if (side === "free" && unified()) {
        available = await raccoonUnifiedPick(modelId ?? "", /* @__PURE__ */ new Set());
      } else {
        available = await pool.getAvailableAccount(
          RACCOON.id,
          modelId ?? "",
          raccoonOtherSideIds(side)
        );
      }
      if (available) {
        reportLedgerAccount(product.id, available.entry.id);
        if (modelId) noteQuotaAccount?.(product.id, available.entry.id, modelId);
        return available.credential;
      }
      if (side === "free" && unified()) {
        const route = unifiedRoute(modelId ?? "");
        if (route.free) throwIfAllAccountsRateLimited(product, modelId, raccoonAccountsOf("free"));
        if (route.proId !== null) throwIfAllAccountsRateLimited(product, route.proId, raccoonAccountsOf("pro"));
        if (!route.free) return void 0;
      } else {
        throwIfAllAccountsRateLimited(product, modelId, raccoonAccountsOf(side));
      }
      const resolved = await ctx.credentials.resolve(credentialRef6(product.defaultCredentialRef));
      if (!resolved) return void 0;
      try {
        return JSON.parse(resolved.value);
      } catch {
        return void 0;
      }
    },
    refresh: async (accountId) => {
      const entry = accountId === void 0 ? void 0 : pool.listAccountsByProvider(RACCOON.id).find((account) => account.id === accountId);
      if (accountId !== void 0 && entry === void 0) throw new Error(`${product.id}: account no longer exists`);
      if (entry) await auth.refreshAccountCredential(entry.credentialRef, pool, entry.id);
      else await auth.refresh();
      const resolved = await ctx.credentials.resolve(credentialRef6(entry?.credentialRef ?? product.defaultCredentialRef));
      if (!resolved) throw new Error(`${product.id}: credential no longer exists`);
      return JSON.parse(resolved.value);
    },
    nextAccount: async (modelId, tried) => {
      let next = null;
      if (side === "free" && unified()) {
        next = await raccoonUnifiedPick(modelId, tried);
      } else {
        const excluded = raccoonOtherSideIds(side);
        for (const id of tried) excluded.add(id);
        next = await pool.getAvailableAccount(RACCOON.id, modelId, excluded);
      }
      if (!next) return void 0;
      reportLedgerAccount(product.id, next.entry.id);
      noteQuotaAccount?.(product.id, next.entry.id, modelId);
      return { accountId: next.entry.id, credential: next.credential };
    },
    // 远端模型目录：用**本侧账号**的凭据拉（`fetchModelsWithCredential` 负责
    // Bearer 头 + visible 过滤 + 含倍率的展示名）。上游给这个账号返回什么模型，
    // 本产品就展示什么模型 —— **不做倍率过滤**：计费倍率只是展示信息，不是归属
    // 判据，按它劈目录会让免费账号看得到的计费模型整条消失。
    // 远端返回空（无本侧账号 / 失败）时，适配器回退到本产品自己的兜底表；
    // 两侧目录的独立性来自「用不同账号拉」，而不是来自过滤。
    fetchRemoteModels: async () => {
      const credential = await raccoonSideCredential(side);
      const own = credential === void 0 ? [] : await auth.fetchModelsWithCredential(credential);
      if (side !== "free" || !unified() || proRemoteFetch2 === void 0) return own;
      if (own.length === 0 && raccoonAccountsOf("free").some((account) => account.enabled !== false)) return [];
      let proModels = [];
      try {
        proModels = await proRemoteFetch2();
      } catch {
        proModels = [];
      }
      return mergeUnifiedRaccoonCatalogs(own, proModels);
    },
    // 图片字节桥接：按模型能力判定（远端 tags 含 vision）。
    readImage,
    // ⚠️ raccoon 尤其需要请求版本：该网关按**请求体字节**设限
    // （实测 `HTTP_413: request body exceeds 10MB`，两张大截图就占掉大半配额）。
    readImageRequest,
    // 两侧都传「按 plan 门控」的池视图：门控只影响目录可见性判定，
    // 黑名单/限流/凭据读写仍落在真池上。
    accountPool: raccoonSidePool(side),
    // 统一模式出站翻译：订阅账号使用原始订阅 ID（目录未知时回退 `<id>-p`），
    // 免费账号原样。适配器据此构造请求体与限流标记，选号/账本仍记统一 id。
    ...side === "free" ? {
      outboundModelId: (modelId, accountId) => {
        if (!unified() || accountId === void 0) return modelId;
        const entry = pool.listAccountsByProvider(RACCOON.id).find((account) => account.id === accountId);
        return raccoonSideOf(entry ?? {}) === "pro" ? unifiedRoute(modelId).proId ?? modelId : modelId;
      }
    } : {},
    product
  });
  const raccoon = new RaccoonAuth(ctx);
  const raccoonPro = new RaccoonAuth(ctx, { product: RACCOON_PRO, serviceName: "raccoonProAuth" });
  const proRemoteFetch = async () => {
    const credential = await raccoonSideCredential("pro");
    if (credential === void 0) return [];
    return await raccoonPro.fetchModelsWithCredential(credential);
  };
  const raccoonProduct = {
    ...RACCOON,
    get displayName() {
      return unified() ? "Raccoon" : RACCOON.displayName;
    }
  };
  const raccoonAdapter = mountRaccoon2(raccoonProduct, raccoon, "free", proRemoteFetch);
  const raccoonProAdapter = mountRaccoon2(
    RACCOON_PRO,
    raccoonPro,
    "pro"
  );
  return {
    auth: raccoon,
    subscriptionAuth: raccoonPro,
    adapters: { [RACCOON.id]: raccoonAdapter, [RACCOON_PRO.id]: raccoonProAdapter },
    maintain: () => raccoon.refreshAll(pool)
  };
}

// lib/channel-specs.js
var CHANNEL_KINDS = Object.freeze(["pack", "managed", "apikey", "plan", "workbuddy"]);
var KIND_METHODS = Object.freeze({
  /** 账号池渠道（vendor channel-pack）：多账号轮换 + 目录 + 额度 + 签到 + 新手奖励。 */
  pack: Object.freeze({
    read: Object.freeze([
      "provider.status",
      "account.list",
      "model.list",
      "model.params",
      "credits.balances",
      "credits.status",
      "onboarding.status"
    ]),
    write: Object.freeze([
      "provider.setEnabled",
      "account.create",
      "account.update",
      "account.delete",
      "account.reorder",
      "account.refresh",
      "account.retest",
      "account.reset",
      "login.poll",
      "model.refresh",
      "model.setDisabled",
      "model.clearDead",
      "model.setAllDisabled",
      "model.resetDefaults",
      "model.setParams",
      "credits.claimAll",
      "onboarding.claim"
    ])
  }),
  /** 自管多账号渠道（本插件 multi-account 框架）。 */
  managed: Object.freeze({
    read: Object.freeze(["managed.snapshot", "managed.models"]),
    write: Object.freeze([
      "managed.refreshModels",
      "managed.login",
      "managed.importLocal",
      "managed.importCredential",
      "managed.updateAccount",
      "managed.logout",
      "managed.setEnabled",
      "managed.checkin",
      "managed.claimRewards",
      "managed.completeTasks",
      "managed.setModelEnabled",
      "managed.setModelParams",
      "managed.resetModels"
    ])
  }),
  /** API Key 渠道（单 Key + 目录 + 额度 + 可选的工具/控制台会话）。 */
  apikey: Object.freeze({
    read: Object.freeze(["apikey.snapshot"]),
    write: Object.freeze([
      "apikey.setKey",
      "apikey.setEnabled",
      "apikey.setModelEnabled",
      "apikey.setModelParams",
      "apikey.resetModels",
      "apikey.setToolsEnabled",
      "apikey.setConsoleSession",
      "apikey.consoleLogin",
      "apikey.clearConsoleSession"
    ])
  }),
  /** 单 Key 订阅渠道（商汤 Token Plan 控制器）。 */
  plan: Object.freeze({
    read: Object.freeze(["plan.snapshot"]),
    write: Object.freeze([
      "plan.setKey",
      "plan.setEnabled",
      "plan.setModelEnabled",
      "plan.setModelParams",
      "plan.resetModels",
      "plan.consoleLogin"
    ])
  }),
  /** 自管单渠道路由（WorkBuddy）。 */
  workbuddy: Object.freeze({
    read: Object.freeze(["workbuddy.snapshot", "workbuddy.models"]),
    write: Object.freeze([
      "workbuddy.login",
      "workbuddy.logout",
      "workbuddy.checkin",
      "workbuddy.setAccountEnabled",
      "workbuddy.setModelEnabled",
      "workbuddy.setModelParams",
      "workbuddy.resetModels"
    ])
  })
});
var GLOBAL_METHODS = Object.freeze([
  "settings.snapshot",
  "settings.refresh",
  "automation.status",
  "automation.setConfig",
  "automation.run",
  "automation.query"
]);
var CHANNEL_SPECS = Object.freeze([
  // Raccoon 家族：同一上游账号体系拆成免费版 / 订阅版两个 provider（两侧各自用本侧
  // 账号凭据拉上游目录，不做倍率过滤；账号只有一个池）。签到是**账号级**事项，
  // 只有代表账号池的 `raccoon` 置 claim —— `raccoon-pro` 再跑一次会重复调度同一账号。
  Object.freeze({
    id: "raccoon",
    title: "Raccoon \u4F53\u9A8C\u7248",
    kind: "pack",
    card: true,
    claim: true,
    accountPool: true,
    // vendor `registerChannelPackRpc` 里承接 Raccoon 家族 auth 的形参位（见 lib/pack-slots.js）。
    packSlot: "raccoon",
    family: Object.freeze([
      Object.freeze({ id: "raccoon", title: "\u514D\u8D39\u6A21\u578B" }),
      Object.freeze({ id: "raccoon-pro", title: "\u8BA2\u9605\u6A21\u578B" })
    ]),
    capabilities: Object.freeze({
      accounts: true,
      models: true,
      quota: true,
      planTag: true,
      unifiedModels: true,
      checkin: "dedicated",
      onboarding: "claim"
    }),
    methods: Object.freeze({
      extra: Object.freeze(["raccoon.checkin"])
    })
  }),
  Object.freeze({
    id: "raccoon-pro",
    title: "Raccoon \u8BA2\u9605\u7248",
    kind: "pack",
    card: false,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: false }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "qodercn",
    title: "Qoder \u4E2D\u56FD\u7248",
    kind: "pack",
    card: true,
    claim: true,
    accountPool: true,
    packSlot: "qoderCn",
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: "credits", onboarding: false }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "trae",
    title: "TRAE",
    kind: "pack",
    card: true,
    claim: true,
    accountPool: true,
    packSlot: "trae",
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: "credits", onboarding: false }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "sensenova-token-plan",
    title: "\u5546\u6C64 Token Plan",
    kind: "plan",
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, tools: true }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "workbuddy",
    title: "WorkBuddy",
    kind: "workbuddy",
    card: true,
    claim: true,
    accountPool: false,
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: "dedicated" }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "agnes",
    title: "Agnes",
    kind: "apikey",
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, tools: true }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "unisound",
    title: "\u4E91\u77E5\u58F0",
    kind: "apikey",
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, tools: true, consoleSession: true }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "qianfan",
    title: "\u5343\u5E06 Token Plan",
    kind: "apikey",
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, consoleSession: true }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "bailian",
    title: "\u963F\u91CC\u4E91\u767E\u70BC",
    kind: "apikey",
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, consoleSession: true }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "stepfun",
    title: "Step Plan",
    kind: "apikey",
    card: true,
    claim: false,
    accountPool: false,
    capabilities: Object.freeze({ accounts: false, models: true, quota: true, consoleSession: true }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "astudio",
    title: "AStudio",
    kind: "managed",
    card: true,
    claim: true,
    accountPool: false,
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: "credits", onboarding: false }),
    methods: Object.freeze({})
  }),
  Object.freeze({
    id: "codearts",
    title: "CodeArts",
    kind: "managed",
    card: true,
    claim: true,
    accountPool: false,
    capabilities: Object.freeze({ accounts: true, models: true, quota: true, checkin: "credits", onboarding: false }),
    methods: Object.freeze({})
  })
]);
var HOST_INTERNAL_METHODS = Object.freeze(["credits.status", "onboarding.status", "raccoon.checkin"]);
var RETIRED_CHANNEL_IDS = Object.freeze(["loomy"]);
var INVALIDATE_RULES = Object.freeze([
  Object.freeze({ id: "channel-toggle", methods: Object.freeze(["provider.setEnabled"]), resources: Object.freeze(["provider.status"]) }),
  Object.freeze({ id: "model-params", methods: Object.freeze(["model.setParams"]), resources: Object.freeze(["model.params"]) }),
  Object.freeze({
    id: "model-catalog",
    methods: Object.freeze(["model.refresh", "model.setDisabled", "model.clearDead", "model.setAllDisabled", "model.resetDefaults"]),
    resources: Object.freeze(["provider.status", "model.list"])
  }),
  Object.freeze({
    id: "account-change",
    methods: Object.freeze(["account.create", "account.update", "account.delete", "account.reorder", "account.refresh", "account.retest", "account.reset"]),
    resources: Object.freeze(["provider.status", "account.list", "credits.balances"])
  }),
  Object.freeze({
    id: "login-success",
    methods: Object.freeze(["login.poll"]),
    resources: Object.freeze(["provider.status", "account.list", "credits.balances"]),
    whenSuccess: true
  }),
  // 领取与签到都会改积分余额：`onboarding.claim` 是一次性登录奖励，
  // `raccoon.checkin` 是每日签到（宿主调度专用），三者共用同一条规则。
  Object.freeze({
    id: "credits-change",
    methods: Object.freeze(["credits.claimAll", "onboarding.claim", "raccoon.checkin"]),
    resources: Object.freeze(["credits.balances"])
  })
]);

// vendor/channel-pack/src/qoder-auth.ts
import { Service as Service2 } from "@deepseek-ai/cordis";
import { credentialRef as credentialRef7 } from "@deepseek-ai/dsh-credentials";

// vendor/channel-pack/src/qoder-oauth.ts
function sleep(ms, signal) {
  return new Promise((resolve2, reject) => {
    if (signal?.aborted === true) {
      reject(new Error("\u767B\u5F55\u5DF2\u53D6\u6D88"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("\u767B\u5F55\u5DF2\u53D6\u6D88"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve2();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
var SERVER_ERROR_PREFIX = "\u767B\u5F55\u670D\u52A1\u8FD4\u56DE\u5F02\u5E38";
function isAborted2(signal) {
  return signal?.aborted === true;
}
async function pollQoderDeviceToken(session, options) {
  const fetcher = options.fetcher ?? fetch;
  const pollUrl = buildQoderPollUrl(session, options.product);
  const interval = options.pollIntervalMs ?? QODER_POLL_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? QODER_LOGIN_TIMEOUT_MS);
  let failures = 0;
  while (Date.now() < deadline) {
    if (isAborted2(options.signal)) throw new Error("\u767B\u5F55\u5DF2\u53D6\u6D88");
    try {
      const response = await fetcher(pollUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...options.signal === void 0 ? {} : { signal: options.signal }
      });
      failures = 0;
      if (response.status === 404) {
        await sleep(interval, options.signal);
        continue;
      }
      if (!response.ok) {
        throw new Error(`${SERVER_ERROR_PREFIX}\uFF08HTTP ${response.status}\uFF09`);
      }
      const payload = parseQoderTokenPayload(await response.json());
      if (payload.accessToken.length > 0) return payload;
      await sleep(interval, options.signal);
    } catch (error) {
      if (isAborted2(options.signal)) throw new Error("\u767B\u5F55\u5DF2\u53D6\u6D88");
      if (error instanceof Error && error.message.startsWith(SERVER_ERROR_PREFIX)) throw error;
      failures += 1;
      if (failures >= QODER_POLL_MAX_FAILURES) {
        throw new Error(
          `\u65E0\u6CD5\u8FDE\u63A5 Qoder \u767B\u5F55\u670D\u52A1\uFF08\u8FDE\u7EED ${failures} \u6B21\u5931\u8D25\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
        );
      }
      await sleep(interval, options.signal);
    }
  }
  throw new Error("\u767B\u5F55\u7B49\u5F85\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u53D1\u8D77\u767B\u5F55");
}
function toLoginFlowResult(credential, loginUrl, machineId) {
  return {
    access: JSON.stringify(credential),
    // 与其它 provider 一致：无法解析过期时间时报 0，而不是抛错 ——
    // 凭据本身可用（只是有效期未知），不该因展示层缺失而登录失败。
    expires: qoderCredentialExpiresAtMs(credential) ?? 0,
    loginUrl,
    refreshable: isQoderRefreshable(credential),
    machineId
  };
}
async function defaultOpenBrowser(url) {
  const { openBrowser: openBrowser2 } = await Promise.resolve().then(() => (init_open_browser(), open_browser_exports));
  openBrowser2(url);
}
async function startQoderLoginFlow(options) {
  const session = createQoderDeviceSession();
  const loginUrl = buildQoderAuthUrl(session, options.product);
  const controller = new AbortController();
  const signal = options.signal === void 0 ? controller.signal : AbortSignal.any([controller.signal, options.signal]);
  const result = (async () => {
    const payload = await pollQoderDeviceToken(session, { ...options, signal });
    if (payload.accessToken.length === 0) {
      throw new Error("\u767B\u5F55\u54CD\u5E94\u7F3A\u5C11\u8BBF\u95EE\u4EE4\u724C");
    }
    const credential = buildQoderCredential(payload, { machineId: session.machineId });
    return toLoginFlowResult(credential, loginUrl, session.machineId);
  })();
  result.catch(() => {
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    controller.abort();
  };
  return { loginUrl, result, close };
}
async function runQoderLoginFlow(options) {
  const open = options.openBrowser ?? defaultOpenBrowser;
  const started = await startQoderLoginFlow(options);
  try {
    await open(started.loginUrl);
    return await started.result;
  } finally {
    await started.close();
  }
}

// vendor/channel-pack/src/qoder-auth.ts
var QODER_EXPIRY_ACCESSORS = {
  expiresAtOf: qoderCredentialExpiresAtMs,
  refreshableOf: isQoderRefreshable,
  identityOf: (credential) => credential.access_token ?? ""
};
var RefreshTokenExpiredError2 = class extends Error {
  constructor(message) {
    super(message);
    this.name = "RefreshTokenExpiredError";
  }
};
function parseCredential(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && typeof parsed.access_token === "string" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
var QoderAuth = class extends Service2 {
  constructor(ctx, options = {}) {
    const product = options.product ?? QODER;
    super(ctx, options.serviceName ?? `${product.id}Auth`);
    this.options = options;
    this.product = product;
    this.credentialRefName = this.product.defaultCredentialRef;
  }
  /** 本实例所属的产品配置。 */
  product;
  /** 本实例默认读写的凭据 ref 名称（`QODER_ACCESS_TOKEN`）。 */
  credentialRefName;
  scheduler = new RefreshScheduler(
    () => this.refresh(),
    (error) => {
      if (error instanceof RefreshTokenExpiredError2) {
        this.markRefreshTokenInvalid();
        return;
      }
      this.lastRefreshError = error instanceof Error ? error.message : String(error);
    }
  );
  /** refresh_token 已被后端判定失效；登录/刷新成功时重置。 */
  refreshTokenInvalid = false;
  lastRefreshError;
  /** 登录会话是否仍处于活跃状态；logout()/stop() 置 false，防止在途刷新回写已登出凭据。 */
  active = true;
  /** 注入的 fetch（测试用）；默认为全局 fetch。 */
  get fetchImpl() {
    return this.options.fetcher ?? fetch;
  }
  /** 标记 refresh_token 已失效：停止重试，并向 status() 暴露 refreshable: false。 */
  markRefreshTokenInvalid() {
    this.refreshTokenInvalid = true;
    this.lastRefreshError = "refresh_token \u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55";
  }
  /**
   * 运行完整登录流程并持久化凭据。
   *
   * `accountId` + `pool` 同时提供时，登录成功后自动把账号登记进账号池
   * （Channel Pack 的「+ 新建账号」路径）。
   */
  async login(flowOptions = {}) {
    this.active = true;
    const flow = await runQoderLoginFlow({
      product: this.product,
      ...this.options.fetcher === void 0 ? {} : { fetcher: this.options.fetcher },
      ...flowOptions
    });
    return this.persistLogin(flow, flowOptions);
  }
  /**
   * **两步式登录**：立即返回登录 URL，由调用方先打开窗口。
   *
   * 调用方拿到 `loginUrl` 后应当**立即** `window.open`，再 await `result`。
   */
  async startLogin(flowOptions = {}) {
    this.active = true;
    const started = await startQoderLoginFlow({
      product: this.product,
      ...this.options.fetcher === void 0 ? {} : { fetcher: this.options.fetcher },
      ...flowOptions
    });
    const result = started.result.then((flow) => this.persistLogin(flow, flowOptions));
    result.catch(() => {
    });
    return { loginUrl: started.loginUrl, result, close: started.close };
  }
  /**
   * 持久化一次登录结果：写凭据、重置失效状态、武装续期、按需登记账号池。
   *
   * 抽成独立方法供 {@link login} 与 {@link startLogin} 共用 ——
   * 两条路径的差别只在「何时返回 loginUrl」，落库逻辑必须完全一致。
   */
  async persistLogin(flow, flowOptions = {}) {
    const ref = flowOptions.refName ? credentialRef7(flowOptions.refName) : credentialRef7(this.credentialRefName);
    await this.ctx.credentials.set(ref, flow.access);
    this.refreshTokenInvalid = false;
    this.lastRefreshError = void 0;
    this.scheduleRefresh();
    const credential = parseCredential(flow.access);
    if (flowOptions.accountId !== void 0 && flowOptions.pool !== void 0) {
      await flowOptions.pool.addAccount({
        id: flowOptions.accountId,
        provider: this.product.id,
        nickname: credential?.nickname !== void 0 && credential.nickname.length > 0 ? credential.nickname : flowOptions.accountId,
        enabled: true,
        credentialRef: flowOptions.refName ?? this.credentialRefName,
        createdAt: Date.now(),
        expiresAt: credential ? qoderCredentialExpiresAtMs(credential) : void 0,
        refreshable: credential !== void 0 && isQoderRefreshable(credential)
      });
    }
    return {
      access: flow.access,
      expires: flow.expires,
      ref,
      loginUrl: flow.loginUrl,
      refreshable: flow.refreshable
    };
  }
  /** 报告凭据是否已配置、过期时间、是否可刷新以及最近刷新错误。 */
  async status() {
    const ref = credentialRef7(this.credentialRefName);
    const info = await this.ctx.credentials.describe(ref);
    if (!info.configured) return { configured: false, refreshable: false };
    let expiresAt;
    let refreshable = false;
    const resolved = await this.ctx.credentials.resolve(ref);
    if (resolved) {
      const credential = parseCredential(resolved.value);
      if (credential) {
        expiresAt = qoderCredentialExpiresAtMs(credential);
        refreshable = isQoderRefreshable(credential) && !this.refreshTokenInvalid;
      }
    }
    return {
      configured: true,
      source: info.source,
      expiresAt,
      refreshable,
      ...this.lastRefreshError === void 0 ? {} : { refreshError: this.lastRefreshError }
    };
  }
  /**
   * 静默续期：`refresh_token` + `machine_id` 换取新令牌。
   *
   * 终态判定：
   * - HTTP 401/403、或响应缺 token → 抛 {@link RefreshTokenExpiredError}，
   *   让调度器停止续期；
   * - 其余错误（网络抖动、5xx、429）→ 抛普通 Error，走调度器的可重试路径。
   */
  async refresh() {
    const ref = credentialRef7(this.credentialRefName);
    const resolved = await this.ctx.credentials.resolve(ref);
    if (!resolved) throw new Error("\u672A\u914D\u7F6E\u51ED\u636E\uFF0C\u8BF7\u5148\u767B\u5F55");
    const credential = parseCredential(resolved.value);
    if (!credential) throw new Error("\u51ED\u636E\u89E3\u6790\u5931\u8D25");
    if (!isQoderRefreshable(credential)) {
      throw new RefreshTokenExpiredError2("\u65E0 refresh_token\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
    }
    try {
      const refreshed = await this.refreshCredential(credential);
      if (!this.active) return;
      await this.ctx.credentials.set(ref, JSON.stringify(refreshed));
      this.refreshTokenInvalid = false;
      this.lastRefreshError = void 0;
      this.scheduleRefresh();
    } catch (error) {
      if (error instanceof RefreshTokenExpiredError2) this.markRefreshTokenInvalid();
      throw error;
    }
  }
  /**
   * 按凭据 ref 续期**指定账号**的凭据。
   *
   * 同样**不触碰** `refreshTokenInvalid` / `lastRefreshError` / 调度器：
   * 那些状态属于单凭据路径，被多账号操作污染会让 UI 显示错误的失效提示。
   *
   * ⚠️ **必须回写账号池的 `expiresAt`**（issue !IKIRTT 的真实缺陷）：
   * UI 账号卡片的「有效期」读的正是池里的值，而不是凭据里 access_token 的真实
   * 过期时间。早期这里只 `credentials.set`，于是调用 `account.refresh` 后凭据确实续好了、
   * 界面却**一直显示「已过期」**，且没有任何自救手段（「重测」按钮的 refresh
   * 是刻意的 no-op）。
   *
   * @param pool 账号池；提供时会把新 `expiresAt` / `refreshable` 写回。
   * @param accountId 账号 id。**调用方已知时请显式传入** ——
   *   否则只能按凭据内容反查（代价高，且反查会跳过已停用账号）。
   */
  async refreshAccountCredential(refName, pool, accountId) {
    const ref = credentialRef7(refName);
    const resolved = await this.ctx.credentials.resolve(ref);
    if (!resolved) throw new Error("\u51ED\u636E\u672A\u914D\u7F6E");
    const credential = parseCredential(resolved.value);
    if (!credential) throw new Error("\u51ED\u636E\u89E3\u6790\u5931\u8D25");
    if (!isQoderRefreshable(credential)) {
      throw new RefreshTokenExpiredError2("\u65E0 refresh_token\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
    }
    const refreshed = await this.refreshCredential(credential);
    await this.ctx.credentials.set(ref, JSON.stringify(refreshed));
    await syncAccountExpiry({
      pool,
      provider: this.product.id,
      credential: refreshed,
      accessors: QODER_EXPIRY_ACCESSORS,
      accountId,
      tag: `[${this.product.id}]`,
      warn: (message) => this.ctx.logger?.warn?.(message)
    });
  }
  /**
   * 对一份凭据执行一次续期并返回新凭据（不触碰存储）。
   *
   * 抽出来供 `refresh()` 与 `refreshAll()` 共用，避免两处各写一遍
   * 「发请求 → 判终态 → 合并字段」的逻辑而逐渐分叉。
   */
  async refreshCredential(credential) {
    let response;
    try {
      response = await this.fetchImpl(`${this.product.openApiBase}${QODER_REFRESH_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": `${this.product.userAgentPrefix}/1.0.0`
        },
        body: JSON.stringify(qoderRefreshBody(credential)),
        signal: AbortSignal.timeout(QODER_REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new Error(`Qoder \u7EED\u671F\u7F51\u7EDC\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new RefreshTokenExpiredError2(`Qoder \u7EED\u671F\u88AB\u62D2\u7EDD\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55`);
    }
    let parsed;
    try {
      parsed = await response.json();
    } catch {
      throw new Error(`Qoder \u7EED\u671F\u54CD\u5E94\u4E0D\u662F JSON\uFF08HTTP ${response.status}\uFF09`);
    }
    if (!response.ok) {
      const detail = JSON.stringify(parsed).slice(0, 200);
      throw new Error(`Qoder \u7EED\u671F\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\uFF1A${detail}`);
    }
    const payload = parseQoderTokenPayload(parsed);
    if (payload.accessToken.length === 0) {
      throw new RefreshTokenExpiredError2("\u7EED\u671F\u54CD\u5E94\u7F3A\u5C11\u8BBF\u95EE\u4EE4\u724C\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
    }
    return applyQoderRefresh(credential, payload);
  }
  /**
   * 批量续期本产品的所有账号。
   *
   * ⚠️ **lead-time 过滤**（issue !IKIRTT）：早先这里是**无条件全量续期** ——
   * 定时器每 30 分钟就把每个账号的 refresh_token 轮换一次，与「凭据还剩多久」
   * 无关。现复用单凭据时代 `REFRESH_LEAD_MS` 的语义：**距过期不足 1 小时才刷**。
   * 跳过的账号仍会做一次**有效期对账**（见 `refreshAccountWithReconcile`），
   * 因为「不刷」与「不回写池值」正是 UI 假过期的两个来源，必须分开处理。
   */
  async refreshAll(pool) {
    const accounts = await pool.listAccounts(this.product.id);
    for (const entry of accounts) {
      if (!entry.refreshable) continue;
      try {
        const ref = credentialRef7(entry.credentialRef);
        const resolved = await this.ctx.credentials.resolve(ref);
        if (!resolved) {
          await pool.updateAccount(entry.id, { refreshable: false });
          continue;
        }
        const credential = parseCredential(resolved.value);
        if (!credential || !isQoderRefreshable(credential)) {
          await pool.updateAccount(entry.id, { refreshable: false });
          continue;
        }
        await refreshAccountWithReconcile({
          pool,
          provider: this.product.id,
          // tag 取 product.id：本类一个实例服务 qoder 与 qodercn 两个面板。
          tag: `[${this.product.id}]`,
          accountId: entry.id,
          credential,
          accessors: QODER_EXPIRY_ACCESSORS,
          current: entry,
          refresh: (c) => this.refreshCredential(c),
          save: (c) => this.ctx.credentials.set(ref, JSON.stringify(c)),
          warn: (message) => this.ctx.logger?.warn?.(message)
        });
      } catch (error) {
        if (error instanceof RefreshTokenExpiredError2) {
          try {
            await pool.updateAccount(entry.id, { refreshable: false });
          } catch {
          }
          this.ctx.logger?.warn?.(
            `[${this.product.id}] \u8D26\u53F7 ${entry.id} \u7684 refresh_token \u5DF2\u5931\u6548\uFF0C\u5DF2\u6807\u8BB0\u4E3A\u4E0D\u53EF\u7EED\u671F\uFF08\u9700\u91CD\u65B0\u767B\u5F55\uFF09`
          );
        } else {
          this.ctx.logger?.warn?.(
            `[${this.product.id}] \u8D26\u53F7 ${entry.id} \u7EED\u671F\u5931\u8D25\uFF08\u5C06\u6309\u8C03\u5EA6\u5668\u7B56\u7565\u91CD\u8BD5\uFF09: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }
  /** 移除已存储的凭据并停止任何待处理的刷新。 */
  async logout() {
    this.active = false;
    this.scheduler.stop();
    await this.ctx.credentials.unset(credentialRef7(this.credentialRefName));
  }
  /** 停止刷新调度（不清理凭据）。 */
  stop() {
    this.active = false;
    this.scheduler.stop();
  }
  /** 启动时若已有可刷新凭据则安排续期（由 apply 调用）。 */
  scheduleRefresh() {
    void this.ctx.credentials.resolve(credentialRef7(this.credentialRefName)).then((resolved) => {
      if (!resolved) return;
      const credential = parseCredential(resolved.value);
      if (!credential || !isQoderRefreshable(credential)) return;
      const expiresAt = qoderCredentialExpiresAtMs(credential);
      if (expiresAt !== void 0) this.scheduler.arm(expiresAt);
    });
  }
  /** 从存储重载凭据，返回是否已过期（供 UI 判断是否需要提示重新登录）。 */
  async checkExpired() {
    const resolved = await this.ctx.credentials.resolve(credentialRef7(this.credentialRefName));
    if (!resolved) return true;
    const credential = parseCredential(resolved.value);
    return credential === void 0 ? true : isQoderExpired(credential);
  }
  /**
   * 解析本实例默认凭据 ref 下的凭据；不可用时返回 undefined。
   *
   * 供 e2e 探针与 `account-probe` 使用。
   */
  async resolveStoredCredential() {
    const resolved = await this.ctx.credentials.resolve(credentialRef7(this.credentialRefName));
    if (!resolved) return void 0;
    return parseCredential(resolved.value);
  }
};

// src/backend/providers/pool-credentials.ts
import { credentialRef as credentialRef8 } from "@deepseek-ai/dsh-credentials";
function pooledCredentials({ ctx, pool, accountForRefresh, throwIfAllAccountsRateLimited }, product, auth, onAccount) {
  const ref = credentialRef8(product.defaultCredentialRef);
  return {
    credentialRef: ref,
    async resolveCredential(modelId) {
      const available = await pool.getAvailableAccount(product.id, modelId ?? "");
      onAccount?.(available?.entry.id);
      if (available) {
        reportLedgerAccount(product.id, available.entry.id);
        return available.credential;
      }
      throwIfAllAccountsRateLimited(product, modelId);
      const resolved = await ctx.credentials.resolve(ref);
      if (!resolved) return void 0;
      try {
        return JSON.parse(resolved.value);
      } catch {
        return void 0;
      }
    },
    async refresh(accountId) {
      const available = await accountForRefresh(product.id, accountId);
      if (available) await auth.refreshAccountCredential(available.entry.credentialRef, pool, available.entry.id);
      else await auth.refresh();
    }
  };
}

// src/backend/providers/qodercn.ts
function mountQoderCN(context, cliCatalogFile) {
  const { ctx, pool, readImage, readImageRequest } = context;
  let currentAccountId;
  const qoderCn = new QoderAuth(ctx, { product: QODER_CN });
  const qoderCnAdapter = registerQoderLlm(ctx, {
    ...pooledCredentials(context, QODER_CN, qoderCn, (id) => {
      currentAccountId = id;
    }),
    readImage,
    // 同 QODER：两站共用同一个适配器类，缩放桥接也必须两边都接
    //（只接一边会让中国版的截图照样撞 57 MiB）。
    readImageRequest,
    accountPool: pool,
    product: QODER_CN,
    cliCatalogFile,
    // 额度受限时用它标记「当前账号」（见 `QoderAdapter.switchAccountOnQuota`）。
    // ⚠️ 取「**本次实际使用**的账号」而非池里默认那一个：池的默认账号可能与之
    // 不同（例如本账号被限流、池已切到别的账号），标错就会让标记落在无辜账号上。
    currentAccountId: () => currentAccountId,
    queueAccountIdForCredential: async (credential) => {
      const id = await pool.findAccountIdByCredential(QODER_CN.id, credential.access_token);
      return id.length > 0 ? id : void 0;
    },
    onQueueAccountSwitch: () => {
      ctx.logger?.info?.(`[channel-pack] ${QODER_CN.displayName} \u6392\u961F\u65F6\u5DF2\u5C1D\u8BD5\u5207\u6362\u8D26\u53F7`);
    },
    onQueueRotationFailure: (reason) => {
      ctx.logger?.warn?.(`[channel-pack] ${QODER_CN.displayName} \u6392\u961F\u6362\u53F7\u5931\u8D25\uFF0C\u5C06\u7EE7\u7EED\u7B49\u5F85\u5E76\u91CD\u8BD5`);
      if (reason !== void 0) ctx.logger?.debug?.(`[channel-pack] ${QODER_CN.id} queue rotation detail: ${String(reason)}`);
    }
  });
  return { auth: qoderCn, adapters: { [QODER_CN.id]: qoderCnAdapter }, maintain: () => qoderCn.refreshAll(pool) };
}

// vendor/channel-pack/src/trae-auth.ts
import { Service as Service3 } from "@deepseek-ai/cordis";
import { credentialRef as credentialRef9 } from "@deepseek-ai/dsh-credentials";

// vendor/channel-pack/src/trae-oauth.ts
import { createServer as createServer2 } from "node:http";
var TRAE_CALLBACK_PORT = 18080;
function machineTraceId(machineId, deviceId) {
  const joined = machineId + deviceId;
  return joined.length >= 16 ? joined.slice(-16) : joined.padStart(16, "0");
}
function buildTraeLoginURL(product, machineId, deviceId, callbackUrl) {
  const params = new URLSearchParams({
    login_version: "1",
    auth_from: "solo",
    login_channel: "native_ide",
    plugin_version: product.pluginVersion,
    auth_type: "local",
    client_id: product.clientId,
    redirect: "0",
    login_trace_id: machineTraceId(machineId, deviceId),
    // ⚠️ 参数名必须是 auth_callback_url（见函数注释）。
    auth_callback_url: callbackUrl,
    machine_id: machineId,
    device_id: deviceId,
    x_device_id: deviceId,
    x_machine_id: machineId,
    x_device_brand: "PC",
    x_device_type: "PC",
    x_os_version: "1.0",
    x_app_version: product.ideVersion,
    x_app_type: "stable"
  });
  return `${product.consoleHost}/authorization?${params.toString()}`;
}
function parseJsonParam(raw) {
  if (raw === null || raw.length === 0) return void 0;
  const candidates = [raw];
  try {
    const unescaped = decodeURIComponent(raw);
    if (unescaped !== raw) candidates.push(unescaped);
  } catch {
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
    }
  }
  return void 0;
}
function jsonString(source, key) {
  if (source === void 0) return "";
  const value = source[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
function fixNicknameMojibake(raw, uid) {
  if (raw.length === 0) return raw;
  for (const encoding of ["latin1"]) {
    try {
      const fixed = Buffer.from(raw, encoding).toString("utf8");
      if (fixed.length > 0 && !fixed.includes("\uFFFD") && [...fixed].every((ch) => ch.charCodeAt(0) >= 32)) {
        return fixed;
      }
    } catch {
    }
  }
  if (!/[\u4e00-\u9fff]/.test(raw)) return `\u7528\u6237${uid.slice(-4)}`;
  return raw;
}
function parseTraeCallbackDetailed(rawUrl) {
  let query;
  try {
    query = new URL(rawUrl.startsWith("http") ? rawUrl : `http://127.0.0.1${rawUrl}`).searchParams;
  } catch {
    return { ok: false, reason: "\u56DE\u8C03 URL \u65E0\u6CD5\u89E3\u6790", authCodeFlow: false };
  }
  const userInfo = parseJsonParam(query.get("userInfo"));
  const userJwt = parseJsonParam(query.get("userJwt"));
  let refreshToken = query.get("refreshToken") ?? "";
  const uid = jsonString(userInfo, "UserID");
  const nicknameRaw = jsonString(userInfo, "ScreenName");
  const enterpriseId = jsonString(userInfo, "TenantID");
  const jwtToken = jsonString(userJwt, "Token");
  const jwtRefresh = jsonString(userJwt, "RefreshToken");
  if (refreshToken.length === 0) refreshToken = jwtRefresh;
  const authCodeInfo = parseJsonParam(query.get("authCodeInfo"));
  const authCodeCandidates = [
    query.get("code") ?? "",
    query.get("authCode") ?? "",
    jsonString(authCodeInfo, "code"),
    jsonString(authCodeInfo, "authCode"),
    // authCodeInfo 为**纯 code 字符串**（非 JSON）时 parseJsonParam 解不出，
    // 故把原始值也作为兜底候选放在最后 —— 前面能解出 JSON 字段时不会走到这里。
    query.get("authCodeInfo") ?? ""
  ];
  const authCode = authCodeCandidates.find((candidate) => candidate.trim().length > 0)?.trim() ?? "";
  const info = {
    refreshToken,
    // 仅在「无 refreshToken」时才用 userJwt.Token 兜底（login.sh:186-195）。
    accessToken: refreshToken.length === 0 ? jwtToken : "",
    uid,
    nickname: fixNicknameMojibake(nicknameRaw, uid),
    enterpriseId
  };
  if (authCode.length > 0) info.authCode = authCode;
  if (info.refreshToken.length === 0 && info.accessToken.length === 0) {
    if (authCode.length > 0) {
      return {
        ok: false,
        authCodeFlow: true,
        reason: "\u4E0A\u6E38\u8FD4\u56DE\u4E86 PKCE \u6388\u6743\u7801\uFF08code/authCodeInfo\uFF09\uFF0C\u672C\u5B9E\u73B0\u6682\u4E0D\u652F\u6301\u8BE5\u6D41\u7A0B\uFF1B\u8BF7\u786E\u8BA4 TRAE \u6388\u6743\u9875\u662F\u5426\u5DF2\u5207\u6362\u5230\u65B0\u6D41\u7A0B"
      };
    }
    return {
      ok: false,
      authCodeFlow: false,
      reason: "\u56DE\u8C03\u672A\u643A\u5E26 refreshToken / userJwt.Token / code"
    };
  }
  return { ok: true, info };
}
async function exchangeTraeCallback(callback, session, product, fetcher = fetch, nowMs = Date.now()) {
  let exchange;
  if (callback.refreshToken.length > 0) {
    const exchangeBody = {
      ClientID: product.clientId,
      RefreshToken: callback.refreshToken,
      ClientSecret: "-",
      UserID: ""
    };
    const exchangeResp = await fetcher(`${product.oauthHost}${TRAE_EXCHANGE_PATH}`, {
      method: "POST",
      headers: traeOAuthHeaders(product),
      body: JSON.stringify(exchangeBody),
      signal: AbortSignal.timeout(TRAE_REQUEST_TIMEOUT_MS)
    });
    if (!exchangeResp.ok) {
      const text = await exchangeResp.text().catch(() => "");
      throw new Error(`TRAE ExchangeToken \u5931\u8D25\uFF08HTTP ${exchangeResp.status}\uFF09\uFF1A${text.length > 200 ? text.slice(0, 200) : text}`);
    }
    const parsed = parseTraeExchangeResponse(await exchangeResp.json());
    if (parsed === void 0) throw new Error("TRAE ExchangeToken \u54CD\u5E94\u7F3A\u5C11 Token");
    exchange = parsed;
  } else {
    exchange = {
      accessToken: callback.accessToken,
      refreshToken: "",
      tokenExpireAt: 0,
      tokenExpireDuration: 0,
      refreshExpireAt: 0
    };
  }
  let userInfo = {
    uid: callback.uid,
    screenName: callback.nickname,
    enterpriseId: callback.enterpriseId,
    // ⚠️ 回调的 `userInfo` 参数**不含**脱敏手机号 / 邮箱（实测只有 UserID /
    // ScreenName / TenantID），它们只在 `GetUserInfo` 响应里 —— 故这里回退空串，
    // 由下面的 GetUserInfo 分支补上。
    phone: "",
    email: ""
  };
  try {
    const uHeaders = traeOAuthHeaders(product);
    uHeaders["X-Cloudide-Token"] = exchange.accessToken;
    const userInfoResp = await fetcher(`${product.oauthHost}${TRAE_USER_INFO_PATH}`, {
      method: "POST",
      headers: uHeaders,
      body: JSON.stringify({ ReqSource: "IDE", IDEVersion: product.ideVersion }),
      signal: AbortSignal.timeout(TRAE_REQUEST_TIMEOUT_MS)
    });
    if (userInfoResp.ok) {
      const fetched = parseTraeUserInfoResponse(await userInfoResp.json());
      if (fetched !== void 0) {
        userInfo = {
          uid: fetched.uid,
          screenName: fetched.screenName.length > 0 ? fetched.screenName : userInfo.screenName,
          enterpriseId: fetched.enterpriseId.length > 0 ? fetched.enterpriseId : userInfo.enterpriseId,
          // 手机号 / 邮箱只在 GetUserInfo 里有，拿到即用（空串表示确实没有）。
          phone: fetched.phone,
          email: fetched.email
        };
      }
    }
  } catch {
  }
  if (userInfo.uid.length === 0) {
    throw new Error("TRAE \u672A\u80FD\u786E\u5B9A uid\uFF08\u56DE\u8C03 userInfo \u4E0E GetUserInfo \u5747\u4E3A\u7A7A\uFF09");
  }
  if (exchange.accessToken.length === 0) {
    throw new Error("TRAE \u6362 token \u540E\u6CA1\u6709 accessToken");
  }
  return buildTraeCredential(exchange, userInfo, session, nowMs);
}
function listenOrReject(server, port, onError) {
  return new Promise((resolve2, reject) => {
    let settled = false;
    const onListenError = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      onError?.(error);
      reject(error);
    };
    server.once("error", onListenError);
    server.listen(port, "127.0.0.1", () => {
      settled = true;
      server.removeListener("error", onListenError);
      server.on("error", () => {
      });
      const address = server.address();
      resolve2(typeof address === "object" && address !== null ? address.port : port);
    });
  });
}
async function listenWithFallback(server, preferredPort) {
  try {
    return await listenOrReject(server, preferredPort);
  } catch (error) {
    const code = error.code;
    if (code !== "EADDRINUSE" && code !== "EACCES") throw error;
    return await listenOrReject(server, 0);
  }
}
async function runTraeLoginFlow(options) {
  const machineId = generateMachineId();
  const deviceId = generateDeviceId();
  const preferredPort = options.callbackPort ?? TRAE_CALLBACK_PORT;
  const { callback, port } = await startCallbackServer(preferredPort, options.product.consoleHost);
  const callbackUrl = `http://127.0.0.1:${port}/authorize`;
  const loginUrl = buildTraeLoginURL(options.product, machineId, deviceId, callbackUrl);
  const credential = await exchangeTraeCallback(
    callback,
    { machineId, deviceId },
    options.product,
    options.fetcher
  );
  const access = JSON.stringify(credential);
  const expires = credentialExpiresAtMs(credential) ?? 0;
  return {
    access,
    expires,
    loginUrl,
    refreshable: credential.refresh_token.length > 0
  };
}
async function startTraeLoginFlow(options) {
  const machineId = generateMachineId();
  const deviceId = generateDeviceId();
  const preferredPort = options.callbackPort ?? TRAE_CALLBACK_PORT;
  const server = createServer2();
  let resultTimer;
  let rejectResult;
  let loginUrl = "";
  const resultPromise = new Promise((resolve2, reject) => {
    rejectResult = reject;
    resultTimer = setTimeout(() => {
      server.close();
      reject(new Error("TRAE \u767B\u5F55\u8D85\u65F6"));
    }, TRAE_LOGIN_TIMEOUT_MS);
    resultTimer.unref?.();
    server.on("request", (req, res) => {
      const url = req.url ?? "";
      if (!url.startsWith("/authorize")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const parsed = parseTraeCallbackDetailed(url);
      if (!parsed.ok) {
        if (resultTimer) clearTimeout(resultTimer);
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`TRAE \u767B\u5F55\u56DE\u8C03\u65E0\u6548\uFF1A${parsed.reason}`);
        server.close();
        reject(new Error(`TRAE \u767B\u5F55\u56DE\u8C03\u65E0\u6548\uFF1A${parsed.reason}`));
        return;
      }
      const callback = parsed.info;
      exchangeTraeCallback(callback, { machineId, deviceId }, options.product, options.fetcher).then((credential) => {
        if (resultTimer) clearTimeout(resultTimer);
        const access = JSON.stringify(credential);
        const expires = credentialExpiresAtMs(credential) ?? 0;
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`TRAE \u767B\u5F55\u6210\u529F\uFF1A${credential.nickname ?? credential.uid}\u3002\u53EF\u4EE5\u5173\u95ED\u6B64\u9875\u9762\u8FD4\u56DE\u9762\u677F\u3002`);
        server.close();
        resolve2({
          access,
          expires,
          loginUrl,
          refreshable: credential.refresh_token.length > 0
        });
      }).catch((error) => {
        if (resultTimer) clearTimeout(resultTimer);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`TRAE \u767B\u5F55\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
        server.close();
        reject(error);
      });
    });
  });
  resultPromise.catch(() => {
  });
  let actualPort;
  try {
    actualPort = await listenWithFallback(server, preferredPort);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `TRAE \u56DE\u8C03\u7AEF\u53E3\u65E0\u6CD5\u76D1\u542C\uFF08${reason}\uFF09\uFF1B\u7AEF\u53E3\u53EF\u80FD\u5DF2\u88AB\u5176\u5B83\u7A0B\u5E8F\u5360\u7528\uFF0C\u8BF7\u91CA\u653E\u540E\u91CD\u8BD5\u3002`;
    rejectResult?.(new Error(message));
    throw new Error(message);
  }
  const callbackUrl = `http://127.0.0.1:${actualPort}/authorize`;
  loginUrl = buildTraeLoginURL(options.product, machineId, deviceId, callbackUrl);
  return {
    loginUrl,
    result: resultPromise,
    // 关闭时**必须**同时清掉兜底超时定时器：否则用户在浏览器里点了取消、
    // 前端调 close() 之后，那个 10 分钟的定时器仍会挂着并最终 reject 一个
    // 无人消费的 Promise（未处理拒绝告警）。
    close: () => new Promise((resolve2) => {
      if (resultTimer) clearTimeout(resultTimer);
      server.close(() => resolve2());
    })
  };
}
async function startCallbackServer(port = TRAE_CALLBACK_PORT, _consoleHost, timeoutMs = TRAE_LOGIN_TIMEOUT_MS) {
  const server = createServer2();
  let timer;
  let actualPort = port;
  const result = new Promise((resolve2, reject) => {
    server.on("request", (req, res) => {
      const url = req.url ?? "";
      if (!url.startsWith("/authorize")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const parsed = parseTraeCallbackDetailed(url);
      if (!parsed.ok) {
        if (timer) clearTimeout(timer);
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`TRAE \u767B\u5F55\u56DE\u8C03\u65E0\u6548\uFF1A${parsed.reason}`);
        server.close();
        reject(new Error(`TRAE \u767B\u5F55\u56DE\u8C03\u65E0\u6548\uFF1A${parsed.reason}`));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("\u5DF2\u6536\u5230 TRAE \u6388\u6743\uFF0C\u6B63\u5728\u6362\u53D6\u51ED\u636E\u2026\u53EF\u4EE5\u5173\u95ED\u6B64\u9875\u9762\u3002");
      server.close();
      resolve2({ callback: parsed.info, port: actualPort });
    });
    timer = setTimeout(() => {
      server.close();
      reject(new Error("TRAE \u767B\u5F55\u56DE\u8C03\u8D85\u65F6"));
    }, timeoutMs);
    timer.unref?.();
  });
  result.catch(() => {
  });
  let resolvedPort;
  try {
    resolvedPort = await listenWithFallback(server, port);
  } catch (error) {
    if (timer) clearTimeout(timer);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`TRAE \u56DE\u8C03\u7AEF\u53E3 ${port} \u65E0\u6CD5\u76D1\u542C\uFF08${reason}\uFF09\uFF1B\u7AEF\u53E3\u53EF\u80FD\u5DF2\u88AB\u5360\u7528\u3002`);
  }
  actualPort = resolvedPort;
  server.once("close", () => {
    if (timer) clearTimeout(timer);
  });
  return result;
}

// vendor/channel-pack/src/trae-auth.ts
var TRAE_EXPIRY_ACCESSORS = {
  expiresAtOf: traeCredentialExpiresAtMs,
  refreshableOf: isTraeRefreshable,
  identityOf: (credential) => credential.access_token ?? ""
};
var RefreshTokenExpiredError3 = class extends Error {
  constructor(message) {
    super(message);
    this.name = "RefreshTokenExpiredError";
  }
};
function parseCredential2(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && typeof parsed.access_token === "string" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
var TraeAuth = class _TraeAuth extends Service3 {
  constructor(ctx, options = {}) {
    const product = options.product ?? TRAE;
    super(ctx, options.serviceName ?? `${product.id}Auth`);
    this.options = options;
    this.product = product;
    this.credentialRefName = this.product.defaultCredentialRef;
  }
  /** 本实例所属的产品配置。 */
  product;
  /** 本实例默认读写的凭据 ref 名称（`TRAE_ACCESS_TOKEN`）。 */
  credentialRefName;
  scheduler = new RefreshScheduler(
    () => this.refresh(),
    (error) => {
      if (error instanceof RefreshTokenExpiredError3) {
        this.markRefreshTokenInvalid();
        return;
      }
      this.lastRefreshError = error instanceof Error ? error.message : String(error);
    }
  );
  /** refresh_token 已被后端判定失效；登录/刷新成功时重置。 */
  refreshTokenInvalid = false;
  lastRefreshError;
  /** 登录会话是否仍处于活跃状态；logout()/stop() 置 false，防止在途刷新回写已登出凭据。 */
  active = true;
  /**
   * 模型目录缓存（含**空结果**）与拉取时刻。
   *
   * ⚠️ 为什么需要它：适配器的 `ensureRemoteModels` 是**只缓存非空结果**的
   * （全仓库四个适配器同一模式）—— 拉到空数组时 `remoteModels` 保持 undefined，
   * 于是**下一次** `listModels` / `resolveModel` 会再拉一次。
   *
   * 「未登录 TRAE」恰好就是恒空的情形：用户每打开一次模型选择器、每次
   * 解析模型都发起一次真实 HTTP 请求。用户报障的日志刷屏
   * （同一行 `fetchModels: calling …` 重复数十次）正是这么来的。
   *
   * 故这里**连同空结果一起缓存**，并给一个短 TTL（登录后 30s 内即可自愈，
   * 不需要用户重启宿主）。缓存的是「这次拉取的结果」，与是否有凭据无关 ——
   * 无凭据时直接返回空并缓存，避免重复走一遍凭据解析。
   */
  modelsCache;
  /** 模型目录缓存有效期（毫秒）。短 TTL：新登录的账号最多 30s 后可见。 */
  static MODELS_CACHE_TTL_MS = 3e4;
  /** 注入的 fetch（测试用）；默认为全局 fetch。 */
  get fetchImpl() {
    return this.options.fetcher ?? fetch;
  }
  /** 标记 refresh_token 已失效：停止重试，并向 status() 暴露 refreshable: false 与重新登录提示。 */
  markRefreshTokenInvalid() {
    this.refreshTokenInvalid = true;
    this.lastRefreshError = "refresh_token \u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55";
  }
  /**
   * 运行完整登录流程并持久化凭据。
   */
  async login(flowOptions = {}) {
    this.active = true;
    const flow = await runTraeLoginFlow({
      product: this.product,
      ...this.options.fetcher === void 0 ? {} : { fetcher: this.options.fetcher },
      ...flowOptions
    });
    return this.persistLogin(flow, flowOptions);
  }
  /**
   * 两步式登录：起回调服务器并立即返回 loginUrl。
   */
  async startLogin(flowOptions = {}) {
    this.active = true;
    const started = await startTraeLoginFlow({
      product: this.product,
      ...this.options.fetcher === void 0 ? {} : { fetcher: this.options.fetcher },
      ...flowOptions
    });
    const result = started.result.then((flow) => this.persistLogin(flow, flowOptions));
    result.catch(() => {
    });
    return { loginUrl: started.loginUrl, result, close: started.close };
  }
  /**
   * 持久化一次登录结果。
   */
  async persistLogin(flow, flowOptions = {}) {
    const ref = flowOptions.refName ? credentialRef9(flowOptions.refName) : credentialRef9(this.credentialRefName);
    await this.ctx.credentials.set(ref, flow.access);
    this.refreshTokenInvalid = false;
    this.lastRefreshError = void 0;
    this.modelsCache = void 0;
    this.scheduleRefresh();
    const credential = parseCredential2(flow.access);
    if (flowOptions.accountId !== void 0 && flowOptions.pool !== void 0) {
      await flowOptions.pool.addAccount({
        id: flowOptions.accountId,
        provider: this.product.id,
        // ⚠️ 用 `traeDisplayNickname`（手机号优先）而非直接取 `nickname`：
        // 服务端的 ScreenName 是**按 uid 自动生成的默认名**，多账号无法区分。
        // 见该函数的说明（用户报障 2026-09-27）。
        nickname: traeDisplayNickname(credential, flowOptions.accountId),
        enabled: true,
        credentialRef: flowOptions.refName ?? this.credentialRefName,
        createdAt: Date.now(),
        expiresAt: credential ? traeCredentialExpiresAtMs(credential) : void 0,
        refreshable: credential !== void 0 && isTraeRefreshable(credential)
      });
    }
    return {
      access: flow.access,
      expires: flow.expires,
      ref,
      loginUrl: flow.loginUrl,
      refreshable: flow.refreshable
    };
  }
  /** 报告凭据状态。 */
  async status() {
    const ref = credentialRef9(this.credentialRefName);
    const info = await this.ctx.credentials.describe(ref);
    if (!info.configured) return { configured: false, refreshable: false };
    let expiresAt;
    let refreshable = false;
    const resolved = await this.ctx.credentials.resolve(ref);
    if (resolved) {
      const credential = parseCredential2(resolved.value);
      if (credential) {
        expiresAt = traeCredentialExpiresAtMs(credential);
        refreshable = isTraeRefreshable(credential) && !this.refreshTokenInvalid;
      }
    }
    return {
      configured: true,
      source: info.source,
      expiresAt,
      refreshable,
      ...this.lastRefreshError === void 0 ? {} : { refreshError: this.lastRefreshError }
    };
  }
  /**
   * 静默续期：ExchangeToken 换新。
   *
   * 终态判定：
   * - HTTP 401/403、或响应体命中 session-dead 标记 → 抛 RefreshTokenExpiredError
   * - 其余错误（网络抖动、5xx、429）→ 抛普通 Error，走可重试路径
   */
  async refresh() {
    const ref = credentialRef9(this.credentialRefName);
    const resolved = await this.ctx.credentials.resolve(ref);
    if (!resolved) throw new Error("\u672A\u914D\u7F6E\u51ED\u636E\uFF0C\u8BF7\u5148\u767B\u5F55");
    const credential = parseCredential2(resolved.value);
    if (!credential) throw new Error("\u51ED\u636E\u89E3\u6790\u5931\u8D25");
    if (!isTraeRefreshable(credential)) {
      throw new RefreshTokenExpiredError3("\u65E0 refresh_token\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
    }
    try {
      const refreshed = await this.refreshCredential(credential);
      if (!this.active) return;
      await this.ctx.credentials.set(ref, JSON.stringify(refreshed));
      this.refreshTokenInvalid = false;
      this.lastRefreshError = void 0;
      this.scheduleRefresh();
    } catch (error) {
      if (error instanceof RefreshTokenExpiredError3) this.markRefreshTokenInvalid();
      throw error;
    }
  }
  /**
   * 按凭据 ref 续期指定账号的凭据。
   *
   * 同样**不触碰** `refreshTokenInvalid` / `lastRefreshError` / 调度器：
   * 那些状态属于单凭据路径，被多账号操作污染会让 UI 显示错误的失效提示。
   *
   * ⚠️ **必须回写账号池的 `expiresAt`**（issue !IKIRTT 的真实缺陷）：
   * UI 账号卡片的「有效期」读的正是池里的值，而不是凭据里 access_token 的真实
   * 过期时间。早期这里只 `credentials.set`，于是调用 `account.refresh` 后凭据确实续好了、
   * 界面却**一直显示「已过期」**，且没有任何自救手段（「重测」按钮的 refresh
   * 是刻意的 no-op）。TRAE 用 ExchangeToken 轮换 refreshToken，不回写还会让
   * 池里的 `refreshable` 与实际凭据脱节。
   *
   * @param pool 账号池；提供时会把新 `expiresAt` / `refreshable` 写回。
   * @param accountId 账号 id。**调用方已知时请显式传入** ——
   *   否则只能按凭据内容反查（代价高，且反查会跳过已停用账号）。
   */
  async refreshAccountCredential(refName, pool, accountId) {
    const ref = credentialRef9(refName);
    const resolved = await this.ctx.credentials.resolve(ref);
    if (!resolved) throw new Error("\u51ED\u636E\u672A\u914D\u7F6E");
    const credential = parseCredential2(resolved.value);
    if (!credential) throw new Error("\u51ED\u636E\u89E3\u6790\u5931\u8D25");
    if (!isTraeRefreshable(credential)) {
      throw new RefreshTokenExpiredError3("\u65E0 refresh_token\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
    }
    const refreshed = await this.refreshCredential(credential);
    await this.ctx.credentials.set(ref, JSON.stringify(refreshed));
    await syncAccountExpiry({
      pool,
      provider: this.product.id,
      credential: refreshed,
      accessors: TRAE_EXPIRY_ACCESSORS,
      accountId,
      tag: "[trae]",
      warn: (message) => this.ctx.logger?.warn?.(message)
    });
  }
  /**
   * 对一份凭据执行一次续期并返回新凭据（不触碰存储）。
   */
  async refreshCredential(credential) {
    const host = credential.api_host ?? this.product.oauthHost;
    const exchangeBody = {
      ClientID: this.product.clientId,
      RefreshToken: credential.refresh_token,
      ClientSecret: "-",
      UserID: ""
    };
    let response;
    try {
      response = await this.fetchImpl(`${host}${TRAE_EXCHANGE_PATH}`, {
        method: "POST",
        headers: traeOAuthHeaders(this.product),
        body: JSON.stringify(exchangeBody),
        signal: AbortSignal.timeout(TRAE_REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new Error(`TRAE \u7EED\u671F\u7F51\u7EDC\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text().catch(() => "");
    let parsed;
    try {
      const candidate = JSON.parse(text);
      if (typeof candidate === "object" && candidate !== null) {
        parsed = candidate;
      }
    } catch {
      parsed = void 0;
    }
    const exchange = parsed === void 0 ? void 0 : parseTraeExchangeResponse(parsed);
    if (exchange === void 0 || exchange.accessToken.length === 0) {
      const kind = classifyTraeError(response.status, text);
      const noTokenInSuccessResponse = response.ok && parsed !== void 0;
      if (response.status === 401 || response.status === 403 || isTraeTerminalError(kind) || noTokenInSuccessResponse) {
        throw new RefreshTokenExpiredError3("TRAE refresh_token \u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
      }
      throw new Error(`TRAE \u7EED\u671F\u5931\u8D25\uFF08HTTP ${response.status}\uFF09\uFF1A${text.slice(0, 200)}`);
    }
    return applyTraeRefresh(credential, exchange);
  }
  /**
   * 批量续期本产品的所有账号。
   *
   * **包含已停用账号**（只按 `refreshable` 过滤）。
   *
   * ⚠️ **lead-time 过滤**（issue !IKIRTT）：早先这里是**无条件全量续期** ——
   * 定时器每 30 分钟就把每个账号的 refreshToken 轮换一次，与「凭据还剩多久」
   * 无关。现复用单凭据时代 `REFRESH_LEAD_MS` 的语义：**距过期不足 1 小时才刷**。
   * 跳过的账号仍会做一次**有效期对账**（见 `refreshAccountWithReconcile`），
   * 因为「不刷」与「不回写池值」正是 UI 假过期的两个来源，必须分开处理。
   */
  async refreshAll(pool) {
    const accounts = await pool.listAccounts(this.product.id);
    for (const entry of accounts) {
      if (!entry.refreshable) continue;
      try {
        const ref = credentialRef9(entry.credentialRef);
        const resolved = await this.ctx.credentials.resolve(ref);
        if (!resolved) {
          await pool.updateAccount(entry.id, { refreshable: false });
          continue;
        }
        const credential = parseCredential2(resolved.value);
        if (!credential || !isTraeRefreshable(credential)) {
          await pool.updateAccount(entry.id, { refreshable: false });
          continue;
        }
        await refreshAccountWithReconcile({
          pool,
          provider: this.product.id,
          tag: "[trae]",
          accountId: entry.id,
          credential,
          accessors: TRAE_EXPIRY_ACCESSORS,
          current: entry,
          refresh: (c) => this.refreshCredential(c),
          save: (c) => this.ctx.credentials.set(ref, JSON.stringify(c)),
          warn: (message) => this.ctx.logger?.warn?.(message)
        });
      } catch (error) {
        if (error instanceof RefreshTokenExpiredError3) {
          try {
            await pool.updateAccount(entry.id, { refreshable: false });
          } catch {
          }
          this.ctx.logger?.warn?.(`[trae] \u8D26\u53F7 ${entry.id} \u7684 refresh_token \u5DF2\u5931\u6548\uFF0C\u5DF2\u6807\u8BB0\u4E3A\u4E0D\u53EF\u7EED\u671F`);
        } else {
          this.ctx.logger?.warn?.(
            `[trae] \u8D26\u53F7 ${entry.id} \u7EED\u671F\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }
  /**
   * 一次性修复**老账号**的展示名：补 `GetUserInfo` 拿脱敏手机号并重算昵称。
   *
   * ## 为什么需要它（真实缺陷，用户报障 2026-09-27）
   *
   * > 用 trae provider 登录后用户名字显示无法区分各个用户，有其他名字昵称或者
   * > 手机尾号之类的信息可以区分吗？
   *
   * 服务端的 `ScreenName` 是**按 uid 自动生成的默认名**（`用户26815487395`
   * 这种），四个账号形态完全一致，一屏列出来认不出谁是谁。
   * `GetUserInfo` 会下发 `NonPlainTextMobile`（脱敏手机号），实测可区分。
   *
   * 光改代码只影响**新登录**的账号，已登录的老账号昵称仍是 ScreenName，
   * 故这里在启动时主动补一次 —— 与 `RaccoonAuth.repairAccountNicknames`
   * 同一模式（同因：服务端下发的名字是默认名）。
   *
   * ## 契约
   *
   * - **幂等**：昵称已是手机号时 `traeDisplayNickname` 会算出同一值，
   *   不触发写入（只在**确实变化**时落盘，否则每次启动都写一次文档）。
   * - **失败不阻塞**：逐账号 catch，任何异常只记 warn。
   * - **只读补字段**：不发续期、不动 token，只补 `phone` 与昵称。
   *
   * @returns 被修复的账号 id 列表（供日志）
   */
  async repairAccountNicknames(pool) {
    const repaired = [];
    let entries;
    try {
      entries = await pool.listAccounts(this.product.id);
    } catch {
      return repaired;
    }
    for (const entry of entries) {
      try {
        const ref = credentialRef9(entry.credentialRef);
        const resolved = await this.ctx.credentials.resolve(ref);
        if (!resolved) continue;
        let credential = parseCredential2(resolved.value);
        if (credential === void 0) continue;
        if ((credential.phone === void 0 || credential.phone.length === 0) && (credential.email === void 0 || credential.email.length === 0)) {
          const info = await this.fetchUserContact(credential);
          if (info === void 0) continue;
          credential = withTraePhone(credential, info.phone, info.email);
          await this.ctx.credentials.set(ref, JSON.stringify(credential));
        }
        const target = traeDisplayNickname(credential, entry.id);
        if (target !== entry.nickname) {
          await pool.updateAccount(entry.id, { nickname: target });
          repaired.push(entry.id);
        }
      } catch (error) {
        this.ctx.logger?.warn?.(
          `[trae] \u4FEE\u590D\u8D26\u53F7 ${entry.id} \u7684\u663E\u793A\u540D\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u4F7F\u7528\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return repaired;
  }
  /**
   * 调 `GetUserInfo` 只取脱敏手机号 / 邮箱。
   *
   * ⚠️ 两者都没有时返回 `undefined` 而**不抛错**：它们只是展示信息，拿不到
   * 不应让启动流程失败（与 `exchangeTraeCallback` 对 GetUserInfo 的容错同原则）。
   * 返回 `undefined` 也让调用方能区分「确实没有」与「拿到了空值」，
   * 从而避免用服务端默认名覆盖用户手动改过的昵称。
   */
  async fetchUserContact(credential) {
    try {
      const host = credential.api_host ?? this.product.oauthHost;
      const headers = traeOAuthHeaders(this.product);
      headers["X-Cloudide-Token"] = credential.access_token;
      const response = await this.fetchImpl(`${host}${TRAE_USER_INFO_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ReqSource: "IDE", IDEVersion: this.product.ideVersion }),
        signal: AbortSignal.timeout(TRAE_REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) return void 0;
      const parsed = parseTraeUserInfoResponse(await response.json());
      if (parsed === void 0) return void 0;
      const phone = parsed.phone.length > 0 ? parsed.phone : void 0;
      const email = parsed.email.length > 0 ? parsed.email : void 0;
      return phone === void 0 && email === void 0 ? void 0 : { phone, email };
    } catch {
      return void 0;
    }
  }
  /** 移除已存储的凭据并停止任何待处理的刷新。 */
  async logout() {
    this.active = false;
    this.scheduler.stop();
    await this.ctx.credentials.unset(credentialRef9(this.credentialRefName));
    this.modelsCache = void 0;
  }
  /** 停止刷新调度（不清理凭据）。 */
  stop() {
    this.active = false;
    this.scheduler.stop();
  }
  /** 启动时若已有可刷新凭据则安排续期。 */
  scheduleRefresh() {
    void this.ctx.credentials.resolve(credentialRef9(this.credentialRefName)).then((resolved) => {
      if (!resolved) return;
      const credential = parseCredential2(resolved.value);
      if (!credential || !isTraeRefreshable(credential)) return;
      const expiresAt = traeCredentialExpiresAtMs(credential);
      if (expiresAt !== void 0) this.scheduler.arm(expiresAt);
    });
  }
  /** 从存储重载凭据，返回是否已过期。 */
  async checkExpired() {
    const resolved = await this.ctx.credentials.resolve(credentialRef9(this.credentialRefName));
    if (!resolved) return true;
    const credential = parseCredential2(resolved.value);
    return credential === void 0 ? true : isTraeExpired(credential);
  }
  /**
   * 获取 TRAE 模型列表（`batch_get_detail_param`）。
   *
   * ## 日志约定（与其它 provider 对齐）
   *
   * **成功路径一律不打印**。早期这里用 `console.warn` 打了「calling / got N
   * models」，而本方法在冷启动阶段会被调用多次（每次 `listModels` /
   * `resolveModel` 都可能触发，见 `TraeAdapter.ensureRemoteModels`），
   * 于是整个日志被同一行刷屏 —— 用户报障「fetch 的 log 似乎太多了」。
   *
   * **「没有凭据」不是异常**：未登录 TRAE 的用户每次列模型都会走到这条分支，
   * 打日志只会制造噪声（用户报障「没有账号不需要显示 no credential
   * resolved from store」）。真正需要关注的失败（HTTP 非 2xx、网络异常）
   * 才记录。
   */
  async fetchModels(pool, force = false) {
    const cached2 = this.modelsCache;
    if (!force && cached2 !== void 0 && Date.now() - cached2.at < _TraeAuth.MODELS_CACHE_TTL_MS) {
      return cached2.models;
    }
    const models = await this.fetchModelsUncached(pool);
    this.modelsCache = { models, at: Date.now() };
    return models;
  }
  /** 真正发起一次拉取；日志与错误处理见 `fetchModels` 的注释。 */
  async fetchModelsUncached(pool) {
    let credential;
    if (pool) {
      const available = await pool.getAvailableAccount(this.product.id, "").catch(() => void 0);
      if (available) credential = available.credential;
    }
    if (credential === void 0) {
      const resolved = await this.ctx.credentials.resolve(credentialRef9(this.credentialRefName));
      if (!resolved) return [];
      credential = parseCredential2(resolved.value);
      if (credential === void 0) return [];
    }
    if (credential.access_token.length === 0) return [];
    try {
      const bodyObj = {
        functions: [
          "ui_builder_v2",
          "solo_coder",
          "chat_v3",
          "solo_builder",
          "builder_v3",
          "builder",
          "chat",
          "inline_chat",
          "git_ai",
          "custom_agent_generation",
          "utils",
          "code_reviewer",
          "code_review_summary",
          "solo_agent",
          "solo_agent_remote",
          "solo_work_remote",
          "solo_agent_lite",
          "solo_work_lite",
          "solo_design_lite",
          "solo_design_remote",
          "multimodal",
          "system_diagnosis"
        ],
        agent_type: "",
        current_config_info: { config_name: "", is_custom_model: false },
        mode_type: 0,
        access_type: 0,
        ab_force_vids: "",
        ab_autotest_advanced_mode: 0,
        show_custom_model: true
      };
      const url = `${this.product.agentHost}${TRAE_BATCH_MODELS_PATH}`;
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: traeSOLOHeaders(credential, this.product, false),
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(TRAE_REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        this.warn(`fetchModels: HTTP ${response.status} ${response.statusText}`);
        return [];
      }
      return parseTraeBatchModelList(await response.json());
    } catch (e) {
      this.warn(`fetchModels: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
  /** 记录一条警告（经 `ctx.logger`，**仅失败路径**调用）。 */
  warn(message) {
    this.ctx.logger?.warn?.(`[trae-auth] ${message}`);
  }
};

// src/backend/providers/trae.ts
function mountTrae(context) {
  const { ctx, pool, readImage } = context;
  const trae = new TraeAuth(ctx);
  const traeAdapter = registerTraeLlm(ctx, {
    ...pooledCredentials(context, TRAE, trae),
    catalogFile: context.catalogFile(TRAE.id),
    fetchRemoteModels: (force) => trae.fetchModels(pool, force),
    // 图片字节桥接：TRAE 上游支持图片（模态按模型判定），这里只负责读字节。
    readImage,
    accountPool: pool,
    product: TRAE
  });
  return { auth: trae, adapters: { [TRAE.id]: traeAdapter }, maintain: () => trae.refreshAll(pool) };
}

// src/backend/providers/pack-registry.ts
var MOUNTS = {
  qodercn: (context, options) => mountQoderCN(context, options.qoderCatalogFile),
  trae: (context) => mountTrae(context),
  raccoon: (context, options) => mountRaccoon(context, options.isRaccoonUnifiedModels)
};
var PACK_MOUNTS = CHANNEL_SPECS.filter((spec) => spec.kind === "pack" && spec.registered !== false && spec.accountPool !== false).map((spec) => {
  const mount = MOUNTS[spec.id];
  if (typeof mount !== "function") throw new Error(`\u8D26\u53F7\u6C60\u6E20\u9053 ${spec.id} \u5728\u89C4\u683C\u8868\u91CC\u767B\u8BB0\u4E86\uFF0C\u4F46 pack-registry \u6CA1\u6709\u5B83\u7684\u6302\u8F7D\u5B9E\u73B0`);
  const slot = spec.packSlot;
  if (typeof slot !== "string" || !VENDOR_SLOTS.includes(slot)) {
    throw new Error(`\u8D26\u53F7\u6C60\u6E20\u9053 ${spec.id} \u7684 packSlot \u65E0\u6548\uFF1A${String(slot)}\uFF08\u5FC5\u987B\u53D6\u81EA lib/pack-slots.js\uFF09`);
  }
  return { id: spec.id, slot, mount };
});
{
  const declared = new Set(PACK_MOUNTS.map((entry) => entry.id));
  const orphans = Object.keys(MOUNTS).filter((id) => !declared.has(id));
  if (orphans.length > 0) throw new Error(`pack-registry \u767B\u8BB0\u4E86\u89C4\u683C\u8868\u4E4B\u5916\u7684\u6E20\u9053\uFF1A${orphans.join("\u3001")}`);
  const slots = PACK_MOUNTS.map((entry) => entry.slot);
  if (new Set(slots).size !== slots.length) throw new Error("\u4E24\u4E2A\u8D26\u53F7\u6C60\u6E20\u9053\u5360\u7528\u4E86\u540C\u4E00\u4E2A vendor \u5F62\u53C2\u4F4D");
}

// src/backend.ts
import { join as join7 } from "node:path";
function makeReadImage(ctx) {
  return async (attachment) => {
    const attachments = ctx.get("attachments");
    if (attachments?.readImage === void 0) {
      throw new Error(
        "channel-pack: \u9644\u4EF6\u670D\u52A1\uFF08attachments\uFF09\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u628A\u56FE\u7247\u5185\u8054\u8FDB\u8BF7\u6C42\uFF1B\u8BF7\u786E\u8BA4\u5F53\u524D profile \u5DF2\u88C5\u8F7D @deepseek-ai/dsh-attachment-local\u3002"
      );
    }
    const stored = await attachments.readImage(attachment);
    return { data: stored.data, mediaType: stored.ref.mediaType };
  };
}
function makeReadImageRequest(ctx) {
  return async (attachment, target) => {
    const attachments = ctx.get("attachments");
    if (attachments?.readImageRequest === void 0) return void 0;
    try {
      const projected = await attachments.readImageRequest(attachment, target);
      const mediaType = projected.mediaType ?? projected.attachment?.mediaType;
      if (mediaType === void 0) return void 0;
      return { data: projected.data, mediaType };
    } catch (error) {
      ctx.logger?.warn?.(
        `[channel-pack] \u56FE\u7247\u8BF7\u6C42\u7248\u672C\u6D3E\u751F\u5931\u8D25\uFF0C\u56DE\u9000\u539F\u56FE\uFF1A${error instanceof Error ? error.message : String(error)}`
      );
      return void 0;
    }
  };
}
function mountBackend(ctx, onRpc, options = {}) {
  const pool = new AccountPool(ctx, options.quotaAccountOrder, (provider, accountId, model) => {
    if (provider === "trae" || provider === "qodercn") options.noteQuotaAccount?.(provider, accountId, model);
  });
  const wrapImagePreference = (adapter) => {
    if (typeof adapter?.listModels !== "function") return adapter;
    const original = adapter.listModels.bind(adapter);
    return new Proxy(adapter, {
      get(target, prop, receiver) {
        if (prop !== "listModels") return Reflect.get(target, prop, receiver);
        return async (provider) => {
          const models = await original(provider);
          if (!Array.isArray(models)) return models;
          return models.map((model) => {
            try {
              const pref = pool.modelParamsFor(provider, model.id)?.supportsImage;
              if (pref === void 0 || !Array.isArray(model.inputModalities)) return model;
              const rest = model.inputModalities.filter((m) => m !== "image");
              return { ...model, inputModalities: pref ? [...rest, "image"] : rest };
            } catch {
              return model;
            }
          });
        };
      }
    });
  };
  const patchAdapterContext = (adapter) => {
    if (!adapter || typeof adapter.resolveModel !== "function") return adapter;
    const original = adapter.resolveModel.bind(adapter);
    adapter.resolveModel = async (...args) => {
      const info = await original(...args);
      try {
        const override = pool.modelParamsFor(args[0], args[1]);
        if (!info || override === void 0) return info;
        const next = {
          ...info,
          ...override.contextWindow === void 0 ? {} : { context: { ...info.context, contextWindow: override.contextWindow } },
          ...override.maxTokens === void 0 ? {} : { defaultMaxTokens: override.maxTokens }
        };
        const effort = override.reasoningEffort;
        const efforts = next.reasoning?.efforts;
        if (effort === void 0 || !Array.isArray(efforts)) return next;
        if (!efforts.some((item) => String(item?.id) === effort)) return next;
        return { ...next, reasoning: { ...next.reasoning, defaultEffort: effort } };
      } catch {
        return info;
      }
    };
    return adapter;
  };
  const accountForRefresh = async (provider, accountId) => {
    if (accountId === void 0) return pool.getAvailableAccount(provider, "");
    const entry = pool.listAccountsByProvider(provider).find((account) => account.id === accountId);
    if (entry === void 0) throw new LlmError10(`${provider}: \u5F53\u524D\u8BF7\u6C42\u7684\u8D26\u53F7\u5DF2\u79FB\u9664`, "MISSING_CREDENTIAL");
    return { entry };
  };
  configureDeadModelStore(ctx);
  const tokenLedgerStore = createTokenLedgerStore(ctx);
  const detachTokenLedger = attachTokenLedgerStore(tokenLedgerStore);
  ctx.effect(() => () => {
    try {
      tokenLedgerStore.flush();
    } finally {
      detachTokenLedger();
    }
  }, "token-ledger-persistence");
  const throwIfAllAccountsRateLimited = (product, modelId, entries) => {
    const limited = allAccountsRateLimitedForModel(
      // 只统计**启用**账号：停用账号本就不参与自动选号，把它们算进来会
      // 让「有一个号被停用」的普通情况被误报成「全部限流」。
      (entries ?? pool.listAccountsByProvider(product.id)).filter((a) => a.enabled),
      modelId ?? ""
    );
    if (limited === void 0) return;
    throw new LlmError10(
      `${product.displayName}\uFF1A\u6A21\u578B ${modelId} \u7684\u53EF\u7528\u8D26\u53F7\u5747\u5728\u9650\u6D41\u4E2D\uFF0C\u6700\u8FD1\u4E00\u4E2A\u5C06\u4E8E ${new Date(limited.resetAtMs).toLocaleString("zh-CN")} \u89E3\u7981\u3002\u53EF\u6539\u7528\u5176\u5B83 provider / \u6A21\u578B\uFF0C\u6216\u7B49\u5F85\u89E3\u7981\u540E\u518D\u8BD5\uFF08\u65E0\u9700\u91CD\u65B0\u767B\u5F55\uFF09\u3002`,
      "QUOTA_EXCEEDED"
    );
  };
  const providerContext = {
    ctx,
    pool,
    accountForRefresh,
    throwIfAllAccountsRateLimited,
    noteQuotaAccount: options.noteQuotaAccount,
    readImage: makeReadImage(ctx),
    readImageRequest: makeReadImageRequest(ctx),
    catalogFile: (provider) => options.catalogDir && join7(options.catalogDir, `${provider}-catalog.json`)
  };
  const mounted = PACK_MOUNTS.map((entry) => ({
    entry,
    result: entry.mount(providerContext, {
      qoderCatalogFile: options.qoderCatalogFile,
      isRaccoonUnifiedModels: options.isRaccoonUnifiedModels
    })
  }));
  const providers = mounted.map((item) => item.result);
  const modelAdapters = Object.fromEntries(providers.flatMap((provider) => Object.entries(provider.adapters).map(([id, adapter]) => [id, wrapImagePreference(withDeadModelPruning([id], patchAdapterContext(adapter)))])));
  const allowedProviders = Object.keys(modelAdapters);
  const slots = Object.fromEntries(mounted.map((item) => [item.entry.slot, item.result.auth]));
  const subscriptionAuth = mounted.find((item) => item.result.subscriptionAuth !== void 0)?.result.subscriptionAuth;
  registerPackRpc(ctx, pool, slots, modelAdapters, {
    nativeOnly: true,
    allowedProviders,
    onRpc,
    ...subscriptionAuth === void 0 ? {} : { raccoonPro: subscriptionAuth }
  });
  try {
    const llm = ctx.get?.("llm");
    if (llm && typeof llm.listModels === "function" && !llm.__unifiedRouterImagePatched) {
      const baseListModels = llm.listModels.bind(llm);
      const managed = new Set(allowedProviders);
      llm.listModels = async (provider) => {
        const models = await baseListModels(provider);
        if (!managed.has(provider) || !Array.isArray(models)) return models;
        return models.map((model) => {
          try {
            const pref = pool.modelParamsFor(provider, model.id)?.supportsImage;
            if (pref === void 0 || !Array.isArray(model.inputModalities)) return model;
            const rest = model.inputModalities.filter((m) => m !== "image");
            return { ...model, inputModalities: pref ? [...rest, "image"] : rest };
          } catch {
            return model;
          }
        });
      };
      llm.__unifiedRouterImagePatched = true;
    }
  } catch {
  }
  ctx.provide("unifiedRouterPool", pool);
  const maintenance = /* @__PURE__ */ new Set();
  const timer = setInterval(() => {
    for (const provider of providers) {
      if (maintenance.has(provider)) continue;
      maintenance.add(provider);
      void provider.maintain().catch(() => {
      }).finally(() => maintenance.delete(provider));
    }
  }, 6e4);
  timer.unref?.();
  ctx.effect(() => () => clearInterval(timer));
  return pool;
}
export {
  makeReadImage,
  makeReadImageRequest,
  mergeUnifiedRaccoonCatalogs,
  mountBackend
};
