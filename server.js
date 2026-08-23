const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// Room & Matchmaking State
const rooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // Create a new custom room
  socket.on('create_room', () => {
    const roomCode = generateRoomCode();
    rooms.set(roomCode, {
      host: socket.id,
      guest: null,
      state: 'WAITING'
    });

    socket.join(roomCode);
    socket.emit('room_created', { roomCode, role: 'HOST', team: 'BLUE' });
    console.log(`[Room Created] Code: ${roomCode} by ${socket.id}`);
  });

  // Join existing room by code
  socket.on('join_room', (roomCode) => {
    const code = roomCode.trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('join_error', 'Match room not found.');
    }
    if (room.guest) {
      return socket.emit('join_error', 'This room is already full.');
    }

    room.guest = socket.id;
    room.state = 'PLAYING';
    socket.join(code);

    socket.emit('room_joined', { roomCode: code, role: 'GUEST', team: 'RED' });
    io.to(code).emit('match_start', {
      hostId: room.host,
      guestId: room.guest,
      roomCode: code
    });

    console.log(`[Match Started] Room: ${code} - Host: ${room.host}, Guest: ${socket.id}`);
  });

  // Host broadcasts authoritative simulation state to Guest
  socket.on('sync_state', (payload) => {
    socket.to(payload.roomCode).emit('server_state_update', payload.state);
  });

  // Player action/flick input sync
  socket.on('player_action', (payload) => {
    socket.to(payload.roomCode).emit('receive_player_action', payload.action);
  });

  // Match restart / set-piece signals
  socket.on('game_event', (payload) => {
    io.to(payload.roomCode).emit('broadcast_game_event', payload);
  });

  // Handle Disconnection
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
    for (const [code, room] of rooms.entries()) {
      if (room.host === socket.id || room.guest === socket.id) {
        io.to(code).emit('opponent_disconnected');
        rooms.delete(code);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tabletop Footie server running on http://localhost:${PORT}`);
});
