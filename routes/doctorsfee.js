const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL connection

// ---------------- CREATE ----------------
router.post("/add", async (req, res) => {
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
    const values = [doctor_id, doctor_name, department, role, gender, experience, description, consultance_fee];
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

// ---------------- READ ----------------
// Get all doctor fees
router.get("/doctor-fees", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM doctor_fees ORDER BY doctor_id ASC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching doctor fees:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get doctor fee by doctor_id
router.get("/doctor-fees/:doctor_id", async (req, res) => {
  try {
    const { doctor_id } = req.params;
    const result = await pool.query("SELECT * FROM doctor_fees WHERE doctor_id = $1", [doctor_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching doctor fee:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------- UPDATE ----------------
router.put("/doctor-fees/:doctor_id", async (req, res) => {
  try {
    const { doctor_id } = req.params;
    const { doctor_name, department, role, gender, experience, description, consultance_fee } = req.body;

    const query = `
      UPDATE doctor_fees
      SET doctor_name = COALESCE($1, doctor_name),
          department = COALESCE($2, department),
          role = COALESCE($3, role),
          gender = COALESCE($4, gender),
          experience = COALESCE($5, experience),
          description = COALESCE($6, description),
          consultance_fee = COALESCE($7, consultance_fee)
      WHERE doctor_id = $8
      RETURNING *;
    `;
    const values = [doctor_name, department, role, gender, experience, description, consultance_fee, doctor_id];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    res.json({
      message: "Doctor fee updated successfully",
      doctor: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating doctor fee:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------- DELETE ----------------
router.delete("/doctor-fees/:doctor_id", async (req, res) => {
  try {
    const { doctor_id } = req.params;
    const result = await pool.query("DELETE FROM doctor_fees WHERE doctor_id = $1 RETURNING *", [doctor_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    res.json({ message: "Doctor fee deleted successfully" });
  } catch (error) {
    console.error("Error deleting doctor fee:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
