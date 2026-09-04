const dbConnect = require('../utils/db');
const ParkingSpace = require('../models/ParkingSpace');

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
  const { id } = req.query;
  try {
    const parkingSpace = await ParkingSpace.findById(id);
    if (!parkingSpace) {
      return res.status(404).json({ error: 'Parking space not found' });
    }
    res.status(200).json(parkingSpace);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch parking space' });
  }
}; 