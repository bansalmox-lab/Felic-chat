const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

mongoose.connect(uri)
  .then(() => {
    console.log("Successfully connected to MongoDB Atlas!");
    process.exit(0);
  })
  .catch(err => {
    console.error("Failed to connect:");
    console.error(err);
    process.exit(1);
  });
