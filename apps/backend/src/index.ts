import "reflect-metadata";
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import routes from './routes';
import { AppDataSource } from './data-source';
import { JobRunnerService } from './services/job-runner.service';

const app = express();

// Prevent 304 responses on JSON API routes (can break some clients that don't handle 304 as success)
app.set('etag', false);

// Middleware
app.use(cors({
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-device-library-id'],
  origin: (origin, callback) => {
    const allowlist = (config.security?.corsOrigins || []).filter(Boolean);
    if (config.nodeEnv !== 'production' || allowlist.length === 0) {
      return callback(null, true);
    }
    if (!origin) {
      return callback(null, false);
    }
    const allowed = allowlist.includes(origin);
    return callback(null, allowed);
  },
}));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString('utf8');
  }
}));

// Disable caching for API responses
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: '0.1.0' });
});

async function initializeDataSourceWithRetry() {
  const isProd = config.nodeEnv === 'production';
  const maxAttempts = isProd ? 10 : 1;
  const delayMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await AppDataSource.initialize();
      console.log('Data Source has been initialized!');
      return;
    } catch (err) {
      console.error(`Error during Data Source initialization (attempt ${attempt}/${maxAttempts}).`, err);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  if (isProd) {
    process.exit(1);
  }
}

async function start() {
  await initializeDataSourceWithRetry();

  if (!AppDataSource.isInitialized) {
    console.warn('Data Source is not initialized. Server will not start.');
    return;
  }

  JobRunnerService.start();

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

start();
