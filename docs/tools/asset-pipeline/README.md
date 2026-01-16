# Asset Pipeline Tools

Tools for processing and converting game assets.

## Scripts

### extract_meshy_zips.py

Extracts and organizes model files from Meshy AI zip exports.

**Usage:**
1. Edit the script and configure paths at the top:
   - `ZIP_FOLDERS`: Dictionary mapping categories to input zip folders
   - `OUTPUT_FOLDER`: Where to extract the organized files
2. Run the script:
```bash
python extract_meshy_zips.py
```

**Features:**
- Extracts GLB/GLTF files from nested zip structures
- Organizes by category (buildings, decorations, resources, units)
- Preserves texture references
