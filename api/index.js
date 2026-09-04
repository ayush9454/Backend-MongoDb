module.exports = async (req, res) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Or specific origin
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); // Allowed methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allowed headers
    return res.status(204).end(); // No content for preflight success
  }

  if (req.url === '/' && req.method === 'GET') {
    return res.status(200).json({ message: 'Welcome to Smart Parking Management System API' });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.status(200).json({
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
}; 