#!/usr/bin/env python3
"""Parse Poultry Feed data2.xlsx MAIN TABLE into JSON for inspection/import workflows."""

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

        target = None
        for sheet in workbook.findall('a:sheets/a:sheet', NS):
            if sheet.attrib.get('name') == 'MAIN TABLE':
                rid = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
                target = f"xl/{rel_map[rid]}"
                break

        if not target:
            raise RuntimeError('MAIN TABLE sheet not found')

        sheet_root = ET.fromstring(archive.read(target))

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

        for row in sheet_root.findall('.//a:sheetData/a:row', NS):
            row_no = int(row.attrib.get('r', '0'))
            cells = {col_idx(c.attrib.get('r', 'A1')): read_value(c) for c in row.findall('a:c', NS)}
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

        return {
            'workbook': path.name,
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
