const dbConnect = require('../utils/db');
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
  await dbConnect();
  const userId = req.query.userId;
  try {
    let allBookings = await Booking.find({ userId }).populate('parkingSpaceId');
    const now = new Date();
    const expiredIds = allBookings.filter(b => b.status !== 'completed' && b.status !== 'cancelled' && b.endTime < now).map(b => b._id);
    if (expiredIds.length > 0) {
      await Booking.updateMany({ _id: { $in: expiredIds } }, { $set: { status: 'completed' } });
      allBookings = await Booking.find({ userId }).populate('parkingSpaceId');
    }
    const bookings = allBookings.filter(b => b.status === 'completed' || b.status === 'cancelled');
    res.status(200).json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch booking history' });
  }
}; 