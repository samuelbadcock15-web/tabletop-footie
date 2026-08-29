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

// Initialize 6 fixed rooms
const rooms = {};
for (let i = 1; i <= 6; i++) {
    const roomId = `room_${i}`;
    rooms[roomId] = {
        id: roomId,
        name: `Arena 0${i}`,
        players: {}, // socketId: { team: 'BLUE'|'RED', role: 'HOST'|'GUEST', ready: false }
        status: 'open' // 'open' | 'in_game'
    };
}

function getLobbiesSummary() {
    const list = [];
    for (const rId in rooms) {
        const r = rooms[rId];
        const pKeys = Object.keys(r.players);
        list.push({
            id: r.id,
            name: r.name,
            playerCount: pKeys.length,
            status: r.status,
            players: pKeys.map(id => ({
                id,
                ready: r.players[id].ready,
                team: r.players[id].team,
                role: r.players[id].role
            }))
        });
    }
    return list;
}

function broadcastLobbyState() {
    io.emit('lobbies_update', getLobbiesSummary());
}

function removePlayerFromCurrentRoom(socket) {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (room.players[socket.id]) {
            delete room.players[socket.id];
            socket.leave(roomId);

            if (room.status === 'in_game') {
                io.to(roomId).emit('opponent_disconnected');
                room.status = 'open';
                room.players = {}; // Boot remaining player if game aborts
            }
            broadcastLobbyState();
            break;
        }
    }
}

io.on('connection', (socket) => {
    // Send initial list of all rooms
    socket.emit('lobbies_update', getLobbiesSummary());

    socket.on('join_room', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        if (room.status === 'in_game') {
            socket.emit('lobby_error', 'This match is currently in progress!');
            return;
        }

        const currentPlayers = Object.keys(room.players);
        if (currentPlayers.length >= 2) {
            socket.emit('lobby_error', 'This room is already full!');
            return;
        }

        removePlayerFromCurrentRoom(socket);

        // Assign Host/Blue to first player, Guest/Red to second
        let assignedRole = 'HOST';
        let assignedTeam = 'BLUE';
        if (currentPlayers.length === 1) {
            const existingP = room.players[currentPlayers[0]];
            assignedRole = existingP.role === 'HOST' ? 'GUEST' : 'HOST';
            assignedTeam = existingP.team === 'BLUE' ? 'RED' : 'BLUE';
        }

        room.players[socket.id] = {
            team: assignedTeam,
            role: assignedRole,
            ready: false
        };

        socket.join(roomId);
        socket.emit('room_joined', {
            roomName: room.id,
            name: room.name,
            team: assignedTeam,
            role: assignedRole
        });

        broadcastLobbyState();
    });

    socket.on('leave_room', () => {
        removePlayerFromCurrentRoom(socket);
        socket.emit('left_room_success');
        broadcastLobbyState();
    });

    socket.on('toggle_ready', (roomId) => {
        const room = rooms[roomId];
        if (!room || !room.players[socket.id]) return;

        room.players[socket.id].ready = !room.players[socket.id].ready;
        broadcastLobbyState();

        const playerIds = Object.keys(room.players);
        const allReady = playerIds.length === 2 && playerIds.every(id => room.players[id].ready);

        if (allReady) {
            room.status = 'in_game';
            broadcastLobbyState();

            const p1 = playerIds[0];
            const p2 = playerIds[1];

            io.to(p1).emit('start_match_countdown', { roomName: roomId, team: room.players[p1].team, role: room.players[p1].role });
            io.to(p2).emit('start_match_countdown', { roomName: roomId, team: room.players[p2].team, role: room.players[p2].role });
        }
    });

    // In-game Relay Events
    socket.on('sync_state', (payload) => {
        socket.to(payload.roomName).emit('server_state_update', payload.state);
    });

    socket.on('player_action', (payload) => {
        socket.to(payload.roomName).emit('receive_player_action', payload.action);
    });

    socket.on('set_piece_event', (payload) => {
        socket.to(payload.roomName).emit('receive_set_piece_event', payload);
    });

    socket.on('log_replay_event', (payload) => {
        socket.to(payload.roomName).emit('receive_replay_log', payload.record);
    });

    socket.on('disconnect', () => {
        removePlayerFromCurrentRoom(socket);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
