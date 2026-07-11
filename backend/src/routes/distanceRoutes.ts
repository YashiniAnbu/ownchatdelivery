import { Router, Request, Response } from 'express';
import { getDistance, getDistanceMatrix } from '../services/distanceService';

const router = Router();

// Calculate distance between a single origin and destination
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const { origin, destination } = req.body;
    
    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Missing origin or destination in request body.'
      });
    }

    const result = await getDistance(origin, destination);
    
    if (result.status !== 'OK') {
      return res.status(500).json({
        status: result.status,
        error: result.errorMessage
      });
    }

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Calculate distance matrix for multiple origins and destinations
router.post('/matrix', async (req: Request, res: Response) => {
  try {
    const { origins, destinations } = req.body;

    if (!origins || !destinations || !Array.isArray(origins) || !Array.isArray(destinations)) {
      return res.status(400).json({
        error: 'origins and destinations must be arrays in the request body.'
      });
    }

    const result = await getDistanceMatrix(origins, destinations);

    if (result.status !== 'OK') {
      return res.status(500).json({
        status: result.status,
        error: result.errorMessage
      });
    }

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
