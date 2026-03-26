const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Message = require("./database-hybrid");
const User = require("./User");

const app = express();
app.use(cors());
app.use(express.json());

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

  jwt.verify(token, 'secretkey', (err, user) => {
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
    const { username, email, password } = req.body;

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
      password // password will be hashed via User.js pre-save hook
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: newUser._id, username: newUser.username },
      'secretkey',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email or username (case-insensitive)
    const exactMatchRegex = new RegExp(`^${email}$`, 'i');
    const user = await User.findOne({ 
      $or: [{ email: exactMatchRegex }, { username: exactMatchRegex }] 
    });

    if (!user) {
      return res.status(401).json({ 
        message: 'Invalid email or password' 
      });
    }

    // Compare password
    const validPassword = await user.comparePassword(password);

    if (!validPassword) {
      return res.status(401).json({ 
        message: 'Invalid email or password' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, username: user.username },
      'secretkey',
      { expiresIn: '24h' }
    );

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
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
        const { password, ...userWithoutPassword } = user;
        liveUserData.push({
          id: userWithoutPassword._id,
          username: userWithoutPassword.username,
          email: userWithoutPassword.email,
          avatar: userWithoutPassword.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userWithoutPassword.username)}&background=random`,
          isActive: true,
          lastSeen: new Date(),
          createdAt: userWithoutPassword.createdAt,
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
    const user = await User.findById(userId);
    if (user) {
      const { password, ...userWithoutPassword } = user;
      liveUserData.push({
        id: userWithoutPassword._id,
        username: userWithoutPassword.username,
        email: userWithoutPassword.email,
        avatar: userWithoutPassword.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userWithoutPassword.username)}&background=random`,
        isActive: true,
        lastSeen: new Date(),
        createdAt: userWithoutPassword.createdAt,
        socketCount: socketInfo.sockets.length
      });
    }
  }
  
  return liveUserData;
}

const server = http.createServer(app);

const io = require('socket.io')(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("New user connected:", socket.id);

  socket.on("authenticate", async (userData) => {
    try {
      // Verify JWT token
      const decoded = jwt.verify(userData.token, 'secretkey');
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
      socket.join(room);
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
            const joinMsg = {
              message: `${user.user.username} joined the chat! 🎉`,
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
      
      // Find the user being kicked
      let targetSocketId = null;
      let targetUserId = null;
      
      for (let [userId, userSockets] of activeUsers) {
        if (userSockets.user && userSockets.user.username === usernameToKick) {
          targetUserId = userId;
          targetSocketId = userSockets.sockets[0]; // Get first socket
          break;
        }
      }
      
      if (targetSocketId && targetUserId) {
        // Get the target socket
        const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.id === targetSocketId);
        
        if (targetSocket) {
          // Check if user has already been kicked from this room
          if (!kickedUsers.has(room)) {
            kickedUsers.set(room, new Set());
          }
          
          const roomKickedUsers = kickedUsers.get(room);
          
          // Only show kick notification if user hasn't been kicked from this room before
          if (!roomKickedUsers.has(targetUserId)) {
            roomKickedUsers.add(targetUserId);
            
            // Remove from room
            targetSocket.leave(room);
            
            // Remove from room tracking
            if (roomJoins.has(room)) {
              roomJoins.get(room).delete(targetUserId);
            }
            
            io.to(room).emit("user_kicked", {
              username: usernameToKick,
              room: room,
              kickedBy: activeUsers.get(socket.userId)?.user?.username || 'Admin'
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
            
            // Send private notification to kicked user
            targetSocket.emit("kicked_notification", {
              room: room,
              message: `You were kicked from ${room}`
            });
            
            console.log(`Successfully kicked ${usernameToKick} from room ${room}`);
          } else {
            console.log(`User ${usernameToKick} already kicked from room ${room}, skipping notification`);
            socket.emit("kick_error", { message: "User has already been kicked from this room" });
          }
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
        time: data.time
      });
      console.log("Message saved to database with _id:", savedMessage._id);
      
      // Broadcast the saved message (includes _id) so clients can use it for reactions
      const broadcastData = {
        ...data,
        _id: savedMessage._id ? savedMessage._id.toString() : data._id,
        reactions: []
      };
      
      console.log("Broadcasting message to room:", data.room);
      io.to(data.room).emit("message", broadcastData);
      console.log("Message broadcasted successfully to all users in room");
    } catch (error) {
      console.error("Error saving message:", error);
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
          // User has no more active connections
          activeUsers.delete(userId);
          
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});