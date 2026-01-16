# Tool/Script Template

Use this template when adding a new tool or script to `docs/tools/`.

## Template

```markdown
# {Tool Name}

## Purpose
{What this tool does and why it exists}

## Requirements
- {dependency 1}
- {dependency 2}

## Usage

```bash
{command to run the tool}
```

### Arguments
| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| {arg} | {yes/no} | {default} | {description} |

## Examples

### {Example 1 Name}
```bash
{example command}
```
{Expected output or result}

### {Example 2 Name}
```bash
{example command}
```
{Expected output or result}

## Notes
- {Important note 1}
- {Important note 2}
```

## Example

```markdown
# Animation Extractor

## Purpose
Extracts animation names from GLTF/GLB files for documentation and code generation.

## Requirements
- Python 3.8+
- pygltflib (`pip install pygltflib`)

## Usage

```bash
python extract_animation_names.py <input_file> [--output json|csv]
```

### Arguments
| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| input_file | yes | - | Path to GLTF/GLB file |
| --output | no | json | Output format (json or csv) |

## Examples

### Extract to JSON
```bash
python extract_animation_names.py model.glb
```
Outputs: `["idle", "walk", "run", "attack"]`

### Extract to CSV
```bash
python extract_animation_names.py model.glb --output csv
```
Outputs: `idle,walk,run,attack`

## Notes
- Supports both .gltf and .glb formats
- Animation names are extracted in order they appear in the file
```
