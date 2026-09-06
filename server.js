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
    // Allow all origins (standard for public web APIs)
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
let isConnecting = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (isConnecting) {
    await isConnecting;
    return;
  }

  isConnecting = (async () => {
    let mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      if (process.env.VERCEL) {
        throw new Error('MONGO_URI environment variable is missing in Vercel project settings!');
      }
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

    if (mongoUri && mongoUri.includes('.mongodb.net/?')) {
      mongoUri = mongoUri.replace('.mongodb.net/?', '.mongodb.net/parking_system?');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
    });
    console.log('Connected to MongoDB database successfully');

    // Auto-seed initial parking spaces if empty
    try {
      const count = await ParkingSpace.countDocuments();
      if (count === 0) {
        console.log('No parking spaces found. Seeding initial parking spaces...');
        const sampleParkingSpaces = require('./seed-data');
        await ParkingSpace.insertMany(sampleParkingSpaces);
        console.log(`Auto-seeded ${sampleParkingSpaces.length} parking spaces.`);
      }
    } catch (seedErr) {
      console.error('Auto-seed check error:', seedErr.message);
    }

    // Auto-reconcile and heal parking spot availability
    await reconcileAvailableSpots();
  })();

  try {
    await isConnecting;
  } finally {
    isConnecting = null;
  }
}

// Function to sync expired bookings and restore parking spot availability
async function syncExpiredBookings() {
  try {
    const now = new Date();
    const expiredBookings = await Booking.find({
      status: { $in: ['active', 'confirmed'] },
      endTime: { $lt: now }
    });
    if (expiredBookings.length > 0) {
      for (const booking of expiredBookings) {
        booking.status = 'completed';
        await booking.save();
      }
    }
  } catch (err) {
    console.error('Error syncing expired bookings:', err.message);
  }
}

// Function to recalculate available spots based on actual active bookings
async function reconcileAvailableSpots() {
  try {
    await syncExpiredBookings();
    const now = new Date();
    const spaces = await ParkingSpace.find({});
    for (const space of spaces) {
      const activeCount = await Booking.countDocuments({
        parkingSpaceId: space._id,
        status: { $in: ['active', 'confirmed'] },
        endTime: { $gte: now }
      });
      const correctAvailable = Math.max(0, space.capacity - activeCount);
      if (space.availableSpots !== correctAvailable) {
        space.availableSpots = correctAvailable;
        await space.save();
      }
    }
  } catch (err) {
    console.error('Error reconciling available spots:', err.message);
  }
}

// Periodic background sync every 60 seconds
setInterval(reconcileAvailableSpots, 60000);

// Health check roots (work immediately without DB wait)
app.get(['/', '/api'], (req, res) => {
  res.json({
    message: 'Smart Parking Management System API is running',
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

// Middleware: ensure database is connected before processing API requests
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection error in middleware:', err.message);
    return res.status(500).json({ error: 'Database connection failed: ' + err.message });
  }
});

// Router for all API routes
const apiRouter = express.Router();

// Get all parking spaces
apiRouter.get('/parking-spaces', async (req, res) => {
  try {
    await reconcileAvailableSpots();
    console.log('Fetching all parking spaces...');
    const parkingSpaces = await ParkingSpace.find({});
    console.log(`Found ${parkingSpaces.length} parking spaces`);
    res.json(parkingSpaces);
  } catch (error) {
    console.error('Error fetching parking spaces:', error);
    res.status(500).json({ error: 'Failed to fetch parking spaces: ' + error.message });
  }
});

// Get a single parking space
apiRouter.get('/parking-spaces/:id', async (req, res) => {
  try {
    const parkingSpace = await ParkingSpace.findById(req.params.id);
    if (!parkingSpace) {
      return res.status(404).json({ error: 'Parking space not found' });
    }
    res.json(parkingSpace);
  } catch (error) {
    console.error('Error fetching parking space:', error);
    res.status(500).json({ error: 'Failed to fetch parking space: ' + error.message });
  }
});

// Register new user
apiRouter.post('/auth/register', async (req, res) => {
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
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// Login user
apiRouter.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'User Not Found' });
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Wrong Password!' });
    
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
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// Create a booking
apiRouter.post('/bookings', async (req, res) => {
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
    res.status(500).json({ error: 'Failed to create booking: ' + error.message });
  }
});

// Get all bookings for a user
apiRouter.get('/bookings', async (req, res) => {
  try {
    await reconcileAvailableSpots();
    const userId = req.query.userId;
    const bookings = await Booking.find({ userId }).populate('parkingSpaceId');
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bookings: ' + error.message });
  }
});

// Get booking history for a user
apiRouter.get('/bookings/history', async (req, res) => {
  try {
    await reconcileAvailableSpots();
    const userId = req.query.userId;
    const allBookings = await Booking.find({ userId }).populate('parkingSpaceId');
    const bookings = allBookings.filter(b => b.status === 'completed' || b.status === 'cancelled');
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch booking history: ' + error.message });
  }
});

// Cancel a booking
apiRouter.post('/bookings/:id/cancel', async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
    // Increment availableSpots
    await ParkingSpace.findByIdAndUpdate(booking.parkingSpaceId, { $inc: { availableSpots: 1 } });
    res.json(booking);
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel booking: ' + error.message });
  }
});

// Mount routes under both /api and root (supports any frontend configuration)
app.use('/api', apiRouter);
app.use('/', apiRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
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
  connectDB().catch(e => console.error('Initial connectDB error:', e.message));
}

module.exports = app;
