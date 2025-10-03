const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL connection pool

// ---------------- CREATE PATIENT ----------------
router.post("/add", async (req, res) => {
  try {
    const { name, phone, age } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }

    const result = await pool.query(
      "INSERT INTO billingpatient (name, phone, age) VALUES ($1, $2, $3) RETURNING *",
      [name, phone || null, age || null]
    );

    res.status(201).json({
      success: true,
      message: "Patient added successfully",
      data: result.rows[0]
    });
  } catch (err) {
    console.error("Error adding patient:", err.message);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ---------------- GET ALL PATIENTS ----------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM billingpatient ORDER BY id DESC");
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Error fetching patients:", err.message);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ---------------- GET SINGLE PATIENT ----------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM billingpatient WHERE id=$1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Error fetching patient:", err.message);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ---------------- UPDATE PATIENT ----------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, age } = req.body;

    const result = await pool.query(
      "UPDATE billingpatient SET name=$1, phone=$2, age=$3 WHERE id=$4 RETURNING *",
      [name, phone, age, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    res.status(200).json({ success: true, message: "Patient updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error("Error updating patient:", err.message);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ---------------- DELETE PATIENT ----------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM billingpatient WHERE id=$1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    res.status(200).json({ success: true, message: "Patient deleted successfully", data: result.rows[0] });
  } catch (err) {
    console.error("Error deleting patient:", err.message);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

module.exports = router;
