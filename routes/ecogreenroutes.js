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


router.get("/item-master", async (req, res) => {
  const { c2Code, storeId, prodCode, inputDateTime, apiKey } = req.query;

  if (!c2Code || !storeId || !prodCode || !inputDateTime || !apiKey) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Build vendor URL
    const params = new URLSearchParams({ c2Code, storeId, prodCode, inputDateTime, apiKey });
    const url = `http://localhost:45000/ws_c2_services_get_master_data?${params.toString()}`;

    // Fetch data from vendor
    const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error("Failed to fetch vendor data");

    const vendorData = await response.json();

    if (!vendorData.data || !Array.isArray(vendorData.data)) {
      return res.status(500).json({ error: "Invalid data from vendor" });
    }

    // Insert each item into local table
    for (const item of vendorData.data) {
      const query = `
        INSERT INTO item_master (
          item_code, item_name, item_short_name, item_full_name,
          brand_code, brand_name, category_code, category_name,
          content_code, content_name, pack_code, pack_name,
          item_qty_per_box, item_added_date, item_updated_date,
          hsn_sac_code, hsn_sac_name
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
        )
        ON CONFLICT (item_code) DO UPDATE SET
          item_name = EXCLUDED.item_name,
          item_short_name = EXCLUDED.item_short_name,
          item_full_name = EXCLUDED.item_full_name,
          brand_code = EXCLUDED.brand_code,
          brand_name = EXCLUDED.brand_name,
          category_code = EXCLUDED.category_code,
          category_name = EXCLUDED.category_name,
          content_code = EXCLUDED.content_code,
          content_name = EXCLUDED.content_name,
          pack_code = EXCLUDED.pack_code,
          pack_name = EXCLUDED.pack_name,
          item_qty_per_box = EXCLUDED.item_qty_per_box,
          item_updated_date = EXCLUDED.item_updated_date,
          hsn_sac_code = EXCLUDED.hsn_sac_code,
          hsn_sac_name = EXCLUDED.hsn_sac_name
      `;
      const values = [
        item.itemCode,
        item.itemName,
        item.itemShortName || null,
        item.itemFullName || null,
        item.brandCode || null,
        item.brandName || null,
        item.categoryCode || null,
        item.categoryName || null,
        item.contentCode || null,
        item.contentName || null,
        item.packCode || null,
        item.packName || null,
        item.itemQtyPerBox || 0,
        item.itemAddedDate || null,
        item.itemUpdatedDate || null,
        item.hsnSacCode || null,
        item.hsnSacName || null
      ];
      await pool.query(query, values);
    }

    res.status(200).json({ message: "Item master synced successfully", totalItems: vendorData.data.length });

  } catch (err) {
    console.error("Item Master Error:", err);
    res.status(500).json({ error: "Failed to fetch or store item master" });
  }
});

router.get("/stock-details", async (req, res) => {
  const { c2Code, storeId, prodCode, itemCodes, apiKey } = req.query;

  if (!c2Code || !storeId || !prodCode || !itemCodes || !apiKey) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // itemCodes passed as JSON string in query: ["711291","254229"]
    const items = JSON.parse(itemCodes);

    // Fetch vendor stock data
    const response = await axios.get("http://localhost:45000/ws_c2_services_get_stock_data", {
      params: { c2Code, storeId, prodCode, itemCodes: items, apiKey }
    });

    const stockData = response.data.data;

    if (!stockData || !Array.isArray(stockData)) {
      return res.status(500).json({ error: "Invalid stock data from vendor" });
    }

    // Insert each stock batch into stock_batches table
    for (const batch of stockData) {
      const query = `
        INSERT INTO stock_batches (
          c_item_code, item_name, item_qty_per_box,
          batch_no, stock_bal_qty, expiry_date
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (c_item_code, batch_no) DO UPDATE SET
          item_name = EXCLUDED.item_name,
          item_qty_per_box = EXCLUDED.item_qty_per_box,
          stock_bal_qty = EXCLUDED.stock_bal_qty,
          expiry_date = EXCLUDED.expiry_date
      `;
      const values = [
        batch.c_item_code,
        batch.itemName,
        batch.itemQtyPerBox || 1,
        batch.batchNo,
        batch.stockBalQty,
        batch.expiryDate
      ];
      await pool.query(query, values);
    }

    res.status(200).json({
      message: "Stock details synced successfully",
      totalBatches: stockData.length
    });

  } catch (err) {
    console.error("Stock Details Error:", err.message);
    res.status(500).json({ error: "Failed to fetch or store stock details" });
  }
});


router.get("/local-customers", async (req, res) => {
  const { c2Code, storeId, prodCode, apiKey, fromDate, toDate } = req.query;

  if (!c2Code || !storeId || !prodCode || !apiKey || !fromDate || !toDate) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const response = await axios.get("http://localhost:45000/ws_c2_services_so_refno_fetch", {
      params: { c2Code, storeId, prodCode, apiKey, fromDate, toDate }
    });

    const customers = response.data;
    for (const cust of customers) {
      const query = `
        INSERT INTO local_customers (
          brcode, lc_code, lc_name, added_date, age, gender, 
          address1, address2, address3, city, pin, mobile_no, 
          mail_id, parent_code, parent_name
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (lc_code) DO UPDATE SET
          lc_name = EXCLUDED.lc_name,
          added_date = EXCLUDED.added_date,
          age = EXCLUDED.age,
          gender = EXCLUDED.gender,
          address1 = EXCLUDED.address1,
          address2 = EXCLUDED.address2,
          address3 = EXCLUDED.address3,
          city = EXCLUDED.city,
          pin = EXCLUDED.pin,
          mobile_no = EXCLUDED.mobile_no,
          mail_id = EXCLUDED.mail_id,
          parent_code = EXCLUDED.parent_code,
          parent_name = EXCLUDED.parent_name
      `;
      const values = [
        cust.brcode,
        cust.lcCode,
        cust.lcName,
        cust.addedDate,
        cust.age || 0,
        cust.gender || null,
        cust.address1 || null,
        cust.address2 || null,
        cust.address3 || null,
        cust.city || null,
        cust.pin || null,
        cust.mobileNo || null,
        cust.mailId || null,
        cust.parentCode || null,
        cust.parentName || null
      ];
      await pool.query(query, values);
    }

    res.status(200).json({ message: "Local customers synced successfully", total: customers.length });
  } catch (err) {
    console.error("Local Customers Error:", err.message);
    res.status(500).json({ error: "Failed to fetch or save local customers" });
  }
});

/* =========================================================
   5.5 Push Purchase Orders
========================================================= */
router.get("/purchase-orders", async (req, res) => {
  const { c2Code, storeId, prodCode, apiKey, fromDate, toDate } = req.query;

  if (!c2Code || !storeId || !prodCode || !apiKey || !fromDate || !toDate) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const response = await axios.get("http://localhost:45000/ws_c2_services_po_fetch", {
      params: { c2Code, storeId, prodCode, apiKey, fromDate, toDate }
    });

    const purchaseOrders = response.data;

    for (const po of purchaseOrders) {
      const query = `
        INSERT INTO ecogreenpurchase_orders (
          c2_code, store_id, prod_code,
          br_code, year, prefix, srno,
          custcode, custname, refcode, refname,
          total, details
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (br_code, year, prefix, srno) DO UPDATE SET
          custcode = EXCLUDED.custcode,
          custname = EXCLUDED.custname,
          refcode = EXCLUDED.refcode,
          refname = EXCLUDED.refname,
          total = EXCLUDED.total,
          details = EXCLUDED.details
      `;
      const values = [
        c2Code,
        storeId,
        prodCode,
        po.br_code,
        po.year,
        po.prefix,
        po.srno,
        po.custcode,
        po.custname,
        po.refcode || null,
        po.refname || null,
        po.total,
        JSON.stringify(po.details)
      ];
      await pool.query(query, values);
    }

    res.status(200).json({ message: "Purchase orders synced successfully", total: purchaseOrders.length });
  } catch (err) {
    console.error("Purchase Orders Error:", err.message);
    res.status(500).json({ error: "Failed to fetch or save purchase orders" });
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