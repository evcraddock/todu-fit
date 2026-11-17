# Installed application icons

These assets use the original teal-background iOS artwork, preserved in `src/assets/fit-icon.png`.

- `icon.png`: unchanged 1024×1024 source, also bundled for the Electron window icon.
- `icon.icns`: macOS application icon.
- `icon.ico`: Windows application and installer icon, with multiple sizes through 256×256.

`package.json` configures the platform icons. Windows keeps signing disabled with `signExecutable: false` so executable icon and metadata editing remain enabled.

To regenerate ICNS and ICO after replacing the PNG, run from `apps/desktop` with the locked dependencies installed:

```js
const path = require("node:path");
const { convertIcon } = require("app-builder-lib/out/util/iconConverter");
(async () => {
  for (const format of ["icns", "ico"]) {
    await convertIcon({
      sources: [path.resolve("build/icon.png")],
      fallbackSources: [],
      roots: [],
      format,
      outDir: path.resolve("build"),
    });
  }
})();
```

This uses electron-builder’s bundled converter; recheck its internal API when upgrading electron-builder.
