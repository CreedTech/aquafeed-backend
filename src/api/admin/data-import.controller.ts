import { Request, Response } from 'express';
import DataImportRun from '../../models/DataImportRun';
import { poultryWorkbookImportService } from '../../services/poultry-workbook-import.service';

export const previewPoultryWorkbookImport = async (_req: Request, res: Response) => {
    try {
        const run = await poultryWorkbookImportService.preview({
            preferLiveWorkbook: _req.body?.preferLiveWorkbook === true,
            workbookPath: _req.body?.workbookPath
                ? String(_req.body.workbookPath)
                : undefined
        });
        res.status(201).json({
            message: 'Workbook preview generated successfully',
            run
        });
    } catch (error) {
        console.error('Preview poultry workbook import error:', error);
        res.status(500).json({
            error: 'Failed to preview workbook import',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const applyPoultryWorkbookImport = async (req: Request, res: Response) => {
    try {
        const runId = req.body?.runId ? String(req.body.runId) : undefined;
        const result = await poultryWorkbookImportService.apply(runId, {
            preferLiveWorkbook: req.body?.preferLiveWorkbook === true,
            workbookPath: req.body?.workbookPath
                ? String(req.body.workbookPath)
                : undefined
        });
        res.status(200).json({
            message: 'Workbook import applied successfully',
            run: result.run,
            applied: result.applied
        });
    } catch (error) {
        console.error('Apply poultry workbook import error:', error);
        res.status(400).json({
            error: 'Failed to apply workbook import',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const getPoultryWorkbookImportRun = async (req: Request, res: Response) => {
    try {
        const { runId } = req.params;
        const run = await poultryWorkbookImportService.getRun(runId);

        if (!run) {
            return res.status(404).json({ error: 'Import run not found' });
        }

        res.json({ run });
    } catch (error) {
        console.error('Get poultry workbook import run error:', error);
        res.status(500).json({
            error: 'Failed to fetch import run',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const rollbackPoultryWorkbookImport = async (req: Request, res: Response) => {
    try {
        const { runId } = req.params;
        const run = await poultryWorkbookImportService.rollback(runId);
        res.status(200).json({
            message: 'Workbook import rollback completed',
            run
        });
    } catch (error) {
        console.error('Rollback poultry workbook import error:', error);
        res.status(400).json({
            error: 'Failed to rollback import run',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const getRecentPoultryWorkbookImports = async (_req: Request, res: Response) => {
    try {
        const runs = await DataImportRun.find({ importType: 'poultry_workbook' })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();

        res.json({
            count: runs.length,
            runs
        });
    } catch (error) {
        console.error('Get recent poultry workbook imports error:', error);
        res.status(500).json({
            error: 'Failed to fetch import history',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};
