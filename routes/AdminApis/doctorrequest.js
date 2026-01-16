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
router.post("/add", upload.array("images", 5), async (req, res) => {
  try {
    const { name, stock, price, supplier } = req.body;

    // req.files is an array now
    const imageUrls = req.files?.map(file => file.path) || [];

    const dbResult = await pool.query(
      "INSERT INTO stationaryinventory (name, stock, price, supplier, image_urls) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [name, stock || 0, price || 0, supplier || null, imageUrls] // make sure image_urls is array type in DB
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




/* ============================
   1️⃣ Submit a request
============================ */
router.post("/submitrequest", async (req, res) => {
  const client = await pool.connect();
  try {
    const { employee_id, department, items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items selected" });
    }

    const insertQuery = `
      INSERT INTO inventory_requests (employee_id, department, items)
      VALUES ($1, $2, $3)
      RETURNING id, employee_id, department, items, status, created_at
    `;

    const result = await client.query(insertQuery, [
      employee_id,
      department,
      JSON.stringify(items),
    ]);

    res.status(201).json({
      message: "Request submitted",
      request: result.rows[0],
    });
  } catch (error) {
    console.error("Error submitting request:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

/* ============================
   2️⃣ Get all requests (Admin)
============================ */
router.get("/allrequest", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM inventory_requests ORDER BY created_at DESC"
    );
    res.json({ requests: result.rows });
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ============================
   Approve or Reject a request
============================ */
router.post("/update-request/:id", async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status } = req.body; // expects 'approved' or 'rejected'

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const result = await pool.query(
      "UPDATE inventory_requests SET status = $1 WHERE id = $2 RETURNING *",
      [status, requestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json({ message: `Request ${status}`, request: result.rows[0] });
  } catch (error) {
    console.error("Error updating request:", error);
    res.status(500).json({ message: "Server error" });
  }
});



module.exports = router;
