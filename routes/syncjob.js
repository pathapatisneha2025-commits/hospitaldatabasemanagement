const syncSalesOrders = require("./services/syncSalesOrders");

(async () => {
  console.log("🚀 Running Render Cron Job...");
  await syncSalesOrders();
  process.exit(0);
})();