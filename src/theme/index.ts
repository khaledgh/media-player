import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#1C1C24',
  surface: '#24242E',
  surface2: '#2E2E3A',
  line: '#34343F',
  text: '#FFFFFF',
  muted: '#A0A0AB',
  faint: '#6E6E7A',
  brand: '#FF8216',
  brandSoft: 'rgba(255,130,22,0.14)',
  danger: '#F0525A',
  ok: '#3CCF8E',
  overlay: 'rgba(10,10,14,0.65)',
};

export const font = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

export const type = StyleSheet.create({
  h1: { fontFamily: font.semibold, fontSize: 24, color: colors.text },
  h2: { fontFamily: font.semibold, fontSize: 20, color: colors.text },
  h3: { fontFamily: font.semibold, fontSize: 16, color: colors.text },
  body: { fontFamily: font.regular, fontSize: 14, color: colors.text },
  bodyMedium: { fontFamily: font.medium, fontSize: 14, color: colors.text },
  caption: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
  tiny: { fontFamily: font.regular, fontSize: 11, color: colors.muted },
  link: { fontFamily: font.medium, fontSize: 13, color: colors.brand },
});

/** Deterministic gradient pair for tracks without cover art. */
export function artGradient(seed: string | number): [string, string] {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return [`hsl(${hue}, 70%, 52%)`, `hsl(${(hue + 40) % 360}, 65%, 28%)`];
}

export function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

export function formatDurationMs(ms: number) {
  return ms ? `${formatTime(ms / 1000)} mins` : '';
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
