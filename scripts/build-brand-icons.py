"""Regenerate Desktop icons from the product PNG (requires Pillow and iconutil)."""
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "lwb/desktop/resources"
LOGO = ROOT / "lwb/dsh-bundle/assets/laofu-workbench-logo.png"
RESOURCES.mkdir(parents=True, exist_ok=True)
logo = Image.open(LOGO).convert("RGBA")
logo.save(RESOURCES / "icon-windows.ico", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])

# Small tray sizes need less empty margin than the application icon.
tray = Image.new("RGBA", (256, 256))
mark = logo.crop(logo.getbbox())
mark.thumbnail((224, 224), Image.Resampling.LANCZOS)
tray.alpha_composite(mark, ((256 - mark.width) // 2, (256 - mark.height) // 2))
tray.save(RESOURCES / "tray-windows.ico", sizes=[(n, n) for n in (16, 20, 24, 32, 40, 48, 64, 128, 256)])

icon = Image.new("RGBA", (1024, 1024))
ImageDraw.Draw(icon).rounded_rectangle((80, 80, 944, 944), radius=184, fill="white")
icon.alpha_composite(logo.resize((864, 864), Image.Resampling.LANCZOS), (80, 80))
with tempfile.TemporaryDirectory() as temporary:
    iconset = Path(temporary) / "LaofuWorkbench.iconset"
    iconset.mkdir()
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            suffix = "@2x" if scale == 2 else ""
            icon.resize((size * scale, size * scale), Image.Resampling.LANCZOS).save(
                iconset / f"icon_{size}x{size}{suffix}.png"
            )
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(RESOURCES / "icon-macos.icns")], check=True)
