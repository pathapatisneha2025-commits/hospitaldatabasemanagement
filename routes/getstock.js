const express = require("express");
const router = express.Router();

// 🔹 Use environment variables for URLs and keys
// Example: set in Render dashboard under Environment -> Variables
// TOKEN_SERVICE_URL = https://your-token-service.onrender.com/ws_c2_services_generate_token
// STOCK_SERVICE_URL = https://your-stock-service.onrender.com/ws_c2_services_get_stock_data
// SECURITY_KEY = TUVVek1EQXhNalE9

const TOKEN_SERVICE_URL = process.env.TOKEN_SERVICE_URL;
const STOCK_SERVICE_URL = process.env.STOCK_SERVICE_URL;
const SECURITY_KEY = process.env.SECURITY_KEY;

// 🔹 1️⃣ Generate Token API
router.get("/generate-token", async (req, res) => {
  try {
    if (!TOKEN_SERVICE_URL || !SECURITY_KEY) {
      return res.status(500).json({ error: "Token service not configured" });
    }

    const response = await fetch(TOKEN_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        c2Code: "03C000",
        storeId: "001",
        prodCode: "02",
        securityKey: SECURITY_KEY,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token API returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error("Error generating token:", error.message);
    res.status(500).json({ error: "Token API Failed" });
  }
});

// 🔹 2️⃣ Get Stock Data API
router.get("/get-stock", async (req, res) => {
  try {
    const { apiKey } = req.query;

    if (!apiKey) {
      return res.status(400).json({ error: "apiKey is required" });
    }

    if (!STOCK_SERVICE_URL) {
      return res.status(500).json({ error: "Stock service not configured" });
    }

    const response = await fetch(STOCK_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        c2Code: "03B000",
        storeId: "001",
        prodCode: "02",
        itemCodes: ["711291", "254229"], // You can make this dynamic if needed
        apiKey: apiKey,
      }),
    });

    if (!response.ok) {
      throw new Error(`Stock API returned ${response.status}`);
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error("Error fetching stock:", error.message);
    res.status(500).json({ error: "Stock API Failed" });
  }
});

module.exports = router;