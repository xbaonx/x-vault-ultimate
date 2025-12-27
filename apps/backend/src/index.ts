import "reflect-metadata";
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import routes from './routes';
import { AppDataSource } from './data-source';

const app = express();

// Middleware
app.use(cors({
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
  origin: '*' // In production, you might want to restrict this to your frontend domains
}));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: '0.1.0' });
});

async function start() {
  try {
    await AppDataSource.initialize();
    console.log('Data Source has been initialized!');
  } catch (err) {
    console.error('Error during Data Source initialization. Starting in OFFLINE/MOCK mode.', err);
    // Do not exit, allow server to start for frontend testing
  }

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

start();
