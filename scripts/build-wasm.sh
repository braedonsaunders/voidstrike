#!/bin/bash
# Build WASM SIMD boids module locally
#
# Prerequisites:
#   - Rust toolchain (rustup install stable)
#   - wasm-pack (cargo install wasm-pack)
#   - wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown)
#
# Usage:
#   ./scripts/build-wasm.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WASM_DIR="$PROJECT_ROOT/wasm/boids"
OUTPUT_DIR="$PROJECT_ROOT/public/wasm"

echo "Building WASM SIMD boids module..."

# Check prerequisites
if ! command -v wasm-pack &> /dev/null; then
    echo "Error: wasm-pack not found"
    echo "Install with: cargo install wasm-pack"
    exit 1
fi

if ! rustup target list --installed | grep -q wasm32-unknown-unknown; then
    echo "Adding wasm32-unknown-unknown target..."
    rustup target add wasm32-unknown-unknown
fi

# Build with SIMD enabled
cd "$WASM_DIR"
echo "Compiling Rust to WASM with SIMD..."
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build \
    --target web \
    --release \
    --out-dir pkg \
    --out-name boids_wasm

# Copy to public directory
mkdir -p "$OUTPUT_DIR"
cp pkg/boids_wasm_bg.wasm "$OUTPUT_DIR/"
cp pkg/boids_wasm.js "$OUTPUT_DIR/"
cp pkg/boids_wasm.d.ts "$OUTPUT_DIR/" 2>/dev/null || true

# Display results
echo ""
echo "Build complete!"
echo "Output: $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR/boids_wasm_bg.wasm"

# Check for SIMD instructions
if command -v wasm2wat &> /dev/null; then
    SIMD_COUNT=$(wasm2wat "$OUTPUT_DIR/boids_wasm_bg.wasm" 2>/dev/null | grep -c "f32x4" || echo "0")
    echo "SIMD f32x4 instructions: $SIMD_COUNT"
fi

echo ""
echo "To use in development:"
echo "  1. Run 'npm run dev'"
echo "  2. The game will automatically use WASM when SIMD is available"
