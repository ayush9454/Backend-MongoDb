# API v2

Base prefix: `/api`. JSON errors: `{ "error": { "code": "INVALID_INPUT", "message": "...", "fields": {} } }`; `fields` is optional. Internal errors are sanitized. Responses include `X-Request-Id`.

| Method/path                 | Contract                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| POST `/auth/register`       | `{name,email,password}`; email normalized, name 1–100 characters, password at least 8 characters and at most 72 UTF-8 bytes; 201 |
| POST `/auth/login`          | `{email,password}` → `{userId,name,email,token}`; invalid credentials return 401                                                 |
| GET `/auth/me`              | Verified bearer token → `{userId,name,email}`                                                                                    |
| GET `/parking-spaces`       | Array of lots with refreshed `availableSpots` and optional `allocationBlocked`                                                   |
| GET `/parking-spaces/:id`   | Single lot                                                                                                                       |
| POST `/bookings`            | Verified token, `Idempotency-Key` header, `{parkingSpaceId,spotType,durationHours}`; 201 new booking, 200 replay                 |
| GET `/bookings`             | Current user's bookings; optional `status=current`, `page`, `pageSize`                                                           |
| GET `/bookings/history`     | Current user's completed/cancelled bookings; `page`, `pageSize`                                                                  |
| GET `/bookings/summary`     | `{activeBookings,bookedHours,spentPaise}` across the user's complete history                                                     |
| POST `/bookings/:id/cancel` | Owner only; cancelled booking; repeated cancellation returns 200                                                                 |
| POST `/maintenance/expire`  | Separate maintenance bearer secret; expires bookings and reconciles availability                                                 |

Booking lists return `{items,page,pageSize,total}`, newest first with ID as a tie-breaker. Default page size 20; maximum 100. Booking responses include populated `parkingSpaceId`, `parkingId`, `spotType`, timestamps, status, `totalPrice` in rupees for compatibility, integer-paise `pricing`, and structured simulated-payment metadata. Server-priced records snapshot their booked rate. Migrated quotes are marked `legacyQuote` and retain the original amount.

Creation rejects additional fields: the browser cannot submit ownership, price, assigned spot, dates, or payment success. Duration is 1–24 whole hours; start is server time. Spot categories and multipliers live in the shared-contract package (`shared/` in the combined workspace; `vendor/contracts/` in each standalone repository). Lot capacity is shared across all categories. Assignment uses stable `S0001` identifiers and interval overlap checks.

Idempotency keys contain 16–128 letters, digits, hyphens or underscores, scoped to the authenticated user. Retry the same body/key after network or server failure. Reusing a key with different details returns 409. Keys persist with bookings; replay does not create another booking, even after cancellation.

Statuses: active and confirmed can be cancelled; completed cannot. Cancellation changes payment status neither to refunded nor charged: payments are simulated and no refund flow exists. Booked hours exclude cancelled records; spending includes all recorded successful simulated payments, including cancelled bookings.

Authentication failure: 401. Invalid input: 400. Missing or inaccessible record: 404. Allocation, duplicate email, idempotency, or invalid-state conflicts: 409. Rate limits: 429 with Retry-After. Internal details are logged, not returned.

API v2 intentionally removes root route aliases and client user-ID selection. Update consumers together with the frontend.
