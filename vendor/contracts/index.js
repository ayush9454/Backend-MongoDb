const SPOT_TYPES = Object.freeze([
  { value: "normal", label: "Normal", multiplier: 1 },
  { value: "vip", label: "VIP", multiplier: 2 },
  { value: "car", label: "Car", multiplier: 1 },
  { value: "bike", label: "Bike", multiplier: 0.5 },
  { value: "electric", label: "Electric", multiplier: 1.2 },
  { value: "handicapped", label: "Accessible", multiplier: 0.8 },
]);
const STATUS_LABELS = Object.freeze({
  pending: "Pending",
  active: "Active",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
});
module.exports = { SPOT_TYPES, STATUS_LABELS };
