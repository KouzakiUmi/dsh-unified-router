// 设置页样式：所有颜色都先走宿主语义变量（--dsw-*）；
// 本地亮色/暗色只承担无宿主变量时的回退（系统色彩媒体查询 + 显式
// light/dark、data-theme、data-color-scheme 选择器）。
//
// 排版约定（改这里之前先读）：
// 1. 颜色 / 间距 / 圆角 / 字阶**只用本文件的变量**，业务分支里不写魔法值；
// 2. 间距走 4/8 网格（--eac-s1…--eac-s6），字号只用 --eac-fs-*；
// 3. 强调色只有一个（--eac-accent），状态色只表达真实语义，不做装饰底色；
// 4. 重复条目用**列表**（.eac-row-item / .eac-model 的紧凑形态），不叠卡片；
// 5. 动效只碰 opacity / transform / 颜色，并响应对 reduced-motion 的关闭。
export const CLIENT_STYLES = `
:where(.eac-settings,.eac-context-pill,.eac-quota-pill){
  --eac-surface:var(--dsw-alias-bg-layer-1,#fff);--eac-subtle:color-mix(in srgb,currentColor 4%,transparent);
  --eac-hover:color-mix(in srgb,currentColor 7%,transparent);--eac-text:var(--dsw-alias-label-primary,CanvasText);
  --eac-muted:color-mix(in srgb,currentColor 66%,transparent);--eac-faint:color-mix(in srgb,currentColor 50%,transparent);
  --eac-border:color-mix(in srgb,currentColor 20%,transparent);--eac-divider:color-mix(in srgb,currentColor 12%,transparent);
  --eac-accent:#3b82f6;--eac-on-accent:#fff;
  --eac-success:#22c55e;--eac-warn:#eab308;--eac-danger:#ef4444;--eac-shadow:0 1px 2px rgba(16,24,40,.04);
  --eac-s1:4px;--eac-s2:8px;--eac-s3:12px;--eac-s4:16px;--eac-s5:24px;--eac-s6:32px;
  --eac-r-sm:8px;--eac-r:12px;--eac-r-lg:14px;
  --eac-r-pill:999px;--eac-segment-gap:1px;--eac-segment-pad:2px;--eac-segment-inline:7px;--eac-fs-segment:11px;
  --eac-segment-border:rgba(128,128,128,.3);--eac-segment-selected:color-mix(in srgb,#3b82f6 16%,transparent);
  --eac-context-tip-gap:6px;--eac-context-tip-width:260px;--eac-context-tip-layer:50;
  --eac-quota-width:340px;--eac-quota-height:520px;--eac-quota-min-height:26px;
  --eac-quota-shadow:0 12px 32px rgba(0,0,0,.28);
  --eac-fs-xs:11px;--eac-fs-sm:12px;--eac-fs:13px;--eac-fs-lg:15px;--eac-fs-xl:20px;
  --eac-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
.eac-settings{
  position:relative;display:flex;flex-direction:column;gap:var(--eac-s4);width:100%;max-width:1040px;margin:0 auto;padding:var(--eac-s2) 2px var(--eac-s6);
  min-width:0;box-sizing:border-box;container-type:inline-size;container-name:eac;color:var(--eac-text);color-scheme:light;font-size:var(--eac-fs);line-height:1.55;
}
.eac-settings *{box-sizing:border-box}
.eac-settings button,.eac-settings input{font:inherit}
.eac-settings button{touch-action:manipulation}
.eac-settings :focus-visible{outline:2px solid var(--eac-accent);outline-offset:2px}
.eac-settings input::placeholder{color:var(--eac-faint);opacity:1}
.eac-settings h2,.eac-settings h3,.eac-settings p{margin:0}

/* ---------- 页头 ---------- */
.eac-header{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);min-width:0;padding:var(--eac-s2) 0 var(--eac-s3);flex-wrap:wrap}
.eac-title{margin:0;font-size:var(--eac-fs-xl);font-weight:690;line-height:1.25;letter-spacing:-.02em}
.eac-header-actions{display:flex;align-items:center;gap:var(--eac-s2);flex:none}

/* ---------- 按钮 ---------- */
.eac-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 11px;border:1px solid var(--eac-border);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-text);cursor:pointer;font-size:var(--eac-fs-sm);font-weight:560;line-height:1.4;text-decoration:none;white-space:nowrap;transition:background .14s ease,border-color .14s ease,color .14s ease}
.eac-button:hover:not(:disabled){border-color:color-mix(in srgb,var(--eac-accent) 40%,var(--eac-border));background:var(--eac-subtle)}
.eac-button:active:not(:disabled){transform:translateY(.5px)}
.eac-button:disabled{opacity:.45;cursor:not-allowed}
.eac-button.is-primary{border-color:var(--eac-accent);background:var(--eac-accent);color:var(--eac-on-accent);font-weight:500}
.eac-button.is-primary:hover:not(:disabled){background:var(--eac-accent);filter:brightness(1.06);border-color:var(--eac-accent)}
.eac-button.is-danger{border-color:transparent;background:transparent;color:var(--eac-danger);box-shadow:none}
.eac-button.is-danger:hover:not(:disabled){border-color:color-mix(in srgb,var(--eac-danger) 40%,var(--eac-border));background:color-mix(in srgb,var(--eac-danger) 8%,var(--eac-surface))}
.eac-button.is-quiet{border-color:transparent;background:transparent;color:var(--eac-muted)}
.eac-button.is-quiet:hover:not(:disabled){border-color:var(--eac-border);background:var(--eac-surface);color:var(--eac-text)}
.eac-link{padding:0;border:0;background:none;color:var(--eac-muted);cursor:pointer;font-size:var(--eac-fs-sm);font-weight:560;text-decoration:none;transition:color .14s ease}
.eac-link:hover:not(:disabled){color:var(--eac-accent)}
.eac-link:disabled{opacity:.45;cursor:not-allowed}
.eac-link.is-danger:hover:not(:disabled){color:var(--eac-danger)}

/* ---------- 渠道 tab ---------- */
/* 渠道选择器：**小卡片网格**（自动换行），不用横向滚动条 —— 滚动条挡住了半个渠道，
   而且藏起来的渠道要用户去猜（用户报障「最上面是左右拖动的滚动条，很难看」）。 */
.eac-provider-groups{display:flex;flex-direction:column;gap:var(--eac-s2)}
.eac-provider-group{display:flex;flex-direction:column;gap:var(--eac-s1)}
.eac-provider-group-title{font-size:var(--eac-fs-xs);font-weight:620;letter-spacing:.04em;color:var(--eac-faint);padding:0 2px}
.eac-providers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--eac-s1);padding:0 0 var(--eac-s1)}
.eac-provider{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;min-height:46px;padding:6px var(--eac-s3);border:1px solid var(--eac-border);border-radius:var(--eac-r);background:var(--eac-surface);color:var(--eac-muted);cursor:pointer;text-align:left;transition:background .14s ease,color .14s ease,border-color .14s ease}
.eac-provider:hover{background:var(--eac-subtle);color:var(--eac-text)}
.eac-provider[aria-selected=true]{border-color:color-mix(in srgb,var(--eac-accent) 55%,var(--eac-border));background:color-mix(in srgb,var(--eac-accent) 9%,var(--eac-surface));color:var(--eac-text);box-shadow:0 0 0 1px color-mix(in srgb,var(--eac-accent) 18%,transparent)}
.eac-provider[aria-selected=true] .eac-provider-name{color:var(--eac-accent)}
.eac-provider[aria-selected=true] .eac-provider-meta{color:var(--eac-muted)}
.eac-provider[aria-selected=true] .eac-provider-mark{background:var(--eac-accent);color:var(--eac-on-accent)}
.eac-provider-name{font-size:var(--eac-fs-sm);font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eac-provider-meta{display:flex;align-items:center;gap:5px;color:var(--eac-faint);font-size:var(--eac-fs-xs);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eac-provider-dot{width:5px;height:5px;flex:none;border-radius:50%;background:var(--eac-faint)}
.eac-provider-dot[data-tone=success]{background:var(--eac-success)}
.eac-provider-dot[data-tone=warn]{background:var(--eac-warn)}

/* ---------- 工作区 ---------- */
.eac-workspace{display:flex;flex-direction:column;min-width:0;padding:var(--eac-s3) var(--eac-s4) var(--eac-s5);border:1px solid var(--eac-divider);border-radius:var(--eac-r);background:var(--eac-subtle)}
.eac-panels{display:flex;align-items:center;gap:2px;min-height:36px;border-bottom:1px solid var(--eac-divider)}
.eac-panel-tab{align-self:stretch;display:inline-flex;align-items:center;gap:6px;margin:0 0 -1px;padding:6px 12px;border:0;border-bottom:2px solid transparent;border-radius:8px 8px 0 0;background:transparent;color:inherit;opacity:.68;cursor:pointer;font-size:var(--eac-fs);font-weight:500;white-space:nowrap;transition:opacity .14s ease,border-color .14s ease,background .14s ease}
.eac-panel-tab:hover{opacity:.95;background:var(--eac-subtle)}
.eac-panel-tab[aria-selected=true]{opacity:1;border-bottom-color:var(--eac-accent);font-weight:600}
.eac-panel-tab[aria-selected=true] .eac-tab-badge{background:color-mix(in srgb,var(--eac-accent) 14%,transparent);color:var(--eac-accent)}
.eac-panel-body{display:flex;flex-direction:column;gap:14px;padding:var(--eac-s4) 0 0;min-width:0}

/* ---------- 分区骨架 ---------- */
.eac-section{display:flex;flex-direction:column;gap:8px;min-width:0}
.eac-section+.eac-section{padding-top:var(--eac-s2)}
.eac-section-head{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);min-width:0;min-height:24px}
.eac-section-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.eac-section-title{margin:0;font-size:12px;font-weight:600;line-height:1.4;letter-spacing:.01em;opacity:.72}
.eac-section-actions{display:flex;align-items:center;gap:var(--eac-s2);flex:none;flex-wrap:wrap;justify-content:flex-end}
.eac-summary{display:flex;align-items:center;gap:var(--eac-s2);flex-wrap:wrap;color:var(--eac-muted);font-size:var(--eac-fs-sm);font-variant-numeric:tabular-nums;min-width:0}
.eac-summary strong{color:var(--eac-text);font-weight:640}
.eac-muted{margin:0;color:var(--eac-muted);font-size:var(--eac-fs-sm);line-height:1.5;overflow-wrap:anywhere}
.eac-group{display:flex;flex-direction:column;gap:var(--eac-s2);min-width:0}
.eac-group-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--eac-s3);flex-wrap:wrap}
.eac-group-title{display:flex;align-items:center;gap:var(--eac-s2);margin:0;color:var(--eac-text);font-size:var(--eac-fs-sm);font-weight:640;letter-spacing:.01em}
.eac-group-actions{display:flex;align-items:center;gap:var(--eac-s2);flex-wrap:wrap}

/* ---------- 标签 ---------- */
.eac-tag{display:inline-flex;align-items:center;padding:1px 6px;border:1px solid var(--eac-divider);border-radius:999px;background:var(--eac-subtle);color:var(--eac-muted);font-size:var(--eac-fs-xs);font-weight:570;line-height:1.6;white-space:nowrap}
.eac-tag[data-tone=success]{border-color:color-mix(in srgb,var(--eac-success) 30%,var(--eac-divider));background:color-mix(in srgb,var(--eac-success) 10%,var(--eac-surface));color:var(--eac-success)}
.eac-tag[data-tone=warn]{border-color:color-mix(in srgb,var(--eac-warn) 32%,var(--eac-divider));background:color-mix(in srgb,var(--eac-warn) 10%,var(--eac-surface));color:var(--eac-warn)}
.eac-tag[data-tone=error]{border-color:color-mix(in srgb,var(--eac-danger) 32%,var(--eac-divider));background:color-mix(in srgb,var(--eac-danger) 10%,var(--eac-surface));color:var(--eac-danger)}
.eac-tag[data-tone=info]{border-color:color-mix(in srgb,var(--eac-accent) 28%,var(--eac-divider));background:color-mix(in srgb,var(--eac-accent) 8%,var(--eac-surface));color:var(--eac-accent)}
.eac-status-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid var(--eac-divider);border-radius:999px;background:var(--eac-subtle);color:var(--eac-muted);font-size:var(--eac-fs-xs);font-weight:580;line-height:1.6;white-space:nowrap}
.eac-status-chip::before{content:"";width:5px;height:5px;flex:none;border-radius:50%;background:currentColor}
.eac-status-chip[data-tone=success]{color:var(--eac-success);border-color:color-mix(in srgb,var(--eac-success) 28%,var(--eac-divider))}
.eac-status-chip[data-tone=warn]{color:var(--eac-warn);border-color:color-mix(in srgb,var(--eac-warn) 30%,var(--eac-divider))}
.eac-status-chip[data-tone=error]{color:var(--eac-danger);border-color:color-mix(in srgb,var(--eac-danger) 30%,var(--eac-divider))}

/* ---------- 提示条 ---------- */
.eac-notice{display:flex;align-items:center;gap:var(--eac-s2);padding:var(--eac-s2) var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-accent) 28%,transparent);border-radius:10px;background:color-mix(in srgb,var(--eac-accent) 10%,transparent);color:var(--eac-text);font-size:var(--eac-fs-sm);overflow-wrap:anywhere}
.eac-notice p{margin:0;min-width:0;flex:1}
.eac-notice-close{padding:0;border:0;background:none;color:var(--eac-muted);cursor:pointer;font-size:14px;line-height:1;flex:none}
.eac-notice-close:hover{color:var(--eac-text)}
.eac-callout{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);flex-wrap:wrap;padding:var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-accent) 28%,transparent);border-radius:12px;background:color-mix(in srgb,var(--eac-accent) 8%,transparent)}
.eac-callout-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 220px}
.eac-callout-title{margin:0;font-size:var(--eac-fs);font-weight:620}
.eac-callout-url{margin:0;color:var(--eac-faint);font-family:var(--eac-mono);font-size:var(--eac-fs-xs);line-height:1.5;overflow-wrap:anywhere}
.eac-callout-actions{display:flex;align-items:center;gap:var(--eac-s2);flex-wrap:wrap}
.eac-model-reason{margin:0;color:var(--eac-warn);font-size:var(--eac-fs-sm);line-height:1.5;overflow-wrap:anywhere}
.eac-empty{margin:0;padding:var(--eac-s5) var(--eac-s4);border:1px dashed var(--eac-border);border-radius:var(--eac-r);color:var(--eac-muted);text-align:center;font-size:var(--eac-fs-sm)}

/* ---------- 账号列表 ---------- */
.eac-list-box{display:flex;flex-direction:column;border:1px solid var(--eac-border);border-radius:var(--eac-r);background:var(--eac-surface);overflow:hidden}
.eac-row-item{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto) auto auto;grid-template-areas:"main metric switch more";align-items:center;gap:var(--eac-s2) var(--eac-s3);padding:var(--eac-s3) var(--eac-s4);border-top:1px solid var(--eac-divider);transition:background .14s ease}
.eac-row-item > .eac-row-main{grid-area:main}.eac-row-item > .eac-switch{grid-area:switch}.eac-row-controls{grid-area:more;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:var(--eac-s2)}
.eac-row-metric{grid-area:metric;min-width:0;display:grid;gap:var(--eac-s1)}
.eac-remaining{display:block;appearance:none;width:100%;height:var(--eac-s1);border:0;border-radius:999px;background:var(--eac-divider);color:var(--eac-accent);overflow:hidden}
.eac-remaining[data-low=true]{color:var(--eac-warn)}
.eac-remaining::-webkit-progress-bar{background:var(--eac-divider)}
.eac-remaining::-webkit-progress-value{background:currentColor}
.eac-remaining::-moz-progress-bar{background:currentColor}
.eac-usage-list{display:grid;gap:var(--eac-s1)}
.eac-usage-detail{min-width:0;padding:var(--eac-s2) var(--eac-s3);border:1px solid var(--eac-divider);border-radius:var(--eac-r-sm);background:var(--eac-surface)}
.eac-usage-detail .eac-remaining{margin-top:var(--eac-s2)}
.eac-row-item:first-child{border-top:0}
.eac-row-item:hover{background:var(--eac-subtle)}
.eac-row-item[data-off=true] .eac-row-copy{opacity:.6}
.eac-row-main{display:flex;align-items:center;gap:var(--eac-s3);min-width:0}
.eac-avatar{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--eac-subtle);border:1px solid var(--eac-divider);color:var(--eac-muted);font-size:var(--eac-fs-xs);font-weight:700}
.eac-row-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.eac-row-head{display:flex;align-items:center;flex-wrap:wrap;gap:var(--eac-s1) var(--eac-s2);min-width:0}
.eac-row-name{font-size:var(--eac-fs);font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.eac-row-meta{display:flex;align-items:center;flex-wrap:wrap;gap:var(--eac-s1) var(--eac-s2);color:var(--eac-faint);font-size:var(--eac-fs-xs);line-height:1.45;overflow-wrap:anywhere}
.eac-row-credit{display:flex;justify-content:flex-end;align-items:baseline;gap:var(--eac-s1);color:var(--eac-text);font-size:var(--eac-fs-lg);font-weight:640;font-variant-numeric:tabular-nums;line-height:1.2;flex-wrap:wrap}
.eac-row-credit small{color:var(--eac-faint);font-size:var(--eac-fs-xs);font-weight:500}
.eac-row-credit.is-unknown{color:var(--eac-faint);font-size:var(--eac-fs-sm);font-weight:500}
.eac-row-more{grid-column:1/-1;display:flex;flex-direction:column;gap:var(--eac-s3);padding:10px 0 2px 12px;border-top:1px dashed var(--eac-divider);border-left:2px solid color-mix(in srgb,var(--eac-accent) 55%,transparent);margin-top:var(--eac-s2)}
.eac-row-links{display:flex;align-items:center;gap:var(--eac-s4);flex-wrap:wrap}
.eac-more{padding:4px 8px;border:1px solid transparent;border-radius:var(--eac-r-sm);background:transparent;color:var(--eac-muted);cursor:pointer;font-size:var(--eac-fs-sm);font-weight:560;transition:background .14s ease,color .14s ease,border-color .14s ease}
.eac-more:hover{border-color:var(--eac-border);background:var(--eac-surface);color:var(--eac-text)}
.eac-more[aria-expanded=true]{border-color:var(--eac-border);background:var(--eac-surface);color:var(--eac-text)}
.eac-danger-panel{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s3);flex-wrap:wrap;padding:var(--eac-s2) var(--eac-s3);border:1px solid color-mix(in srgb,var(--eac-danger) 32%,var(--eac-border));border-radius:var(--eac-r-sm);background:color-mix(in srgb,var(--eac-danger) 6%,var(--eac-surface));font-size:var(--eac-fs-sm)}
.eac-danger-panel p{margin:0;min-width:0;flex:1 1 200px}
.eac-danger-actions{display:flex;align-items:center;gap:var(--eac-s2);flex:none}

/* ---------- 开关 ---------- */
.eac-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--eac-border);cursor:pointer;transition:background .15s ease}
.eac-switch::before{content:"";position:absolute;inset:-3px 0}
.eac-switch[aria-checked=true]{background:var(--eac-accent)}
.eac-switch:disabled{opacity:.42;cursor:not-allowed}
.eac-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease}
.eac-switch[aria-checked=true] .eac-switch-knob{transform:translateX(16px)}

/* ---------- 模型 ---------- */
.eac-model-list{display:flex;flex-direction:column;border:1px solid var(--eac-border);border-radius:var(--eac-r);background:var(--eac-surface);overflow:hidden}
.eac-model{display:flex;flex-direction:column;gap:var(--eac-s2);min-width:0;padding:var(--eac-s2) var(--eac-s3);border-top:1px solid var(--eac-divider);transition:background .14s ease}
.eac-model:first-child{border-top:0}
.eac-model:hover{background:var(--eac-subtle)}
.eac-model[data-disabled=true] .eac-model-name{color:var(--eac-muted)}
.eac-model-head{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,max-content) auto;grid-template-areas:"switch copy defaults aside";align-items:center;gap:var(--eac-s3);min-width:0}
.eac-model-head>.eac-switch{grid-area:switch}.eac-model-copy{grid-area:copy}.eac-model-defaults{grid-area:defaults}.eac-model-aside{grid-area:aside}
.eac-model-copy{display:flex;flex-direction:column;align-items:flex-start;gap:var(--eac-s1);min-width:0}
.eac-model-name{font-size:var(--eac-fs);font-weight:620;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:100%}
.eac-model-id{color:var(--eac-faint);font-family:var(--eac-mono);font-size:var(--eac-fs-xs);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none;max-width:15em}
.eac-model-defaults{margin:0;color:var(--eac-muted);font-size:var(--eac-fs-xs);line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
.eac-model-aside{display:flex;align-items:center;gap:var(--eac-s2);flex:none}
.eac-model-tags{display:flex;align-items:center;gap:var(--eac-s1);flex-wrap:wrap;min-width:0}
.eac-model-reason{padding-left:44px}
.eac-pagination{display:flex;align-items:center;justify-content:center;gap:var(--eac-s3);color:var(--eac-muted);font-size:var(--eac-fs-xs);font-variant-numeric:tabular-nums}

/* ---------- 表单 ---------- */
.eac-input{width:100%;min-height:30px;padding:5px 9px;border:1px solid var(--eac-border);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-text);color-scheme:inherit;font-size:var(--eac-fs-sm);outline:none;transition:border-color .14s ease}
.eac-settings select option{color:CanvasText;background:Canvas}
.eac-input:hover:not(:disabled){border-color:color-mix(in srgb,var(--eac-accent) 30%,var(--eac-border))}
.eac-input:focus{border-color:var(--eac-accent)}
.eac-input:disabled{opacity:.5;cursor:not-allowed}
.eac-account-form{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:var(--eac-s3)}
.eac-field{display:flex;flex-direction:column;gap:var(--eac-s1);color:var(--eac-muted);font-size:var(--eac-fs-xs);min-width:0}
.eac-checkbox{display:flex;align-items:center;gap:var(--eac-s2);color:var(--eac-muted);font-size:var(--eac-fs-sm);cursor:pointer;user-select:none}
.eac-checkbox input{width:14px;height:14px;accent-color:var(--eac-accent);cursor:pointer}
.eac-form-actions{display:flex;align-items:center;gap:var(--eac-s2);grid-column:1/-1;flex-wrap:wrap}

/* ---------- 参数编辑器 ---------- */
.eac-params{display:flex;flex-direction:column;gap:var(--eac-s3);padding:var(--eac-s3);border:1px solid var(--eac-divider);border-radius:var(--eac-r-sm);background:var(--eac-subtle)}
.eac-param-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:var(--eac-s3)}
.eac-model-tools{display:flex;align-items:center;flex-wrap:wrap;gap:var(--eac-s2) var(--eac-s3)}
.eac-model-tools .eac-model-search{flex:1 1 12rem;min-width:0}
.eac-param-group{display:flex;flex-direction:column;gap:var(--eac-s1);min-width:0}
.eac-param-group+.eac-param-group{padding-top:var(--eac-s3);border-top:1px solid var(--eac-divider)}
.eac-group-title{margin:0;color:var(--eac-muted);font-size:var(--eac-fs-sm);font-weight:620;letter-spacing:.01em}
.eac-tier-row{display:flex;gap:var(--eac-s1);flex-wrap:wrap}
.eac-tier{flex:1 1 auto;min-width:58px;min-height:28px;padding:4px 8px;border:1px solid var(--eac-border);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-muted);cursor:pointer;font-size:var(--eac-fs-xs);font-weight:560;line-height:1.4;transition:background .14s ease,color .14s ease,border-color .14s ease}
.eac-tier:hover:not(:disabled){border-color:var(--eac-accent);color:var(--eac-text)}
.eac-tier[aria-pressed=true]{border-color:var(--eac-accent);background:color-mix(in srgb,var(--eac-accent) 10%,var(--eac-surface));color:var(--eac-accent);font-weight:620}
.eac-tier:disabled{opacity:.45;cursor:not-allowed}
.eac-params-note{margin:0;color:var(--eac-faint);font-size:var(--eac-fs-xs);line-height:1.5}

/* ---------- OpenDesign CoRouter 上下文分段：设置页与输入栏变体 ---------- */
.eac-params .eac-context-tiers{flex-wrap:wrap;max-width:100%}
.eac-context-control{display:flex;align-items:center;flex-wrap:wrap;gap:var(--eac-s2);min-width:0;color:var(--eac-text);font-size:var(--eac-fs-sm)}
.eac-context-tiers{display:inline-flex;align-items:center;gap:0;min-width:0;padding:var(--eac-s1);border:1px solid var(--eac-border);border-radius:var(--eac-s2)}
.eac-context-control .eac-context-segment{display:inline-flex;align-items:center;justify-content:center;min-height:var(--eac-s6);min-width:0;padding:var(--eac-s1) var(--eac-s2);margin:0;border:1px solid transparent;border-radius:var(--eac-s1);background:transparent;color:var(--eac-muted);font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}
.eac-context-control .eac-context-segment:hover:not(:disabled){background:var(--eac-subtle);color:var(--eac-text)}
.eac-context-control .eac-context-segment[aria-pressed=true]{border-color:var(--eac-accent);background:var(--eac-subtle);color:var(--eac-text);font-weight:700}
.eac-context-segment:disabled{opacity:.55;cursor:not-allowed}
.eac-context-control :focus-visible{outline:2px solid var(--eac-accent);outline-offset:var(--eac-s1)}
.eac-context-caption,.eac-context-note{color:var(--eac-muted);font-size:inherit}
.eac-context-pill{position:relative;display:inline-flex;align-items:center;flex:none;max-inline-size:100%;color:inherit;font:inherit}
.eac-context-pill .eac-context-control{display:inline-flex;flex:none;flex-wrap:nowrap;gap:var(--eac-segment-pad);max-inline-size:100%;color:inherit;font-size:var(--eac-fs-segment)}
.eac-context-pill .eac-context-tiers{gap:var(--eac-segment-gap);min-height:26px;box-sizing:border-box;padding:var(--eac-segment-pad);border-color:var(--eac-segment-border);border-radius:var(--eac-r-pill);background:transparent}
.eac-context-pill .eac-context-segment{min-height:20px;padding:0 var(--eac-segment-inline);border:1px solid transparent;border-radius:var(--eac-r-pill);font-weight:500;color:inherit;opacity:.7;background:transparent}
.eac-context-pill .eac-context-segment[aria-pressed=true]{border:1px solid color-mix(in srgb,#3b82f6 45%,transparent);background:var(--eac-segment-selected);color:#3b82f6;font-weight:600;opacity:1;cursor:default}
.eac-context-pill .eac-context-segment:hover:not(:disabled){background:color-mix(in srgb,currentColor 7%,transparent);color:inherit;opacity:1}
.eac-context-pill .eac-context-segment[aria-pressed=true]:hover:not(:disabled){background:var(--eac-segment-selected);color:#3b82f6}
.eac-context-pill[data-disabled=true] .eac-context-control{opacity:.55}
.eac-context-pill .eac-context-segment:disabled{cursor:default;opacity:.45}
.eac-context-pill[data-disabled=true] .eac-context-segment:disabled{opacity:.68}
.eac-context-pill[data-disabled=true] .eac-context-segment[aria-pressed=true]:disabled{opacity:1}
.eac-context-pill :focus-visible{outline:2px solid var(--eac-accent);outline-offset:var(--eac-segment-pad)}
.eac-context-pill .eac-context-caption{display:none}
.eac-context-pill .eac-context-note{white-space:nowrap}
.eac-context-feedback{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;pointer-events:none}
.eac-context-pill[data-error=true] .eac-context-tiers{border-color:var(--eac-danger)}
.eac-context-pill[data-error=true]:is(:hover,:focus-within)::after{content:attr(data-error-message);position:absolute;inset-inline-start:0;inset-block-end:calc(100% + var(--eac-context-tip-gap));z-index:var(--eac-context-tip-layer);width:max-content;max-width:min(var(--eac-context-tip-width),calc(100vw - var(--eac-s5)));box-sizing:border-box;padding:var(--eac-s2);border:1px solid var(--eac-danger);border-radius:var(--eac-r-sm);background:var(--eac-surface);color:var(--eac-text);font:var(--eac-fs-xs)/1.5 system-ui,sans-serif;white-space:normal;overflow-wrap:anywhere;pointer-events:none}
.eac-context-retry{min-height:0;padding:var(--eac-segment-pad) var(--eac-segment-inline);border:1px solid var(--eac-segment-border);border-radius:var(--eac-r-pill);background:transparent;color:inherit;font:inherit;font-size:var(--eac-fs-segment);cursor:pointer}
@media(forced-colors:active){.eac-context-control .eac-context-tiers{border-color:ButtonText}.eac-context-control .eac-context-segment[aria-pressed=true]{border-color:Highlight;background:Highlight;color:HighlightText;forced-color-adjust:none}.eac-context-control .eac-context-segment:disabled{color:GrayText;opacity:1}}

/* ---------- 卡片组（渠道设置 / 额度池） ---------- */
.eac-plan-window-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--eac-s2);color:var(--eac-muted);font-size:var(--eac-fs-xs);flex-wrap:wrap}
.eac-plan-window-head strong{color:var(--eac-text);font-size:var(--eac-fs-sm);font-weight:640;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.eac-plan-window-meta{display:flex;justify-content:space-between;gap:var(--eac-s2);margin-top:var(--eac-s1);color:var(--eac-faint);font-size:var(--eac-fs-xs);line-height:1.5;flex-wrap:wrap}

.eac-quota-pill{display:inline-flex;min-width:0;font-variant-numeric:tabular-nums;--eac-quota-fill:transparent;--eac-quota-border:var(--eac-segment-border)}
.eac-quota-pill[data-tone=warn]{--eac-quota-fill:rgba(234,179,8,.10);--eac-quota-border:rgba(234,179,8,.45)}
.eac-quota-pill[data-tone=danger]{--eac-quota-fill:rgba(239,68,68,.10);--eac-quota-border:rgba(239,68,68,.45)}
.eac-quota-trigger{display:inline-flex;align-items:center;gap:var(--eac-s2);min-height:var(--eac-quota-min-height);max-width:min(46vw,240px);padding:4px 11px 4px 9px;box-sizing:border-box;border:1px solid var(--eac-quota-border);border-radius:var(--eac-r-pill);background:var(--eac-quota-fill);color:inherit;font-family:inherit;font-weight:600;font-size:var(--eac-fs-sm);line-height:1.2;white-space:nowrap;cursor:pointer;touch-action:manipulation}
.eac-quota-trigger:hover,.eac-quota-trigger[aria-expanded=true]{background:color-mix(in srgb,currentColor 7%,transparent)}
.eac-quota-trigger:active{background:color-mix(in srgb,currentColor 11%,transparent)}
.eac-quota-trigger[data-stale=true]{border-style:dashed}
.eac-quota-trigger-text{overflow:hidden;text-overflow:ellipsis}
.eac-quota-mini{display:inline-flex;flex-direction:column;justify-content:center;gap:3px;width:34px;flex:none}
.eac-quota-mini[data-count="3"]{gap:2px}
.eac-quota-bar{display:block;height:6px;border-radius:99px;background:rgba(128,128,128,.22);overflow:hidden}
.eac-quota-mini[data-count="2"] .eac-quota-bar{height:5px}
.eac-quota-mini[data-count="3"] .eac-quota-bar{height:4px}
.eac-quota-bar-fill{display:block;height:100%;border-radius:99px;background:var(--eac-muted)}
.eac-quota-bar[data-tone=success] .eac-quota-bar-fill{background:var(--eac-success)}
.eac-quota-bar[data-tone=warn] .eac-quota-bar-fill{background:var(--eac-warn)}
.eac-quota-bar[data-tone=danger] .eac-quota-bar-fill{background:var(--eac-danger)}
.eac-quota-track{display:block;appearance:none;width:100%;height:8px;border:0;border-radius:99px;overflow:hidden;background:rgba(128,128,128,.22);accent-color:var(--eac-quota-tone)}
.eac-quota-track::-webkit-progress-bar{background:rgba(128,128,128,.22)}
.eac-quota-track::-webkit-progress-value{background:var(--eac-quota-tone);border-radius:99px}
.eac-quota-pill :focus-visible{outline:2px solid var(--eac-accent);outline-offset:2px}
.eac-quota-popover{box-sizing:border-box;position:fixed;inset:auto var(--eac-s2) var(--eac-s5) auto;margin:0;width:min(var(--eac-quota-width),calc(100vw - 24px));max-height:min(70vh,calc(100vh - 72px));overflow:auto;overscroll-behavior:contain;padding:14px;border:1px solid rgba(128,128,128,.28);border-radius:14px;background:var(--dsh-surface,var(--dsw-alias-bg-layer-1,Canvas));color:var(--dsh-text,var(--dsw-alias-label-primary,CanvasText));color-scheme:light;box-shadow:var(--eac-quota-shadow);font:12px/1.5 sans-serif}
@supports(position-area:top span-left){.eac-quota-popover{inset:auto;position-area:top span-left;justify-self:end;margin:var(--eac-s2);position-try-fallbacks:flip-inline,flip-block,flip-block flip-inline}}
.eac-quota-popover header{display:flex;justify-content:space-between;align-items:center;gap:var(--eac-s2);overflow-wrap:anywhere}
.eac-quota-header{position:sticky;top:-14px;z-index:2;margin:-14px -14px 8px;padding:14px 14px 8px;background:var(--dsh-surface,var(--dsw-alias-bg-layer-1,Canvas));border-bottom:1px solid var(--eac-divider);font-size:13px}
.eac-quota-plan{flex:none;padding:1px 8px;border-radius:99px;background:rgba(128,128,128,.15);font-size:11px;font-weight:600}
.eac-quota-status{margin:8px 0 0;padding:8px 10px;border-radius:10px;background:rgba(234,179,8,.10);border:1px solid rgba(234,179,8,.28);font-size:11.5px;color:#ca8a04}
.eac-quota-track{grid-column:1/-1;margin:var(--eac-s1) 0}
.eac-quota-account{margin-top:var(--eac-s3)}
.eac-quota-account header{margin-bottom:var(--eac-s1)}
.eac-quota-group{padding:10px 12px;background:rgba(128,128,128,.07);border-radius:10px}
.eac-quota-group + .eac-quota-group{margin-top:var(--eac-s2)}
.eac-quota-detail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,max-content);column-gap:var(--eac-s2);overflow-wrap:anywhere}
.eac-quota-detail + .eac-quota-detail{margin-top:var(--eac-s1)}
.eac-quota-detail>span{opacity:.7;font-weight:500}
.eac-quota-detail>:nth-child(2){text-align:right}
.eac-quota-detail small{grid-column:1/-1;opacity:.62;font-size:11px}
.eac-quota-footer{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s2);margin-top:var(--eac-s3);opacity:.78;font-size:11px}
.eac-quota-footer .eac-button{border:none;border-radius:8px;padding:4px 12px;min-height:26px;background:rgba(59,130,246,.14);color:#3b82f6;font-size:12px;font-weight:500}
.eac-quota-others{margin-top:var(--eac-s3);padding-top:var(--eac-s2);border-top:1px solid var(--eac-divider)}
.eac-quota-others summary{padding-block:var(--eac-s1);cursor:pointer;opacity:.75;font-weight:600}
.eac-quota-others summary:hover{opacity:1}
html[data-dsh-go-island][data-dsh-go-island-form="panel"] .eac-quota-popover{position:static;inset:auto;width:100%;max-height:none;overflow:visible;margin-top:8px;box-shadow:none;background:transparent;border-color:rgba(128,128,128,.2)}
:is(.eac-quota-popover,.eac-quota-account-row)[data-tone=neutral]{--eac-quota-tone:var(--eac-muted)}
:is(.eac-quota-popover,.eac-quota-account-row,.eac-quota-track)[data-tone=success]{--eac-quota-tone:var(--eac-success)}
:is(.eac-quota-popover,.eac-quota-account-row,.eac-quota-track)[data-tone=warn]{--eac-quota-tone:var(--eac-warn)}
:is(.eac-quota-popover,.eac-quota-account-row,.eac-quota-track)[data-tone=danger]{--eac-quota-tone:var(--eac-danger)}
.eac-quota-account-list{display:grid;gap:var(--eac-s1);margin-top:var(--eac-s2)}
.eac-quota-account-row{display:flex;align-items:center;justify-content:space-between;gap:var(--eac-s2);min-width:0;width:100%;padding:6px 10px;border:1px solid var(--eac-divider);border-radius:var(--eac-r-sm);background:var(--eac-subtle);color:inherit;font:inherit;text-align:left;cursor:pointer}
.eac-quota-account-row:hover{background:var(--eac-hover)}
.eac-quota-account-row[aria-pressed=true]{border-color:color-mix(in srgb,var(--eac-accent) 55%,transparent);background:color-mix(in srgb,var(--eac-accent) 12%,transparent)}
.eac-quota-account-row>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eac-quota-account-row>strong{flex:none;max-width:50%;color:var(--eac-quota-tone);text-align:right;overflow-wrap:anywhere}

@media(prefers-color-scheme:dark){
  :where(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover){color-scheme:dark;--eac-surface:var(--dsw-alias-bg-layer-1,#191b20);--eac-subtle:color-mix(in srgb,currentColor 4%,transparent);--eac-hover:color-mix(in srgb,currentColor 7%,transparent);--eac-text:var(--dsw-alias-label-primary,#f2f4f7);--eac-muted:color-mix(in srgb,currentColor 66%,transparent);--eac-faint:color-mix(in srgb,currentColor 50%,transparent);--eac-border:color-mix(in srgb,currentColor 20%,transparent);--eac-divider:color-mix(in srgb,currentColor 12%,transparent);--eac-accent:#3b82f6;--eac-on-accent:#fff;--eac-success:#22c55e;--eac-warn:#eab308;--eac-danger:#ef4444;--eac-shadow:0 1px 2px rgba(0,0,0,.18)}
}
:where(body[data-ds-dark-theme],.dark,[data-theme=dark],[data-color-scheme=dark]) :is(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover),:is(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover):where(.dark,[data-theme=dark],[data-color-scheme=dark]){color-scheme:dark;--eac-surface:var(--dsw-alias-bg-layer-1,#191b20);--eac-subtle:color-mix(in srgb,currentColor 4%,transparent);--eac-hover:color-mix(in srgb,currentColor 7%,transparent);--eac-text:var(--dsw-alias-label-primary,#f2f4f7);--eac-muted:color-mix(in srgb,currentColor 66%,transparent);--eac-faint:color-mix(in srgb,currentColor 50%,transparent);--eac-border:color-mix(in srgb,currentColor 20%,transparent);--eac-divider:color-mix(in srgb,currentColor 12%,transparent);--eac-accent:#3b82f6;--eac-on-accent:#fff;--eac-success:#22c55e;--eac-warn:#eab308;--eac-danger:#ef4444;--eac-shadow:0 1px 2px rgba(0,0,0,.18)}
:where(.light,[data-theme=light],[data-color-scheme=light]) :is(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover),:is(.eac-settings,.eac-context-pill,.eac-quota-pill,.eac-quota-popover):where(.light,[data-theme=light],[data-color-scheme=light]){color-scheme:light;--eac-surface:var(--dsw-alias-bg-layer-1,#fff);--eac-subtle:color-mix(in srgb,currentColor 4%,transparent);--eac-hover:color-mix(in srgb,currentColor 7%,transparent);--eac-text:var(--dsw-alias-label-primary,#182230);--eac-muted:color-mix(in srgb,currentColor 66%,transparent);--eac-faint:color-mix(in srgb,currentColor 50%,transparent);--eac-border:color-mix(in srgb,currentColor 20%,transparent);--eac-divider:color-mix(in srgb,currentColor 12%,transparent);--eac-accent:#3b82f6;--eac-on-accent:#fff;--eac-success:#22c55e;--eac-warn:#eab308;--eac-danger:#ef4444;--eac-shadow:0 1px 2px rgba(16,24,40,.04)}
@container eac (max-width:720px){
  .eac-row-item:has(.eac-row-controls .eac-tier-row){grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main switch" "more more"}
  .eac-row-item:has(.eac-row-controls .eac-tier-row)>.eac-row-controls{justify-content:flex-start}
  .eac-row-item:has(.eac-row-controls .eac-tier-row) .eac-tier-row{width:100%}
}
@container eac (max-width:640px){
  .eac-header{align-items:center}
  .eac-workspace{padding:var(--eac-s2) var(--eac-s3) var(--eac-s4)}
  .eac-panels{gap:var(--eac-s4)}.eac-panel-body{padding:var(--eac-s3) 0 0}
  .eac-section-head{flex-direction:column}.eac-section-actions{justify-content:flex-start}.eac-group-actions{justify-content:flex-start}
  .eac-workspace[data-panel=models] .eac-section-head{flex-direction:row;align-items:center;flex-wrap:wrap;gap:var(--eac-s2)}
  .eac-workspace[data-panel=models] .eac-section-actions{max-width:100%}
  .eac-row-item{grid-template-columns:minmax(0,1fr) auto auto;grid-template-areas:"main switch more" "metric metric metric";gap:var(--eac-s2);padding:var(--eac-s3)}
  .eac-row-item:has(.eac-row-controls :is(.eac-button,.eac-tier-row)){grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main switch" "more more"}
  .eac-row-item:has(.eac-row-controls :is(.eac-button,.eac-tier-row))>.eac-row-controls{justify-content:flex-start}
  .eac-row-item:has(.eac-row-controls :is(.eac-button,.eac-tier-row))>.eac-row-metric{grid-area:auto;grid-column:1/-1}
  .eac-workspace[data-panel=advanced] .eac-row-name{white-space:normal;overflow-wrap:anywhere}
  .eac-row-credit{justify-content:flex-start}
  .eac-row-item>.eac-row-more{grid-area:auto;grid-column:1/-1;margin-top:0}
  .eac-account-form{grid-template-columns:1fr}.eac-form-actions{grid-column:1}
  .eac-model-head{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"switch copy aside" "defaults defaults defaults";row-gap:var(--eac-s1)}
  .eac-model-defaults{text-align:left;white-space:normal}
  /* ⚠️ **绝不隐藏模型 id**：小浣熊免费/订阅两侧的展示名完全相同（订阅侧 id 多一个
     「-p」后缀），藏了 id 就看不出这一行到底是哪一侧的哪个模型（用户报障）。窄屏只把
     id 从「与名字同一行」改成「名字下面一行」。
     ⚠️ 这里是模板字面量内部：注释里**不能出现反引号**，否则字符串提前闭合、后面的
     片段被当成 JS 执行（踩过一次：ReferenceError: p is not defined）。 */
  .eac-model-copy{flex-direction:column;align-items:flex-start;gap:0}
  .eac-model-id{max-width:100%;flex:0 0 auto;white-space:normal;overflow-wrap:anywhere}
  .eac-model-reason{padding-left:0}
}
/* 极窄（宿主设置面板常见宽度 ~380px）：渠道 tab 由「横向滚动」改「两列网格」。
   横向滚动会把一半渠道藏起来（用户报障「点开是这样」= 只能看到 3 个渠道），
   两列网格仍然是紧凑成排的按钮，但一屏能看全，不用猜右边还有没有东西。 */
@container eac (max-width:470px){
  .eac-providers{grid-template-columns:repeat(2,minmax(0,1fr));padding-bottom:0}
  .eac-provider{padding:var(--eac-s2) var(--eac-s3)}
  .eac-provider-name{font-size:var(--eac-fs-sm)}
  .eac-provider-meta{font-size:var(--eac-fs-xs)}
  .eac-title{font-size:var(--eac-fs-lg)}
}
@container eac (max-width:420px){
  .eac-model-head{grid-template-areas:"switch copy edit" "defaults defaults defaults" "tags tags tags"}
  .eac-model-aside{display:contents}
  .eac-model-aside>.eac-button{grid-area:edit}
  .eac-model-aside>.eac-model-tags{grid-area:tags}
  .eac-model-tags:empty{display:none}
}
@container eac (max-width:390px){.eac-title{font-size:15px}.eac-panels{gap:var(--eac-s3)}.eac-panel-tab{font-size:var(--eac-fs-sm)}}
@media(prefers-reduced-motion:reduce){:where(.eac-settings,.eac-context-pill,.eac-quota-pill) *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`

export function installStyles() {
  if (typeof document === 'undefined' || !document.head || !document.createElement) return () => {}
  const element = document.createElement('style')
  element.dataset.eacRouter = ''
  element.textContent = CLIENT_STYLES
  document.head.append(element)
  let active = true
  return () => { if (!active) return; active = false; element.remove() }
}
