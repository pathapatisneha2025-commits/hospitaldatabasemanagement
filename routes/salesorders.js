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
router.post("/assign-deliveryboy", async (req, res) => {
  const { orderId, employee_id } = req.body;

  // 🔹 Validation
  if (!orderId || !employee_id) {
    return res
      .status(400)
      .json({ error: "Order ID and Employee ID are required." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ✅ Check if order exists
    const orderCheck = await client.query(
      "SELECT id FROM sales_orders WHERE id = $1",
      [orderId]
    );

    if (orderCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }

    // ✅ Check if delivery boy exists
    const empCheck = await client.query(
      "SELECT id, full_name, role FROM employees WHERE id = $1",
      [employee_id]
    );

    if (empCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee not found." });
    }

    const employee = empCheck.rows[0];

    // ✅ Validate role
    if (employee.role.toLowerCase() !== "hd delivery") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "This employee is not a delivery person." });
    }

    // ✅ Assign delivery boy to the order
await client.query(
  `
  UPDATE sales_orders
  SET deliveryboy_id = $1
  WHERE id = $2
  `,
  [employee_id, orderId]
);



    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Delivery assigned to ${employee.full_name}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error assigning delivery:", error);
    res.status(500).json({ error: "Failed to assign delivery boy." });
  } finally {
    client.release();
  }
});


// -------------------------------------------------------------------
// GET SALES ORDERS by deliveryboy_id
// -------------------------------------------------------------------
router.get("/by-deliveryboy/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT *
      FROM sales_orders
      WHERE deliveryboy_id = $1
      ORDER BY id DESC
    `;

    const result = await pool.query(query, [id]);

    res.json({
      success: true,
      orders: result.rows
    });

  } catch (err) {
    console.error("Fetch by DeliveryBoy Error:", err);
    res.status(500).json({ success: false, error: "Server Error" });
  }
});
router.post("/generate-invoice/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    // Fetch order
    const result = await pool.query(
      "SELECT * FROM sales_orders WHERE id = $1",
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, error: "Order not found" });
    }

    const order = result.rows[0];
    const picked = order.picked_items || [];
    const items = order.items || [];

    let totalAmount = 0;

    // Loop through picked items and match with items array
    picked.forEach((p) => {
      const matched = items.find((i) => i.item_name === p.item_name);

      if (matched) {
        totalAmount += Number(p.picked_qty) * Number(matched.rate);
      }
    });

    // Save invoice record
    await pool.query(
      `UPDATE sales_orders 
       SET invoice_generated = true, invoice_amount = $1 
       WHERE id = $2`,
      [totalAmount, orderId]
    );

    res.json({
      success: true,
      message: "Invoice generated successfully",
      amount: totalAmount,
    });

  } catch (err) {
    console.error("Invoice Error:", err);
    res.status(500).json({ success: false, error: "Server Error" });
  }
});


module.exports = router;
