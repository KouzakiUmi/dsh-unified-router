# 发布与发布流程

> 面向维护者：CI 与版本发布工作流的实际行为。两个工作流的源码是 [ci.yml](../.github/workflows/ci.yml) 与 [release.yml](../.github/workflows/release.yml)，本文按其实际步骤与校验规则描述。

## CI：触发与步骤

[`ci.yml`](../.github/workflows/ci.yml) 在**推送到 `main` / `master`** 或**提交 Pull Request** 时触发，工作流权限为 `contents: read`，单个 job 超时 15 分钟，运行在 `ubuntu-latest`。

步骤依次为：

1. **检出代码**：`actions/checkout@v4`，`persist-credentials: false`。
2. **准备运行时**：`actions/setup-node@v4`，`node-version: 22`。
3. **安装开发依赖**：`npm install --no-audit --no-fund --legacy-peer-deps`。peer 依赖由宿主提供，本地不安装，因此使用 `--legacy-peer-deps`。
4. **构建并运行测试**：`npm test`（先 `node scripts/build.mjs` 再跑全部测试）。
5. **产物语法检查**：`node --check lib/web-host.js` 与 `node --check lib/backend.js`。
6. **打包并校验发布产物**：`npm pack --ignore-scripts --json > pack.json`，随后用内联 Node 脚本校验，规则见下文「打包校验规则」。校验通过后把 tarball 复制为 `dist/dsh-unified-router.tgz`。
7. **上传构建产物**：仅当事件为 push 且分支是 `refs/heads/main` 时，用 `actions/upload-artifact@v4` 上传 `dist/dsh-unified-router.tgz`，artifact 名为 `build-package`，`if-no-files-found: error`，保留 7 天。

分支推送与 Pull Request 只运行 CI，不产生 Release、不发布 npm。

## 版本标签流程

[`release.yml`](../.github/workflows/release.yml) 只在**推送匹配 `v[0-9]*.[0-9]*.[0-9]*` 的标签**时触发。`release` job 使用 `environment: npm`、超时 20 分钟，权限为 `contents: write` 与 `id-token: write`，并通过并发组 `release-dsh-unified-router` 串行化（`cancel-in-progress: false`），避免多次发布互相覆盖。

流程：

1. **检出代码**与**准备 Node 22 运行时**。
2. **校验标签与包版本一致**：读取 `package.json` 的 `version`，要求 `github.ref_name` 等于 `v` 加该版本号，不一致直接失败。
3. **安装开发依赖**与**构建并运行测试**：与 CI 相同的两条命令。
4. **打包并校验发布产物**：与 CI 相同的校验脚本。
5. **写校验和**：`(cd dist && sha256sum dsh-unified-router.tgz > dsh-unified-router.tgz.sha256)`。
6. **创建版本化 GitHub Release**：`softprops/action-gh-release@v2`，`tag_name` 为当前标签，`target_commitish` 为当前提交，上传 `dist/dsh-unified-router.tgz` 与 `dist/dsh-unified-router.tgz.sha256` 两个资产，`fail_on_unmatched_files: true`，`generate_release_notes: true`，`make_latest: legacy`（由 GitHub 按版本与发布时间判定 latest）。
7. **可选 npm 发布**：见下节。

发布前由维护者在本地完成版本号与说明的更新，再推送标签：

```console
git tag vX.Y.Z
git push origin vX.Y.Z
```

标签必须等于 `v` 加 `package.json` 的 `version`。

## 打包校验规则

CI 与 release 工作流使用同一段内联校验脚本，对 `npm pack --ignore-scripts --json` 的输出逐项检查，任何一项不满足即失败：

| 检查项 | 规则 |
|---|---|
| 包数量 | 必须恰好一个包 |
| 包名与版本 | 包名必须是 `dsh-unified-router`，版本号匹配 `^\d+\.\d+\.\d+(-[\w.]+)?$` |
| tarball 文件名 | 文件名不能含路径分隔符，且必须等于 `dsh-unified-router-<版本>.tgz` |
| 必须包含的文件 | `package.json`、`README.md`、`LICENSE`、`NOTICE.md`、`cordis.patch.yml`、`lib/web-host.js`、`lib/client.js`、`lib/backend.js`、`lib/qoder-auth-wasm.wasm`、`vendor/sensenova-token-plan/index.js`、`vendor/workbuddy/index.mjs`、`vendor/channel-pack/LICENSE` |
| 必须排除的文件 | 任何位于 `src/`、`test/`、`scripts/` 下的文件，任何 `*.tgz`，任何 `*.log` |

`package.json` 的 `files` 白名单是打包内容的来源，改动发布内容时同步更新该白名单。

## 可选：npm 发布

npm 发布是**可选**步骤，由仓库变量 `PUBLISH_NPM` 控制：只有当 `vars.PUBLISH_NPM == 'true'` 时，工作流才安装 Node 24 运行时并执行发布步骤；未开启时只产出 GitHub Release。

发布使用 **GitHub OIDC Trusted Publishing**，绑定本工作流：

- job 声明 `id-token: write`，`environment: npm`；npm 侧的信任绑定（owner、repository、workflow filename `release.yml`）须与本工作流一致。
- 发布脚本显式指定公共 registry `https://registry.npmjs.org/`，不生成空的令牌认证项；身份令牌由 GitHub 自动提供，不写入日志或仓库。
- 发布前先查 registry：`npm view <包名>@<版本> version --json --prefer-online`。**已存在该版本则跳过发布**；registry 返回非 `E404` 的错误则直接失败，不尝试发布。
- 发布命令为 `npm publish ./dist/dsh-unified-router.tgz --access public --ignore-scripts --json`。
- 发布后核验可见性：每 10 秒查询一次，最多 31 次；读到该版本即成功，期间出现非 `E404` 错误则停止并失败。窗口耗尽仍读不到版本时，脚本以「发布核验失败」结束，此时先到 registry 核对实际状态，再决定是否重跑原标签的工作流。

## 固定下载地址

GitHub Release 的资产名固定为 `dsh-unified-router.tgz`，配套校验和资产为 `dsh-unified-router.tgz.sha256`。版本号由**标签**携带，因此固定下载地址按标签拼出：

```
https://github.com/KouzakiUmi/dsh-unified-router/releases/download/v<版本>/dsh-unified-router.tgz
```

`npm pack` 生成的 tarball 文件名带版本号（`dsh-unified-router-<版本>.tgz`），工作流在重命名上传前校验该文件名。

## 发布前清单

1. **版本号**：更新 `package.json` 的 `version`，版本号满足语义化格式（工作流校验 `^\d+\.\d+\.\d+(-[\w.]+)?$`）。
2. **更新记录**：在 [changelog.md](changelog.md) 增补本次变更条目。
3. **包内容**：执行 `npm pack --dry-run` 检查打包内容与 `package.json` 的 `files` 白名单一致；确认 `src/`、`test/`、`scripts/`、`*.tgz`、`*.log` 未进入包内。
4. **标签**：推送 `vX.Y.Z` 标签，标签必须与 `package.json` 版本一致。
5. **npm（可选）**：确认仓库变量 `PUBLISH_NPM` 的取值与 npm Trusted Publisher 绑定（owner、repository、workflow filename）一致。
6. **回归**：`npm test` 全绿，`node --check` 三份产物通过后再推送标签。

本地测试通过不等于已发布；发布结果以标签对应的 Actions 状态、GitHub Release 资产与 npm registry 的实际返回为准。
