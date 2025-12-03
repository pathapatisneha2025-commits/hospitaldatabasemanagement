const express = require("express");
const pool = require("../db");
const router = express.Router();

router.post("/checkout", async (req, res) => {
  const { patientId, addressId, paymentMethod, expectedDelivery } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Fetch delivery address
    const addressRes = await client.query(
      "SELECT * FROM delivery_addresses WHERE patient_id = $1 AND id = $2",
      [patientId, addressId]
    );
    if (addressRes.rowCount === 0) {
      return res.status(400).json({ error: "Address not found" });
    }
    const address = addressRes.rows[0];

    // 2️⃣ Fetch cart items for the patient directly
    const cartRes = await client.query(
      `SELECT id AS cart_id, name, quantity, price
       FROM cart
       WHERE patient_id = $1`,
      [patientId]
    );

    if (cartRes.rowCount === 0) {
      return res.status(400).json({ error: "No items in cart" });
    }

    // 3️⃣ Prepare order summary and calculate totals
    let subtotal = 0;
    const orderSummary = cartRes.rows.map(item => {
      const total = (item.price || 0) * (item.quantity || 1);
      subtotal += total;
      return {
        cart_id: item.cart_id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        total,
      };
    });

    const deliveryFee = 40; // fixed delivery fee
    const tax = Math.round(subtotal * 0.05); // 5% tax
    const totalAmount = subtotal + deliveryFee + tax;

    // 4️⃣ Insert order into orders table
    const insertOrder = `
      INSERT INTO orders (
        patient_id, address_id, address, payment_method,
        expected_delivery, subtotal, delivery_fee, tax, total,
        order_summary, status, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending', NOW())
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

    // 5️⃣ Clear cart for the patient
    await client.query("DELETE FROM cart WHERE patient_id = $1", [patientId]);

    await client.query("COMMIT");

    // 6️⃣ Respond with order summary
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
// POST: Collect Payment (store directly in orders table)
router.post("/collect-payment", async (req, res) => {
  try {
    const {
      orderId,
      deliveryBoyId,
      deliveryType,
      paymentMode,
      amount,
      amountReceived,
    } = req.body;

    if (!orderId || !deliveryBoyId || !paymentMode) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Determine payment status
    let paymentStatus = "Paid";
    if (paymentMode === "Credit") paymentStatus = "Credit";
    if (paymentMode === "Already Paid") paymentStatus = "Paid";

    // Update the order table directly
    const updateOrder = `
      UPDATE orders
      SET 
        payment_collected_by = $1,
        payment_mode = $2,
        amount_received = $3,
        payment_status = $4,
        deliverytype = $5,
        status = 'Delivered',
        payment_collected_at = NOW()
      WHERE id = $6
      RETURNING *;
    `;

    const result = await pool.query(updateOrder, [
      deliveryBoyId,
      paymentMode,
      amountReceived || 0,
      paymentStatus,
      deliveryType,
      orderId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      success: true,
      message: "Payment collected & order delivered",
      order: result.rows[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error while updating order" });
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
router.get("/delivered-by-bus", async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM orders
      WHERE deliverytype = 'bus'
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query);

    res.json({ busDeliveredOrders: result.rows });
  } catch (err) {
    console.error("Fetch Bus Delivered Orders Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
// GET: Orders with deliverytype = 'normal' using delivry boy 
router.get("/deliveredby-delivryboy", async (req, res) => {
  try {
    const query = `
      SELECT 
        o.*,
        e.full_name AS deliveryboy_name
      FROM orders o
      LEFT JOIN employees e ON e.id = o.deliveryboy_id
      WHERE o.deliverytype = 'normal'
      ORDER BY o.created_at DESC;
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      count: result.rows.length,
      orders: result.rows
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error fetching normal delivery orders" });
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

// GET /orders/:id - Get order by ID
router.get("/:id", async (req, res) => {

  try {
    const result = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

// Parse JSON fields before sending (optional)
    const order = result.rows[0];
   

    res.status(200).json(order);
  } catch (error) {
    console.error("Get Order by ID Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
router.post("/update/:id", async (req, res) => {
  try {
    const {
      payment_method,
      payment_status,
      payment_mode,
      amount_received,
      deliverytype,
      address
    } = req.body;

    // Fetch existing order
    const oldOrder = await pool.query(
      "SELECT * FROM orders WHERE id = $1",
      [req.params.id]
    );

    if (oldOrder.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Merge address (existing + new)
    let updatedAddress = oldOrder.rows[0].address || {};
    if (address) {
      updatedAddress = { ...updatedAddress, ...address };
    }

    const query = `
      UPDATE orders
      SET 
        payment_method = COALESCE($1, payment_method),
        payment_status = COALESCE($2, payment_status),
        payment_mode = COALESCE($3, payment_mode),
        amount_received = COALESCE($4, amount_received),
        deliverytype = COALESCE($5, deliverytype),
        address = $6
      WHERE id = $7
      RETURNING *
    `;

    const values = [
      payment_method || null,
      payment_status || null,
      payment_mode || null,
      amount_received || null,
      deliverytype || null,
      updatedAddress,
      req.params.id
    ];

    const result = await pool.query(query, values);

    res.json({
      success: true,
      message: "Order updated successfully",
      order: result.rows[0]
    });

  } catch (error) {
    console.error("Update Order Error:", error);
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

    res.json({ message: "Order delet    ed successfully" });
  } catch (error) {
    console.error("Delete Order Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
router.post("/update-bus-delivery", async (req, res) => {
  try {
    const { orderId, deliveryType, busDetails } = req.body;

    if (!orderId || !deliveryType || !busDetails) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const query = `
      UPDATE orders
      SET deliverytype = $1,
          busdetails = $2,
          status = 'pending'
      WHERE id = $3
      RETURNING *
    `;

    const values = [
      deliveryType,
      busDetails, // JSON automatically stored by PG
      orderId,
    ];

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({ message: "Bus delivery details saved", order: result.rows[0] });
  } catch (err) {
    console.error("Bus Delivery Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ✅ POST /update-status
router.post('/update-status', async (req, res) => {
  const { orderId, status } = req.body;

  try {
    await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, orderId]);
    res.status(200).json({ message: "Status updated successfully" });
  } catch (error) {
    console.error("Failed to update status:", error);
    res.status(500).json({ message: "Failed to update status" });
  }
});

module.exports = router;
