const express = require("express");
const router = express.Router();
const pool = require("../db");
const multer = require("multer");
const path = require("path");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary");

// ---------------- Cloudinary Storage ------------------
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "prescriptions",
    allowed_formats: ["jpg", "png", "jpeg", "pdf"],
    public_id: (req, file) => Date.now() + "-" + file.originalname.replace(/\s/g, ""),
  },
});

const upload = multer({ storage });


// -----------------------------------------------------------
// CREATE ORDER  (orders + order_items)
// -----------------------------------------------------------
router.post("/create", upload.single("prescription"), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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

    // 1️⃣ Insert into orders table
    const insertOrder = `
      INSERT INTO orders (
        customer_name, mobile, address, landmark, pincode,
        payment_mode, delivery_type, prescription_required,
        prescription_image
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `;

    const orderValues = [
      customer_name,
      mobile,
      address,
      landmark,
      pincode,
      payment_mode,
      delivery_type,
      prescription_required === "true",
      prescription_image,
    ];

    const orderResult = await client.query(insertOrder, orderValues);
    const order_id = orderResult.rows[0].id;

    // 2️⃣ Insert items into order_items table
    const parsedItems = JSON.parse(items);

    for (const item of parsedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, item_name, quantity)
         VALUES ($1, $2, $3)`,
        [order_id, item.item_name, item.quantity]
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Order created successfully!",
      order_id,
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create Order Error:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  } finally {
    client.release();
  }
});


// -----------------------------------------------------------
// GET ALL ORDERS (with items)
// -----------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const orders = await pool.query("SELECT * FROM orders ORDER BY id DESC");

    const order_items = await pool.query("SELECT * FROM order_items");

    // Group items by order_id
    const mapped = orders.rows.map(order => ({
      ...order,
      items: order_items.rows.filter(i => i.order_id === order.id)
    }));

    res.json(mapped);

  } catch (err) {
    console.error("Get All Orders Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});


// -----------------------------------------------------------
// GET SINGLE ORDER
// -----------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const orderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const itemsRes = await pool.query(
      "SELECT * FROM order_items WHERE order_id = $1",
      [id]
    );

    res.json({
      ...orderRes.rows[0],
      items: itemsRes.rows,
    });

  } catch (err) {
    console.error("Get Order Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

module.exports = router;
