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
router.post("/assign-delivery", async (req, res) => {
  const { orderId, deliveryBoyId } = req.body;

  if (!orderId || !deliveryBoyId) {
    return res.status(400).json({ error: "Order ID and Delivery Boy ID are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1️⃣ Check if order exists and not already assigned
    const orderRes = await client.query(
      "SELECT id, status, deliveryboy_id FROM orders WHERE id = $1",
      [orderId]
    );
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    if (orderRes.rows[0].delivery_boy_id) {
      return res.status(400).json({ error: "Delivery boy already assigned to this order" });
    }

    // 2️⃣ Check if delivery boy exists and is available
    const deliveryBoyRes = await client.query(
      "SELECT id, status FROM delivery_boys WHERE id = $1",
      [deliveryBoyId]
    );
    if (deliveryBoyRes.rowCount === 0) {
      return res.status(404).json({ error: "Delivery boy not found" });
    }
    if (deliveryBoyRes.rows[0].status !== "available") {
      return res.status(400).json({ error: "Delivery boy is not available" });
    }

    // 3️⃣ Assign delivery boy to order
    await client.query(
      "UPDATE orders SET deliveryboy_id = $1, status = 'out_for_delivery' WHERE id = $2",
      [deliveryBoyId, orderId]
    );

    // 4️⃣ Update delivery boy status to busy
    await client.query(
      "UPDATE delivery_boys SET status = 'busy' WHERE id = $1",
      [deliveryBoyId]
    );

    await client.query("COMMIT");

    res.status(200).json({ message: "Delivery boy assigned successfully", orderId, deliveryBoyId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Assign Delivery Boy Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// ✅ Get orders assigned to a specific delivery boy
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


module.exports = router;
