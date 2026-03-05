const express = require("express");
const axios = require("axios");
const pool = require("../db"); // ✅ PostgreSQL pool

const router = express.Router();

/* =========================================================
   ✅ Test Route
========================================================= */
router.get("/", (req, res) => {
  res.send("Ecogreen Sales route working");
});

/* =========================================================
   ✅ 5.1 Generate Token
========================================================= */
router.get("/generate-token", async (req, res) => {
  const { c2Code, storeId, prodCode, securityKey } = req.query;

  try {
    const response = await axios.get(
      "http://localhost:44000/ws_c2_services_generate_token",
      {
        params: { c2Code, storeId, prodCode, securityKey },
      }
    );

    res.status(200).json(response.data);
  } catch (err) {
    console.error("Token Error:", err.message);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

/* =========================================================
   ✅ 5.6 Create Sales Order (Webhook Push)
========================================================= */
router.post("/sales-order", async (req, res) => {
  const data = req.body;

  try {
    // Check values length
    const values = [
      data.c2Code,
      data.storeId,
      data.prodCode || '02',
      data.apiKey || null,
      data.ipNo || null,
      data.mobileNo,
      data.patientName,
      data.patientAddress || null,
      data.patientEmail || null,
      data.counterSale,
      data.ordDate,
      data.ordTime,
      data.userId,
      data.actCode,
      data.actName,
      data.drCode || null,
      data.drName || null,
      data.drAddress || null,
      data.drRegNo || null,
      data.drOfficeCode || null,
      data.dmanCode || null,
      data.orderTotal,
      data.orderDiscPer || 0,
      data.refNo || null,
      data.orderId,
      data.remark || null,
      data.urgentFlag || 0,
      data.ordConversionFlag || 0,
      data.dcConversionFlag || 0,
      data.ordRefNo || null,
      data.sysName,
      data.sysIp,
      data.sysUser,
      JSON.stringify(data.materialInfo) // 33rd value ✅
    ];

    console.log("Values length:", values.length); // Should log 33

    const query = `
      INSERT INTO ecogreensales_orders
      (c2_code, store_id, prod_code, api_key, ip_no, mobile_no, patient_name, patient_address, patient_email, counter_sale,
       ord_date, ord_time, user_id, act_code, act_name, dr_code, dr_name, dr_address, dr_reg_no, dr_office_code,
       dman_code, order_total, order_disc_per, ref_no, order_id, remark, urgent_flag, ord_conversion_flag, dc_conversion_flag,
       ord_ref_no, sys_name, sys_ip, sys_user, material_info)
      VALUES (${values.map((_, i) => `$${i + 1}`).join(",")})
      RETURNING id
    `;

    const result = await pool.query(query, values);

    res.status(200).json({
      message: "Sales order saved successfully",
      id: result.rows[0].id,
    });

  } catch (err) {
    console.error("Error saving sales order:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// Webhook for Sales Invoice Details Push
router.post("/sales-invoice", async (req, res) => {
  const data = req.body;

  try {
    const query = `
      INSERT INTO ecogreensales_order_invoices
      (sales_order_id, code, order_id, cust_code, from_gst_no, to_gst_no, customer_type, doctor_name, invoices)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `;

    const values = [
      data.salesOrderId,   // link to ecogreensales_orders.id
      data.code,
      data.orderId,
      data.custCode,
      data.fromGstNo || null,
      data.toGstNo || null,
      data.customerType,
      data.doctorName || null,
      JSON.stringify(data.invoices)
    ];

    const result = await pool.query(query, values);
    res.status(200).json({ message: "Sales invoice saved successfully", id: result.rows[0].id });
  } catch (err) {
    console.error("Error saving sales invoice:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* =========================================================
   ✅ 5.7 Sales Order Status (Invoice Webhook)
========================================================= */
router.get("/sales-order-status/:orderNo", async (req, res) => {
  const { orderNo } = req.params;
  const { apiKey } = req.query;

  try {
    // Call Ecogreen API
    const response = await axios.get(
      `http://localhost:45000/ws_c2_services_sale_order_status`,
      {
        params: { order_no: orderNo, apikey: apiKey },
      }
    );

    const data = response.data;

    // Store invoice in DB
    await pool.query(
      `INSERT INTO ecogreensales_order_invoices(
        sales_order_id,
        code, order_id, cust_code,
        from_gst_no, to_gst_no,
        customer_type, doctor_name,
        invoices, created_at
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        orderNo,
        data.code,
        data.orderId,
        data.custCode,
        data.fromGstNo,
        data.toGstNo,
        data.customerType,
        data.doctorName,
        JSON.stringify(data.invoices)
      ]
    );

    res.status(200).json({
      message: "Invoice stored successfully",
      invoiceData: data,
    });

  } catch (err) {
    console.error("Invoice Error:", err.message);
    res.status(500).json({ error: "Failed to fetch/store invoice" });
  }
});

/* =========================================================
   ✅ Get All Sales Orders
========================================================= */
router.get("/orders", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ecogreensales_orders ORDER BY created_at DESC"
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Fetch Orders Error:", err.message);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

/* =========================================================
   ✅ Get Order By ID
========================================================= */
router.get("/orders/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM ecogreensales_orders WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Order not found" });

    res.status(200).json(result.rows[0]);

  } catch (err) {
    console.error("Fetch Order Error:", err.message);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

module.exports = router;