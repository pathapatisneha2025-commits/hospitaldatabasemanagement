const express = require("express");
const router = express.Router();

// 🔹 1️⃣ Generate Token API
router.get("/ws_c2_services_generate_token", (req, res) => {
  // Get JSON body
  const { c2Code, storeId, prodCode, securityKey } = req.body;

  // Basic validation
  if (!c2Code || !storeId || !prodCode || !securityKey) {
    return res.status(400).json({ code: "400", message: "Missing fields" });
  }

  // Here you can generate a token dynamically
  // For demo, just encode c2Code+storeId+prodCode+securityKey in Base64
  const token = Buffer.from(`${c2Code}|${storeId}|${prodCode}|${securityKey}`).toString("base64");

  return res.json({
    code: "200",
    type: "generateToken",
    apiKey: token
  });
});


// 🔹 2️⃣ Get Stock Data API
const allStockData = [
  {
    c_item_code: "711291",
    itemName: "ME BEAUTY WATERMELON DRINK",
    itemQtyPerBox: 1,
    batchNo: "66E67E78E",
    stockBalQty: 40,
    expiryDate: "2029-09-01"
  },
  {
    c_item_code: "711291",
    itemName: "ME BEAUTY WATERMELON DRINK",
    itemQtyPerBox: 1,
    batchNo: "8927308273091802OI3U2OU380289730297",
    stockBalQty: 10,
    expiryDate: "2029-09-01"
  },
  {
    c_item_code: "711291",
    itemName: "ME BEAUTY WATERMELON DRINK",
    itemQtyPerBox: 1,
    batchNo: "2020",
    stockBalQty: 1631,
    expiryDate: "2029-08-01"
  },
  {
    c_item_code: "254229",
    itemName: "1 AL 10MG TAB",
    itemQtyPerBox: 10,
    batchNo: "89898",
    stockBalQty: 19099,
    expiryDate: "2029-09-01"
  }
];

// 🔹 Push Stock Data API
// Method: GET
// URL: /ws_c2_services_get_stock_data
router.get("/ws_c2_services_get_stock_data", (req, res) => {
  // Extract query parameters
  const { c2Code, storeId, prodCode, itemCodes, apiKey } = req.query;

  if (!c2Code || !storeId || !prodCode || !itemCodes || !apiKey) {
    return res.status(400).json({ code: "400", message: "Missing or invalid fields" });
  }

  // Convert itemCodes to array if sent as comma-separated string
  let itemCodesArray = Array.isArray(itemCodes)
    ? itemCodes
    : itemCodes.split(",");

  // Filter stock data based on requested item codes
  const filteredStock = allStockData.filter(stock =>
    itemCodesArray.includes(stock.c_item_code)
  );

  return res.json({
    code: "200",
    type: "getMasterData",
    data: filteredStock
  });
});



module.exports = router;