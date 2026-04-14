const express = require("express");
const pool = require("../db");
const router = express.Router();
const { Parser } = require("json2csv");
const ExcelJS = require("exceljs");

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000);
}
router.get("/bus/export", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        om.id,
        om.patient_id,
        om.payment_method,
        om.subtotal,
        om.order_summary,
        om.busdetails
      FROM orders om
      WHERE om.deliverytype = 'bus'
      ORDER BY om.id ASC
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No bus orders found" });
    }

    // FORMAT ROWS
    const formattedRows = result.rows.map((row) => ({
      order_id: row.id,
      patient: row.patient_id,
      payment: row.payment_method,

      items: (row.order_summary || [])
        .map((i) => `${i.name} (x${i.quantity})`)
        .join(", "),

      total: row.subtotal,

      bus: row.busdetails?.busName || "-",
      driver: row.busdetails?.driverName || "-",
    }));

    const fields = [
      { label: "Order ID", value: "order_id" },
      { label: "Patient", value: "patient" },
      { label: "Payment", value: "payment" },
      { label: "Items", value: "items" },
      { label: "Total", value: "total" },
      { label: "Bus", value: "bus" },
      { label: "Driver", value: "driver" },
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(formattedRows);

    const fileName = `bus_orders_${Date.now()}.csv`;

    res.header("Content-Type", "text/csv");
    res.attachment(fileName);
    return res.send(csv);

  } catch (error) {
    console.error("CSV Export Error:", error);
    res.status(500).json({ message: "Failed to export CSV" });
  }
});

router.get("/export-deliveryboy", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        o.id,
        o.patient_id,
        o.payment_method,
        o.subtotal,
        o.order_summary,
        e.full_name AS deliveryboy_name
      FROM orders o
      LEFT JOIN employees e ON o.deliveryboy_id = e.id
      WHERE o.delivery_type = 'normal'
      ORDER BY o.id DESC
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No delivered orders found" });
    }

    // CSV Fields
    const fields = [
      { label: "Order ID", value: "id" },
      { label: "Patient ID", value: "patient_id" },
      { label: "Payment Method", value: "payment_method" },
      { label: "Subtotal", value: "subtotal" },
      { label: "Delivery Boy", value: "deliveryboy_name" },
      { label: "Order Summary", value: row => JSON.stringify(row.order_summary) }
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(result.rows);

    const fileName = `bus_delivered_orders_${Date.now()}.csv`;

    res.header("Content-Type", "text/csv");
    res.attachment(fileName);
    return res.send(csv);

  } catch (error) {
    console.error("CSV Export Error:", error);
    res.status(500).json({ message: "Failed to export CSV" });
  }
});

router.get("/export", async (req, res) => {
  try {
    const result = await pool.query(`
  SELECT
    o.id,
    o.status,
    o.payment_method,
    o.subtotal,
    o.tax,
    o.delivery_fee,
    o.total,
    o.expected_delivery,

    o.address->>'name' AS name,
    REGEXP_REPLACE(COALESCE(o.address->>'mobile',''), '[^0-9]', '', 'g') AS mobile,
    o.address->>'flat' AS flat,
    o.address->>'street' AS street,
    o.address->>'landmark' AS landmark,
    o.address->>'city' AS city,
    o.address->>'state' AS state,
    o.address->>'pincode' AS pincode,

    ARRAY_TO_STRING(
      ARRAY(
        SELECT (m->>'name') || 'x' || (m->>'quantity')::text
        FROM jsonb_array_elements(o.order_summary) AS m
      ), ', '
    ) AS medicines

  FROM orders o
  ORDER BY o.id DESC;
`);


    const fields = [
      { label: "Order ID", value: "id" },
      { label: "Status", value: "status" },
      { label: "Payment", value: "payment_method" },
      { label: "Subtotal", value: "subtotal" },
      { label: "Tax", value: "tax" },
      { label: "Delivery Fee", value: "delivery_fee" },
      { label: "Total", value: "total" },
      { label: "Expected Delivery", value: "expected_delivery" },
      { label: "Patient Name", value: "name" },
      { label: "Mobile", value: "mobile" },
      { label: "Flat", value: "flat" },
      { label: "Street", value: "street" },
      { label: "Landmark", value: "landmark" },
      { label: "City", value: "city" },
      { label: "State", value: "state" },
      { label: "Pincode", value: "pincode" },
      { label: "Medicines", value: "medicines" },
    ];

    // JSON2CSV will automatically wrap values in quotes when needed
    const parser = new Parser({ fields, quote: '"' });
    const csv = parser.parse(result.rows);

    res.header("Content-Type", "text/csv");
    res.attachment(`orders_${Date.now()}.csv`);
    return res.send(csv);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Export failed" });
  }
});

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

    // 2️⃣ Fetch cart items
    const cartRes = await client.query(
      `SELECT id AS cart_id, name, quantity, price
       FROM cart
       WHERE patient_id = $1`,
      [patientId]
    );

    if (cartRes.rowCount === 0) {
      return res.status(400).json({ error: "No items in cart" });
    }

    // 3️⃣ Prepare order summary
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

    const deliveryFee = 40;
    const tax = Math.round(subtotal * 0.05);
    const totalAmount = subtotal + deliveryFee + tax;

    // ✅ 4️⃣ Generate OTP
    const otp = generateOTP();

    // 5️⃣ Insert order WITH OTP
    const insertOrder = `
      INSERT INTO orders (
        patient_id, address_id, address, payment_method,
        expected_delivery, subtotal, delivery_fee, tax, total,
        order_summary, status, otp, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,NOW())
      RETURNING id
    `;

    const orderRes = await client.query(insertOrder, [
      patientId,
      addressId,
      JSON.stringify(address),
      paymentMethod,
      expectedDelivery,
      subtotal,
      deliveryFee,
      tax,
      totalAmount,
      JSON.stringify(orderSummary),
      otp // 👈 OTP stored here
    ]);

    const orderId = orderRes.rows[0].id;

    // 6️⃣ Clear cart
    await client.query("DELETE FROM cart WHERE patient_id = $1", [patientId]);

    await client.query("COMMIT");

    // 7️⃣ Response
    res.status(200).json({
      message: "Order placed successfully",
      order_id: orderId,
      otp, // 👈 send OTP (for now)
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

router.get("/delivery/report", async (req, res) => {
  const { boyId, month } = req.query; // month = "02" for February

  try {
    const query = `
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(item_total), 0) AS total_revenue
      FROM (
        SELECT
          o.id,
          (
            SELECT SUM((item->>'total')::NUMERIC)
            FROM jsonb_array_elements(o.order_summary) AS item
          ) AS item_total
        FROM orders o
        WHERE o.deliveryboy_id = $1
          AND o.status = 'Delivered'
          AND TO_CHAR(o.payment_collected_at, 'MM') = $2
      ) sub;
    `;

    const { rows } = await pool.query(query, [boyId, month]);

    res.json({
      totalOrders: rows[0].total_orders,
      totalRevenue: rows[0].total_revenue,
    
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
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
      amountReceived,
    } = req.body;

    if (!orderId || !deliveryBoyId || !paymentMode) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Determine payment status
    let paymentStatus = "Paid";
    if (paymentMode === "Credit") paymentStatus = "Credit";
    if (paymentMode === "Already Paid") paymentStatus = "Paid";

    // Update the order table WITHOUT changing the status
    const updateOrder = `
      UPDATE orders
      SET 
        payment_collected_by = $1,
        payment_mode = $2,
        amount_received = $3,
        payment_status = $4,
        deliverytype = $5,
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
      message: "Payment collected successfully",
      order: result.rows[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error while updating order" });
  }
});

// POST /order-medicine/verify-otp
router.post("/verify-otp", async (req, res) => {
  const { orderId, otp } = req.body;

  if (!orderId || !otp) {
    return res.status(400).json({ success: false, error: "Order ID and OTP are required" });
  }

  try {
    // Fetch order with patient OTP
    const { rows } = await pool.query(
      `SELECT o.status, p.customer_otp
       FROM orders o
       JOIN patients p ON o.patient_id = p.id
       WHERE o.id = $1`,
      [orderId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const order = rows[0];

    if (order.status === "delivered") {
      return res.status(400).json({ success: false, error: "Order already delivered" });
    }

    if (order.customer_otp !== otp) {
      return res.status(400).json({ success: false, error: "Invalid OTP" });
    }

    // Mark order as delivered
    await pool.query("UPDATE orders SET status='delivered' WHERE id=$1", [orderId]);

    res.json({ success: true, message: "Order marked as delivered ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});
router.post("/mark-delivered", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Order ID is required" });
    }

    const updateStatus = `
      UPDATE orders
      SET status = 'Delivered'
      WHERE id = $1
      RETURNING *;
    `;

    const result = await pool.query(updateStatus, [orderId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      success: true,
      message: "Order marked as delivered",
      order: result.rows[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error while updating order status" });
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
      WHERE o.deliverytype = 'local'
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
router.put("/update/:id", async (req, res) => {
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
router.put("/update-bus-delivery/:id", async (req, res) => {
  try {
    const orderId = req.params.id;
    const { deliveryType, busDetails } = req.body;

    if (!deliveryType || !busDetails) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const query = `
      UPDATE orders SET
        deliverytype = $1,
        busdetails = $2,
        status = 'pending'
      WHERE id = $3
      RETURNING *
    `;

    const values = [
      deliveryType,
      busDetails, // JSON object allowed
      orderId,
    ];

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      message: "Bus delivery updated successfully",
      order: result.rows[0],
    });

  } catch (err) {
    console.error("Bus Delivery Update Error:", err);
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
