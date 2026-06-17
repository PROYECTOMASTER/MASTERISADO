const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = 3000;

// Usuario de prueba (en producción esto vendría de una base de datos)
const usuarios = [
  {
    id: 1,
    nombre: 'Martha Rincón',
    email: 'martha@ejemplo.com',
    password: bcrypt.hashSync('123456', 10),
  },
];

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: 'clave-secreta-masterisado',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }, // 1 hora
  })
);

// Ruta principal — redirige según sesión
app.get('/', (req, res) => {
  if (req.session.usuario) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

// Página de login
app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Procesar login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  const usuario = usuarios.find((u) => u.email === email);

  if (!usuario || !bcrypt.compareSync(password, usuario.password)) {
    return res.json({ exito: false, mensaje: 'Correo o contraseña incorrectos' });
  }

  req.session.usuario = { id: usuario.id, nombre: usuario.nombre, email: usuario.email };
  res.json({ exito: true });
});

// Dashboard (requiere sesión)
app.get('/dashboard', (req, res) => {
  if (!req.session.usuario) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API para obtener datos del usuario activo
app.get('/api/usuario', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ mensaje: 'No autenticado' });
  res.json(req.session.usuario);
});

// Cerrar sesión
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
