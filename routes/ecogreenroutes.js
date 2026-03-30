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
router.post("/generate-token", async (req, res) => {
  const { c2Code, storeId, prodCode, securityKey } = req.body;

  if (!c2Code || !storeId || !prodCode || !securityKey) {
    return res.status(400).json({ error: "Missing required params" });
  }

  try {
    const url = "http://117.211.64.158:41000/ws_c2_services_generate_token";

    // ✅ Use POST instead of GET because body is JSON
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ c2Code, storeId, prodCode, securityKey }),
    });

    if (!response.ok) {
      // Try to read the text to log the exact error
      const text = await response.text();
      console.error("Vendor API returned:", text);
      throw new Error(`Vendor API failed with status ${response.status}`);
    }

    const data = await response.json();

    res.status(200).json(data);
  } catch (err) {
    console.error("Token Error:", err.message);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

router.post("/item-master", async (req, res) => { 
  const { c2Code, storeId, prodCode, inputDateTime, apiKey } = req.body;

  // Validate required fields
  if (!c2Code || !storeId || !prodCode || !inputDateTime || !apiKey) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Format inputDateTime
    let formattedDateTime = inputDateTime
      .replace('T', ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*:\s*/g, ':')
      .trim();

    if (!/:\d{2}$/.test(formattedDateTime)) {
      formattedDateTime += ":00";
    }

    console.log("Formatted DateTime to send:", formattedDateTime);

    // Vendor API URL (without query params, since we'll POST JSON)
    const vendorUrl = `http://117.211.64.158:41000/ws_c2_services_get_master_data`;
    console.log("Vendor URL:", vendorUrl);

    // POST body for ERP
    const postBody = {
      c2Code,
      storeId,
      prodCode,
      inputDateTime: formattedDateTime,
      apiKey
    };

    const response = await fetch(vendorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postBody)
    });

    const text = await response.text();
    console.log("Raw vendor response:", text);

    let vendorData;
    try {
      vendorData = JSON.parse(text);
    } catch (parseErr) {
      console.error("Vendor returned invalid JSON:", text);
      return res.status(500).json({ 
        error: "Vendor returned invalid JSON", 
        rawResponse: text 
      });
    }

    // Determine items array
    let itemsArray = [];
    if (Array.isArray(vendorData)) {
      itemsArray = vendorData;
    } else if (Array.isArray(vendorData.data)) {
      itemsArray = vendorData.data;
    } else if (Array.isArray(vendorData.items)) {
      itemsArray = vendorData.items;
    } else if (Array.isArray(vendorData.records)) {
      itemsArray = vendorData.records;
    } else if (vendorData.code && vendorData.message) {
      // Vendor returned an error
      return res.status(400).json({
        error: "Vendor API error",
        vendorMessage: vendorData.message
      });
    } else {
      console.error("Vendor response invalid format:", vendorData);
      return res.status(500).json({ 
        error: "Invalid data format received from vendor", 
        rawVendorData: vendorData 
      });
    }

    // Insert/update items into local DB
    const insertedItems = [];
    for (const item of itemsArray) {
      try {
        const query = `
          INSERT INTO item_master (
            item_code, item_name, item_short_name, item_full_name,
            brand_code, brand_name, category_code, category_name,
            content_code, content_name, pack_code, pack_name,
            item_qty_per_box, item_added_date, item_updated_date,
            hsn_sac_code, hsn_sac_name
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
insertedItems.push({
  itemCode: item.itemCode,
  itemName: item.itemName,
  itemShortName: item.itemShortName || '',
  itemFullName: item.itemFullName || null,
  brandCode: item.brandCode || '',
  brandName: item.brandName || '',
  categoryCode: item.categoryCode || '',
  categoryName: item.categoryName || '',
  contentCode: item.contentCode || '',
  contentName: item.contentName || '',
  packCode: item.packCode || '',
  packName: item.packName || '',
  itemQtyPerBox: item.itemQtyPerBox || 0,
  itemAddedDate: item.itemAddedDate || null,
  itemUpdatedDate: item.itemUpdatedDate || null,
  hsnSacCode: item.hsnSacCode || '',
  hsnSacName: item.hsnSacName || '',
  isInserted: true // optional flag to indicate newly inserted/updated
});      } catch (itemErr) {
        console.error(`Failed to insert/update item ${item.itemCode}:`, itemErr.message);
      }
    }

    res.status(200).json({
      message: "Item master synced successfully",
      totalItems: itemsArray.length,
      insertedItems
    });

  } catch (err) {
    console.error("Item Master Error:", err.message);
    res.status(500).json({ error: "Failed to fetch or store item master" });
  }
});
router.post("/stock-details", async (req, res) => {
  const { c2Code, storeId, prodCode, inputDateTime, itemCodes, apiKey } = req.body;

  if (!c2Code || !storeId || !prodCode || !inputDateTime || !itemCodes || !apiKey) {
    return res.status(400).json({ error: "All fields are required, including inputDateTime" });
  }

  try {
    // Format inputDateTime
    let formattedDateTime = inputDateTime.replace('T', ' ').replace(/\s+/g, ' ').trim();
    if (!/:\d{2}$/.test(formattedDateTime)) formattedDateTime += ":00";

    let itemsArray = Array.isArray(itemCodes) ? itemCodes : JSON.parse(itemCodes);

    // Vendor API
    const vendorUrl = "http://117.211.64.158:41000/ws_c2_services_get_stock_data";
    const vendorResponse = await fetch(vendorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        c2Code,
        storeId,
        prodCode,
        inputDateTime: formattedDateTime,
        itemCodes: itemsArray,
        apiKey
      })
    });

    const rawText = await vendorResponse.text();
    const vendorData = JSON.parse(rawText);

    if (!vendorData.data || !Array.isArray(vendorData.data)) {
      return res.status(502).json({ error: "Invalid stock data from vendor", rawData: vendorData });
    }

    const stockData = vendorData.data;

    // Insert/update into DB
    for (const batch of stockData) {
      try {
        await pool.query(
          `INSERT INTO stock_batches 
          (c_item_code, item_name, item_qty_per_box, batch_no, stock_bal_qty, expiry_date)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (c_item_code, batch_no) DO UPDATE SET
            item_name = EXCLUDED.item_name,
            item_qty_per_box = EXCLUDED.item_qty_per_box,
            stock_bal_qty = EXCLUDED.stock_bal_qty,
            expiry_date = EXCLUDED.expiry_date`,
          [
            batch.c_item_code,
            batch.itemName,
            batch.itemQtyPerBox,
            batch.batchNo,
            batch.stockBalQty,
            batch.expiryDate
          ]
        );
      } catch (err) {
        console.error("DB INSERT ERROR:", err.message);
      }
    }
console.log("STOCK ITEMS TO SEND TO FRONTEND:", JSON.stringify(stockData, null, 2));

    // ✅ Send vendor data to frontend
    res.status(200).json({
      message: "Stock fetched and stored successfully",
      totalItems: stockData.length,
      stockItems: stockData
    });

  } catch (err) {
    console.error("Stock Details Error:", err.message);
    res.status(500).json({ error: "Failed to fetch or store stock details" });
  }
});
// POST /local-customers
router.post("/local-customers", async (req, res) => {
  const { c2Code, storeId, prodCode, apiKey, fromDate, toDate } = req.body;

  try {
    const url = "http://117.211.64.158:41000/ws_c2_services_fetch_local_customer";

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c2Code, storeId, prodCode, apiKey, fromDate, toDate })
    });

    const customers = await response.json();

    // Save to DB
    for (const cust of customers) {
      await pool.query(
        `INSERT INTO local_customers (
          brcode, lc_code, lc_name, added_date, age, gender,
          address1, address2, address3, city, pin, mobile_no,
          mail_id, parent_code, parent_name
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (lc_code) DO UPDATE SET
          lc_name = EXCLUDED.lc_name,
          city = EXCLUDED.city,
          mobile_no = EXCLUDED.mobile_no`,
        [
          cust.brcode,
          cust.lcCode,
          cust.lcName,
          cust.addedDate,
          cust.age,
          cust.gender,
          cust.address1,
          cust.address2,
          cust.address3,
          cust.city,
          cust.pin,
          cust.mobileNo,
          cust.mailId,
          cust.parentCode,
          cust.parentName
        ]
      );
    }

    // ✅ RETURN ARRAY BACK TO FRONTEND
    res.json(customers);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});
/* =========================================================
   5.5 Push Purchase Orders
========================================================= */
router.post("/purchase-orders", async (req, res) => {
  const { c2Code, storeId, prodCode, apiKey, fromDate, toDate } = req.body;

  if (!c2Code || !storeId || !prodCode || !apiKey || !fromDate || !toDate) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const fetchResponse = await fetch(
      "http://117.211.64.158:41000/ws_c2_services_po_fetch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c2Code, storeId, prodCode, apiKey, fromDate, toDate })
      }
    );

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      throw new Error(`Fetch failed: ${fetchResponse.status} - ${errorText}`);
    }

    const responseJson = await fetchResponse.json();

    // Use the response object directly, wrap in array if needed
    const purchaseOrders = Array.isArray(responseJson)
      ? responseJson
      : [responseJson];

    for (const po of purchaseOrders) {
      const query = `
        INSERT INTO ecogreenpurchase_orders (
          br_code, year, prefix, srno,
          custcode, custname, refcode, refname,
          total, details
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (br_code, year, prefix, srno) DO UPDATE SET
          custcode = EXCLUDED.custcode,
          custname = EXCLUDED.custname,
          refcode = EXCLUDED.refcode,
          refname = EXCLUDED.refname,
          total = EXCLUDED.total,
          details = EXCLUDED.details
      `;

      const values = [
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

    res.status(200).json({
      success: true,
      message: "Purchase orders synced successfully",
      total: purchaseOrders.length,
      data: purchaseOrders
    });

  } catch (err) {
    console.error("Purchase Orders Error:", err.message);
    res.status(500).json({ error: "Failed to fetch or save purchase orders" });
  }
});

router.post('/create_sales_order', async (req, res) => {
  try {
    const salesOrderData = req.body;

    console.log('=== Incoming Request Body ===');
    console.log(salesOrderData);

    // Validate required fields
    if (!salesOrderData.c2Code || !salesOrderData.storeId || !salesOrderData.prodCode) {
      console.warn('Missing required fields:', {
        c2Code: salesOrderData.c2Code,
        storeId: salesOrderData.storeId,
        prodCode: salesOrderData.prodCode,
      });
      return res.status(400).json({ message: 'Required fields missing: c2Code, storeId, prodCode' });
    }

    console.log('=== Forwarding to ERP ===');
   // Public IP accessible from Render
const response = await fetch(
  'http://117.211.64.158:41000/ws_c2_services_create_sale_order',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(salesOrderData),
  }
);

    let data;
    try {
      data = await response.json();
    } catch (err) {
      console.error('ERP did not return JSON:', err);
      data = await response.text();
    }

    if (response.ok) {
      console.log('=== ERP Response OK ===');
      console.log(data);
      res.status(200).json({ message: 'Sales order submitted successfully!', data });
    } else {
      console.error('=== ERP Response ERROR ===');
      console.error(data);
      res.status(response.status).json({ message: 'Failed to submit sales order', data });
    }
  } catch (error) {
    console.error('=== SERVER ERROR ===');
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/* =========================================================
   ✅ 5.6 Create Sales Order (Webhook Push)
========================================================= */
router.post("/sales-order", async (req, res) => {
  const data = req.body;

  try {
    const values = [
      data.order_id || null,
      data.order_no || null,
      data.created_at || null,
      data.order_type || null,
      data.invoice_id || null,
      data.payment_status || null,
      data.total_price || 0,
      data.total_discount || 0,
      data.order_for || null,
      data.delivered_by || null,
      data.shipping_charge || 0,
      JSON.stringify(data.patient_address) || null,
      JSON.stringify(data.pharmacy) || null,
      JSON.stringify(data.order_items) || null
    ];

    const query = `
      INSERT INTO ecogreensales_orders
      (order_id, order_no, created_at, order_type, invoice_id, payment_status, total_price, total_discount, order_for,
       delivered_by, shipping_charge, patient_address, pharmacy, order_items)
      VALUES (${values.map((_, i) => `$${i + 1}`).join(",")})
      RETURNING id
    `;

    const result = await pool.query(query, values);

    res.status(200).json({
      message: "Sales order saved successfully",
      id: result.rows[0].id
    });

  } catch (err) {
    console.error("Error saving sales order:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =====================
// Sales Invoice Webhook
// =====================
router.post("/sales-invoice", async (req, res) => {
  const data = req.body;

  try {
    const values = [
      data.order_id || null,
      data.order_no || null,
      data.created_at || null,
      data.order_type || null,
      data.payment_status || null,
      data.total_price || 0,
      data.total_discount || 0,
      data.order_for || null,
      data.delivered_by || null,
      data.shipping_charge || 0,
      data.patient_name || null,
      data.patient_contact_no || null,
      JSON.stringify(data.patient_address) || null,
      data.store_id || null,
      JSON.stringify(data.order_items) || null,
      data.user_email || null
    ];

    const query = `
      INSERT INTO ecogreensales_invoices
      (order_id, order_no, created_at, order_type, payment_status, total_price, total_discount, order_for,
       delivered_by, shipping_charge, patient_name, patient_contact_no, patient_address, store_id, order_items, user_email)
      VALUES (${values.map((_, i) => `$${i + 1}`).join(",")})
      RETURNING id
    `;

    const result = await pool.query(query, values);

    res.status(200).json({
      message: "Sales invoice saved successfully",
      id: result.rows[0].id
    });

  } catch (err) {
    console.error("Error saving sales invoice:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
router.post('/sales-order-status', async (req, res) => {
  const { orderNo, apiKey } = req.body;

  if (!orderNo || !apiKey) {
    return res.status(400).json({ error: 'Missing orderNo or apiKey' });
  }

  try {
    const url = `http://117.211.64.158:41000/ws_c2_services_sale_order_status?order_no=${encodeURIComponent(orderNo)}&apikey=${encodeURIComponent(apiKey)}`;

    // Node-fetch example
    const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch order status from remote API' });
    }

    const data = await response.json();

    // Optional: Normalize Ecogreen API response to always include code
    if (!data.code) data.code = "200";  

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order status' });
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