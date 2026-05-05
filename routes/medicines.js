const express = require("express");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary"); // ✅ Your Cloudinary config
const pool = require("../db"); // ✅ PostgreSQL pool
const csv = require("csv-parser");
const stream = require("stream");
const router = express.Router();

// ✅ Test route
router.get("/", (req, res) => {
  res.send("Medicines route working");
});

// ✅ Multer storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "medicines",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => Date.now() + "-" + file.originalname,
  },
});

const upload = multer({ storage });
const csvUpload = multer({ storage: multer.memoryStorage() });

// ✅ Add medicine with images
router.post("/add", upload.array("images", 5), async (req, res) => {
  const { name, category, manufacturer, batch_number, pack_size, description, price, stock } = req.body;
  console.log("Files received:", req.files);
  console.log("Body received:", req.body);
  const files = req.files || [];

  try {
    const imageUrls = files.map((file) => file.path);
  console.log("Image URLs to insert:", imageUrls);

    const result = await pool.query(
      `INSERT INTO medicines 
       (name, category, manufacturer, batch_number, pack_size, description, price, stock, images, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING *`,
      [
        name,
        category || null,
        manufacturer || null,
        batch_number || null,
        pack_size || null,
        description || null,
        price ? parseFloat(price) : null,
        stock ? parseInt(stock) : 0,
        imageUrls,
      ]
    );

    res.status(201).json({
      message: "Medicine added successfully",
      medicine: result.rows[0],
    });
  } catch (err) {
    console.error("Error adding medicine:", err.message);
    res.status(500).json({ error: "Medicine creation failed" });
  }
});

// ✅ Get all medicines
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM medicines ORDER BY created_at DESC");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching medicines:", err.message);
    res.status(500).json({ error: "Failed to fetch medicines" });
  }
});

router.get("/stock-details/customer", async (req, res) => {
  try {
    let { page = 1, limit = 20, search = "" } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `
      SELECT 
        c_item_code,
        MAX(id) AS id,
        MAX(item_name) AS item_name,
        SUM(stock_bal_qty) AS stock_bal_qty,
        MAX(mrp) AS mrp,
        MAX(sale_rate) AS sale_rate,
        MAX(expiry_date) AS expiry_date,
        MAX(image) AS image,
        MAX(description) AS description
      FROM stock_batches
      WHERE 
        is_visible_to_customer IS NOT false
        AND stock_bal_qty > 0
        AND ($1 = '' OR item_name ILIKE $1 OR c_item_code ILIKE $1)
      GROUP BY c_item_code
      ORDER BY item_name ASC
      LIMIT $2 OFFSET $3
      `,
      [`%${search}%`, limit, offset]
    );

    const formatted = result.rows.map((item) => {
      const mrp = parseFloat(item.mrp || 0);
      const sale = parseFloat(item.sale_rate || 0);

      const discount = mrp > sale ? mrp - sale : 0;
      const discountPercent =
        mrp > 0 ? ((discount / mrp) * 100).toFixed(2) : "0";

      return {
        id: item.id,
        c_item_code: item.c_item_code,
        item_name: item.item_name,

        // ✅ now this is SUM of all batches
        stock_bal_qty: Number(item.stock_bal_qty),

        mrp,
        sale_rate: sale,
        discount: Number(discount.toFixed(2)),
        discount_percent: discountPercent,
        expiry_date: item.expiry_date,
        image: item.image,
        description: item.description,

        // still useful for UI
        is_out_of_stock: Number(item.stock_bal_qty) <= 0,
      };
    });

    res.json({
      success: true,
      products: formatted,
      page,
      limit,
      hasMore: formatted.length === limit,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/stock-batches/bulk-visibility", async (req, res) => {
  const { ids } = req.body;

  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids must be non-empty array" });
    }

    const result = await pool.query(
      `
      UPDATE stock_batches
      SET is_visible_to_customer = false
      WHERE id = ANY($1)
      RETURNING id
      `,
      [ids]
    );

    res.json({
      success: true,
      updatedCount: result.rowCount,
      updatedIds: result.rows.map((r) => r.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/stock-details/customer/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        id,
        c_item_code,
        item_name,
        stock_bal_qty,
        mrp,
        sale_rate,
        expiry_date,
        image,
        description
      FROM stock_batches
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const item = result.rows[0];

    const mrp = parseFloat(item.mrp || 0);
    const sale = parseFloat(item.sale_rate || 0);

    const discount = mrp > sale ? mrp - sale : 0;
    const discountPercent =
      mrp > 0 ? ((discount / mrp) * 100).toFixed(2) : "0";

    const formatted = {
      id: item.id,
      c_item_code: item.c_item_code,
      item_name: item.item_name,
      stock_bal_qty: item.stock_bal_qty,
      mrp,
      sale_rate: sale,
      discount: Number(discount.toFixed(2)),
      discount_percent: discountPercent,
      expiry_date: item.expiry_date,
      image: item.image,
      description: item.description,
      is_out_of_stock: Number(item.stock_bal_qty) <= 0,
    };

    res.json({
      success: true,
      product: formatted,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
router.post("/bulk-upload", csvUpload.single("csv"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "CSV file required" });
  }

  const medicines = [];
  const readable = new stream.Readable();
  readable._read = () => {};
  readable.push(req.file.buffer);
  readable.push(null);

  readable
    .pipe(csv())
    .on("data", (row) => {
      const formattedRow = {};

      // Loop through all CSV columns dynamically
      Object.keys(row).forEach((key) => {
        let value = row[key];

        if (value === "") {
          formattedRow[key] = null;
        } 
        else if (key === "price") {
          formattedRow[key] = parseFloat(value);
        } 
        else if (key === "stock") {
          formattedRow[key] = parseInt(value);
        } 
        else if (key === "images") {
          formattedRow[key] = value.split(";");
        } 
        else {
          formattedRow[key] = value;
        }
      });

      medicines.push(formattedRow);
    })
    .on("end", async () => {
      try {
        const insertedMedicines = [];

        for (const med of medicines) {
          const keys = Object.keys(med);

          const columns = keys.join(",");
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(",");
          const values = keys.map((k) => med[k]);

          const query = `
            INSERT INTO medicines (${columns}, created_at)
            VALUES (${placeholders}, NOW())
            RETURNING *
          `;

          const result = await pool.query(query, values);
          insertedMedicines.push(result.rows[0]);
        }

        res.status(201).json({
          message: `Successfully inserted ${insertedMedicines.length} medicines`,
          medicines: insertedMedicines,
        });
      } catch (err) {
        console.error("CSV bulk upload error:", err);
        res.status(500).json({ error: "Failed to insert CSV data" });
      }
    })
    .on("error", (err) => {
      console.error("CSV parsing error:", err);
      res.status(500).json({ error: "Failed to parse CSV" });
    });
});

// ✅ Get medicine by ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM medicines WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Medicine not found" });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching medicine:", err.message);
    res.status(500).json({ error: "Failed to fetch medicine" });
  }
});
// ✅ Update medicine
router.put("/update/:id", upload.array("images", 5), async (req, res) => {
  const { id } = req.params;
  const { name, category, manufacturer, batch_number, pack_size, description, price, stock } = req.body;
  const files = req.files || [];

  try {
    // Fetch existing medicine
    const existing = await pool.query("SELECT * FROM medicines WHERE id = $1", [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Medicine not found" });

    let imageUrls = existing.rows[0].images;

    // Replace images if new ones are uploaded
    if (files.length > 0) {
      const getPublicIdFromUrl = (url) => {
        const parts = url.split("/");
        const filename = parts[parts.length - 1].split(".")[0];
        return `medicines/${filename}`;
      };
      await Promise.all(imageUrls.map(url => cloudinary.uploader.destroy(getPublicIdFromUrl(url))));
      imageUrls = files.map(file => file.path);
    }

    const result = await pool.query(
      `UPDATE medicines
       SET name=$1, category=$2, manufacturer=$3, batch_number=$4, pack_size=$5, description=$6, price=$7, stock=$8, images=$9
       WHERE id=$10
       RETURNING *`,
      [
        name || existing.rows[0].name,
        category || existing.rows[0].category,
        manufacturer || existing.rows[0].manufacturer,
        batch_number || existing.rows[0].batch_number,
        pack_size || existing.rows[0].pack_size,
        description || existing.rows[0].description,
        price !== undefined ? parseFloat(price) : existing.rows[0].price,
        stock !== undefined ? parseInt(stock) : existing.rows[0].stock,
        imageUrls,
        id,
      ]
    );

    res.status(200).json({ message: "Medicine updated successfully", medicine: result.rows[0] });

  } catch (err) {
    console.error("Error updating medicine:", err.message);
    res.status(500).json({ error: "Failed to update medicine" });
  }
});


// ✅ Delete medicine and Cloudinary images
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  const getPublicIdFromUrl = (url) => {
    const parts = url.split("/");
    const filename = parts[parts.length - 1].split(".")[0];
    return `medicines/${filename}`;
  };

  try {
    // Fetch medicine
    const result = await pool.query("SELECT * FROM medicines WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Medicine not found" });
    }

    const medicine = result.rows[0];
    const imageUrls = medicine.images || [];

    // Delete Cloudinary images
    await Promise.all(
      imageUrls.map((url) => {
        const publicId = getPublicIdFromUrl(url);
        return cloudinary.uploader.destroy(publicId);
      })
    );

    // Delete from DB
    await pool.query("DELETE FROM medicines WHERE id = $1", [id]);

    res.status(200).json({ message: "Medicine deleted successfully" });
  } catch (err) {
    console.error("Error deleting medicine:", err.message);
    res.status(500).json({ error: "Failed to delete medicine" });
  }
});

module.exports = router;
