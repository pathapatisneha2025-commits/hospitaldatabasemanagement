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
  let { c2Code, storeId, prodCode, inputDateTime, itemCodes, apiKey, page = 1, limit = 100 } = req.body;

  if (!c2Code || !storeId || !prodCode || !inputDateTime || !itemCodes || !apiKey) {
    return res.status(400).json({ error: "All fields are required, including inputDateTime" });
  }

  // Ensure page & limit are numbers
  page = parseInt(page, 10) || 1;
  limit = parseInt(limit, 10) || 100;

  try {
    // Format inputDateTime
    let formattedDateTime = inputDateTime.replace('T', ' ').replace(/\s+/g, ' ').trim();
    if (!/:\d{2}$/.test(formattedDateTime)) formattedDateTime += ":00";

    const itemsArray = Array.isArray(itemCodes) ? itemCodes : JSON.parse(itemCodes);

    // Fetch vendor data
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

    const vendorData = await vendorResponse.json();

    if (!vendorData.data || !Array.isArray(vendorData.data)) {
      return res.status(502).json({ error: "Invalid stock data from vendor", rawData: vendorData });
    }

    const stockData = vendorData.data;

    // --- PAGINATION ---
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedData = stockData.slice(start, end);

    // Insert/update into DB only for current page
    for (const batch of paginatedData) {
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

    res.status(200).json({
      message: "Stock fetched and stored successfully",
      totalItems: stockData.length,
      page,
      limit,
      totalPages: Math.ceil(stockData.length / limit),
      stockItems: paginatedData
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

router.get('/ecogreenpurchase_orders', async (req, res) => {
  try {
    const query = `
      SELECT 
        po.*,
        e.full_name AS assigned_by_name
      FROM ecogreenpurchase_orders po
      LEFT JOIN employees e ON po.assigned_by = e.id
      ORDER BY po.id DESC
    `;

    const result = await pool.query(query);

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase orders',
      error: error.message
    });
  }
});
router.post("/assign_delivery_boy", async (req, res) => {
  const { order_id, delivery_boy, assigned_by } = req.body;

  if (!order_id || !delivery_boy || !assigned_by) {
    return res.status(400).json({
      success: false,
      message: "Order ID, delivery boy, and assigned_by employee ID are required",
    });
  }

  try {
    const query = `
      UPDATE ecogreenpurchase_orders
      SET delivery_boy = $1,
          assigned_by = $2,
          assigned_at = NOW()
      WHERE id = $3
      RETURNING *;
    `;

    const values = [delivery_boy, assigned_by, order_id];
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({
      success: true,
      message: "Delivery boy assigned successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error assigning delivery boy:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// GET delivery boy live location
router.get('/delivery_boy_location/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT latitude, longitude, status, updated_at
       FROM delivery_boy_locations
       WHERE delivery_boy_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: "No location found",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching location:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});
router.get("/delivery_boy/ecogreenpurchase_orders", async (req, res) => {
  try {
    const { delivery_boy } = req.query;

    let query;
    let params = [];

    if (delivery_boy) {
      // Fetch only orders for this delivery boy
      query = 'SELECT * FROM ecogreenpurchase_orders WHERE delivery_boy = $1 ORDER BY id DESC';
      params = [delivery_boy];
    } else {
      // Fetch all orders if no delivery boy ID provided
      query = 'SELECT * FROM ecogreenpurchase_orders ORDER BY id DESC';
    }

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase orders',
      error: error.message
    });
  }
});

router.put("/mark-delivered/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    // Update only the status column
    const query = `
      UPDATE ecogreenpurchase_orders
      SET status = 'Delivered'
      WHERE id = $1
      RETURNING *;
    `;

    const result = await pool.query(query, [orderId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, message: "Order status updated to Delivered", order: result.rows[0] });
  } catch (err) {
    console.error("Mark EcoGreen Purchase Delivered Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/delivered/ecogreenpurchase-orders", async (req, res) => {
  try {
    const query = `
      SELECT * FROM ecogreenpurchase_orders 
      WHERE status IN ('Delivered', 'Completed')
      ORDER BY id DESC
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows,
    });
  } catch (err) {
    console.error("Error fetching EcoGreen orders:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

router.put("/mark-completed/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { receivedby } = req.body; // employee ID

    if (!receivedby) {
      return res.status(400).json({ success: false, message: "Employee ID is required" });
    }

    const updateQuery = `
      UPDATE ecogreenpurchase_orders
      SET status = 'Completed', employee_id = $1
      WHERE id = $2
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [receivedby, orderId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, message: "Order marked as completed", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
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

  const client = await pool.connect();

  try {
    const url = `http://117.211.64.158:41000/ws_c2_services_sale_order_status?order_no=${encodeURIComponent(orderNo)}&apikey=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch order status from remote API' });
    }

    const data = await response.json();
    if (!data.code) data.code = "200";

    // Begin transaction
    await client.query('BEGIN');

    // Insert or update order with JSONB invoices
    await client.query(
      `INSERT INTO ecogreensales_order_status
        ( order_id, cust_code, from_gst_no, to_gst_no, customer_type, doctor_name, invoices)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (order_id) DO UPDATE 
       SET cust_code = EXCLUDED.cust_code,
           from_gst_no = EXCLUDED.from_gst_no,
           to_gst_no = EXCLUDED.to_gst_no,
           customer_type = EXCLUDED.customer_type,
           doctor_name = EXCLUDED.doctor_name,
           invoices = EXCLUDED.invoices`,
      [
        
        data.orderId,
        data.custCode,
        data.fromGstNo,
        data.toGstNo,
        data.customerType,
        data.doctorName,
        JSON.stringify(data.invoices)
      ]
    );

    await client.query('COMMIT');

    // Return the original API response
    res.json(data);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fetch/Insert Error:', err);
    res.status(500).json({ error: 'Failed to fetch or save order status' });
  } finally {
    client.release();
  }
});


router.get('/sales-order-status/all', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ecogreensales_order_status ORDER BY created_at DESC'
    );

    res.status(200).json({
      count: result.rows.length,
      orders: result.rows, // includes invoices JSONB
    });
  } catch (err) {
    console.error('Fetch All Orders Error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});


router.put("/sales-orderstatus/assign-delivery-boy/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const { assigned_by, delivery_boy_id } = req.body;

  if (!assigned_by || !delivery_boy_id) {
    return res.status(400).json({ success: false, message: "assigned_by and delivery_boy_id are required" });
  }

  try {
    const result = await pool.query(
      `UPDATE ecogreensales_order_status
       SET assigned_by = $1,
           delivery_boy_id = $2,
           status = 'pending'
       WHERE order_id = $3
       RETURNING *`,
      [assigned_by, delivery_boy_id, orderId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, message: "Delivery boy assigned", order: result.rows[0] });
  } catch (err) {
    console.error("Assign Delivery Boy Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/delivery-boy/:deliveryBoyId", async (req, res) => {
  const { deliveryBoyId } = req.params;

  try {
    const orderResult = await pool.query(
      `SELECT 
          o.id,
          o.order_id,
          json_agg(d.product_name) AS product_names,
          COUNT(d.id) AS total_products
       FROM ecogreensales_order_status o
       LEFT JOIN ecogreensales_invoices i ON o.order_id = i.order_id
       LEFT JOIN ecogreensales_order_detail d ON i.id = d.invoice_id
       WHERE o.delivery_boy_id = $1
       GROUP BY o.id, o.order_id
       ORDER BY o.created_at DESC`,
      [deliveryBoyId]
    );

    res.json({ success: true, count: orderResult.rowCount, orders: orderResult.rows });
  } catch (err) {
    console.error("Error fetching simplified orders for delivery boy:", err);
    res.status(500).json({ success: false, message: "Server error" });
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
      `INSERT INTO ecogreensales_order_status(
         order_id, cust_code,
        from_gst_no, to_gst_no,
        customer_type, doctor_name,
        invoices
      )
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
      
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