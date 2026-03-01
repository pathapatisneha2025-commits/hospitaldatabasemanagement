const express = require("express");
const router = express.Router();

// 🔹 1️⃣ Generate Token API
router.get("/generate-token", async (req, res) => {
  try {
    const response = await fetch(
      "http://localhost:44000/ws_c2_services_generate_token",
      {
        method: "POST", // ✅ changed to POST
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          c2Code: "03C000",
          storeId: "001",
          prodCode: "02",
          securityKey: "TUVVek1EQXhNalE9",
        }),
      }
    );

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

    const response = await fetch(
      "http://localhost:45000/ws_c2_services_get_stock_data",
      {
        method: "POST", // ✅ changed to POST
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          c2Code: "03B000",
          storeId: "001",
          prodCode: "02",
          itemCodes: ["711291", "254229"],
          apiKey: apiKey,
        }),
      }
    );

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