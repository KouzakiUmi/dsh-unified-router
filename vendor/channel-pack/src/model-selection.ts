/** 用户显式启停优先，缺少覆盖时跟随当前目录的推荐。 */
export function isModelDisabled(
  model: { id: string; stale?: boolean },
  overrides: Readonly<Record<string, boolean>>,
  exclusions?: ReadonlyMap<string, unknown>,
): boolean {
  const override = overrides[model.id]
  return typeof override === 'boolean' ? override : model.stale === true || exclusions?.has(model.id) === true
}
