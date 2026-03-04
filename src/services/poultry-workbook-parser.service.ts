import {
    poultryWorkbookSnapshot,
    PoultryWorkbookSnapshot,
    WorkbookNutrientRange
} from '../data/poultryWorkbookSnapshot';
import path from 'path';
import { spawnSync } from 'child_process';

export type ParsedRange = WorkbookNutrientRange;

const RANGE_PATTERN = /(\d+(?:\.\d+)?)\s*[\-–]\s*(\d+(?:\.\d+)?)/;
const NUMBER_PATTERN = /(\d+(?:\.\d+)?)/;

const normalizeNumeric = (value: string) => Number.parseFloat(value.replace(/,/g, '').trim());

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();

const parseRangeText = (value: string): ParsedRange | null => {
    const sanitized = value.replace(/kcal\/kg|%|MJ\/kg/gi, '').trim();
    const rangeMatch = sanitized.match(RANGE_PATTERN);

    if (rangeMatch) {
        return {
            min: normalizeNumeric(rangeMatch[1]),
            max: normalizeNumeric(rangeMatch[2])
        };
    }

    const singleMatch = sanitized.match(NUMBER_PATTERN);
    if (!singleMatch) return null;

    const numeric = normalizeNumeric(singleMatch[1]);
    return { min: numeric, max: numeric };
};

const cloneSnapshot = (): PoultryWorkbookSnapshot => JSON.parse(JSON.stringify(poultryWorkbookSnapshot)) as PoultryWorkbookSnapshot;

type ParseOptions = {
    preferLiveWorkbook?: boolean;
    workbookPath?: string;
};

const parseLiveWorkbook = (workbookPath: string): PoultryWorkbookSnapshot | null => {
    const scriptPath = path.resolve(process.cwd(), 'src/scripts/parsePoultryWorkbook.py');
    const command = spawnSync('python3', [scriptPath, workbookPath], {
        encoding: 'utf-8'
    });

    if (command.status !== 0 || !command.stdout) {
        return null;
    }

    try {
        const parsed = JSON.parse(command.stdout) as {
            workbook: string;
            ingredients: PoultryWorkbookSnapshot['ingredients'];
        };
        const snapshot = cloneSnapshot();
        snapshot.workbook = parsed.workbook || snapshot.workbook;
        snapshot.ingredients = parsed.ingredients || snapshot.ingredients;
        return snapshot;
    } catch (_error) {
        return null;
    }
};

export const poultryWorkbookParserService = {
    normalizeName,
    parseRangeText,

    async loadSnapshot(options: ParseOptions = {}): Promise<PoultryWorkbookSnapshot> {
        if (options.preferLiveWorkbook && options.workbookPath) {
            const live = parseLiveWorkbook(options.workbookPath);
            if (live) return live;
        }
        return cloneSnapshot();
    }
};
