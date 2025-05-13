const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/parking_system';
mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Connected to MongoDB database');
}).catch((err) => {
    console.error('Error connecting to MongoDB:', err);
});

// Import models
const ParkingSpace = require('./models/ParkingSpace');
const Booking = require('./models/Booking');
const User = require('./models/User');

// Routes
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Smart Parking Management System API' });
});

// Get all parking spaces
app.get('/api/parking-spaces', async (req, res) => {
    try {
        const parkingSpaces = await ParkingSpace.find({});
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
    res.json({ userId: user._id, name: user.name, email: user.email });
  } catch (err) {
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
        const bookings = await Booking.find({ userId }).populate('parkingSpaceId');
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// Get booking history for a user
app.get('/api/bookings/history', async (req, res) => {
    try {
        const userId = req.query.userId;
        const bookings = await Booking.find({ userId, status: { $in: ['cancelled', 'completed'] } }).populate('parkingSpaceId');
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

// Start server
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 