const express = require("express");
const pool = require("../db");
const router = express.Router();

router.post("/checkout", async (req, res) => {
  const { patientId, addressId, paymentMethod, expectedDelivery } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ✅ 1. Fetch address
    const addressRes = await client.query(
      "SELECT * FROM  delivery_addresses WHERE patient_id = $1 AND id = $2",
      [patientId, addressId]
    );
    if (addressRes.rowCount === 0) {
      return res.status(400).json({ error: "Address not found" });
    }
    const address = addressRes.rows[0];

    // ✅ 2. Fetch cart items (join with medicines table for details)
    const cartRes = await client.query(
      `SELECT c.id AS cart_id, c.quantity, 
              m.id AS medicine_id, m.name, m.price
       FROM cart c
       JOIN medicines m ON c.medicine_id = m.id
       WHERE c.patient_id = $1`,
      [patientId]
    );
    if (cartRes.rowCount === 0) {
      return res.status(400).json({ error: "No items in cart" });
    }

    // ✅ 3. Prepare order summary
    const orderSummary = [];
    let subtotal = 0;

    for (const item of cartRes.rows) {
      const itemTotal = (item.price || 0) * (item.quantity || 1);
      subtotal += itemTotal;
      orderSummary.push({
        medicine_id: item.medicine_id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        total: itemTotal,
      });
    }

    const deliveryFee = 40;
    const tax = Math.round(subtotal * 0.05); // 5% GST for example
    const totalAmount = subtotal + deliveryFee + tax;

    // ✅ 4. Insert order (store orderSummary JSON in one row)
    const insertOrder = `
      INSERT INTO orders (
        patient_id, address_id, address, payment_method,
        expected_delivery, subtotal, delivery_fee, tax, total,
        order_summary, status, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'processing', NOW())
      RETURNING id
    `;

    const orderRes = await client.query(insertOrder, [
      patientId,
      addressId,
      JSON.stringify(address), // full address snapshot
      paymentMethod,
      expectedDelivery,
      subtotal,
      deliveryFee,
      tax,
      totalAmount,
      JSON.stringify(orderSummary),
    ]);

    const orderId = orderRes.rows[0].id;

    // ✅ 5. Clear cart after order
    await client.query("DELETE FROM cart WHERE patient_id = $1", [patientId]);

    await client.query("COMMIT");
    res.status(200).json({
      message: "Order placed successfully",
      order_id: orderId,
      address,
      orderSummary,
      subtotal,
      deliveryFee,
      tax,
      totalAmount,
      paymentMethod,
      expectedDelivery,
      status: "processing",
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Checkout Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});


router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Get Orders Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
router.get("/patient/:patientId", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders WHERE patient_id = $1 ORDER BY created_at DESC",
      [req.params.patientId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Get Patient Orders Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


router.delete("/delete/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM orders WHERE id = $1 RETURNING *", [
      req.params.id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.error("Delete Order Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = router;
