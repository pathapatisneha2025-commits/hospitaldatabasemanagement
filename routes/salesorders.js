const express = require("express");
const router = express.Router();
const pool = require("../db");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary");

// ---------------- Cloudinary Storage ------------------
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "prescriptions",
    allowed_formats: ["jpg", "png", "jpeg", "pdf"],
    public_id: (req, file) => Date.now() + "-" + file.originalname.replace(/\s/g, "")
  },
});

const upload = multer({ storage });


// -------------------------------------------------------------------
// CREATE SALES ORDER  (Only ONE table: sales_orders)
// -------------------------------------------------------------------
router.post("/create", upload.single("prescription"), async (req, res) => {
  try {
    const {
      customer_name,
      mobile,
      address,
      landmark,
      pincode,
      payment_mode,
      delivery_type,
      prescription_required,
      items
    } = req.body;

    const prescription_image = req.file ? req.file.path : null;

    // Parse items safely
    let parsedItems = [];
    try {
      parsedItems = JSON.parse(items);   // array of { item_name, quantity }
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: "Invalid JSON format for items"
      });
    }

    const insertQuery = `
      INSERT INTO sales_orders (
        customer_name, mobile, address, landmark, pincode,
        payment_mode, delivery_type, prescription_required,
        prescription_image, items
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `;

    const values = [
      customer_name,
      mobile,
      address,
      landmark,
      pincode,
      payment_mode,
      delivery_type,
      prescription_required === "true",
      prescription_image,
      JSON.stringify(parsedItems)    // ← REQUIRED
    ];

    const result = await pool.query(insertQuery, values);

    res.json({
      success: true,
      message: "Sales order created successfully!",
      order_id: result.rows[0].id
    });

  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
});



// -------------------------------------------------------------------
// GET ALL ORDERS
// -------------------------------------------------------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM sales_orders ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Get All Orders Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});


// -------------------------------------------------------------------
// GET SINGLE ORDER
// -------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM sales_orders WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Order not found" });

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Get Order Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

module.exports = router;
