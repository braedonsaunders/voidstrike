"""
Extract and Organize Meshy.ai Model Zips
========================================
Extracts zip files and flattens the Meshy folder structure.

USAGE:
    python extract_meshy_zips.py

Before running, set the paths below.

INPUT:  Folder with zip files named after your models
OUTPUT: Flattened structure ready for Blender retopo script

Example:
    Input:  zips/buildings/headquarters.zip
            zips/buildings/barracks.zip
            zips/units/tank.zip

    Output: extracted/buildings/headquarters.obj
            extracted/buildings/headquarters.mtl
            extracted/buildings/headquarters.png
            extracted/buildings/barracks.obj
            ...
"""

import os
import zipfile
import shutil
from pathlib import Path

# =============================================================================
# CONFIGURATION - SET THESE PATHS
# =============================================================================

# Folders containing your zip files (one folder per category)
ZIP_FOLDERS = {
    "buildings": "/path/to/zips/buildings/",
    "decorations": "/path/to/zips/decorations/",
    "resources": "/path/to/zips/resources/",
    "units": "/path/to/zips/units/",
}

# Where to extract the organized files
OUTPUT_FOLDER = "/path/to/extracted/"

# =============================================================================
# SCRIPT
# =============================================================================

def extract_and_organize_zip(zip_path, output_dir):
    """
    Extract a Meshy.ai zip and flatten the folder structure.

    Meshy zips contain:
        random_folder_name/
            model.obj
            model.mtl
            model.png (or .jpg)

    We extract and rename to:
        zipname.obj
        zipname.mtl
        zipname.png
    """
    zip_name = Path(zip_path).stem  # e.g., "headquarters" from "headquarters.zip"

    # Create temp extraction folder
    temp_dir = os.path.join(output_dir, f"_temp_{zip_name}")
    os.makedirs(temp_dir, exist_ok=True)

    try:
        # Extract zip
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(temp_dir)

        # Find the actual files (they're in a nested folder)
        obj_file = None
        mtl_file = None
        texture_file = None

        for root, dirs, files in os.walk(temp_dir):
            for f in files:
                f_lower = f.lower()
                full_path = os.path.join(root, f)

                if f_lower.endswith('.obj'):
                    obj_file = full_path
                elif f_lower.endswith('.mtl'):
                    mtl_file = full_path
                elif f_lower.endswith(('.png', '.jpg', '.jpeg')):
                    texture_file = full_path

        if not obj_file:
            print(f"  ⚠ No OBJ found in {zip_name}.zip")
            return False

        # Get texture extension
        tex_ext = Path(texture_file).suffix if texture_file else '.png'

        # Copy and rename files to output
        files_copied = []

        # OBJ file
        new_obj = os.path.join(output_dir, f"{zip_name}.obj")
        shutil.copy2(obj_file, new_obj)
        files_copied.append("OBJ")

        # MTL file - need to update texture reference inside
        if mtl_file:
            new_mtl = os.path.join(output_dir, f"{zip_name}.mtl")

            # Read and modify MTL to point to renamed texture
            with open(mtl_file, 'r') as f:
                mtl_content = f.read()

            # Replace texture references with new filename
            # MTL files use "map_Kd texture.png" format
            import re
            # Match any image file reference
            mtl_content = re.sub(
                r'(map_Kd\s+).*\.(png|jpg|jpeg)',
                f'\\1{zip_name}{tex_ext}',
                mtl_content,
                flags=re.IGNORECASE
            )
            # Also handle map_Ka, map_Ks, etc.
            mtl_content = re.sub(
                r'(map_K[ads]\s+).*\.(png|jpg|jpeg)',
                f'\\1{zip_name}{tex_ext}',
                mtl_content,
                flags=re.IGNORECASE
            )

            with open(new_mtl, 'w') as f:
                f.write(mtl_content)
            files_copied.append("MTL")

        # Texture file
        if texture_file:
            new_tex = os.path.join(output_dir, f"{zip_name}{tex_ext}")
            shutil.copy2(texture_file, new_tex)
            files_copied.append("TEX")

        print(f"  ✓ {zip_name}: {', '.join(files_copied)}")
        return True

    except Exception as e:
        print(f"  ✗ {zip_name}: {e}")
        return False

    finally:
        # Clean up temp folder
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)


def process_category(category, zip_folder, output_base):
    """Process all zips in a category folder."""
    if not os.path.exists(zip_folder):
        print(f"\n  Folder not found: {zip_folder}")
        return 0

    # Find all zip files
    zips = [f for f in os.listdir(zip_folder) if f.lower().endswith('.zip')]

    if not zips:
        print(f"\n  No zip files found in {zip_folder}")
        return 0

    # Create output directory for this category
    output_dir = os.path.join(output_base, category)
    os.makedirs(output_dir, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  {category.upper()}: {len(zips)} zip files")
    print(f"  Output: {output_dir}")
    print(f"{'='*60}")

    success_count = 0
    for zip_file in sorted(zips):
        zip_path = os.path.join(zip_folder, zip_file)
        if extract_and_organize_zip(zip_path, output_dir):
            success_count += 1

    return success_count


def main():
    print("\n" + "="*60)
    print("  MESHY.AI ZIP EXTRACTOR")
    print("="*60)

    # Check if paths are configured
    paths_configured = False
    for folder in ZIP_FOLDERS.values():
        if folder and not folder.startswith("/path/to"):
            paths_configured = True
            break

    if not paths_configured:
        print("\n  ERROR: Please configure ZIP_FOLDERS and OUTPUT_FOLDER")
        print("  Edit this script and set the paths at the top.")
        return

    # Create output base folder
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)

    total_processed = 0

    for category, zip_folder in ZIP_FOLDERS.items():
        if not zip_folder or zip_folder.startswith("/path/to"):
            print(f"\n  Skipping {category} (path not configured)")
            continue

        count = process_category(category, zip_folder, OUTPUT_FOLDER)
        total_processed += count

    print("\n" + "="*60)
    print(f"  COMPLETE: {total_processed} models extracted")
    print(f"  Output folder: {OUTPUT_FOLDER}")
    print("="*60)
    print("\n  Next step: Run the Blender retopo script with:")
    print(f"    INPUT_FOLDERS pointing to: {OUTPUT_FOLDER}")
    print()


if __name__ == "__main__":
    main()
