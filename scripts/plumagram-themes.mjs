// PlumaGram: the colours of the Android app's built-in themes (Telegram X .tgx-theme files) for the web
// version, as src/plumagram/themes.json. Run: node scripts/plumagram-themes.mjs <dir with .tgx-theme files>

import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if(!dir) {
  console.error('usage: node scripts/plumagram-themes.mjs <themes dir>');
  process.exit(1);
}

function parse(file) {
  const theme = {props: {}, colors: {}};
  let section = '';
  for(const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if(!line) continue;
    if(line === '!' || line === '@' || line === '#') {
      section = line;
      continue;
    }
    const colon = line.lastIndexOf(':');
    if(colon === -1) continue;
    const keys = line.slice(0, colon).split(',').map((k) => k.trim());
    const value = line.slice(colon + 1).trim().replace(/^"|"$/g, '');
    for(const key of keys) {
      if(section === '!') theme[key] = value;
      else if(section === '@') theme.props[key] = +value;
      else if(section === '#') theme.colors[key] = value;
    }
  }
  return theme;
}

/** #RGB, #RRGGBB, #RRGGBBAA → #rrggbb (the alpha is dropped: these are solid colours) */
function hex(value) {
  if(!value) return;
  let v = value.replace('#', '');
  if(v.length === 3) v = v.split('').map((c) => c + c).join('');
  return '#' + v.slice(0, 6).toLowerCase();
}

const themes = fs.readdirSync(dir).filter((f) => f.endsWith('.tgx-theme')).map((f) => parse(path.join(dir, f)));
const byId = new Map(themes.map((t) => [+t.id, t]));

function color(theme, ...keys) {
  for(let t = theme, depth = 0; t && depth < 5; t = byId.get(t.props.parentTheme || 1) === t ? undefined : byId.get(t.props.parentTheme || 1), ++depth) {
    for(const key of keys) if(t.colors[key]) return hex(t.colors[key]);
  }
}

function luminance(h) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const out = themes.sort((a, b) => +a.id - +b.id).map((theme) => ({
  id: +theme.id,
  name: theme.name,
  // * a theme is dark by its colours too: «Black White» is not marked dark in its file
  dark: !!theme.props.dark || luminance(color(theme, 'filling')) < 0.3,
  colors: {
    'background-color': color(theme, 'background'),
    'surface-color': color(theme, 'filling'),
    'primary-color': color(theme, 'textNeutral', 'fillingPositive'),
    'primary-text-color': color(theme, 'text'),
    'secondary-text-color': color(theme, 'textLight'),
    'message-background-color': color(theme, 'bubbleIn_background'),
    'message-out-background-color': color(theme, 'bubbleOut_background'),
    'message-out-primary-color': color(theme, 'bubbleOut_textLink', 'bubbleOut_ticksRead', 'textNeutral'),
    'danger-color': color(theme, 'textNegative')
  }
}));

const target = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'plumagram', 'themes.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(out.map((t) => `${t.id} ${t.name}${t.dark ? ' (dark)' : ''}: ${t.colors['primary-color']} ${t.colors['surface-color']}`).join('\n'));
