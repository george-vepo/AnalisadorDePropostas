import sql from 'mssql';

const dbServer = process.env.DB_SERVER;
const dbInstance = process.env.DB_INSTANCE;
const dbDatabase = process.env.DB_DATABASE;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;

if (!dbServer || !dbInstance || !dbDatabase || !dbUser || !dbPassword) {
  throw new Error('DB_SERVER, DB_INSTANCE, DB_DATABASE, DB_USER e DB_PASSWORD precisam estar configurados.');
}

const trustServerCertificate = (process.env.DB_TRUST_SERVER_CERT ?? 'true') === 'true';
const encrypt = (process.env.DB_ENCRYPT ?? 'false') === 'true';
const requestTimeout = Number(process.env.DB_REQUEST_TIMEOUT_MS ?? 30000);
const connectionTimeout = Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10000);

const config: sql.config = {
  user: dbUser,
  password: dbPassword,
  server: dbServer,
  database: dbDatabase,
  connectionTimeout,
  requestTimeout,
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  options: {
    instanceName: dbInstance,
    encrypt,
    trustServerCertificate,
  },
};

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export const getPool = async () => {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config);
    poolPromise = pool.connect();
  }
  return poolPromise;
};

export { sql };
