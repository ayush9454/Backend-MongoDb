export type SpotType =
  "normal" | "vip" | "car" | "bike" | "electric" | "handicapped";
export type BookingStatus =
  "pending" | "active" | "confirmed" | "completed" | "cancelled";
export const SPOT_TYPES: ReadonlyArray<{
  value: SpotType;
  label: string;
  multiplier: number;
}>;
export const STATUS_LABELS: Readonly<Record<BookingStatus, string>>;
export interface User {
  userId: string;
  name: string;
  email: string;
}
export interface ParkingSpace {
  _id: string;
  name: string;
  location: string;
  capacity: number;
  availableSpots: number;
  pricePerHour: number;
  allocationBlocked?: boolean;
}
export interface Pricing {
  currency: "INR";
  baseRatePaise: number;
  ratePaise: number;
  multiplier: number;
  durationHours: number;
  amountPaise: number;
  legacyQuote?: boolean;
}
export interface Booking {
  _id: string;
  userId: string;
  parkingSpaceId: ParkingSpace | null;
  parkingId: string;
  spotType: SpotType;
  parkingLotName: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  totalPrice: number;
  pricing: Pricing;
  payment: {
    method: "simulated";
    status: "success" | "legacy";
    reference?: string;
  };
  cancelledAt?: string;
}
export interface BookingRequest {
  parkingSpaceId: string;
  spotType: SpotType;
  durationHours: number;
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
export interface BookingSummary {
  activeBookings: number;
  bookedHours: number;
  spentPaise: number;
}
