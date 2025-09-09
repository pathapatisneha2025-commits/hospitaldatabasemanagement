const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");

const router = express.Router();


// REGISTER API
router.post("/register", async (req, res) => {
  try {
    const { first_name, last_name, gender, phone_number, email, password, confirm_password } = req.body;

    if (password !== confirm_password) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert + return new patient info
    const query = `
      INSERT INTO patients (first_name, last_name, gender, phone_number, email, password, confirm_password)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, first_name, last_name, gender, phone_number, email;
    `;

    const values = [first_name, last_name, gender, phone_number, email, hashedPassword, hashedPassword];
    const result = await db.query(query, values);

    const newPatient = result.rows[0];

    res.status(201).json({
      message: "Patient registered successfully",
      patient: newPatient
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 2️⃣ LOGIN API (no token, just success + patient info)
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const query = `SELECT * FROM patients WHERE email = $1`;
    const result = await db.query(query, [email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Patient not found" });
    }

    const patient = result.rows[0];
    const isMatch = await bcrypt.compare(password, patient.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Return basic patient details
    res.json({
      message: "Login successful",
      first_name: patient.first_name,
      last_name: patient.last_name,
      email: patient.email,
      phone_number: patient.phone_number,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3️⃣ FORGOT PASSWORD API
router.post("/forgot-password", async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const query = `UPDATE patients SET password = $1, confirm_password = $2 WHERE email = $3 RETURNING id;`;
    const result = await db.query(query, [hashedPassword, hashedPassword, email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Patient not found" });
    }

    res.json({ message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/all", async (req, res) => {
  try {
    const query = `
      SELECT * 
      FROM patients
      ORDER BY id ASC;
    `;
    const result = await db.query(query);

    res.json({
      message: "All patients fetched successfully",
      patients: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
