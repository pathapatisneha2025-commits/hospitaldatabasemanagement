const syncSalesOrders = require("./services/syncsalesorder");
const syncSalesInvoices=require("./services/syncsalesinvoices")

(async () => {
  console.log("🚀 Running Render Cron Job...");
  await syncSalesOrders();
  process.exit(0);
})();