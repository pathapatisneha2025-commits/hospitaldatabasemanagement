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

// -------------------- ADD ITEM TO CART WITH MULTIPLE IMAGES --------------------
router.post("/add", upload.array("images", 5), async (req, res) => {
  const { patient_id, name, category, manufacturer, batch_number, pack_size, description, price, stock, quantity } = req.body;
  const files = req.files || [];

  try {
    const imageUrls = files.map((file) => file.path);
    console.log("Image URLs to insert:", imageUrls);

    const result = await pool.query(
      `INSERT INTO cart
       (patient_id, name, category, manufacturer, batch_number, pack_size, description, price, stock, quantity, images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        patient_id,
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
    const result = await pool.query("SELECT * FROM cart ORDER BY created_at DESC");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching cart items:", err.message);
    res.status(500).json({ error: "Failed to fetch cart items" });
  }
});

// -------------------- GET CART ITEMS BY PATIENT --------------------
router.get("/:patient_id", async (req, res) => {
  const { patient_id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM cart WHERE patient_id = $1 ORDER BY created_at DESC", [patient_id]);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching cart items:", err.message);
    res.status(500).json({ error: "Failed to fetch cart items" });
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
    // Fetch cart item
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
