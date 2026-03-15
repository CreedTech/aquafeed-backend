#!/usr/bin/env python3
"""Parse Poultry Feed data2.xlsx sheets for live import workflows.

Outputs:
- ingredients from MAIN TABLE
- fish standards from Catfish sheet
"""

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {
    'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}


def col_idx(cell_ref: str) -> int:
    match = re.match(r'([A-Z]+)', cell_ref)
    if not match:
        return 1
    letters = match.group(1)
    value = 0
    for ch in letters:
        value = (value * 26) + (ord(ch) - 64)
    return value


def parse_workbook(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        shared_strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            for si in root.findall('a:si', NS):
                text = ''.join((t.text or '') for t in si.findall('.//a:t', NS))
                shared_strings.append(text)

        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        rels = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        rel_map = {rel.attrib['Id']: rel.attrib['Target'] for rel in rels}

        def get_sheet_target(sheet_name: str) -> str:
            for sheet in workbook.findall('a:sheets/a:sheet', NS):
                if sheet.attrib.get('name') == sheet_name:
                    rid = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
                    return f"xl/{rel_map[rid]}"
            raise RuntimeError(f'{sheet_name} sheet not found')

        def read_value(cell):
            kind = cell.attrib.get('t')
            node = cell.find('a:v', NS)
            if node is None:
                return None
            raw = node.text
            if kind == 's':
                return shared_strings[int(raw)]
            try:
                parsed = float(raw)
                return int(parsed) if parsed.is_integer() else parsed
            except Exception:
                return raw

        def read_sheet_cells(sheet_name: str):
            target = get_sheet_target(sheet_name)
            sheet_root = ET.fromstring(archive.read(target))
            rows = []
            for row in sheet_root.findall('.//a:sheetData/a:row', NS):
                row_no = int(row.attrib.get('r', '0'))
                cells = {col_idx(c.attrib.get('r', 'A1')): read_value(c) for c in row.findall('a:c', NS)}
                rows.append((row_no, cells))
            return rows

        ingredients = []
        current_category = 'OTHER'
        category_headers = {
            'CARBOHYDRATE': 'CARBOHYDRATE',
            'PROTEIN': 'PROTEIN',
            'FIBER': 'FIBER',
            'FIBRE': 'FIBER',
            'MINERALS': 'MINERALS',
            'MINERALS / VITAMINS': 'MINERALS',
            'OIL': 'OTHER',
        }

        for row_no, cells in read_sheet_cells('MAIN TABLE'):
            name = cells.get(2)
            if name is None:
                continue
            name = str(name).strip()
            if not name:
                continue

            upper = name.upper()
            if upper in category_headers:
                current_category = category_headers[upper]
                continue

            if row_no < 4:
                continue

            def num(value):
                try:
                    return float(value)
                except Exception:
                    return 0.0

            ingredients.append({
                'name': upper,
                'category': current_category,
                'nutrients': {
                    'protein': num(cells.get(3)),
                    'fat': num(cells.get(4)),
                    'fiber': num(cells.get(5)),
                    'ash': num(cells.get(6)),
                    'lysine': num(cells.get(7)),
                    'methionine': num(cells.get(8)),
                    'calcium': num(cells.get(9)),
                    'phosphorous': num(cells.get(10)),
                    'energy': num(cells.get(11)),
                },
            })

        nutrient_name_to_key = {
            'CRUDE PROTEIN': 'protein',
            'CRUDE FAT (LIPID)': 'fat',
            'CRUDE FIBER': 'fiber',
            'ASH (MINERALS)': 'ash',
            'CALCIUM': 'calcium',
            'PHOSPHORUS': 'phosphorous',
            'LYSINE': 'lysine',
            'METHIONINE': 'methionine',
        }
        stage_code_by_pellet = {
            '2MM': 'FISH_CATFISH_2MM_FINGERLINGS',
            '3MM': 'FISH_CATFISH_3MM_JUVENILES',
            '4MM': 'FISH_CATFISH_4MM_GROW_OUT',
            '6MM': 'FISH_CATFISH_6MM_GROW_OUT',
        }
        stage_label_by_pellet = {
            '2MM': 'Fingerlings',
            '3MM': 'Juveniles',
            '4MM': 'Grow-out',
            '6MM': 'Grow-out',
        }

        fish_rows = read_sheet_cells('Catfish')
        row_map = {row_no: cells for row_no, cells in fish_rows}

        pellet_columns = {}
        for col_idx_val in (3, 5, 7, 9):
            pellet = row_map.get(2, {}).get(col_idx_val)
            if pellet is None:
                continue
            pellet_key = str(pellet).strip().upper()
            if pellet_key in stage_code_by_pellet:
                pellet_columns[pellet_key] = col_idx_val

        stage_note_by_pellet = {}
        for row_no in (13, 14, 15, 16):
            cells = row_map.get(row_no, {})
            pellet = str(cells.get(1) or '').strip().upper()
            note = str(cells.get(2) or '').strip()
            if pellet in stage_code_by_pellet:
                stage_note_by_pellet[pellet] = note

        fish_nutrients_by_pellet = {
            pellet: {}
            for pellet in pellet_columns.keys()
        }

        for row_no in range(3, 11):
            cells = row_map.get(row_no, {})
            nutrient_label = str(cells.get(2) or '').strip().upper()
            nutrient_key = nutrient_name_to_key.get(nutrient_label)
            if not nutrient_key:
                continue

            for pellet, column in pellet_columns.items():
                value = cells.get(column)
                try:
                    numeric = float(value)
                except Exception:
                    continue
                fish_nutrients_by_pellet[pellet][nutrient_key] = {
                    'min': numeric,
                    'max': numeric,
                }

        fish_standards = []
        ordered_pellets = ['2MM', '3MM', '4MM', '6MM']
        for pellet in ordered_pellets:
            if pellet not in fish_nutrients_by_pellet:
                continue
            stage_code = stage_code_by_pellet[pellet]
            stage_label = stage_label_by_pellet[pellet]
            age_guidance = stage_note_by_pellet.get(pellet, f'{pellet} feed stage')
            fish_standards.append({
                'stageCode': stage_code,
                'name': f'Catfish {pellet.lower()} {stage_label}',
                'feedCategory': 'Catfish',
                'fishType': 'Catfish',
                'stage': stage_label,
                'ageGuidance': age_guidance,
                'pelletSize': pellet.lower(),
                'brand': 'Fish Workbook',
                'sourceSheet': 'Catfish',
                'targetNutrients': fish_nutrients_by_pellet[pellet],
            })

        return {
            'workbook': path.name,
            'generatedAt': path.stat().st_mtime,
            'version': None,
            'standards': fish_standards,
            'ingredients': ingredients,
            'count': len(ingredients),
        }


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: parsePoultryWorkbook.py <xlsx-path>', file=sys.stderr)
        return 1

    workbook_path = Path(sys.argv[1]).expanduser().resolve()
    if not workbook_path.exists():
        print(f'Workbook not found: {workbook_path}', file=sys.stderr)
        return 1

    parsed = parse_workbook(workbook_path)
    print(json.dumps(parsed, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
