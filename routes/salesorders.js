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

    // 1️⃣ Parse items safely
    let parsedItems = [];
    try {
      parsedItems = JSON.parse(items);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON format for items" });
    }

    // 2️⃣ Fetch all custom fields (ignore 'active' if column missing)
    const fieldRes = await pool.query("SELECT field_key FROM order_form_fields");
    const dynamicFields = fieldRes.rows.map(f => f.field_key); // e.g., ['customercode', ...]

    // 3️⃣ Parse custom field values
    const customValues = req.body.custom_fields
      ? JSON.parse(req.body.custom_fields)
      : {};

    // 4️⃣ Prepare columns and values dynamically
    const columns = [
      "customer_name",
      "mobile",
      "address",
      "landmark",
      "pincode",
      "payment_mode",
      "delivery_type",
      "prescription_required",
      "prescription_image",
      "items",
      ...dynamicFields
    ];

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
      JSON.stringify(parsedItems),
      ...dynamicFields.map(key => customValues[key] || null)
    ];

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");

    // 5️⃣ Execute INSERT
    const insertQuery = `INSERT INTO sales_orders (${columns.join(",")}) VALUES (${placeholders}) RETURNING id`;
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

  if (!orderId || !employee_id) {
    return res.status(400).json({ error: "Order ID and Employee ID are required." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Check if order exists
   const orderRes = await client.query(
  "SELECT id, checked_items, items FROM sales_orders WHERE id = $1",
  [orderId]
);

    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }

    const order = orderRes.rows[0];
    const checkedItems = order.checked_items; // array of items with picked_qty

    if (!checkedItems || checkedItems.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No checked items found to assign." });
    }

    // Check if delivery boy exists
    const empCheck = await client.query(
      "SELECT id, full_name, role FROM employees WHERE id = $1",
      [employee_id]
    );

    if (empCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee not found." });
    }

    const employee = empCheck.rows[0];
    if (employee.role.toLowerCase() !== "hd delivery") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "This employee is not a delivery person." });
    }

    // ✅ Reduce stock for each checked item
   for (const item of order.items) {
  const { medicine_id, quantity } = item; // use quantity instead of picked_qty if needed

  const medRes = await client.query(
    "SELECT stock, name FROM medicines WHERE id = $1",
    [medicine_id]
  );

  if (medRes.rows.length === 0) {
    await client.query("ROLLBACK");
    return res.status(404).json({ error: `Medicine with ID ${medicine_id} not found.` });
  }

  const currentStock = medRes.rows[0].stock;
  const medName = medRes.rows[0].name;

  if (currentStock < quantity) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: `Insufficient stock for ${medName}.` });
  }

  await client.query(
    "UPDATE medicines SET stock = stock - $1 WHERE id = $2",
    [quantity, medicine_id]
  );
}
    // ✅ Assign delivery boy
    await client.query(
      "UPDATE sales_orders SET deliveryboy_id = $1, status = 'Assigned' WHERE id = $2",
      [employee_id, orderId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Delivery assigned to ${employee.full_name} and stock updated successfully.`,
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

    // Fetch order
    const orderResult = await pool.query(
      "SELECT * FROM sales_orders WHERE id = $1",
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = orderResult.rows[0];

    // Convert items JSON if needed
    const picked = typeof order.picked_items === "string" 
      ? JSON.parse(order.picked_items)
      : order.picked_items || [];

    const items = typeof order.items === "string"
      ? JSON.parse(order.items)
      : order.items || [];

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

    const totalAmount = medicines.reduce((sum, m) => sum + m.total, 0);

    const invoiceNo = "SOI-" + Date.now();

    // 1️⃣ INSERT invoice in invoice table
    const inserted = await pool.query(
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

    // 2️⃣ UPDATE sales_orders table → THIS WAS MISSING 🔥
    await pool.query(
      `UPDATE sales_orders 
       SET invoice_generated = TRUE,
           invoice_no = $1,
           total_amount = $2
       WHERE id = $3`,
      [invoiceNo, totalAmount, orderId]
    );

    res.json({
      success: true,
      message: "Invoice generated successfully",
      data: {
        ...inserted.rows[0],
        medicines,
        invoice_generated: true,
      },
    });

  } catch (error) {
    console.error("Sales Order Invoice Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

router.post("/delivery/address-change/request", async (req, res) => {
  const { 
    order_id, 
    delivery_boy_id, 
    old_address, 
    new_address, 
    new_landmark, 
    new_pincode, 
    reason 
  } = req.body;

  try {
    const query = `
      INSERT INTO address_change_requests
      (order_id, delivery_boy_id, old_address, new_address, new_landmark, new_pincode, reason, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
      RETURNING *
    `;

    const params = [
      order_id,
      delivery_boy_id,
      old_address,
      new_address,
      new_landmark,
      new_pincode,
      reason
    ];

    const result = await pool.query(query, params);

    res.json({ success: true, request: result.rows[0] });
  } catch (err) {
    console.error("Address Change Request Error:", err);
    res.status(500).json({ error: "Failed to submit address change request" });
  }
});


router.get("/delivery/address-change/all", async (req, res) => {
  try {
    const query = `
      SELECT 
        acr.*,
        e.full_name AS delivery_boy_name
      FROM address_change_requests acr
      LEFT JOIN employees e ON e.id = acr.delivery_boy_id
      ORDER BY acr.created_at DESC
    `;

    const result = await pool.query(query);
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load requests" });
  }
});
router.put("/delivery/address-change/update/:id", async (req, res) => {
  const requestId = req.params.id;
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({
      error: "Invalid status. Use 'approved' or 'rejected'"
    });
  }

  try {
    // 1. Fetch the address change request
    const reqData = await pool.query(
      `SELECT * FROM address_change_requests WHERE id = $1`,
      [requestId]
    );

    if (reqData.rows.length === 0) {
      return res.status(404).json({ error: "Address change request not found" });
    }

    const request = reqData.rows[0];

    let update;

    // 2. APPROVED → update request AND update sales_orders
    if (status === "approved") {
      // Update request status
      update = await pool.query(
        `UPDATE address_change_requests
         SET status = $1
         WHERE id = $2
         RETURNING *`,
        [status, requestId]
      );

      // Update the address in sales_orders table
      await pool.query(
        `UPDATE sales_orders
         SET address = $1,
             landmark = $2,
             pincode = $3
         WHERE id = $4`,
        [
          request.new_address,       // new address
          request.new_landmark,      // new landmark
          request.new_pincode,       // new pincode
          request.order_id           // the order id affected
        ]
      );
    }

    // 3. REJECTED → update only the request status
    else {
      update = await pool.query(
        `UPDATE address_change_requests
         SET status = $1
         WHERE id = $2
         RETURNING *`,
        [status, requestId]
      );
    }

    // 4. Response
    res.json({
      success: true,
      message: `Address change request ${status} successfully.`,
      request: update.rows[0],
    });

  } catch (err) {
    console.error("Address update error:", err);
    res.status(500).json({ error: "Failed to update request." });
  }
});

router.post("/sales/payment/collect", async (req, res) => {
  const { order_id, collected_by, amount_collected, payment_mode_collected, remarks } = req.body;

  try {
    const query = `
      UPDATE sales_orders
      SET 
        payment_collected = true,
        amount_collected = $1,
        payment_mode_collected = $2,
        collected_by = $3,
        collection_remarks = $4,
        collected_at = NOW()
      WHERE id = $5
      RETURNING *
    `;

    const result = await pool.query(query, [
      amount_collected,
      payment_mode_collected,
      collected_by,
      remarks,
      order_id
    ]);

    res.json({
      message: "Payment collected successfully",
      order: result.rows[0]
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Payment collection failed" });
  }
});


// UPDATE BUS FREIGHT OPTION
router.post("/bus/freight", async (req, res) => {
  const { orderId, freight_option_selected } = req.body;

  if (!orderId || !freight_option_selected) {
    return res.json({ success: false, error: "Missing fields" });
  }

  // Allowed freight options
  const validOptions = [
    "customer_to_bus",
    "BHM_to_bus",           // <- You requested this name
    "customer_to_company",
    "delivery_boy_to_bus",
  ];

  if (!validOptions.includes(freight_option_selected)) {
    return res.json({
      success: false,
      error: "Invalid freight option",
    });
  }

  try {
    const query = `
      UPDATE sales_orders
      SET freight_option_selected = $1
      WHERE id = $2
      RETURNING id, freight_option_selected, invoice_generated;
    `;

    // Corrected: Use freight_option_selected in SQL parameter
    const result = await pool.query(query, [
      freight_option_selected,
      orderId,
    ]);

    if (result.rowCount === 0) {
      return res.json({ success: false, error: "Order not found" });
    }

    return res.json({
      success: true,
      message: "Freight option saved",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Freight Save Error:", err);
    return res.json({
      success: false,
      error: "DB Error",
      details: err.message,
    });
  }
});


router.post("/update-busdelivery", async (req, res) => {
  const {
    orderId,
    deliveryType,
    busDetails,
    status
  } = req.body;

  try {
    const query = `
      UPDATE sales_orders
      SET 
        delivery_type = $1,
        busdetail = $2,
        status = $3
      WHERE id = $4
      RETURNING *;
    `;

    const values = [
      deliveryType,          // "bus"
      busDetails,            // JSON
      status || "pending",
      orderId
    ];

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Sales order not found"
      });
    }

    res.json({
      success: true,
      message: "Bus delivery details saved successfully",
      order: result.rows[0]
    });

  } catch (err) {
    console.error("BUS DELIVERY (SALES) ERROR:", err);
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

router.post("/complete-delivery", async (req, res) => {
  const { orderId } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE sales_orders
      SET status = 'Delivered'
      WHERE id = $1
      `,
      [orderId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      success: true,
      message: "Delivery completed successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;
