const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function inicializarDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      -- Roles con permisos en JSONB
      CREATE TABLE IF NOT EXISTS roles (
        id         SERIAL PRIMARY KEY,
        nombre     VARCHAR(50) UNIQUE NOT NULL,
        permisos   JSONB NOT NULL DEFAULT '{}',
        es_sistema BOOLEAN DEFAULT FALSE,
        creado_en  TIMESTAMP DEFAULT NOW()
      );

      -- Categorías de productos
      CREATE TABLE IF NOT EXISTS categorias (
        id     SERIAL PRIMARY KEY,
        nombre VARCHAR(100) UNIQUE NOT NULL
      );

      -- Marcas
      CREATE TABLE IF NOT EXISTS marcas (
        id     SERIAL PRIMARY KEY,
        nombre VARCHAR(100) UNIQUE NOT NULL
      );

      -- Unidades de medida
      CREATE TABLE IF NOT EXISTS unidades_medida (
        id      SERIAL PRIMARY KEY,
        nombre  VARCHAR(50) NOT NULL,
        simbolo VARCHAR(10) NOT NULL
      );

      -- Usuarios (base, sin FK a roles aún)
      CREATE TABLE IF NOT EXISTS usuarios (
        id        SERIAL PRIMARY KEY,
        nombre    VARCHAR(100) NOT NULL,
        email     VARCHAR(150) UNIQUE NOT NULL,
        password  VARCHAR(255) NOT NULL,
        rol_id    INTEGER,
        creado_en TIMESTAMP DEFAULT NOW()
      );

      -- Migración: columna rol_id si no existe
      ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol_id INTEGER;

      -- Proveedores
      CREATE TABLE IF NOT EXISTS proveedores (
        id        SERIAL PRIMARY KEY,
        nombre    VARCHAR(150) NOT NULL,
        nit       VARCHAR(30),
        telefono  VARCHAR(20),
        email     VARCHAR(100),
        direccion TEXT,
        activo    BOOLEAN DEFAULT TRUE,
        creado_en TIMESTAMP DEFAULT NOW()
      );

      -- Clientes
      CREATE TABLE IF NOT EXISTS clientes (
        id                SERIAL PRIMARY KEY,
        nombre            VARCHAR(150) NOT NULL,
        documento         VARCHAR(30),
        telefono          VARCHAR(20),
        email             VARCHAR(100),
        credito_disponible NUMERIC(12,2) DEFAULT 0,
        activo            BOOLEAN DEFAULT TRUE,
        creado_en         TIMESTAMP DEFAULT NOW()
      );

      -- Productos
      CREATE TABLE IF NOT EXISTS productos (
        id               SERIAL PRIMARY KEY,
        sku              VARCHAR(50) UNIQUE NOT NULL,
        codigo_barras    VARCHAR(50),
        nombre           VARCHAR(200) NOT NULL,
        descripcion      TEXT,
        categoria_id     INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
        marca_id         INTEGER REFERENCES marcas(id) ON DELETE SET NULL,
        unidad_id        INTEGER REFERENCES unidades_medida(id) ON DELETE SET NULL,
        precio_compra    NUMERIC(12,2) NOT NULL DEFAULT 0,
        precio_venta     NUMERIC(12,2) NOT NULL DEFAULT 0,
        iva_porcentaje   NUMERIC(5,2) NOT NULL DEFAULT 19,
        stock_actual     INTEGER NOT NULL DEFAULT 0,
        stock_minimo     INTEGER NOT NULL DEFAULT 0,
        punto_reorden    INTEGER NOT NULL DEFAULT 0,
        ubicacion        VARCHAR(100),
        imagen_url       VARCHAR(300),
        activo           BOOLEAN DEFAULT TRUE,
        creado_en        TIMESTAMP DEFAULT NOW()
      );

      -- Lotes (para productos perecederos)
      CREATE TABLE IF NOT EXISTS lotes (
        id               SERIAL PRIMARY KEY,
        producto_id      INTEGER NOT NULL REFERENCES productos(id),
        numero_lote      VARCHAR(100) NOT NULL,
        fecha_vencimiento DATE,
        cantidad_inicial INTEGER NOT NULL DEFAULT 0,
        cantidad_actual  INTEGER NOT NULL DEFAULT 0,
        activo           BOOLEAN DEFAULT TRUE,
        creado_en        TIMESTAMP DEFAULT NOW()
      );

      -- Kardex (movimientos de inventario)
      CREATE TABLE IF NOT EXISTS movimientos_stock (
        id               SERIAL PRIMARY KEY,
        producto_id      INTEGER NOT NULL REFERENCES productos(id),
        lote_id          INTEGER REFERENCES lotes(id),
        tipo             VARCHAR(30) NOT NULL,
        cantidad         INTEGER NOT NULL,
        cantidad_antes   INTEGER NOT NULL,
        cantidad_despues INTEGER NOT NULL,
        referencia_id    INTEGER,
        referencia_tipo  VARCHAR(30),
        motivo           TEXT,
        usuario_id       INTEGER REFERENCES usuarios(id),
        creado_en        TIMESTAMP DEFAULT NOW()
      );

      -- Órdenes de compra
      CREATE TABLE IF NOT EXISTS ordenes_compra (
        id           SERIAL PRIMARY KEY,
        proveedor_id INTEGER REFERENCES proveedores(id),
        estado       VARCHAR(20) DEFAULT 'borrador',
        subtotal     NUMERIC(12,2) DEFAULT 0,
        iva_total    NUMERIC(12,2) DEFAULT 0,
        total        NUMERIC(12,2) DEFAULT 0,
        notas        TEXT,
        usuario_id   INTEGER REFERENCES usuarios(id),
        creado_en    TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS detalle_ordenes_compra (
        id                SERIAL PRIMARY KEY,
        orden_id          INTEGER NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
        producto_id       INTEGER NOT NULL REFERENCES productos(id),
        cantidad          INTEGER NOT NULL,
        precio_unit       NUMERIC(12,2) NOT NULL,
        numero_lote       VARCHAR(100),
        fecha_vencimiento DATE
      );

      -- Ventas
      CREATE TABLE IF NOT EXISTS ventas (
        id         SERIAL PRIMARY KEY,
        cliente_id INTEGER REFERENCES clientes(id),
        usuario_id INTEGER REFERENCES usuarios(id),
        subtotal   NUMERIC(12,2) DEFAULT 0,
        iva_total  NUMERIC(12,2) DEFAULT 0,
        total      NUMERIC(12,2) DEFAULT 0,
        estado     VARCHAR(20) DEFAULT 'completada',
        notas      TEXT,
        creado_en  TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS detalle_ventas (
        id             SERIAL PRIMARY KEY,
        venta_id       INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
        producto_id    INTEGER NOT NULL REFERENCES productos(id),
        lote_id        INTEGER REFERENCES lotes(id),
        cantidad       INTEGER NOT NULL,
        precio_unit    NUMERIC(12,2) NOT NULL,
        iva_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 19
      );
    `);

    // Sembrar roles del sistema
    await client.query(`
      INSERT INTO roles (nombre, permisos, es_sistema) VALUES
        ('superusuario', '{"productos":true,"stock":true,"compras":true,"ventas":true,"reportes":true,"usuarios":true,"roles":true,"asignar_admin":true}', TRUE),
        ('administrador', '{"productos":true,"stock":true,"compras":true,"ventas":true,"reportes":true,"usuarios":true,"roles":true,"asignar_admin":false}', TRUE),
        ('cajero', '{"productos":false,"stock":false,"compras":false,"ventas":true,"reportes":false,"usuarios":false,"roles":false,"asignar_admin":false}', TRUE)
      ON CONFLICT (nombre) DO NOTHING;
    `);

    // Sembrar unidades básicas
    await client.query(`
      INSERT INTO unidades_medida (nombre, simbolo) VALUES
        ('Unidad','und'),('Kilogramo','kg'),('Gramo','g'),
        ('Litro','L'),('Mililitro','mL'),('Caja','caja'),
        ('Paquete','paq'),('Docena','doc')
      ON CONFLICT DO NOTHING;
    `);

    // Migración: campos de clientes
    await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_persona VARCHAR(20)`);
    await client.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT`);

    // ── Módulo de contabilidad ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cuentas_contables (
        id         SERIAL PRIMARY KEY,
        codigo     VARCHAR(20) UNIQUE NOT NULL,
        nombre     VARCHAR(150) NOT NULL,
        tipo       VARCHAR(20)  NOT NULL,  -- activo | pasivo | patrimonio | ingreso | costo | gasto
        naturaleza VARCHAR(10)  NOT NULL,  -- deudora | acreedora
        nivel      INTEGER DEFAULT 3,
        activa     BOOLEAN DEFAULT TRUE
      );
      CREATE TABLE IF NOT EXISTS asientos_contables (
        id          SERIAL PRIMARY KEY,
        fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
        descripcion TEXT NOT NULL,
        referencia  VARCHAR(100),
        tipo        VARCHAR(30) DEFAULT 'manual',
        estado      VARCHAR(20) DEFAULT 'activo',
        usuario_id  INTEGER REFERENCES usuarios(id),
        creado_en   TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS lineas_asiento (
        id          SERIAL PRIMARY KEY,
        asiento_id  INTEGER NOT NULL REFERENCES asientos_contables(id) ON DELETE CASCADE,
        cuenta_id   INTEGER NOT NULL REFERENCES cuentas_contables(id),
        descripcion VARCHAR(255),
        debe        NUMERIC(15,2) DEFAULT 0,
        haber       NUMERIC(15,2) DEFAULT 0
      );
    `);

    // Sembrar plan de cuentas (PUC colombiano simplificado)
    await client.query(`
      INSERT INTO cuentas_contables (codigo,nombre,tipo,naturaleza,nivel) VALUES
      ('1',    'ACTIVO',                        'activo',     'deudora',   1),
      ('11',   'Disponible',                    'activo',     'deudora',   2),
      ('1105', 'Caja general',                  'activo',     'deudora',   3),
      ('1110', 'Bancos',                        'activo',     'deudora',   3),
      ('13',   'Deudores comerciales',          'activo',     'deudora',   2),
      ('1305', 'Clientes',                      'activo',     'deudora',   3),
      ('14',   'Inventarios',                   'activo',     'deudora',   2),
      ('1435', 'Mercancías',                    'activo',     'deudora',   3),
      ('2',    'PASIVO',                        'pasivo',     'acreedora', 1),
      ('22',   'Proveedores',                   'pasivo',     'acreedora', 2),
      ('2205', 'Proveedores nacionales',        'pasivo',     'acreedora', 3),
      ('24',   'Impuestos por pagar',           'pasivo',     'acreedora', 2),
      ('2408', 'IVA por pagar',                 'pasivo',     'acreedora', 3),
      ('3',    'PATRIMONIO',                    'patrimonio', 'acreedora', 1),
      ('31',   'Capital social',                'patrimonio', 'acreedora', 2),
      ('3105', 'Capital suscrito y pagado',     'patrimonio', 'acreedora', 3),
      ('36',   'Resultados del ejercicio',      'patrimonio', 'acreedora', 2),
      ('3605', 'Utilidad del ejercicio',        'patrimonio', 'acreedora', 3),
      ('4',    'INGRESOS',                      'ingreso',    'acreedora', 1),
      ('41',   'Ingresos operacionales',        'ingreso',    'acreedora', 2),
      ('4135', 'Ventas',                        'ingreso',    'acreedora', 3),
      ('42',   'Ingresos no operacionales',     'ingreso',    'acreedora', 2),
      ('4210', 'Otros ingresos',                'ingreso',    'acreedora', 3),
      ('6',    'COSTO DE VENTAS',               'costo',      'deudora',   1),
      ('61',   'Costo de ventas',               'costo',      'deudora',   2),
      ('6135', 'Costo de mercancías',           'costo',      'deudora',   3),
      ('5',    'GASTOS OPERACIONALES',          'gasto',      'deudora',   1),
      ('51',   'Gastos de personal',            'gasto',      'deudora',   2),
      ('5105', 'Salarios y prestaciones',       'gasto',      'deudora',   3),
      ('52',   'Gastos generales',              'gasto',      'deudora',   2),
      ('5205', 'Arrendamientos',                'gasto',      'deudora',   3),
      ('5210', 'Servicios públicos',            'gasto',      'deudora',   3),
      ('5215', 'Papelería y útiles',            'gasto',      'deudora',   3),
      ('5220', 'Depreciaciones',                'gasto',      'deudora',   3),
      ('5225', 'Otros gastos generales',        'gasto',      'deudora',   3)
      ON CONFLICT (codigo) DO NOTHING;
    `);

    // Agregar permiso contabilidad a superusuario y administrador si no existe
    await client.query(`
      UPDATE roles
      SET permisos = permisos || '{"contabilidad":true}'::jsonb
      WHERE nombre IN ('superusuario','administrador')
        AND (permisos->>'contabilidad') IS NULL;
    `);

    // Migración: columna usuario como nuevo identificador de login
    await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS usuario VARCHAR(8)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_usuario ON usuarios(usuario) WHERE usuario IS NOT NULL`);
    // Hacer email opcional (ya no es el identificador principal)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE usuarios ALTER COLUMN email DROP NOT NULL;
      EXCEPTION WHEN OTHERS THEN NULL; END $$;
    `);
    // Generar usuario para cuentas existentes que no lo tengan
    const sinUsuario = await client.query(`SELECT id, email, nombre FROM usuarios WHERE usuario IS NULL`);
    for (const u of sinUsuario.rows) {
      let base = '';
      if (u.email) base = u.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toLowerCase();
      if (!base && u.nombre) base = u.nombre.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toLowerCase();
      if (!base) base = 'user' + u.id;
      base = base.substring(0, 8);
      // Si ya existe, agregar sufijo numérico
      let username = base, n = 1;
      while (true) {
        const existe = await client.query(`SELECT id FROM usuarios WHERE usuario = $1`, [username]);
        if (!existe.rows.length) break;
        username = base.substring(0, 7) + (n++);
      }
      await client.query(`UPDATE usuarios SET usuario = $1 WHERE id = $2`, [username, u.id]);
    }

    // Migrar usuarios existentes: asignar rol administrador si rol_id es null
    await client.query(`
      UPDATE usuarios SET rol_id = (SELECT id FROM roles WHERE nombre = 'administrador')
      WHERE rol_id IS NULL;
    `);

    // Asignar FK de rol_id después de poblar
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'usuarios_rol_id_fkey'
        ) THEN
          ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_id_fkey
            FOREIGN KEY (rol_id) REFERENCES roles(id);
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('Base de datos inicializada correctamente');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, inicializarDB };
