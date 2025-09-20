const express = require("express");
const router = express.Router();
const db = require("../db");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const path = require("path");

// -------------------- CLOUDINARY STORAGE --------------------
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "medicines",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });

// -------------------- ADD PRODUCT --------------------
router.post("/add", upload.array("images", 5), async (req, res) => {
  try {
    const { name, category, manufacturer, batch_number, pack_size, description, price, stock } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });

    const imageUrls = req.files ? req.files.map(file => file.path) : [];

    const query = `
      INSERT INTO medicines
      (name, category, manufacturer, batch_number, pack_size, description, price, stock, images)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;
    `;
    const values = [name, category, manufacturer, batch_number, pack_size, description, price || null, stock || 0, imageUrls];

    const result = await db.query(query, values);
    res.status(201).json({ message: "Product added successfully", product: result.rows[0] });
  } catch (err) {
    console.error("Error adding product:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// -------------------- GET ALL PRODUCTS --------------------
router.get("/all", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM medicines ORDER BY id DESC");
    res.status(200).json({ products: result.rows });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// -------------------- GET PRODUCT BY ID --------------------
router.get("/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    const result = await db.query("SELECT * FROM medicines WHERE id = $1", [productId]);

    if (result.rows.length === 0) return res.status(404).json({ error: "Product not found" });

    res.status(200).json({ product: result.rows[0] });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// -------------------- UPDATE PRODUCT --------------------
router.put("/update/:id", upload.array("images", 5), async (req, res) => {
  try {
    const productId = req.params.id;
    const { name, category, manufacturer, batch_number, pack_size, description, price, stock } = req.body;

    const existingProduct = await db.query("SELECT * FROM medicines WHERE id = $1", [productId]);
    if (existingProduct.rows.length === 0) return res.status(404).json({ error: "Product not found" });

    let imageUrls = existingProduct.rows[0].images;
    if (req.files && req.files.length > 0) imageUrls = req.files.map(file => file.path);

    const query = `
      UPDATE medicines
      SET 
        name = $1,
        category = $2,
        manufacturer = $3,
        batch_number = $4,
        pack_size = $5,
        description = $6,
        price = $7,
        stock = $8,
        images = $9
      WHERE id = $10
      RETURNING *;
    `;
    const values = [
      name || existingProduct.rows[0].name,
      category || existingProduct.rows[0].category,
      manufacturer || existingProduct.rows[0].manufacturer,
      batch_number || existingProduct.rows[0].batch_number,
      pack_size || existingProduct.rows[0].pack_size,
      description || existingProduct.rows[0].description,
      price !== undefined ? price : existingProduct.rows[0].price,
      stock !== undefined ? stock : existingProduct.rows[0].stock,
      imageUrls,
      productId
    ];

    const result = await db.query(query, values);
    res.status(200).json({ message: "Product updated successfully", product: result.rows[0] });
  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// -------------------- DELETE PRODUCT --------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const productId = req.params.id;
    const existingProduct = await db.query("SELECT * FROM medicines WHERE id = $1", [productId]);

    if (existingProduct.rows.length === 0) return res.status(404).json({ error: "Product not found" });

    await db.query("DELETE FROM medicines WHERE id = $1", [productId]);
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

module.exports = router;
