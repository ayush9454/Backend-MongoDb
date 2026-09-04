const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/parking_system';

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  if (cached.conn) {
    console.log('Using cached MongoDB connection.');
    return cached.conn;
  }
  if (!cached.promise) {
    console.log('Creating new MongoDB connection...');
    cached.promise = mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }).then((mongoose) => {
      console.log('MongoDB connected successfully!');
      return mongoose;
    }).catch((err) => {
      console.error('MongoDB connection error:', err);
      throw err; // Re-throw the error so the calling function knows it failed
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = dbConnect; 