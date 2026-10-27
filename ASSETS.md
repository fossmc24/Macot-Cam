# Making art for Mascot Cam

Notes for whoever draws or models the parts. Everything here is about making a
part that is easy to calibrate — the exact position, size and rotation are set
later in the admin page, not baked into the file.

## The one idea that matters: face units

Every measurement in the app is in **face units**, where

> **1 face unit = the width of the face**, measured across the cheekbones
> (MediaPipe landmarks 234 → 454).

This is why a part fits whether it is a small face far away or a big face close
up. You do not need to think about pixels, millimetres or how far the phone is
held.

In the admin page, a scale of `1.0` means "as wide as the face".

---

## PNG

- Transparent background.
- At least **1024 px** on the longest side.
- Keep it under about **1 MB**. The admin page warns above that.
- Centre the artwork, and put **the point that should touch the face at the
  centre of the image**. For a hat, that is the part that sits on the forehead;
  for a nose, the middle of the nose.
- If centring it would waste a lot of space (a long floppy ear, say), centre it
  however looks natural and set the **pivot** in the admin page instead — the
  pivot shifts the image relative to its attachment point.
- Leave a few transparent pixels of margin so edges do not look clipped.

A PNG is drawn as a flat picture that **tilts with the head** but does not turn
with it. If someone turns to look sideways, a PNG stays face-on. For something
that must turn — a snout, a hat with a real brim — use a GLB.

## SVG

- Simple shapes: paths, circles, rectangles, groups.
- Give the file a real `width`, `height` or `viewBox`, otherwise it may come out
  at the wrong size.
- **No scripts, no embedded fonts, no external images.** Uploads are cleaned
  automatically — `<script>`, `<foreignObject>`, `on…` handlers and links out to
  other files are stripped — so anything relying on those will simply vanish.
- Convert text to outlines. A font that is not on the phone will not render.
- Otherwise treat it exactly like a PNG: centred, attachment point in the middle.

## GLB / GLTF

- Keep it under **2 MB**. The admin page warns above that. This loads over a
  phone connection every time someone picks the part.
- **Y up**, **facing +Z** — that is, towards the camera, the way the face looks
  out of the screen.
- **Put the origin at the attachment point.** This is the single most useful
  thing you can do. If the origin of a hat is where it meets the head, it will
  very nearly fit as soon as it is uploaded.
- Real-world scale does not matter — calibration sets the size. But keeping it
  roughly 1 unit across makes the first preview less of a surprise.
- Use **PBR materials** (metallic / roughness). The app lights parts with a soft
  studio environment, so metal and gloss both look right.
- Keep the polygon count sensible. These are small on screen; tens of thousands
  of triangles is plenty.
- Bake textures into the file (GLB does this for you). A GLTF pointing at
  separate texture files will lose them.

### Letting the user colour it

Name a material exactly **`Colorable`** (any capitalisation) and that material
takes whatever colour the user picks from the swatches. Everything else keeps
the colour you gave it.

Use this for the main body of a part and leave the details alone — a bear ear
whose fur is `Colorable` but whose inner ear stays pink will look right in every
colour.

If nothing is named `Colorable`, turn **Colorable** off in the admin page so the
app does not offer colours that do nothing.

---

## Reactions

Parts can respond to the face. In the admin page you add rules that read one
thing and drive one property:

| Reads | What it means |
|---|---|
| Mouth open | how far the mouth is open, in face units |
| Eyebrows up | 0 to 1 |
| Blink | 0 to 1 |
| Head swing | sideways head movement, springs back, roughly −1 to 1 |
| Head bounce | up-and-down head movement, roughly −0.6 to 0.6 |

| Drives | What it does |
|---|---|
| Tilt / tip / turn | rotates the part, in radians (1 ≈ 57°) |
| Move across / up-down / in-out | shifts it, in face units |
| Grow, wider, taller | scales it |
| Fade | changes how see-through it is |
| Show only when in range | hides the part unless the reading is between min and max |

Model the part in its **resting** pose and let the reactions move it. An ear
should be modelled hanging down, with a rule that lifts it when the eyebrows go
up — not modelled halfway up.

Keep the origin where the part should pivot: rotation happens around the
attachment point, so a floppy ear whose origin is at the top of the ear swings
properly, and one whose origin is in the middle spins on the spot.

---

## A quick checklist

- [ ] Right file type, under the size limit
- [ ] Transparent background (PNG) / no scripts (SVG) / Y-up, +Z (GLB)
- [ ] Attachment point at the centre (flat art) or at the origin (3D)
- [ ] Modelled in its resting pose
- [ ] Material named `Colorable` if the user should be able to recolour it
- [ ] Looks right at about 20% of the screen's height — that is roughly how big
      these are in use
