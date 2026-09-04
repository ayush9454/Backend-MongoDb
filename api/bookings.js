const dbConnect = require('../utils/db');
const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');

module.exports = async (req, res) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Or specific origin
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allowed headers
    return res.status(204).end(); // No content for preflight success
  }

  await dbConnect();
  if (req.method === 'GET') {
    try {
      const userId = req.query.userId;
      let bookings = await Booking.find({ userId }).populate('parkingSpaceId');
      const now = new Date();
      const expiredIds = bookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled' && b.endTime < now).map(b => b._id);
      if (expiredIds.length > 0) {
        await Booking.updateMany({ _id: { $in: expiredIds } }, { $set: { status: 'completed' } });
        bookings = await Booking.find({ userId }).populate('parkingSpaceId');
      }
      res.status(200).json(bookings);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch bookings' });
    }
  } else if (req.method === 'POST') {
    try {
      const { parkingSpaceId, userId, parkingId, spotType, startTime, endTime, totalPrice, payment } = req.body;
      if (!parkingSpaceId || !userId || !parkingId || !startTime || !endTime || !totalPrice || !payment) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
      if (!parkingSpace || parkingSpace.availableSpots <= 0) {
        return res.status(400).json({ error: 'No available spots' });
      }
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
      res.status(500).json({ error: 'Failed to create booking' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}; 