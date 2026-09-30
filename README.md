# MTE Spine Studio

Browser tools for animated character artwork, scene composition, and export.

## Development

```sh
npm install
npm run dev
npm test
python3 -m unittest discover -s tests
```

Converted assets are read from `public/assets/` and kept outside Git.
The extractor accepts a local archive with the resource tables and decoding
utilities. It preserves Unity references, scene hierarchy, and atlas materials.

```sh
python3 tools/extract_assets.py --source /path/to/archive
npm run assets:index
```

The current implementation loads composite Spine presentations from real
resources. Character labeling, interaction state machines, audio, scene
persistence, and media export are still being implemented.

The Spine runtime license is retained in `public/vendor/SPINE-LICENSE`.
