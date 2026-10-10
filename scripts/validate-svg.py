from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
for name in ("dark_mode.svg", "light_mode.svg"):
    path = root / name
    svg = ET.parse(path).getroot()
    if svg.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError(f"{name}: invalid SVG root")
    if svg.attrib.get("viewBox") != "0 0 1200 700":
        raise ValueError(f"{name}: unexpected card dimensions")
    if "{{" in path.read_text(encoding="utf-8"):
        raise ValueError(f"{name}: unresolved placeholder")
    print(f"{name}: valid SVG")
