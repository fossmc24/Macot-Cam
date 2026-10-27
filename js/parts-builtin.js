// =====================================================================
//  BUILT-IN PART LIBRARY — the hand-drawn assets that ship with the app.
//
//  2D parts draw themselves with canvas code in draw(g, s, color, f),
//  where s = face width in pixels and +y is down.
//
//  3D parts are three.js models built from primitive shapes in build(color).
//  Units: 1 = face width, +y is up, +z points out of the face. They are
//  created by buildParts3D(T) so three.js can stay a lazy import.
//
//  The placement numbers here are the DEFAULTS. A calibration record from
//  the admin page can override offset, rotation, scale and the tap circle —
//  see js/calibration.js.
// =====================================================================

// ---------- 2D drawing helpers ----------
export const shade = (hex, amt) => {           // amt < 0 darker, > 0 lighter
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, a = Math.abs(amt);
  r = Math.round(r + (t - r) * a); g = Math.round(g + (t - g) * a); b = Math.round(b + (t - b) * a);
  return `rgb(${r},${g},${b})`;
};
export const circle = (g, x, y, r, fill) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
export const star = (g, x, y, r, fill) => {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fillStyle = fill; g.fill();
};
const both = fn => { fn(-1); fn(1); };

export const PARTS_2D = {
  // Ear parts get "f" too: f.brow = eyebrows raised (0–1), f.blink (0–1),
  // f.swing / f.bounce = how much the head just moved (for floppy physics), f.t = time.
  ears: [
    { id: 'bearEars', name: 'Bear ears', tip: 'raise your eyebrows', color: '#7a4a24', cy: -0.28, r: 0.62, draw(g, s, c, f) {
      both(k => {
        g.save(); g.translate(k * s * .42, -s * .28);
        g.rotate(k * Math.sin(f.t * 18) * .3 * f.brow + f.swing * .25);   // wiggle
        circle(g, 0, 0, s * .2, c); circle(g, 0, 0, s * .11, '#e9a8a0');
        g.restore();
      });
    }},
    { id: 'tigerEars', name: 'Tiger ears', tip: 'raise your eyebrows or blink', color: '#f08a1c', cy: -0.25, r: 0.62, draw(g, s, c, f) {
      both(k => {
        g.save(); g.translate(k * s * .4, -s * .1 - f.brow * s * .1);          // perk up
        g.rotate(k * (f.blink * .35 + Math.sin(f.t * 30) * .05 * f.blink));      // twitch on blink
        g.beginPath(); g.moveTo(-k * s * .15, -s * .02); g.lineTo(k * s * .08, -s * .4); g.lineTo(k * s * .18, s * .02); g.closePath();
        g.fillStyle = c; g.fill(); g.lineWidth = s * .03; g.strokeStyle = '#1b1b1b'; g.stroke();
        g.restore();
      });
      g.strokeStyle = '#1b1b1b'; g.lineCap = 'round'; g.lineWidth = s * .045;
      for (const dx of [-.12, 0, .12]) { g.beginPath(); g.moveTo(dx * s, s * .02); g.lineTo(dx * s * .7, s * .2); g.stroke(); }
    }},
    { id: 'catEars', name: 'Cat ears', tip: 'raise your eyebrows or blink', color: '#2b2b2b', cy: -0.3, r: 0.48, draw(g, s, c, f) {
      both(k => {
        g.save(); g.translate(k * s * .36, -s * .12 - f.brow * s * .12);
        g.rotate(k * (.15 - f.brow * .15 + f.blink * .4) + f.swing * .15);
        g.beginPath(); g.moveTo(-s * .14, 0); g.quadraticCurveTo(-s * .06, -s * .3, 0, -s * .38); g.quadraticCurveTo(s * .06, -s * .3, s * .14, 0); g.closePath();
        g.fillStyle = c; g.fill();
        g.beginPath(); g.moveTo(-s * .07, -s * .03); g.quadraticCurveTo(0, -s * .26, s * .07, -s * .03); g.closePath();
        g.fillStyle = '#f4a7b9'; g.fill();
        g.restore();
      });
    }},
    { id: 'bunnyEars', name: 'Bunny ears', tip: 'raise your eyebrows to stand them up', color: '#f2f2f2', cy: -0.55, r: 0.58, draw(g, s, c, f) {
      both(k => {
        g.save(); g.translate(k * s * .17, -s * .28);
        g.rotate(k * (1 - f.brow) * .6 + f.swing * .5);                          // droop unless eyebrows are up
        g.beginPath(); g.ellipse(0, -s * .42, s * .1, s * .42, 0, 0, Math.PI * 2); g.fillStyle = c; g.fill();
        g.strokeStyle = shade(c, -.25); g.lineWidth = s * .012; g.stroke();
        g.beginPath(); g.ellipse(0, -s * .4, s * .05, s * .32, 0, 0, Math.PI * 2); g.fillStyle = '#f7a8bd'; g.fill();
        g.restore();
      });
    }},
    // "side" ears attach to each side of the face at ear level (one ear per side, drawn
    // pointing outward). hit = tap area for one ear; cy/r frame the pair in the tray picture.
    { id: 'dogEars', name: 'Floppy ears', tip: 'shake your head', color: '#8a5a32', side: true, cy: 0.34, r: 0.8,
      hit: { cx: .04, cy: .27, r: .34 }, draw(g, s, c, f) {
      g.save(); g.translate(0, -s * .05);                                     // hinge just above eye level, where the real ear starts
      g.rotate(-f.brow * .5 - f.bounce * .4 + f.swing * 1.1 * f.sx);          // swings with the head
      g.beginPath();
      g.moveTo(-s * .05, 0);
      g.bezierCurveTo(-s * .17, s * .18, -s * .13, s * .6, s * .05, s * .62);
      g.bezierCurveTo(s * .22, s * .6, s * .21, s * .18, s * .07, 0);
      g.closePath();
      g.fillStyle = c; g.fill(); g.strokeStyle = shade(c, -.3); g.lineWidth = s * .012; g.stroke();
      g.restore();
    }},
    { id: 'elephantEars', name: 'Elephant ears', tip: 'raise your eyebrows to flap', color: '#9aa0a6', side: true, cy: 0.16, r: 0.85,
      hit: { cx: .2, cy: .16, r: .36 }, draw(g, s, c, f) {
      const flap = 1 + Math.sin(f.t * 12) * .3 * f.brow + Math.abs(f.swing) * .3;
      g.save(); g.scale(flap, 1);                                              // flaps outward from the side of the face
      g.beginPath(); g.ellipse(s * .2, s * .16, s * .24, s * .33, 0, 0, Math.PI * 2); g.fillStyle = c; g.fill();
      g.beginPath(); g.ellipse(s * .2, s * .16, s * .15, s * .23, 0, 0, Math.PI * 2); g.fillStyle = '#e7b3bb'; g.fill();
      g.restore();
    }},
    { id: 'mouseEars', name: 'Mouse ears', tip: 'move your head', color: '#1b1b1b', cy: -0.32, r: 0.66, draw(g, s, c, f) {
      both(k => {
        g.save(); g.translate(k * s * .4, -s * .32 + f.bounce * s * .15);
        g.rotate(f.swing * .3); g.scale(1 + f.bounce * .2, 1 - f.bounce * .2);
        circle(g, 0, 0, s * .24, c); circle(g, 0, 0, s * .14, shade(c, .25));
        g.restore();
      });
    }},
    { id: 'antennae', name: 'Antennae', tip: 'move your head', color: '#00843d', cy: -0.35, r: 0.48, draw(g, s, c, f) {
      g.strokeStyle = c; g.lineWidth = s * .025; g.lineCap = 'round';
      both(k => {
        const bx = k * s * .14, by = -s * .1;
        const tx = k * s * .3 + f.swing * s * .3, ty = -s * .62 + f.bounce * s * .2 - f.brow * s * .08;
        g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(k * s * .12 + f.swing * s * .1, -s * .4, tx, ty); g.stroke();
        circle(g, tx, ty, s * .065, shade(c, .35));
      });
    }}
  ],
  head: [
    { id: 'horns', name: 'Horns', color: '#c8102e', cy: -0.3, r: 0.5, draw(g, s, c) {
      both(k => {
        g.beginPath(); g.moveTo(k * s * .12, -s * .06);
        g.quadraticCurveTo(k * s * .16, -s * .36, k * s * .42, -s * .54);
        g.quadraticCurveTo(k * s * .40, -s * .22, k * s * .32, -s * .04);
        g.closePath(); g.fillStyle = c; g.fill();
        g.lineWidth = s * .02; g.strokeStyle = shade(c, -.4); g.stroke();
      });
    }},
    { id: 'cap', name: 'Ball cap', color: '#0b3d91', cy: -0.12, r: 0.58, draw(g, s, c) {
      g.translate(0, s * .1);   // brim sits on the forehead
      g.beginPath(); g.ellipse(0, -s * .02, s * .5, s * .46, 0, Math.PI, Math.PI * 2); g.closePath();
      g.fillStyle = c; g.fill();
      g.strokeStyle = shade(c, -.35); g.lineWidth = s * .015;
      for (const dx of [-.22, .22]) { g.beginPath(); g.moveTo(0, -s * .48); g.quadraticCurveTo(dx * s, -s * .3, dx * s * 1.4, -s * .03); g.stroke(); }
      star(g, 0, -s * .2, s * .1, '#ffffff');
      g.beginPath(); g.ellipse(0, -s * .02, s * .56, s * .1, 0, 0, Math.PI); g.fillStyle = shade(c, -.3); g.fill();
      circle(g, 0, -s * .48, s * .035, shade(c, -.35));
    }},
    { id: 'topHat', name: 'Top hat', color: '#1b1b1b', cy: -0.4, r: 0.62, draw(g, s, c) {
      g.fillStyle = c; g.fillRect(-s * .3, -s * .8, s * .6, s * .74);
      g.fillStyle = '#c8102e'; g.fillRect(-s * .3, -s * .2, s * .6, s * .08);
      g.beginPath(); g.ellipse(0, -s * .06, s * .52, s * .08, 0, 0, Math.PI * 2); g.fillStyle = c; g.fill();
      g.strokeStyle = shade(c, .25); g.lineWidth = s * .012; g.strokeRect(-s * .3, -s * .8, s * .6, s * .74);
    }},
    { id: 'crown', name: 'Crown', color: '#ffb81c', cy: -0.25, r: 0.48, draw(g, s, c) {
      g.beginPath(); g.moveTo(-s * .36, -s * .04);
      const peaks = [-.36, -.18, 0, .18, .36];
      peaks.forEach((x, i) => { g.lineTo(x * s, -s * .46); if (i < 4) g.lineTo((x + .09) * s, -s * .24); });
      g.lineTo(s * .36, -s * .04); g.closePath();
      g.fillStyle = c; g.fill(); g.strokeStyle = shade(c, -.35); g.lineWidth = s * .02; g.stroke();
      peaks.forEach(x => circle(g, x * s, -s * .46, s * .035, '#ffffff'));
      circle(g, 0, -s * .14, s * .05, '#c8102e');
    }}
  ],
  eyes: [
    { id: 'shades', name: 'Sunglasses', color: '#1b1b1b', cy: 0.02, r: 0.42, draw(g, s, c) {
      both(k => {
        g.beginPath(); g.roundRect(k * s * .2 - s * .15, -s * .07, s * .3, s * .18, s * .06); g.fillStyle = c; g.fill();
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(k * s * .2 - s * .1, -s * .05, s * .07, s * .04);
      });
      g.fillStyle = c; g.fillRect(-s * .06, -s * .04, s * .12, s * .035);
    }},
    { id: 'glasses', name: 'Round glasses', color: '#ffb81c', cy: 0.02, r: 0.42, draw(g, s, c) {
      g.strokeStyle = c; g.lineWidth = s * .03;
      both(k => { g.beginPath(); g.arc(k * s * .2, s * .02, s * .13, 0, Math.PI * 2); g.stroke(); });
      g.beginPath(); g.moveTo(-s * .07, 0); g.quadraticCurveTo(0, -s * .04, s * .07, 0); g.stroke();
    }},
    { id: 'eyeBlack', name: 'Eye black', color: '#1b1b1b', cy: 0.15, r: 0.36, draw(g, s, c) {
      both(k => { g.beginPath(); g.roundRect(k * s * .2 - s * .1, s * .13, s * .2, s * .05, s * .02); g.fillStyle = c; g.fill(); });
    }},
    { id: 'mask', name: 'Hero mask', color: '#c8102e', cy: 0.02, r: 0.44, draw(g, s, c) {
      g.beginPath(); g.ellipse(0, s * .02, s * .42, s * .14, 0, 0, Math.PI * 2);
      both(k => { g.moveTo(k * s * .2 + s * .08, s * .02); g.ellipse(k * s * .2, s * .02, s * .08, s * .055, 0, 0, Math.PI * 2); });
      g.fillStyle = c; g.fill('evenodd');
    }}
  ],
  nose: [
    { id: 'bearNose', name: 'Bear nose', color: '#2b1a10', cy: 0, r: 0.15, draw(g, s, c) {
      g.beginPath(); g.ellipse(0, 0, s * .12, s * .085, 0, 0, Math.PI * 2); g.fillStyle = c; g.fill();
      circle(g, -s * .035, -s * .03, s * .025, 'rgba(255,255,255,.6)');
    }},
    { id: 'tigerNose', name: 'Cat nose', color: '#ff7aa2', cy: 0.02, r: 0.13, draw(g, s, c) {
      g.beginPath(); g.moveTo(-s * .08, -s * .02); g.lineTo(s * .08, -s * .02); g.lineTo(0, s * .07); g.closePath();
      g.fillStyle = c; g.fill();
    }},
    { id: 'clownNose', name: 'Clown nose', color: '#e01b24', cy: 0, r: 0.13, draw(g, s, c) {
      circle(g, 0, 0, s * .1, c); circle(g, -s * .03, -s * .035, s * .025, 'rgba(255,255,255,.7)');
    }}
  ],
  cheeks: [
    { id: 'blush', name: 'Blush', color: '#ff6f91', cy: 0, r: 0.13, draw(g, s, c) {
      g.globalAlpha = .5; circle(g, 0, 0, s * .09, c); g.globalAlpha = 1;
    }},
    { id: 'stripes', name: 'Face paint', color: '#0b3d91', cy: 0, r: 0.13, draw(g, s, c) {
      g.lineCap = 'round'; g.lineWidth = s * .04;
      [[c, -.035], ['#ffffff', .035]].forEach(([col, dy]) => {
        g.strokeStyle = col; g.beginPath(); g.moveTo(-s * .07, dy * s + s * .03); g.lineTo(s * .07, dy * s - s * .03); g.stroke();
      });
    }},
    { id: 'cheekStar', name: 'Star', color: '#ffb81c', cy: 0, r: 0.12, draw(g, s, c) { star(g, 0, 0, s * .08, c); } }
  ],
  // Mouth parts get "f": f.gap = how open the mouth is, f.w = mouth width (both in face units), f.t = time (for wiggles).
  mouth: [
    { id: 'tongue', name: 'Crazy tongue', color: '#ff5c8a', cy: 0.16, r: 0.22, draw(g, s, c, f) {
      const top = f.gap / 2 * s;
      const len = Math.min(.5, .1 + f.gap * 2.6) * s;           // sticks out farther the wider you open
      const sway = Math.sin(f.t * 9) * Math.min(.45, f.gap * 3); // wiggles when your mouth is open
      g.save(); g.translate(0, top); g.rotate(sway);
      const hw = s * .1;
      g.beginPath();
      g.moveTo(-hw, 0);
      g.bezierCurveTo(-hw * 1.15, len * .6, -hw * .9, len, 0, len);
      g.bezierCurveTo(hw * .9, len, hw * 1.15, len * .6, hw, 0);
      g.closePath();
      g.fillStyle = c; g.fill();
      g.strokeStyle = shade(c, -.3); g.lineWidth = s * .012; g.stroke();
      g.beginPath(); g.moveTo(0, len * .12); g.lineTo(0, len * .7); g.stroke();
      g.restore();
    }},
    { id: 'teeth', name: 'Monster teeth', color: '#ffffff', cy: 0, r: 0.22, draw(g, s, c, f) {
      const w = Math.max(.3, f.w) * s * 1.05, half = f.gap / 2 * s, n = 6, step = w / n;
      const tooth = Math.max(s * .045, half * .9);
      g.fillStyle = c; g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = s * .008;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + i * step;
        g.beginPath(); g.moveTo(x, -half - s * .01); g.lineTo(x + step, -half - s * .01); g.lineTo(x + step / 2, -half + tooth); g.closePath(); g.fill(); g.stroke();
        if (i > 0 && i < n - 1) {
          g.beginPath(); g.moveTo(x, half + s * .01); g.lineTo(x + step, half + s * .01); g.lineTo(x + step / 2, half - tooth * .8); g.closePath(); g.fill(); g.stroke();
        }
      }
    }},
    { id: 'lips', name: 'Big lips', color: '#d1123f', cy: 0, r: 0.22, draw(g, s, c, f) {
      const w = Math.max(.3, f.w) * s * .65, half = f.gap / 2 * s, th = s * .07;
      g.fillStyle = c;
      g.beginPath();                                        // top lip
      g.moveTo(-w, 0);
      g.quadraticCurveTo(-w * .5, -half - th * 1.3, 0, -half - th * .8);
      g.quadraticCurveTo(w * .5, -half - th * 1.3, w, 0);
      g.quadraticCurveTo(0, -half + th * .1, -w, 0);
      g.fill();
      g.beginPath();                                        // bottom lip
      g.moveTo(-w, 0);
      g.quadraticCurveTo(0, half + th * 2, w, 0);
      g.quadraticCurveTo(0, half - th * .1, -w, 0);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.beginPath(); g.ellipse(w * .25, half + th * .55, w * .18, th * .18, 0, 0, Math.PI * 2); g.fill();
    }},
    { id: 'buck', name: 'Buck teeth', color: '#fffbe8', cy: 0.04, r: 0.13, draw(g, s, c, f) {
      const top = -f.gap / 2 * s - s * .01;
      both(k => {
        g.beginPath(); g.roundRect(k > 0 ? s * .005 : -s * .065, top, s * .06, s * .1, [0, 0, s * .02, s * .02]);
        g.fillStyle = c; g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = s * .008; g.stroke();
      });
    }},
    { id: 'bubble', name: 'Bubble gum', color: '#ff8fc7', cy: 0.12, r: 0.26, thumbF: { gap: .06 }, draw(g, s, c, f) {
      const r = Math.min(.55, .05 + f.gap * 2.8) * s;         // blow it up by opening your mouth
      g.globalAlpha = .9; circle(g, 0, r * .55, r, c); g.globalAlpha = 1;
      g.strokeStyle = shade(c, -.2); g.lineWidth = s * .01;
      g.beginPath(); g.arc(0, r * .55, r, 0, Math.PI * 2); g.stroke();
      circle(g, -r * .35, r * .55 - r * .4, r * .18, 'rgba(255,255,255,.6)');
    }},
    { id: 'fangs', name: 'Fangs', color: '#ffffff', cy: 0.04, r: 0.14, draw(g, s, c, f) {
      const top = -f.gap / 2 * s;
      both(k => {
        g.beginPath(); g.moveTo(k * s * .05, top); g.lineTo(k * s * .11, top); g.lineTo(k * s * .08, top + s * .1); g.closePath();
        g.fillStyle = c; g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = s * .008; g.stroke();
      });
    }},
    { id: 'beak', name: 'Beak', color: '#f5a623', cy: 0.02, r: 0.26, draw(g, s, c, f) {
      const half = f.gap / 2 * s, w = s * .22;
      g.strokeStyle = shade(c, -.35); g.lineWidth = s * .012;
      g.beginPath(); g.moveTo(-w, -half); g.quadraticCurveTo(0, -half - s * .2, w, -half); g.lineTo(0, -half + s * .1); g.closePath();
      g.fillStyle = c; g.fill(); g.stroke();                 // top beak
      g.beginPath(); g.moveTo(-w * .85, half); g.lineTo(w * .85, half); g.lineTo(0, half + s * .12); g.closePath();
      g.fillStyle = shade(c, -.15); g.fill(); g.stroke();    // bottom beak opens with your mouth
    }},
    { id: 'fire', name: 'Fire breath', color: '#ff7a00', cy: 0.33, r: 0.36, thumbF: { gap: .16 }, draw(g, s, c, f) {
      if (f.gap < .04) return;                               // only breathes fire when your mouth is open
      const power = Math.min(1, (f.gap - .04) * 8);
      const flick = 1 + Math.sin(f.t * 22) * .08;
      const flame = (len, wid, col) => {
        g.beginPath(); g.moveTo(-wid, 0);
        g.quadraticCurveTo(-wid * 1.6, len * .5, 0, len);
        g.quadraticCurveTo(wid * 1.6, len * .5, wid, 0);
        g.closePath(); g.fillStyle = col; g.fill();
      };
      g.save(); g.translate(0, f.gap / 2 * s * .5);
      flame(s * .65 * power * flick, s * .12, c);
      flame(s * .45 * power / flick, s * .08, '#ffc400');
      flame(s * .25 * power * flick, s * .045, '#fff3b0');
      g.restore();
    }}
  ],
  facial: [
    { id: 'whiskers', name: 'Whiskers', color: '#ffffff', cy: -0.05, r: 0.46, draw(g, s, c) {
      g.strokeStyle = c; g.lineWidth = s * .012; g.lineCap = 'round';
      both(k => [-.03, .02, .07].forEach(dy => { g.beginPath(); g.moveTo(k * s * .14, -s * .07); g.lineTo(k * s * .44, s * (dy - .07)); g.stroke(); }));
    }},
    { id: 'mustache', name: 'Mustache', color: '#3b2314', cy: -0.06, r: 0.22, draw(g, s, c) {
      g.beginPath(); g.moveTo(0, -s * .07);
      g.bezierCurveTo(s * .08, -s * .12, s * .16, -s * .06, s * .22, -s * .1);
      g.bezierCurveTo(s * .2, -s * .01, s * .08, -s * .02, 0, -s * .04);
      g.bezierCurveTo(-s * .08, -s * .02, -s * .2, -s * .01, -s * .22, -s * .1);
      g.bezierCurveTo(-s * .16, -s * .06, -s * .08, -s * .12, 0, -s * .07);
      g.fillStyle = c; g.fill();
    }},
    { id: 'beard', name: 'Beard', color: '#5a3a1e', cy: 0.18, r: 0.46, draw(g, s, c) {
      g.beginPath();
      g.moveTo(-s * .44, -s * .12);
      g.quadraticCurveTo(-s * .4, s * .42, 0, s * .5);
      g.quadraticCurveTo(s * .4, s * .42, s * .44, -s * .12);
      g.quadraticCurveTo(s * .3, s * .1, 0, s * .08);
      g.quadraticCurveTo(-s * .3, s * .1, -s * .44, -s * .12);
      g.moveTo(s * .13, s * .04); g.ellipse(0, s * .04, s * .13, s * .07, 0, 0, Math.PI * 2);
      g.fillStyle = c; g.fill('evenodd');
    }}
  ]
};

// ---------------------------------------------------------------------
//  3D parts — built once three.js has loaded.
// ---------------------------------------------------------------------
export function helpers3D(T) {
  return {
    mat(c, o = {}) { return new T.MeshPhysicalMaterial(Object.assign({ color: c, roughness: .35, metalness: 0, clearcoat: .6, clearcoatRoughness: .2, side: T.DoubleSide }, o)); },
    mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); return m; },
    dark(c, k = .65) { return new T.Color(c).multiplyScalar(k); },
    light(c, k = .25) { return new T.Color(c).lerp(new T.Color('#ffffff'), k); },
    // Two mirrored sides; fn(side) builds the right-hand one and returns its moving part.
    pair(g, fn) { return [-1, 1].map(k => { const side = new T.Group(); side.scale.x = k; g.add(side); return fn(side); }); },
    roundRect(w, h, r) {
      const s = new T.Shape(), x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
      return s;
    },
    star(r) {
      const s = new T.Shape();
      for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      s.closePath(); return s;
    }
  };
}

const swingK = n => (n ? 1 : -1);   // which side a pair() entry is: 0 = left, 1 = right

export function buildParts3D(T) {
  const P3 = helpers3D(T);
  return {
    head: [
      { id: 'cap3d', name: 'Ball cap', color: '#0b3d91', cy: -0.02, r: 0.6, build(c) {
        const g = new T.Group(), cloth = P3.mat(c, { roughness: .7, clearcoat: .05 });
        const dome = P3.mesh(new T.SphereGeometry(.56, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), cloth, 0, -.16, -.32);
        dome.scale.set(1, .85, 1.05); g.add(dome);
        const brim = P3.mesh(new T.CylinderGeometry(.48, .48, .03, 48), P3.mat(P3.dark(c), { roughness: .7, clearcoat: .05 }), 0, -.17, -.01);
        brim.rotation.x = .2; g.add(brim);
        g.add(P3.mesh(new T.SphereGeometry(.045, 16, 12), P3.mat(P3.dark(c)), 0, .32, -.32));
        const st = P3.mesh(new T.ExtrudeGeometry(P3.star(.09), { depth: .02, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 2 }), P3.mat('#ffffff', { roughness: .4 }), 0, .11, .18);
        st.rotation.x = -.6; g.add(st);
        return g;
      }},
      { id: 'crown3d', name: 'Crown', color: '#ffb81c', cy: -0.2, r: 0.46, build(c) {
        const g = new T.Group(), gold = P3.mat(c, { metalness: 1, roughness: .25, clearcoat: 0 });
        g.add(P3.mesh(new T.CylinderGeometry(.33, .35, .2, 48, 1, true), gold, 0, .1, -.3));
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2, x = Math.sin(a) * .33, z = -.3 + Math.cos(a) * .33;
          g.add(P3.mesh(new T.ConeGeometry(.06, .18, 4), gold, x, .29, z));
          g.add(P3.mesh(new T.SphereGeometry(.028, 12, 8), P3.mat('#ffffff', { roughness: .15 }), x, .39, z));
        }
        for (const a of [0, -.7, .7]) g.add(P3.mesh(new T.SphereGeometry(.045, 16, 12), P3.mat('#d0103a', { roughness: .05, clearcoat: 1 }), Math.sin(a) * .36, .1, -.3 + Math.cos(a) * .36));
        g.rotation.x = -.12;
        return g;
      }},
      { id: 'horns3d', name: 'Horns', color: '#c8102e', cy: -0.28, r: 0.5, build(c) {
        const g = new T.Group(), m = P3.mat(c, { roughness: .3, clearcoat: .8 });
        P3.pair(g, side => {
          const geo = new T.ConeGeometry(.075, .42, 24, 16); geo.translate(0, .21, 0);
          const p = geo.attributes.position;
          for (let i = 0; i < p.count; i++) { const t = p.getY(i) / .42; p.setX(i, p.getX(i) + .2 * t * t); p.setZ(i, p.getZ(i) - .06 * t); }
          geo.computeVertexNormals();
          const h = P3.mesh(geo, m, .2, 0, -.12); h.rotation.z = -.15; side.add(h);
          return h;
        });
        return g;
      }},
      // A whole panda, worn as a costume head. Unlike every other part this
      // one has to COVER the face rather than sit on it, so it is about one
      // and a half face widths across and hangs well below the hairline
      // anchor. It is also drawn BEFORE the invisible head shape (that is
      // renderOrder -1, this is -2): the shape only exists to hide parts
      // that swing behind the skull, and left to itself it would carve a
      // hole in a head meant to swallow it.
      { id: 'pandaHead3d', name: 'Panda head', tip: 'open your mouth, raise your eyebrows', color: '#f2eee3', cy: -0.41, r: 0.88, build(c) {
        const g = new T.Group(); g.renderOrder = -2;
        const fur     = P3.mat(c, { roughness: .95, clearcoat: 0 });
        const ink     = P3.mat('#272320', { roughness: .8, clearcoat: .05 });
        const white   = P3.mat('#ffffff', { roughness: .2, clearcoat: 1 });
        const iris    = P3.mat('#6e4522', { roughness: .15, clearcoat: 1 });
        const pupil   = P3.mat('#17100c', { roughness: .15, clearcoat: 1 });
        const inner   = P3.mat('#54222b', { roughness: .55, clearcoat: .3 });
        const tongueM = P3.mat('#e86b85', { roughness: .4, clearcoat: .6 });

        // Half-extents of the skull. A face placed by eye on a ball this
        // deep ends up either floating off the cheek or sunk inside it, so
        // every feature below is hung off the curve itself.
        const A = .78, B = .82, C = .66;
        const skullZ = (x, y) => C * Math.sqrt(Math.max(0, 1 - (x / A) ** 2 - (y / B) ** 2));
        // A little frame lying flat on the fur at (x, y), turned by `tilt`:
        // inside it, +z is straight out of the head and x/y run along it.
        const onSkull = (x, y, tilt = 0) => {
          const z = skullZ(x, y), f = new T.Group();
          f.position.set(x, y, z);
          f.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1),
            new T.Vector3(x / (A * A), y / (B * B), z / (C * C)).normalize());
          f.rotateZ(tilt); f.updateMatrix();
          return f;
        };
        // An oval painted on the fur — the eye patches. A squashed ball
        // pressed into the skull only shows the sliver that pokes out, so
        // this is a disc whose every point is pushed onto the curve instead.
        // It is ringed rather than fanned: one ring of triangles spans the
        // curve with flat chords that sink inside it, leaving an outline.
        const paint = (mat, x, y, rx, ry, tilt) => {
          const geo = new T.RingGeometry(.0001, 1, 72, 14), m = onSkull(x, y, tilt).matrix;
          const pos = geo.attributes.position, v = new T.Vector3();
          for (let i = 0; i < pos.count; i++) {
            v.set(pos.getX(i) * rx, pos.getY(i) * ry, 0).applyMatrix4(m);
            const k = Math.hypot(v.x / A, v.y / B, v.z / C) || 1;
            v.multiplyScalar(1.006 / k);
            pos.setXYZ(i, v.x, v.y, v.z);
          }
          geo.computeVertexNormals();
          return new T.Mesh(geo, mat);
        };
        // A drawn line — smile, eyebrow — laid along the same curve.
        const stroke = (mat, pts, r) => new T.Mesh(
          new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(([x, y]) =>
            new T.Vector3(x, y, skullZ(x, y) + .008))), 24, r, 10, false), mat);

        const head = new T.Group(); head.position.set(0, -.41, -.05); head.scale.setScalar(1.06); g.add(head);
        const skull = P3.mesh(new T.SphereGeometry(1, 64, 48), fur);
        skull.scale.set(A, B, C); head.add(skull);

        const ears = P3.pair(head, side => {
          const piv = new T.Group(); piv.position.set(.46, .34, -.14); side.add(piv);
          const o = P3.mesh(new T.SphereGeometry(.26, 32, 24), ink, .10, .20, 0);
          o.scale.z = .55; piv.add(o);
          return piv;
        });

        P3.pair(head, side => side.add(paint(ink, .30, -.10, .165, .25, -.42)));

        const eyes = P3.pair(head, side => {
          const e = onSkull(.30, -.06); side.add(e);
          e.add(P3.mesh(new T.SphereGeometry(.105, 32, 24), white, 0, 0, -.052));
          e.add(P3.mesh(new T.SphereGeometry(.064, 28, 20), iris, 0, 0, .008));
          e.add(P3.mesh(new T.SphereGeometry(.032, 20, 16), pupil, 0, 0, .048));
          e.add(P3.mesh(new T.SphereGeometry(.016, 16, 12), white, -.034, .036, .066));
          return e;
        });

        const brows = P3.pair(head, side => {
          const b = stroke(ink, [[.20, .235], [.30, .295], [.41, .245]], .013);
          side.add(b); return b;
        });

        const snout = onSkull(0, -.44); head.add(snout);
        const nose = P3.mesh(new T.SphereGeometry(1, 32, 24), ink, 0, 0, -.012);
        nose.scale.set(.105, .070, .055); snout.add(nose);

        const smile = stroke(ink, [[-.19, -.55], [-.09, -.625], [0, -.638], [.09, -.625], [.19, -.55]], .018);
        head.add(smile);

        // The open mouth of the laughing pose, which takes over from the
        // smile once your own mouth is more than barely open.
        const jaw = onSkull(0, -.50); head.add(jaw);
        const maw = P3.mesh(new T.SphereGeometry(1, 32, 24), inner, 0, 0, -.03); jaw.add(maw);
        const tongue = P3.mesh(new T.SphereGeometry(1, 24, 18), tongueM, 0, 0, -.01); jaw.add(tongue);

        g.userData.update = f => {
          const open = Math.min(1, f.gap * 3.4);
          ears.forEach((p, i) => { p.rotation.z = -Math.sin(f.t * 16) * .22 * f.brow - f.swing * .22 * swingK(i); });
          brows.forEach(b => { b.position.y = f.brow * .055; });
          eyes.forEach(e => { e.scale.y = 1 - f.blink * .88; });
          smile.visible = open < .12;
          jaw.visible = !smile.visible;
          const w = .115 + open * .045, h = .02 + open * .085;
          maw.scale.set(w, h, .09); maw.position.y = -h;
          tongue.scale.set(w * .55, h * .36, .06);
          tongue.position.y = -h * 1.55;
        };
        // Settle the mouth before anyone looks: until the first frame runs
        // the maw is still an un-scaled ball a whole face wide, which the
        // admin page would measure and size the part from.
        g.userData.update({ gap: 0, brow: 0, blink: 0, swing: 0, bounce: 0, t: 0, sx: 1 });
        return g;
      }}
    ],
    ears: [
      { id: 'bearEars3d', name: 'Bear ears', tip: 'raise your eyebrows', color: '#7a4a24', cy: -0.28, r: 0.62, build(c) {
        const g = new T.Group(), fur = P3.mat(c, { roughness: .8, clearcoat: 0 }), pink = P3.mat('#e9a8a0', { roughness: .7, clearcoat: 0 });
        const pivs = P3.pair(g, side => {
          const piv = new T.Group(); piv.position.set(.4, .24, -.26); side.add(piv);
          const o = P3.mesh(new T.SphereGeometry(.19, 32, 20), fur); o.scale.z = .5; piv.add(o);
          const i = P3.mesh(new T.SphereGeometry(.11, 24, 16), pink, 0, 0, .06); i.scale.z = .3; piv.add(i);
          return piv;
        });
        g.userData.update = f => pivs.forEach((p, n) => { p.rotation.z = -Math.sin(f.t * 18) * .3 * f.brow - f.swing * .25 * swingK(n); });
        return g;
      }},
      { id: 'bunnyEars3d', name: 'Bunny ears', tip: 'raise your eyebrows to stand them up', color: '#f2f2f2', cy: -0.55, r: 0.58, build(c) {
        const g = new T.Group(), fur = P3.mat(c, { roughness: .75, clearcoat: 0 }), pink = P3.mat('#f7a8bd', { roughness: .6, clearcoat: 0 });
        const pivs = P3.pair(g, side => {
          const piv = new T.Group(); piv.position.set(.16, .1, -.2); side.add(piv);
          const o = P3.mesh(new T.SphereGeometry(.1, 32, 24), fur, 0, .43, 0); o.scale.set(1, 4.3, .45); piv.add(o);
          const i = P3.mesh(new T.SphereGeometry(.055, 24, 16), pink, 0, .42, .03); i.scale.set(1, 3.6, .3); piv.add(i);
          return piv;
        });
        g.userData.update = f => pivs.forEach((p, n) => { p.rotation.z = -(1 - f.brow) * .6 - f.swing * .5 * swingK(n); });
        return g;
      }},
      { id: 'dogEars3d', name: 'Floppy ears', tip: 'shake your head', color: '#8a5a32', side: true, cy: 0.27, r: 0.8, hit: { cx: .04, cy: .27, r: .34 }, build(c) {
        const g = new T.Group(), piv = new T.Group(); piv.position.set(.03, .05, -.06); g.add(piv);
        const ear = P3.mesh(new T.SphereGeometry(.14, 32, 24), P3.mat(c, { roughness: .8, clearcoat: 0 }), .03, -.33, 0); ear.scale.set(1, 2.4, .35); piv.add(ear);
        g.userData.update = f => { piv.rotation.z = f.brow * .5 + f.bounce * .4 - f.swing * 1.1 * f.sx; };
        return g;
      }},
      { id: 'mouseEars3d', name: 'Mouse ears', tip: 'move your head', color: '#1b1b1b', cy: -0.32, r: 0.66, build(c) {
        const g = new T.Group(), m = P3.mat(c, { roughness: .25, clearcoat: 1 }), inner = P3.mat(P3.light(c), { roughness: .5 });
        const pivs = P3.pair(g, side => {
          const piv = new T.Group(); piv.position.set(.4, .3, -.22); side.add(piv);
          const d = P3.mesh(new T.CylinderGeometry(.24, .24, .07, 48), m); d.rotation.x = Math.PI / 2; piv.add(d);
          const i = P3.mesh(new T.CylinderGeometry(.15, .15, .02, 40), inner, 0, 0, .04); i.rotation.x = Math.PI / 2; piv.add(i);
          return piv;
        });
        g.userData.update = f => pivs.forEach((p, n) => { p.position.y = .3 + f.bounce * .15; p.scale.set(1 + f.bounce * .2, 1 - f.bounce * .2, 1); p.rotation.z = -f.swing * .3 * swingK(n); });
        return g;
      }}
    ],
    eyes: [
      { id: 'shades3d', name: 'Sunglasses', color: '#1b1b1b', cy: 0.02, r: 0.42, build(c) {
        const g = new T.Group(), lens = P3.mat(c, { roughness: .05, metalness: .3, clearcoat: 1 }), frame = P3.mat(c, { roughness: .3 });
        const lg = new T.ExtrudeGeometry(P3.roundRect(.3, .18, .06), { depth: .02, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 3 }); lg.center();
        for (const k of [-1, 1]) {
          g.add(P3.mesh(lg, lens, k * .2, -.02, .1));
          g.add(P3.mesh(new T.BoxGeometry(.02, .03, .5), frame, k * .36, .03, -.15));
        }
        g.add(P3.mesh(new T.BoxGeometry(.12, .03, .03), frame, 0, .04, .1));
        return g;
      }},
      { id: 'glasses3d', name: 'Round glasses', color: '#ffb81c', cy: 0.02, r: 0.42, build(c) {
        const g = new T.Group(), metal = P3.mat(c, { metalness: 1, roughness: .25, clearcoat: 0 });
        const glass = P3.mat('#cfe8ff', { transparent: true, opacity: .18, roughness: 0, clearcoat: 1 });
        for (const k of [-1, 1]) {
          g.add(P3.mesh(new T.TorusGeometry(.13, .016, 16, 56), metal, k * .2, -.01, .1));
          g.add(P3.mesh(new T.CircleGeometry(.125, 40), glass, k * .2, -.01, .1));
          g.add(P3.mesh(new T.BoxGeometry(.015, .02, .5), metal, k * .33, .03, -.15));
        }
        g.add(P3.mesh(new T.TorusGeometry(.07, .013, 10, 24, Math.PI), metal, 0, -.01, .1));
        return g;
      }}
    ],
    nose: [
      { id: 'clownNose3d', name: 'Clown nose', color: '#e01b24', cy: 0, r: 0.14, build(c) {
        const g = new T.Group(); g.add(P3.mesh(new T.SphereGeometry(.1, 40, 28), P3.mat(c, { roughness: .15, clearcoat: 1 }), 0, 0, .05)); return g;
      }},
      { id: 'bearNose3d', name: 'Bear nose', color: '#2b1a10', cy: 0, r: 0.15, build(c) {
        const g = new T.Group(), n = P3.mesh(new T.SphereGeometry(.12, 40, 28), P3.mat(c, { roughness: .2, clearcoat: 1 }), 0, 0, .04);
        n.scale.set(1, .72, .7); g.add(n); return g;
      }},
      { id: 'pigSnout3d', name: 'Pig snout', color: '#f4a3b5', cy: 0, r: 0.15, build(c) {
        const g = new T.Group();
        const s = P3.mesh(new T.CylinderGeometry(.12, .13, .09, 48), P3.mat(c, { roughness: .45, clearcoat: .4 }), 0, -.01, .05); s.rotation.x = Math.PI / 2; g.add(s);
        for (const k of [-1, 1]) { const h = P3.mesh(new T.SphereGeometry(.028, 16, 12), P3.mat('#5a2230', { roughness: .6, clearcoat: 0 }), k * .045, -.01, .095); h.scale.set(.8, 1.3, .4); g.add(h); }
        return g;
      }}
    ],
    mouth: [
      { id: 'tongue3d', name: 'Crazy tongue', tip: 'open your mouth', color: '#ff5c8a', cy: 0.16, r: 0.22, build(c) {
        const g = new T.Group(), piv = new T.Group(); piv.position.z = .03; g.add(piv);
        const t = P3.mesh(new T.CapsuleGeometry(.085, .3, 8, 24), P3.mat(c, { roughness: .35, clearcoat: .7 }), 0, -.235, 0); t.scale.z = .45; piv.add(t);
        g.userData.update = f => {
          const L = Math.min(.5, .1 + f.gap * 2.6);
          piv.position.y = -f.gap / 2; piv.scale.y = L / .47;
          piv.rotation.z = Math.sin(f.t * 9) * Math.min(.45, f.gap * 3);   // wiggle
          piv.rotation.x = -.7 * Math.min(1, f.gap * 5);                     // sticks out toward the camera
        };
        return g;
      }},
      { id: 'bubble3d', name: 'Bubble gum', tip: 'open your mouth', color: '#ff8fc7', cy: 0.12, r: 0.26, build(c) {
        const g = new T.Group(), b = P3.mesh(new T.SphereGeometry(1, 48, 32), P3.mat(c, { roughness: .12, clearcoat: 1, transparent: true, opacity: .88 }));
        g.add(b);
        g.userData.update = f => { const r = Math.min(.55, .05 + f.gap * 2.8); b.scale.setScalar(r); b.position.set(0, -r * .4, .04 + r * .75); };
        return g;
      }},
      { id: 'beak3d', name: 'Beak', tip: 'open your mouth', color: '#f5a623', cy: 0.02, r: 0.26, build(c) {
        const g = new T.Group(), up = new T.Group(), lo = new T.Group(); lo.position.set(0, -.03, .02); g.add(up, lo);
        const u = P3.mesh(new T.ConeGeometry(.21, .36, 32), P3.mat(c, { roughness: .35, clearcoat: .6 }), 0, 0, .17); u.rotation.x = Math.PI / 2; u.scale.z = .5; up.add(u);
        const l = P3.mesh(new T.ConeGeometry(.17, .28, 32), P3.mat(P3.dark(c, .85), { roughness: .4 }), 0, 0, .13); l.rotation.x = Math.PI / 2; l.scale.z = .45; lo.add(l);
        g.userData.update = f => {
          up.position.y = f.gap * .35; up.rotation.x = -Math.min(.25, f.gap * 1.2);
          lo.position.y = -.03 - f.gap * .35; lo.rotation.x = Math.min(.7, f.gap * 4);   // lower beak opens with your mouth
        };
        return g;
      }}
    ]
  };
}

// Mouth parts that react to the mouth opening all share the same tip.
export const MOUTH_TIP_IDS = ['tongue', 'teeth', 'lips', 'bubble', 'beak', 'fire'];
