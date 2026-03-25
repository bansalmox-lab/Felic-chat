const mongoose = require("mongoose");
require("dotenv").config();
const tempStorage = require("./temp-storage");

let useMongoDB = false;
let Message = tempStorage; // Default to temp storage

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });
    
    const messageSchema = new mongoose.Schema({
      room: String,
      author: String,
      message: String,
      time: String,
      createdAt: { type: Date, default: Date.now }
    });
    
    const MongoMessage = mongoose.model("Message", messageSchema);
    Message = MongoMessage;
    useMongoDB = true;
    console.log("✅ MongoDB Connected Successfully");
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
    console.log("🔄 Falling back to in-memory storage...");
    Message = tempStorage;
    useMongoDB = false;
  }
};

// Initialize connection
connectDB();

const DBWrapper = {
  find: (...args) => Message.find(...args),
  create: (...args) => Message.create(...args),
  findByIdAndUpdate: (...args) => Message.findByIdAndUpdate(...args),
};

module.exports = DBWrapper;
