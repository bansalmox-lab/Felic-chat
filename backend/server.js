const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const cheerio = require("cheerio");
require("dotenv").config();

// FIX: Force Google Public DNS to bypass local network DNS failures
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const Message = require("./database-hybrid");
const User = require("./User");
const { Channel } = require("./database");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const allowedOrigins = [
  "https://felic-chat.vercel.app",
  "https://frontend-nine-chi-thuz51pkv1.vercel.app",
  "http://localhost:3000"
];
app.use(cors({ 
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.includes("vercel.app")) {
      callback(null, true);
    } else {
      callback(null, true); // Fallback to allow all for now to debug
    }
  },
  credentials: true 
}));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.get("/", (req, res) => res.send("Felic Chat Backend is Live!"));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

// Helper to extract first URL from text
const extractFirstUrl = (text) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
};

// Helper to fetch Open Graph metadata
const fetchLinkPreview = async (url) => {
  try {
    const { data: html } = await axios.get(url, { 
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });
    const $ = cheerio.load(html);
    
    return {
      title: $('meta[property="og:title"]').attr('content') || $('title').text() || null,
      description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || null,
      image: $('meta[property="og:image"]').attr('content') || null,
      siteName: $('meta[property="og:site_name"]').attr('content') || null,
      url: url
    };
  } catch (error) {
    console.error(`Error fetching preview for ${url}:`, error.message);
    return null;
  }
};

// File upload endpoint
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.json({
    fileUrl: fileUrl,
    fileName: req.file.originalname,
    fileType: req.file.mimetype,
  });
});

// Live users tracking
const liveUsers = new Map(); // socketId -> userId
const activeUsers = new Map(); // userId -> socketInfo

// Room tracking
const roomJoins = new Map();   // room -> Set of userIds who joined
const kickedUsers = new Map(); // room -> Set of userIds who were kicked
const typingUsers = new Map(); // room -> Set of usernames currently typing

// In-memory User model replaced by MongoDB

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secretkey', (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Protected routes
app.post('/api/register', async (req, res) => {
  try {
    let { username, email, password } = req.body;
    username = username ? username.toLowerCase() : username;
    email = email ? email.toLowerCase() : email;

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return res.status(400).json({ 
        message: 'User already exists with this email or username' 
      });
    }

    // Create new user
    const newUser = await User.create({
      username,
      email,
      password, // password will be hashed via User.js pre-save hook
      avatar: req.body.avatar || undefined // Save the avatar if provided
    });

    // Determine if this user is admin
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isAdmin = adminEmail && newUser.email.toLowerCase() === adminEmail;
    if (isAdmin && !newUser.isAdmin) {
      newUser.isAdmin = true;
      await newUser.save();
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: newUser._id, username: newUser.username, isAdmin },
      process.env.JWT_SECRET || 'secretkey',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        isAdmin
      }
    });

  } catch (error) {
    console.error('Registration error details:', {
      name: error.name,
      message: error.message,
      errors: error.errors ? Object.keys(error.errors) : []
    });

    // Handle Mongoose validation errors (e.g., username too long, email invalid)
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation failed: ' + messages.join(', ')
      });
    }

    // Handle MongoDB duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({ message: 'User already exists with this email or username' });
    }

    res.status(500).json({ message: 'Server error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    email = email ? email.toLowerCase() : email;

    // Find user by email or username (case-sensitive)
    const user = await User.findOne({ 
      $or: [{ email: email }, { username: email }] 
    });

    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    // Compare password
    const validPassword = await user.comparePassword(password);

    if (!validPassword) {
      return res.status(401).json({ 
        message: 'Invalid email or password' 
      });
    }

    // Determine if this user is admin
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isAdmin = adminEmail && user.email.toLowerCase() === adminEmail;
    
    // Sync isAdmin field in DB if it changed
    let hasChanges = false;
    if (isAdmin !== user.isAdmin) {
      console.log(`[AUTH] Syncing isAdmin for ${user.email}: ${isAdmin}`);
      user.isAdmin = isAdmin;
      hasChanges = true;
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, username: user.username, isAdmin },
      process.env.JWT_SECRET || 'secretkey',
      { expiresIn: '24h' }
    );

    // Update last seen
    user.lastSeen = new Date();
    await user.save(); // This will save isAdmin sync too if hasChanges is true

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        isAdmin
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Get live users endpoint
app.get('/api/live-users', async (req, res) => {
  try {
    const liveUserData = [];
    
    for (let [userId, socketInfo] of activeUsers) {
      const user = await User.findById(userId);
      if (user) {
        const userObj = user.toJSON();
        liveUserData.push({
          id: userObj._id,
          username: userObj.username,
          email: userObj.email,
          avatar: userObj.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userObj.username)}&background=random`,
          isActive: true,
          lastSeen: new Date(),
          createdAt: userObj.createdAt,
          socketCount: socketInfo.sockets.length
        });
      }
    }

    res.json({
      users: liveUserData,
      total: liveUserData.length
    });

  } catch (error) {
    console.error('Get live users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all users endpoint
app.get('/api/users', async (req, res) => {
  try {
    // Get all users from memory -> DB
    const usersData = await User.find({});
    const users = usersData.map(user => {
      const userObj = user.toJSON ? user.toJSON() : user;
      return {
        id: userObj._id,
        username: userObj.username,
        email: userObj.email,
        avatar: userObj.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userObj.username)}&background=random`,
        isActive: userObj.isActive,
        lastSeen: userObj.lastSeen,
        createdAt: userObj.createdAt
      };
    });

    res.json({
      users: users,
      total: users.length
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/users/:username - admin only: delete user
app.delete('/api/users/:username', authenticateToken, async (req, res) => {
  try {
    const { username } = req.params;
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const requestingUser = await User.findById(req.user.id);
    
    if (!requestingUser || requestingUser.email.toLowerCase() !== adminEmail) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const userToDelete = await User.findOne({ username: username });
    if (!userToDelete) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Prevent admin from deleting themselves
    if (userToDelete.email.toLowerCase() === adminEmail) {
      return res.status(403).json({ message: 'Cannot delete the main admin account' });
    }
    
    await User.deleteOne({ username: username });
    
    // Kick them if they are online
    for (let [userId, userSockets] of activeUsers) {
      if (userSockets.user && userSockets.user.username === username) {
        userSockets.sockets.forEach(socketId => {
          const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === socketId);
          if (targetSocket) targetSocket.disconnect(true);
        });
        activeUsers.delete(userId);
        break;
      }
    }
    
    io.emit("live_users_update", {
      users: await getLiveUsersData(),
      total: activeUsers.size
    });
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error while deleting user' });
  }
});

// PUT /api/users/:username/avatar — update user avatar
app.put('/api/users/:username/avatar', authenticateToken, async (req, res) => {
  console.log(`[USER_AVATAR_UPDATE] Request received for ${req.params.username}`);
  console.log(`[USER_AVATAR_UPDATE] New avatar URL:`, req.body.avatar);
  try {
    const { username } = req.params;
    const { avatar } = req.body;
    
    // Only the user themselves can update their avatar
    if (req.user.username.toLowerCase() !== username.toLowerCase()) {
      return res.status(403).json({ message: 'Can only update your own avatar' });
    }
    
    const userToUpdate = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
    if (!userToUpdate) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    userToUpdate.avatar = avatar;
    await userToUpdate.save();
    
    // Update live memory state so fetch Live Users shows it immediately
    for (let [userId, userSockets] of activeUsers) {
      if (userSockets.user && userSockets.user.username === userToUpdate.username) {
        userSockets.user.avatar = avatar;
        break;
      }
    }
    
    io.emit("live_users_update", {
      users: await getLiveUsersData(),
      total: activeUsers.size
    });
    
    res.json({ message: 'Avatar updated successfully', avatar });
  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({ message: 'Server error while updating avatar' });
  }
});

// ===== Channel REST Endpoints =====

// GET /api/channels — fetch all channels
app.get('/api/channels', async (req, res) => {
  try {
    const channels = await Channel.find({}).sort({ createdAt: 1 });
    res.json({ channels: channels.map(c => c.name) });
  } catch (e) {
    // Fallback to defaults if DB not available
    res.json({ channels: ['General', 'Sales', 'Marketing', 'Design', 'Tech'] });
  }
});

// POST /api/channels — admin only: create channel
app.post('/api/channels', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Channel name required' });
    // Only admin
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const user = await User.findById(req.user.id);
    if (!user || user.email.toLowerCase() !== adminEmail) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const channel = await Channel.create({ name: name.trim(), createdBy: user.username });
    // Broadcast to all connected clients
    io.emit('channel_created', { name: channel.name });
    res.status(201).json({ channel: channel.name });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: 'Channel already exists' });
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/channels/:name — admin only: delete channel
app.delete('/api/channels/:name', authenticateToken, async (req, res) => {
  console.log(`[DELETE CHANNEL] Request received for ${req.params.name} by user ID: ${req.user.id}`);
  try {
    const { name } = req.params;
    if (name.toLowerCase() === 'general') {
      console.log(`[DELETE CHANNEL] Blocked deleting General channel`);
      return res.status(400).json({ message: 'Cannot delete General channel' });
    }
    
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const user = await User.findById(req.user.id);
    console.log(`[DELETE CHANNEL] Found user email: ${user ? user.email : 'null'}, Admin email: ${adminEmail}`);
    
    if (!user || user.email.toLowerCase() !== adminEmail) {
      console.log(`[DELETE CHANNEL] Admin access denied`);
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const result = await Channel.deleteOne({ name });
    await Message.deleteMany({ room: name }); // Delete all message history permanently
    console.log(`[DELETE CHANNEL] Delete operation result:`, result);
    
    io.emit('channel_deleted', { name });
    res.json({ message: 'Channel deleted' });
  } catch (e) {
    console.error(`[DELETE CHANNEL] Server error:`, e.stack || e);
    res.status(500).json({ message: 'Server error' });
  }
});

// Seed default channels if empty
async function seedChannels() {
  try {
    const count = await Channel.countDocuments();
    if (count === 0) {
      const defaults = ['General', 'Sales', 'Marketing', 'Design', 'Tech'];
      await Channel.insertMany(defaults.map(name => ({ name, createdBy: 'System' })));
      console.log('Default channels seeded.');
    }
  } catch (e) {
    console.error('Channel seeding skipped (DB not ready):', e.message);
  }
}
seedChannels();

// Protected route example
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    // Remove password from user object
    const { password, ...userWithoutPassword } = user;

    res.json({
      user: {
        id: userWithoutPassword._id,
        username: userWithoutPassword.username,
        email: userWithoutPassword.email,
        avatar: userWithoutPassword.avatar,
        isActive: userWithoutPassword.isActive,
        lastSeen: userWithoutPassword.lastSeen,
        createdAt: userWithoutPassword.createdAt
      }
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to get live users data
async function getLiveUsersData() {
  const liveUserData = [];
  
  for (let [userId, socketInfo] of activeUsers) {
    // Optimization: Use the user object already stored in activeUsers
    const userObj = socketInfo.user;
    
    if (userObj) {
      const userJSON = userObj.toJSON ? userObj.toJSON() : userObj;
      liveUserData.push({
        id: userId,
        username: userJSON.username,
        email: userJSON.email,
        avatar: userJSON.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userJSON.username)}&background=random`,
        isAdmin: userJSON.isAdmin || false,
        isActive: true,
        lastSeen: userJSON.lastSeen || new Date(),
        createdAt: userJSON.createdAt,
        socketCount: socketInfo.sockets.length
      });
    }
  }
  
  return liveUserData;
}

const server = http.createServer(app);

const io = require('socket.io')(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

io.on("connection", (socket) => {
  console.log("New user connected:", socket.id);

  socket.on("authenticate", async (userData) => {
    try {
      // Verify JWT token
      const decoded = jwt.verify(userData.token, process.env.JWT_SECRET || 'secretkey');
      let user = await User.findById(decoded.id);
      
      if (!user) {
        throw new Error("User not found in database");
      }
      
      if (user) {
        // Add user to live tracking
        liveUsers.set(socket.id, user._id.toString());
        socket.userId = user._id.toString(); // Store userId on socket
        
        if (!activeUsers.has(user._id.toString())) {
          activeUsers.set(user._id.toString(), { sockets: [], user: user });
        }
        
        const userSockets = activeUsers.get(user._id.toString());
        if (!userSockets.sockets.includes(socket.id)) {
          userSockets.sockets.push(socket.id);
        }
        
        // Update user status to active
        user.isActive = true;
        await user.save();
        
        console.log(`User ${user.username} authenticated and marked as live`);
        
        // Broadcast live users update
        io.emit("live_users_update", {
          users: await getLiveUsersData(),
          total: activeUsers.size
        });
      }
    } catch (error) {
      console.error("Authentication error:", error);
      socket.emit("authentication_error", { message: "Invalid token" });
    }
  });

  socket.on("join_room", async (room) => {
    try {
      console.log(`[JOIN_ROOM] Socket ${socket.id} joining room: ${room}`);
      socket.join(room);
      
      const currentRooms = Array.from(socket.rooms);
      console.log(`[JOIN_ROOM] Socket ${socket.id} is now in rooms:`, currentRooms);
      console.log("User", socket.id, "joined room:", room);
      
      // Notify other users in the room that someone joined
      const user = activeUsers.get(socket.userId);
      console.log("Found user for socket:", socket.userId, "user:", user);
      console.log("Active users:", Array.from(activeUsers.keys()));
      
      if (user && user.user) {
        // Check if this user has already joined this room
        if (!roomJoins.has(room)) {
          roomJoins.set(room, new Set());
        }
        
        const roomUsers = roomJoins.get(room);
        
        // Only emit join notification if user hasn't joined this room before
        if (!roomUsers.has(user.user._id)) {
          roomUsers.add(user.user._id);
          
          const joinData = {
            username: user.user.username,
            room: room,
            userId: user.user._id
          };
          console.log("Emitting user_joined event:", joinData);
          socket.to(room).emit("user_joined", joinData);
          
          try {
            const isPreviouslyKicked = kickedUsers.has(room) && kickedUsers.get(room).has(user.user._id);
            const joinMsg = {
              message: isPreviouslyKicked
                ? `⚠️ Previously kicked user ${user.user.username} has rejoined the room.`
                : `${user.user.username} joined the chat! 🎉`,
              author: 'System',
              room: room,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            const savedMsg = await Message.create(joinMsg);
            
            // Broadcast the standard message format to OTHERS (the joiner will get it via previous_messages)
            socket.to(room).emit("message", {
              ...joinMsg,
              _id: savedMsg._id ? savedMsg._id.toString() : Date.now().toString(),
              timestamp: new Date().toISOString(),
              isSystemMessage: true,
              reactions: []
            });
          } catch (e) {
            console.error("Failed to save join system message:", e);
          }
        } else {
          console.log("User already joined room before, skipping notification:", user.user.username, "in room:", room);
        }
      } else {
        console.log("No user found for socket userId:", socket.userId);
      }
      
      // Send previous messages from database
      const messages = await Message.find({ room }).sort({ createdAt: 1 });
      socket.emit("previous_messages", { messages, room });
      console.log(`Sent ${messages.length} previous messages for room ${room}`);
    } catch (error) {
      console.error("Error in join_room:", error);
      socket.emit("join_room_error", { message: "Error joining room" });
    }
  });

  socket.on("kick_user", async (data) => {
    try {
      const { room, usernameToKick } = data;
      console.log("Kick request from", socket.id, "for user:", usernameToKick, "in room:", room);

      // ── Server-side admin verification ──────────────────────────────────────
      const kickerInfo = activeUsers.get(socket.userId);
      if (!kickerInfo || !kickerInfo.user) {
        return socket.emit("kick_error", { message: "Not authenticated" });
      }
      const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
      if (!adminEmail || kickerInfo.user.email.toLowerCase() !== adminEmail) {
        console.log(`Non-admin kick attempt blocked from user: ${kickerInfo.user.username}`);
        return socket.emit("kick_error", { message: "Admin access required to kick users" });
      }
      // ────────────────────────────────────────────────────────────────────────


      let targetUserId = null;
      for (let [userId, userSockets] of activeUsers) {
        if (userSockets.user && userSockets.user.username === usernameToKick) {
          targetUserId = userId;
          break;
        }
      }

      if (targetUserId) {
        // Prevent spam-click kicks: only proceed if the user is currently recognized in the room.
        const isCurrentlyInRoom = Array.from(roomJoins.get(room) || []).some(id => id.toString() === targetUserId.toString());
        if (!isCurrentlyInRoom) {
          return socket.emit("kick_error", { message: "User has been kicked or is no longer in this room" });
        }

        const userSockets = activeUsers.get(targetUserId);
        if (userSockets && userSockets.sockets.length > 0) {
          // Track that they were kicked for future join notifications
          if (!kickedUsers.has(room)) {
            kickedUsers.set(room, new Set());
          }
          kickedUsers.get(room).add(targetUserId);

          // Kick ALL sockets for this user
          userSockets.sockets.forEach(sId => {
            const targetSocket = io.sockets.sockets.get(sId);
            if (targetSocket) {
              targetSocket.leave(room);
              // Send private notification to each kicked socket
              targetSocket.emit("kicked_notification", {
                room: room,
                message: `You were kicked from ${room}`
              });
            }
          });

          // Remove from room tracking explicitly handling ObjectIds
          if (roomJoins.has(room)) {
            const roomSet = roomJoins.get(room);
            for (let id of roomSet) {
              if (id.toString() === targetUserId.toString()) {
                roomSet.delete(id);
              }
            }
          }
          
          io.to(room).emit("user_kicked", {
            username: usernameToKick,
            room: room,
            kickedBy: activeUsers.get(socket.userId)?.user?.username || 'Admin'
          });

          // Trigger UI update for all admins
          io.emit("live_users_update", {
            users: await getLiveUsersData(),
            total: activeUsers.size
          });
          
          try {
            const kickMsg = {
              message: `${usernameToKick} was kicked from the room! 👢`,
              author: 'System',
              room: room,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            const savedKickMsg = await Message.create(kickMsg);
            
            io.to(room).emit("message", {
              ...kickMsg,
              _id: savedKickMsg._id ? savedKickMsg._id.toString() : Date.now().toString(),
              timestamp: new Date().toISOString(),
              isSystemMessage: true,
              reactions: []
            });
          } catch (e) {
            console.error("Failed to save kick system message:", e);
          }
          
          console.log(`Successfully kicked ${usernameToKick} and all their sockets from room ${room}`);
        }
      } else {
        console.log("User not found for kick:", usernameToKick);
        socket.emit("kick_error", { message: "User not found" });
      }
    } catch (error) {
      console.error("Error in kick_user:", error);
      socket.emit("kick_error", { message: "Failed to kick user" });
    }
  });

  socket.on("add_reaction", async (data) => {
    try {
      const { messageId, emoji, username } = data;
      console.log("Reaction added:", { messageId, emoji, username });
      
      // Update message in database with reaction (safe - no-op if not found)
      try {
        await Message.findByIdAndUpdate(messageId, {
          $push: {
            reactions: { emoji, username, timestamp: new Date() }
          }
        });
      } catch (dbErr) {
        console.log("DB reaction update skipped (in-memory or not found):", dbErr.message);
      }
      
      // Broadcast reaction to room
      io.to(data.room).emit("reaction_added", {
        messageId,
        emoji,
        username,
        room: data.room
      });
      
      console.log("Reaction broadcasted successfully");
    } catch (error) {
      console.error("Error adding reaction:", error);
    }
  });

  socket.on("remove_reaction", async (data) => {
    try {
      const { messageId, emoji, username } = data;
      console.log("Reaction removed:", { messageId, emoji, username });
      
      // Remove reaction from database (safe - no-op if not found)
      try {
        await Message.findByIdAndUpdate(messageId, {
          $pull: {
            reactions: { emoji, username }
          }
        });
      } catch (dbErr) {
        console.log("DB reaction remove skipped (in-memory or not found):", dbErr.message);
      }
      
      // Broadcast reaction removal to room
      io.to(data.room).emit("reaction_removed", {
        messageId,
        emoji,
        username,
        room: data.room
      });
      
      console.log("Reaction removal broadcasted successfully");
    } catch (error) {
      console.error("Error removing reaction:", error);
    }
  });

  socket.on("message", async (data) => {
    try {
      console.log("=== MESSAGE HANDLER CALLED ===");
      console.log("Message received from", socket.id, "in room", data.room, ":", data);
      console.log("Socket room memberships:", socket.rooms);
      
      // Save message to database and get back the saved doc (with _id)
      const savedMessage = await Message.create({
        room: data.room,
        author: data.author,
        message: data.message,
        time: data.time,
        fileUrl: data.fileUrl || null,
        fileName: data.fileName || null,
        fileType: data.fileType || null,
        linkPreview: null
      });

      // Async fetch preview if a link is detected
      const firstUrl = extractFirstUrl(data.message);
      if (firstUrl) {
        fetchLinkPreview(firstUrl).then(async (preview) => {
          if (preview) {
            savedMessage.linkPreview = preview;
            await savedMessage.save();
            // Emit a special update for this message specifically for the preview
            io.to(data.room).emit("message_preview_update", {
              messageId: savedMessage._id,
              linkPreview: preview
            });
          }
        });
      }

      console.log("Message saved to database with _id:", savedMessage._id);
      
      // Broadcast the saved message (includes _id) so clients can use it for reactions
      const broadcastData = {
        ...data,
        _id: savedMessage._id ? savedMessage._id.toString() : data._id,
        reactions: []
      };
      
      console.log(`[MESSAGE_BROADCAST] Broadcasting message from ${data.author} to room ${data.room}`);
      const socketsInRoom = await io.in(data.room).allSockets();
      console.log(`[MESSAGE_BROADCAST] Sockets in target room ${data.room}:`, Array.from(socketsInRoom));
      
      io.to(data.room).emit("message", broadcastData);
      console.log("[MESSAGE_BROADCAST] Emit called successfully");
    } catch (error) {
      console.error("Error saving message:", error);
    }
  });

  socket.on("delete_message", async (data) => {
    try {
      const { messageId, room, username } = data;
      console.log("Delete request received:", { messageId, room, username });
      
      // Perform deletion from DB
      // Note: We're simply trusting the username passed. In a fully secure app, we'd check server session.
      try {
        await Message.findByIdAndDelete(messageId);
        console.log(`Deleted message ${messageId} successfully from DB.`);
      } catch (dbErr) {
        console.log("DB deletion skipped (in-memory or not found):", dbErr.message);
      }
      
      // Broadcast deletion to all users in the room
      io.to(room).emit("message_deleted", { messageId, room });
      console.log("Deletion broadcasted to room");
    } catch (error) {
      console.error("Error deleting message:", error);
    }
  });

  // Typing indicators
  socket.on("typing", (data) => {
    const { room, username } = data;
    
    if (!typingUsers.has(room)) {
      typingUsers.set(room, new Set());
    }
    
    typingUsers.get(room).add(username);
    
    // Broadcast typing users to room (excluding sender)
    socket.to(room).emit("typing_users", Array.from(typingUsers.get(room)));
  });

  socket.on("stop_typing", (data) => {
    const { room, username } = data;
    
    if (typingUsers.has(room)) {
      typingUsers.get(room).delete(username);
      
      if (typingUsers.get(room).size === 0) {
        typingUsers.delete(room);
      }
    }
    
    // Broadcast updated typing users to room
    const currentTyping = typingUsers.has(room) ? Array.from(typingUsers.get(room)) : [];
    socket.to(room).emit("typing_users", currentTyping);
  });

  socket.on("disconnect", async () => {
    console.log("User disconnected:", socket.id);
    
    // Handle live user tracking
    const userId = liveUsers.get(socket.id);
    if (userId) {
      liveUsers.delete(socket.id);
      
      const userSockets = activeUsers.get(userId);
      if (userSockets) {
        userSockets.sockets = userSockets.sockets.filter(id => id !== socket.id);
        
        if (userSockets.sockets.length === 0) {
          // User has no more active connections — remove from all room tracking
          activeUsers.delete(userId);

          // Clean up roomJoins so they get a proper re-join notification next time
          roomJoins.forEach((usersInRoom, room) => {
            for (let id of usersInRoom) {
              if (id.toString() === userId.toString()) {
                usersInRoom.delete(id);
                break;
              }
            }
          });
          
          // Mark user as inactive in storage
          try {
            const user = await User.findById(userId);
            if (user) {
              user.isActive = false;
              user.lastSeen = new Date();
              await user.save();
            }
          } catch (err) {
            console.error(err);
          }
        }
      }
      
      // Broadcast live users update
      getLiveUsersData().then(users => {
        io.emit("live_users_update", {
          users,
          total: activeUsers.size
        });
      });
    }
    
    // Clean up typing users when disconnected
    typingUsers.forEach((users, room) => {
      users.forEach(username => {
        if (typingUsers.has(room)) {
          typingUsers.get(room).delete(username);
        }
      });
      
      if (typingUsers.get(room).size === 0) {
        typingUsers.delete(room);
      }
      
      socket.to(room).emit("typing_users", Array.from(typingUsers.get(room) || []));
    });
  });

});

// Process Error Handling to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});