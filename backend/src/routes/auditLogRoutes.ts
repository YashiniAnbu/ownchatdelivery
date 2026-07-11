import { Router, Request, Response } from 'express';
import AuditLog from '../models/AuditLog';

const router = Router();

// Get paginated, filterable audit logs
router.get('/', async (req: Request, res: Response) => {
  try {
    const { actorType, action, startDate, endDate, page = '1', limit = '20', download } = req.query;

    const filter: any = {};

    if (actorType) {
      filter.actorType = actorType;
    }

    if (action) {
      if (action === 'operational') {
        filter.action = { $nin: ['LOGIN', 'LOGOUT'] };
      } else {
        filter.action = action;
      }
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate as string);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate as string);
      }
    }

    if (download === 'true') {
      const allLogs = await AuditLog.find(filter).sort({ createdAt: -1 });
      const csvRows = ['Timestamp,Actor Type,Actor Name,Action,Target Type,Target ID,Metadata'];
      for (const log of allLogs) {
        const row = [
          log.createdAt,
          log.actorType,
          `"${log.actorName}"`,
          log.action,
          log.targetType,
          log.targetId,
          `"${JSON.stringify(log.metadata).replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
      }
      res.header('Content-Type', 'text/csv');
      res.attachment('audit_logs.csv');
      return res.send(csvRows.join('\\r\\n'));
    }

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skipNum = (pageNum - 1) * limitNum;

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum);

    const total = await AuditLog.countDocuments(filter);

    return res.json({
      logs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
