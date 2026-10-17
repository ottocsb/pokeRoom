export interface ThemeDef {
  id: string;
  name: string;
  tagline: string;
}

export const THEMES: ThemeDef[] = [
  { id: 'classic', name: '经典绿呢', tagline: '赌场传统 · 胡桃木桌沿' },
  { id: 'neon', name: '午夜霓虹', tagline: '赛博夜店 · 发光线条' },
  { id: 'royal', name: '皇家酒红', tagline: '天鹅绒 · 鎏金纹章' },
  { id: 'ink', name: '东方墨韵', tagline: '宣纸青山 · 朱砂印章' },
];

const KEY = 'holdem-theme';

export function loadTheme(): string {
  try {
    const t = localStorage.getItem(KEY);
    if (t && THEMES.some((x) => x.id === t)) return t;
  } catch {
    /* ignore */
  }
  return 'classic';
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}
