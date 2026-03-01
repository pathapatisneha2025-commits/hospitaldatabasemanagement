const express = require("express");
const router = express.Router();

const TOKEN_API_URL = process.env.TOKEN_API_URL;
const STOCK_API_URL = process.env.STOCK_API_URL;

// 🔹 Generate Token
router.post("/generate-token", async (req, res) => {
  try {
    const response = await fetch(TOKEN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        c2Code: "03C000",
        storeId: "001",
        prodCode: "02",
        securityKey: "TUVVek1EQXhNalE9",
      }),
    });

    if (!response.ok) throw new Error(`Token API returned ${response.status}`);

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error("Error generating token:", error.message);
    res.status(500).json({ error: "Token API Failed" });
  }
});

// 🔹 Get Stock Data
router.post("/get-stock", async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: "apiKey is required" });

    const response = await fetch(STOCK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        c2Code: "03B000",
        storeId: "001",
        prodCode: "02",
        itemCodes: ["711291", "254229"],
        apiKey,
      }),
    });

    if (!response.ok) throw new Error(`Stock API returned ${response.status}`);

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error("Error fetching stock:", error.message);
    res.status(500).json({ error: "Stock API Failed" });
  }
});

module.exports = router;