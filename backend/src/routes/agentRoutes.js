import { Router } from 'express';
import cors from 'cors';
import { handleLovableDispatch } from '../controllers/agentController.js';

export const agentRouter = Router();

// Middleware CORS permisivo para peticiones directas desde Lovable y extensiones de Chrome
const lovableCors = cors({
  origin: (origin, callback) => {
    if (origin) {
      return callback(null, origin);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-dispatch-mode', 'x-lovable-project'],
  credentials: true
});

agentRouter.options('/lovable-dispatch', lovableCors);
agentRouter.post('/lovable-dispatch', lovableCors, handleLovableDispatch);

export default agentRouter;
