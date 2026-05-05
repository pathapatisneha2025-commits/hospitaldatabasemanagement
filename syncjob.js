const syncSalesOrders = require("./services/syncsalesorders");

(async () => {
  console.log("🚀 Running Render Cron Job...");
  await syncSalesOrders();
  process.exit(0);
})();