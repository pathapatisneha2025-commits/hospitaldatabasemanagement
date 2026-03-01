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
router.post("/ ws_c2_services_get_stock_data ", (req, res) => {
  try {
    const { c2Code, storeId, prodCode, itemCodes } = req.body;

    if (!c2Code || !storeId || !prodCode || !itemCodes || !Array.isArray(itemCodes)) {
      return res.status(400).json({ error: "Missing or invalid fields" });
    }

    // Here you can generate your API key dynamically if needed
    const apiKey = "MDNCMDAwMDAxXjIwMjYtMDItMTIgMTE6NTI="; // static example

    // Build the payload
    const payload = {
      c2Code,
      storeId,
      prodCode,
      itemCodes,
      apiKey,
    };

    // Directly return payload (no external request)
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Error generating stock payload:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});


module.exports = router;