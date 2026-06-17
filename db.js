const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function inicializarDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id        SERIAL PRIMARY KEY,
      nombre    VARCHAR(100) NOT NULL,
      email     VARCHAR(150) UNIQUE NOT NULL,
      password  VARCHAR(255) NOT NULL,
      rol       VARCHAR(20) DEFAULT 'cliente',
      creado_en TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol VARCHAR(20) DEFAULT 'cliente';

    CREATE TABLE IF NOT EXISTS categorias (
      id     SERIAL PRIMARY KEY,
      nombre VARCHAR(100) UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS productos (
      id           SERIAL PRIMARY KEY,
      nombre       VARCHAR(150) NOT NULL,
      descripcion  TEXT,
      precio       NUMERIC(12,2) NOT NULL,
      stock        INTEGER NOT NULL DEFAULT 0,
      categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
      imagen_url   VARCHAR(300),
      activo       BOOLEAN DEFAULT TRUE,
      creado_en    TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ventas (
      id          SERIAL PRIMARY KEY,
      usuario_id  INTEGER REFERENCES usuarios(id),
      total       NUMERIC(12,2) NOT NULL,
      estado      VARCHAR(30) DEFAULT 'pendiente',
      creado_en   TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS detalle_ventas (
      id          SERIAL PRIMARY KEY,
      venta_id    INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
      producto_id INTEGER REFERENCES productos(id),
      cantidad    INTEGER NOT NULL,
      precio_unit NUMERIC(12,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS movimientos_stock (
      id          SERIAL PRIMARY KEY,
      producto_id INTEGER REFERENCES productos(id),
      tipo        VARCHAR(20) NOT NULL,
      cantidad    INTEGER NOT NULL,
      motivo      VARCHAR(200),
      usuario_id  INTEGER REFERENCES usuarios(id),
      creado_en   TIMESTAMP DEFAULT NOW()
    );
  `);
}

module.exports = { pool, inicializarDB };
