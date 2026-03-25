const mongoose = require('mongoose');

// Constructed direct replica set URI from SRV records without hardcoded replicaSet
const uri = "mongodb://bansalmox_db_user:43544354@ac-eiy0j4v-shard-00-00.gojruoc.mongodb.net:27017,ac-eiy0j4v-shard-00-01.gojruoc.mongodb.net:27017,ac-eiy0j4v-shard-00-02.gojruoc.mongodb.net:27017/felicchat?ssl=true&authSource=admin&retryWrites=true&w=majority&appName=Felicmedia2";

mongoose.connect(uri)
  .then(() => {
    console.log("Successfully connected to MongoDB Atlas using direct URI!");
    process.exit(0);
  })
  .catch(err => {
    console.error("Failed to connect:");
    console.error(err);
    process.exit(1);
  });
