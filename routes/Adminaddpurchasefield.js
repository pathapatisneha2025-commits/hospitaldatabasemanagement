const express = require("express");
const router = express.Router();
const pool = require("../db"); // your pg pool connection

// 🔹 Get all custom fields
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM purchase_order_custom_fields ORDER BY id DESC"
    );
    res.json({ success: true, fields: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 Add new custom field
router.post("/add", async (req, res) => {
  try {
    const { field_name, field_type, is_required } = req.body;

    // 1. Insert into the custom fields table
    await pool.query(
      `INSERT INTO purchase_order_custom_fields (field_name, field_type, is_required)
       VALUES ($1, $2, $3)`,
      [field_name, field_type, is_required]
    );

    // 2. Dynamically alter the purchase_orders table
    // Map field_type to PostgreSQL types
    let pgType = "TEXT";
    if (field_type === "number") pgType = "NUMERIC";
    else if (field_type === "date") pgType = "DATE";

    // Make a safe column name (replace spaces with _ and lowercase)
    const safeColumn = field_name.trim().toLowerCase().replace(/\s+/g, "_");

    await pool.query(
      `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS "${safeColumn}" ${pgType}`
    );

    res.json({ success: true, message: "Field added and column created successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 Update field
router.put("/update/:id", async (req, res) => {
  try {
    const { field_name, field_type, is_required } = req.body;

    await pool.query(
      `UPDATE purchase_order_custom_fields
       SET field_name=$1, field_type=$2, is_required=$3
       WHERE id=$4`,
      [field_name, field_type, is_required, req.params.id]
    );

    res.json({ success: true, message: "Field updated" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 Delete field
router.delete("/delete-field/:fieldName", async (req, res) => {
  const fieldName = req.params.fieldName;
  const safeColumn = fieldName.trim().toLowerCase().replace(/\s+/g, "_");

  // List of columns you NEVER want to delete
  const protectedColumns = ["id", "purchase_no", "supplier"]; // add more if needed

  if (protectedColumns.includes(safeColumn)) {
    return res.status(400).json({
      success: false,
      error: `"${fieldName}" is a protected field and cannot be deleted.`,
    });
  }

  try {
    // 1️⃣ Delete from custom fields table if exists
    const customCheck = await pool.query(
      "SELECT * FROM purchase_order_custom_fields WHERE field_name=$1",
      [fieldName]
    );

    if (customCheck.rowCount > 0) {
      await pool.query(
        "DELETE FROM purchase_order_custom_fields WHERE field_name=$1",
        [fieldName]
      );
    }

    // 2️⃣ Drop the column from purchase_orders table (works for both default & custom)
    // Using CASCADE to remove dependent constraints if any
    await pool.query(
      `ALTER TABLE purchase_orders DROP COLUMN IF EXISTS "${safeColumn}" CASCADE`
    );

    res.json({
      success: true,
      message: `Field "${fieldName}" deleted successfully.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});
module.exports = router;