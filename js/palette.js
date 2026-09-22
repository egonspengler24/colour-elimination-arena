// v1 palette: 12 colours, chosen per SPEC.md §11 for maximum hue-spread
// (territory-plinko's `brighten()` preserves hue, so ball colour = hue of `tile`,
// lifted in lightness/saturation — see SPEC.md for the reasoning).

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function brighten(hex) {
  const [h, s, l] = hexToHsl(hex);
  const nl = Math.min(0.8, Math.max(0.55, l + 0.3));
  return `hsl(${h.toFixed(0)}, ${Math.round(Math.max(s, 0.5) * (s < 0.05 ? 0 : 100))}%, ${Math.round(nl * 100)}%)`;
}

const PALETTE = [
  { id: 'red',     label: 'Red',     tile: '#d40000' },
  { id: 'orange',  label: 'Orange',  tile: '#d9730d' },
  { id: 'brown',   label: 'Brown',   tile: '#7a3a00' },
  { id: 'mustard', label: 'Mustard', tile: '#a8a000' },
  { id: 'green',   label: 'Green',   tile: '#00a000' },
  { id: 'forest',  label: 'Forest',  tile: '#005a00' },
  { id: 'cyan',    label: 'Cyan',    tile: '#00b0b8' },
  { id: 'blue',    label: 'Blue',    tile: '#0000c8' },
  { id: 'purple',  label: 'Purple',  tile: '#6b00b5' },
  { id: 'magenta', label: 'Magenta', tile: '#b400b4' },
  { id: 'grey',    label: 'Grey',    tile: '#606060' },
  { id: 'silver',  label: 'Silver',  tile: '#b0b0b0' },
].map((c) => ({ ...c, ball: brighten(c.tile) }));
