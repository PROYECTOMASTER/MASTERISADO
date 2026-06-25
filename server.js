require('dotenv').config();
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
app.use(session({
  secret: process.env.SESSION_SECRET || 'clave-secreta-masterisado',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const requireAuth = (req, res, next) => {
  if (!req.session.usuario) return res.redirect('/login');
  next();
};

function errMsg(err) {
  const m = err.message || '';
  if (m.includes('unique') || m.includes('duplicate') || m.includes('ya existe')) return 'Ya existe un registro con ese valor';
  if (m.includes('not null') || m.includes('nulo'))    return 'Hay campos obligatorios sin completar';
  if (m.includes('foreign key') || m.includes('llave foránea')) return 'No se puede eliminar porque está en uso';
  if (m.includes('does not exist'))  return 'Error de configuración en la base de datos. Reinicia el servidor.';
  if (m.includes('connection'))      return 'Sin conexión a la base de datos';
  return 'Error interno del servidor';
}

const requirePermiso = (permiso) => async (req, res, next) => {
  if (!req.session.usuario) return res.status(401).json({ mensaje: 'No autenticado' });
  const { permisos } = req.session.usuario;
  if (!permisos || !permisos[permiso]) return res.status(403).json({ mensaje: 'Sin permiso' });
  next();
};

const requirePermisoOr = (...permisos) => (req, res, next) => {
  if (!req.session.usuario) return res.status(401).json({ mensaje: 'No autenticado' });
  const p = req.session.usuario.permisos || {};
  if (!permisos.some(k => p[k])) return res.status(403).json({ mensaje: 'Sin permiso' });
  next();
};

const requireSuperusuario = (req, res, next) => {
  if (!req.session.usuario?.permisos?.asignar_admin)
    return res.status(403).json({ mensaje: 'Solo el superusuario puede realizar esta acción' });
  next();
};

async function registrarMovimiento(client, { producto_id, lote_id, tipo, cantidad, referencia_id, referencia_tipo, motivo, usuario_id }) {
  const r = await client.query('SELECT stock_actual FROM productos WHERE id = $1', [producto_id]);
  const antes = r.rows[0].stock_actual;
  const despues = antes + cantidad;
  await client.query(
    `INSERT INTO movimientos_stock
       (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, referencia_id, referencia_tipo, motivo, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [producto_id, lote_id || null, tipo, Math.abs(cantidad), antes, despues, referencia_id || null, referencia_tipo || null, motivo || '', usuario_id]
  );
  await client.query('UPDATE productos SET stock_actual = $1 WHERE id = $2', [despues, producto_id]);
}

// ── Setup inicial ─────────────────────────────────────────────────────────────

// Ruta temporal: fuerza credenciales del superusuario
app.get('/reset-admin', async (req, res) => {
  try {
    const superRol = (await pool.query("SELECT id FROM roles WHERE nombre='superusuario'")).rows[0]?.id;
    if (!superRol) return res.send('Error: roles no inicializados.');
    const hash = bcrypt.hashSync('123456', 10);
    // Buscar superusuario existente
    const sup = await pool.query('SELECT id FROM usuarios WHERE rol_id=$1 ORDER BY id LIMIT 1', [superRol]);
    if (sup.rows.length) {
      await pool.query('UPDATE usuarios SET nombre=$1, usuario=$2, password=$3 WHERE id=$4',
        ['Moluber', 'moluber', hash, sup.rows[0].id]);
    } else {
      // No hay superusuario, tomar el primer usuario y promoverlo
      const primero = await pool.query('SELECT id FROM usuarios ORDER BY id LIMIT 1');
      if (!primero.rows.length) return res.send('No hay usuarios. Ve a /registro primero.');
      await pool.query('UPDATE usuarios SET nombre=$1, usuario=$2, password=$3, rol_id=$4 WHERE id=$5',
        ['Moluber', 'moluber', hash, superRol, primero.rows[0].id]);
    }
    res.send(`✅ Credenciales actualizadas.<br><br>
      <strong>Usuario:</strong> moluber<br>
      <strong>Contraseña:</strong> 123456<br><br>
      <a href="/login" style="color:#4A90D9;font-size:16px">Ir al login →</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

app.get('/setup-superusuario', async (req, res) => {
  try {
    const check = await pool.query("SELECT id FROM roles WHERE nombre = 'superusuario'");
    if (!check.rows.length) return res.send('Error: roles no inicializados. Espera un momento y recarga.');
    const superRol = check.rows[0].id;
    const yaHay = await pool.query('SELECT id FROM usuarios WHERE rol_id = $1', [superRol]);
    if (yaHay.rows.length > 0) return res.send('Ya existe un superusuario. Ruta desactivada. <a href="/login">Ir al login</a>');

    const USUARIO_SUPER = 'moluber';
    const CLAVE_SUPER   = '123456';
    const NOMBRE_SUPER  = 'Moluber';
    const hash = bcrypt.hashSync(CLAVE_SUPER, 10);

    // Si ya existe un usuario con ese nombre de login, actualizarlo
    const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(usuario) = $1', [USUARIO_SUPER]);
    if (existe.rows.length) {
      await pool.query('UPDATE usuarios SET nombre=$1, password=$2, rol_id=$3 WHERE id=$4',
        [NOMBRE_SUPER, hash, superRol, existe.rows[0].id]);
    } else {
      // Buscar el primer usuario registrado y actualizarlo, o crear uno nuevo
      const primero = await pool.query('SELECT id FROM usuarios ORDER BY id LIMIT 1');
      if (primero.rows.length) {
        await pool.query('UPDATE usuarios SET nombre=$1, usuario=$2, password=$3, rol_id=$4 WHERE id=$5',
          [NOMBRE_SUPER, USUARIO_SUPER, hash, superRol, primero.rows[0].id]);
      } else {
        await pool.query('INSERT INTO usuarios (nombre, usuario, password, rol_id) VALUES ($1,$2,$3,$4)',
          [NOMBRE_SUPER, USUARIO_SUPER, hash, superRol]);
      }
    }
    res.send(`✅ Superusuario configurado.<br><br>
      <strong>Usuario:</strong> ${USUARIO_SUPER}<br>
      <strong>Contraseña:</strong> ${CLAVE_SUPER}<br><br>
      <a href="/login" style="color:#4A90D9">Ir al login →</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect(req.session.usuario ? '/admin' : '/login'));
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/registro', (req, res) => {
  if (req.session.usuario) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
});

app.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password)
    return res.json({ exito: false, mensaje: 'Ingresa usuario y contraseña' });
  if (!/^[a-zA-Z0-9]{1,8}$/.test(usuario))
    return res.json({ exito: false, mensaje: 'Usuario inválido' });
  if (password.length > 8)
    return res.json({ exito: false, mensaje: 'Contraseña inválida' });
  try {
    const r = await pool.query(`
      SELECT u.*, ro.nombre AS rol_nombre, ro.permisos
      FROM usuarios u
      LEFT JOIN roles ro ON u.rol_id = ro.id
      WHERE LOWER(u.usuario) = LOWER($1)
    `, [usuario]);
    const u = r.rows[0];
    if (!u || !bcrypt.compareSync(password, u.password))
      return res.json({ exito: false, mensaje: 'Usuario o contraseña incorrectos' });
    req.session.usuario = {
      id: u.id, nombre: u.nombre, usuario: u.usuario,
      rol: u.rol_nombre, permisos: u.permisos || {}
    };
    const destino = u.permisos?.ventas && !u.permisos?.productos ? '/caja' : '/admin';
    res.json({ exito: true, destino });
  } catch (err) { console.error(err); res.json({ exito: false, mensaje: 'Error del servidor' }); }
});

app.post('/registro', async (req, res) => {
  const { nombre, usuario, password } = req.body;
  if (!nombre?.trim()) return res.json({ exito: false, mensaje: 'El nombre es requerido' });
  if (!/^[a-zA-Z0-9]{1,8}$/.test(usuario))
    return res.json({ exito: false, mensaje: 'Usuario: solo letras y números, máximo 8 caracteres' });
  if (!password || password.length < 1 || password.length > 8)
    return res.json({ exito: false, mensaje: 'Contraseña: máximo 8 caracteres' });
  try {
    const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(usuario)=LOWER($1)', [usuario]);
    if (existe.rows.length) return res.json({ exito: false, mensaje: 'Ese usuario ya está registrado' });
    const rol = await pool.query("SELECT id FROM roles WHERE nombre='cajero'");
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('INSERT INTO usuarios (nombre,usuario,password,rol_id) VALUES($1,$2,$3,$4)',
      [nombre.trim(), usuario.toLowerCase(), hash, rol.rows[0]?.id || null]);
    res.json({ exito: true });
  } catch (err) { console.error(err); res.json({ exito: false, mensaje: 'Error al registrar' }); }
});

app.post('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
app.get('/api/sesion', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ mensaje: 'No autenticado' });
  res.json(req.session.usuario);
});

// ── Páginas admin ─────────────────────────────────────────────────────────────

const adminPage = (file) => [requireAuth, (req, res) => {
  if (!req.session.usuario?.permisos?.productos && !req.session.usuario?.permisos?.ventas)
    return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'admin', file));
}];

app.get('/admin',              requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.get('/admin/productos',    ...adminPage('productos.html'));
app.get('/admin/stock',        ...adminPage('stock.html'));
app.get('/admin/compras',      ...adminPage('compras.html'));
app.get('/admin/ventas',       ...adminPage('ventas.html'));
app.get('/admin/reportes',     ...adminPage('reportes.html'));
app.get('/admin/usuarios',     ...adminPage('usuarios.html'));
app.get('/admin/perfil',        requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'perfil.html')));
app.get('/caja',               requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'caja', 'index.html')));

// ── API: Catálogos ────────────────────────────────────────────────────────────

app.get('/api/categorias',     async (_, res) => { const r = await pool.query('SELECT * FROM categorias ORDER BY nombre'); res.json(r.rows); });
app.post('/api/categorias',    requireAuth, requirePermiso('productos'), async (req, res) => {
  if (!req.body.nombre?.trim()) return res.json({ exito: false, mensaje: 'El nombre es requerido' });
  try { const r = await pool.query('INSERT INTO categorias (nombre) VALUES ($1) RETURNING *', [req.body.nombre.trim()]); res.json(r.rows[0]); }
  catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});

app.get('/api/marcas',         async (_, res) => { const r = await pool.query('SELECT * FROM marcas ORDER BY nombre'); res.json(r.rows); });
app.post('/api/marcas',        requireAuth, requirePermiso('productos'), async (req, res) => {
  if (!req.body.nombre?.trim()) return res.json({ exito: false, mensaje: 'El nombre es requerido' });
  try { const r = await pool.query('INSERT INTO marcas (nombre) VALUES ($1) RETURNING *', [req.body.nombre.trim()]); res.json(r.rows[0]); }
  catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});

app.delete('/api/categorias/:id', requireAuth, requirePermiso('productos'), async (req, res) => {
  const uso = await pool.query('SELECT 1 FROM productos WHERE categoria_id=$1 LIMIT 1', [req.params.id]);
  if (uso.rows.length) return res.json({ exito: false, mensaje: 'No se puede eliminar: hay productos usando esta categoría' });
  try { await pool.query('DELETE FROM categorias WHERE id=$1', [req.params.id]); res.json({ exito: true }); }
  catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});

app.delete('/api/marcas/:id', requireAuth, requirePermiso('productos'), async (req, res) => {
  const uso = await pool.query('SELECT 1 FROM productos WHERE marca_id=$1 LIMIT 1', [req.params.id]);
  if (uso.rows.length) return res.json({ exito: false, mensaje: 'No se puede eliminar: hay productos usando esta marca' });
  try { await pool.query('DELETE FROM marcas WHERE id=$1', [req.params.id]); res.json({ exito: true }); }
  catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});

app.get('/api/unidades',       async (_, res) => { const r = await pool.query('SELECT * FROM unidades_medida ORDER BY nombre'); res.json(r.rows); });
app.post('/api/unidades',      requireAuth, requirePermiso('productos'), async (req, res) => {
  const { nombre, simbolo } = req.body;
  if (!nombre?.trim()) return res.json({ exito: false, mensaje: 'El nombre es requerido' });
  if (!simbolo?.trim()) return res.json({ exito: false, mensaje: 'El símbolo es requerido' });
  try { const r = await pool.query('INSERT INTO unidades_medida (nombre, simbolo) VALUES ($1,$2) RETURNING *', [nombre.trim(), simbolo.trim()]); res.json(r.rows[0]); }
  catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});
app.delete('/api/unidades/:id', requireAuth, requirePermiso('productos'), async (req, res) => {
  const uso = await pool.query('SELECT 1 FROM productos WHERE unidad_id=$1 LIMIT 1', [req.params.id]);
  if (uso.rows.length) return res.json({ exito: false, mensaje: 'No se puede eliminar: hay productos usando esta unidad' });
  try { await pool.query('DELETE FROM unidades_medida WHERE id=$1', [req.params.id]); res.json({ exito: true }); }
  catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});

app.delete('/api/productos/:id', requireAuth, requirePermiso('productos'), async (req, res) => {
  try { await pool.query('DELETE FROM productos WHERE id=$1', [req.params.id]); res.json({ exito: true }); }
  catch (err) { res.json({ exito: false, mensaje: 'No se puede eliminar: el producto tiene movimientos registrados' }); }
});

app.get('/api/proveedores',    requireAuth, requirePermiso('compras'), async (_, res) => { const r = await pool.query("SELECT * FROM proveedores ORDER BY nombre"); res.json(r.rows); });
app.post('/api/proveedores',   requireAuth, requirePermiso('compras'), async (req, res) => {
  const { nombre, nit, telefono, email, direccion } = req.body;
  try { const r = await pool.query('INSERT INTO proveedores (nombre,nit,telefono,email,direccion) VALUES ($1,$2,$3,$4,$5) RETURNING *', [nombre,nit||null,telefono||null,email||null,direccion||null]); res.json({ exito: true, proveedor: r.rows[0] }); }
  catch (err) { res.json({ exito: false, mensaje: err.message }); }
});
app.put('/api/proveedores/:id', requireAuth, requirePermiso('compras'), async (req, res) => {
  const { nombre, nit, telefono, email, direccion } = req.body;
  try { await pool.query('UPDATE proveedores SET nombre=$1,nit=$2,telefono=$3,email=$4,direccion=$5 WHERE id=$6', [nombre,nit||null,telefono||null,email||null,direccion||null,req.params.id]); res.json({ exito: true }); }
  catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

app.get('/api/clientes',       requireAuth, requirePermiso('ventas'), async (_, res) => { const r = await pool.query("SELECT * FROM clientes WHERE activo=TRUE ORDER BY nombre"); res.json(r.rows); });
app.post('/api/clientes',      requireAuth, requirePermiso('ventas'), async (req, res) => {
  const { nombre, tipo_persona, documento, telefono, email, direccion } = req.body;
  if (!nombre?.trim()) return res.json({ exito: false, mensaje: 'El nombre es requerido' });
  if (!tipo_persona) return res.json({ exito: false, mensaje: 'El tipo de persona es requerido' });
  if (!documento?.trim()) return res.json({ exito: false, mensaje: 'El número de identificación es requerido' });
  try {
    const r = await pool.query(
      'INSERT INTO clientes (nombre,tipo_persona,documento,telefono,email,direccion) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nombre.trim(), tipo_persona, documento.trim(), telefono||null, email||null, direccion||null]
    );
    res.json({ exito: true, cliente: r.rows[0] });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

app.put('/api/clientes/:id',   requireAuth, requirePermiso('ventas'), async (req, res) => {
  const { nombre, tipo_persona, documento, telefono, email, direccion } = req.body;
  if (!nombre?.trim()) return res.json({ exito: false, mensaje: 'El nombre es requerido' });
  if (!tipo_persona) return res.json({ exito: false, mensaje: 'El tipo de persona es requerido' });
  if (!documento?.trim()) return res.json({ exito: false, mensaje: 'El número de identificación es requerido' });
  try {
    await pool.query(
      'UPDATE clientes SET nombre=$1,tipo_persona=$2,documento=$3,telefono=$4,email=$5,direccion=$6 WHERE id=$7',
      [nombre.trim(), tipo_persona, documento.trim(), telefono||null, email||null, direccion||null, req.params.id]
    );
    res.json({ exito: true });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

// ── API: Productos ────────────────────────────────────────────────────────────

app.get('/api/productos', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*, c.nombre AS categoria, m.nombre AS marca, u.simbolo AS unidad_simbolo, u.nombre AS unidad_nombre
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN unidades_medida u ON p.unidad_id = u.id
      WHERE p.activo = TRUE ORDER BY p.nombre
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/productos', requireAuth, requirePermiso('productos'), async (req, res) => {
  const { sku, codigo_barras, nombre, descripcion, categoria_id, marca_id, unidad_id,
          precio_compra, precio_venta, iva_porcentaje, stock_minimo, punto_reorden, ubicacion, imagen_url } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO productos (sku,codigo_barras,nombre,descripcion,categoria_id,marca_id,unidad_id,
        precio_compra,precio_venta,iva_porcentaje,stock_minimo,punto_reorden,ubicacion,imagen_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [sku,codigo_barras||null,nombre,descripcion||'',categoria_id||null,marca_id||null,unidad_id||null,
       parseFloat(precio_compra)||0,parseFloat(precio_venta)||0,parseFloat(iva_porcentaje)||19,
       parseInt(stock_minimo)||0,parseInt(punto_reorden)||0,ubicacion||'',imagen_url||'']);
    res.json({ exito: true, producto: r.rows[0] });
  } catch (err) { console.error('ERROR PRODUCTO:', err.message); res.json({ exito: false, mensaje: err.message }); }
});

app.put('/api/productos/:id', requireAuth, requirePermiso('productos'), async (req, res) => {
  const { sku, codigo_barras, nombre, descripcion, categoria_id, marca_id, unidad_id,
          precio_compra, precio_venta, iva_porcentaje, stock_minimo, punto_reorden, ubicacion, imagen_url, activo } = req.body;
  try {
    await pool.query(`
      UPDATE productos SET sku=$1,codigo_barras=$2,nombre=$3,descripcion=$4,categoria_id=$5,marca_id=$6,
        unidad_id=$7,precio_compra=$8,precio_venta=$9,iva_porcentaje=$10,stock_minimo=$11,
        punto_reorden=$12,ubicacion=$13,imagen_url=$14,activo=$15 WHERE id=$16`,
      [sku,codigo_barras||null,nombre,descripcion||'',categoria_id||null,marca_id||null,unidad_id||null,
       precio_compra,precio_venta,iva_porcentaje,stock_minimo,punto_reorden,ubicacion||'',imagen_url||'',
       activo !== false, req.params.id]);
    res.json({ exito: true });
  } catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});

// ── API: Stock y kardex ───────────────────────────────────────────────────────

app.get('/api/stock', requireAuth, requirePermiso('stock'), async (_, res) => {
  try {
    const r = await pool.query(`
      SELECT p.id, p.sku, p.nombre, p.stock_actual, p.stock_minimo, p.punto_reorden,
             p.precio_compra, p.ubicacion,
             (p.stock_actual * p.precio_compra) AS valorizacion,
             CASE WHEN p.stock_actual = 0 THEN 'agotado'
                  WHEN p.stock_actual <= p.stock_minimo THEN 'bajo'
                  ELSE 'ok' END AS estado_stock
      FROM productos p WHERE p.activo = TRUE ORDER BY p.nombre
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/stock/movimiento', requireAuth, requirePermiso('stock'), async (req, res) => {
  const { producto_id, lote_id, tipo, cantidad, motivo } = req.body;
  const delta = tipo === 'entrada' ? Math.abs(cantidad) : -Math.abs(cantidad);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT stock_actual FROM productos WHERE id=$1 FOR UPDATE', [producto_id]);
    if (!r.rows.length) throw new Error('Producto no encontrado');
    if (r.rows[0].stock_actual + delta < 0) throw new Error('Stock insuficiente');
    await registrarMovimiento(client, { producto_id, lote_id, tipo, cantidad: delta, motivo, usuario_id: req.session.usuario.id });
    if (lote_id) {
      await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual + $1 WHERE id = $2', [delta, lote_id]);
    }
    await client.query('COMMIT');
    const nuevo = await pool.query('SELECT stock_actual FROM productos WHERE id=$1', [producto_id]);
    res.json({ exito: true, nuevo_stock: nuevo.rows[0].stock_actual });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ exito: false, mensaje: err.message });
  } finally { client.release(); }
});

app.get('/api/stock/kardex', requireAuth, requirePermiso('stock'), async (req, res) => {
  const { producto_id, desde, hasta, limit = 200 } = req.query;
  let where = ['1=1'];
  const params = [];
  if (producto_id) { params.push(producto_id); where.push(`m.producto_id = $${params.length}`); }
  if (desde) { params.push(desde); where.push(`m.creado_en >= $${params.length}`); }
  if (hasta) { params.push(hasta); where.push(`m.creado_en <= $${params.length}::date + 1`); }
  params.push(limit);
  try {
    const r = await pool.query(`
      SELECT m.*, p.nombre AS producto, p.sku, u.nombre AS usuario,
             l.numero_lote, l.fecha_vencimiento
      FROM movimientos_stock m
      JOIN productos p ON m.producto_id = p.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      LEFT JOIN lotes l ON m.lote_id = l.id
      WHERE ${where.join(' AND ')}
      ORDER BY m.creado_en DESC LIMIT $${params.length}
    `, params);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/lotes', requireAuth, requirePermiso('stock'), async (req, res) => {
  const { producto_id } = req.query;
  try {
    const r = await pool.query(`
      SELECT l.*, p.nombre AS producto
      FROM lotes l JOIN productos p ON l.producto_id = p.id
      WHERE l.activo = TRUE ${producto_id ? 'AND l.producto_id = $1' : ''}
      ORDER BY l.fecha_vencimiento ASC NULLS LAST
    `, producto_id ? [producto_id] : []);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/lotes', requireAuth, requirePermiso('stock'), async (req, res) => {
  const { producto_id, numero_lote, fecha_vencimiento, cantidad } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lote = await client.query(
      'INSERT INTO lotes (producto_id,numero_lote,fecha_vencimiento,cantidad_inicial,cantidad_actual) VALUES ($1,$2,$3,$4,$4) RETURNING *',
      [producto_id, numero_lote, fecha_vencimiento || null, cantidad]
    );
    await registrarMovimiento(client, {
      producto_id, lote_id: lote.rows[0].id, tipo: 'entrada',
      cantidad: Math.abs(cantidad), motivo: `Lote ${numero_lote}`, usuario_id: req.session.usuario.id
    });
    await client.query('COMMIT');
    res.json({ exito: true, lote: lote.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ exito: false, mensaje: err.message });
  } finally { client.release(); }
});

// ── API: Compras ──────────────────────────────────────────────────────────────

app.get('/api/compras', requireAuth, requirePermiso('compras'), async (_, res) => {
  try {
    const r = await pool.query(`
      SELECT oc.*, p.nombre AS proveedor, u.nombre AS usuario
      FROM ordenes_compra oc
      LEFT JOIN proveedores p ON oc.proveedor_id = p.id
      LEFT JOIN usuarios u ON oc.usuario_id = u.id
      ORDER BY oc.creado_en DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/compras/:id', requireAuth, requirePermiso('compras'), async (req, res) => {
  try {
    const oc = await pool.query(`SELECT oc.*,p.nombre AS proveedor FROM ordenes_compra oc LEFT JOIN proveedores p ON oc.proveedor_id=p.id WHERE oc.id=$1`, [req.params.id]);
    const det = await pool.query(`SELECT d.*,pr.nombre AS producto,pr.sku FROM detalle_ordenes_compra d JOIN productos pr ON d.producto_id=pr.id WHERE d.orden_id=$1`, [req.params.id]);
    res.json({ ...oc.rows[0], items: det.rows });
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/compras', requireAuth, requirePermiso('compras'), async (req, res) => {
  const { proveedor_id, items, notas } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let subtotal = 0, iva_total = 0;
    for (const i of items) {
      const base = i.precio_unit * i.cantidad;
      subtotal += base;
    }
    const oc = await client.query(
      'INSERT INTO ordenes_compra (proveedor_id,subtotal,iva_total,total,notas,usuario_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [proveedor_id || null, subtotal, iva_total, subtotal + iva_total, notas || '', req.session.usuario.id]
    );
    const ocId = oc.rows[0].id;
    for (const i of items) {
      await client.query(
        'INSERT INTO detalle_ordenes_compra (orden_id,producto_id,cantidad,precio_unit,numero_lote,fecha_vencimiento) VALUES ($1,$2,$3,$4,$5,$6)',
        [ocId, i.producto_id, i.cantidad, i.precio_unit, i.numero_lote || null, i.fecha_vencimiento || null]
      );
    }
    await client.query('COMMIT');
    res.json({ exito: true, orden_id: ocId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ exito: false, mensaje: err.message });
  } finally { client.release(); }
});

app.put('/api/compras/:id/recibir', requireAuth, requirePermiso('compras'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const oc = await client.query("SELECT * FROM ordenes_compra WHERE id=$1 AND estado != 'recibida'", [req.params.id]);
    if (!oc.rows.length) throw new Error('Orden no encontrada o ya recibida');
    const items = await client.query('SELECT * FROM detalle_ordenes_compra WHERE orden_id=$1', [req.params.id]);
    for (const item of items.rows) {
      let loteId = null;
      if (item.numero_lote) {
        const lote = await client.query(
          'INSERT INTO lotes (producto_id,numero_lote,fecha_vencimiento,cantidad_inicial,cantidad_actual) VALUES ($1,$2,$3,$4,$4) RETURNING id',
          [item.producto_id, item.numero_lote, item.fecha_vencimiento || null, item.cantidad]
        );
        loteId = lote.rows[0].id;
      }
      await registrarMovimiento(client, {
        producto_id: item.producto_id, lote_id: loteId, tipo: 'compra',
        cantidad: item.cantidad, referencia_id: oc.rows[0].id, referencia_tipo: 'compra',
        motivo: `Orden de compra #${oc.rows[0].id}`, usuario_id: req.session.usuario.id
      });
      await client.query('UPDATE productos SET precio_compra=$1 WHERE id=$2', [item.precio_unit, item.producto_id]);
    }
    await client.query("UPDATE ordenes_compra SET estado='recibida' WHERE id=$1", [req.params.id]);
    await client.query('COMMIT');
    res.json({ exito: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ exito: false, mensaje: err.message });
  } finally { client.release(); }
});

// ── API: Ventas ───────────────────────────────────────────────────────────────

app.get('/api/ventas', requireAuth, requirePermiso('ventas'), async (req, res) => {
  const { desde, hasta, estado, limit = 500 } = req.query;
  const where = ['1=1'];
  const params = [];
  if (desde) { params.push(desde); where.push(`v.creado_en >= $${params.length}::date`); }
  if (hasta) { params.push(hasta); where.push(`v.creado_en <= $${params.length}::date + 1`); }
  if (estado) { params.push(estado); where.push(`v.estado = $${params.length}`); }
  params.push(limit);
  try {
    const r = await pool.query(`
      SELECT v.*, u.nombre AS cajero, c.nombre AS cliente
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN clientes c ON v.cliente_id = c.id
      WHERE ${where.join(' AND ')}
      ORDER BY v.creado_en DESC LIMIT $${params.length}
    `, params);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/ventas/:id', requireAuth, requirePermiso('ventas'), async (req, res) => {
  try {
    const v = await pool.query(`
      SELECT v.*, u.nombre AS cajero, c.nombre AS cliente
      FROM ventas v LEFT JOIN usuarios u ON v.usuario_id=u.id LEFT JOIN clientes c ON v.cliente_id=c.id
      WHERE v.id=$1
    `, [req.params.id]);
    if (!v.rows.length) return res.status(404).json({ mensaje: 'Venta no encontrada' });
    const items = await pool.query(`
      SELECT dv.*, p.nombre AS producto, p.sku
      FROM detalle_ventas dv JOIN productos p ON dv.producto_id=p.id
      WHERE dv.venta_id=$1
    `, [req.params.id]);
    res.json({ ...v.rows[0], items: items.rows });
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/ventas', requireAuth, requirePermiso('ventas'), async (req, res) => {
  let { cliente_id, cliente_nombre, items, notas } = req.body;
  if (!cliente_id && cliente_nombre) {
    try {
      const existe = await pool.query('SELECT id FROM clientes WHERE nombre=$1', [cliente_nombre]);
      cliente_id = existe.rows.length ? existe.rows[0].id :
        (await pool.query('INSERT INTO clientes (nombre) VALUES ($1) RETURNING id', [cliente_nombre])).rows[0].id;
    } catch (_) {}
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let subtotal = 0, iva_total = 0;
    const detalles = [];
    for (const item of items) {
      const r = await client.query('SELECT * FROM productos WHERE id=$1 AND activo=TRUE FOR UPDATE', [item.producto_id]);
      const p = r.rows[0];
      if (!p) throw new Error(`Producto ${item.producto_id} no encontrado`);
      if (p.stock_actual < item.cantidad) throw new Error(`Stock insuficiente para "${p.nombre}"`);
      const base = p.precio_venta * item.cantidad;
      const iva = base * (p.iva_porcentaje / 100);
      subtotal += base;
      iva_total += iva;
      detalles.push({ producto: p, cantidad: item.cantidad, lote_id: item.lote_id || null });
    }
    const venta = await client.query(
      'INSERT INTO ventas (cliente_id,usuario_id,subtotal,iva_total,total,notas) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [cliente_id || null, req.session.usuario.id, subtotal, iva_total, subtotal + iva_total, notas || '']
    );
    const ventaId = venta.rows[0].id;
    for (const d of detalles) {
      await client.query(
        'INSERT INTO detalle_ventas (venta_id,producto_id,lote_id,cantidad,precio_unit,iva_porcentaje) VALUES ($1,$2,$3,$4,$5,$6)',
        [ventaId, d.producto.id, d.lote_id, d.cantidad, d.producto.precio_venta, d.producto.iva_porcentaje]
      );
      await registrarMovimiento(client, {
        producto_id: d.producto.id, lote_id: d.lote_id, tipo: 'venta',
        cantidad: -d.cantidad, referencia_id: ventaId, referencia_tipo: 'venta',
        motivo: `Venta #${ventaId}`, usuario_id: req.session.usuario.id
      });
      if (d.lote_id) await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual - $1 WHERE id=$2', [d.cantidad, d.lote_id]);
    }
    await client.query('COMMIT');
    res.json({ exito: true, venta_id: ventaId, total: subtotal + iva_total });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ exito: false, mensaje: err.message });
  } finally { client.release(); }
});

app.put('/api/compras/:id/cancelar', requireAuth, requirePermiso('compras'), async (req, res) => {
  try {
    const r = await pool.query("UPDATE ordenes_compra SET estado='cancelada' WHERE id=$1 AND estado='borrador' RETURNING id", [req.params.id]);
    if (!r.rows.length) return res.json({ exito: false, mensaje: 'Orden no encontrada o ya procesada' });
    res.json({ exito: true });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

app.put('/api/ventas/:id/anular', requireAuth, requirePermiso('ventas'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const v = await client.query("SELECT * FROM ventas WHERE id=$1 AND estado='completada'", [req.params.id]);
    if (!v.rows.length) throw new Error('Venta no encontrada o ya anulada');
    const items = await client.query('SELECT * FROM detalle_ventas WHERE venta_id=$1', [req.params.id]);
    for (const item of items.rows) {
      await registrarMovimiento(client, {
        producto_id: item.producto_id, lote_id: item.lote_id, tipo: 'devolucion',
        cantidad: item.cantidad, referencia_id: v.rows[0].id, referencia_tipo: 'anulacion',
        motivo: `Anulación venta #${v.rows[0].id}`, usuario_id: req.session.usuario.id
      });
      if (item.lote_id) await client.query('UPDATE lotes SET cantidad_actual = cantidad_actual + $1 WHERE id=$2', [item.cantidad, item.lote_id]);
    }
    await client.query("UPDATE ventas SET estado='anulada' WHERE id=$1", [req.params.id]);
    await client.query('COMMIT');
    res.json({ exito: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ exito: false, mensaje: err.message });
  } finally { client.release(); }
});

// ── API: Reportes ─────────────────────────────────────────────────────────────

app.get('/api/reportes/valoracion', requireAuth, requirePermiso('reportes'), async (_, res) => {
  try {
    const r = await pool.query(`
      SELECT p.sku, p.nombre, p.stock_actual, p.precio_compra, p.precio_venta,
             (p.stock_actual * p.precio_compra) AS valor_costo,
             (p.stock_actual * p.precio_venta)  AS valor_venta,
             c.nombre AS categoria
      FROM productos p LEFT JOIN categorias c ON p.categoria_id=c.id
      WHERE p.activo=TRUE ORDER BY valor_costo DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/reportes/bajo-stock', requireAuth, requirePermiso('reportes'), async (_, res) => {
  try {
    const r = await pool.query(`
      SELECT p.*, c.nombre AS categoria
      FROM productos p LEFT JOIN categorias c ON p.categoria_id=c.id
      WHERE p.activo=TRUE AND p.stock_actual <= p.punto_reorden
      ORDER BY p.stock_actual ASC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/reportes/vencimientos', requireAuth, requirePermisoOr('reportes', 'stock'), async (req, res) => {
  const dias = parseInt(req.query.dias) || 30;
  try {
    const r = await pool.query(`
      SELECT l.*, p.nombre AS producto, p.sku, p.precio_compra,
             (l.fecha_vencimiento - CURRENT_DATE) AS dias_restantes
      FROM lotes l JOIN productos p ON l.producto_id=p.id
      WHERE l.activo=TRUE AND l.cantidad_actual > 0
        AND l.fecha_vencimiento IS NOT NULL
        AND l.fecha_vencimiento <= CURRENT_DATE + $1
      ORDER BY l.fecha_vencimiento ASC
    `, [dias]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/reportes/movimientos', requireAuth, requirePermiso('reportes'), async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const r = await pool.query(`
      SELECT m.*, p.nombre AS producto, p.sku, u.nombre AS usuario
      FROM movimientos_stock m
      JOIN productos p ON m.producto_id=p.id
      LEFT JOIN usuarios u ON m.usuario_id=u.id
      WHERE ($1::date IS NULL OR m.creado_en >= $1::date)
        AND ($2::date IS NULL OR m.creado_en < $2::date + 1)
      ORDER BY m.creado_en DESC LIMIT 1000
    `, [desde || null, hasta || null]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/reportes/ranking', requireAuth, requirePermiso('reportes'), async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const r = await pool.query(`
      SELECT p.nombre AS producto, p.sku,
             SUM(dv.cantidad) AS total_cantidad,
             SUM(dv.cantidad * dv.precio_unit) AS total_ingresos
      FROM detalle_ventas dv
      JOIN productos p ON dv.producto_id=p.id
      JOIN ventas v ON dv.venta_id=v.id
      WHERE v.estado='completada'
        AND ($1::date IS NULL OR v.creado_en >= $1::date)
        AND ($2::date IS NULL OR v.creado_en < $2::date + 1)
      GROUP BY p.id, p.nombre, p.sku
      ORDER BY total_cantidad DESC
    `, [desde||null, hasta||null]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/reportes/ventas-productos', requireAuth, requirePermiso('reportes'), async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const r = await pool.query(`
      SELECT p.sku, p.nombre, SUM(dv.cantidad) AS total_vendido,
             SUM(dv.cantidad * dv.precio_unit) AS total_ingresos
      FROM detalle_ventas dv
      JOIN productos p ON dv.producto_id=p.id
      JOIN ventas v ON dv.venta_id=v.id
      WHERE v.estado='completada'
        AND ($1::date IS NULL OR v.creado_en >= $1::date)
        AND ($2::date IS NULL OR v.creado_en < $2::date + 1)
      GROUP BY p.id, p.sku, p.nombre
      ORDER BY total_vendido DESC
    `, [desde || null, hasta || null]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

// ── API: Usuarios y roles ─────────────────────────────────────────────────────

app.get('/api/usuarios', requireAuth, requirePermiso('usuarios'), async (_, res) => {
  try {
    const r = await pool.query(`
      SELECT u.id, u.nombre, u.usuario, u.creado_en, ro.nombre AS rol, ro.id AS rol_id
      FROM usuarios u LEFT JOIN roles ro ON u.rol_id=ro.id ORDER BY u.nombre
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/usuarios', requireAuth, requirePermiso('usuarios'), async (req, res) => {
  const { nombre, usuario, password, rol_id } = req.body;
  if (!nombre?.trim()) return res.json({ exito: false, mensaje: 'El nombre es requerido' });
  if (!/^[a-zA-Z0-9]{1,8}$/.test(usuario))
    return res.json({ exito: false, mensaje: 'Usuario: solo letras y números, máximo 8 caracteres' });
  if (!password || password.length < 1 || password.length > 8)
    return res.json({ exito: false, mensaje: 'Contraseña: máximo 8 caracteres' });
  if (!rol_id) return res.json({ exito: false, mensaje: 'Debes seleccionar un rol' });
  try {
    const rolTarget = await pool.query('SELECT nombre FROM roles WHERE id=$1', [rol_id]);
    if (!rolTarget.rows.length) return res.json({ exito: false, mensaje: 'Rol no encontrado' });
    const esPrivilegiado = rolTarget.rows[0].nombre === 'administrador' || rolTarget.rows[0].nombre === 'superusuario';
    if (esPrivilegiado && !req.session.usuario.permisos?.asignar_admin)
      return res.json({ exito: false, mensaje: 'Solo el superusuario puede crear usuarios con rol de administrador' });
    const existe = await pool.query('SELECT id FROM usuarios WHERE LOWER(usuario)=LOWER($1)', [usuario]);
    if (existe.rows.length) return res.json({ exito: false, mensaje: 'Ese nombre de usuario ya está en uso' });
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('INSERT INTO usuarios (nombre, usuario, password, rol_id) VALUES ($1,$2,$3,$4)',
      [nombre.trim(), usuario.toLowerCase(), hash, rol_id]);
    res.json({ exito: true });
  } catch (err) { console.error(err); res.json({ exito: false, mensaje: 'Error al crear usuario' }); }
});

// Cambiar propia contraseña (cualquier usuario autenticado)
app.post('/api/perfil/cambiar-clave', requireAuth, async (req, res) => {
  const { clave_actual, clave_nueva } = req.body;
  if (!clave_actual || !clave_nueva)
    return res.json({ exito: false, mensaje: 'Completa todos los campos' });
  if (clave_nueva.length < 1 || clave_nueva.length > 8)
    return res.json({ exito: false, mensaje: 'La contraseña debe tener máximo 8 caracteres' });
  try {
    const r = await pool.query('SELECT password FROM usuarios WHERE id=$1', [req.session.usuario.id]);
    if (!r.rows.length) return res.json({ exito: false, mensaje: 'Usuario no encontrado' });
    if (!bcrypt.compareSync(clave_actual, r.rows[0].password))
      return res.json({ exito: false, mensaje: 'La contraseña actual es incorrecta' });
    const hash = bcrypt.hashSync(clave_nueva, 10);
    await pool.query('UPDATE usuarios SET password=$1 WHERE id=$2', [hash, req.session.usuario.id]);
    res.json({ exito: true });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

// Resetear contraseña de otro usuario (admin / superusuario)
app.put('/api/usuarios/:id/reset-clave', requireAuth, requirePermiso('usuarios'), async (req, res) => {
  const { clave_nueva } = req.body;
  if (!clave_nueva || clave_nueva.length < 1 || clave_nueva.length > 8)
    return res.json({ exito: false, mensaje: 'La contraseña debe tener máximo 8 caracteres' });
  try {
    const target = await pool.query(
      `SELECT u.id, ro.nombre AS rol FROM usuarios u LEFT JOIN roles ro ON u.rol_id=ro.id WHERE u.id=$1`,
      [req.params.id]
    );
    if (!target.rows.length) return res.json({ exito: false, mensaje: 'Usuario no encontrado' });
    if (target.rows[0].rol === 'superusuario' && !req.session.usuario.permisos?.asignar_admin)
      return res.json({ exito: false, mensaje: 'No tienes permiso para cambiar la clave del superusuario' });
    const hash = bcrypt.hashSync(clave_nueva, 10);
    await pool.query('UPDATE usuarios SET password=$1 WHERE id=$2', [hash, req.params.id]);
    res.json({ exito: true });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

app.put('/api/usuarios/:id/rol', requireAuth, requirePermiso('usuarios'), async (req, res) => {
  const { rol_id } = req.body;
  try {
    const rolTarget = await pool.query('SELECT nombre FROM roles WHERE id=$1', [rol_id]);
    if (!rolTarget.rows.length) return res.json({ exito: false, mensaje: 'Rol no encontrado' });
    const esAdmin = rolTarget.rows[0].nombre === 'administrador' || rolTarget.rows[0].nombre === 'superusuario';
    if (esAdmin && !req.session.usuario.permisos.asignar_admin)
      return res.json({ exito: false, mensaje: 'Solo el superusuario puede asignar roles de administrador' });
    await pool.query('UPDATE usuarios SET rol_id=$1 WHERE id=$2', [rol_id, req.params.id]);
    res.json({ exito: true });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

app.get('/api/roles', requireAuth, requirePermiso('roles'), async (_, res) => {
  try { const r = await pool.query('SELECT * FROM roles ORDER BY nombre'); res.json(r.rows); }
  catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/roles', requireAuth, requirePermiso('roles'), async (req, res) => {
  const { nombre, permisos } = req.body;
  if (!req.session.usuario.permisos.asignar_admin) permisos.asignar_admin = false;
  try {
    const r = await pool.query('INSERT INTO roles (nombre,permisos) VALUES ($1,$2) RETURNING *', [nombre, JSON.stringify(permisos)]);
    res.json({ exito: true, rol: r.rows[0] });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

app.put('/api/roles/:id', requireAuth, requirePermiso('roles'), async (req, res) => {
  const { nombre, permisos } = req.body;
  if (!req.session.usuario.permisos.asignar_admin) permisos.asignar_admin = false;
  try {
    const rolActual = await pool.query('SELECT es_sistema, nombre FROM roles WHERE id=$1', [req.params.id]);
    if (rolActual.rows[0]?.es_sistema) return res.json({ exito: false, mensaje: 'No se pueden editar los roles del sistema' });
    await pool.query('UPDATE roles SET nombre=$1, permisos=$2 WHERE id=$3', [nombre, JSON.stringify(permisos), req.params.id]);
    res.json({ exito: true });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

// ── API: Contabilidad ─────────────────────────────────────────────────────────

app.get('/admin/contabilidad', requireAuth, (req, res) => {
  if (!req.session.usuario?.permisos?.contabilidad) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'admin', 'contabilidad.html'));
});

app.get('/api/contabilidad/cuentas', requireAuth, requirePermiso('contabilidad'), async (_, res) => {
  try {
    const r = await pool.query('SELECT * FROM cuentas_contables WHERE activa=TRUE ORDER BY codigo');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/contabilidad/cuentas', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  const { codigo, nombre, tipo, naturaleza, nivel } = req.body;
  if (!codigo?.trim() || !nombre?.trim() || !tipo || !naturaleza)
    return res.json({ exito: false, mensaje: 'Todos los campos son requeridos' });
  try {
    const r = await pool.query(
      'INSERT INTO cuentas_contables (codigo,nombre,tipo,naturaleza,nivel) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [codigo.trim(), nombre.trim(), tipo, naturaleza, parseInt(nivel)||3]
    );
    res.json({ exito: true, cuenta: r.rows[0] });
  } catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});
app.delete('/api/contabilidad/cuentas/:id', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  const uso = await pool.query('SELECT 1 FROM lineas_asiento WHERE cuenta_id=$1 LIMIT 1', [req.params.id]);
  if (uso.rows.length) return res.json({ exito: false, mensaje: 'No se puede eliminar: la cuenta tiene movimientos registrados' });
  try { await pool.query('DELETE FROM cuentas_contables WHERE id=$1', [req.params.id]); res.json({ exito: true }); }
  catch (err) { res.json({ exito: false, mensaje: errMsg(err) }); }
});

app.get('/api/contabilidad/asientos', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const r = await pool.query(`
      SELECT a.*, u.nombre AS usuario_nombre,
             COALESCE(SUM(l.debe),0) AS total_debe,
             COALESCE(SUM(l.haber),0) AS total_haber
      FROM asientos_contables a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN lineas_asiento l ON l.asiento_id = a.id
      WHERE ($1::date IS NULL OR a.fecha >= $1::date)
        AND ($2::date IS NULL OR a.fecha <= $2::date)
      GROUP BY a.id, u.nombre
      ORDER BY a.fecha DESC, a.id DESC
    `, [desde||null, hasta||null]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/contabilidad/asientos/:id', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  try {
    const a = await pool.query(
      'SELECT a.*, u.nombre AS usuario_nombre FROM asientos_contables a LEFT JOIN usuarios u ON a.usuario_id=u.id WHERE a.id=$1',
      [req.params.id]
    );
    if (!a.rows.length) return res.status(404).json({ mensaje: 'Asiento no encontrado' });
    const lineas = await pool.query(
      'SELECT l.*, c.codigo, c.nombre AS cuenta_nombre, c.tipo FROM lineas_asiento l JOIN cuentas_contables c ON l.cuenta_id=c.id WHERE l.asiento_id=$1 ORDER BY l.id',
      [req.params.id]
    );
    res.json({ ...a.rows[0], lineas: lineas.rows });
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.post('/api/contabilidad/asientos', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  const { fecha, descripcion, referencia, lineas } = req.body;
  if (!descripcion?.trim()) return res.json({ exito: false, mensaje: 'La descripción es requerida' });
  if (!Array.isArray(lineas) || lineas.length < 2)
    return res.json({ exito: false, mensaje: 'Se requieren al menos 2 líneas' });
  const totalDebe  = lineas.reduce((s, l) => s + (parseFloat(l.debe)  || 0), 0);
  const totalHaber = lineas.reduce((s, l) => s + (parseFloat(l.haber) || 0), 0);
  if (Math.abs(totalDebe - totalHaber) > 0.01)
    return res.json({ exito: false, mensaje: `El asiento no cuadra: Débitos $${totalDebe.toFixed(2)} ≠ Créditos $${totalHaber.toFixed(2)}` });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fechaUso = fecha || new Date().toISOString().split('T')[0];
    const a = await client.query(
      'INSERT INTO asientos_contables (fecha,descripcion,referencia,usuario_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [fechaUso, descripcion.trim(), referencia||null, req.session.usuario.id]
    );
    const asientoId = a.rows[0].id;
    for (const l of lineas) {
      if (!l.cuenta_id) throw new Error('Todas las líneas deben tener una cuenta seleccionada');
      await client.query(
        'INSERT INTO lineas_asiento (asiento_id,cuenta_id,descripcion,debe,haber) VALUES ($1,$2,$3,$4,$5)',
        [asientoId, l.cuenta_id, l.descripcion||null, parseFloat(l.debe)||0, parseFloat(l.haber)||0]
      );
    }
    await client.query('COMMIT');
    res.json({ exito: true, asiento_id: asientoId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ exito: false, mensaje: err.message });
  } finally { client.release(); }
});

app.put('/api/contabilidad/asientos/:id/anular', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  try {
    const r = await pool.query("UPDATE asientos_contables SET estado='anulado' WHERE id=$1 AND estado='activo' RETURNING id", [req.params.id]);
    if (!r.rows.length) return res.json({ exito: false, mensaje: 'Asiento no encontrado o ya anulado' });
    res.json({ exito: true });
  } catch (err) { res.json({ exito: false, mensaje: err.message }); }
});

app.get('/api/contabilidad/estado-resultados', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const r = await pool.query(`
      SELECT c.codigo, c.nombre, c.tipo, c.naturaleza, c.nivel,
             COALESCE(SUM(l.debe),0)  AS total_debe,
             COALESCE(SUM(l.haber),0) AS total_haber
      FROM cuentas_contables c
      LEFT JOIN lineas_asiento l  ON l.cuenta_id  = c.id
      LEFT JOIN asientos_contables a ON l.asiento_id = a.id
        AND a.estado = 'activo'
        AND ($1::date IS NULL OR a.fecha >= $1::date)
        AND ($2::date IS NULL OR a.fecha <= $2::date)
      WHERE c.tipo IN ('ingreso','costo','gasto') AND c.activa = TRUE
      GROUP BY c.id, c.codigo, c.nombre, c.tipo, c.naturaleza, c.nivel
      ORDER BY c.codigo
    `, [desde||null, hasta||null]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/contabilidad/balance-general', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  const { hasta } = req.query;
  try {
    const r = await pool.query(`
      SELECT c.codigo, c.nombre, c.tipo, c.naturaleza, c.nivel,
             COALESCE(SUM(l.debe),0)  AS total_debe,
             COALESCE(SUM(l.haber),0) AS total_haber
      FROM cuentas_contables c
      LEFT JOIN lineas_asiento l  ON l.cuenta_id  = c.id
      LEFT JOIN asientos_contables a ON l.asiento_id = a.id
        AND a.estado = 'activo'
        AND ($1::date IS NULL OR a.fecha <= $1::date)
      WHERE c.tipo IN ('activo','pasivo','patrimonio') AND c.activa = TRUE
      GROUP BY c.id, c.codigo, c.nombre, c.tipo, c.naturaleza, c.nivel
      ORDER BY c.codigo
    `, [hasta||null]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

app.get('/api/contabilidad/libro-mayor', requireAuth, requirePermiso('contabilidad'), async (req, res) => {
  const { cuenta_id, desde, hasta } = req.query;
  if (!cuenta_id) return res.json([]);
  try {
    const r = await pool.query(`
      SELECT a.fecha, a.id AS asiento_id, a.descripcion AS asiento_desc,
             l.descripcion, l.debe, l.haber
      FROM lineas_asiento l
      JOIN asientos_contables a ON l.asiento_id = a.id
      WHERE l.cuenta_id = $1 AND a.estado = 'activo'
        AND ($2::date IS NULL OR a.fecha >= $2::date)
        AND ($3::date IS NULL OR a.fecha <= $3::date)
      ORDER BY a.fecha ASC, a.id ASC
    `, [cuenta_id, desde||null, hasta||null]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

// ── Dashboard KPIs ────────────────────────────────────────────────────────────

app.get('/api/dashboard', requireAuth, async (_, res) => {
  try {
    const [prods, bajo, ventas, venc] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total, SUM(stock_actual * precio_compra) AS valoracion FROM productos WHERE activo=TRUE'),
      pool.query('SELECT COUNT(*) AS total FROM productos WHERE activo=TRUE AND stock_actual <= punto_reorden'),
      pool.query("SELECT COUNT(*) AS total, COALESCE(SUM(total),0) AS monto FROM ventas WHERE estado='completada' AND creado_en >= CURRENT_DATE - 30"),
      pool.query("SELECT COUNT(*) AS total FROM lotes WHERE activo=TRUE AND cantidad_actual > 0 AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento <= CURRENT_DATE + 30"),
    ]);
    res.json({
      productos: prods.rows[0],
      bajo_stock: bajo.rows[0],
      ventas_mes: ventas.rows[0],
      vencimientos: venc.rows[0],
    });
  } catch (err) { res.status(500).json({ mensaje: err.message }); }
});

// ── Inicio ────────────────────────────────────────────────────────────────────

inicializarDB()
  .then(() => app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`)))
  .catch(err => { console.error('Error DB:', err); process.exit(1); });
