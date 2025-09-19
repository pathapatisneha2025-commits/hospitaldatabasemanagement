const express = require("express");
const router = express.Router();
const pool = require("../db"); // import db connection

// POST /api/add-doctor-fee
router.post("/add-doctor-fee", async (req, res) => {
  try {
    const {
      doctor_id,
      doctor_name,
      department,
      role,
      gender,
      experience,
      description,
      consultance_fee,
    } = req.body;

    // Validation
    if (!doctor_id || !doctor_name || !department || !consultance_fee) {
      return res
        .status(400)
        .json({ error: "doctor_id, doctor_name, department, and consultance_fee are required" });
    }

    const query = `
      INSERT INTO doctor_fees 
      (doctor_id, doctor_name, department, role, gender, experience, description, consultance_fee)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *;
    `;

    const values = [
      doctor_id,
      doctor_name,
      department,
      role,
      gender,
      experience,
      description,
      consultance_fee,
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      message: "Doctor consultation fee added successfully",
      doctor: result.rows[0],
    });
  } catch (error) {
    console.error("Error inserting doctor fee:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
