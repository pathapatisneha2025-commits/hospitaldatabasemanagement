const express = require("express");
const router = express.Router();
const pool = require("../../db"); // Database connection
const bcrypt = require("bcrypt");

/* =========================================================
   1. Register Admin
========================================================= */
router.post("/register", async (req, res) => {
  const { name, email, password, confirm_password, joining_date, phone } = req.body;

  // Basic validation
  if (!name || !email || !password || !confirm_password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (password !== confirm_password) {
    return res.status(400).json({ error: "Passwords do not match" });
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Get current time in IST (Asia/Kolkata)
    const createdAt = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });

    // Insert into database
    const result = await pool.query(
      `INSERT INTO admin (name, email, password, joining_date, phone, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, email, hashedPassword, joining_date, phone, createdAt]
    );

    // Respond with newly created admin
    res.status(201).json({ success: true, admin: result.rows[0] });
  } catch (error) {
    console.error("Error registering admin:", error);
    if (error.code === "23505") {
      res.status(400).json({ error: "Email already exists" });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});

/* =========================================================
   2. Admin Login
========================================================= */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "All fields are required" });

  try {
    const result = await pool.query("SELECT * FROM admin WHERE email=$1", [email]);
    const admin = result.rows[0];

    if (!admin) return res.status(404).json({ error: "Admin not found" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    // Successful login response
    res.json({
      success: true,
      admin: { id: admin.id, name: admin.name, email: admin.email },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   3. Forgot Password
========================================================= */
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const result = await pool.query("SELECT * FROM admin WHERE email=$1", [email]);
    const admin = result.rows[0];

    if (!admin) return res.status(404).json({ error: "Admin not found" });

    // Generate 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000);

    // (You can later store this in DB or send via email)
    res.json({
      success: true,
      message: "Password reset code generated successfully",
      resetCode,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================================================
   4. Get All Admins
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM admin ORDER BY id ASC");
    res.json({ success: true, admins: result.rows });
  } catch (error) {
    console.error("Error fetching admins:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
