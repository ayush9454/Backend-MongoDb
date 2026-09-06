const dbConnect = require('../utils/db');
const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');

module.exports = async (req, res) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Or specific origin
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allowed headers
    return res.status(204).end(); // No content for preflight success
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await dbConnect();
    // Sync expired bookings and heal spot availability
    const now = new Date();
    const expiredBookings = await Booking.find({
      status: { $in: ['active', 'confirmed'] },
      endTime: { $lt: now }
    });
    for (const booking of expiredBookings) {
      booking.status = 'completed';
      await booking.save();
    }
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

    const parkingSpaces = await ParkingSpace.find({});
    res.status(200).json(parkingSpaces);
  } catch (error) {
    console.error('Error in /api/parking-spaces:', error);
    res.status(500).json({ error: 'Failed to fetch parking spaces' });
  }
}; 