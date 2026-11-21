# Local Google Sans fonts

- Interface: Google Sans Flex, default weight **400**. The original variable weight range is retained so existing medium/semibold headings keep their hierarchy.
- Code and terminal: Google Sans Code, normal and italic, with the original variable weight range.
- Both families are bundled as WOFF2; the application makes no Google Fonts request at runtime. Each folder includes its upstream SIL Open Font License.

Upstream releases:

- [Google Sans Flex v5.000](https://github.com/googlefonts/googlesans-flex/releases/tag/v5.000)
- [Google Sans Code v7.001](https://github.com/googlefonts/googlesans-code/releases/tag/v7.001)

The original full TTF files were compressed to WOFF2 with FontTools 4.67.0 and Brotli 1.2.1, without subsetting or changing axes, glyphs or family names. Source filenames and SHA-256 hashes are recorded in `google-fonts-manifest.json`.

To reproduce compression after downloading and extracting those releases:

```sh
python -m pip install 'fonttools[woff]==4.67.0' 'brotli==1.2.1'
fonttools ttLib.woff2 compress input.ttf -o output.woff2
```

Font registration, family stacks and the interface's default weight are configured in `src/lib/theme/tokens.json`. Run `npm run tokens:generate` from the desktop app after changing that source.
