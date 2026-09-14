import { type Database, createDb } from "@binance-contract-trading-full-stack/db";

import { env } from "./env.server";

const db = createDb(env);

export function getDb(): Database {
  return db;
}
