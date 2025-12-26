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
router.post("/assign-delivery", async (req, res) => {
  const { orderId, employee_id } = req.body;

  // 🔹 Validation
  if (!orderId || !employee_id) {
    return res
      .status(400)
      .json({ error: "Order ID and Employee ID are required." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ✅ Check if order exists
    const orderCheck = await client.query(
      "SELECT id FROM orders WHERE id = $1",
      [orderId]
    );

    if (orderCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }

    // ✅ Check if delivery boy exists
    const empCheck = await client.query(
      "SELECT id, full_name, role FROM employees WHERE id = $1",
      [employee_id]
    );

    if (empCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee not found." });
    }

    const employee = empCheck.rows[0];

    // ✅ Validate role
    if (employee.role.toLowerCase() !== "hd delivery") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "This employee is not a delivery person." });
    }

    // ✅ Assign delivery boy to the order
await client.query(
  `
  UPDATE orders
  SET deliveryboy_id = $1
  WHERE id = $2
  `,
  [employee_id, orderId]
);



    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Delivery assigned to ${employee.full_name}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error assigning delivery:", error);
    res.status(500).json({ error: "Failed to assign delivery boy." });
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
router.get('/:deliveryBoyId/collections', async (req, res) => {
  const { deliveryBoyId } = req.params;
  const { date } = req.query; // YYYY-MM-DD

  try {
    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');

    // Only orders where payment was collected
    const orders = await Order.find({
      deliveryboy_id: deliveryBoyId,
      payment_collected: true,
      collected_at: { $gte: start, $lte: end }
    });

    // Calculate total collected
    let total_cash = 0;
    let total_digital = 0;
    let credit_orders = 0;

    orders.forEach(order => {
      if (order.amount_collected) {
        const amount = parseFloat(order.amount_collected);
        if (order.payment_mode_collected) {
          const modes = order.payment_mode_collected.split(',');
          modes.forEach(mode => {
            const [type, val] = mode.split(':');
            const amt = parseFloat(val) || 0;
            if (type.toLowerCase().includes('cash')) total_cash += amt;
            else if (type.toLowerCase().includes('upi') || type.toLowerCase().includes('online')) total_digital += amt;
          });
        }
      }
    });

    res.json({
      success: true,
      total_cash,
      total_digital,
      credit_orders, // can be calculated if needed
      orders
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2️⃣ Submit cash handover
router.post('/:deliveryBoyId/handover', async (req, res) => {
  const { deliveryBoyId } = req.params;
  const { date, total_cash, total_digital, credit_orders, cash_returned, cashier_photo, signature } = req.body;

  try {
    const handover = new Handover({
      deliveryboy_id: deliveryBoyId,
      date,
      total_cash,
      total_digital,
      credit_orders,
      cash_returned,
      cashier_photo,
      signature
    });

    await handover.save();
    res.json({ success: true, message: 'Cash handover recorded successfully', handover_id: handover._id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3️⃣ Fetch existing handover (optional)
router.get('/:deliveryBoyId/handover', async (req, res) => {
  const { deliveryBoyId } = req.params;
  const { date } = req.query;

  try {
    const handover = await Handover.findOne({ deliveryboy_id: deliveryBoyId, date });
    res.json({ success: true, handover });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
