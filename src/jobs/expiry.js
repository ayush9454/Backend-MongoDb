const { reconcileAvailableSpots } = require("../services/bookings");
function startExpiryJob() {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await reconcileAvailableSpots();
    } catch (err) {
      console.error(
        JSON.stringify({ level: "error", job: "expiry", message: err.message }),
      );
    } finally {
      busy = false;
    }
  }, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { startExpiryJob };
