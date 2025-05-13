const mongoose = require('mongoose');
const ParkingSpace = require('./models/ParkingSpace');

const sampleParkingSpaces = [
  {
    name: "Downtown Parking",
    location: "123 Main Street, Downtown",
    capacity: 100,
    availableSpots: 100,
    pricePerHour: 50
  },
  {
    name: "Mall Parking",
    location: "456 Shopping Avenue",
    capacity: 200,
    availableSpots: 200,
    pricePerHour: 40
  },
  {
    name: "Airport Parking",
    location: "789 Airport Road",
    capacity: 500,
    availableSpots: 500,
    pricePerHour: 60
  },
  {
    name: "Station Parking",
    location: "321 Railway Station Road",
    capacity: 150,
    availableSpots: 150,
    pricePerHour: 35
  },
  {
    name: "City Center Parking",
    location: "101 City Center Blvd",
    capacity: 250,
    availableSpots: 250,
    pricePerHour: 55
  },
  {
    name: "Tech Park Parking",
    location: "202 Silicon Avenue",
    capacity: 300,
    availableSpots: 300,
    pricePerHour: 45
  },
  {
    name: "Hospital Parking",
    location: "303 Health Street",
    capacity: 120,
    availableSpots: 120,
    pricePerHour: 30
  },
  {
    name: "University Parking",
    location: "404 College Road",
    capacity: 180,
    availableSpots: 180,
    pricePerHour: 38
  }
];

const seedDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb+srv://singhayush9454:ayush9454@cluster0.vwdb6k1.mongodb.net/parking_system?retryWrites=true&w=majority&appName=Cluster0/parking_system', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    // Clear existing data
    await ParkingSpace.deleteMany({});

    // Insert sample data
    await ParkingSpace.insertMany(sampleParkingSpaces);

    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase(); 
