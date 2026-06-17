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

// Ruta principal
app.get('/', (req, res) => {
  res.redirect(req.session.usuario ? '/dashboard' : '/login');
});

// Página de login
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Página de registro
app.get('/registro', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
});

// Procesar login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const usuario = resultado.rows[0];

    if (!usuario || !bcrypt.compareSync(password, usuario.password)) {
      return res.json({ exito: false, mensaje: 'Correo o contraseña incorrectos' });
    }

    req.session.usuario = { id: usuario.id, nombre: usuario.nombre, email: usuario.email };
    res.json({ exito: true });
  } catch (err) {
    console.error(err);
    res.json({ exito: false, mensaje: 'Error del servidor' });
  }
});

// Procesar registro
app.post('/registro', async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      return res.json({ exito: false, mensaje: 'Este correo ya está registrado' });
    }

    const hash = bcrypt.hashSync(password, 10);
    await pool.query(
      'INSERT INTO usuarios (nombre, email, password) VALUES ($1, $2, $3)',
      [nombre, email, hash]
    );

    res.json({ exito: true });
  } catch (err) {
    console.error(err);
    res.json({ exito: false, mensaje: 'Error al registrar usuario' });
  }
});

// Dashboard
app.get('/dashboard', (req, res) => {
  if (!req.session.usuario) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API usuario activo
app.get('/api/usuario', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ mensaje: 'No autenticado' });
  res.json(req.session.usuario);
});

// Cerrar sesión
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Iniciar servidor
inicializarDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Error al conectar la base de datos:', err);
    process.exit(1);
  });
