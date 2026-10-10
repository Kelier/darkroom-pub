// Caption intelligence: trending library with heat / source / validity, and an original caption generator.

import { mulberry32, labelCN } from './analyze.js';

// Trend library — short original lines and generic internet phrasing (no lyrics / film quotes).
// source: 编辑精选 | 公开趋势 | 用户授权 ; expires: entries past this date are hidden by default.
export const TRENDS = [
  { t: 'City walk 进行中，请勿打扰。', lang: 'zh', scenes: ['city', 'night'], style: '幽默', heat: 96, trend: 'hot', source: '公开趋势', added: '2026-08-20', expires: '2027-03-31' },
  { t: '今日份松弛感，已到账。', lang: 'zh', scenes: ['daily', 'portrait'], style: '治愈', heat: 93, trend: 'hot', source: '公开趋势', added: '2026-07-02', expires: '2027-01-31' },
  { t: '秋天的第一张照片。', lang: 'zh', scenes: ['nature', 'daily', 'city'], style: '治愈', heat: 91, trend: 'up', source: '公开趋势', added: '2026-09-23', expires: '2026-11-30' },
  { t: '把日子过成一卷胶片。', lang: 'zh', scenes: ['daily', 'portrait'], style: '文艺', heat: 88, trend: 'stable', source: '编辑精选', added: '2026-05-10', expires: '2027-12-31' },
  { t: '人生建议：多出门，多拍照。', lang: 'zh', scenes: ['nature', 'city'], style: '幽默', heat: 86, trend: 'up', source: '公开趋势', added: '2026-08-01', expires: '2027-02-28' },
  { t: '允许一切发生，包括这张照片。', lang: 'zh', scenes: ['daily', 'portrait', 'night'], style: '文艺', heat: 84, trend: 'stable', source: '公开趋势', added: '2026-04-18', expires: '2027-04-30' },
  { t: '夜色营业中。', lang: 'zh', scenes: ['night'], style: '冷淡', heat: 82, trend: 'new', source: '编辑精选', added: '2026-10-01', expires: '2027-06-30' },
  { t: '在路上，也在光里。', lang: 'zh', scenes: ['nature', 'city'], style: '旅行日记', heat: 80, trend: 'up', source: '编辑精选', added: '2026-09-02', expires: '2027-09-30' },
  { t: '情绪稳定，画面不稳定。', lang: 'zh', scenes: ['daily', 'portrait'], style: '幽默', heat: 79, trend: 'new', source: '用户授权', added: '2026-09-28', expires: '2027-03-31' },
  { t: '这一帧，留给十年后的自己。', lang: 'zh', scenes: ['portrait', 'daily'], style: '电影感', heat: 77, trend: 'stable', source: '编辑精选', added: '2026-03-12', expires: '2027-12-31' },
  { t: '主打一个出片。', lang: 'zh', scenes: ['portrait', 'city', 'night'], style: '幽默', heat: 75, trend: 'stable', source: '公开趋势', added: '2026-02-14', expires: '2026-12-31' },
  { t: '风很大，心事很小。', lang: 'zh', scenes: ['nature'], style: '治愈', heat: 73, trend: 'up', source: '用户授权', added: '2026-09-15', expires: '2027-09-15' },
  { t: 'photo dump, no context.', lang: 'en', scenes: ['daily', 'city', 'portrait'], style: '冷淡', heat: 90, trend: 'hot', source: '公开趋势', added: '2026-06-11', expires: '2027-06-30' },
  { t: 'main character hours.', lang: 'en', scenes: ['portrait', 'night', 'city'], style: '时尚编辑', heat: 87, trend: 'stable', source: '公开趋势', added: '2026-01-20', expires: '2026-12-31' },
  { t: 'soft launch of autumn.', lang: 'en', scenes: ['nature', 'daily'], style: '文艺', heat: 83, trend: 'new', source: '编辑精选', added: '2026-09-25', expires: '2026-12-15' },
  { t: 'outside, finally.', lang: 'en', scenes: ['nature'], style: '冷淡', heat: 78, trend: 'up', source: '编辑精选', added: '2026-08-08', expires: '2027-08-08' },
  { t: 'shot on feelings.', lang: 'en', scenes: ['daily', 'portrait', 'night'], style: '电影感', heat: 76, trend: 'stable', source: '用户授权', added: '2026-05-05', expires: '2027-05-05' },
  { t: 'ゆるく、まっすぐ。', lang: 'ja', scenes: ['daily', 'nature'], style: '治愈', heat: 72, trend: 'up', source: '編集', added: '2026-09-09', expires: '2027-09-09' },
  { t: '夜風と、少しの寄り道。', lang: 'ja', scenes: ['night', 'city'], style: '文艺', heat: 70, trend: 'new', source: '編集', added: '2026-10-02', expires: '2027-10-02' },
  { t: '夏天还没结束，我说的。', lang: 'zh', scenes: ['nature', 'daily'], style: '幽默', heat: 64, trend: 'down', source: '公开趋势', added: '2026-07-20', expires: '2026-09-30' },
  { t: '情人节限定滤镜。', lang: 'zh', scenes: ['portrait'], style: '治愈', heat: 41, trend: 'down', source: '公开趋势', added: '2026-02-01', expires: '2026-02-20' },
];

export function trendList(an, { lang = 'all', showExpired = false, today = new Date() } = {}) {
  const iso = today.toISOString().slice(0, 10);
  return TRENDS
    .map(t => ({ ...t, expired: t.expires < iso, fit: an && t.scenes.includes(an.scene) }))
    .filter(t => (showExpired || !t.expired) && (lang === 'all' || t.lang === lang))
    .sort((a, b) => (b.fit - a.fit) || (b.heat - a.heat));
}

// ---------- original caption generator ----------
const PLACE = {
  zh: { night: ['夜色里的街口', '路灯下', '城市的夜', '凌晨前的广场'], city: ['街角', '老城区', '十字路口', '这座城市'], nature: ['旷野', '山坡上', '风里', '草地尽头'], portrait: ['镜头前', '这一刻', '窗边', '人群里'], daily: ['日常的缝隙', '楼下', '房间里', '今天'] },
  en: { night: ['the city at night', 'under streetlights', 'after midnight'], city: ['street corners', 'the old town', 'this city'], nature: ['the open field', 'somewhere green', 'the wind'], portrait: ['this frame', 'right here', 'the in-between'], daily: ['an ordinary day', 'small hours', 'today'] },
  ja: { night: ['夜の街', '街灯の下'], city: ['街角', 'この街'], nature: ['風の中', '野原'], portrait: ['この瞬間', '窓辺'], daily: ['ふつうの日', '今日'] },
};
const TIME = (an) => an.stats.lum < 0.3 ? { zh: '深夜', en: 'late night', ja: '夜' } : an.stats.warmth > 0.1 ? { zh: '傍晚', en: 'golden hour', ja: '夕方' } : { zh: '午后', en: 'afternoon', ja: '午後' };
const MOOD_EN = { 沉静: 'quiet', 明亮: 'bright', 温暖: 'warm', 清冷: 'cool', 鲜活: 'vivid', 克制: 'muted', 自然: 'easy' };

function colorName(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510;
  if (mx - mn < 24) return l < 0.25 ? ['墨黑', 'ink'] : l > 0.8 ? ['米白', 'ivory'] : ['灰调', 'grey'];
  const h = (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI + 360) % 360;
  if (h < 25 || h > 335) return ['砖红', 'brick'];
  if (h < 50) return ['焦糖', 'caramel'];
  if (h < 70) return ['麦黄', 'wheat'];
  if (h < 160) return ['雾绿', 'sage'];
  if (h < 200) return ['青蓝', 'teal'];
  if (h < 260) return ['墨蓝', 'navy'];
  return ['藕紫', 'mauve'];
}

const PATTERNS = {
  zh: {
    治愈: ['{time}的{place}，{mood}得刚刚好。', '把{obj}和{color}色的{time}一起收藏。', '{place}很慢，我也不急。'],
    冷淡: ['{place}。{time}。没别的。', '{color}，{obj}，和一点空白。', '记录 / {place} / {date}'],
    幽默: ['{obj}已入镜，本人仅作陪衬。', '今日 KPI：在{place}拍到{color}色。', '{time}出门，主打一个{mood}。'],
    文艺: ['{place}替我说完了没说的话。', '{color}是今天的底色，{obj}是注脚。', '有些{time}，只适合被拍下来。'],
    电影感: ['第 {n} 场 · {place} · {time} · 外景', '那天的{place}，像一部没有字幕的电影。', '{time}，{obj}，镜头没有喊停。'],
    旅行日记: ['Day {doy} · {place} · {color}', '{date} — 在{place}，晴转{mood}。', '去{place}的路上，顺手存下这一帧。'],
    时尚编辑: ['THE {COLOR} ISSUE — {place}', '{obj}，本季的{mood}主义。', 'LOOK {n} / {color}调 / {time}'],
  },
  en: {
    治愈: ['{place}, {mood} enough.', 'keeping this {time} for later.'], 冷淡: ['{place}. {time}. nothing else.', '{color}, {obj}, and some space.'],
    幽默: ['{obj} stole the shot. again.', 'mandatory {time} photo.'], 文艺: ['{place} said it better than me.', 'a {color} kind of {time}.'],
    电影感: ['scene {n}: {place}, {time}.', 'no subtitles, just {place}.'], 旅行日记: ['day {doy} — {place}', 'somewhere in {place}, {time}.'],
    时尚编辑: ['the {color} issue', 'look {n}: {mood} by design'],
  },
  ja: {
    治愈: ['{place}、ちょうどいい{time}。'], 冷淡: ['{place}。{time}。それだけ。'], 幽默: ['{time}の主役は、たぶん{obj}。'],
    文艺: ['{place}が、言葉の代わり。'], 电影感: ['第{n}幕・{place}・{time}'], 旅行日记: ['Day {doy}・{place}'], 时尚编辑: ['{color} ISSUE'],
  },
};

export function generateCaptions(an, { style, lang = 'zh', seed = 1, n = 4 } = {}) {
  const rng = mulberry32(seed * 101 + 17);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const styles = style ? [style] : Object.keys(PATTERNS.zh);
  const objsZh = (an.objects || []).filter(o => o.score > 0.4 && o.label !== 'person').map(o => labelCN(o.label));
  const objsEn = (an.objects || []).filter(o => o.score > 0.4 && o.label !== 'person').map(o => o.label);
  const hasPerson = (an.objects || []).some(o => o.label === 'person' && o.score > 0.5);
  const [cZh, cEn] = colorName(an.palette[1] || an.palette[0]);
  const now = new Date(), doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
  const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const out = [], seen = new Set();
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const st = pick(styles), L = PATTERNS[lang] || PATTERNS.zh, pats = L[st] || L[Object.keys(L)[0]];
    const tpl = pick(pats);
    const vars = {
      place: pick((PLACE[lang] || PLACE.zh)[an.scene] || PLACE.zh.daily),
      time: TIME(an)[lang] || TIME(an).zh,
      mood: lang === 'en' ? (MOOD_EN[an.mood[0]] || 'easy') : an.mood[0],
      obj: lang === 'en' ? (objsEn[0] || (hasPerson ? 'you' : 'the light')) : (objsZh[0] || (hasPerson ? (lang === 'ja' ? '君' : '你') : (lang === 'ja' ? '光' : '光'))),
      color: lang === 'en' ? cEn : cZh, COLOR: cEn.toUpperCase(), n: 3 + Math.floor(rng() * 40), doy, date,
    };
    const t = tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
    if (!seen.has(t)) { seen.add(t); out.push({ t, s: st, ai: true, lang }); }
  }
  return out;
}
