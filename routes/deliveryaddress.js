const express = require("express");
const router = express.Router();
const pool = require("../db");

// ✅ Create new address
router.post("/add", async (req, res) => {
  const { patient_id, name, mobile, pincode, flat, street, city, state, landmark, address_type } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO delivery_addresses
      (patient_id, name, mobile, pincode, flat, street, city, state, landmark, address_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [patient_id, name, mobile, pincode, flat, street, city, state, landmark, address_type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error inserting address:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get ALL addresses (across all patients)
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM delivery_addresses ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching all addresses:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get all addresses for a specific patient
router.get("/patient/:patientId", async (req, res) => {
  const { patientId } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM delivery_addresses WHERE patient_id=$1 ORDER BY created_at DESC",
      [patientId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching addresses:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get single address by ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("SELECT * FROM delivery_addresses WHERE id=$1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Address not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching address:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Update an address
router.put("/update/:id", async (req, res) => {
  const { id } = req.params;
  const { name, mobile, pincode, flat, street, city, state, landmark, address_type } = req.body;

  try {
    const result = await pool.query(
      `UPDATE delivery_addresses
       SET name=$1, mobile=$2, pincode=$3, flat=$4, street=$5,
           city=$6, state=$7, landmark=$8, address_type=$9
       WHERE id=$10 RETURNING *`,
      [name, mobile, pincode, flat, street, city, state, landmark, address_type, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Address not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating address:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Delete an address
router.delete("/delete/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("DELETE FROM delivery_addresses WHERE id=$1 RETURNING *", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Address not found" });
    res.json({ message: "Address deleted successfully" });
  } catch (err) {
    console.error("Error deleting address:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
