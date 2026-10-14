/**
 * Original, deterministic "corporate portrait" generator.
 * Produces a studio-style SVG headshot of a person in business attire
 * (suit jacket + shirt/tie or blouse), unique per employee.
 * No external images, no licensing issues — upload a real photo in the admin to replace it.
 */
const FEMALE = new Set(['ava', 'priya', 'sofia', 'emily', 'emma', 'olivia', 'mia', 'sara', 'sarah', 'anna', 'maria', 'laura', 'julia', 'sophie', 'lily', 'grace', 'chloe', 'nina', 'elena', 'fatima', 'aisha', 'meera', 'neha', 'pooja', 'anita', 'divya', 'kavya', 'lisa', 'jessica', 'jennifer', 'amy', 'rachel', 'hannah', 'isabella', 'zoe', 'ruth', 'claire', 'karen', 'susan', 'linda', 'emily', 'amelia', 'charlotte', 'natalie', 'rebecca', 'katherine', 'kate', 'alice', 'eva', 'ana', 'carla', 'diana', 'irene', 'jane', 'jenny', 'monica', 'nora', 'sonia', 'tara', 'vera', 'yuki', 'mei', 'lin', 'ananya', 'ishita', 'riya', 'shreya', 'sneha', 'swati', 'kiran', 'deepa', 'lakshmi']);
const MALE_A = new Set(['luca', 'joshua', 'noah', 'elijah', 'nikita', 'kunal', 'krishna', 'ravi', 'sasha', 'jonah', 'ezra', 'mustafa', 'costa', 'barnaba']);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function guessFemale(name, r) {
  const first = String(name || '').trim().split(/\s+/)[0].toLowerCase();
  if (!first) return r() < 0.5;
  if (FEMALE.has(first)) return true;
  if (MALE_A.has(first)) return false;
  if (/(a|i|ie|ya|elle|ette)$/.test(first) && first.length > 3) return true;
  return false;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  const r = c(n >> 16), g = c((n >> 8) & 255), b = c(n & 255);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const SKIN = ['#f6d5bd', '#efc3a1', '#e0a982', '#c98b63', '#a86b45', '#7a4a2e', '#5a3622'];
const HAIR = ['#1a1412', '#2b1d14', '#4a3020', '#6b4a2f', '#8a6a45', '#b8956a', '#3a3a3c', '#d6d6d6'];
const SUIT = ['#1c1f26', '#232a3a', '#2f3136', '#14171c', '#3a3f4a', '#1f2a24'];
const TIE = ['#8b1d2c', '#1e3a6b', '#2d2d2d', '#5b2a6b', '#0f5a5a', '#8a6d1c'];
const BLOUSE = ['#f4f1ec', '#e9e4dc', '#dfe6ee', '#efe3e3'];

function avatarSVG(seedKey, name) {
  const r = rng(hash(String(seedKey)));
  const female = guessFemale(name, r);
  const skin = pick(r, SKIN), skinD = shade(skin, -22);
  const hair = pick(r, HAIR), suit = pick(r, SUIT), suitL = shade(suit, 16), suitD = shade(suit, -10);
  const tie = pick(r, TIE), blouse = pick(r, BLOUSE);
  const glasses = r() < 0.35;
  const style = female ? pick(r, ['long', 'bob', 'bun', 'wave']) : pick(r, ['short', 'side', 'crop', 'curly', 'bald']);
  const beard = !female && style !== 'bald' && r() < 0.3;
  const stubble = !female && !beard && r() < 0.25;
  const bgA = pick(r, ['#eceef1', '#e6e8ec', '#f0f0f2']), bgB = pick(r, ['#c9ced6', '#bfc5cf', '#d3d6dc']);
  const id = 'a' + hash(String(seedKey)).toString(36);

  let back = '', front = '';
  // hair (back layer drawn before the head, front layer after)
  if (style === 'long') {
    back = `<path d="M100 150 C92 100 120 84 150 84 C182 84 208 100 200 150 L206 262 C190 270 110 270 94 262 Z" fill="${hair}"/>`;
    front = `<path d="M103 162 C98 112 124 96 150 96 C178 96 204 110 197 162 C190 134 172 122 150 122 C128 122 110 134 103 162Z" fill="${hair}"/><path d="M150 100 C132 112 114 130 106 160 C122 132 136 122 150 120Z" fill="${shade(hair, 14)}" opacity=".6"/>`;
  } else if (style === 'bob') {
    back = `<path d="M99 160 C92 104 120 86 150 86 C182 86 208 104 201 160 L204 214 C186 224 114 224 96 214 Z" fill="${hair}"/>`;
    front = `<path d="M102 160 C98 112 124 97 150 97 C178 97 204 112 198 160 C192 138 176 124 150 124 C124 124 108 138 102 160Z" fill="${hair}"/>`;
  } else if (style === 'bun') {
    back = `<circle cx="150" cy="82" r="20" fill="${hair}"/>`;
    front = `<path d="M103 162 C98 112 124 96 150 96 C178 96 204 112 197 162 C190 136 172 122 150 122 C128 122 110 136 103 162Z" fill="${hair}"/>`;
  } else if (style === 'wave') {
    back = `<path d="M98 160 C88 104 118 82 150 82 C184 82 212 104 202 160 L212 236 C196 250 104 250 88 236 Z" fill="${hair}"/>`;
    front = `<path d="M104 160 C96 112 126 94 150 98 C176 96 206 112 196 160 C186 126 160 120 138 126 C122 130 110 142 104 160Z" fill="${hair}"/>`;
  } else if (style === 'curly') {
    back = '';
    front = `<g fill="${hair}"><circle cx="112" cy="132" r="19"/><circle cx="132" cy="112" r="21"/><circle cx="158" cy="108" r="22"/><circle cx="184" cy="122" r="20"/><circle cx="198" cy="146" r="14"/><circle cx="104" cy="152" r="13"/></g>`;
  } else if (style === 'side') {
    front = `<path d="M103 162 C96 108 128 92 156 96 C186 98 206 120 197 162 C192 140 182 128 160 124 C140 128 116 130 103 162Z" fill="${hair}"/><path d="M118 116 C138 104 168 106 186 122" fill="none" stroke="${shade(hair, 22)}" stroke-width="3" stroke-linecap="round" opacity=".7"/>`;
  } else if (style === 'crop') {
    front = `<path d="M104 160 C98 112 124 98 150 98 C178 98 204 112 196 160 C192 142 178 132 150 132 C122 132 108 142 104 160Z" fill="${hair}"/>`;
  } else { // bald
    front = `<path d="M108 138 C112 112 130 102 150 102 C170 102 188 112 192 138 C180 120 120 120 108 138Z" fill="${skinD}" opacity=".28"/>`;
  }

  const beardSvg = beard
    ? `<path d="M106 176 C108 222 130 236 150 236 C170 236 192 222 194 176 C186 198 172 206 150 206 C128 206 114 198 106 176Z" fill="${hair}"/><path d="M134 200 Q150 208 166 200" fill="none" stroke="${shade(skin, -40)}" stroke-width="2.4" stroke-linecap="round"/>`
    : '';
  const stubbleSvg = stubble
    ? `<path d="M108 184 C112 222 132 232 150 232 C168 232 188 222 192 184 C184 204 170 210 150 210 C130 210 116 204 108 184Z" fill="#000" opacity=".12"/>`
    : '';

  const inner = female
    ? `<path d="M120 250 L150 306 L180 250 Z" fill="${blouse}"/><path d="M128 252 Q150 288 172 252" fill="none" stroke="${shade(blouse, -30)}" stroke-width="1.4"/>
       <path d="M132 262 Q150 292 168 262" fill="none" stroke="#c9b27a" stroke-width="1.6"/><circle cx="150" cy="291" r="3.2" fill="#c9b27a"/>`
    : `<path d="M120 250 L150 316 L180 250 Z" fill="#fbfbfb"/>
       <path d="M120 250 L146 280 L126 296 Z" fill="#ffffff" stroke="#d6d9de" stroke-width="1"/><path d="M180 250 L154 280 L174 296 Z" fill="#ffffff" stroke="#d6d9de" stroke-width="1"/>
       <path d="M144 280 L156 280 L152 290 L148 290 Z" fill="${shade(tie, 14)}"/><path d="M148 290 L152 290 L160 346 L150 358 L140 346 Z" fill="${tie}"/>
       <path d="M148 292 L150 350" stroke="${shade(tie, 30)}" stroke-width="1" opacity=".5"/>`;

  const pocket = !female && r() < 0.6
    ? `<path d="M206 318 L226 316 L226 326 L206 328 Z" fill="#f2f2f2"/><path d="M206 318 L216 322 L226 316" fill="none" stroke="#cfcfcf" stroke-width="1"/>` : '';

  const eyeY = 170;
  const glassesSvg = glasses
    ? `<g fill="none" stroke="#202225" stroke-width="2.4"><rect x="112" y="${eyeY - 11}" width="30" height="22" rx="8"/><rect x="158" y="${eyeY - 11}" width="30" height="22" rx="8"/><path d="M142 ${eyeY - 2} Q150 ${eyeY - 6} 158 ${eyeY - 2}"/><path d="M112 ${eyeY - 4} L104 ${eyeY - 8}"/><path d="M188 ${eyeY - 4} L196 ${eyeY - 8}"/></g>` : '';
  const earrings = female ? `<circle cx="103" cy="190" r="3" fill="#c9b27a"/><circle cx="197" cy="190" r="3" fill="#c9b27a"/>` : '';
  const lip = female ? '#b5565f' : shade(skin, -48);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 360" role="img" aria-label="Professional portrait">
<defs>
<linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/></linearGradient>
<radialGradient id="${id}v" cx=".5" cy=".38" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient>
<linearGradient id="${id}j" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${suitL}"/><stop offset="1" stop-color="${suitD}"/></linearGradient>
</defs>
<rect width="300" height="360" fill="url(#${id}b)"/>
${back}
<path d="M14 360 C14 292 66 262 120 250 L180 250 C234 262 286 292 286 360 Z" fill="url(#${id}j)"/>
<path d="M132 214 L168 214 L171 256 Q150 280 129 256 Z" fill="${skinD}"/>
${inner}
<path d="M116 248 L124 252 L152 322 L132 340 L104 290 Z" fill="${suitD}"/><path d="M184 248 L176 252 L148 322 L168 340 L196 290 Z" fill="${suitD}"/>
<path d="M116 248 L152 322" stroke="${suitL}" stroke-width="1.5" opacity=".6"/><path d="M184 248 L148 322" stroke="${suitL}" stroke-width="1.5" opacity=".6"/>
${pocket}
<ellipse cx="104" cy="176" rx="7" ry="11" fill="${skin}"/><ellipse cx="196" cy="176" rx="7" ry="11" fill="${skin}"/>
${earrings}
<ellipse cx="150" cy="170" rx="46" ry="57" fill="${skin}"/>
<ellipse cx="150" cy="196" rx="40" ry="30" fill="${skinD}" opacity=".12"/>
${stubbleSvg}${beardSvg}
${front}
<g fill="#1f1b19"><ellipse cx="127" cy="${eyeY}" rx="5" ry="3.2"/><ellipse cx="173" cy="${eyeY}" rx="5" ry="3.2"/></g>
<g fill="#fff" opacity=".85"><circle cx="128.6" cy="${eyeY - 1}" r="1.1"/><circle cx="174.6" cy="${eyeY - 1}" r="1.1"/></g>
<g fill="none" stroke="${shade(hair, -6)}" stroke-width="3" stroke-linecap="round"><path d="M116 ${eyeY - 12} Q127 ${eyeY - 17} 138 ${eyeY - 12}"/><path d="M162 ${eyeY - 12} Q173 ${eyeY - 17} 184 ${eyeY - 12}"/></g>
<path d="M150 176 Q145 192 150 196 Q154 197 156 195" fill="none" stroke="${shade(skin, -38)}" stroke-width="2" stroke-linecap="round"/>
<path d="M135 212 Q150 224 165 212" fill="none" stroke="${lip}" stroke-width="3" stroke-linecap="round"/>
${glassesSvg}
<rect width="300" height="360" fill="url(#${id}v)"/>
</svg>`;
}

module.exports = { avatarSVG };
