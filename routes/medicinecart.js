const express = require("express");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary"); // ✅ Your Cloudinary config
const pool = require("../db"); // ✅ PostgreSQL pool

const router = express.Router();

// ✅ Test route
router.get("/", (req, res) => {
  res.send("Cart route working");
});

// ✅ Multer storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "cart_items",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => Date.now() + "-" + file.originalname,
  },
});

const upload = multer({ storage });

const csvStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const csvUpload = multer({ storage: csvStorage });

// -------------------- ADD ITEM TO CART WITH MULTIPLE IMAGES --------------------
router.post("/add", upload.array("images", 5), async (req, res) => {
  const {
    patient_id,
    employeeid,
    subadmin_id,
    name,
    category,
    manufacturer,
    batch_number,
    pack_size,
    description,
    price,
    stock,
    quantity,
  } = req.body;

  // Validate that exactly one of patient_id, employeeid, or subadmin_id is provided
  const providedIds = [patient_id, employeeid, subadmin_id].filter(id => id);
  if (providedIds.length !== 1) {
    return res.status(400).json({
      error: "Provide exactly one of patient_id, employeeid, or subadmin_id."
    });
  }

  const files = req.files || [];

  try {
    const imageUrls = files.map(file => file.path);

    const result = await pool.query(
      `INSERT INTO cart
       (patient_id, employeeid, subadmin_id, name, category, manufacturer, batch_number, pack_size, description, price, stock, quantity, images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        patient_id || null,
        employeeid || null,
        subadmin_id || null,
        name,
        category || null,
        manufacturer || null,
        batch_number || null,
        pack_size || null,
        description || null,
        price ? parseFloat(price) : null,
        stock ? parseInt(stock) : 0,
        quantity ? parseInt(quantity) : 1,
        imageUrls,
      ]
    );

    res.status(201).json({
      message: "Item added to cart successfully",
      item: result.rows[0],
    });
  } catch (err) {
    console.error("Error adding cart item:", err.message);
    res.status(500).json({ error: "Cart item creation failed" });
  }
});




// -------------------- GET ALL CART ITEMS --------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM cart");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching cart items:", err.message);
    res.status(500).json({ error: "Failed to fetch cart items" });
  }
});

router.post("/bulk-upload", csvUpload.single("csv"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "CSV file required" });

  const items = [];
  fs.createReadStream(req.file.path)
    .pipe(csvParser())
    .on("data", row => {
      items.push({
        patient_id: row.patient_id || null,
        employeeid: row.employeeid || null,
        subadmin_id: row.subadmin_id || null,
        name: row.name || null,
        category: row.category || null,
        manufacturer: row.manufacturer || null,
        batch_number: row.batch_number || null,
        pack_size: row.pack_size || null,
        description: row.description || null,
        price: row.price ? parseFloat(row.price) : null,
        stock: row.stock ? parseInt(row.stock) : 0,
        quantity: row.quantity ? parseInt(row.quantity) : 1,
        images: row.images ? row.images.split(";") : [], // optional semicolon-separated URLs
      });
    })
    .on("end", async () => {
      try {
        const insertedItems = [];
        for (const item of items) {
          const providedIds = [item.patient_id, item.employeeid, item.subadmin_id].filter(id => id);
          if (providedIds.length !== 1) continue;

          const result = await pool.query(
            `INSERT INTO cart
             (patient_id, employeeid, subadmin_id, name, category, manufacturer, batch_number, pack_size, description, price, stock, quantity, images)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [
              item.patient_id,
              item.employeeid,
              item.subadmin_id,
              item.name,
              item.category,
              item.manufacturer,
              item.batch_number,
              item.pack_size,
              item.description,
              item.price,
              item.stock,
              item.quantity,
              item.images,
            ]
          );
          insertedItems.push(result.rows[0]);
        }

        // Delete temporary CSV
        fs.unlinkSync(req.file.path);

        res.status(201).json({
          message: `Successfully inserted ${insertedItems.length} cart items`,
          items: insertedItems,
        });
      } catch (err) {
        console.error("CSV bulk upload error:", err.message);
        res.status(500).json({ error: "Failed to upload CSV" });
      }
    })
    .on("error", err => {
      console.error("CSV parsing error:", err.message);
      res.status(500).json({ error: "Failed to parse CSV" });
    });
});

// -------------------- GET CART ITEMS BY PATIENT --------------------
router.get("/:patient_id", async (req, res) => {
  const { patient_id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM cart WHERE patient_id = $1", [patient_id]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching cart items:", err.message);
    res.status(500).json({ error: "Failed to fetch cart items" });
  }
});
// Get cart items by employeeid
router.get("/employee/:employeeid", async (req, res) => {
  const { employeeid } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM cart WHERE employeeid = $1`,
      [employeeid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No cart items found for this employee." });
    }

    res.status(200).json({
      employeeid,
      items: result.rows,
    });
  } catch (err) {
    console.error("Error fetching cart items:", err.message);
    res.status(500).json({ error: "Failed to fetch cart items" });
  }
});

// -------------------- GET CART ITEMS BY SUBADMIN --------------------
router.get("/subadmin/:subadmin_id", async (req, res) => {
  const { subadmin_id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM cart WHERE subadmin_id = $1",
      [subadmin_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No cart items found for this subadmin." });
    }

    res.status(200).json({
      subadmin_id,
      items: result.rows,
    });
  } catch (err) {
    console.error("Error fetching cart items for subadmin:", err.message);
    res.status(500).json({ error: "Failed to fetch cart items" });
  }
});


// -------------------- UPDATE CART ITEM --------------------
router.put("/:id", upload.array("images", 5), async (req, res) => {
  const { id } = req.params;
  const {
    name,
    category,
    manufacturer,
    batch_number,
    pack_size,
    description,
    price,
    stock,
    quantity,
  } = req.body;
  const files = req.files || [];

  try {
    // Get existing cart item
    const existing = await pool.query("SELECT * FROM cart WHERE id = $1", [id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: "Cart item not found" });
    }

    const oldItem = existing.rows[0];
    let imageUrls = oldItem.images || [];

    // If new images uploaded, replace old ones in Cloudinary
    if (files.length > 0) {
      // Delete old images from Cloudinary
      const getPublicIdFromUrl = (url) => {
        const parts = url.split("/");
        const filename = parts[parts.length - 1].split(".")[0];
        return `cart_items/${filename}`;
      };

      await Promise.all(
        imageUrls.map((url) => {
          const publicId = getPublicIdFromUrl(url);
          return cloudinary.uploader.destroy(publicId);
        })
      );

      // Save new image URLs
      imageUrls = files.map((file) => file.path);
    }

    // Update DB
    const result = await pool.query(
      `UPDATE cart
       SET name=$1, category=$2, manufacturer=$3, batch_number=$4, pack_size=$5,
           description=$6, price=$7, stock=$8, quantity=$9, images=$10
       WHERE id=$11 RETURNING *`,
      [
        name || oldItem.name,
        category || oldItem.category,
        manufacturer || oldItem.manufacturer,
        batch_number || oldItem.batch_number,
        pack_size || oldItem.pack_size,
        description || oldItem.description,
        price ? parseFloat(price) : oldItem.price,
        stock ? parseInt(stock) : oldItem.stock,
        quantity ? parseInt(quantity) : oldItem.quantity,
        imageUrls,
        id,
      ]
    );

    res.status(200).json({
      message: "Cart item updated successfully",
      item: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating cart item:", err.message);
    res.status(500).json({ error: "Failed to update cart item" });
  }
});

// -------------------- DELETE CART ITEM AND CLOUDINARY IMAGES --------------------
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  const getPublicIdFromUrl = (url) => {
    const parts = url.split("/");
    const filename = parts[parts.length - 1].split(".")[0];
    return `cart_items/${filename}`;
  };

  try {
    const result = await pool.query("SELECT * FROM cart WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Cart item not found" });
    }

    const item = result.rows[0];
    const imageUrls = item.images || [];

    // Delete Cloudinary images
    await Promise.all(
      imageUrls.map((url) => {
        const publicId = getPublicIdFromUrl(url);
        return cloudinary.uploader.destroy(publicId);
      })
    );

    // Delete from DB
    await pool.query("DELETE FROM cart WHERE id = $1", [id]);

    res.status(200).json({ message: "Cart item deleted successfully" });
  } catch (err) {
    console.error("Error deleting cart item:", err.message);
    res.status(500).json({ error: "Failed to delete cart item" });
  }
});

module.exports = router;
