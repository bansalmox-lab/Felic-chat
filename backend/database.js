const mongoose = require("mongoose");
require("dotenv").config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });
    console.log("MongoDB Connected Successfully");
  } catch (error) {
    console.error("MongoDB Connection Error:", error.message);
    console.log("Falling back to in-memory storage...");
    // Fallback to in-memory storage if MongoDB fails
    return false;
  }
};

// Try to connect
const isConnected = connectDB();

const messageSchema = new mongoose.Schema({
  room: String,
  author: String,
  message: String,
  time: String,
  fileUrl: String,
  fileName: String,
  fileType: String,
  reactions: [
    {
      emoji: String,
      username: String,
      timestamp: { type: Date, default: Date.now }
    }
  ],
  linkPreview: {
    title: String,
    description: String,
    image: String,
    url: String,
    siteName: String
  },
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model("Message", messageSchema);

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String
});

const User = mongoose.model("User", userSchema);

const channelSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  createdBy: { type: String, default: 'System' },
  createdAt: { type: Date, default: Date.now }
});

const Channel = mongoose.model("Channel", channelSchema);

module.exports = { Message, User, Channel };