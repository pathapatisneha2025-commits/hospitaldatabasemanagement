const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL pool connection



// =======================
// 1. CREATE SALES ORDER
// =======================
router.post("/sales-order", async (req, res) => {
  try {
    const order = req.body;

    // ✅ SAFE JSON NORMALIZATION
    const pharmacy =
      typeof order.pharmacy === "string"
        ? JSON.parse(order.pharmacy)
        : order.pharmacy;

    const patient_address =
      typeof order.patient_address === "string"
        ? JSON.parse(order.patient_address)
        : order.patient_address;

    const order_items =
      typeof order.order_items === "string"
        ? JSON.parse(order.order_items)
        : order.order_items;

    const result = await pool.query(
      `INSERT INTO salesorders (
        order_id,
        order_no,
        created_at,
        createduser,
        payment_status,
        total_price,
        total_discount,
        order_for,
        delivered_by,
        patient_name,
        patient_contact_no,
        store_id,
        user_email,
        pharmacy,
        patient_address,
        status,
        order_items
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      ) RETURNING *`,
      [
        order.order_id,
        order.order_no,
        order.created_at,
        order.createduser,
        "PENDING",
        order.total_price,
        order.total_discount,
        order.order_for,
        order.delivered_by,
        order.patient_name,
        order.patient_contact_no,
        order.store_id,
        order.user_email,
        JSON.stringify(pharmacy),
        JSON.stringify(patient_address),
        "DRAFT",
        JSON.stringify(order_items),
      ]
    );

    res.json({
      success: true,
      message: "Sales order created",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("CREATE SALES ORDER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// 2. GET ALL SALES ORDERS
// =======================
router.get("/sales-order/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM salesorders ORDER BY id DESC"
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// 3. GET SINGLE ORDER
// =======================
router.get("/sales-order/:order_id", async (req, res) => {
  try {
    const { order_id } = req.params;

    const result = await pool.query(
      "SELECT * FROM salesorders WHERE order_id = $1",
      [order_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// 4. UPDATE SALES ORDER
// =======================
router.put("/sales-order/:order_id", async (req, res) => {
  try {
    const { order_id } = req.params;
    const order = req.body;

    const result = await pool.query(
      `UPDATE salesorders SET
        order_no=$1,
        created_at=$2,
        createduser=$3,
        payment_status=$4,
        total_price=$5,
        total_discount=$6,
        order_for=$7,
        delivered_by=$8,
        patient_name=$9,
        patient_contact_no=$10,
        store_id=$11,
        user_email=$12,
        pharmacy=$13,
        patient_address=$14,
        order_items=$15
      WHERE order_id=$16
      RETURNING *`,
      [
        order.order_no,
        order.created_at,
        order.createduser,
        order.payment_status,
        order.total_price,
        order.total_discount,
        order.order_for,
        order.delivered_by,
        order.patient_name,
        order.patient_contact_no,
        order.store_id,
        order.user_email,
        order.pharmacy,
        order.patient_address,
        order.order_items,
        order_id,
      ]
    );

    res.json({
      success: true,
      message: "Order updated",
      data: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// 5. DELETE SALES ORDER
// =======================
router.delete("/sales-order/:order_id", async (req, res) => {
  try {
    const { order_id } = req.params;

    await pool.query("DELETE FROM salesorders WHERE order_id=$1", [
      order_id,
    ]);

    res.json({ success: true, message: "Order deleted" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// 6. CONVERT TO INVOICE
// =======================
router.post("/convert-invoice", async (req, res) => {
  try {
    const order = req.body; // 👈 FULL ORDER COMES FROM FRONTEND

    if (!order || !order.order_items || order.order_items.length === 0) {
      return res.status(400).json({ error: "Invalid order data" });
    }

    // 🧠 Generate invoice sequence
    const result = await pool.query(`SELECT COUNT(*) FROM slaesinvoices`);
    const seq = parseInt(result.rows[0].count) + 1;

    const store = order.store_id || "001";
    const year = new Date().getFullYear().toString().slice(2);

    const invoice_id = `${store}/${year}/S-${seq}`;

    const insert = await pool.query(
      `INSERT INTO slaesinvoices (
        invoice_id,
        created_at,
        createduser,
        order_type,
        payment_status,
        total_price,
        total_discount,
        shipping_charge,
        order_for,
        delivered_by,
        patient_address,
        pharmacy,
        invoice_items,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        invoice_id,
        new Date(),
        order.createduser || "",
        order.order_type || "",
        "PENDING",
        order.total_price || 0,
        order.total_discount || 0,
        order.shipping_charge || 0,
        order.order_for || "",
        order.delivered_by || "",
        JSON.stringify(order.patient_address || {}),
        JSON.stringify(order.pharmacy || {}),
        JSON.stringify(order.order_items || []),
        "GENERATED"
      ]
    );

    res.json({
      success: true,
      invoice_id,
      data: insert.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Invoice conversion failed" });
  }
});
router.post("/invoice", async (req, res) => {
  try {
    const invoice = req.body;

    const result = await pool.query(
      `INSERT INTO slaesinvoices (
        invoice_id,
        order_id,
        created_at,
        createduser,
        order_no,
        order_type,
        payment_status,
        total_price,
        total_discount,
        shipping_charge,
        order_for,
        delivered_by,
        patient_address,
        pharmacy,
        invoice_items,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        invoice.invoice_id,
        invoice.order_id,
        invoice.created_at,
        invoice.createduser,
        invoice.order_no,
        invoice.order_type,
        invoice.payment_status,
        invoice.total_price,
        invoice.total_discount,
        invoice.shipping_charge,
        invoice.order_for,
        invoice.delivered_by,
        JSON.stringify(invoice.patient_address),
        JSON.stringify(invoice.pharmacy),
        JSON.stringify(invoice.invoice_items), //  IMPORTANT
        "GENERATED"
      ]
    );

    res.json({
      success: true,
      message: "Invoice saved successfully",
      data: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Invoice save failed" });
  }
});
router.get("/invoice/:invoice_id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM slaesinvoices WHERE invoice_id=$1",
      [req.params.invoice_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;