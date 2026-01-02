import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../config/database.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Generate room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create a room
router.post('/create', authenticateToken, (req, res, next) => {
  try {
    const { type, settings } = req.body;

    if (!type || !['quickplay', 'multiplayer', 'host'].includes(type)) {
      throw new AppError('Invalid room type', 400, 'INVALID_INPUT');
    }

    const db = getDatabase();

    // Generate unique room code
    let roomCode;
    let attempts = 0;
    do {
      roomCode = generateRoomCode();
      const existing = db.prepare('SELECT id FROM rooms WHERE code = ?').get(roomCode);
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      throw new AppError('Could not generate unique room code', 500, 'CODE_GENERATION_FAILED');
    }

    const roomId = uuidv4();
    const settingsJson = JSON.stringify(settings || {});

    db.prepare(`
      INSERT INTO rooms (id, code, type, creator_id, settings, status)
      VALUES (?, ?, ?, ?, ?, 'waiting')
    `).run(roomId, roomCode, type, req.user.userId, settingsJson);

    // Add creator as participant
    const role = type === 'host' ? 'host' : 'player';
    db.prepare(`
      INSERT INTO room_participants (room_id, user_id, role)
      VALUES (?, ?, ?)
    `).run(roomId, req.user.userId, role);

    res.status(201).json({
      roomId,
      roomCode,
      type,
      settings: settings || {},
    });
  } catch (error) {
    next(error);
  }
});

// Get room by code
router.get('/:code', optionalAuth, (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDatabase();

    const room = db.prepare(`
      SELECT r.*, u.display_name as creator_name
      FROM rooms r
      LEFT JOIN users u ON r.creator_id = u.id
      WHERE r.code = ?
    `).get(code.toUpperCase());

    if (!room) {
      throw new AppError('Room not found', 404, 'ROOM_NOT_FOUND');
    }

    // Get participants
    const participants = db.prepare(`
      SELECT rp.*, u.display_name
      FROM room_participants rp
      JOIN users u ON rp.user_id = u.id
      WHERE rp.room_id = ?
    `).all(room.id);

    res.json({
      id: room.id,
      code: room.code,
      type: room.type,
      status: room.status,
      creatorId: room.creator_id,
      creatorName: room.creator_name,
      settings: JSON.parse(room.settings || '{}'),
      players: participants.map(p => ({
        id: p.user_id,
        displayName: p.display_name,
        role: p.role,
        joinedAt: p.joined_at,
      })),
      createdAt: room.created_at,
    });
  } catch (error) {
    next(error);
  }
});

// Validate room code
router.get('/:code/validate', (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDatabase();

    const room = db.prepare(`
      SELECT id, type, status, settings FROM rooms WHERE code = ?
    `).get(code.toUpperCase());

    if (!room) {
      return res.json({ valid: false, reason: 'Room not found', canJoin: false });
    }

    const settings = JSON.parse(room.settings || '{}');
    const participantCount = db.prepare(`
      SELECT COUNT(*) as count FROM room_participants WHERE room_id = ?
    `).get(room.id).count;

    const maxPlayers = settings.maxPlayers || 6;
    const canJoin = room.status === 'waiting' && participantCount < maxPlayers;

    res.json({
      valid: true,
      type: room.type,
      status: room.status,
      playerCount: participantCount,
      maxPlayers,
      canJoin,
      reason: canJoin ? null : room.status !== 'waiting' ? 'Game in progress' : 'Room is full',
    });
  } catch (error) {
    next(error);
  }
});

// Delete room (creator only)
router.delete('/:code', authenticateToken, (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDatabase();

    const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code.toUpperCase());

    if (!room) {
      throw new AppError('Room not found', 404, 'ROOM_NOT_FOUND');
    }

    if (room.creator_id !== req.user.userId) {
      throw new AppError('Not authorized to delete this room', 403, 'NOT_AUTHORIZED');
    }

    db.prepare('DELETE FROM room_participants WHERE room_id = ?').run(room.id);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
