const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('*', (req, res) => {
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  if (fs.existsSync(rootIndex)) return res.sendFile(rootIndex);
  res.status(404).send("index.html not found.");
});

// Sequential Room Counter & Match Queue
let roomCounter = 1;
let waitingPlayer = null;
const activeRooms = new Map();

io.on('connection', (socket) => {
  console.log(`[Connected] ${socket.id}`);

  // Auto-Matchmaking Trigger
  socket.on('find_match', () => {
    if (waitingPlayer && waitingPlayer.id !== socket.id) {
      // Pair with waiting player
      const roomNumber = roomCounter++;
      const roomName = `Room ${roomNumber}`;

      const hostSocket = waitingPlayer;
      const guestSocket = socket;
      waitingPlayer = null;

      hostSocket.join(roomName);
      guestSocket.join(roomName);

      activeRooms.set(roomName, {
        host: hostSocket.id,
        guest: guestSocket.id,
        hostReady: false,
        guestReady: false,
        roomName: roomName
      });

      // Notify both players
      hostSocket.emit('match_found', { roomName, role: 'HOST', team: 'BLUE' });
      guestSocket.emit('match_found', { roomName, role: 'GUEST', team: 'RED' });
      console.log(`[Paired] ${roomName} -> Host: ${hostSocket.id}, Guest: ${guestSocket.id}`);
    } else {
      // Put in queue
      waitingPlayer = socket;
      socket.emit('matchmaking_status', 'SEARCHING FOR PLAYER...');
      console.log(`[Queue] Player waiting: ${socket.id}`);
    }
  });

  // Ready Button Check
  socket.on('player_ready', (roomName) => {
    const room = activeRooms.get(roomName);
    if (!room) return;

    if (socket.id === room.host) room.hostReady = true;
    if (socket.id === room.guest) room.guestReady = true;

    io.to(roomName).emit('ready_update', {
      hostReady: room.hostReady,
      guestReady: room.guestReady
    });

    if (room.hostReady && room.guestReady) {
      io.to(roomName).emit('start_countdown');
    }
  });

  // Game State Synchronization
  socket.on('sync_state', (payload) => {
    socket.to(payload.roomName).emit('server_state_update', payload.state);
  });

  // Player Flick Input
  socket.on('player_action', (payload) => {
    socket.to(payload.roomName).emit('receive_player_action', payload.action);
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
    for (const [roomName, room] of activeRooms.entries()) {
      if (room.host === socket.id || room.guest === socket.id) {
        io.to(roomName).emit('opponent_disconnected');
        activeRooms.delete(roomName);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Tabletop Footie matchmaking server active on port ${PORT}`);
});
