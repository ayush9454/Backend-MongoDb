const mongoose = require('mongoose');

const parkingSpaceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String, required: true },
  capacity: { type: Number, required: true },
  availableSpots: { type: Number, required: true },
  pricePerHour: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ParkingSpace', parkingSpaceSchema); 