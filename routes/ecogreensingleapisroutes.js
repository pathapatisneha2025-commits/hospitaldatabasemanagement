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

    await db.query(query, values);

    res.status(200).json({ message: "Item added/updated successfully" });
  } catch (err) {
    console.error("Add Single Item Error:", err.message);
    res.status(500).json({ error: "Failed to add item", details: err.message });
  }
});


router.post('/add-stock', async (req, res) => {
  const { c_item_code, item_name, item_qty_per_box, batch_no, stock_bal_qty, expiry_date } = req.body;

  try {
    const query = `
      INSERT INTO  stock_batches
      (c_item_code, item_name, item_qty_per_box, batch_no, stock_bal_qty, expiry_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [c_item_code, item_name, item_qty_per_box, batch_no, stock_bal_qty, expiry_date];
    const result = await db.query(query, values);

    res.status(201).json({ success: true, stock: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.post('/local-customer/add', async (req, res) => {
  const {
    brcode, lc_code, lc_name, added_date, age, gender,
    address1, address2, address3, city, pin, mobile_no, mail_id,
    parent_code, parent_name
  } = req.body;

  try {
    const query = `
      INSERT INTO  local_customers
      (brcode, lc_code, lc_name, added_date, age, gender, address1, address2, address3, city, pin, mobile_no, mail_id, parent_code, parent_name)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *;
    `;
    const values = [brcode, lc_code, lc_name, added_date, age, gender, address1, address2, address3, city, pin, mobile_no, mail_id, parent_code, parent_name];

    const result = await db.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Database Error' });
  }
});
router.post('/purchase-order/add', async (req, res) => {
  const { br_code, year, prefix, srno, custcode, custname, refcode, refname, total, details } = req.body;

  if (!br_code || !srno || !custname) {
    return res.status(400).json({ success: false, message: 'Required fields missing' });
  }

  try {
    const query = `
      INSERT INTO ecogreenpurchase_orders 
      (br_code, year, prefix, srno, custcode, custname, refcode, refname, total, details)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *;
    `;
    const values = [br_code, year, prefix, srno, custcode, custname, refcode, refname, total, JSON.stringify(details)];

    const result = await db.query(query, values);
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

module.exports = router;