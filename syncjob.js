const syncSalesOrders = require("./services/syncsalesorder");
const syncSalesInvoices=require("./services/salesinvoice");

(async () => {
  console.log("🚀 Running Render Cron Job...");
  await syncSalesOrders();
  process.exit(0);
})();