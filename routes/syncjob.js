const syncSalesOrders = require("./services/syncsalesorder");

(async () => {
  console.log("🚀 Running Render Cron Job...");
  await syncSalesOrders();
  process.exit(0);
})();