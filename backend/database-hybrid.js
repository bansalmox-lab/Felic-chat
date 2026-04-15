const mongoose = require("mongoose");
require("dotenv").config();
const tempStorage = require("./temp-storage");

let useMongoDB = false;
let Message = tempStorage; // Default to temp storage
let mongoConnectAttempts = 0;
const MAX_RETRIES = 3;

// Define schema once so it can be reused on retry
const messageSchema = new mongoose.Schema({
  room: String,
  author: String,
  message: String,
  time: String,
  fileUrl: String,
  fileName: String,
  fileType: String,
  reactions: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

let MongoMessage = null;

const connectDB = async () => {
  mongoConnectAttempts++;
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      maxPoolSize: 5,
      retryWrites: true
    });

    // Only create the model once
    if (!MongoMessage) {
      try {
        MongoMessage = mongoose.model("Message");
      } catch (e) {
        MongoMessage = mongoose.model("Message", messageSchema);
      }
    }

    Message = MongoMessage;
    useMongoDB = true;
    console.log("✅ MongoDB Connected Successfully (attempt " + mongoConnectAttempts + ")");
  } catch (error) {
    console.error("❌ MongoDB Connection Error (attempt " + mongoConnectAttempts + "):", error.message);
    if (mongoConnectAttempts < MAX_RETRIES) {
      const delay = mongoConnectAttempts * 3000;
      console.log(`🔄 Retrying in ${delay / 1000}s...`);
      setTimeout(connectDB, delay);
    } else {
      console.log("🔄 Max retries reached. Falling back to in-memory storage...");
      Message = tempStorage;
      useMongoDB = false;
    }
  }
};

// Handle reconnection on disconnection
mongoose.connection.on('disconnected', () => {
  if (useMongoDB) {
    console.log("⚠️ MongoDB disconnected. Attempting to reconnect...");
    useMongoDB = false;
    Message = tempStorage;
    mongoConnectAttempts = 0;
    setTimeout(connectDB, 3000);
  }
});

mongoose.connection.on('reconnected', () => {
  console.log("✅ MongoDB reconnected!");
  useMongoDB = true;
  if (MongoMessage) Message = MongoMessage;
});

// Initialize connection
connectDB();

const DBWrapper = {
  find: (...args) => Message.find(...args),
  create: (...args) => Message.create(...args),
  findByIdAndUpdate: (...args) => {
    if (useMongoDB && !mongoose.Types.ObjectId.isValid(args[0])) return Promise.resolve(null);
    return Message.findByIdAndUpdate(...args);
  },
  findByIdAndDelete: (...args) => {
    if (useMongoDB && !mongoose.Types.ObjectId.isValid(args[0])) return Promise.resolve(null);
    return Message.findByIdAndDelete(...args);
  },
};

module.exports = DBWrapper;
