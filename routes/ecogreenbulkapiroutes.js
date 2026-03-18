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
router.post("/stockbulk-upload-csv", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // Read Excel / CSV
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    if (!data || data.length === 0)
      return res.status(400).json({ error: "Empty file" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const placeholders = [];
      const values = [];

      data.forEach((row, index) => {
        const i = index * 6; // 6 columns
        placeholders.push(
          `($${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}, $${i + 6})`
        );

        values.push(
          row.c_item_code,
          row.item_name,
          row.item_qty_per_box,
          row.batch_no,
          row.stock_bal_qty,
          row.expiry_date
        );
      });

      const query = `
        INSERT INTO stock_batches
          (c_item_code, item_name, item_qty_per_box, batch_no, stock_bal_qty, expiry_date)
        VALUES ${placeholders.join(",")};
      `;

      const result = await client.query(query, values);

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        insertedStocks: result.rows,
        totalStocks: result.rowCount,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("DB Error:", err);
      res.status(500).json({ success: false, error: "Database error", details: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Bulk Upload Error:", err);
    res.status(500).json({ success: false, error: "Failed to process file", details: err.message });
  }
});


router.post("/local-customer/bulk", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: "No file uploaded" });

    const ext = file.originalname.split(".").pop().toLowerCase();
    let data = [];

    // --- CSV File ---
    if (ext === "csv") {
      const csvString = file.buffer.toString("utf-8");
      data = parse(csvString, {
        columns: true,       // first row as header
        skip_empty_lines: true,
      });
    } 
    // --- Excel File ---
    else if (ext === "xls" || ext === "xlsx") {
      const workbook = XLSX.read(file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      data = XLSX.utils.sheet_to_json(sheet);
    } 
    else {
      return res.status(400).json({ success: false, error: "Invalid file type" });
    }

    if (!data || data.length === 0)
      return res.status(400).json({ success: false, error: "Empty file" });

    // Insert into database
    const insertedCount = await insertBulk(data);

    res.status(200).json({
      success: true,
      inserted: insertedCount,
    });

  } catch (error) {
    console.error("Local Customer Bulk Upload Error:", error);
    res.status(500).json({ success: false, error: "Server Error", details: error.message });
  }
});

// ---------------------- INSERT BULK FUNCTION ----------------------
async function insertBulk(rows) {
  const query = `
    INSERT INTO local_customers
      (brcode, lc_code, lc_name, added_date, age, gender, address1, address2, address3,
       city, pin, mobile_no, mail_id, parent_code, parent_name)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (lc_code) DO UPDATE SET
      brcode = EXCLUDED.brcode,
      lc_name = EXCLUDED.lc_name,
      added_date = EXCLUDED.added_date,
      age = EXCLUDED.age,
      gender = EXCLUDED.gender,
      address1 = EXCLUDED.address1,
      address2 = EXCLUDED.address2,
      address3 = EXCLUDED.address3,
      city = EXCLUDED.city,
      pin = EXCLUDED.pin,
      mobile_no = EXCLUDED.mobile_no,
      mail_id = EXCLUDED.mail_id,
      parent_code = EXCLUDED.parent_code,
      parent_name = EXCLUDED.parent_name
  `;

  let count = 0;
  for (const row of rows) {
    const values = [
      row.brcode || "",
      row.lc_code || "",
      row.lc_name || "",
      row.added_date || "",
      row.age || "",
      row.gender || "",
      row.address1 || "",
      row.address2 || "",
      row.address3 || "",
      row.city || "",
      row.pin || "",
      row.mobile_no || "",
      row.mail_id || "",
      row.parent_code || "",
      row.parent_name || "",
    ];

    await pool.query(query, values);
    count++;
  }

  return count;
}
module.exports = router;