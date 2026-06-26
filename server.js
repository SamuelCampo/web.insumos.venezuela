// Cargar variables de entorno desde el archivo .env
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

// ─── Inicializar Express y servidor HTTP ───────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos (index.html, CSS, JS cliente)
app.use(express.static('public'));

// ─── Conexión a Supabase ───────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const TABLE = 'insumos';      // Nombre de la tabla en Supabase
const LIMIT_INICIAL = 50;     // Cantidad de registros a enviar en carga inicial

// ─── WebSockets ────────────────────────────────────────────────────────────────
io.on('connection', async (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  // ── Carga inicial: enviar solo registros NO resueltos ──────────────────
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('resuelto', false)            // Solo alertas pendientes
      .order('created_at', { ascending: false })
      .limit(LIMIT_INICIAL);

    if (error) {
      console.error('Error al obtener registros iniciales:', error.message);
      return;
    }

    // Se invierten para que el cliente los muestre en orden cronológico
    socket.emit('insumos-iniciales', data.reverse());
  } catch (err) {
    console.error('Error en carga inicial:', err.message);
  }

  // ── Escuchar nuevo insumo reportado por un cliente ────────────────────────
  socket.on('nuevo-insumo', async (payload) => {
    const { centro, insumo, estado } = payload;

    // Validación básica del payload
    if (!centro || !insumo || !['falta', 'sobra'].includes(estado)) {
      socket.emit('error', { mensaje: 'Datos inválidos. Debes enviar centro, insumo y estado (falta/sobra).' });
      return;
    }

    // Persistir en Supabase
    const { data, error } = await supabase
      .from(TABLE)
      .insert([{ centro, insumo, estado }])
      .select();

    if (error) {
      console.error('Error al insertar en Supabase:', error.message);
      socket.emit('error', { mensaje: 'Error al guardar el registro.' });
      return;
    }

    // Transmitir el nuevo registro a TODOS los clientes conectados
    const nuevoRegistro = data[0];
    io.emit('insumo-nuevo', nuevoRegistro);
  });

  // ── Escuchar resolución de alerta por parte de un voluntario ────────
  socket.on('marcar_resuelto', async (payload) => {
    const { id, nombreVoluntario } = payload;

    if (!id || !nombreVoluntario) {
      socket.emit('error', { mensaje: 'Datos inválidos. Debes enviar id y nombreVoluntario.' });
      return;
    }

    // Actualizar el registro en Supabase: marcar como resuelto
    const { error } = await supabase
      .from(TABLE)
      .update({ resuelto: true, resuelto_por: nombreVoluntario })
      .eq('id', id);

    if (error) {
      console.error('Error al marcar como resuelto:', error.message);
      socket.emit('error', { mensaje: 'Error al resolver la alerta.' });
      return;
    }

    // Notificar a todos los clientes que esta alerta fue resuelta
    io.emit('alerta_resuelta', { id });
  });

  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
  });
});

// ─── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
