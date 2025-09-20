const express = require("express");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary"); // ✅ Your Cloudinary config
const pool = require("../db"); // ✅ PostgreSQL pool

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

// ✅ Add medicine with images
router.post("/add", upload.array("images", 5), async (req, res) => {
  const { name, category, manufacturer, batch_number, pack_size, description, price, stock } = req.body;
  console.log("Files received:", req.files);
  console.log("Body received:", req.body);
  const files = req.files || [];

  try {
    const imageUrls = files.map((file) => file.path);

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
