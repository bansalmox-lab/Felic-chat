const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const User = require("./User");

// JWT secret key (should be in .env for production)
const JWT_SECRET = "secretkey";

// Register new user
const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return res.status(400).json({ 
        message: "User already exists with this email or username" 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword
    });

    await newUser.save();

    // Generate JWT token
    const token = jwt.sign(
      { id: newUser._id, username: newUser.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "User created successfully",
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email
      }
    });

  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error during registration" });
  }
};

// Login user
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ 
        message: "Invalid email or password" 
      });
    }

    // Compare password
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ 
        message: "Invalid email or password" 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
};

// Verify JWT token
const verifyToken = (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ 
        message: "No token provided" 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();

  } catch (error) {
    return res.status(401).json({ 
      message: "Invalid token" 
    });
  }
};

// Get user profile
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    
    if (!user) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        isActive: user.isActive,
        lastSeen: user.lastSeen,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const { username, email, avatar } = req.body;
    const userId = req.user.id;

    const updateData = {};
    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (avatar) updateData.avatar = avatar;

    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      updateData, 
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }

    res.json({
      message: "Profile updated successfully",
      user: {
        id: updatedUser._id,
        username: updatedUser.username,
        email: updatedUser.email,
        avatar: updatedUser.avatar,
        isActive: updatedUser.isActive,
        lastSeen: updatedUser.lastSeen,
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  register,
  login,
  verifyToken,
  getProfile,
  updateProfile
};
