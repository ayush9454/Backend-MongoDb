const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Load environment variables
dotenv.config();

const app = express();

// Import models
const ParkingSpace = require('./models/ParkingSpace');
const Booking = require('./models/Booking');
const User = require('./models/User');

// Middleware
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin === 'https://frontend-mongo-xi.vercel.app'
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
let mongodServer = null;

async function connectDB() {
  let mongoUri = process.env.MONGO_URI;
  if (!mongoUri || mongoUri.includes('cluster0.vwdb6k1.mongodb.net')) {
    try {
      console.log('Starting embedded local MongoDB instance (data persisted in .mongo_data)...');
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const path = require('path');
      const fs = require('fs');
      const dbDir = path.join(__dirname, '.mongo_data');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      mongodServer = await MongoMemoryServer.create({
        instance: { dbPath: dbDir }
      });
      mongoUri = mongodServer.getUri();
      console.log('Embedded MongoDB running at:', mongoUri);
    } catch (memErr) {
      console.warn('Could not start embedded MongoDB, falling back to local MongoDB URI:', memErr.message);
      mongoUri = 'mongodb://127.0.0.1:27017/parking_system';
    }
  }

  try {
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB database successfully');

    // Auto-seed initial parking spaces if empty
    const count = await ParkingSpace.countDocuments();
    if (count === 0) {
      console.log('No parking spaces found. Seeding initial parking spaces...');
      const sampleParkingSpaces = require('./seed-data');
      await ParkingSpace.insertMany(sampleParkingSpaces);
      console.log(`Auto-seeded ${sampleParkingSpaces.length} parking spaces.`);
    }
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
  }
}


// Root route
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Smart Parking Management System API' });
});

// API root route
app.get('/api', (req, res) => {
    res.json({ 
        message: 'Smart Parking API is running',
        endpoints: {
            parkingSpaces: '/api/parking-spaces',
            auth: {
                login: '/api/auth/login',
                register: '/api/auth/register'
            },
            bookings: '/api/bookings'
        }
    });
});

// Get all parking spaces
app.get('/api/parking-spaces', async (req, res) => {
    try {
        console.log('Fetching all parking spaces...');
        const parkingSpaces = await ParkingSpace.find({});
        console.log(`Found ${parkingSpaces.length} parking spaces`);
        res.json(parkingSpaces);
    } catch (error) {
        console.error('Error fetching parking spaces:', error);
        res.status(500).json({ error: 'Failed to fetch parking spaces' });
    }
});

// Get a single parking space
app.get('/api/parking-spaces/:id', async (req, res) => {
    try {
        const parkingSpace = await ParkingSpace.findById(req.params.id);
        if (!parkingSpace) {
            return res.status(404).json({ error: 'Parking space not found' });
        }
        res.json(parkingSpace);
    } catch (error) {
        console.error('Error fetching parking space:', error);
        res.status(500).json({ error: 'Failed to fetch parking space' });
    }
});

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed });
    await user.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });
    
    // Create JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'parking_secret_key_2026_secure',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    
    res.json({
      userId: user._id,
      name: user.name,
      email: user.email,
      token: token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Create a booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { parkingSpaceId, userId, parkingId, spotType, startTime, endTime, totalPrice, payment } = req.body;
    if (!parkingSpaceId || !userId || !parkingId || !startTime || !endTime || !totalPrice || !payment) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Check if parking space has available spots
    const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
    if (!parkingSpace || parkingSpace.availableSpots <= 0) {
      return res.status(400).json({ error: 'No available spots' });
    }
    // Decrement availableSpots for the parking space
    await ParkingSpace.findByIdAndUpdate(parkingSpaceId, { $inc: { availableSpots: -1 } });
    const booking = new Booking({
      parkingSpaceId,
      userId,
      parkingId,
      spotType,
      parkingLotName: parkingSpace.name,
      startTime,
      endTime,
      totalPrice,
      payment,
      status: 'active'
    });
    await booking.save();
    res.status(201).json(booking);
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Get all bookings for a user
app.get('/api/bookings', async (req, res) => {
    try {
        const userId = req.query.userId;
        // Find all bookings for the user
        let bookings = await Booking.find({ userId }).populate('parkingSpaceId');
        const now = new Date();
        // Update expired bookings to completed
        const expiredIds = bookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled' && b.endTime < now).map(b => b._id);
        if (expiredIds.length > 0) {
            await Booking.updateMany({ _id: { $in: expiredIds } }, { $set: { status: 'completed' } });
            // Re-fetch bookings to get updated statuses
            bookings = await Booking.find({ userId }).populate('parkingSpaceId');
        }
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// Get booking history for a user
app.get('/api/bookings/history', async (req, res) => {
    try {
        const userId = req.query.userId;
        // Also update expired bookings to completed
        let allBookings = await Booking.find({ userId }).populate('parkingSpaceId');
        const now = new Date();
        const expiredIds = allBookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled' && b.endTime < now).map(b => b._id);
        if (expiredIds.length > 0) {
            await Booking.updateMany({ _id: { $in: expiredIds } }, { $set: { status: 'completed' } });
            allBookings = await Booking.find({ userId }).populate('parkingSpaceId');
        }
        // Only return completed/cancelled
        const bookings = allBookings.filter(b => b.status === 'completed' || b.status === 'cancelled');
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch booking history' });
    }
});

// Cancel a booking
app.post('/api/bookings/:id/cancel', async (req, res) => {
    try {
        const booking = await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
        // Increment availableSpots
        await ParkingSpace.findByIdAndUpdate(booking.parkingSpaceId, { $inc: { availableSpots: 1 } });
        res.json(booking);
    } catch (error) {
        res.status(500).json({ error: 'Failed to cancel booking' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 5050;

async function startServer() {
  await connectDB();
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log('\nShutting down server...');
    server.close(async () => {
      await mongoose.disconnect();
      if (mongodServer) {
        await mongodServer.stop();
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  startServer();
} else {
  connectDB();
}

module.exports = app;
