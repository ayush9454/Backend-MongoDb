const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  parkingSpaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSpace', required: true },
  userId: { type: String, required: true },
  parkingId: { type: String, required: true },
  spotType: { type: String, required: true },
  parkingLotName: { type: String, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  totalPrice: { type: Number, required: true },
  payment: { type: Object, required: true },
  status: { type: String, enum: ['pending', 'active', 'confirmed', 'cancelled', 'completed'], default: 'active' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', bookingSchema); 