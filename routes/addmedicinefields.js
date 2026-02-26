const express = require("express");
const router = express.Router();
const pool = require("../db"); // Make sure your PostgreSQL pool is exported from db.js

// Middleware to parse JSON
router.use(express.json());

/**
 * @route   GET /medicine/fields
 * @desc    Get all active fields
 */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM medicine_fields WHERE active = true ORDER BY id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching fields:", err);
    res.status(500).json({ error: "Failed to fetch fields" });
  }
});

/**
 * @route   POST /medicine/fields
 * @desc    Add a new field
 * @body    { field_name, field_type, required, icon }
 */
router.post("/add", async (req, res) => {
  const { field_name, field_type, required, icon } = req.body;

  if (!field_name || !field_type) {
    return res.status(400).json({ error: "Field name and type are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO medicine_fields (field_name, field_type, required, icon, active, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       RETURNING *`,
      [field_name, field_type, required || false, icon || null]
    );
    res.status(201).json({ message: "Field added", field: result.rows[0] });
  } catch (err) {
    console.error("Error adding field:", err);
    res.status(500).json({ error: "Failed to add field" });
  }
});

/**
 * @route   DELETE /medicine/fields/:id
 * @desc    Deactivate a field (soft delete)
 */
router.delete("/delete/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "UPDATE medicine_fields SET active = false, updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Field not found" });
    }

    res.json({ message: "Field deactivated", field: result.rows[0] });
  } catch (err) {
    console.error("Error deactivating field:", err);
    res.status(500).json({ error: "Failed to deactivate field" });
  }
});

module.exports = router;