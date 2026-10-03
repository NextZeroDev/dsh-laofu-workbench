# Laofu Workbench Identity

The original product mark was generated with Micu MCP `gpt-image-2`.
The jade L/W monogram represents a modular workbench; coral is its accent.
The production PNG has a transparent background. macOS uses a white rounded
tile; Windows application and tray icons use the transparent mark.

Generation prompt:

```text
Use case: logo-brand. Asset type: original desktop application icon and UI brand mark for Laofu Workbench, an AI workbench connecting modular capability packs and creative workflows. Design ONE distinctive, simple geometric monogram combining an upright L and an interlocking W as a single coherent architectural mark: a sturdy workbench-like base with two rising modular strokes. Flat vector-like graphic, broad solid shapes, crisp precise edges, excellent silhouette readable at 16 pixels. Rich jade/teal and a small warm coral accent; no gradients, no shadows, no texture, no 3D. Center the mark in a 1024x1024 square, mark occupies about 72% of width, generous clear margin. Genuinely transparent background preferred, otherwise pure solid white. No lettering, no wordmark, no watermark, no presentation board, no mockup, no extra icons. Original identity, do not resemble DeepSeek's whale or any existing corporate logo.
```

Background correction prompt:

```text
Change ONLY the backdrop. Remove the entire gray-white checkerboard and replace it with perfectly flat solid pure white #FFFFFF, including all negative spaces inside and between strokes. Preserve the teal and coral logo geometry, proportions, colors and exact placement unchanged. No shadow, no gradients, no gray pixels in background, no texture, no checkerboard. Output a clean production-ready logo on pure white.
```

The generated white backdrop was removed locally, preserving the geometry.
To regenerate the platform icons on macOS, install Pillow and run
`python3 scripts/build-brand-icons.py`.
