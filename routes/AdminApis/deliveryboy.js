const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken"); // 👈 for login tokens
const pool = require("../../db");
const multer = require("multer");
const path = require("path");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../../cloudinary");
const admin = require("../../firebase"); // Firebase Admin SDK

const router = express.Router();

// Cloudinary multer config
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "delivery_boys", // Cloudinary folder
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });

// ---------------- REGISTER ----------------
router.post(
  "/register",
  upload.fields([{ name: "profile_pic" }, { name: "bike_photo" }]),
  async (req, res) => {
    const { name, phone, email, address, bike_number, password, confirmPassword } = req.body;

    // 1️⃣ Validate passwords
    if (!password || !confirmPassword) {
      return res.status(400).json({ error: "Password and confirm password are required" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    // 2️⃣ Cloudinary URLs
    const profilePicUrl = req.files?.profile_pic?.[0]?.path || null;
    const bikePhotoUrl = req.files?.bike_photo?.[0]?.path || null;

    try {
      // 3️⃣ Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // 4️⃣ Insert into DB
      const result = await pool.query(
        `INSERT INTO delivery_boys 
        (name, phone, email, address, profile_pic, bike_number, bike_photo, password, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available')
         RETURNING id, name, phone, email, address, profile_pic, bike_number, bike_photo, status`,
        [
          name,
          phone,
          email,
          address,
          profilePicUrl,
          bike_number,
          bikePhotoUrl,
          hashedPassword,
        ]
      );

      res.status(201).json({ message: "Registration successful", deliveryBoy: result.rows[0] });
    } catch (err) {
      console.error("Error registering delivery boy:", err);
      res.status(500).json({ error: "Failed to register delivery boy" });
    }
  }
);

// ---------------- LOGIN ----------------
// ---------------- LOGIN ----------------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1️⃣ Find user by email
    const result = await pool.query(
      "SELECT * FROM delivery_boys WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    // 2️⃣ Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // 3️⃣ Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || "secretkey",
      { expiresIn: "7d" }
    );

    // 4️⃣ Return user info (excluding password)
    const { password: _, ...userData } = user;

    res.json({ message: "Login successful", token, user: userData });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Failed to login" });
  }
});
// ✅ Assign Delivery Boy to an Order
// router.post("/assign-delivery", async (req, res) => {
//   const { orderId, employee_id } = req.body;

//   if (!orderId || !employee_id) {
//     return res.status(400).json({
//       error: "Order ID and Employee ID are required.",
//     });
//   }

//   const client = await pool.connect();

//   try {
//     await client.query("BEGIN");

//     // =========================
//     // FETCH ORDER
//     // =========================
//     const orderRes = await client.query(
//       "SELECT id, order_summary FROM orders WHERE id = $1",
//       [orderId]
//     );

//     if (orderRes.rows.length === 0) {
//       await client.query("ROLLBACK");
//       return res.status(404).json({ error: "Order not found." });
//     }

//     const order = orderRes.rows[0];

//     // =========================
//     // PARSE ORDER ITEMS
//     // =========================
//     const orderItems =
//       typeof order.order_summary === "string"
//         ? JSON.parse(order.order_summary)
//         : order.order_summary;

//     // =========================
//     // STOCK REDUCTION (BATCH WISE)
//     // =========================
//     for (const item of orderItems) {
//       const itemCode = item.itemcode.toString();
//       const qty = Number(item.totalLooseQty || 0);

//       // 🔒 LOCK STOCK ROW
//       const stockRes = await client.query(
//         `SELECT id, stock_bal_qty 
//          FROM stock_batches 
//          WHERE c_item_code = $1 
//          FOR UPDATE`,
//         [itemCode]
//       );

//       if (stockRes.rows.length === 0) {
//         await client.query("ROLLBACK");
//         return res.status(404).json({
//           error: `Stock not found for itemcode: ${itemCode}`,
//         });
//       }

//       const stock = stockRes.rows[0];

//       // =========================
//       // STOCK CHECK
//       // =========================
//       if (Number(stock.stock_bal_qty) < qty) {
//         await client.query("ROLLBACK");
//         return res.status(400).json({
//           error: `Insufficient stock for itemcode ${itemCode}. Available: ${stock.stock_bal_qty}, Required: ${qty}`,
//         });
//       }

//       // =========================
//       // UPDATE STOCK
//       // =========================
//       await client.query(
//         `UPDATE stock_batches 
//          SET stock_bal_qty = stock_bal_qty - $1 
//          WHERE id = $2`,
//         [qty, stock.id]
//       );
//     }

//     // =========================
//     // ASSIGN DELIVERY BOY
//     // =========================
//     await client.query(
//       `UPDATE orders 
//        SET deliveryboy_id = $1, status = 'assigned' 
//        WHERE id = $2`,
//       [employee_id, orderId]
//     );

//     await client.query("COMMIT");

//     return res.json({
//       success: true,
//       message: "Delivery assigned and stock updated successfully.",
//     });
//   } catch (error) {
//     await client.query("ROLLBACK");
//     console.error("Assign delivery error:", error);

//     return res.status(500).json({
//       error: "Failed to assign delivery or reduce stock.",
//     });
//   } finally {
//     client.release();
//   }
// });
router.post("/assign-delivery", async (req, res) => {
  const { orderId, employee_id } = req.body;

  if (!orderId || !employee_id) {
    return res.status(400).json({
      error: "Order ID and Employee ID are required.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // =========================
    // CHECK ORDER EXISTS
    // =========================
    const orderRes = await client.query(
      "SELECT id FROM orders WHERE id = $1",
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }

    // =========================
    // ASSIGN DELIVERY + TIMESTAMP
    // =========================
    await client.query(
      `UPDATE orders 
       SET deliveryboy_id = $1, 
           status = 'assigned',
           assigned_at = NOW()
       WHERE id = $2`,
      [employee_id, orderId]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Delivery assigned successfully.",
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Assign delivery error:", error);

    return res.status(500).json({
      error: "Failed to assign delivery.",
    });
  } finally {
    client.release();
  }
});
// -------------------- GET ALL DELIVERY BOYS --------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, phone, email, address, bike_number, profile_pic, bike_photo, status FROM delivery_boys ORDER BY id ASC"
    );
    res.status(200).json({ deliveryBoys: result.rows });
  } catch (err) {
    console.error("Error fetching delivery boys:", err);
    res.status(500).json({ error: "Failed to fetch delivery boys" });
  }
});

// GET available delivery boys
router.get("/available", async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT ON (e.id)
        e.id,
        e.full_name,
        e.mobile,
        e.available,
        a.status AS attendance_status,
        b.status AS break_status
      FROM employees e
      LEFT JOIN attendance a ON a.employee_id = e.id
      LEFT JOIN break_logs b ON b.employee_id = e.id
      WHERE e.role = 'Hd delivery'
      AND e.available = true
      ORDER BY e.id, a.id DESC, b.id DESC
    `;

    const result = await pool.query(query);

    res.json({ success: true, employees: result.rows });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Get availability
router.get("/availability/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT available FROM employees WHERE id = $1 AND role = 'Hd delivery'",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Delivery boy not found" });
    }

    res.json({ available: result.rows[0].available });
  } catch (error) {
    console.error("Error fetching delivery boy availability:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ⚠️ MUST BE LAST
// Get orders assigned to a specific delivery boy
router.get("/:deliveryboyId", async (req, res) => {
  try {
    const { deliveryboyId } = req.params;

    const result = await pool.query(
      `SELECT * 
       FROM orders 
       WHERE deliveryboy_id = $1 
       ORDER BY created_at DESC`,
      [deliveryboyId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Get DeliveryBoy Orders Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/update-delivery-status", async (req, res) => {
  const { id, status } = req.body; // using `id` (not orderId)

  if (!id || !status) {
    return res.status(400).json({ error: "Order ID (id) and status are required" });
  }

  try {
    // ✅ Check if order exists
    const result = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // ✅ Update order status only (no cancelled_at logic)
    await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2`,
      [status, id]
    );

    res.json({ message: `Order ${id} status updated to ${status}` });
  } catch (error) {
    console.error("Error updating delivery status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update availability only for HD delivery employees
router.post("/update-availability", async (req, res) => {
  const { id, available } = req.body;

  try {
    // 1️⃣ Check if the employee exists and has role 'HD delivery'
    const result = await pool.query(
      "SELECT id, role, available FROM employees WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const employee = result.rows[0];
    if (employee.role !== "Hd delivery") {
      return res.status(403).json({ error: "Only HD delivery employees can update availability" });
    }

    // 2️⃣ Update availability
    const updateResult = await pool.query(
      "UPDATE employees SET available = $1 WHERE id = $2 RETURNING id, role, available",
      [available, id]
    );

    res.json({ success: true, employee: updateResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update availability" });
  }
});





router.post("/verify-delivery-otp", async (req, res) => {
  const { orderId, idToken } = req.body;

  if (!orderId || !idToken) {
    return res.status(400).json({ error: "Order ID and Firebase ID token are required" });
  }

  try {
    // 1️⃣ Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // 2️⃣ Check if order exists and belongs to this delivery boy
    const orderRes = await pool.query(
      "SELECT deliveryboy_id, status FROM orders WHERE id=$1",
      [orderId]
    );
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    if (orderRes.rows[0].status !== "out_for_delivery") {
      return res.status(400).json({ error: "Order is not out for delivery" });
    }

    // 3️⃣ Update order status and delivery boy status
    const deliveryBoyId = orderRes.rows[0].deliveryboy_id;
    await pool.query(
      "UPDATE orders SET status='delivered', otp_verified=true WHERE id=$1",
      [orderId]
    );
    if (deliveryBoyId) {
      await pool.query(
        "UPDATE delivery_boys SET status='available' WHERE id=$1",
        [deliveryBoyId]
      );
    }

    res.json({ message: "Order delivered successfully ✅" });
  } catch (error) {
    console.error("Firebase OTP verification error:", error);
    res.status(400).json({ error: "Invalid or expired OTP token ❌" });
  }
});
// Get collections by delivery boy for today
router.get('/:deliveryBoyId/collections', async (req, res) => {
  const { deliveryBoyId } = req.params;
  const { date } = req.query;

  try {
    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required (YYYY-MM-DD)",
      });
    }

    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    let total_cash = 0;
    let total_digital = 0;

    /* ======================================================
       🔵 1. SALES ORDERS
    ====================================================== */
    const salesResult = await pool.query(
      `
      SELECT payment_mode_collected, amount_collected
      FROM sales_orders
      WHERE deliveryboy_id = $1
        AND payment_collected = true
        AND collected_at BETWEEN $2 AND $3
      `,
      [deliveryBoyId, start, end]
    );

    salesResult.rows.forEach(order => {
      const amount = Number(order.amount_collected) || 0;
      const rawMode = order.payment_mode_collected;

      if (!rawMode) return;

      const mode = rawMode.toLowerCase();

      if (mode.includes("cash only")) {
        total_cash += amount;
        return;
      }

      if (mode.includes("online only") || mode.includes("digital only")) {
        total_digital += amount;
        return;
      }

      rawMode.split(",").forEach(part => {
        const [type, val] = part.split(":");
        const amt = Number(val) || 0;

        if (type?.toLowerCase().includes("cash")) {
          total_cash += amt;
        } else {
          total_digital += amt;
        }
      });
    });

    /* ======================================================
       🟢 2. MEDICINE ORDERS
    ====================================================== */
    const ordersResult = await pool.query(
      `
      SELECT payment_mode, amount_received
      FROM orders
      WHERE deliveryboy_id = $1
        AND payment_status = 'Paid'
        AND payment_collected_at BETWEEN $2 AND $3
      `,
      [deliveryBoyId, start, end]
    );

    ordersResult.rows.forEach(order => {
      const amount = Number(order.amount_received) || 0;
      const rawMode = order.payment_mode;

      if (!rawMode) return;

      const mode = rawMode.toLowerCase();

      if (mode.includes(":")) {
        rawMode.split(",").forEach(part => {
          const [type, val] = part.split(":");
          const amt = Number(val) || 0;

          if (type?.toLowerCase().includes("cash")) {
            total_cash += amt;
          } else {
            total_digital += amt;
          }
        });
        return;
      }

      if (mode.includes("cash")) {
        total_cash += amount;
      } else {
        total_digital += amount;
      }
    });

    /* ======================================================
       🟣 3. ECOGREEN ORDERS (FIXED + SAFE)
    ====================================================== */
    const ecoResult = await pool.query(
      `
      SELECT payment_mode_collected, amount_collected
      FROM ecogreensales_invoices
      WHERE delivered_by_id = $1
        AND payment_collected = true
        AND collected_at BETWEEN $2 AND $3
      `,
      [deliveryBoyId, start, end]
    );

   ecoResult.rows.forEach(order => {
  const fullAmount = Number(order.amount_collected) || 0;

  const rawMode =
    typeof order.payment_mode_collected === "string"
      ? order.payment_mode_collected
      : order.payment_mode_collected?.payment_mode_collected;

  if (!rawMode) return;

  const mode = rawMode.toLowerCase();

  // ✅ SPLIT PAYMENT CASE
  if (mode.includes(":")) {
    rawMode.split(",").forEach(part => {
      const [type, val] = part.split(":");

      const amt = Number(val) || 0;
      const cleanType = type?.trim().toLowerCase(); // 🔥 FIX IMPORTANT

      if (cleanType.includes("cash")) {
        total_cash += amt;
      } else {
        // UPI = digital
        total_digital += amt;
      }
    });

    return; // ❗ STOP HERE (IMPORTANT)
  }

  // ✅ NON SPLIT CASE
  if (mode.includes("cash")) {
    total_cash += fullAmount;
  } else {
    total_digital += fullAmount;
  }
});
    /* ======================================================
       🔴 4. CREDIT ORDERS
    ====================================================== */
    const creditResult = await pool.query(
      `
      SELECT COUNT(*)
      FROM sales_orders
      WHERE deliveryboy_id = $1
        AND payment_collected = false
      `,
      [deliveryBoyId]
    );

    /* ======================================================
       ✅ RESPONSE
    ====================================================== */
    return res.json({
      success: true,
      total_cash: Number(total_cash.toFixed(2)),
      total_digital: Number(total_digital.toFixed(2)),
      total_collected: Number((total_cash + total_digital).toFixed(2)),
      credit_orders: Number(creditResult.rows[0].count),
    });

  } catch (err) {
    console.error("Collections error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});


// 2️⃣ Submit cash handover
router.post(
  '/:deliveryBoyId/handover',
  upload.fields([
    { name: 'cashier_photo', maxCount: 1 },
    { name: 'signature', maxCount: 1 }
  ]),
  async (req, res) => {
    const { deliveryBoyId } = req.params;
    const { date, total_cash, total_digital, cash_returned } = req.body;

    try {
      // File paths
      const cashierPhotoUrl = req.files['cashier_photo']
        ? req.files['cashier_photo'][0].path
        : null;

      const signatureUrl = req.files['signature']
        ? req.files['signature'][0].path
        : null;

      // Simple Insert
      const result = await pool.query(
        `
        INSERT INTO cash_handovers
        (deliveryboy_id, date, total_cash, total_digital, cash_returned, cashier_photo, signature)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [
          deliveryBoyId,
          date,
          total_cash,
          total_digital,
          cash_returned,
          cashierPhotoUrl,
          signatureUrl
        ]
      );

      res.json({
        success: true,
        message: 'Cash handover recorded successfully',
        handover_id: result.rows[0].id
      });
    } catch (err) {
      console.error('Handover error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// GET all cash handovers (Admin)
router.get('/handover/all', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM cash_handovers
      ORDER BY date DESC, created_at DESC
      `
    );

    res.json({
      success: true,
      count: result.rowCount,
      handovers: result.rows
    });

  } catch (err) {
    console.error("Fetch all handovers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


router.get("/deliveryboy/handover", async (req, res) => {
  const { boyId, month } = req.query;

  try {
    const query = `
      SELECT *
      FROM cash_handovers
      WHERE deliveryboy_id = $1
        AND TO_CHAR(date, 'MM') = $2
      ORDER BY date DESC
    `;

    const { rows } = await pool.query(query, [boyId, month]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
// 3️⃣ Fetch existing handover (optional)
router.get('/:deliveryBoyId/handover', async (req, res) => {
  const { deliveryBoyId } = req.params;
  const { date } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM cash_handovers
      WHERE deliveryboy_id = $1 AND date = $2
      `,
      [deliveryBoyId, date]
    );

    res.json({
      success: true,
      handover: result.rows[0] || null
    });

  } catch (err) {
    console.error("Fetch handover error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all handovers for a delivery boy
router.get('/:deliveryBoyId/handover/all', async (req, res) => {
  const { deliveryBoyId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM cash_handovers
      WHERE deliveryboy_id = $1
      ORDER BY date DESC, created_at DESC
      `,
      [deliveryBoyId]
    );

    res.json({
      success: true,
      count: result.rowCount,
      handovers: result.rows
    });

  } catch (err) {
    console.error("Fetch deliveryboy handovers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});
router.post("/update-location", async (req, res) => {
  const { deliveryBoyId, latitude, longitude, status } = req.body;

  if (!deliveryBoyId || !latitude || !longitude) {
    return res.status(400).json({ success: false, message: "Invalid data" });
  }

  try {
    await pool.query(
      `
      INSERT INTO delivery_boy_locations
      (delivery_boy_id, latitude, longitude, status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (delivery_boy_id)
      DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        status = EXCLUDED.status
      `,
      [deliveryBoyId, latitude, longitude, status]
    );

    // 🔥 Real-time push to admin
// Broadcast to all connected clients
for (let [id, ws] of clients.entries()) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({
      type: "location-update",
      deliveryBoyId,
      latitude,
      longitude,
      status
    }));
  }
}
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.get("/location/live", async (req, res) => {
  const { boyId } = req.query;
  if (!boyId) return res.status(400).json({ success: false, message: "boyId is required" });

  try {
    const { rows } = await pool.query(`
      SELECT latitude, longitude, status, updated_at
      FROM delivery_boy_locations
      WHERE delivery_boy_id = $1
      LIMIT 1
    `, [boyId]);

    if (rows.length === 0) return res.json({ success: false, location: null });

    res.json({ success: true, location: rows[0] });
  } catch (err) {
    console.error("Fetch live location error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/admin/deliveryboy-locations", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        loc.delivery_boy_id,
        emp.full_name,
        loc.latitude,
        loc.longitude,
        loc.status,
        loc.updated_at
      FROM delivery_boy_locations loc
      JOIN employees emp 
        ON emp.id = loc.delivery_boy_id
    `);

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


router.post('/order/update-location', async (req, res) => {
  const { orderId, deliveryBoyId, latitude, longitude } = req.body;

  if (!orderId || !deliveryBoyId || latitude == null || longitude == null) {
    return res.status(400).json({ success: false, error: 'Missing parameters' });
  }

  try {
    await pool.query(`
      INSERT INTO deliverylocations_orders(order_id, delivery_boy_id, latitude, longitude, updated_at)
      VALUES($1, $2, $3, $4, CURRENT_TIMESTAMP)
    `, [orderId, deliveryBoyId, latitude, longitude]);

    res.json({ success: true });
  } catch (err) {
    console.error('Database Error:', err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});


//  Get location for a specific order
router.get('/location/:orderId', async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        dl.latitude,
        dl.longitude,
        dl.updated_at,
        e.full_name AS delivery_boy_name
      FROM deliverylocations_orders dl
      LEFT JOIN employees e
        ON e.id = dl.delivery_boy_id
      WHERE dl.order_id = $1
      ORDER BY dl.updated_at DESC
      LIMIT 1
      `,
      [orderId]
    );

    res.json({
      success: true,
      location: result.rows[0] || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});





module.exports = router;
