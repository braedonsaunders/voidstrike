# Asset Pipeline Tools

Tools for processing and converting game assets.

## Scripts

### extract_meshy_zips.py

Extracts and organizes model files from Meshy AI zip exports.

**Usage:**
```bash
python extract_meshy_zips.py <input_dir> <output_dir>
```

**Features:**
- Extracts GLB/GLTF files from nested zip structures
- Organizes by model name
- Preserves texture references
