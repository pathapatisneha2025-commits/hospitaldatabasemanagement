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
// Generate Invoice for Sales Order
router.post("/generate-invoice/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    // Fetch sales order
    const orderResult = await pool.query(
      "SELECT * FROM sales_orders WHERE id = $1",
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = orderResult.rows[0];
    const picked = order.picked_items || [];
    const items = order.items || [];

    // Build medicines array
    const medicines = picked.map((p) => {
      const match = items.find((i) => i.item_name === p.item_name);

      return {
        name: p.item_name,
        quantity: Number(p.picked_qty),
        unitPrice: match ? Number(match.rate) : 0,
        total: match ? Number(match.rate) * Number(p.picked_qty) : 0,
      };
    });

    // Calculate total amount
    const totalAmount = medicines.reduce((sum, m) => sum + m.total, 0);

    // Generate invoice number
    const invoiceNo = "SOI-" + Date.now();  // SOI = Sales Order Invoice

    // Save invoice into sales_order_invoices table
    const insertInvoice = await pool.query(
      `INSERT INTO sales_order_invoices 
       (invoice_no, order_id, customer_name, customer_mobile, address, medicines, total_amount, payment_mode, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW() AT TIME ZONE 'Asia/Kolkata')
       RETURNING *`,
      [
        invoiceNo,
        orderId,
        order.customer_name,
        order.mobile,
        order.address,
        JSON.stringify(medicines),
        totalAmount,
        order.payment_mode,
      ]
    );

    res.json({
      success: true,
      message: "Invoice generated successfully",
      data: { ...insertInvoice.rows[0], medicines },
    });

  } catch (error) {
    console.error("Sales Order Invoice Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});
router.post("/delivery/address-change/request", async (req, res) => {
  const { order_id, delivery_boy_id, old_address, new_address, reason } = req.body;

  try {
    const query = `
      INSERT INTO address_change_requests
      (order_id, delivery_boy_id, old_address, new_address, reason, status)
      VALUES ($1,$2,$3,$4,$5,'pending')
      RETURNING *
    `;

    const result = await pool.query(query, [
      order_id,
      delivery_boy_id,
      old_address,
      new_address,
      reason
    ]);

    res.json({ success: true, request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to submit request" });
  }
});

module.exports = router;
