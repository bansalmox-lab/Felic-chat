const mongoose = require("mongoose");
require("dotenv").config();

let useMongoDB = false;
let User = null;

// In-memory user storage for fallback
const tempUsers = new Map();

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  avatar: String,
  isActive: { type: Boolean, default: true },
  lastSeen: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });
    
    User = mongoose.model("User", userSchema);
    useMongoDB = true;
    console.log("✅ MongoDB connected for User model");
    return User;
  } catch (error) {
    console.log("❌ MongoDB Connection Error for User model:", error.message);
    console.log("🔄 Falling back to in-memory user storage...");
    
    // Create in-memory User model
    User = {
      async findOne(query) {
        for (let [id, user] of tempUsers) {
          if (query.email && user.email === query.email) return user;
          if (query.username && user.username === query.username) return user;
          if (query._id && user._id === query._id) return user;
        }
        return null;
      },
      
      async save() {
        const id = this._id || Date.now().toString();
        this._id = id;
        tempUsers.set(id, { ...this });
        return this;
      },
      
      async findById(id) {
        return tempUsers.get(id) || null;
      },
      
      async create(userData) {
        const id = Date.now().toString();
        const user = { ...userData, _id: id };
        tempUsers.set(id, user);
        return user;
      }
    };
    
    useMongoDB = false;
    return User;
  }
};

// Initialize connection
const initUserDB = async () => {
  return await connectDB();
};

module.exports = { initUserDB, User, useMongoDB };
