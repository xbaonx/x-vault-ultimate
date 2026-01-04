import { DataSource } from "typeorm";
import { config } from "./config";
import { User } from "./entities/User";
import { Device } from "./entities/Device";
import { Wallet } from "./entities/Wallet";
import { Transaction } from "./entities/Transaction";
import { AppleConfig } from "./entities/AppleConfig";
import { PollingSession } from "./entities/PollingSession";
import { PassRegistration } from "./entities/PassRegistration";
import { ChainCursor } from "./entities/ChainCursor";
import { DepositEvent } from "./entities/DepositEvent";
import { AaAddressMap } from "./entities/AaAddressMap";

const dbSslEnabled = (process.env.DB_SSL || "").toLowerCase() === "true";
const dbSslRejectUnauthorized = (process.env.DB_SSL_REJECT_UNAUTHORIZED || "").toLowerCase() === "true";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: config.databaseUrl || undefined,
  host: config.databaseUrl ? undefined : config.database.host,
  port: config.databaseUrl ? undefined : config.database.port,
  username: config.databaseUrl ? undefined : config.database.username,
  password: config.databaseUrl ? undefined : config.database.password,
  database: config.databaseUrl ? undefined : config.database.database,
  synchronize: true,
  logging: false,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
  entities: [User, Device, Wallet, Transaction, AppleConfig, PollingSession, PassRegistration, ChainCursor, DepositEvent, AaAddressMap],
});
