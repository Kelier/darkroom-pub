// Static creative assets: ratios, font packs, film looks, captions, templates.

export const RATIOS = [
  { id: 'orig', label: '原图', value: null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '4:5', label: '4:5', value: 4 / 5 },
  { id: '2:3', label: '2:3', value: 2 / 3 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
];

export const FONT_PACKS = {
  minimal: { name: '极简无衬线', hint: '现代 · 干净', latin: 'Inter', cjk: 'Noto Sans SC', weight: 500 },
  serif:   { name: '时尚衬线', hint: '杂志 · 艺术人像', latin: 'Playfair Display', cjk: 'Noto Serif SC', weight: 700 },
  hand:    { name: '手写字体', hint: '日记 · 拍立得', latin: 'Caveat', cjk: 'Ma Shan Zheng', weight: 600 },
  type:    { name: '复古打字机', hint: '胶片 · 档案感', latin: 'Special Elite', cjk: 'Noto Serif SC', weight: 400 },
  jp:      { name: '日系排版', hint: '日系杂志 · 旅行', latin: 'Cormorant Garamond', cjk: 'Shippori Mincho', weight: 500 },
  bold:    { name: '粗体实验', hint: '海报 · 潮流', latin: 'Anton', cjk: 'Noto Sans SC', weight: 900 },
  deco:    { name: '装饰字体', hint: '节日 · 主题', latin: 'Abril Fatface', cjk: 'ZCOOL XiaoWei', weight: 400 },
  stamp:   { name: '日期戳', hint: '相机日期', latin: 'Share Tech Mono', cjk: 'Noto Sans SC', weight: 400 },
  mincho:  { name: '古典明朝', hint: '昭和书籍 · 文学', latin: 'Zen Old Mincho', cjk: 'Zen Old Mincho', fb: 'Noto Serif SC', weight: 600, group: '明朝' },
  b1:      { name: '秀英明朝', hint: '报刊标题 · 粗', latin: 'Shippori Mincho B1', cjk: 'Shippori Mincho B1', fb: 'Noto Serif SC', weight: 800, group: '明朝' },
  tokumin: { name: '特太明朝', hint: '海报 · 浓墨', latin: 'Kaisei Tokumin', cjk: 'Kaisei Tokumin', fb: 'Noto Serif SC', weight: 800, group: '明朝' },
  hina:    { name: '细明朝', hint: '纤细 · 留白', latin: 'Hina Mincho', cjk: 'Hina Mincho', fb: 'Noto Serif SC', weight: 400, group: '明朝' },
  wenkai:  { name: '文楷', hint: '古籍 · 手记', latin: 'LXGW WenKai TC', cjk: 'LXGW WenKai TC', fb: 'Noto Serif SC', weight: 400, group: '明朝' },
  brush:   { name: '行草书法', hint: '题字 · 落款', latin: 'Zhi Mang Xing', cjk: 'Zhi Mang Xing', fb: 'Ma Shan Zheng', weight: 400, group: '明朝' },
};

export function fontString(packId, px, opts = {}) {
  const p = FONT_PACKS[packId] || FONT_PACKS.minimal;
  const w = opts.weight || p.weight;
  const it = opts.italic ? 'italic ' : '';
  return `${it}${w} ${Math.max(1, Math.round(px))}px "${p.latin}", "${p.cjk}"${p.fb ? `, "${p.fb}"` : ''}, ${p.fb ? 'serif' : 'sans-serif'}`;
}

// Film looks use studio naming (inspired by classic stocks, not official simulations).
const N = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, saturation: 0, fade: 0,
  splitShadow: [0, 0], splitHighlight: [0, 0], grain: 0, vignette: 0, leak: 0, bloom: 0, mono: false };
export const NEUTRAL_FILM = N;

export const FILMS = [
  { id: 'none', name: '原片', sub: 'Original', p: { ...N } },
  { id: 'warm-neg', name: '暖调负片', sub: 'Golden 200', p: { ...N, exposure: .06, contrast: .12, temp: .22, tint: .03, saturation: .14, fade: .06, highlights: -.1, splitHighlight: [38, .12], grain: .22, vignette: .18 } },
  { id: 'clear', name: '日系清透', sub: 'Airy 400', p: { ...N, exposure: .16, contrast: -.18, highlights: -.25, shadows: .22, temp: -.04, tint: -.05, saturation: -.12, fade: .12, splitShadow: [180, .1], grain: .1 } },
  { id: 'retro', name: '复古暖调', sub: 'Faded 70s', p: { ...N, contrast: -.06, temp: .2, tint: -.12, saturation: -.22, fade: .28, splitShadow: [95, .14], splitHighlight: [45, .16], grain: .35, vignette: .3 } },
  { id: 'cinema', name: '电影负片', sub: 'Cine 500T', p: { ...N, exposure: -.04, contrast: .22, highlights: -.2, shadows: -.05, temp: -.06, saturation: -.08, fade: .06, splitShadow: [190, .22], splitHighlight: [32, .18], grain: .2, vignette: .32, bloom: .25 } },
  { id: 'bw', name: '黑白胶片', sub: 'Mono 400', p: { ...N, contrast: .32, shadows: -.06, saturation: -1, mono: true, grain: .45, vignette: .28 } },
  { id: 'instant', name: '即时成像', sub: 'Instant SQ', p: { ...N, exposure: .08, contrast: -.12, highlights: -.18, temp: .06, tint: .06, saturation: -.1, fade: .2, splitShadow: [200, .12], splitHighlight: [40, .1], grain: .14, vignette: .22 } },
  { id: 'disposable', name: '一次性相机', sub: 'Snap Flash', p: { ...N, exposure: .12, contrast: .2, temp: .08, saturation: .18, fade: .04, grain: .38, vignette: .55, bloom: .15 } },
  { id: 'expired', name: '实验胶片', sub: 'Expired 1998', p: { ...N, contrast: .1, temp: .12, tint: .2, saturation: .06, fade: .18, splitShadow: [280, .18], splitHighlight: [20, .2], grain: .6, vignette: .4, leak: .75 } },
];

export const FILM_PARAMS = [
  { key: 'exposure', label: '曝光', min: -1, max: 1 },
  { key: 'temp', label: '色温', min: -1, max: 1 },
  { key: 'tint', label: '色调', min: -1, max: 1 },
  { key: 'highlights', label: '高光', min: -1, max: 1 },
  { key: 'shadows', label: '阴影', min: -1, max: 1 },
  { key: 'contrast', label: '对比度', min: -1, max: 1 },
  { key: 'saturation', label: '饱和度', min: -1, max: 1 },
  { key: 'fade', label: '褪色 / 黑位', min: 0, max: 1 },
  { key: 'grain', label: '胶片颗粒', min: 0, max: 1 },
  { key: 'vignette', label: '暗角', min: 0, max: 1 },
  { key: 'leak', label: '漏光', min: 0, max: 1 },
  { key: 'bloom', label: '高光扩散', min: 0, max: 1 },
];

export const CANVAS_COLORS = ['#ffffff', '#f4efe6', '#eadfcd', '#111111', '#f6d4d2', '#d9e4dc', '#c8d6e5', '#e2502c'];

export const TEXTURES = [
  { id: 'none', name: '无' }, { id: 'paper', name: '纸张' }, { id: 'photo', name: '相纸' },
  { id: 'kraft', name: '牛皮纸' }, { id: 'magazine', name: '旧杂志' }, { id: 'grain', name: '颗粒' },
];

export const CAPTION_STYLES = ['冷淡', '治愈', '幽默', '文艺', '电影感', '旅行日记', '时尚编辑'];

// Original captions written for the studio library — no lyrics or film quotes.
export const CAPTIONS = {
  night: [
    { t: '城市的灯，替我说了晚安。', s: '治愈' },
    { t: 'After dark, the city slows down.', s: '电影感' },
    { t: '夜色很长，红灯很短。', s: '文艺' },
    { t: 'NIGHT SHIFT / 22:47', s: '时尚编辑' },
    { t: '等一个绿灯，也等一个答案。', s: '电影感' },
    { t: '今日穿搭：夜色同款。', s: '幽默' },
    { t: 'no plans, just streetlights.', s: '冷淡' },
    { t: '夜の街は、少しだけ優しい。', s: '文艺' },
  ],
  city: [
    { t: '在这座城市，慢一点也没关系。', s: '治愈' },
    { t: 'Somewhere, not in a hurry.', s: '旅行日记' },
    { t: '今天的风，适合记下来。', s: '文艺' },
    { t: 'CITY NOTES — VOL.03', s: '时尚编辑' },
    { t: '路过的每一个转角都算数。', s: '旅行日记' },
    { t: '本人已在此地打卡，勿念。', s: '幽默' },
    { t: 'just another street.', s: '冷淡' },
  ],
  nature: [
    { t: '风从山那边来，带着草的味道。', s: '治愈' },
    { t: 'Walking until the map runs out.', s: '旅行日记' },
    { t: '把自己交给一整片旷野。', s: '文艺' },
    { t: 'OUTSIDE / 户外特辑', s: '时尚编辑' },
    { t: '今日步数：很多。今日烦恼：很少。', s: '幽默' },
    { t: 'green, then blue, then nothing.', s: '冷淡' },
    { t: '那天的天空，像一部没有台词的电影。', s: '电影感' },
  ],
  portrait: [
    { t: '普通的一天，也值得被保存。', s: '治愈' },
    { t: 'a little moment of life', s: '文艺' },
    { t: '2026.10 — a day to remember', s: '旅行日记' },
    { t: 'THE QUIET ISSUE', s: '时尚编辑' },
    { t: '表情管理：失败。快乐管理：成功。', s: '幽默' },
    { t: 'not posing, just being.', s: '冷淡' },
    { t: '镜头记得我比我更久。', s: '电影感' },
  ],
  daily: [
    { t: '今天也有好好生活。', s: '治愈' },
    { t: 'small things, kept.', s: '冷淡' },
    { t: '平凡日子的边角料。', s: '文艺' },
    { t: 'EVERYDAY ARCHIVE', s: '时尚编辑' },
    { t: '此刻已存档，请勿覆盖。', s: '幽默' },
    { t: '如果这是第一幕，那就慢慢演。', s: '电影感' },
    { t: 'Day 282 / 365', s: '旅行日记' },
  ],
};

export const SCENE_LABEL = { night: '夜景城市', city: '城市街景', nature: '自然户外', portrait: '日常人像', daily: '日常记录' };

export const STICKERS = [
  ...[['sun','日轮'],['moon','月牙'],['flower','花朵'],['asterisk','放射星'],['diamond','菱形'],['cross','十字'],['brackets','取景框'],['wave','波浪'],['dashes','缝线'],['seal','朱印'],['postage','邮票框'],['negative','底片框'],['note','便签'],['ribbon','绶带'],['chevron','双箭头'],['dots','波点']].map(([id,name])=>({id,name})),
  { id: 'tape', name: '胶带' }, { id: 'tape2', name: '格纹胶带' }, { id: 'star', name: '星星' },
  { id: 'heart', name: '爱心' }, { id: 'arrow', name: '手绘箭头' }, { id: 'circle', name: '圈选' },
  { id: 'stamp', name: '邮戳' }, { id: 'sparkle', name: '闪光' }, { id: 'barcode', name: '条形码' },
  { id: 'label', name: '标签纸' }, { id: 'scribble', name: '涂鸦' }, { id: 'ticket', name: '票根' },
];

export const TEMPLATES = [
  {id:'orbit',name:'光环诗集',desc:'环绕主体 · 古典明朝'},
  {id:'book',name:'书页留白',desc:'横幅大留白 · 竖排题记'},
  {id:'waveprint',name:'流动海报',desc:'全幅影像 · 波浪文字'},
  {id:'borderpoem',name:'四边诗笺',desc:'方形印样 · 沿边绕排'},
  { id: 'polaroid', name: '拍立得', tag: '高频', desc: '相纸边框 · 手写注释' },
  { id: 'magazine', name: '杂志封面', tag: '热门', desc: '主体感知标题排布' },
  { id: 'movie', name: '电影海报', tag: '新', desc: '宽银幕 · 片名层级' },
  { id: 'filmstrip', name: '胶片日记', tag: '', desc: '齿孔 · 日期戳 · 打字机' },
  { id: 'journal', name: '旅行手账', tag: '', desc: '胶带 · 箭头批注 · 邮戳' },
  { id: 'minimal', name: '极简留白', tag: '', desc: '大留白 · 小字注脚' },
  { id: 'gig', name: '独立音乐海报', tag: '', desc: '粗体 · 高反差 · 色块' },
  { id: 'japan', name: '日系杂志', tag: '', desc: '竖排标题 · 清透色彩' },
];
