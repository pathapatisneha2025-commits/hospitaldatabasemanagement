const express = require("express");
const router = express.Router();
const razorpay = require("../config/razorpay");

// Create Order
router.post("/create-payments", async (req, res) => {
  try {
    const { amount } = req.body;

    const options = {
      amount: amount * 100, // paise
      currency: "INR",
      receipt: "rcpt_" + Date.now(),
    };

    const order = await razorpay.orders.create(options);

    res.status(200).json(order);
  } catch (err) {
    console.log("Create Order Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;s