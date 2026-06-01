const express = require("express");
const axios = require("axios");
const pool = require("../db"); // ✅ PostgreSQL pool
const QRCode = require("qrcode"); // ✅ ADD THIS
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../cloudinary");
const twilio = require("twilio");

/* ---------------- CLOUDINARY STORAGE ---------------- */
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "ecogreen_stock",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],

    public_id: (req, file) => {
      const nameWithoutExt = path.parse(file.originalname).name;
      return Date.now() + "-" + nameWithoutExt;
    },
  },
});

const upload = multer({ storage });
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;
/* =========================================================
   ✅ Test Route
========================================================= */
router.get("/", (req, res) => {
  res.send("Ecogreen Sales route working");
});

/* =========================================================
   ✅ 5.1 Generate Token
========================================================= */
// router.post("/generate-token", async (req, res) => {

//   const { c2Code, storeId, prodCode, securityKey } = req.body;

//   if (!c2Code || !storeId || !prodCode || !securityKey) {
//     return res.status(400).json({ error: "Missing required params" });
//   }

//   try {
//     const url = "http://117.211.64.158:41000/ws_c2_services_generate_token";

//     // ✅ Use POST instead of GET because body is JSON
//     const response = await fetch(url, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({ c2Code, storeId, prodCode, securityKey }),
//     });

//     if (!response.ok) {
//       // Try to read the text to log the exact error
//       const text = await response.text();
//       console.error("Vendor API returned:", text);
//       throw new Error(`Vendor API failed with status ${response.status}`);
//     }

//     const data = await response.json();

//     res.status(200).json(data);
//   } catch (err) {
//     console.error("Token Error:", err.message);
//     res.status(500).json({ error: "Failed to generate token" });
//   }
// });

let tokenData = {
  apiKey: null,
  expiry: null,
};

// 🔐 Fixed credentials (move to .env in real project)
const credentials = {
  c2Code: process.env.C2_CODE,
  storeId: process.env.STORE_ID,
  prodCode: process.env.PROD_CODE,
  securityKey: process.env.SECURITY_KEY,
};

// 🔄 Generate Token Function
const generateToken = async () => {
  try {
    console.log("🔄 Generating token...");

    const response = await fetch(
      "http://117.211.64.158:21000/ws_c2_services_generate_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      }
    );

    const data = await response.json();

    if (data.code === "200" && data.apiKey) {
      tokenData.apiKey = data.apiKey;

      // ⏰ 3 hours expiry
      tokenData.expiry = Date.now() + 3 * 60 * 60 * 1000;

      console.log("✅ Token stored");
    } else {
      console.error("❌ Token generation failed", data);
    }
  } catch (err) {
    console.error("Token Error:", err.message);
  }
};

// 🚀 Run at server start
generateToken();

// 🔁 Auto refresh every 3 hours
setInterval(generateToken, 3 * 60 * 60 * 1000);

// 📌 Always get valid token
const getToken = async () => {
  if (!tokenData.apiKey || Date.now() > tokenData.expiry) {
    await generateToken();
  }
  return tokenData.apiKey;
};

router.post("/item-master", async (req, res) => {
  const { c2Code, storeId, prodCode, inputDateTime } = req.body;

  if (!c2Code || !storeId || !prodCode) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const apiKey = await getToken();

    let formattedDateTime = inputDateTime
      .replace("T", " ")
      .replace(/\s+/g, " ")
      .replace(/\s*:\s*/g, ":")
      .trim();

    if (!/:\d{2}$/.test(formattedDateTime)) {
      formattedDateTime += ":00";
    }

    const vendorUrl =
      "http://117.211.64.158:21000/ws_c2_services_get_master_data";

    const postBody = {
      c2Code,
      storeId,
      prodCode,
      inputDateTime: formattedDateTime,
      apiKey,
    };

    const response = await fetch(vendorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postBody),
    });

    const text = await response.text();

    let vendorData;
    try {
      vendorData = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Vendor returned invalid JSON",
        rawResponse: text,
      });
    }

    let itemsArray = [];

    if (Array.isArray(vendorData)) itemsArray = vendorData;
    else if (Array.isArray(vendorData.data)) itemsArray = vendorData.data;
    else if (Array.isArray(vendorData.items)) itemsArray = vendorData.items;
    else if (Array.isArray(vendorData.records)) itemsArray = vendorData.records;
    else if (vendorData.code && vendorData.message) {
      return res.status(400).json({
        error: "Vendor API error",
        vendorMessage: vendorData.message,
      });
    } else {
      return res.status(500).json({
        error: "Invalid data format received",
        rawVendorData: vendorData,
      });
    }

    const insertedItems = [];

    for (const item of itemsArray) {
      try {
        const query = `
          INSERT INTO item_master (
            item_code, item_name, item_short_name, item_full_name,
            brand_code, brand_name, category_code, category_name,
            content_code, content_name, pack_code, pack_name,
            item_qty_per_box, item_added_date, item_updated_date,
            hsn_sac_code, hsn_sac_name,
            minSaleQty, note, mfacName, mfacCode,
            packTypCode, packTypName, scheduleCode, scheduleName,
            categoryHeadCode, categoryHeadName,
            categoryClassCode, categoryClassName,
            allowDisc, gstCode,
            parentItemCode, parentItemName,
            molecule_info
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
            $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
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
            hsn_sac_name = EXCLUDED.hsn_sac_name,
            minSaleQty = EXCLUDED.minSaleQty,
            note = EXCLUDED.note,
            mfacName = EXCLUDED.mfacName,
            mfacCode = EXCLUDED.mfacCode,
            packTypCode = EXCLUDED.packTypCode,
            packTypName = EXCLUDED.packTypName,
            scheduleCode = EXCLUDED.scheduleCode,
            scheduleName = EXCLUDED.scheduleName,
            categoryHeadCode = EXCLUDED.categoryHeadCode,
            categoryHeadName = EXCLUDED.categoryHeadName,
            categoryClassCode = EXCLUDED.categoryClassCode,
            categoryClassName = EXCLUDED.categoryClassName,
            allowDisc = EXCLUDED.allowDisc,
            gstCode = EXCLUDED.gstCode,
            parentItemCode = EXCLUDED.parentItemCode,
            parentItemName = EXCLUDED.parentItemName,
            molecule_info = EXCLUDED.molecule_info
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
          item.hsnSacName || null,

          item.minSaleQty || 1,
          item.note || null,

          item.mfacName || "-",
          item.mfacCode || "-",

          item.packTypCode || "-",
          item.packTypName || "-",

          item.scheduleCode || "-",
          item.scheduleName || "-",

          item.categoryHeadCode || "CH0005",
          item.categoryHeadName || "MEDICINE",

          item.categoryClassCode || "CAT005",
          item.categoryClassName || "MEDICINE",

          item.allowDisc || "YES",
          item.gstCode || "00",

          item.parentItemCode || null,
          item.parentItemName || null,

          // ✅ NEW FIELD (JSONB)
          JSON.stringify(item.moleculeInfo || [])
        ];

        await pool.query(query, values);

        insertedItems.push({
          itemCode: item.itemCode,
          itemName: item.itemName,
          itemShortName: item.itemShortName || null,
          itemFullName: item.itemFullName || null,

          brandCode: item.brandCode || null,
          brandName: item.brandName || null,
          categoryCode: item.categoryCode || null,
          categoryName: item.categoryName || null,

          contentCode: item.contentCode || null,
          contentName: item.contentName || null,
          packCode: item.packCode || null,
          packName: item.packName || null,

          itemQtyPerBox: item.itemQtyPerBox || 0,
          itemAddedDate: item.itemAddedDate || null,
          itemUpdatedDate: item.itemUpdatedDate || null,

          hsnSacCode: item.hsnSacCode || null,
          hsnSacName: item.hsnSacName || null,

          minSaleQty: item.minSaleQty || 1,
          note: item.note || null,

          mfacName: item.mfacName || null,
          mfacCode: item.mfacCode || null,

          packTypCode: item.packTypCode || null,
          packTypName: item.packTypName || null,

          scheduleCode: item.scheduleCode || null,
          scheduleName: item.scheduleName || null,

          categoryHeadCode: item.categoryHeadCode || null,
          categoryHeadName: item.categoryHeadName || null,

          categoryClassCode: item.categoryClassCode || null,
          categoryClassName: item.categoryClassName || null,

          allowDisc: item.allowDisc || null,
          gstCode: item.gstCode || null,

          parentItemCode: item.parentItemCode || null,
          parentItemName: item.parentItemName || null,

          // ✅ NEW RESPONSE FIELD
          moleculeInfo: item.moleculeInfo || [],

          status: "inserted",
        });
      } catch (itemErr) {
        console.error(
          `Insert failed ${item.itemCode}:`,
          itemErr.message
        );
      }
    }

    res.status(200).json({
      message: "Item master synced successfully",
      totalItems: itemsArray.length,
      insertedItems,
    });
  } catch (err) {
    console.error("Item Master Error:", err.message);
    res.status(500).json({
      error: "Failed to fetch or store item master",
    });
  }
});
router.post("/stock-details", async (req, res) => {
  console.log("Incoming request body:", req.body);

  let {
    c2Code,
    storeId,
    prodCode,
    inputDateTime,
    itemCodes,
    page = 1,
    limit = 100,
  } = req.body;

  if (!c2Code || !storeId || !prodCode || !itemCodes) {
    return res.status(400).json({
      error: "Required fields missing: c2Code, storeId, prodCode, itemCodes",
    });
  }

  page = parseInt(page, 10) || 1;
  limit = parseInt(limit, 10) || 100;

  try {
    const apiKey = await getToken();

    const itemsArray = Array.isArray(itemCodes)
      ? itemCodes
      : JSON.parse(itemCodes);

    const formattedDateTime =
      inputDateTime && inputDateTime.trim() !== ""
        ? inputDateTime.replace("T", " ").trim() + ":00"
        : "";

    const payload = {
      c2Code,
      storeId,
      prodCode,
      itemCodes: itemsArray,
      apiKey,
      inputDateTime: formattedDateTime,
    };

    const vendorResponse = await fetch(
      "http://117.211.64.158:21000/ws_c2_services_get_stock_data",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const vendorData = await vendorResponse.json();

    if (!vendorData.data || !Array.isArray(vendorData.data)) {
      return res.status(502).json({
        error: "Invalid stock data from vendor",
        rawData: vendorData,
      });
    }

    let stockData = vendorData.data;

    // ==================================================
    // 🚀 1. STRONG GLOBAL DEDUPLICATION (FIXED KEY)
    // ==================================================
    const map = new Map();

    for (const item of stockData) {
      const key = `${String(item.c_item_code || "").trim().toLowerCase()}-${String(item.batchNo || "NA").trim().toLowerCase()}`;
      map.set(key, item);
    }

    const uniqueStockData = Array.from(map.values());

    // ===============================
    // 🚀 2. BULK INSERT (SAFE CHUNKING)
    // ===============================
    const chunkSize = 5000;

    for (let i = 0; i < uniqueStockData.length; i += chunkSize) {
      let chunk = uniqueStockData.slice(i, i + chunkSize);

      // ==================================================
      // 🚨 3. DOUBLE SAFETY INSIDE CHUNK (IMPORTANT FIX)
      // ==================================================
      const seen = new Set();

      chunk = chunk.filter((batch) => {
        const key = `${String(batch.c_item_code || "").trim().toLowerCase()}-${String(batch.batchNo || "NA").trim().toLowerCase()}`;

        if (seen.has(key)) return false;
        seen.add(key);

        return true;
      });

      const values = [];
      const placeholders = [];

      chunk.forEach((batch, index) => {
        const idx = index * 9;

        placeholders.push(
          `($${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7},$${idx + 8},$${idx + 9})`
        );

        values.push(
          batch.c_item_code,
          batch.itemName,
          batch.itemQtyPerBox,
          batch.batchNo,
          batch.stockBalQty,
          batch.expiryDate,
          batch.mrp || 0,
          batch.mrpbox || 0,
          batch.saleRate || 0
        );
      });

      if (values.length > 0) {
        await pool.query(
          `
          INSERT INTO stock_batches (
            c_item_code,
            item_name,
            item_qty_per_box,
            batch_no,
            stock_bal_qty,
            expiry_date,
            mrp,
            mrpbox,
            sale_rate
          )
          VALUES ${placeholders.join(",")}
          ON CONFLICT (c_item_code, batch_no)
          DO UPDATE SET
            item_name = EXCLUDED.item_name,
            item_qty_per_box = EXCLUDED.item_qty_per_box,
            stock_bal_qty = EXCLUDED.stock_bal_qty,
            expiry_date = EXCLUDED.expiry_date,
            mrp = EXCLUDED.mrp,
            mrpbox = EXCLUDED.mrpbox,
            sale_rate = EXCLUDED.sale_rate
          `,
          values
        );
      }
    }

    // ===============================
    // PAGINATION (SAFE DATA)
    // ===============================
    const start = (page - 1) * limit;
    const paginatedData = uniqueStockData.slice(start, start + limit);

    return res.status(200).json({
      message: "Stock fetched and stored successfully",
      totalItems: uniqueStockData.length,
      page,
      limit,
      totalPages: Math.ceil(uniqueStockData.length / limit),
      stockItems: paginatedData,
    });

  } catch (err) {
    console.error("Stock Details Error:", err);
    return res.status(500).json({
      error: "Failed to fetch or store stock details",
    });
  }
});
router.get("/stock-details/all", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    // 1. Get paginated data
    const { rows } = await pool.query(
      `SELECT * 
       FROM stock_batches 
       ORDER BY expiry_date ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // 2. Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM stock_batches`
    );

    const totalItems = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit);

    res.status(200).json({
      message: "Stock batches fetched successfully",
      totalItems,
      page,
      limit,
      totalPages,
      stockItems: rows,
    });

  } catch (err) {
    console.error("Error fetching stock batches:", err.message);
    res.status(500).json({ error: "Failed to fetch stock batches" });
  }
});

router.put(
  "/stock-details/edit/:id",
  upload.single("image"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        c_item_code,
        item_name,
        item_qty_per_box,
        batch_no,
        stock_bal_qty,
        expiry_date,
        mrp,
        mrpbox,
        sale_rate,
        description,
      } = req.body;

      const newImageUrl = req.file ? req.file.path : null;

      const oldData = await pool.query(
        `SELECT image FROM stock_batches WHERE id = $1`,
        [id]
      );

      if (oldData.rowCount === 0) {
        return res.status(404).json({ error: "Stock not found" });
      }

      const finalImage = newImageUrl || oldData.rows[0].image;

      await pool.query(
        `UPDATE stock_batches SET
          c_item_code=$1,
          item_name=$2,
          item_qty_per_box=$3,
          batch_no=$4,
          stock_bal_qty=$5,
          expiry_date=$6,
          mrp=$7,
          mrpbox=$8,
          sale_rate=$9,
          image=$10,
          description=$11
        WHERE id=$12`,
        [
          c_item_code,
          item_name,
          item_qty_per_box,
          batch_no,
          stock_bal_qty,
          expiry_date,
          mrp,
          mrpbox,
          sale_rate,
          finalImage,
          description,
          id,
        ]
      );

      res.json({ success: true, image: finalImage });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);


// POST /local-customers
router.post("/local-customers", async (req, res) => {
  const { c2Code, storeId, prodCode, fromDate, toDate } = req.body;

  if (!c2Code || !storeId || !prodCode) {
    return res.status(400).json({ error: "Required fields missing: c2Code, storeId, prodCode" });
  }

  try {
    // 🔐 Generate token automatically
    const apiKey = await getToken();
    console.log("Generated API Key:", apiKey);

    const url = "http://117.211.64.158:21000/ws_c2_services_fetch_local_customer";

    const payload = {
      c2Code,
      storeId,
      prodCode,
      apiKey,
      fromDate: fromDate || "", // optional
      toDate: toDate || ""      // optional
    };

    console.log("Payload for vendor API:", payload);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const customers = await response.json();
    console.log("Vendor response:", customers);

    // Save to DB
    for (const cust of customers) {
      try {
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
      } catch (err) {
        console.error("DB INSERT ERROR:", err.message);
      }
    }

    res.json(customers);

  } catch (err) {
    console.error("Local Customers Error:", err.message);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

router.post("/send-bulk", async (req, res) => {
    console.log("📩 Request Body:", req.body);

  const { numbers, message } = req.body;

  if (!numbers || !message) {
    return res.status(400).json({
      error: "Numbers and message required",
    });
  }

  try {
    const results = await Promise.all(
      numbers.map((num) =>
        client.messages.create({
          from: whatsappFrom,
          to: `whatsapp:+91${num}`,
          body: message,
        })
      )
    );

    res.json({
      success: true,
      sent: results.length,
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: err.message,
    });
  }
});




router.get("/local-customer/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM local_customers ORDER BY added_date DESC`
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    console.error("FETCH LOCAL CUSTOMERS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch local customers" });
  }
});
router.get('/local-customers/:mobile', async (req, res) => {
  const { mobile } = req.params;

  if (!mobile) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  try {
    const query = `
      SELECT *
      FROM local_customers
      WHERE mobile_no = $1
    `;
    const result = await pool.query(query, [mobile]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const customer = result.rows[0];

    // Return customer data
    res.json({
      lc_code: customer.lc_code,
      lc_name: customer.lc_name,
      age: customer.age,
      gender: customer.gender,
      address1: customer.address1,
      address2: customer.address2,
      address3: customer.address3,
      city: customer.city,
      pin: customer.pin,
      mobile_no: customer.mobile_no,
      mail_id: customer.mail_id,
    });

  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ message: 'Internal server error', error });
  }
});
/* =========================================================
   5.5 Push Purchase Orders
========================================================= */
router.post("/purchase-orders", async (req, res) => {
  let { c2Code, storeId, prodCode, fromDate, toDate } = req.body;

  if (!c2Code || !storeId || !prodCode) {
    return res.status(400).json({
      error: "Required fields missing: c2Code, storeId, prodCode",
    });
  }

  fromDate = fromDate || "";
  toDate = toDate || "";

  try {
    const apiKey = await getToken();
    console.log("Generated API Key:", apiKey);

    const payload = { c2Code, storeId, prodCode, apiKey, fromDate, toDate };
    console.log("Payload for vendor API:", payload);

    const fetchResponse = await fetch(
      "http://117.211.64.158:21000/ws_c2_services_po_fetch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      throw new Error(`Fetch failed: ${fetchResponse.status} - ${errorText}`);
    }

    // ✅ FIX: handle broken JSON response safely
    const rawText = await fetchResponse.text();

    let purchaseOrders;

    try {
      purchaseOrders = JSON.parse(rawText);
    } catch (err) {
      // Fix: multiple JSON objects stuck together
      const fixedText = `[${rawText.replace(/}{/g, "},{")}]`;
      purchaseOrders = JSON.parse(fixedText);
    }

    purchaseOrders = Array.isArray(purchaseOrders)
      ? purchaseOrders
      : [purchaseOrders];

    for (const po of purchaseOrders) {
      const createDateTime = po.createDateTime || new Date();
      const createUser = po.createUser || "SYSTEM";
      const modifyDateTime = po.modifyDateTime || new Date();
      const modifiedUser = po.modifiedUser || "SYSTEM";
      const remarks = po.remarks || "";

      const query = `
        INSERT INTO ecogreenpurchase_orders (
          br_code, year, prefix, srno,
          custcode, custname, refcode, refname,
          total, details,
          createDateTime, createUser, modifyDateTime, modifiedUser, remarks
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (br_code, year, prefix, srno) DO UPDATE SET
          custcode = EXCLUDED.custcode,
          custname = EXCLUDED.custname,
          refcode = EXCLUDED.refcode,
          refname = EXCLUDED.refname,
          total = EXCLUDED.total,
          details = EXCLUDED.details,
          createDateTime = EXCLUDED.createDateTime,
          createUser = EXCLUDED.createUser,
          modifyDateTime = EXCLUDED.modifyDateTime,
          modifiedUser = EXCLUDED.modifiedUser,
          remarks = EXCLUDED.remarks
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
        JSON.stringify(po.details),
        createDateTime,
        createUser,
        modifyDateTime,
        modifiedUser,
        remarks,
      ];

      try {
        await pool.query(query, values);
      } catch (dbErr) {
        console.error(
          `DB INSERT ERROR for ${po.br_code}-${po.prefix}-${po.srno}:`,
          dbErr.message
        );
      }
    }

    res.status(200).json({
      success: true,
      message: "Purchase orders synced successfully",
      total: purchaseOrders.length,
      data: purchaseOrders,
    });
  } catch (err) {
    console.error("Purchase Orders Error:", err.message);
    res.status(500).json({
      error: "Failed to fetch or save purchase orders",
    });
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
router.put("/update_delivery_type/:id", async (req, res) => {
  const { id } = req.params;
  const { delivery_type } = req.body;

  try {
    await pool.query(
      "UPDATE ecogreenpurchase_orders SET delivery_type = $1 WHERE id = $2",
      [delivery_type, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});
router.post("/save_bus_details", async (req, res) => {
  try {
    const {
      order_id,
      bus_no,
      driver_name,
      driver_contact,
      delivery_boy_id,
    } = req.body;

    const existing = await pool.query(
      "SELECT * FROM order_bus_details WHERE order_id = $1",
      [order_id]
    );

    if (existing.rows.length > 0) {
      // UPDATE
      await pool.query(
        `UPDATE order_bus_details 
         SET bus_no=$1, driver_name=$2, driver_contact=$3, delivery_boy_id=$4
         WHERE order_id=$5`,
        [bus_no, driver_name, driver_contact, delivery_boy_id, order_id]
      );
    } else {
      // INSERT
      await pool.query(
        `INSERT INTO order_bus_details 
         (order_id, bus_no, driver_name, driver_contact, delivery_boy_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [order_id, bus_no, driver_name, driver_contact, delivery_boy_id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.get("/bus_details/:order_id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM order_bus_details WHERE order_id=$1",
      [req.params.order_id]
    );

    res.json({
      success: true,
      data: result.rows[0] || null,
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.get("/all_buses", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM order_bus_details"
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});
router.post("/assign_bus_to_order", async (req, res) => {
  try {
    const { order_id, bus_no, delivery_boy_id } = req.body;

    if (!order_id || !bus_no) {
      return res.status(400).json({
        success: false,
        message: "order_id and bus_no are required",
      });
    }

    // 1️⃣ Get FULL bus details
    const busResult = await pool.query(
      `SELECT id, bus_no, bus_name, driver_name, driver_contact 
       FROM order_bus_details 
       WHERE bus_no = $1`,
      [bus_no]
    );

    if (busResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Bus not found",
      });
    }

    const bus = busResult.rows[0];

    // 2️⃣ Update order with BOTH bus_id + bus_details
    const result = await pool.query(
      `
      UPDATE ecogreenpurchase_orders
      SET 
        bus_id = $1,
        delivery_boy = $2,
        bus_details = $3
      WHERE id = $4
      RETURNING *
      `,
      [
        bus.id,
        delivery_boy_id || null,
        JSON.stringify({
          bus_no: bus.bus_no,
          bus_name: bus.bus_name,
          driver_name: bus.driver_name,
          driver_contact: bus.driver_contact,
        }),
        order_id,
      ]
    );

    return res.json({
      success: true,
      message: "Bus assigned successfully",
      data: result.rows[0],
    });

  } catch (err) {
    console.error("assign_bus_to_order error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
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
router.post("/assign_employee", async (req, res) => {
  try {
    const { order_id, employee_id } = req.body;

    // get employee email
    const emp = await pool.query(
      `SELECT email FROM employees WHERE id = $1`,
      [employee_id]
    );

    const email = emp.rows[0]?.email || null;

    await pool.query(
      `UPDATE ecogreenpurchase_orders
       SET assigned_employee = $1,
           assigned_employee_email = $2
       WHERE id = $3`,
      [employee_id, email, order_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
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

router.put("/mark-completed/:srno", async (req, res) => {
  try {
    const { srno } = req.params;

    const updateQuery = `
      UPDATE ecogreenpurchase_orders
      SET 
        status = 'Completed',
        completed_at = (NOW() AT TIME ZONE 'Asia/Kolkata')
      WHERE srno = $1
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [srno]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found with this SRNO",
      });
    }

    res.json({
      success: true,
      message: "Order marked as completed",
      data: result.rows[0],
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});
router.post('/create_sales_order', async (req, res) => {
  try {
    const salesOrderData = req.body;

    console.log('=== Incoming Request Body ===');
    console.log(salesOrderData);

    // ✅ ONLY REQUIRED VALIDATION (ERP mandatory fields)
    if (!salesOrderData.c2Code || !salesOrderData.storeId || !salesOrderData.prodCode) {
      return res.status(400).json({
        message: 'Required fields missing: c2Code, storeId, prodCode'
      });
    }

    // optional token handling
    if (!salesOrderData.apiKey) {
      salesOrderData.apiKey = await getToken();
    }

    // 🔥 DIRECT CALL TO ERP (NO CART, NO DB)
    const response = await fetch(
      'http://117.211.64.158:21000/ws_c2_services_create_sale_order',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(salesOrderData),
      }
    );

    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (err) {
      return res.status(500).json({
        message: "ERP returned invalid response",
        raw: rawText,
      });
    }

    // success response
    if (response.ok) {
      return res.status(200).json({
        message: "Sales order created successfully",
        data
      });
    }

    // failure response
    return res.status(response.status).json({
      message: "Failed to submit sales order",
      data
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
});

router.post("/ordermedicne/create_sales_order", async (req, res) => {
  const client = await pool.connect();

  try {
    const order = req.body;

    console.log("=== Incoming Order ===", order);

    if (!order.c2Code || !order.storeId || !order.prodCode) {
      return res.status(400).json({
        message: "Required fields missing",
      });
    }

    const safeNumber = (val) => {
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    };

    const safeJSON = (val) => {
      try {
        return JSON.stringify(val ?? {});
      } catch {
        return JSON.stringify({});
      }
    };

    await client.query("BEGIN");

    const localId = Math.floor(Math.random() * 999999999);
    const otp = Math.floor(1000 + Math.random() * 9000);
    const patientId = order.userId || null;

    let cartItems = [];

    if (patientId) {
      const cartRes = await client.query(
        `SELECT id AS cart_id, name, quantity, price
         FROM cart
         WHERE patient_id = $1`,
        [patientId]
      );

      cartItems = cartRes.rows;
    }

    console.log("🛒 CART ITEMS:", cartItems);

    const insertOrder = `
      INSERT INTO orders (
        id,
        patient_id,
        patient_name,
        patient_email,
        mobile_no,
        address_id,
        address,
        payment_method,
        expected_delivery,
        subtotal,
        delivery_fee,
        tax,
        total,
        order_summary,
        status,
        otp,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
      RETURNING *
    `;

    const dbResult = await client.query(insertOrder, [
      localId,
      order.userId || null,
      order.patientName || null,
      order.patientEmail || null,
      order.mobileNo || null,
      order.addressId || null,
      safeJSON(order.patientAddress),
      order.paymentMethod || "",
      order.expectedDelivery || null,
      safeNumber(order.subtotal),
      safeNumber(order.deliveryFee),
      safeNumber(order.tax),
      safeNumber(order.orderTotal),
      safeJSON(order.materialInfo),
      "pending",
      otp,
    ]);

    const savedOrder = dbResult.rows[0];

    console.log("=== ORDER SAVED ===", savedOrder);

    // =========================
    // COMMIT DB FIRST
    // =========================
    await client.query("COMMIT");

    // =========================
    // 🟡 SEND TO VENDOR API (AFTER DB SUCCESS)
    // =========================
    try {
      const vendorPayload = {
        ...order,
        orderId: localId,
        otp,
        cartItems,
      };

      const vendorResponse = await fetch(
        "http://117.211.64.158:21000/ws_c2_services_create_sale_order",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(vendorPayload),
        }
      );

      const vendorText = await vendorResponse.text();

      let vendorData;
      try {
        vendorData = JSON.parse(vendorText);
      } catch {
        vendorData = { raw: vendorText };
      }

      console.log("🏪 VENDOR RESPONSE:", vendorData);

      // OPTIONAL: store vendor response in DB (if column exists)
      // await pool.query(
      //   "UPDATE orders SET vendor_response = $1 WHERE id = $2",
      //   [JSON.stringify(vendorData), localId]
      // );

    } catch (vendorError) {
      console.error("❌ Vendor API failed:", vendorError.message);
      // IMPORTANT: do NOT fail order because vendor failed
    }

    // =========================
    // CLEAR CART
    // =========================
    if (patientId) {
      await client.query(
        "DELETE FROM cart WHERE patient_id = $1",
        [patientId]
      );

      console.log("🧹 Cart cleared for patient:", patientId);
    }

    return res.status(200).json({
      success: true,
      message: "Order placed successfully",
      orderId: localId,
      otp,
      data: savedOrder,
    });

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {
      console.log("Rollback failed:", e.message);
    }

    console.error("=== SERVER ERROR ===", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });

  } finally {
    client.release();
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
      data.createduser || null,   // ✅ ADDED HERE

      data.order_type || null,
      data.invoice_id || null,
      data.payment_status || null,
      data.total_price || 0,
      data.total_discount || 0,
      data.order_for || null,
      data.delivered_by || null,
      data.shipping_charge || 0,

      data.patient_name || null,
      data.patient_contact_no || null,

      data.patient_address ? JSON.stringify(data.patient_address) : null,
      data.pharmacy ? JSON.stringify(data.pharmacy) : null,
      data.order_items ? JSON.stringify(data.order_items) : null
    ];

    const query = `
      INSERT INTO ecogreensales_orders
      (
        order_id,
        order_no,
        created_at,
        createduser,              -- ✅ ADDED HERE
        order_type,
        invoice_id,
        payment_status,
        total_price,
        total_discount,
        order_for,
        delivered_by,
        shipping_charge,

        patient_name,
        patient_contact_no,

        patient_address,
        pharmacy,
        order_items
      )
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

// router.get("/sales-orders", async (req, res) => {
//   try {
//     const { from } = req.query;

//     let query = "SELECT * FROM ecogreensales_orders";
//     let values = [];

//     if (from) {
//       query += " WHERE created_at > $1";
//       values.push(from);
//     }

//     query += " ORDER BY created_at ASC";

//     const result = await pool.query(query, values);

//     res.json(result.rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to fetch orders" });
//   }
// });
router.get("/sales-orders", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ecogreensales_orders ORDER BY created_at DESC"
    );

    const orders = result.rows.map((order) => ({
      ...order,
      patient_address:
        typeof order.patient_address === "string"
          ? JSON.parse(order.patient_address || "{}")
          : order.patient_address || {},
      pharmacy:
        typeof order.pharmacy === "string"
          ? JSON.parse(order.pharmacy || "{}")
          : order.pharmacy || {},
      order_items:
        typeof order.order_items === "string"
          ? JSON.parse(order.order_items || "[]")
          : order.order_items || [],
    }));

    res.status(200).json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ Fetch single order by ID
router.get("/sales-orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM ecogreensales_orders WHERE id=$1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Order not found" });

    const order = result.rows[0];
    order.patient_address = JSON.parse(order.patient_address || "{}");
    order.pharmacy = JSON.parse(order.pharmacy || "{}");
    order.order_items = JSON.parse(order.order_items || "[]");

    res.status(200).json(order);
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =====================
// Sales Invoice Webhook
// =====================
router.post("/sales-invoice", async (req, res) => {
  const data = req.body;

  try {
    const createdAt = data.created_at || null;
    const createdAtSystem = new Date().toISOString();

    const values = [
      data.order_id || null,
      data.order_no || null,
      data.invoice_id || null,

      createdAt,
      createdAtSystem,

      data.createduser || null,

      data.order_type || null,
      data.payment_status || null,
      data.total_price || 0,
      data.total_discount || 0,
      data.order_for || null,
      data.delivered_by || null,
      data.shipping_charge || 0,
      data.patient_name || null,
      data.patient_contact_no || null,

      // Patient Address
      data.patient_address
        ? JSON.stringify(data.patient_address)
        : null,

      // Pharmacy
      data.pharmacy
        ? JSON.stringify(data.pharmacy)
        : null,

      data.store_id || null,

      data.order_items
        ? JSON.stringify(data.order_items)
        : null,

      data.user_email || null,

      // ✅ NEW FIELDS
      data.reminder_date || null,
      data.d_remind_date || null
    ];

    const query = `
      INSERT INTO ecogreensales_invoices (
        order_id,
        order_no,
        invoice_id,
        created_at,
        created_at_system,
        createduser,
        order_type,
        payment_status,
        total_price,
        total_discount,
        order_for,
        delivered_by,
        shipping_charge,
        patient_name,
        patient_contact_no,
        patient_address,
        pharmacy,
        store_id,
        order_items,
        user_email,

        reminder_date,
        d_remind_date
      )
      VALUES (
        ${values.map((_, i) => `$${i + 1}`).join(",")}
      )
      RETURNING id
    `;

    const result = await pool.query(query, values);

    res.status(200).json({
      success: true,
      message: "Sales invoice saved successfully",
      id: result.rows[0].id
    });

  } catch (err) {
    console.error("Error saving sales invoice:", err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
router.get("/sales-invoice/by-order/:orderNo", async (req, res) => {
  const { orderNo } = req.params;

  try {
    const query = `
      SELECT *
      FROM ecogreensales_invoices
      WHERE order_no = $1
      LIMIT 1
    `;

    const result = await pool.query(query, [orderNo]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found for this orderNo",
      });
    }

    const invoice = result.rows[0];

    invoice.patient_address =
      typeof invoice.patient_address === "string"
        ? JSON.parse(invoice.patient_address)
        : invoice.patient_address;

    invoice.order_items =
      typeof invoice.order_items === "string"
        ? JSON.parse(invoice.order_items)
        : invoice.order_items;

    res.status(200).json({
      success: true,
      data: invoice,
    });
  } catch (err) {
    console.error("Error fetching sales invoice:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// Fetch all sales invoices
router.get("/sales-invoice/all", async (req, res) => {
  try {
    const query = `SELECT * FROM ecogreensales_invoices ORDER BY created_at DESC`;
    const result = await pool.query(query);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching sales invoices:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/sales-invoice/assign-delivery", async (req, res) => {
  const { order_id, delivered_by_id } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let selectedBoy;

    // ==============================
    // CASE 1: MANUAL ASSIGN
    // ==============================
    if (delivered_by_id !== undefined && delivered_by_id !== null && delivered_by_id !== "") {
  const emp = await client.query(
    `SELECT id, full_name FROM employees WHERE id = $1`,
    [delivered_by_id]
  );

  if (!emp.rows.length) {
    return res.status(400).json({ error: "Invalid delivery boy" });
  }

  selectedBoy = emp.rows[0];
} 

    // ==============================
    // CASE 2: AUTO ASSIGN
    // ==============================
    else {
      const empRes = await client.query(`
        SELECT id, full_name
        FROM employees
        WHERE role = 'Hd delivery'
        ORDER BY id ASC
      `);

      const boys = empRes.rows;

      if (boys.length === 0) {
        return res.status(400).json({ error: "No delivery boys found" });
      }

      const countRes = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM ecogreensales_invoices
        WHERE delivered_by_id IS NOT NULL
      `);

      const index = countRes.rows[0].count % boys.length;

      selectedBoy = boys[index];
    }

    // ==============================
    // UPDATE ORDER
    // ==============================
    const result = await client.query(
      `
      UPDATE ecogreensales_invoices
      SET 
        delivered_by_id = $1,
        delivered_by = $2,
        assigned_at = NOW(),
        status = 'assigned'
      WHERE order_id = $3
      RETURNING *
      `,
      [selectedBoy.id, selectedBoy.full_name, order_id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      assigned_to: selectedBoy,
      data: result.rows[0],
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Assign failed" });
  } finally {
    client.release();
  }
});
router.get("/sales-invoice/by-delivery-boy/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM ecogreensales_invoices
      WHERE delivered_by_id = $1
      ORDER BY created_at DESC
      `,
      [id]
    );

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("Fetch by delivery boy error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.post("/sales-invoice/payment/collect", async (req, res) => {
  const {
    order_no,
    amount_collected,
    payment_mode_collected,
    collected_by,
    remarks = null,
  } = req.body;

  if (!order_no) {
    return res.status(400).json({
      success: false,
      message: "order_no is required",
    });
  }

  try {
    const safeOrderNo = String(order_no).trim();
    const amount = Number(amount_collected);

    if (isNaN(amount)) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount_collected",
      });
    }

    const paymentDetails = {
      payment_mode_collected,
    };

    console.log("✅ SAFE order_no:", safeOrderNo);

    const query = `
      UPDATE ecogreensales_invoices
      SET 
        payment_collected = true,
        amount_collected = $1,
        payment_mode_collected = $2,
        collected_by = $3,
        collection_remarks = $4,
        collected_at = NOW()
      WHERE order_no = $5
      RETURNING *
    `;

    const result = await pool.query(query, [
      amount,
      JSON.stringify(paymentDetails),
      collected_by,
      remarks,
      safeOrderNo,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Payment collected successfully",
      data: result.rows[0],
    });

  } catch (err) {
    console.error("Payment collect error:", err);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
    });
  }
});
router.post('/sales-order-status', async (req, res) => {
  const { orderNo } = req.body;

  if (!orderNo) {
    return res.status(400).json({ error: 'Missing orderNo' });
  }

  try {
    // 🔐 Always generate API token internally
    const apiKey = await getToken();
    console.log('Generated API Key:', apiKey);

    const client = await pool.connect();

    try {
      const url = `http://117.211.64.158:21000/ws_c2_services_sale_order_status?order_no=${encodeURIComponent(orderNo)}&apikey=${encodeURIComponent(apiKey)}`;

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
          (order_id, cust_code, from_gst_no, to_gst_no, customer_type, doctor_name, invoices)
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

  } catch (err) {
    console.error('API Key Generation Error:', err);
    res.status(500).json({ error: 'Failed to generate API Key' });
  }
});


router.get('/sales-order-status/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        so.*,
        e1.full_name AS assigned_by_name,
        e2.full_name AS delivery_boy_name,
        dbl.latitude,
        dbl.longitude
      FROM ecogreensales_order_status so

      -- Assigned By
      LEFT JOIN employees e1 ON so.assigned_by = e1.id

      -- Delivery Boy Name
      LEFT JOIN employees e2 ON so.delivery_boy_id = e2.id

      -- Latest Delivery Boy Location
      LEFT JOIN LATERAL (
        SELECT latitude, longitude
        FROM delivery_boy_locations
        WHERE delivery_boy_id = so.delivery_boy_id
        ORDER BY created_at DESC
        LIMIT 1
      ) dbl ON true

      ORDER BY so.created_at DESC
    `);

    res.status(200).json({
      count: result.rows.length,
      orders: result.rows,
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
    // Fetch orders assigned to the delivery boy
    const orderResult = await pool.query(
      `SELECT *
       FROM ecogreensales_order_status
       WHERE delivery_boy_id = $1
       ORDER BY created_at DESC`,
      [deliveryBoyId]
    );

    // Transform to get order_id, product names, total products, and total amount
    const orders = orderResult.rows.map((order) => {
      // Collect all products from all invoices
      const products = order.invoices.flatMap((invoice) =>
        invoice.detail.map((p) => p.productName)
      );

      // Sum all docTotal values from invoices
      const total_amount = order.invoices.reduce(
        (sum, invoice) => sum + parseFloat(invoice.docTotal),
        0
      );

      return {
        order_id: order.order_id, // <-- convert to number here
        product_names: products.join(", "), // comma-separated
        total_products: products.length,
        total_amount: total_amount.toFixed(2), // string with 2 decimal places
      };
    });

    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error("Error fetching products for delivery boy:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.put("/salesstatus/mark-sales-delivered/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const result = await pool.query(
      `UPDATE ecogreensales_order_status
       SET status = 'Delivered'
       WHERE order_id = $1
       RETURNING *`,
      [orderId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      message: "Order marked as Delivered",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error marking delivered:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});
// PUT /ecogreen/sales-orderstatus/complete/:orderId
router.put("/sales-orderstatus/complete/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query(
      `UPDATE ecogreensales_order_status
       SET 
         status = 'Completed',
         completed_at = NOW()
       WHERE order_id = $1
       RETURNING *`,
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({
      success: true,
      message: "Order marked as Completed",
      order: result.rows[0],
    });
  } catch (err) {
    console.error("Error completing order:", err);
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