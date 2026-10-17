import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Lazy singleton: constructing the client is deferred until the first query so
// that importing this module (e.g. during `next build`) does not require
// DATABASE_URL to be present. The throw happens only when the DB is actually used.
const globalForDb = globalThis as unknown as {
  _pgClient?: ReturnType<typeof postgres>;
  _db?: PostgresJsDatabase<typeof schema>;
};

function init(): PostgresJsDatabase<typeof schema> {
  if (globalForDb._db) return globalForDb._db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  }

  const client =
    globalForDb._pgClient ??
    postgres(connectionString, {
      prepare: false, // required for Supabase transaction-pooler compatibility
      max: 5,
    });

  const instance = drizzle(client, { schema });
  if (process.env.NODE_ENV !== 'production') {
    globalForDb._pgClient = client;
    globalForDb._db = instance;
  }
  return instance;
}

// Proxy forwards every property access to the lazily-initialized drizzle instance.
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = init();
    return Reflect.get(real as object, prop, receiver);
  },
});

export { schema };
