const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../../db"); // your DB connection file
const router = express.Router();

/* ======================================================
   1.Register Subadmin
====================================================== */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, cnfpass, joiningdate, phone } = req.body;

    if (password !== cnfpass) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    const existingUser = await pool.query("SELECT * FROM subadmin WHERE email = $1", [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO subadmin (name, email, password, confirm_password, joining_date, phone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, email, hashedPassword, hashedPassword, joiningdate || new Date(), phone]
    );

    res.status(201).json({ success: true, message: "Subadmin registered", data: result.rows[0] });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ======================================================
   2. Login Subadmin
====================================================== */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query("SELECT * FROM subadmin WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid email or password" });
    }

    res.status(200).json({ success: true, message: "Login successful", user });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ======================================================
    3.Forgot Password
====================================================== */
router.put("/forgot-password", async (req, res) => {
  try {
    const { email, newpassword, confirmnewpassword } = req.body;

    // 1️ Check all fields present
    if (!email || !newpassword || !confirmnewpassword) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // 2️ Check passwords match
    if (newpassword !== confirmnewpassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    // 3️ Find subadmin by email
    const userResult = await pool.query("SELECT * FROM subadmin WHERE email = $1", [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Subadmin not found" });
    }

    // 4️ Hash new password
    const hashedPassword = await bcrypt.hash(newpassword, 10);

    // 5️ Update in database
    await pool.query(
      `UPDATE subadmin 
       SET password = $1, confirm_password = $1 
       WHERE email = $2`,
      [hashedPassword, email]
    );

    res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
