const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// Crea las tablas si no existen
async function inicializarDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id        SERIAL PRIMARY KEY,
      nombre    VARCHAR(100) NOT NULL,
      email     VARCHAR(150) UNIQUE NOT NULL,
      password  VARCHAR(255) NOT NULL,
      creado_en TIMESTAMP DEFAULT NOW()
    );
  `);
}

module.exports = { pool, inicializarDB };
