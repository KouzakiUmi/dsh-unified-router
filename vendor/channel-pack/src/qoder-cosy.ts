/**
 * Qoder COSY 请求签名（**移植自 MIT 许可的公开实现**）。
 *
 * ## 为什么不自己逆向 WASM
 *
 * 本插件原先的判断是「COSY 签名在专有 Rust WASM 里，重实现等于提取密钥」。
 * 该判断的事实基础已变：`dsh-qoder-connect`（MIT）与上游 `qoder2api`（MIT）
 * 都已公开这套协议 —— 设备指纹派生、RSA 临时密钥、AES-CBC 身份载荷、请求签名
 * 与自定义字母表编码。这里是**按公开算法移植**，没有从 WASM 提取任何密钥。
 *
 * ## 为什么需要它
 *
 * `qoderclicn --list-models` 只给「显示名」或「显示名 (key)」，**对部分条目只给
 * 显示名**；而真实目录接口返回每条的 `key` / `display_name` / `price_factor` /
 * `thinking_config`。实测对照：
 *
 * | 显示名 | CLI 给的 id | 真实 key |
 * |---|---|---|
 * | Qwen4-Max | `Qwen4-Max`（错，会回落默认模型） | `qmodel_latest` |
 * | GLM-5.4 | `GLM-5.4`（错） | `gmodel_latest` |
 * | Step-5-Preview | `Step-5-Preview`（错） | `jmodel` |
 *
 * 拿显示名当 `model` 发请求时服务端回落默认模型，**一帧 `reasoning_content`
 * 都不返回** —— 这就是用户报障「Qoder 思考设置无效」的根因。改用真实 key 后
 * 实测：`qmodel_latest` 20/37 帧、`jmodel` 64/79 帧、`gmodel_latest`（max 档
 * 423/540 帧）都有思考。
 *
 * @module dsh-unified-router/qoder-cosy
 */
import { createCipheriv, createHash, constants, publicEncrypt, randomBytes } from 'node:crypto'

/** 协议版本（客户端 1.0.10 实测）。 */
export const COSY_VERSION = '1.0.10'
const APP_CODE = 'cosy'
const SECRET_B64 = 'd2FyLCB3YXIgbmV2ZXIgY2hhbmdlcw=='
const SEP = '&'
/** 服务端公钥（公开算法的一部分，不是本机密钥）。 */
const SERVER_PUB_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`

const md5Hex = (s: string) => createHash('md5').update(s).digest('hex')

const deriveID = (seed: string, salt: string, installSalt = '') =>
  md5Hex(`${salt}:${installSalt ? `${seed}|salt:${installSalt}` : seed}`)

/** 设备指纹：机器 id（`uid` 派生）。 */
export const deriveMachineId = (seed: string, installSalt = '') => deriveID(seed, 'machine', installSalt)
/** 设备类型（取 18 位）。 */
export const deriveMachineType = (seed: string, installSalt = '') => deriveID(seed, 'machinetype', installSalt).slice(0, 18)
/** 设备令牌（base64url 前 43 位）。 */
export const deriveMachineToken = (seed: string, installSalt = '') =>
  createHash('sha512').update(`machinetoken:${installSalt ? `${seed}|salt:${installSalt}` : seed}`).digest()
    .toString('base64url').slice(0, 43)

/** 旧版签名（`cosy-key` 派生用；接口请求并不发送它，保留对齐协议）。 */
export const signLegacy = (date: string) => md5Hex(`${APP_CODE}${SEP}${SECRET_B64}${SEP}${date}`)

const aesCbcEncrypt = (plain: Buffer, key: Buffer): Buffer => {
  // PKCS7 补齐，IV = key 前 16 字节（与 Go 实现一致）。
  const pad = 16 - (plain.length % 16)
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)])
  const cipher = createCipheriv('aes-128-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padded), cipher.final()])
}

const newUUID = (): string => {
  const hex = randomBytes(16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** 签名所需的身份字段（来自凭据，**不落盘、不进日志**）。 */
export interface CosyIdentity {
  uid: string
  securityOauthToken: string
  refreshToken?: string
}

/** 一次签名会话（同一凭据可复用；令牌轮换后需重建）。 */
export interface CosySession {
  uid: string
  info: string
  cosyKey: string
  machineId: string
  machineType: string
  machineToken: string
}

/** 建立签名会话（RSA 临时密钥 + AES-CBC 身份载荷）。 */
export function newCosySession(identity: CosyIdentity): CosySession {
  const tempKey = randomBytes(8).toString('hex')
  const cosyKey = publicEncrypt(
    { key: SERVER_PUB_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(tempKey, 'utf8'),
  ).toString('base64')
  const payload = JSON.stringify({
    name: '', aid: '', uid: identity.uid, yx_uid: '',
    organization_id: '', organization_name: '', user_type: '',
    security_oauth_token: identity.securityOauthToken,
    refresh_token: identity.refreshToken ?? '',
  })
  const info = aesCbcEncrypt(Buffer.from(payload, 'utf8'), Buffer.from(tempKey, 'utf8')).toString('base64')
  const seed = identity.uid
  return {
    uid: identity.uid, info, cosyKey,
    machineId: deriveMachineId(seed),
    machineType: deriveMachineType(seed),
    machineToken: deriveMachineToken(seed),
  }
}

/** 路径签名：去掉 `/algo` 前缀后的 pathname。 */
export const pathSigOf = (rawUrl: string): string => {
  const url = new URL(rawUrl)
  return url.pathname.startsWith('/algo') ? url.pathname.slice(5) : url.pathname
}

/** 请求签名：`md5(payloadB64\n cosyKey\n date\n body\n pathSig)`。 */
export const signRequest = (payloadB64: string, cosyKey: string, cosyDate: string, body: string, pathSig: string) =>
  md5Hex(`${payloadB64}\n${cosyKey}\n${cosyDate}\n${body}\n${pathSig}`)

/**
 * 构造一次请求的鉴权头。
 *
 * @param session `newCosySession` 的结果。
 * @param fullUrl 完整请求地址（签名覆盖其 pathname）。
 * @param body 请求体原文（GET 传空串）；**签名覆盖它，改体必须重签**。
 * @param accept `Accept` 头。
 */
export function cosyHeaders(session: CosySession, fullUrl: string, body: string, accept = 'application/json'): Record<string, string> {
  const payloadB64 = Buffer.from(JSON.stringify({
    cosyVersion: COSY_VERSION, ideVersion: '', info: session.info, requestId: newUUID(), version: 'v1',
  }), 'utf8').toString('base64')
  const date = String(Math.floor(Date.now() / 1000))
  const sig = signRequest(payloadB64, session.cosyKey, date, body, pathSigOf(fullUrl))
  return {
    'cosy-data-policy': 'agree',
    'content-type': 'application/json',
    'cosy-machinetype': session.machineType,
    'cosy-clienttype': '5',
    'cosy-date': date,
    'cosy-user': session.uid,
    'cosy-key': session.cosyKey,
    'cache-control': 'no-cache',
    accept,
    authorization: `Bearer COSY.${payloadB64}.${sig}`,
    'cosy-version': COSY_VERSION,
    'cosy-machineid': session.machineId,
    'cosy-machinetoken': session.machineToken,
    'login-version': 'v2',
    'user-agent': 'Go-http-client/2.0',
    'cosy-scene': 'assistant',
    'cosy-business-product': 'ide',
    'cosy-business-type': 'agent',
  }
}