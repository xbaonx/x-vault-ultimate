import { DataSource } from "typeorm";
import { config } from "./config";
import { User } from "./entities/User";
import { Device } from "./entities/Device";
import { Transaction } from "./entities/Transaction";
import { AppleConfig } from "./entities/AppleConfig";

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
  ssl: dbSslEnabled
    ? {
        rejectUnauthorized: dbSslRejectUnauthorized,
      }
    : undefined,
  entities: [User, Device, Transaction, AppleConfig],
});
