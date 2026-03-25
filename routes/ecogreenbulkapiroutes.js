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
// Helper: Convert Excel date serial to YYYY-MM-DD
function excelDateToJSDate(serial) {
  if (!serial) return null;
  // Excel's day 1 is 1900-01-01
  const utc_days = Math.floor(serial - 25569); 
  const utc_value = utc_days * 86400; 
  const date_info = new Date(utc_value * 1000);
  return date_info.toISOString().split("T")[0]; // YYYY-MM-DD
}

async function insertBulk(rows) {
  const query = `
    INSERT INTO local_customers
      (brcode, lc_code, lc_name, added_date, age, gender, address1, address2, address3,
       city, pin, mobile_no, mail_id, parent_code, parent_name)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `;

  let count = 0;
  for (const row of rows) {
    let addedDate = row.added_date;

    // Convert Excel serial number to date string if needed
    if (typeof addedDate === "number") {
      addedDate = excelDateToJSDate(addedDate);
    }

    const values = [
      row.brcode || "",
      row.lc_code || "",
      row.lc_name || "",
      addedDate || null,
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

    await pool.query(query, values); // simple insert without ON CONFLICT
    count++;
  }

  return count;
}

router.post('/purchase-order/bulk', upload.single('file'), async (req, res) => { 
  if (!req.file) return res.status(400).json({ success: false, message: 'File required' });

  const filePath = req.file.path;
  const orders = [];

  try {
    if (req.file.originalname.endsWith('.csv')) {
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          const details = row.details ? JSON.parse(row.details) : [];
          orders.push([row.br_code, row.year, row.prefix, row.srno, row.custcode, row.custname, row.refcode, row.refname, parseFloat(row.total), JSON.stringify(details)]);
        })
        .on('end', async () => {
          // insert into DB...
          fs.unlinkSync(filePath);
          res.json({ success: true, inserted: orders.length });
        });
    } else if (req.file.originalname.endsWith('.xlsx')) {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      data.forEach(row => {
        const details = row.details ? JSON.parse(row.details) : [];
        orders.push([row.br_code, row.year, row.prefix, row.srno, row.custcode, row.custname, row.refcode, row.refname, parseFloat(row.total), JSON.stringify(details)]);
      });

      // insert into DB...
      fs.unlinkSync(filePath);
      res.json({ success: true, inserted: orders.length });
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported file type' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});
module.exports = router;