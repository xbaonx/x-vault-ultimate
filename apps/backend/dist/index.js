"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = require("./config");
const routes_1 = __importDefault(require("./routes"));
const app = (0, express_1.default)();
// Middleware
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
// Routes
app.use('/api', routes_1.default);
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
app.listen(config_1.config.port, () => {
    console.log(`Server running on port ${config_1.config.port}`);
});
