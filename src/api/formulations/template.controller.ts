import { Request, Response } from 'express';
import FeedTemplate from '../../models/FeedTemplate';

/**
 * Get all available feed templates
 */
export const getAllTemplates = async (req: Request, res: Response) => {
    try {
        const { category, type } = req.query;
        const query: any = { isActive: true };

        if (category) query.feedCategory = category;
        if (type) query.poultryType = type;

        const templates = await FeedTemplate.find(query).sort({ name: 1 });
        res.json(templates);
    } catch (error) {
        console.error('Get Templates Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Admin: Create a new template
 */
export const createTemplate = async (req: Request, res: Response) => {
    try {
        const template = new FeedTemplate(req.body);
        await template.save();
        res.status(201).json(template);
    } catch (error) {
        console.error('Create Template Error:', error);
        res.status(400).json({ error: 'Failed to create template' });
    }
};

/**
 * Admin: Update a template
 */
export const updateTemplate = async (req: Request, res: Response) => {
    try {
        const template = await FeedTemplate.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (!template) return res.status(404).json({ error: 'Template not found' });
        res.json(template);
    } catch (error) {
        console.error('Update Template Error:', error);
        res.status(400).json({ error: 'Failed to update template' });
    }
};
