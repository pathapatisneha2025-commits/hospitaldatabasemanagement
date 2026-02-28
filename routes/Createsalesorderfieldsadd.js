// GET /admin/form-fields
const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/all", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM order_form_fields ORDER BY id ASC");
    res.json({ success: true, fields: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /admin/form-fields
router.post("/add", async (req, res) => {
  const { field_key, label, type, required, options } = req.body;

  try {
    // 1️⃣ Insert into order_form_fields metadata table
    const { rows } = await pool.query(
      `INSERT INTO order_form_fields (field_key, label, type, required, options)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [field_key, label, type || "text", required || false, options || []]
    );

    const newField = rows[0];

    // 2️⃣ Determine SQL data type for sales_orders table
    let sqlType;
    switch ((type || "text").toLowerCase()) {
      case "number":
        sqlType = "NUMERIC";
        break;
      case "date":
        sqlType = "TIMESTAMP";
        break;
      default:
        sqlType = "TEXT";
    }

    // 3️⃣ ALTER sales_orders table to add the new column
    // Use IF NOT EXISTS to prevent errors if the column already exists
    await pool.query(
      `ALTER TABLE sales_orders
       ADD COLUMN IF NOT EXISTS ${field_key} ${sqlType}`
    );

    res.json({ success: true, field: newField });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /admin/form-fields/:id
router.put("/update/:id", async (req, res) => {
  const { id } = req.params;
  const { label, type, required, options } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE order_form_fields 
       SET label=$1, type=$2, required=$3, options=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [label, type, required, options || [], id]
    );
    res.json({ success: true, field: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE /admin/form-fields/:id
router.delete("/delete/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM order_form_fields WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});
module.exports = router;
