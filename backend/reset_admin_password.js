const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./User');

async function resetPassword() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to DB");
    
    const adminEmail = "bansalmox@gmail.com";
    const newPassword = "43544354";
    
    const user = await User.findOne({ email: adminEmail.toLowerCase() });
    
    if (user) {
      user.password = newPassword;
      await user.save(); // This triggers the pre-save bcrypt hashing hook
      console.log(`Successfully updated password for ${adminEmail}.`);
    } else {
      console.log(`User with email ${adminEmail} not found.`);
    }
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

resetPassword();
