const express = require("express");
const db = require("../db");

const router = express.Router();

// =========================================================
// ✅ Add Single Item Master
// =========================================================
router.post("/add-item", async (req, res) => {
  try {
    const {
      item_code, item_name, item_short_name, item_full_name,
      brand_code, brand_name, category_code, category_name,
      content_code, content_name, pack_code, pack_name,
      item_qty_per_box, item_added_date, item_updated_date,
      hsn_sac_code, hsn_sac_name
    } = req.body;

    if (!item_code) {
      return res.status(400).json({ error: "item_code is required" });
    }

    const query = `
      INSERT INTO item_master (
        item_code, item_name, item_short_name, item_full_name,
        brand_code, brand_name, category_code, category_name,
        content_code, content_name, pack_code, pack_name,
        item_qty_per_box, item_added_date, item_updated_date,
        hsn_sac_code, hsn_sac_name
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17
      )
      ON CONFLICT (item_code) DO UPDATE SET
        item_name = EXCLUDED.item_name,
        item_short_name = EXCLUDED.item_short_name,
        item_full_name = EXCLUDED.item_full_name,
        brand_code = EXCLUDED.brand_code,
        brand_name = EXCLUDED.brand_name,
        category_code = EXCLUDED.category_code,
        category_name = EXCLUDED.category_name,
        content_code = EXCLUDED.content_code,
        content_name = EXCLUDED.content_name,
        pack_code = EXCLUDED.pack_code,
        pack_name = EXCLUDED.pack_name,
        item_qty_per_box = EXCLUDED.item_qty_per_box,
        item_updated_date = NOW(),
        hsn_sac_code = EXCLUDED.hsn_sac_code,
        hsn_sac_name = EXCLUDED.hsn_sac_name
    `;

    const values = [
      item_code, item_name, item_short_name, item_full_name,
      brand_code, brand_name, category_code, category_name,
      content_code, content_name, pack_code, pack_name,
      item_qty_per_box, item_added_date, item_updated_date,
      hsn_sac_code, hsn_sac_name
    ];

    await pool.query(query, values);

    res.status(200).json({ message: "Item added/updated successfully" });
  } catch (err) {
    console.error("Add Single Item Error:", err.message);
    res.status(500).json({ error: "Failed to add item", details: err.message });
  }
});

module.exports = router;