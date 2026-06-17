const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { pool, inicializarDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'clave-secreta-masterisado',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 },
  })
);

const requireAuth = (req, res, next) => {
  if (!req.session.usuario) return res.redirect('/login');
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.usuario || req.session.usuario.rol !== 'admin') {
    return res.status(403).json({ mensaje: 'Acceso denegado' });
  }
  next();
};

// ── Rutas generales ──────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.redirect(req.session.usuario ? '/tienda' : '/login');
});

app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/tienda');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/registro', (req, res) => {
  if (req.session.usuario) return res.redirect('/tienda');
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const usuario = r.rows[0];
    if (!usuario || !bcrypt.compareSync(password, usuario.password)) {
      return res.json({ exito: false, mensaje: 'Correo o contraseña incorrectos' });
    }
    req.session.usuario = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol };
    res.json({ exito: true, rol: usuario.rol });
  } catch (err) {
    console.error(err);
    res.json({ exito: false, mensaje: 'Error del servidor' });
  }
});

app.post('/registro', async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) return res.json({ exito: false, mensaje: 'Correo ya registrado' });
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('INSERT INTO usuarios (nombre, email, password) VALUES ($1, $2, $3)', [nombre, email, hash]);
    res.json({ exito: true });
  } catch (err) {
    console.error(err);
    res.json({ exito: false, mensaje: 'Error al registrar' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/api/usuario', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ mensaje: 'No autenticado' });
  res.json(req.session.usuario);
});

// ── Tienda (clientes) ────────────────────────────────────────────────────────

app.get('/tienda', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tienda.html'));
});

app.get('/api/productos', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.stock, p.imagen_url, c.nombre AS categoria
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = TRUE
      ORDER BY p.nombre
    `);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al obtener productos' });
  }
});

// ── Comprar ──────────────────────────────────────────────────────────────────

app.post('/api/comprar', requireAuth, async (req, res) => {
  const { items } = req.body; // [{ producto_id, cantidad }]
  const cliente = req.session.usuario;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    const detalles = [];

    for (const item of items) {
      const r = await client.query('SELECT * FROM productos WHERE id = $1 AND activo = TRUE FOR UPDATE', [item.producto_id]);
      const producto = r.rows[0];
      if (!producto) throw new Error(`Producto ${item.producto_id} no encontrado`);
      if (producto.stock < item.cantidad) throw new Error(`Stock insuficiente para "${producto.nombre}"`);
      total += producto.precio * item.cantidad;
      detalles.push({ producto, cantidad: item.cantidad });
    }

    const venta = await client.query(
      'INSERT INTO ventas (usuario_id, total) VALUES ($1, $2) RETURNING id',
      [cliente.id, total]
    );
    const ventaId = venta.rows[0].id;

    for (const d of detalles) {
      await client.query(
        'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unit) VALUES ($1, $2, $3, $4)',
        [ventaId, d.producto.id, d.cantidad, d.producto.precio]
      );
      await client.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [d.cantidad, d.producto.id]);
    }

    await client.query('COMMIT');
    res.json({ exito: true, venta_id: ventaId, total });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.json({ exito: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// ── Admin — páginas ──────────────────────────────────────────────────────────

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.redirect('/admin/productos');
});

app.get('/admin/productos', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-productos.html'));
});

// ── Admin — API productos ────────────────────────────────────────────────────

app.get('/api/admin/productos', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*, c.nombre AS categoria
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      ORDER BY p.nombre
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ mensaje: 'Error' });
  }
});

app.post('/api/admin/productos', requireAuth, requireAdmin, async (req, res) => {
  const { nombre, descripcion, precio, stock, imagen_url } = req.body;
  try {
    await pool.query(
      'INSERT INTO productos (nombre, descripcion, precio, stock, imagen_url) VALUES ($1, $2, $3, $4, $5)',
      [nombre, descripcion || '', precio, stock || 0, imagen_url || '']
    );
    res.json({ exito: true });
  } catch (err) {
    console.error(err);
    res.json({ exito: false, mensaje: 'Error al crear producto' });
  }
});

app.put('/api/admin/productos/:id', requireAuth, requireAdmin, async (req, res) => {
  const { nombre, descripcion, precio, stock, imagen_url, activo } = req.body;
  try {
    await pool.query(
      'UPDATE productos SET nombre=$1, descripcion=$2, precio=$3, stock=$4, imagen_url=$5, activo=$6 WHERE id=$7',
      [nombre, descripcion || '', precio, stock, imagen_url || '', activo !== false, req.params.id]
    );
    res.json({ exito: true });
  } catch (err) {
    console.error(err);
    res.json({ exito: false, mensaje: 'Error al actualizar' });
  }
});

app.delete('/api/admin/productos/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE productos SET activo = FALSE WHERE id = $1', [req.params.id]);
    res.json({ exito: true });
  } catch (err) {
    res.json({ exito: false, mensaje: 'Error al eliminar' });
  }
});

// ── Admin — API ventas ───────────────────────────────────────────────────────

app.get('/api/admin/ventas', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT v.id, v.total, v.estado, v.creado_en, u.nombre AS cliente, u.email
      FROM ventas v
      JOIN usuarios u ON v.usuario_id = u.id
      ORDER BY v.creado_en DESC
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ mensaje: 'Error' });
  }
});

// ── Iniciar servidor ─────────────────────────────────────────────────────────

inicializarDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Error al conectar la base de datos:', err);
    process.exit(1);
  });
