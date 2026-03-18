const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const pool = require("../db"); // ✅ PostgreSQL pool

const router = express.Router();

// --------------------
// Multer setup
// --------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

// =========================================================
// ✅ Bulk Upload Item Master (Excel / CSV)
// =========================================================
router.post("/upload-itemmaster", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // Read Excel/CSV
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    if (!data || data.length === 0)
      return res.status(400).json({ error: "Empty file" });

    const values = [];
    const placeholders = [];

    data.forEach((row, index) => {
      const i = index * 17;

      placeholders.push(`(
        $${i + 1}, $${i + 2}, $${i + 3}, $${i + 4},
        $${i + 5}, $${i + 6}, $${i + 7}, $${i + 8},
        $${i + 9}, $${i + 10}, $${i + 11}, $${i + 12},
        $${i + 13}, $${i + 14}, $${i + 15}, $${i + 16}, $${i + 17}
      )`);

      values.push(
        row.item_code,
        row.item_name,
        row.item_short_name,
        row.item_full_name,
        row.brand_code,
        row.brand_name,
        row.category_code,
        row.category_name,
        row.content_code,
        row.content_name,
        row.pack_code,
        row.pack_name,
        row.item_qty_per_box,
        row.item_added_date,
        row.item_updated_date,
        row.hsn_sac_code,
        row.hsn_sac_name
      );
    });

    const query = `
      INSERT INTO item_master (
        item_code, item_name, item_short_name, item_full_name,
        brand_code, brand_name, category_code, category_name,
        content_code, content_name, pack_code, pack_name,
        item_qty_per_box, item_added_date, item_updated_date,
        hsn_sac_code, hsn_sac_name
      )
      VALUES ${placeholders.join(",")}
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

    await pool.query(query, values);

    res.status(200).json({
      message: "Bulk upload successful",
      totalItems: data.length,
    });
  } catch (err) {
    console.error("Bulk Upload Error:", err.message);
    res.status(500).json({ error: "Failed to upload items", details: err.message });
  }
});

// Bulk stock upload
router.post('/stockbulk-upload-csv', async (req, res) => {
  const results = req.body.stocks;
  if (!results || !Array.isArray(results)) return res.status(400).json({ success: false, error: 'No data sent' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const query = `
      INSERT INTO stock_batches
      (c_item_code, item_name, item_qty_per_box, batch_no, stock_bal_qty, expiry_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const insertedStocks = [];
    for (const stock of results) {
      const values = [
        stock.c_item_code,
        stock.item_name,
        stock.item_qty_per_box,
        stock.batch_no,
        stock.stock_bal_qty,
        stock.expiry_date
      ];
      const result = await client.query(query, values);
      insertedStocks.push(result.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, insertedStocks });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;