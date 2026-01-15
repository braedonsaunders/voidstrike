#!/bin/bash
# VOIDSTRIKE Model Compression Script
# Compresses GLB files for browser-based RTS game
#
# Requirements:
#   npm install -g @gltf-transform/cli sharp-cli
#
# Usage:
#   ./compress-models.sh input_folder output_folder [texture_size]
#
# Example:
#   ./compress-models.sh ./raw_models ./compressed 1024

set -e

INPUT_DIR="${1:-.}"
OUTPUT_DIR="${2:-./compressed}"
TEXTURE_SIZE="${3:-1024}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  VOIDSTRIKE Model Compressor"
echo "=========================================="
echo "  Input:  $INPUT_DIR"
echo "  Output: $OUTPUT_DIR"
echo "  Texture Size: ${TEXTURE_SIZE}x${TEXTURE_SIZE}"
echo "=========================================="

# Check for gltf-transform
if ! command -v gltf-transform &> /dev/null; then
    echo -e "${RED}Error: gltf-transform not found${NC}"
    echo "Install with: npm install -g @gltf-transform/cli"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Count files
TOTAL=$(find "$INPUT_DIR" -maxdepth 1 -name "*.glb" -o -name "*.gltf" 2>/dev/null | wc -l)
CURRENT=0

if [ "$TOTAL" -eq 0 ]; then
    echo -e "${YELLOW}No GLB/GLTF files found in $INPUT_DIR${NC}"
    exit 0
fi

echo ""
echo "Found $TOTAL model(s) to process..."
echo ""

# Process each GLB file
for file in "$INPUT_DIR"/*.glb "$INPUT_DIR"/*.gltf; do
    [ -e "$file" ] || continue

    CURRENT=$((CURRENT + 1))
    FILENAME=$(basename "$file")
    BASENAME="${FILENAME%.*}"
    OUTPUT_FILE="$OUTPUT_DIR/${BASENAME}.glb"

    # Get original size
    ORIG_SIZE=$(du -h "$file" | cut -f1)

    echo -e "[$CURRENT/$TOTAL] ${YELLOW}$FILENAME${NC} ($ORIG_SIZE)"

    # Compress with gltf-transform
    # - Draco mesh compression
    # - WebP texture compression
    # - Resize textures
    # - Remove unused data
    gltf-transform optimize "$file" "$OUTPUT_FILE" \
        --compress draco \
        --texture-compress webp \
        --texture-size "$TEXTURE_SIZE" \
        --simplify-error 0.001 \
        2>/dev/null

    # Get new size
    NEW_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)

    # Calculate reduction (rough)
    echo -e "         ${GREEN}✓${NC} $ORIG_SIZE → $NEW_SIZE"
done

echo ""
echo "=========================================="
echo -e "  ${GREEN}Compression complete!${NC}"
echo "  Output: $OUTPUT_DIR"
echo "=========================================="

# Show total size comparison
ORIG_TOTAL=$(du -sh "$INPUT_DIR" | cut -f1)
NEW_TOTAL=$(du -sh "$OUTPUT_DIR" | cut -f1)
echo ""
echo "  Total: $ORIG_TOTAL → $NEW_TOTAL"
echo ""
