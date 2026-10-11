// Die-cut darkroom stickers (inline SVG). The cream die-cut edge comes from the shared #die filter in index.html.
const S = (body, vb = '0 0 120 120') => `<svg class="dstk" viewBox="${vb}" aria-hidden="true"><g filter="url(#die)">${body}</g></svg>`;
const MONO = "font-family:'JetBrains Mono',monospace;font-weight:700";
const SERIF = "font-family:'Zen Old Mincho','Noto Serif SC',serif;font-weight:900";

export const STICKERS = {
  // 35 mm canister with the tongue pulled out
  canister: S(`<rect x="50" y="12" width="14" height="10" rx="2" fill="#3b352e"/>
    <rect x="28" y="20" width="58" height="10" rx="3" fill="#2a2520"/><rect x="28" y="90" width="58" height="10" rx="3" fill="#2a2520"/>
    <rect x="30" y="28" width="54" height="64" fill="#1b1815"/>
    <rect x="30" y="44" width="54" height="30" fill="#ff4836"/>
    <text x="57" y="63" text-anchor="middle" style="${MONO};font-size:12px;fill:#fff;letter-spacing:.5px">DR 400</text>
    <rect x="84" y="50" width="28" height="22" fill="#c9762f"/>
    ${[0, 1, 2].map(i => `<rect x="${88 + i * 8}" y="52" width="4" height="4" rx="1" fill="#1b1815"/><rect x="${88 + i * 8}" y="66" width="4" height="4" rx="1" fill="#1b1815"/>`).join('')}
    <path d="M36 28v64" stroke="#fff" stroke-opacity=".12" stroke-width="5"/>`),
  // round safelight badge with circular type
  safelight: S(`<defs><radialGradient id="slg" cx=".45" cy=".4"><stop offset="0" stop-color="#ff7a5c"/><stop offset=".6" stop-color="#ff4836"/><stop offset="1" stop-color="#b8241a"/></radialGradient>
    <path id="slp" d="M60 60m-37 0a37 37 0 1 1 74 0a37 37 0 1 1 -74 0"/></defs>
    <circle cx="60" cy="60" r="50" fill="url(#slg)"/><circle cx="60" cy="60" r="27" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>
    <text style="${MONO};font-size:9.4px;fill:#fff;letter-spacing:2.6px"><textPath href="#slp">SAFELIGHT ON · DARKROOM · SAFELIGHT ON · </textPath></text>
    <path d="M60 45c-7 0-11 5-11 11 0 5 3 7 5 10h12c2-3 5-5 5-10 0-6-4-11-11-11z" fill="#fff"/><rect x="54" y="69" width="12" height="5" rx="1.5" fill="#fff"/>`),
  // 朱印 — vermilion seal
  seal: S(`<g transform="rotate(-7 60 60)"><rect x="22" y="22" width="76" height="76" rx="8" fill="#c8281e"/>
    <rect x="29" y="29" width="62" height="62" rx="3" fill="none" stroke="#f6eadb" stroke-width="2.4"/>
    <text x="60" y="56" text-anchor="middle" style="${SERIF};font-size:25px;fill:#f6eadb">暗</text>
    <text x="60" y="84" text-anchor="middle" style="${SERIF};font-size:25px;fill:#f6eadb">房</text></g>`),
  // loupe over a crop mark
  loupe: S(`<path d="M74 78l26 26" stroke="#1b1815" stroke-width="12" stroke-linecap="round"/>
    <circle cx="52" cy="52" r="34" fill="#e9e3d8"/><circle cx="52" cy="52" r="34" fill="none" stroke="#1b1815" stroke-width="7"/>
    <path d="M36 44v-8h8M68 60v8h-8" fill="none" stroke="#ff4836" stroke-width="3.5" stroke-linecap="round"/>
    <rect x="44" y="44" width="16" height="16" fill="none" stroke="#ff4836" stroke-width="1.6" stroke-dasharray="3 2"/>
    <path d="M30 40a25 25 0 0 1 14-14" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none"/>`),
  // instant print with tape
  polaroid: S(`<g transform="rotate(6 60 60)"><rect x="24" y="16" width="72" height="88" rx="2" fill="#f7f3ec"/>
    <rect x="31" y="23" width="58" height="58" fill="#1f1b17"/><circle cx="72" cy="40" r="7" fill="#ff4836"/>
    <path d="M31 81l18-20 12 12 10-8 18 16z" fill="#3c362f"/>
    <path d="M38 92h30" stroke="#8b847a" stroke-width="2.4" stroke-linecap="round"/></g>
    <rect x="42" y="6" width="34" height="14" rx="1" fill="#ffb340" fill-opacity=".9" transform="rotate(-4 60 13)"/>`),
  // Live concentric rings
  live: S(`<circle cx="60" cy="60" r="46" fill="#1b1815"/>
    <circle cx="60" cy="60" r="36" fill="none" stroke="#f3ede2" stroke-width="2.6" stroke-dasharray="1.5 5" stroke-linecap="round"/>
    <circle cx="60" cy="60" r="24" fill="none" stroke="#f3ede2" stroke-width="3"/>
    <circle cx="60" cy="60" r="11" fill="#ff4836"/>`),
  // developer timer
  timer: S(`<circle cx="60" cy="62" r="44" fill="#f3ede2"/><circle cx="60" cy="62" r="44" fill="none" stroke="#1b1815" stroke-width="6"/>
    <rect x="52" y="8" width="16" height="10" rx="2" fill="#1b1815"/>
    ${Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2; return `<path d="M${60 + Math.sin(a) * 34} ${62 - Math.cos(a) * 34}L${60 + Math.sin(a) * 39} ${62 - Math.cos(a) * 39}" stroke="#1b1815" stroke-width="${i % 3 ? 1.5 : 3}"/>`; }).join('')}
    <path d="M60 62L60 30" stroke="#ff4836" stroke-width="3.5" stroke-linecap="round"/><path d="M60 62l17 10" stroke="#1b1815" stroke-width="3" stroke-linecap="round"/>
    <circle cx="60" cy="62" r="4" fill="#1b1815"/>
    <text x="60" y="92" text-anchor="middle" style="${MONO};font-size:8px;fill:#1b1815;letter-spacing:1px">DEV 20°C</text>`),
  // door sign
  donotopen: S(`<g transform="rotate(-5 80 50)"><rect x="8" y="16" width="144" height="70" rx="8" fill="#ff4836"/>
    <circle cx="80" cy="26" r="4" fill="#7a1810"/>
    <text x="80" y="58" text-anchor="middle" style="font-family:Inter,sans-serif;font-weight:800;font-size:25px;fill:#fff;letter-spacing:1px">DARKROOM</text>
    <rect x="22" y="66" width="116" height="1.4" fill="#fff" fill-opacity=".6"/>
    <text x="80" y="79" text-anchor="middle" style="${MONO};font-size:8.6px;fill:#fff;letter-spacing:2.4px">IN USE · DO NOT OPEN</text></g>`, '0 0 160 100'),
};
export const sticker = (k, cls = '') => `<span class="sticker ${cls}" data-stk="${k}">${STICKERS[k]}</span>`;
