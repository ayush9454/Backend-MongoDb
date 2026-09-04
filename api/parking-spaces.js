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
  try {
    console.log('Attempting database connection...');
    await dbConnect();
    console.log('Database connection successful, attempting to fetch parking spaces...');
    const parkingSpaces = await ParkingSpace.find({});
    console.log(`Fetched ${parkingSpaces.length} parking spaces.`);
    res.status(200).json(parkingSpaces);
  } catch (error) {
    console.error('Error in /api/parking-spaces:', error);
    res.status(500).json({ error: 'Failed to fetch parking spaces' });
  }
}; 