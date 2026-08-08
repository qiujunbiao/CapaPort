# CapaPort Brand Assets

`capaport-app-icon.svg` is the canonical 1024×1024 application-icon source. The remaining SVGs are the editable mark and horizontal lockups used by product surfaces and documentation.

## Palette

- Graphite 950: `#15171D`
- Paper 50: `#F7F4ED`
- Flow Orange 500: `#FF6426`
- Flow Orange 400: `#FF8A32`
- Ink 900: `#181A20`

## Usage

- Do not render the standalone mark below 16px.
- Preserve the application icon's 16% optical safety zone.
- Use a gap equal to 0.28 times the mark width between the mark and wordmark.
- Use the monochrome mark for templates, printing, or increased-contrast mode.
- Do not stretch, rotate, recolor, add shadows, reverse the flow, or edit generated platform files directly.

Regenerate Tauri platform icons from the master:

```bash
pnpm --dir apps/desktop exec tauri icon ../../brand/capaport-app-icon.svg --output src-tauri/icons
```

After generating platform and Web raster icons, synchronize application assets:

```bash
pnpm brand:assets
```
