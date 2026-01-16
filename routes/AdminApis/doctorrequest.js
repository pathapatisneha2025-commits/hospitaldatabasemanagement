const express = require("express");
const router = express.Router();
const pool = require('../../db');
const cloudinary = require("../../cloudinary");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const path = require("path");

// Configure Cloudinary storage for Multer
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "stationary_inventory",          // Cloudinary folder
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });

// ---------------------- ROUTES ----------------------

// GET all inventory items
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM stationaryinventory ORDER BY id");
    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

// ADD item (Admin/Subadmin) with Cloudinary image upload
router.post("/add", upload.single("image"), async (req,res)=>{
  try {
    const { name, stock, price, supplier } = req.body;
    const image_url = req.file?.path || null; // Multer + CloudinaryStorage sets path to the uploaded URL

    const dbResult = await pool.query(
      "INSERT INTO stationaryinventory (name, stock, price, supplier, image_url) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [name, stock || 0, price || 0, supplier || null, image_url]
    );

    res.json({ message: "Item added", item: dbResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add item" });
  }
});

// UPDATE item (Admin/Subadmin) with optional new image
router.put("/update/:id", upload.single("image"), async (req,res)=>{
  try {
    const { id } = req.params;
    const { name, stock, price, supplier } = req.body;
    const image_url = req.file?.path || req.body.image_url || null;

    const dbResult = await pool.query(
      "UPDATE stationaryinventory SET name=$1, stock=$2, price=$3, supplier=$4, image_url=$5 WHERE id=$6 RETURNING *",
      [name, stock, price, supplier, image_url, id]
    );

    res.json({ message: "Item updated", item: dbResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update item" });
  }
});

// DELETE item (Admin only)
router.delete("/delete/:id", async (req,res)=>{
  try {
    const { id } = req.params;
    const dbResult = await pool.query("DELETE FROM stationaryinventory WHERE id=$1 RETURNING *", [id]);
    res.json({ message: "Item deleted", item: dbResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete item" });
  }
});

module.exports = router;
