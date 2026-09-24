# Red Dust: Specimen — v0.0.1.2

Browser-first first/third-person prototype built with HTML/CSS/JavaScript + Three.js.

## What this build proves
- Playable insectoid specimen in first and third person
- Compact Mars research base assembled around the supplied sci-fi interior asset
- Five supplied NPC models placed in believable roles
- Lightweight crew patrol / sight / flee reactions
- Close-range attack + biomass counter
- Desktop and iPhone/touch controls
- GitHub Pages-friendly static project structure

## Controls
### Desktop
- WASD — move
- Mouse — look (click scene to lock pointer)
- Shift — sprint
- C — crouch
- V — switch first/third person
- Left click or Space — attack

### Mobile
- Left thumbstick — move
- Drag right side — look
- RUN — hold to sprint
- CROUCH — toggle crouch
- ATK — attack
- CAM — switch first/third person

## Running
Because ES modules and GLB loading need HTTP, run through a local static server or deploy to GitHub Pages. Do not open `index.html` directly from `file://`.

For example with Python on a PC:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Prototype notes
- The ship interior is used as visual set dressing inside a small custom-built facility. Collision in v0.0.1 is intentionally based on the custom room shell, not every prop in the imported interior.
- Temari is **prototype-only** because the character depicts Naruto IP. Replace before any commercial/public production release.
- The Street Fighter cosplay model is intentionally stationary and used in its authored all-fours pose rather than being treated as a locomotion-ready NPC.
- This is a gameplay prototype, not the final Godot production build.

See `CREDITS.md` for supplied asset licenses and sources.



## v0.0.1.2 — visibility + locomotion hotfix
- Removed the specimen-local/head light entirely. Illumination now comes from the base.
- Added visible ceiling/work-light fixtures throughout the hub, corridors, and wings.
- Corrected the practical-light intensity for modern Three.js physically based lighting and raised ambient/exposure so iPhone Safari does not crush the facility into black.
- Reduced fog density while preserving dark pockets and red emergency accents.
- Disabled iOS double-tap/pinch zoom and text-selection callouts during gameplay.
- Stopped looping the monster's only built-in `Prowl` clip as locomotion; it is held neutral for now because the source GLB contains no true walk/run cycle.
- The monster now rotates toward actual travel direction in third person instead of sliding sideways; first person keeps the body aligned with view heading.
- First-person sight remains aligned with forward movement.
