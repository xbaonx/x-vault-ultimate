import "reflect-metadata";
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import routes from './routes';
import { DataSource } from "typeorm";

const app = express();

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: '0.1.0' });
});

// Database connection (Mock for now until DB is set up)
// const AppDataSource = new DataSource({
//     type: "postgres",
//     host: config.database.host,
//     port: config.database.port,
//     username: config.database.username,
//     password: config.database.password,
//     database: config.database.database,
//     synchronize: true,
//     logging: false,
//     entities: [],
//     subscribers: [],
//     migrations: [],
// });

// AppDataSource.initialize()
//     .then(() => {
//         console.log("Data Source has been initialized!");
//     })
//     .catch((err) => {
//         console.error("Error during Data Source initialization", err);
//     });

// Start server
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
