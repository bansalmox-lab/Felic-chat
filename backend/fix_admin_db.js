const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const User = require('./User'); // Assuming this is run from the backend directory

async function fix() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!');

    const email = 'bansalmox@gmail.com';
    const result = await User.updateOne(
      { email: email.toLowerCase() },
      { $set: { isAdmin: true } }
    );

    console.log('Result:', result);
    if (result.matchedCount > 0) {
      console.log(`User ${email} updated successfully.`);
    } else {
      console.log(`User ${email} not found.`);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

fix();
