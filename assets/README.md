# Sentry Finance — Brand Assets

Drop your final artwork here. The build pipeline picks these up automatically — no code edits needed.

---

## The 4 files to replace

| File | Size | Used for |
|------|------|----------|
| `logo.png` | 1024×1024, transparent bg | App header, splash, Android icon |
| `favicon-source.png` | 512×512, transparent bg | Generate favicon.ico via realfavicongenerator.net |
| `og-image.png` | 1200×630, any bg | Twitter/WhatsApp/iMessage link previews |
| `apple-touch-icon.png` | 180×180, navy bg | iPhone "Add to Home Screen" |

---

## How to update

1. Replace the file here with your new artwork (keep the same filename)
2. Run: `npm run build:icons` — copies everything to `public/` and regenerates Android icon sizes
3. Commit and push — Vercel deploys automatically

### Manual copy (if you don't want to run the script)
```
assets/logo.png              → public/logo.png
assets/og-image.png          → public/og-image.png
assets/apple-touch-icon.png  → public/apple-touch-icon.png
assets/favicon-source.png    → run through realfavicongenerator.net → public/favicon.ico
assets/icon-foreground.png   → Android adaptive icon foreground (all mipmap densities)
assets/icon-background.png   → Android adaptive icon background
assets/splash.png             → Android splash screen
```

---

## Android icons (already wired)

| File | Used for |
|------|----------|
| `icon-foreground.png` | Adaptive icon foreground (gold mark, transparent bg) |
| `icon-background.png` | Adaptive icon background color layer |
| `icon.png` | Legacy square launcher icon |
| `splash.png` | Native splash screen |

---

## Format rules for clean results

- `logo.png` — transparent background, mark centered with ~10% padding all sides
- `og-image.png` — brand name + mark, dark background, readable at 600×315 (half size)
- All files: PNG, sRGB, no embedded ICC profile issues

---

*Replace files here, not in `public/` directly — public/ is generated.*
