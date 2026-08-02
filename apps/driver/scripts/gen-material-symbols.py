#!/usr/bin/env python3
"""Regenerate the Material Symbols icon fonts + codepoints for the driver app.

Axes baked per the design system: style Rounded + Outlined, weight 200, grade 200, opsz 24,
FILL 0 (outline) and FILL 1 (filled). To add icons: append names to NAMES and re-run.

    pip install fonttools brotli
    npm i material-symbols            # provides the full variable fonts
    python scripts/gen-material-symbols.py

Outputs: assets/fonts/MaterialSymbols{Rounded,RoundedFill,Outlined,OutlinedFill}.ttf
         src/theme/materialSymbols.generated.ts
"""
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Subsetter, Options
import pathlib, json

NAMES = sorted(set("""
home menu more_horiz more_vert arrow_back arrow_forward chevron_right chevron_left
expand_more expand_less close check check_circle cancel add remove edit delete
local_gas_station bolt ev_station water_drop oil_barrel local_shipping directions
navigation map place speed pin_drop route my_location explore
error warning info schedule sync sync_problem cloud_off cloud_done cloud_sync
wifi_off wifi signal_cellular_off download upload refresh done pending hourglass_empty
photo_camera image add_a_photo flash_on filter_list search mail call
settings logout login person badge account_circle visibility visibility_off
calendar_today event star workspace_premium military_tech trending_up trending_down
north south keyboard_arrow_down keyboard_arrow_up radio_button_unchecked radio_button_checked
check_box check_box_outline_blank lock lock_open dark_mode light_mode
notifications notifications_active help history verified verified_user shield
school quiz play_circle play_arrow local_fire_department science dangerous
health_and_safety fmd_bad report priority_high task_alt do_not_disturb_on
attach_money payments credit_card qr_code_scanner content_copy open_in_new
""".split()))

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path("node_modules/material-symbols")

def build():
    inv = {gn: cp for cp, gn in TTFont(SRC / "material-symbols-rounded.woff2").getBestCmap().items()}
    codepoints = {n: inv[n] for n in NAMES if n in inv}
    unicodes = list(codepoints.values())
    (ROOT / "assets/fonts").mkdir(parents=True, exist_ok=True)
    for style in ("rounded", "outlined"):
        for fill in (0, 1):
            fam = f"MaterialSymbols{style.capitalize()}{'Fill' if fill else ''}"
            f = TTFont(SRC / f"material-symbols-{style}.woff2")
            instantiateVariableFont(f, {"wght": 200, "GRAD": 200, "opsz": 24, "FILL": fill}, inplace=True)
            opt = Options(); opt.layout_features = []; opt.glyph_names = False; opt.notdef_outline = True
            ss = Subsetter(options=opt); ss.populate(unicodes=unicodes); ss.subset(f)
            f.save(ROOT / f"assets/fonts/{fam}.ttf")
    lines = ["// AUTO-GENERATED — Material Symbols codepoints (wght 200, grade 200, opsz 24).",
             "// Regenerate: python scripts/gen-material-symbols.py", "export const MATERIAL_SYMBOLS = {"]
    lines += [f"  {n!r}: 0x{codepoints[n]:04X}," for n in sorted(codepoints)]
    lines += ["} as const;", "export type MaterialSymbolName = keyof typeof MATERIAL_SYMBOLS;", ""]
    (ROOT / "src/theme/materialSymbols.generated.ts").write_text("\n".join(lines))
    print(f"generated {len(codepoints)} icons")

if __name__ == "__main__":
    build()
