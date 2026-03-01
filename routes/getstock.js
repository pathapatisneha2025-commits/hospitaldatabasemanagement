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