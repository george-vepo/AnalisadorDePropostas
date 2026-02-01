import sql from 'mssql/msnodesqlv8';

const dbServer = process.env.DB_SERVER;
const dbDatabase = process.env.DB_DATABASE;

if (!dbServer || !dbDatabase) {
  throw new Error('DB_SERVER e DB_DATABASE precisam estar configurados.');
}

const trustServerCertificate = (process.env.DB_TRUST_SERVER_CERT ?? 'false') === 'true';
const requestTimeout = Number(process.env.DB_REQUEST_TIMEOUT_MS ?? 30000);
const connectionTimeout = Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10000);

const config: sql.config = {
  server: dbServer,
  database: dbDatabase,
  connectionTimeout,
  requestTimeout,
  options: {
    trustedConnection: true,
    trustServerCertificate,
  },
};

const pool = new sql.ConnectionPool(config);
let poolPromise: Promise<sql.ConnectionPool> | null = null;

export const getPool = async () => {
  if (!poolPromise) {
    poolPromise = pool.connect();
  }
  return poolPromise;
};

export { sql };
