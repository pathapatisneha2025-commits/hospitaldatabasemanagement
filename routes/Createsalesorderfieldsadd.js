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
  try {
    const { label, type, required, options } = req.body;

    if (!label) {
      return res.status(400).json({ success: false, error: "Label is required" });
    }

    // 1️⃣ Generate a safe field_key from the label
    // Lowercase, replace spaces & special chars with underscores
    let field_key = label
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")        // spaces → underscores
      .replace(/[^\w]+/g, "");     // remove non-alphanumeric chars

    // 2️⃣ Check if this field_key already exists
    const { rows: existing } = await pool.query(
      "SELECT id FROM order_form_fields WHERE field_key=$1",
      [field_key]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, error: "Field with this name already exists" });
    }

    // 3️⃣ Insert into order_form_fields metadata table
    const { rows } = await pool.query(
      `INSERT INTO order_form_fields (field_key, label, type, required, options)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [field_key, label, type || "text", required || false, options || []]
    );

    const newField = rows[0];

    // 4️⃣ Determine SQL data type for sales_orders table
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

    // 5️⃣ ALTER sales_orders table to add the new column safely
    await pool.query(
      `ALTER TABLE sales_orders
       ADD COLUMN IF NOT EXISTS "${field_key}" ${sqlType}`
    );

    res.json({ success: true, field: newField });
  } catch (err) {
    console.error("Error adding field:", err);
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
    // 1️⃣ Get the field_key of the field being deleted
    const { rows } = await pool.query(
      "SELECT field_key FROM order_form_fields WHERE id=$1",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Field not found" });
    }

    const fieldKey = rows[0].field_key;

    // 2️⃣ Delete the field from order_form_fields
    await pool.query("DELETE FROM order_form_fields WHERE id=$1", [id]);

    // 3️⃣ Drop the column from sales_orders table
    // Note: use double quotes for column names in case they have uppercase letters
    await pool.query(`ALTER TABLE sales_orders DROP COLUMN IF EXISTS "${fieldKey}"`);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});
module.exports = router;
