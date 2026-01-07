#!/usr/bin/env python3
"""
Install GLTF Calibration Helpers

Copies the gltf-calibration-helpers.mjs module to a specified destination.

Usage:
    python install-gltf-calibration-helpers.py --out ./src/utils/gltf-calibration-helpers.mjs
    python install-gltf-calibration-helpers.py --out ~/projects/myapp/helpers.mjs --force
"""

import argparse
import shutil
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Install GLTF calibration helpers to your project"
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Destination path for the module file",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing file if it exists",
    )

    args = parser.parse_args()

    # Resolve paths
    script_dir = Path(__file__).parent
    source_file = script_dir / "gltf-calibration-helpers.mjs"
    dest_file = Path(args.out).expanduser().resolve()

    # Validate source exists
    if not source_file.exists():
        print(f"Error: Source module not found at {source_file}", file=sys.stderr)
        sys.exit(2)

    # Check if destination exists
    if dest_file.exists() and not args.force:
        print(
            f"Error: Destination exists: {dest_file}\nUse --force to overwrite.",
            file=sys.stderr,
        )
        sys.exit(2)

    # Create parent directories if needed
    dest_file.parent.mkdir(parents=True, exist_ok=True)

    # Copy the file
    shutil.copyfile(source_file, dest_file)
    print(f"Installed: {dest_file}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
