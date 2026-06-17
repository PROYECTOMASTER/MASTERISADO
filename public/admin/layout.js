// Componentes y utilidades compartidas del panel admin

const PERMISOS_LABELS = {
  productos: 'Productos', stock: 'Stock', compras: 'Compras',
  ventas: 'Ventas', reportes: 'Reportes', usuarios: 'Usuarios',
  roles: 'Roles', asignar_admin: 'Asignar admin'
};

function fmtMoneda(v) {
  return '$' + parseFloat(v || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtFecha(f) {
  if (!f) return '—';
  return new Date(f).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtFechaHora(f) {
  if (!f) return '—';
  return new Date(f).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function badge(texto, color) {
  const colores = { verde: '#27AE60', rojo: '#e74c3c', naranja: '#f39c12', azul: '#4A90D9', gris: '#888' };
  const bg = { verde: '#e8f8ee', rojo: '#fde8e8', naranja: '#fff3e0', azul: '#e8f2ff', gris: '#f0f0f0' };
  return `<span style="background:${bg[color]||bg.gris};color:${colores[color]||colores.gris};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${texto}</span>`;
}

async function cargarSesion() {
  const r = await fetch('/api/sesion');
  if (!r.ok) { window.location.href = '/login'; return null; }
  return r.json();
}

function navHTML(activo, permisos = {}) {
  const links = [
    { href: '/admin', label: '📊 Dashboard', perm: null },
    { href: '/admin/productos', label: '📦 Productos', perm: 'productos' },
    { href: '/admin/stock', label: '🏭 Stock', perm: 'stock' },
    { href: '/admin/compras', label: '🛒 Compras', perm: 'compras' },
    { href: '/admin/ventas', label: '💰 Ventas', perm: 'ventas' },
    { href: '/admin/reportes', label: '📈 Reportes', perm: 'reportes' },
    { href: '/admin/usuarios', label: '👥 Usuarios', perm: 'usuarios' },
  ];
  return links
    .filter(l => !l.perm || permisos[l.perm])
    .map(l => `<a href="${l.href}" class="${l.href === activo ? 'active' : ''}">${l.label}</a>`)
    .join('');
}

function renderNav(activo, sesion) {
  const nav = document.getElementById('nav-links');
  if (nav) nav.innerHTML = navHTML(activo, sesion.permisos);
  const nombreEl = document.getElementById('usuario-nombre');
  if (nombreEl) nombreEl.textContent = `${sesion.nombre} · ${sesion.rol}`;
}

// Toast de notificación
function toast(msg, tipo = 'ok') {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.15);transition:opacity 0.4s;
    background:${tipo==='ok'?'#27AE60':tipo==='err'?'#e74c3c':'#4A90D9'};color:white;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3000);
}

// Confirmar acción destructiva
function confirmar(msg) { return window.confirm(msg); }

// CSS compartido
const CSS_BASE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f0f2f5; min-height: 100vh; }
  header { background: #1a1a2e; color: white; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
  header h1 { font-size: 17px; font-weight: 700; letter-spacing: 1px; }
  .header-right { display: flex; align-items: center; gap: 16px; font-size: 12px; color: #aab; }
  .btn-logout { background: none; border: none; color: #aab; cursor: pointer; font-size: 12px; }
  nav { background: #252545; display: flex; overflow-x: auto; padding: 0 24px; gap: 2px; }
  nav a { color: #aab; text-decoration: none; padding: 11px 16px; font-size: 12px; font-weight: 600; white-space: nowrap; border-bottom: 3px solid transparent; }
  nav a:hover { color: white; }
  nav a.active { color: white; border-bottom-color: #4A90D9; }
  main { max-width: 1200px; margin: 28px auto; padding: 0 20px; }
  .card { background: white; border-radius: 12px; padding: 22px; box-shadow: 0 2px 12px rgba(0,0,0,0.07); margin-bottom: 20px; }
  .card-title { font-size: 14px; font-weight: 700; color: #1a1a2e; margin-bottom: 16px; }
  .btn { padding: 9px 18px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: #4A90D9; color: white; }
  .btn-success { background: #27AE60; color: white; }
  .btn-danger  { background: #e74c3c; color: white; }
  .btn-warning { background: #f39c12; color: white; }
  .btn-sm { padding: 5px 12px; font-size: 12px; }
  .form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 14px; }
  .form-row.full { grid-template-columns: 1fr; }
  .campo label { display: block; font-size: 11px; font-weight: 600; color: #666; margin-bottom: 5px; }
  .campo input, .campo select, .campo textarea { width: 100%; padding: 8px 11px; border: 1.5px solid #d0d5dd; border-radius: 7px; font-size: 13px; outline: none; font-family: inherit; }
  .campo input:focus, .campo select:focus, .campo textarea:focus { border-color: #4A90D9; }
  .tabla-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f5f6fa; color: #555; font-weight: 600; padding: 10px 12px; text-align: left; border-bottom: 2px solid #e8eaf0; white-space: nowrap; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f5; vertical-align: middle; }
  tr:hover td { background: #fafbff; }
  .acciones { display: flex; gap: 6px; }
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 200; align-items: center; justify-content: center; padding: 20px; }
  .modal-overlay.open { display: flex; }
  .modal { background: white; border-radius: 14px; padding: 28px; width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto; }
  .modal-title { font-size: 16px; font-weight: 700; color: #1a1a2e; margin-bottom: 20px; }
  .modal-footer { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
  .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
  .search { padding: 8px 14px; border-radius: 8px; border: 1.5px solid #d0d5dd; font-size: 13px; outline: none; min-width: 200px; }
`;
